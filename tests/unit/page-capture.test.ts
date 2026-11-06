// Mode B (results-page capture), with fakes: the Core site registry and
// batch envelope, the popup's batch and messages, the server intake (site
// verification, per-card identity equal to a single-job capture's, cross-site
// and ID-mismatch rejections), the API handler's refusals, and the automatic
// detail-acquisition pass: only verified sites are fetched, the accepted
// single-job reader is used unchanged, any refusal or challenge stops the
// site with no further request, and each newly ingested job is handed once
// to the existing evaluation request (whose triage decides), never to the
// evaluator directly.
import { describe, expect, it, vi } from "vitest";
import {
  detailEnabledPageCaptureSiteKeys,
  enabledPageCaptureSiteKeys,
  pageCaptureBatchSchema,
  pageCaptureOffer,
  pageCaptureSites,
  type RetrievedListingResult,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { ExtensionPairingRecord, PageCaptureItemRecord } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { buildPageCaptureBatch, pageCaptureMessage, readingSummary } from "../../apps/extension/src/page-capture-view";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { createExtensionApiHandlers, type ExtensionPairingManager } from "../../apps/web/src/server/extension-api";
import { generatePairingCredential } from "../../apps/web/src/server/extension-auth";
import { capturedListing, capturedPageIdentity, createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, evaluationHandoff, readJobPage } from "../../apps/web/src/server/page-capture-acquisition";
import { EvaluationApiError } from "../../apps/web/src/server/evaluation-errors";
import { runExtractor } from "../support/extension-pages";
import { testSiteJobPage } from "../support/page-capture-pages";
import { JSDOM } from "jsdom";

const now = new Date("2026-11-03T09:00:00.000Z");
const pairing: ExtensionPairingRecord = { id: "1b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e", label: "Chrome", tokenHint: "abcd", createdAt: now, lastUsedAt: null, revokedAt: null };
const batchId = "0f6f1c9c-1d55-4a3b-9b9f-0d2b8a1e4c11";

const batch = (overrides: Record<string, unknown> = {}, cards: Array<Record<string, unknown>> = [{ url: "https://jobs.e2e.invalid/jobs/a1", title: "CSM", siteJobId: "a1" }]) => ({
  schemaVersion: 1,
  kind: "page-capture",
  batchId,
  site: "e2e-results",
  pageUrl: "https://jobs.e2e.invalid/search",
  pageTitle: "Results",
  capturedAt: "2026-11-03T08:59:00.000Z",
  extensionVersion: "0.2.0",
  counts: { loaded: cards.length, skippedUnloaded: 0, overCap: 0 },
  cards,
  ...overrides,
});

describe("the page-capture site registry", () => {
  it("offers only verified real sites (LinkedIn, verified November 3, 2026), and the test site only under its test setting", () => {
    expect(enabledPageCaptureSiteKeys({ includeTestSite: false })).toEqual(["linkedin"]);
    expect(detailEnabledPageCaptureSiteKeys({ includeTestSite: false })).toEqual(["linkedin"]);
    expect(enabledPageCaptureSiteKeys({ includeTestSite: true })).toEqual(["linkedin", "e2e-results"]);
    for (const site of pageCaptureSites.filter((spec) => !spec.testOnly)) {
      // Welcome to the Jungle / Otta: F0 done, P1 blocked (HTTP 403), P3 unsupported.
      expect(site.cardVerified, site.key).toBe(site.key === "linkedin");
      expect(site.detailVerified, site.key).toBe(site.key === "linkedin");
    }
    expect(pageCaptureSites.map((site) => site.key)).not.toContain("wellfound");
  });

  it("offers the action only on an enabled site's results pages", () => {
    expect(pageCaptureOffer("https://www.linkedin.com/jobs/search/?keywords=csm", [])).toMatchObject({ offered: false, reason: "NOT_VERIFIED" });
    expect(pageCaptureOffer("https://www.linkedin.com/jobs/search/?keywords=csm", ["linkedin"])).toMatchObject({ offered: true });
    expect(pageCaptureOffer("https://www.linkedin.com/feed/", ["linkedin"])).toMatchObject({ offered: false, reason: "EXCLUDED_PAGE" });
    expect(pageCaptureOffer("https://www.linkedin.com/jobs/view/4100000001/", ["linkedin"])).toMatchObject({ offered: false, reason: "NOT_RESULTS_PAGE" });
    expect(pageCaptureOffer("https://www.welcometothejungle.com/en/jobs?query=cs", ["welcome-to-the-jungle"])).toMatchObject({ offered: true });
    expect(pageCaptureOffer("https://app.otta.com/jobs/", ["welcome-to-the-jungle"])).toMatchObject({ offered: true });
    expect(pageCaptureOffer("https://wellfound.com/jobs", ["linkedin"])).toMatchObject({ offered: false, reason: "UNSUPPORTED_SITE" });
    expect(pageCaptureOffer("https://example.com/jobs", ["e2e-results"])).toMatchObject({ offered: false, reason: "UNSUPPORTED_SITE" });
  });
});

describe("the page-capture batch envelope", () => {
  it("accepts 1 to 25 distinct cards with only stated fields, and nothing else", () => {
    expect(pageCaptureBatchSchema.safeParse(batch()).success).toBe(true);
    const many = Array.from({ length: 26 }, (_, index) => ({ url: `https://jobs.e2e.invalid/jobs/j${index}`, title: `CSM ${index}` }));
    expect(pageCaptureBatchSchema.safeParse(batch({}, many)).success).toBe(false);
    expect(pageCaptureBatchSchema.safeParse(batch({}, [])).success).toBe(false);
    expect(pageCaptureBatchSchema.safeParse(batch({}, [{ url: "https://jobs.e2e.invalid/jobs/a1", title: "x" }, { url: "https://jobs.e2e.invalid/jobs/a1?utm_source=x", title: "y" }])).success).toBe(false);
    expect(pageCaptureBatchSchema.safeParse(batch({}, [{ url: "javascript:alert(1)", title: "x" }])).success).toBe(false);
    expect(pageCaptureBatchSchema.safeParse(batch({}, [{ url: "https://jobs.e2e.invalid/jobs/a1", title: "x", description: "a full JD" }])).success).toBe(false);
    expect(pageCaptureBatchSchema.safeParse(batch({ cookies: "x" })).success).toBe(false);
  });

  it("is built by the popup only from the cards the user kept", () => {
    const reading = {
      pageUrl: "https://jobs.e2e.invalid/search",
      pageTitle: "Results",
      counts: { loaded: 2, skippedUnloaded: 1, overCap: 0 },
      problem: null,
      cards: [
        { url: "https://jobs.e2e.invalid/jobs/a1", title: "CSM One", siteJobId: "a1", company: null, location: null, postedText: null },
        { url: "https://jobs.e2e.invalid/jobs/b2", title: "CSM Two", siteJobId: "b2", company: null, location: null, postedText: null },
      ],
    };
    const built = buildPageCaptureBatch(reading, [true, false], { site: "e2e-results", batchId, extensionVersion: "0.2.0", capturedAt: now });
    expect(built.ok && built.batch.cards.map((card) => card.title)).toEqual(["CSM One"]);
    expect(buildPageCaptureBatch(reading, [false, false], { site: "e2e-results", batchId, extensionVersion: "0.2.0", capturedAt: now })).toMatchObject({ ok: false });
    expect(readingSummary(reading)).toBe("2 jobs read from this page. 1 not loaded yet was skipped. Scroll the page and save again for more. Locations are read with each job's details.");
    expect(
      pageCaptureMessage({
        batchId,
        site: { key: "linkedin", name: "LinkedIn", automaticDetails: false },
        counts: { queued: 2, seenAgain: 0, alreadySaved: 1, rejected: 0 },
        outcomes: [],
        progressUrl: "/extension/jobs",
      }),
    ).toBe("2 saved; automatic details are not available for LinkedIn yet · 1 already in AI Job Assistant.");
  });
});

describe("the page-capture intake", () => {
  const setup = (enabled = { cards: ["e2e-results", "linkedin"], details: ["e2e-results"] }) => {
    const stageBatch = vi.fn(async (input: { cards: Array<{ externalId: string }> }) =>
      input.cards.map((card, index) => ({ externalId: card.externalId, outcome: "QUEUED" as const, opportunityId: null, itemId: `item-${index}` })),
    );
    const service = createPageCaptureService({ repository: { stageBatch, siteStoppedUntil: async () => null } as never, enabledSites: () => enabled, now: () => now });
    return { service, stageBatch };
  };

  it("stages each card under the listing identity a single-job capture of its page records", async () => {
    const { service, stageBatch } = setup();
    const result = await service.capture(
      batch({ site: "linkedin", pageUrl: "https://www.linkedin.com/jobs/search/?keywords=csm" }, [
        { url: "https://www.linkedin.com/jobs/view/4100000001/?refId=x", title: "CSM", siteJobId: "4100000001", company: "Northwind" },
      ]),
      pairing,
    );
    const staged = stageBatch.mock.calls[0]![0] as { cards: Array<{ externalId: string; sourceUrl: string }>; detailsAvailable: boolean };
    const identity = capturedPageIdentity("https://www.linkedin.com/jobs/view/4100000001/");
    expect(staged.cards[0]).toMatchObject({ externalId: identity.externalId, sourceUrl: identity.sourceUrl });
    expect(staged.detailsAvailable).toBe(false);
    expect(result).toMatchObject({ site: { key: "linkedin", automaticDetails: false }, counts: { queued: 1, rejected: 0 } });
  });

  it("refuses a site whose card reading is not enabled, and a page that is not its results page", async () => {
    const { service, stageBatch } = setup({ cards: ["e2e-results"], details: [] });
    await expect(service.capture(batch({ site: "linkedin", pageUrl: "https://www.linkedin.com/jobs/search/" }, [{ url: "https://www.linkedin.com/jobs/view/4100000001/", title: "CSM" }]), pairing)).rejects.toMatchObject({ code: "UNSUPPORTED_PAGE" });
    await expect(service.capture(batch({ pageUrl: "https://jobs.e2e.invalid/elsewhere" }), pairing)).rejects.toMatchObject({ code: "UNSUPPORTED_PAGE" });
    await expect(service.capture(batch({ site: "linkedin" }), pairing)).rejects.toMatchObject({ code: "UNSUPPORTED_PAGE" });
    expect(stageBatch).not.toHaveBeenCalled();
  });

  it("rejects cards linking to another site or whose job ID does not match their link, and keeps the others", async () => {
    const { service, stageBatch } = setup();
    const result = await service.capture(
      batch({ site: "linkedin", pageUrl: "https://www.linkedin.com/jobs/search/" }, [
        { url: "https://boards.greenhouse.io/acme/jobs/1", title: "External apply link" },
        { url: "https://www.linkedin.com/jobs/view/4100000002/", title: "Mismatch", siteJobId: "4100000003" },
        { url: "https://www.linkedin.com/jobs/view/4100000004/", title: "Good" },
      ]),
      pairing,
    );
    expect(result.counts).toEqual({ queued: 1, seenAgain: 0, alreadySaved: 0, refreshing: 0, rejected: 2 });
    expect((stageBatch.mock.calls[0]![0] as { cards: unknown[] }).cards).toHaveLength(1);
  });

  it("reports an invalid batch as invalid", async () => {
    const { service } = setup();
    await expect(service.capture(batch({ kind: "bookmark" }), pairing)).rejects.toMatchObject({ code: "INVALID_CAPTURE" });
  });
});

describe("the page-capture API handler", () => {
  it("requires the pairing credential, JSON and the size limit, and answers the enabled sites in the status", async () => {
    const { credential, tokenHash, tokenHint } = generatePairingCredential();
    const store: ExtensionPairingManager = {
      findByHash: async (hash) => (hash === tokenHash ? { ...pairing, tokenHint, tokenHash } : null),
      markUsed: async () => undefined,
      create: async () => pairing,
      list: async () => [pairing],
      revoke: async () => pairing,
    };
    const stageBatch = vi.fn(async () => [{ externalId: "jobs.e2e.invalid:x", outcome: "QUEUED" as const, opportunityId: null, itemId: "i" }]);
    const handlers = createExtensionApiHandlers({
      pairings: store,
      captures: createExtensionCaptureService({
        ingestion: { ingest: vi.fn() },
        lookup: { findCapturedPage: vi.fn(async () => null) },
        latestEvaluation: vi.fn(async () => null),
        discovery: customerSuccessDiscoveryConfiguration,
      }),
      pageCaptures: createPageCaptureService({ repository: { stageBatch, siteStoppedUntil: async () => null } as never, enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }) }),
      evaluation: { request: vi.fn(), status: vi.fn() },
      now: () => now,
    });
    const post = (body: string, headers: Record<string, string> = {}) =>
      new Request("http://127.0.0.1:3000/api/extension/page-captures", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
    expect((await handlers.pageCapture(post(JSON.stringify(batch())))).status).toBe(401);
    const auth = { authorization: `Bearer ${credential}` };
    expect((await handlers.pageCapture(post(JSON.stringify(batch()), { ...auth, "content-type": "text/plain" }))).status).toBe(415);
    expect((await handlers.pageCapture(post("x".repeat(60 * 1024), auth))).status).toBe(413);
    expect((await handlers.pageCapture(post(JSON.stringify(batch({ site: "linkedin" })), auth))).status).toBe(422);
    const ok = await handlers.pageCapture(post(JSON.stringify(batch()), auth));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ counts: { queued: 1 }, progressUrl: "/extension/jobs" });
    const status = await handlers.status(new Request("http://127.0.0.1:3000/api/extension/status", { headers: auth }));
    expect(await status.json()).toMatchObject({ pageCapture: { sites: ["e2e-results"] } });

    // With no site enabled the status is exactly as before Mode B.
    const without = createExtensionApiHandlers({
      pairings: store,
      captures: createExtensionCaptureService({
        ingestion: { ingest: vi.fn() },
        lookup: { findCapturedPage: vi.fn(async () => null) },
        latestEvaluation: vi.fn(async () => null),
        discovery: customerSuccessDiscoveryConfiguration,
      }),
      pageCaptures: createPageCaptureService({ repository: { stageBatch, siteStoppedUntil: async () => null } as never, enabledSites: () => ({ cards: [], details: [] }) }),
      evaluation: { request: vi.fn(), status: vi.fn() },
      now: () => now,
    });
    const plain = await (await without.status(new Request("http://127.0.0.1:3000/api/extension/status", { headers: auth }))).json();
    expect(plain).not.toHaveProperty("pageCapture");
  });
});

