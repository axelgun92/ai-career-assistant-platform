// Universal target job titles on every automatic acquisition path (November
// 22, 2026), with fakes: configured sources (the retrieval worker, Workday's
// list-then-detail adapter), results-page capture's staging and selection,
// jobs queued before the titles applied (the worker pass and background-tab
// start), the post-ingest safety net, and the popup's deliberate override.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTitlePolicy, type RawOpportunity, type TitlePolicy } from "@ai-career/core";
import { customerSuccessDefaultTitlePolicy, customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { ExtensionPairingRecord, PageCaptureItemRecord, RetrievalRunRecord, RetrievalSourceRecord } from "@ai-career/database";
import {
  createAdapterRegistry,
  createFixtureTransport,
  fixtureRequestKey,
  workdayAdapter,
  workdayListBody,
  type CollectContext,
  type TransportResponse,
} from "@ai-career/discovery";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { buildPageCaptureBatch, pageCaptureMessage, rejectedLines } from "../../apps/extension/src/page-capture-view";
import { createPageCaptureService, pageCaptureDeletedReason, pageCaptureOutsideTitlesReason } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, createPageCaptureIngestor, itemsSkippedByTitle } from "../../apps/web/src/server/page-capture-acquisition";
import { createPageCaptureTabService } from "../../apps/web/src/server/page-capture-tabs";
import { createRetrievalWorker, type RetrievalRunStore } from "../../apps/web/src/server/retrieval-worker";
import { runExtractor } from "../support/extension-pages";
import { testSiteJobPage } from "../support/page-capture-pages";
import { createTestAdapter, jsonResponse, testBoardUrl } from "../support/retrieval-test-adapter";

const policy = createTitlePolicy(customerSuccessDefaultTitlePolicy);
const loader = (current: TitlePolicy = policy) => async () => current;
const now = new Date("2026-11-22T09:00:00.000Z");

