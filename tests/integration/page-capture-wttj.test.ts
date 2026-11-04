// Welcome to the Jungle / Otta Mode B with background-tab detail reading
// (P2), end to end on the isolated test database. The real F0 result cards
// are read by the results reader and staged by the production intake (the
// site enabled by the explicit acceptance setting, as for its live
// acceptance); the extension's real tab orchestrator then reads each job's
// page in a fake Chrome (synthetic job pages, no network) with the unchanged
// single-job reader and reports to the real server tab service, which checks
// the page is the staged job, ingests it through the shared capture path
// (the same one the LinkedIn worker uses) and hands it to the real
// triage-gated evaluation request. Also: an access restriction stops the
// batch and the site for a day and nothing resumes it; an identity mismatch
// stops the batch; interruptions, the user's Stop and staleness leave the
// jobs awaiting details; repeats are idempotent; the worker never fetches
// the site; no configured source or listing ledger row is created.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRetrievalIngestionService, extensionCaptureSchemaVersion } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaExtensionLookupRepository,
  PrismaManualOpportunityRepository,
  PrismaPageCaptureRepository,
  PrismaPreEvaluatorTriageRepository,
} from "@ai-career/database";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import type { ApiResult } from "../../apps/extension/src/api";
import { buildPageCaptureBatch } from "../../apps/extension/src/page-capture-view";
import { createTabAcquisition } from "../../apps/extension/src/tab-acquisition";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { capturedPageIdentity, createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService, enabledSitesFromEnvironment } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, createPageCaptureIngestor, evaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { pageCaptureProgress } from "../../apps/web/src/server/page-capture-progress";
import { createPageCaptureTabService, PageCaptureTabError } from "../../apps/web/src/server/page-capture-tabs";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";
import { runResultsReader } from "../support/page-capture-pages";
import { csmDescription, fakeTabEnvironment, wttjF0, wttjF0ResultsPage, wttjF0Urls, wttjJobPage, wttjRunSettings, type ServedPage } from "../support/wttj-tab-pages";

const acceptance = () => enabledSitesFromEnvironment({ PAGE_CAPTURE_ACCEPTANCE_SITES: "welcome-to-the-jungle" });
const externalIds = wttjF0Urls.map((url) => capturedPageIdentity(url).externalId!);
const companies = ["FourKites", "CADDi", "Culture Amp", "Box", "MongoDB"];
const salaries = ["$72,000-$88,000", null, "$45,000-$50,000", "$72,000-$88,000", "$72,000-$88,000"];
const day = 24 * 60 * 60 * 1000;

const cleanup = createCleanup();
const clock = { now: new Date("2026-11-04T12:00:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() });
const triageRepository = new PrismaPreEvaluatorTriageRepository();
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] }).gate,
  triageGate: createPreEvaluatorTriageService({ repository: triageRepository, now: () => clock.now }).gate,
});
const intake = createPageCaptureService({ repository, enabledSites: acceptance, now: () => clock.now });
const tabService = createPageCaptureTabService({
  repository,
  ingestor: createPageCaptureIngestor({ repository, ingestion, handoff: evaluationHandoff(evaluation), discovery: customerSuccessDiscoveryConfiguration, now: () => clock.now }),
  enabledSites: acceptance,
  now: () => clock.now,
});
const singleJob = createExtensionCaptureService({
  ingestion,
  lookup: new PrismaExtensionLookupRepository(),
  latestEvaluation: async () => null,
  discovery: customerSuccessDiscoveryConfiguration,
  now: () => clock.now,
});

// The extension's client, wired straight to the server's tab service.
async function call<T>(run: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { ok: true, status: 200, body: await run() };
  } catch (error) {
    if (error instanceof PageCaptureTabError) return { ok: false, status: 400, code: error.code, error: error.message };
    throw error;
  }
}
const api = {
  pageCaptureTabStart: (id: string) => call(() => tabService.start(id)),
  pageCaptureTabDetails: (id: string, body: unknown) => call(() => tabService.details(id, body)),
  pageCaptureTabResult: (id: string, body: unknown) => call(() => tabService.result(id, body)),
  pageCaptureTabStop: (body: unknown) => call(() => tabService.stop(body)),
};