// A staged item as the repository returns it.
const item = (id: string, overrides: Partial<PageCaptureItemRecord> = {}): PageCaptureItemRecord => ({
  id,
  site: "e2e-results",
  host: "jobs.e2e.invalid",
  externalId: `jobs.e2e.invalid:jobs.e2e.invalid/jobs/${id}`,
  sourceUrl: `https://jobs.e2e.invalid/jobs/${id}`,
  siteJobId: id,
  title: `CSM ${id}`,
  company: null,
  location: null,
  postedText: null,
  resultsPageUrl: "https://jobs.e2e.invalid/search",
  firstSeenAt: new Date("2026-11-02T10:00:00.000Z"),
  lastSeenAt: now,
  sightings: 1,
  lastBatchId: batchId,
  pairingId: pairing.id,
  status: "ACQUIRING",
  attempts: 0,
  lastAttemptAt: now,
  nextAttemptAt: null,
  lastReason: null,
  opportunityId: null,
  handoffOutcome: null,
  handedOffAt: null,
  ...overrides,
});

function acquisitionSetup(options: { items?: PageCaptureItemRecord[]; pages?: Record<string, { status: number; html: string } | "429" | "authwall">; detailSites?: string[]; browser?: boolean; alreadyHandled?: boolean } = {}) {
  const items = options.items ?? [item("a1"), item("b2")];
  const repository = {
    recoverInterrupted: vi.fn(async () => 0),
    sitesWithQueued: vi.fn(async () => ["e2e-results"]),
    siteStoppedUntil: vi.fn(async () => null),
    claimQueued: vi.fn(async () => items),
    markIngested: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    deferSite: vi.fn(async () => undefined),
    markHandedOff: vi.fn(async () => undefined),
    releaseClaimed: vi.fn(async () => 0),
    finalizeProvisionalFailure: vi.fn(async () => true),
  };
  const navigated: string[] = [];
  const pages = options.pages ?? Object.fromEntries(items.map((entry) => [entry.sourceUrl, { status: 200, html: testSiteJobPage({ id: entry.id }) }]));
  const driver: BrowserDriver = {
    async navigate(url) {
      navigated.push(url);
      const page = pages[url];
      if (page === "429") return { status: 429, finalUrl: url, html: "", cookieNames: [] };
      if (page === "authwall") return { status: 200, finalUrl: "https://jobs.e2e.invalid/authwall", html: "<html><body>Sign in</body></html>", cookieNames: [] };
      return { status: page?.status ?? 404, finalUrl: url, html: page?.html ?? "<html></html>", cookieNames: [] };
    },
    close: vi.fn(async () => undefined),
  };
  let counter = 0;
  const ingest = vi.fn(async (): Promise<RetrievedListingResult> => ({ outcome: "CREATED", opportunityId: `0000000${++counter}-0000-4000-8000-000000000000`, sourceRecordId: "s", decision: "NO_MATCH" }));
  const handoff = { alreadyHandled: vi.fn(async () => options.alreadyHandled ?? false), request: vi.fn(async () => "NEEDS_REVIEW") };
  const acquisition = createPageCaptureAcquisition({
    repository,
    ingestion: { ingest },
    handoff,
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => options.detailSites ?? ["e2e-results"],
    ...(options.browser === false ? {} : { browser: { launch: async () => driver } }),
    now: () => now,
    sleep: async () => undefined,
  });
  return { acquisition, repository, navigated, ingest, handoff, driver };
}