describe("configured sources", () => {
  const sourceId = "5b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e";
  const runId = "7c1d4e2f-8b3a-4d66-ae8f-2a3b4c5d6e7f";
  const source: RetrievalSourceRecord = {
    id: sourceId,
    adapterKey: "test-board",
    name: "Acme board",
    domain: "customer-success",
    retrievalType: "OFFICIAL_PUBLIC_API_FEED",
    sourceCategory: "ATS",
    enabled: true,
    config: { board: "acme" },
    scheduleMinutes: 720,
    lastRunAt: null,
    nextEligibleAt: null,
    trackingScopeKey: "scope-1",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const run: RetrievalRunRecord = {
    id: runId,
    retrievalSourceId: sourceId,
    trigger: "SCHEDULED",
    status: "RUNNING",
    leaseExpiresAt: null,
    startedAt: now,
    finishedAt: null,
    counts: null,
    errorCode: null,
    errorMessage: null,
    retryAfterUntil: null,
    listingCoverageComplete: null,
    createdAt: now,
  };
  const job = (id: string, title: string) => ({ id, title, html: `<p>Job ${id} description.</p>`, url: `https://jobs.example.com/${id}` });
  const page = testBoardUrl("test-board", "acme", 1);

  function worker(titlePolicy: () => Promise<TitlePolicy>, isDeletedListing?: (listing: Pick<RawOpportunity, "source" | "externalId" | "sourceUrl">) => Promise<boolean>) {
    const finished: Array<Parameters<RetrievalRunStore["finishRun"]>[1]> = [];
    const ingested: RawOpportunity[] = [];
    const store: RetrievalRunStore = {
      enqueueDueRuns: vi.fn(async () => 0),
      claimNextRun: vi.fn(async () => ({ run, source })),
      finishRun: vi.fn(async (_id, input) => (finished.push(input), { ...run, status: input.status })),
      failInterruptedRuns: vi.fn(async () => 0),
      recordListingObservations: vi.fn(async () => ({ applied: false, observed: 0, missing: 0, removed: 0, reappeared: 0 })),
    };
    const instance = createRetrievalWorker({
      store,
      ingestion: { ingest: async (raw) => (ingested.push(raw), { outcome: "CREATED", opportunityId: "o", sourceRecordId: "s", decision: "NO_MATCH" }) },
      registry: createAdapterRegistry([createTestAdapter()]),
      transport: () =>
        createFixtureTransport({
          [page]: jsonResponse({
            jobs: [
              job("1", "Customer Success Manager"),
              job("2", "Payroll Support Representative"),
              job("3", "Onboarding Specialist"),
              job("4", "Employee Onboarding Specialist"),
              job("5", "Customer Education Specialist"),
              job("6", "   "),
            ],
          }),
        }),
      discovery: customerSuccessDiscoveryConfiguration,
      titlePolicy,
      ...(isDeletedListing ? { isDeletedListing } : {}),
      env: () => ({}),
      now: () => now,
      log: { info: vi.fn(), warn: vi.fn() },
    });
    return { instance, finished, ingested };
  }

  it("keeps only titles inside the target job titles and counts what it skipped and why", async () => {
    const { instance, finished, ingested } = worker(loader());
    await instance.runOnce();
    expect(ingested.map((raw) => raw.title)).toEqual(["Customer Success Manager", "Onboarding Specialist", "Customer Education Specialist"]);
    expect(finished[0]!.counts).toMatchObject({ fetched: 6, keptByTerms: 3, created: 3, skippedByTitle: 2, missingTitle: 1 });
  });

  it("reads the setting afresh for every run, so a change applies to the next run", async () => {
    let current = policy;
    const { instance, ingested } = worker(async () => current);
    await instance.runOnce();
    expect(ingested).toHaveLength(3);
    current = createTitlePolicy({ accepted: ["Payroll Support"], excluded: [] });
    await instance.runOnce();
    expect(ingested.slice(3).map((raw) => raw.title)).toEqual(["Payroll Support Representative"]);
  });

  it("never stores again a listing the user permanently deleted", async () => {
    const { instance, finished, ingested } = worker(loader(), async (listing) => listing.externalId === "3");
    await instance.runOnce();
    expect(ingested.map((raw) => raw.externalId)).toEqual(["1", "5"]);
    expect(finished[0]!.counts).toMatchObject({ created: 2, deletedByUser: 1 });
  });

  it("Workday: the title is checked on the list response, so an outside title never costs a job-page request", async () => {
    const fixtures = path.resolve("tests/fixtures/sources/workday");
    const listUrl = "https://workday.wd5.myworkdayjobs.com/wday/cxs/workday/Workday/jobs";
    const config = workdayAdapter.configSchema.parse({ careerSite: "https://workday.wd5.myworkdayjobs.com/Workday" });
    const json = (body: string): Omit<TransportResponse, "url"> => ({ status: 200, contentType: "application/json", body });
    const responses = {
      [fixtureRequestKey(listUrl, workdayListBody(0))]: json(readFileSync(path.join(fixtures, "response.json"), "utf8")),
      [fixtureRequestKey(listUrl, workdayListBody(20))]: json(readFileSync(path.join(fixtures, "response-page-2.json"), "utf8")),
    };
    const transport = createFixtureTransport(responses);
    const context: CollectContext = {
      transport,
      discovery: customerSuccessDiscoveryConfiguration,
      keepTitle: () => false,
      env: {},
      now: () => now,
      maxPages: 5,
      maxDetailRequests: 25,
    };
    const result = await workdayAdapter.collect(context, config);
    expect(result.listings).toEqual([]);
    expect(transport.requested.every((key) => key.includes("/jobs"))).toBe(true);
    expect(transport.requested.some((key) => key.includes("/job/"))).toBe(false);
  });
});

describe("results-page capture (Mode B)", () => {
  const pairing: ExtensionPairingRecord = { id: "1b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e", label: "Chrome", tokenHint: "abcd", createdAt: now, lastUsedAt: null, revokedAt: null };
  const card = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ url: `https://jobs.e2e.invalid/jobs/${id}`, title, siteJobId: id, ...extra });
  const batch = (cards: Array<Record<string, unknown>>) => ({
    schemaVersion: 1,
    kind: "page-capture",
    batchId: "0f6f1c9c-1d55-4a3b-9b9f-0d2b8a1e4c11",
    site: "e2e-results",
    pageUrl: "https://jobs.e2e.invalid/search",
    pageTitle: "Results",
    capturedAt: "2026-11-22T08:59:00.000Z",
    extensionVersion: "0.3.0",
    counts: { loaded: cards.length, skippedUnloaded: 0, overCap: 0 },
    cards,
  });
  const enabledSites = () => ({ cards: ["e2e-results"], details: ["e2e-results"] });

  function service(isDeletedCard?: (card: { externalId: string; sourceUrl: string }) => Promise<boolean>) {
    const stageBatch = vi.fn(async (input: { cards: Array<{ externalId: string; title: string; titleOverride?: boolean }> }) =>
      input.cards.map((staged, index) => ({ externalId: staged.externalId, outcome: "QUEUED" as const, opportunityId: null, itemId: `item-${index}`, status: "QUEUED" })),
    );
    const selectionFor = vi.fn(async (input: { cards: Array<{ externalId: string }> }) => new Map(input.cards.map((item) => [item.externalId, { disposition: "NEW" as const, selectable: true }])));
    const pageCaptures = createPageCaptureService({
      repository: { stageBatch, siteStoppedUntil: async () => null, expireTabItems: async () => 0, selectionFor } as never,
      enabledSites,
      now: () => now,
      titlePolicy: loader(),
      ...(isDeletedCard ? { isDeletedCard } : {}),
    });
    return { pageCaptures, stageBatch, selectionFor };
  }

  it("stages only cards whose titles pass: an outside title is never staged, so no job page is read and nothing is saved", async () => {
    const { pageCaptures, stageBatch } = service();
    const result = await pageCaptures.capture(
      batch([card("a1", "Customer Success Manager"), card("a2", "Payroll Support Representative"), card("a3", "Customer Experience Designer"), card("a4", "Onboarding Specialist")]),
      pairing,
    );
    const staged = (stageBatch.mock.calls[0]![0] as { cards: Array<{ title: string }> }).cards.map((item) => item.title);
    expect(staged).toEqual(["Customer Success Manager", "Onboarding Specialist"]);
    expect(result.counts).toMatchObject({ queued: 2, rejected: 0, outsideTitles: 2 });
    expect(result.outcomes.filter((item) => item.outcome === "SKIPPED").map((item) => [item.title, item.reason])).toEqual([
      ["Payroll Support Representative", pageCaptureOutsideTitlesReason],
      ["Customer Experience Designer", pageCaptureOutsideTitlesReason],
    ]);
  });

  it("stages a card the user deliberately chose, marked as a title override", async () => {
    const { pageCaptures, stageBatch } = service();
    await pageCaptures.capture(batch([card("b1", "Payroll Support Representative", { titleOverride: true })]), pairing);
    expect((stageBatch.mock.calls[0]![0] as { cards: Array<{ titleOverride?: boolean }> }).cards).toMatchObject([{ titleOverride: true }]);
  });

  it("never stages a job the user permanently deleted", async () => {
    const { pageCaptures, stageBatch } = service(async (item) => item.sourceUrl.endsWith("/c2"));
    const result = await pageCaptures.capture(batch([card("c1", "Customer Success Manager"), card("c2", "Customer Success Lead")]), pairing);
    expect((stageBatch.mock.calls[0]![0] as { cards: unknown[] }).cards).toHaveLength(1);
    expect(result.counts.deletedByUser).toBe(1);
    expect(result.outcomes.find((item) => item.outcome === "SKIPPED")?.reason).toBe(pageCaptureDeletedReason);
  });

  it("selection answers OUTSIDE_TARGET_TITLES (never selectable) exactly as staging decides, and leaves a card without a title to staging", async () => {
    const { pageCaptures, selectionFor } = service();
    const answer = await pageCaptures.selection({
      site: "e2e-results",
      cards: [
        { url: "https://jobs.e2e.invalid/jobs/d1", siteJobId: "d1", title: "Customer Education Specialist" },
        { url: "https://jobs.e2e.invalid/jobs/d2", siteJobId: "d2", title: "Program Manager, M&A Recruiting" },
        { url: "https://jobs.e2e.invalid/jobs/d3", siteJobId: "d3", title: "" },
        { url: "https://jobs.e2e.invalid/jobs/d4", siteJobId: "d4" },
      ],
    });
    expect(answer.cards.map((item) => [item.disposition, item.selectable])).toEqual([
      ["NEW", true],
      ["OUTSIDE_TARGET_TITLES", false],
      ["OUTSIDE_TARGET_TITLES", false],
      ["NEW", true],
    ]);
    expect((selectionFor.mock.calls[0]![0] as { cards: unknown[] }).cards).toHaveLength(2);
  });

  const item = (id: string, title: string, extra: Partial<PageCaptureItemRecord> = {}): PageCaptureItemRecord => ({
    id,
    site: "e2e-results",
    host: "jobs.e2e.invalid",
    externalId: `e2e-results:${id}`,
    sourceUrl: `https://jobs.e2e.invalid/jobs/${id}`,
    siteJobId: id,
    title,
    company: null,
    location: null,
    postedText: null,
    resultsPageUrl: "https://jobs.e2e.invalid/search",
    firstSeenAt: now,
    lastSeenAt: now,
    sightings: 1,
    lastBatchId: "0f6f1c9c-1d55-4a3b-9b9f-0d2b8a1e4c11",
    pairingId: pairing.id,
    status: "QUEUED",
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastReason: null,
    opportunityId: null,
    handoffOutcome: null,
    handedOffAt: null,
    titleOverride: false,
    ...extra,
  });

  it("jobs queued before the titles applied: outside or missing titles are skipped, never a saved job or one the user chose", () => {
    expect(
      itemsSkippedByTitle(
        [
          item("e1", "Customer Success Manager"),
          item("e2", "Payroll Support Representative"),
          item("e3", " "),
          item("e4", "Payroll Support Representative", { titleOverride: true }),
          item("e5", "Payroll Support Representative", { opportunityId: "11111111-1111-4111-8111-111111111111" }),
        ],
        policy,
      ),
    ).toEqual({ outside: ["e2"], missing: ["e3"] });
  });

  it("the worker pass skips such jobs before opening any page (no browser when nothing is left to read)", async () => {
    const skipItems = vi.fn(async (ids: readonly string[]) => ids.length);
    const launch = vi.fn();
    const acquisition = createPageCaptureAcquisition({
      repository: {
        recoverInterrupted: async () => 0,
        sitesWithQueued: async () => ["e2e-results"],
        siteStoppedUntil: async () => null,
        claimQueued: async () => [item("f1", "Payroll Support Representative"), item("f2", "")],
        skipItems,
      } as never,
      ingestion: { ingest: vi.fn() } as never,
      handoff: { alreadyHandled: async () => false, request: async () => "QUEUED" } as never,
      discovery: customerSuccessDiscoveryConfiguration,
      titlePolicy: loader(),
      detailSites: () => ["e2e-results"],
      browser: { launch } as never,
      now: () => now,
    });
    await acquisition.runOnce();
    expect(skipItems).toHaveBeenCalledWith(["f1"], "OUTSIDE_TARGET_TITLES");
    expect(skipItems).toHaveBeenCalledWith(["f2"], "MISSING_TITLE");
    expect(launch).not.toHaveBeenCalled();
  });

  it("a background-tab job queued before the titles applied is not opened: start refuses it as SKIPPED", async () => {
    const skipItems = vi.fn(async () => 1);
    const startTabItem = vi.fn();
    const tabs = createPageCaptureTabService({
      repository: {
        findById: async () => ({ ...item("12345678-1234-4123-8123-123456789012", "Employee Onboarding Specialist"), site: "welcome-to-the-jungle" }),
        startTabItem,
        settleTabItem: vi.fn(),
        stopTabItems: vi.fn(),
        stopTabSite: vi.fn(),
        siteStoppedUntil: async () => null,
        skipItems,
      } as never,
      ingestor: { ingest: vi.fn() } as never,
      enabledSites: () => ({ cards: ["welcome-to-the-jungle"], details: ["welcome-to-the-jungle"] }),
      titlePolicy: loader(),
    });
    const started = await tabs.start("12345678-1234-4123-8123-123456789012");
    expect(started).toMatchObject({ proceed: false, status: "SKIPPED", reason: "OUTSIDE_TARGET_TITLES" });
    expect(startTabItem).not.toHaveBeenCalled();
  });

  it("the post-ingest safety net holds back a job page whose own title is outside, unless the user chose it", async () => {
    const markHandedOff = vi.fn();
    const request = vi.fn(async () => "QUEUED");
    const ingestor = createPageCaptureIngestor({
      repository: { markIngested: vi.fn(), markHandedOff } as never,
      ingestion: { ingest: async () => ({ outcome: "CREATED", opportunityId: "o-1", sourceRecordId: "s", decision: "NO_MATCH" }) } as never,
      handoff: { alreadyHandled: async () => false, request },
      discovery: customerSuccessDiscoveryConfiguration,
      titlePolicy: loader(),
      now: () => now,
    });
    const capture = (id: string, title: string) => {
      const built = buildCaptureEnvelope(runExtractor(testSiteJobPage({ id, title }), `https://jobs.e2e.invalid/jobs/${id}`), "page", {
        extensionVersion: "0.3.0",
        capturedAt: now,
      });
      if (!built.ok) throw new Error("expected a capture");
      return built.envelope;
    };
    // The card said Customer Success Manager; the job page itself says
    // Payroll Support Representative: saved, not sent automatically.
    await ingestor.ingest(item("g1", "Customer Success Manager"), capture("g1", "Payroll Support Representative"));
    expect(markHandedOff).toHaveBeenLastCalledWith("g1", "NOT_SENT:OUTSIDE_ROLE_FAMILIES", now);
    expect(request).not.toHaveBeenCalled();
    // A job the user chose deliberately is handed off whatever its title.
    await ingestor.ingest(item("g2", "Payroll Support Representative", { titleOverride: true }), capture("g2", "Payroll Support Representative"));
    expect(request).toHaveBeenCalledTimes(1);
    expect(markHandedOff).toHaveBeenLastCalledWith("g2", "QUEUED", now);
  });
});