const jobPageFor = (url: string): ServedPage => {
  const index = wttjF0Urls.indexOf(url as (typeof wttjF0Urls)[number]);
  if (index < 0) return { status: 404, html: "<h1>Not found</h1>" };
  return { status: 200, html: wttjJobPage({ title: "Senior Customer Success Manager", company: companies[index]!, city: "Chicago", descriptionHtml: csmDescription(salaries[index]!) }) };
};

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
let activeBefore: { userProfileId: string } | null = null;

function savedBatch(kept = [true, true, true, true, true], batchId = randomUUID()) {
  const reading = runResultsReader(wttjF0ResultsPage(), wttjF0.page, "welcome-to-the-jungle");
  const built = buildPageCaptureBatch(reading, kept, { site: "welcome-to-the-jungle", batchId, extensionVersion: "0.2.0", capturedAt: clock.now });
  if (!built.ok) throw new Error(built.problem);
  return built.batch;
}

// "Save selected jobs": the intake, then the extension's background-tab run.
async function saveAndRead(serve: (url: string) => ServedPage = jobPageFor, setup?: (fake: ReturnType<typeof fakeTabEnvironment>, acquisition: ReturnType<typeof createTabAcquisition>) => void, kept?: boolean[]) {
  const staged = await intake.capture(savedBatch(kept), pairing);
  const fake = fakeTabEnvironment({ serve, api: api as never });
  const acquisition = createTabAcquisition(fake.environment);
  setup?.(fake, acquisition);
  if (staged.acquisition?.items.length) {
    await acquisition.enqueue({ ...wttjRunSettings, items: staged.acquisition.items });
    await acquisition.resume();
  }
  return { staged, fake, state: fake.stored() };
}

async function tableCounts() {
  const [opportunities, sources, listings, attempts] = await Promise.all([
    database.opportunity.count(),
    database.retrievalSource.count(),
    database.retrievedListing.count(),
    database.semanticOperationAttempt.count(),
  ]);
  return { opportunities, sources, listings, attempts };
}

const items = async () => {
  const rows = await database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } } });
  return externalIds.map((externalId) => rows.find((row) => row.externalId === externalId)!);
};

beforeEach(async () => {
  // The real F0 jobs: refuse to run over any existing data for them.
  const existing = await database.sourceRecord.count({ where: { externalId: { in: externalIds } } });
  const staged = await database.pageCaptureItem.count({ where: { externalId: { in: externalIds } } });
  expect({ existing, staged }, "the test database already holds these Welcome to the Jungle jobs").toEqual({ existing: 0, staged: 0 });
  await cleanup.before();
  clock.now = new Date("2026-11-04T12:00:00.000Z");
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup);
  await database.activeUserProfile.upsert({
    where: { domain: "customer-success" },
    create: { domain: "customer-success", userProfileId: profile.id },
    update: { userProfileId: profile.id },
  });
  pairing = await database.extensionPairing.create({ data: { label: "WTTJ batch test", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const staged = await database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } } });
  const opportunityIds = [...new Set([...staged.map((item) => item.opportunityId).filter((id): id is string => Boolean(id)), ...cleanup.opportunityIds])];
  const records = await database.sourceRecord.findMany({ where: { externalId: { in: externalIds } }, select: { opportunityId: true } });
  for (const record of records) if (record.opportunityId && !opportunityIds.includes(record.opportunityId)) opportunityIds.push(record.opportunityId);
  await database.pageCaptureItem.deleteMany({ where: { externalId: { in: externalIds } } });
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { OR: [{ opportunityId: { in: opportunityIds } }, { externalId: { in: externalIds } }], laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  if (activeBefore) {
    await database.activeUserProfile.upsert({
      where: { domain: "customer-success" },
      create: { domain: "customer-success", userProfileId: activeBefore.userProfileId },
      update: { userProfileId: activeBefore.userProfileId },
    });
  }
  await cleanup.after();
  if (!activeBefore) await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
});