describe("automatic detail acquisition", () => {
  it("reads each job's own page with the single-job reader, ingests it as a single-job capture would be, and hands it to the evaluation request once", async () => {
    const { acquisition, repository, navigated, ingest, handoff } = acquisitionSetup();
    const result = await acquisition.runOnce();
    expect(result).toMatchObject({ site: "e2e-results", claimed: 2, ingested: 2, awaitingDetails: 0, stopped: null });
    expect(navigated).toEqual(["https://jobs.e2e.invalid/jobs/a1", "https://jobs.e2e.invalid/jobs/b2"]);
    expect(repository.markIngested).toHaveBeenCalledTimes(2);
    expect(handoff.request).toHaveBeenCalledTimes(2);
    expect(repository.markHandedOff).toHaveBeenCalledWith("a1", "NEEDS_REVIEW", now);

    // The same raw listing a single-job save of that page produces, recorded
    // as read from a results page (provenance only; not a material field).
    const html = testSiteJobPage({ id: "a1" });
    const modeA = buildCaptureEnvelope(runExtractor(html, "https://jobs.e2e.invalid/jobs/a1"), "page", { extensionVersion: "0.2.0", capturedAt: now });
    if (!modeA.ok) throw new Error("expected a capture");
    const context = { pairingId: pairing.id, domain: customerSuccessDiscoveryConfiguration.domain, receivedAt: item("a1").firstSeenAt };
    const expected = capturedListing(modeA.envelope, { ...context, method: "batch" }).raw;
    expect(expected.retrieval?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(capturedListing(modeA.envelope, { ...context, method: "single" }).raw.retrieval?.contentHash).toBe(expected.retrieval?.contentHash);
    const [raw] = ingest.mock.calls[0] as unknown as [typeof expected];
    expect(raw).toMatchObject({ source: "browser-extension", sourceType: "BROWSER_EXTENSION", externalId: expected.externalId, title: expected.title, description: expected.description, discoveredAt: item("a1").firstSeenAt });
    expect(raw.sourceMetadata).toEqual(expected.sourceMetadata);
  });

  it("does not submit a job that already has an evaluation, request, deferral or triage record", async () => {
    const { acquisition, handoff, repository } = acquisitionSetup({ items: [item("a1")], alreadyHandled: true });
    await acquisition.runOnce();
    expect(handoff.request).not.toHaveBeenCalled();
    expect(repository.markHandedOff).toHaveBeenCalledWith("a1", "ALREADY_HANDLED", now);
  });

  it("stops the site at the first rate limit or sign-in wall, with no further request, and waits at least a day", async () => {
    for (const block of ["429", "authwall"] as const) {
      const { acquisition, repository, navigated, ingest } = acquisitionSetup({ pages: { "https://jobs.e2e.invalid/jobs/a1": block } });
      const result = await acquisition.runOnce();
      expect(navigated).toEqual(["https://jobs.e2e.invalid/jobs/a1"]);
      expect(ingest).not.toHaveBeenCalled();
      expect(result?.stopped).toBe(block === "429" ? "RATE_LIMITED" : "ACCESS_STOPPED");
      const [, until] = repository.deferSite.mock.calls[0] as unknown as [string, Date, string];
      expect(until.getTime() - now.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    }
  });

  it("marks a removed job unavailable and an unreadable page for a later attempt, never ingesting either", async () => {
    const { acquisition, repository, ingest } = acquisitionSetup({
      pages: { "https://jobs.e2e.invalid/jobs/a1": { status: 404, html: "<html></html>" }, "https://jobs.e2e.invalid/jobs/b2": { status: 200, html: "<html><body><p>hi</p></body></html>" } },
    });
    const result = await acquisition.runOnce();
    expect(ingest).not.toHaveBeenCalled();
    expect(result).toMatchObject({ unavailable: 1, ingested: 0 });
    expect(repository.markFailed).toHaveBeenCalledWith("a1", expect.objectContaining({ status: "UNAVAILABLE" }));
    expect(repository.markFailed).toHaveBeenCalledWith("b2", expect.objectContaining({ status: "QUEUED", reason: "UNREADABLE" }));
    const { acquisition: last, repository: lastRepository } = acquisitionSetup({
      items: [item("b2", { attempts: 2 })],
      pages: { "https://jobs.e2e.invalid/jobs/b2": { status: 200, html: "<html><body><p>hi</p></body></html>" } },
    });
    await last.runOnce();
    expect(lastRepository.markFailed).toHaveBeenCalledWith("b2", expect.objectContaining({ status: "AWAITING_DETAILS", reason: "UNREADABLE" }));
  });

  it("keeps a failure to its own job: the jobs after an unreadable or removed one are still read and ingested, once each", async () => {
    const items = [item("a1"), item("b2"), item("c3")];
    const { acquisition, repository, navigated, ingest } = acquisitionSetup({
      items,
      pages: {
        "https://jobs.e2e.invalid/jobs/a1": { status: 200, html: "<html><body><p>hi</p></body></html>" },
        "https://jobs.e2e.invalid/jobs/b2": { status: 410, html: "<html></html>" },
        "https://jobs.e2e.invalid/jobs/c3": { status: 200, html: testSiteJobPage({ id: "c3" }) },
      },
    });
    const result = await acquisition.runOnce();
    expect(navigated).toEqual(items.map((entry) => entry.sourceUrl));
    expect(result).toMatchObject({ claimed: 3, ingested: 1, unavailable: 1, stopped: null });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(repository.markIngested).toHaveBeenCalledTimes(1);
    expect(repository.deferSite).not.toHaveBeenCalled();
  });

  it("resumes on its own when a site's wait is over: the jobs left queued are read with no second action", async () => {
    const { acquisition, repository, navigated, ingest } = acquisitionSetup();
    repository.siteStoppedUntil.mockResolvedValueOnce(new Date(now.getTime() + 3_600_000) as never);
    expect(await acquisition.runOnce()).toBeNull();
    expect(navigated).toEqual([]);
    // The next worker pass, after the wait (the repository answers no stop
    // once its time has passed): the same queued jobs are read.
    expect(await acquisition.runOnce()).toMatchObject({ claimed: 2, ingested: 2, stopped: null });
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("fetches nothing for a site without verified detail reading, or when no browser is configured", async () => {
    const disabled = acquisitionSetup({ detailSites: [] });
    expect(await disabled.acquisition.runOnce()).toBeNull();
    expect(disabled.repository.claimQueued).not.toHaveBeenCalled();
    const noBrowser = acquisitionSetup({ browser: false });
    const result = await noBrowser.acquisition.runOnce();
    expect(result).toMatchObject({ awaitingDetails: 2 });
    expect(noBrowser.repository.markFailed).toHaveBeenCalledWith("a1", expect.objectContaining({ status: "AWAITING_DETAILS", reason: "NO_BROWSER" }));
    expect(noBrowser.navigated).toEqual([]);
  });

  it("skips a site that stopped an earlier pass until its wait is over", async () => {
    const { acquisition, repository } = acquisitionSetup();
    repository.siteStoppedUntil.mockResolvedValueOnce(new Date(now.getTime() + 3_600_000) as never);
    expect(await acquisition.runOnce()).toBeNull();
    expect(repository.claimQueued).not.toHaveBeenCalled();
  });

  it("reads a fetched page with the unchanged single-job reader and runs none of the page's scripts", () => {
    const html = testSiteJobPage({ id: "a1" }).replace("</body>", "<script>window.__ran = true</script></body>");
    const document = new JSDOM(html, { url: "https://jobs.e2e.invalid/jobs/a1", runScripts: "outside-only" }).window.document;
    expect(readJobPage(document)).toMatchObject({ extractor: "structured-data", posting: { title: "Customer Success Manager a1" } });
    expect((document.defaultView as unknown as { __ran?: boolean }).__ran).toBeUndefined();
  });
});

describe("the evaluation hand-off", () => {
  it("only asks the existing evaluation request, and treats an existing evaluation, deferral or triage record as handled", async () => {
    const service = {
      requestEvaluation: vi.fn(async () => ({ outcome: "REJECT" })),
      getTriage: vi.fn(async () => null),
      getOpenDeferral: vi.fn(async () => null),
      getLatestEvaluation: vi.fn(async () => {
        throw new EvaluationApiError("EVALUATION_NOT_FOUND", "none", 404);
      }),
    };
    const handoff = evaluationHandoff(service);
    expect(await handoff.alreadyHandled("o")).toBe(false);
    expect(await handoff.request("o")).toBe("REJECT");
    expect(service.requestEvaluation).toHaveBeenCalledWith("o", {});
    service.getTriage.mockResolvedValueOnce({ outcome: "NEEDS_REVIEW" } as never);
    expect(await handoff.alreadyHandled("o")).toBe(true);
    service.getLatestEvaluation.mockResolvedValueOnce({ evaluationId: "e" } as never);
    expect(await handoff.alreadyHandled("o")).toBe(true);
  });
});