describe("the popup's single-pass save", () => {
  const reading = {
    pageUrl: "https://jobs.e2e.invalid/search",
    pageTitle: "Results",
    counts: { loaded: 2, skippedUnloaded: 0, overCap: 0 },
    cards: [
      { url: "https://jobs.e2e.invalid/jobs/h1", title: "Customer Success Manager", siteJobId: "h1", company: null, location: null, postedText: null },
      { url: "https://jobs.e2e.invalid/jobs/h2", title: "Payroll Support Representative", siteJobId: "h2", company: null, location: null, postedText: null },
    ],
  };
  const context = { site: "e2e-results", batchId: "0f6f1c9c-1d55-4a3b-9b9f-0d2b8a1e4c11", extensionVersion: "0.3.0", capturedAt: now };

  it("sends a ticked outside title as a deliberate override, and only that one", () => {
    const built = buildPageCaptureBatch(reading as never, [true, true], context, new Set([1]));
    expect(built.ok && built.batch.cards.map((item) => item.titleOverride ?? false)).toEqual([false, true]);
    const unticked = buildPageCaptureBatch(reading as never, [true, false], context, new Set([1]));
    expect(unticked.ok && unticked.batch.cards).toHaveLength(1);
  });

  it("says how many were outside the target job titles and lists them", () => {
    const response = {
      batchId: context.batchId,
      site: { key: "e2e-results", name: "Test", automaticDetails: true },
      counts: { queued: 1, seenAgain: 0, alreadySaved: 0, refreshing: 0, rejected: 0, outsideTitles: 1 },
      outcomes: [{ url: "u", title: "Payroll Support Representative", outcome: "SKIPPED" as const, reason: pageCaptureOutsideTitlesReason, opportunityId: null }],
      progressUrl: "/extension/jobs",
    };
    expect(pageCaptureMessage(response)).toContain("1 outside your target job titles, not saved");
    expect(rejectedLines(response)).toEqual([`Payroll Support Representative: ${pageCaptureOutsideTitlesReason}`]);
  });
});