afterAll(() => database.$disconnect());

describe("Welcome to the Jungle Mode B (background tabs) on the test database", () => {
  it("saves the real F0 cards and, with no second action, reads each job's page in a background tab, ingests it like a single-job capture and hands it to the existing triage", async () => {
    const before = await tableCounts();
    const { staged, fake, state } = await saveAndRead();
    expect(staged).toMatchObject({ site: { key: "welcome-to-the-jungle", automaticDetails: true }, counts: { queued: 5, rejected: 0 } });
    expect(state?.finished?.reason).toBe("COMPLETED");
    expect(fake.log.opened.map((tab) => tab.url)).toEqual([...wttjF0Urls]);
    for (let index = 1; index < fake.log.opened.length; index += 1) expect(fake.log.opened[index]!.at - fake.log.opened[index - 1]!.at).toBeGreaterThanOrEqual(12_000);
    expect(fake.log.closed).toEqual(fake.log.opened.map((tab) => tab.tabId));

    for (const [index, item] of (await items()).entries()) {
      expect(item, wttjF0Urls[index]).toMatchObject({ status: "INGESTED", sourceUrl: wttjF0Urls[index] });
      expect(item.handoffOutcome, wttjF0Urls[index]).toMatch(/^(QUEUED|NEEDS_REVIEW|REJECT)$/);
      const record = await database.sourceRecord.findFirst({ where: { opportunityId: item.opportunityId! } });
      expect(record).toMatchObject({ source: "browser-extension", sourceType: "BROWSER_EXTENSION", externalId: externalIds[index], retrievalSourceId: null });
      const opportunity = await database.opportunity.findUnique({ where: { id: item.opportunityId! }, include: { company: true } });
      expect(opportunity?.discoveredAt.toISOString()).toBe(item.firstSeenAt.toISOString());
      // Facts from the job's own page, never the card's tagline or tags.
      expect(opportunity?.jobDescription).toContain("own onboarding, adoption, renewals and expansion");
      expect(opportunity?.jobDescription).not.toMatch(/orchestration and visibility platform|employees/);
      expect(opportunity?.company?.name).toBe(companies[index]);
      expect(opportunity?.location).toMatch(/Chicago/);
      // Only an Evaluate outcome reaches admission.
      expect(await database.evaluationAdmission.count({ where: { opportunityId: item.opportunityId! } })).toBe(item.handoffOutcome === "QUEUED" ? 1 : 0);
    }
    // The existing triage decides: in range (Evaluate), no salary stated
    // (Needs Review), below the floor (Reject).
    expect((await items()).map((item) => item.handoffOutcome)).toEqual(["QUEUED", "NEEDS_REVIEW", "REJECT", "QUEUED", "QUEUED"]);
    const reviewed = (await items())[1]!;
    expect(await triageRepository.get(reviewed.opportunityId!)).toMatchObject({ manualDecision: null });
    expect(await tableCounts()).toEqual({ ...before, opportunities: before.opportunities + 5 });

    // Saving the same page again reads nothing again.
    const again = await saveAndRead();
    expect(again.staged.acquisition?.items).toEqual([]);
    expect(again.fake.log.opened).toEqual([]);

    // A later single-job capture of a batch job re-observes the same opportunity.
    const first = (await items())[0]!;
    const modeA = await singleJob.capture(
      {
        schemaVersion: extensionCaptureSchemaVersion,
        pageUrl: `${wttjF0Urls[0]}?utm_source=newsletter`,
        extractor: "structured-data",
        capturedAt: clock.now.toISOString(),
        extensionVersion: "0.2.0",
        fields: { title: "Senior Customer Success Manager", company: "FourKites", location: "Chicago", description: "As a Customer Success Manager you own onboarding." },
      },
      { ...pairing, tokenHint: "test" },
    );
    expect(modeA.result.opportunityId).toBe(first.opportunityId);
    expect((await tableCounts()).opportunities).toBe(before.opportunities + 5);
  });

  it("stops the batch and the site for at least a day on an access restriction, and nothing resumes it when the wait ends", async () => {
    const before = await tableCounts();
    const { fake, state } = await saveAndRead((url) => (url === wttjF0Urls[1] ? { status: 403, html: "<h1>Forbidden</h1>" } : jobPageFor(url)));
    expect(state?.finished?.reason).toBe("BLOCKED");
    expect(fake.log.opened.map((tab) => tab.url)).toEqual([wttjF0Urls[0], wttjF0Urls[1]]);
    const after = await items();
    expect(after[0]).toMatchObject({ status: "INGESTED" });
    for (const item of after.slice(1)) {
      expect(item).toMatchObject({ status: "AWAITING_DETAILS", lastReason: "ACCESS_STOPPED", opportunityId: null });
      expect(item.nextAttemptAt!.getTime() - clock.now.getTime()).toBeGreaterThanOrEqual(day);
    }
    const stoppedUntil = await repository.siteStoppedUntil("welcome-to-the-jungle", clock.now);
    expect(stoppedUntil!.getTime() - clock.now.getTime()).toBe(day);
    expect(await tableCounts()).toEqual({ ...before, opportunities: before.opportunities + 1 });

    // A repeated report keeps the same stop.
    await tabService.result(after[1]!.id, { result: "BLOCKED", signal: "HTTP_403", finalUrl: wttjF0Urls[1], remainingItemIds: [] });
    expect((await repository.siteStoppedUntil("welcome-to-the-jungle", clock.now))!.toISOString()).toBe(stoppedUntil!.toISOString());

    // A new save while stopped opens nothing.
    clock.now = new Date(clock.now.getTime() + 60 * 60 * 1000);
    const during = await saveAndRead();
    expect(during.staged.acquisition).toMatchObject({ items: [], stoppedUntil: stoppedUntil!.toISOString() });
    expect(during.fake.log.opened).toEqual([]);

    // The wait ends: nothing is resumed, by the worker or otherwise.
    clock.now = new Date(clock.now.getTime() + day);
    const worker = createPageCaptureAcquisition({
      repository,
      ingestion,
      handoff: evaluationHandoff(evaluation),
      discovery: customerSuccessDiscoveryConfiguration,
      detailSites: () => acceptance().details,
      browser: { launch: async () => { throw new Error("the worker must not open a browser for this site"); } },
      now: () => clock.now,
    });
    expect(await worker.runOnce()).toBeNull();
    await pageCaptureProgress({ filter: "all", site: null, page: 1 }, repository, () => clock.now);
    expect((await items()).slice(1).every((item) => item.status === "AWAITING_DETAILS" && item.lastReason === "ACCESS_STOPPED")).toBe(true);

    // Only Alex's next save reads them again.
    const resumed = await saveAndRead();
    expect(resumed.staged.acquisition?.items.map((item) => item.url)).toEqual(wttjF0Urls.slice(1));
    expect(resumed.state?.finished?.reason).toBe("COMPLETED");
    expect((await items()).every((item) => item.status === "INGESTED")).toBe(true);
  });

  it("stops the batch when a page that opens is not the staged job, recording it", async () => {
    const before = await tableCounts();
    const { state, fake } = await saveAndRead((url) => (url === wttjF0Urls[1] ? { ...jobPageFor(wttjF0Urls[4]), finalUrl: wttjF0Urls[4] } : jobPageFor(url)));
    expect(state?.finished?.reason).toBe("IDENTITY_MISMATCH");
    expect(fake.log.opened).toHaveLength(2);
    const after = await items();
    expect(after.map((item) => [item.status, item.lastReason])).toEqual([
      ["INGESTED", null],
      ["AWAITING_DETAILS", "IDENTITY_MISMATCH"],
      ["AWAITING_DETAILS", "BATCH_STOPPED"],
      ["AWAITING_DETAILS", "BATCH_STOPPED"],
      ["AWAITING_DETAILS", "BATCH_STOPPED"],
    ]);
    expect(await tableCounts()).toEqual({ ...before, opportunities: before.opportunities + 1 });
    // A mismatch is not an access restriction: the site is not stopped.
    expect(await repository.siteStoppedUntil("welcome-to-the-jungle", clock.now)).toBeNull();
  });

  it("keeps an interrupted job, a gone job and the jobs after the user's Stop awaiting details, never reopening them", async () => {
    const { state, fake } = await saveAndRead(
      (url) => (url === wttjF0Urls[1] ? { status: 404, html: "<h1>Not found</h1>" } : jobPageFor(url)),
      (run, acquisition) => {
        run.hooks.afterOpen = (tabId) => {
          if (run.log.opened.length === 1) run.userCloses(tabId);
          if (run.log.opened.length === 3) void acquisition.stop();
        };
      },
    );
    expect(state?.finished?.reason).toBe("USER_STOPPED");
    expect(fake.log.opened).toHaveLength(3);
    expect((await items()).map((item) => [item.status, item.lastReason])).toEqual([
      ["AWAITING_DETAILS", "INTERRUPTED"],
      ["UNAVAILABLE", "NOT_INGESTED"],
      ["INGESTED", null],
      ["AWAITING_DETAILS", "USER_STOPPED"],
      ["AWAITING_DETAILS", "USER_STOPPED"],
    ]);
  });

  it("marks jobs whose reading stopped with the browser as interrupted, and the reports are idempotent", async () => {
    // Saved, but the browser closed before any job was read.
    await intake.capture(savedBatch(), pairing);
    clock.now = new Date(clock.now.getTime() + 61 * 60 * 1000);
    const progress = await pageCaptureProgress({ filter: "waiting", site: "welcome-to-the-jungle", page: 1 }, repository, () => clock.now);
    expect(progress.rows.map((row) => [row.status, row.lastReason, row.retryable])).toEqual(Array(5).fill(["AWAITING_DETAILS", "INTERRUPTED", false]));
    // A late report for a job no longer queued changes nothing.
    const [first] = await items();
    const capture = {
      schemaVersion: extensionCaptureSchemaVersion,
      pageUrl: wttjF0Urls[0],
      extractor: "structured-data",
      capturedAt: clock.now.toISOString(),
      extensionVersion: "0.2.0",
      fields: { title: "Senior Customer Success Manager", company: "FourKites", location: "Chicago", description: "As a Customer Success Manager you own onboarding, adoption, renewals and expansion." },
    };
    expect(await tabService.details(first!.id, { capture, remainingItemIds: [] })).toMatchObject({ outcome: "SKIPPED", stopBatch: false });
    expect(await tabService.start(first!.id)).toMatchObject({ proceed: false, status: "AWAITING_DETAILS", reason: "INTERRUPTED" });

    // Saving again reads them; a repeated details report is not ingested twice.
    const again = await intake.capture(savedBatch(), pairing);
    expect(again.acquisition?.items).toHaveLength(5);
    const before = await tableCounts();
    expect(await tabService.details(first!.id, { capture, remainingItemIds: [] })).toMatchObject({ outcome: "INGESTED" });
    expect(await tabService.details(first!.id, { capture, remainingItemIds: [] })).toMatchObject({ outcome: "ALREADY_INGESTED" });
    expect((await tableCounts()).opportunities).toBe(before.opportunities + 1);
  });
});
