// Mode B (results-page capture) on the isolated test database: a batch is
// staged (no opportunity, record, listing or evaluation), the automatic
// detail acquisition reads each job's page with the unchanged single-job
// reader over a fixture browser (no third-party request) and ingests it
// through the real ingestion, and each new job is handed to the real
// evaluation request with the real pre-evaluator triage: EVALUATE reaches
// admission; NEEDS_REVIEW and REJECT create no evaluator work. Repeats are
// idempotent, a later single-job capture of the same job re-observes the same
// opportunity, and no configured source or listing ledger row is created.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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
import type { BrowserDriver } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, evaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";
import { testSiteJobPage } from "../support/page-capture-pages";

const cleanup = createCleanup();
const clock = { now: new Date("2026-11-03T12:00:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() });
const triageRepository = new PrismaPreEvaluatorTriageRepository();
const triage = createPreEvaluatorTriageService({ repository: triageRepository, now: () => clock.now });
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] }).gate,
  triageGate: triage.gate,
});
const intake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }), now: () => clock.now });
const singleJob = createExtensionCaptureService({
  ingestion,
  lookup: new PrismaExtensionLookupRepository(),
  latestEvaluation: async () => null,
  discovery: customerSuccessDiscoveryConfiguration,
  now: () => clock.now,
});

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
let activeBefore: { userProfileId: string } | null = null;
const itemExternalIds: string[] = [];

// A run-specific suffix keeps these jobs apart from any other test data.
const run = randomUUID().slice(0, 8);
const jobUrl = (name: string) => `https://jobs.e2e.invalid/jobs/${name}-${run}`;
const page = (name: string, salary: string | null) =>
  testSiteJobPage({
    id: `${name}-${run}`,
    title: `Customer Success Manager ${name}`,
    company: `Batch ${name} ${run}`,
    description: [
      "<p>Customer Success Manager for a workflow SaaS platform.</p>",
      "<p>This is a fully remote role. Applicants must reside in the United States.</p>",
      salary ? `<p>Base salary ${salary}.</p>` : "<p>Compensation is not stated.</p>",
      "<p>Own onboarding, adoption, education, and retention for a portfolio of B2B customers.</p>",
    ].join(""),
  });
const pages: Record<string, { status: number; html: string }> = {
  [jobUrl("evaluate")]: { status: 200, html: page("evaluate", "$72,000-$88,000") },
  [jobUrl("review")]: { status: 200, html: page("review", null) },
  [jobUrl("reject")]: { status: 200, html: page("reject", "$45,000-$50,000") },
  [jobUrl("gone")]: { status: 404, html: "<html><body>Not found</body></html>" },
};
const navigated: string[] = [];
const driver: BrowserDriver = {
  async navigate(url) {
    navigated.push(url);
    const served = pages[url] ?? { status: 404, html: "" };
    return { status: served.status, finalUrl: url, html: served.html, cookieNames: [] };
  },
  close: async () => undefined,
};
const acquisition = createPageCaptureAcquisition({
  repository,
  ingestion,
  handoff: evaluationHandoff(evaluation),
  discovery: customerSuccessDiscoveryConfiguration,
  detailSites: () => ["e2e-results"],
  browser: { launch: async () => driver },
  now: () => clock.now,
  sleep: async () => undefined,
});

const batch = (names: string[], batchId = randomUUID()) => ({
  schemaVersion: 1,
  kind: "page-capture",
  batchId,
  site: "e2e-results",
  pageUrl: "https://jobs.e2e.invalid/search",
  pageTitle: "Results",
  capturedAt: clock.now.toISOString(),
  extensionVersion: "0.2.0",
  counts: { loaded: names.length, skippedUnloaded: 0, overCap: 0 },
  cards: names.map((name) => ({ url: jobUrl(name), title: `Customer Success Manager ${name}`, siteJobId: `${name}-${run}`, company: `Batch ${name} ${run}`, location: "Remote" })),
});

async function tableCounts() {
  const [opportunities, sourceRecords, listings, sources, evaluations, tasks, admissions, attempts] = await Promise.all([
    database.opportunity.count(),
    database.sourceRecord.count(),
    database.retrievedListing.count(),
    database.retrievalSource.count(),
    database.evaluation.count(),
    database.evaluationTask.count(),
    database.evaluationAdmission.count(),
    database.semanticOperationAttempt.count(),
  ]);
  return { opportunities, sourceRecords, listings, sources, evaluations, tasks, admissions, attempts };
}

async function stagedItems() {
  return database.pageCaptureItem.findMany({ where: { externalId: { in: itemExternalIds } }, orderBy: { title: "asc" } });
}

async function track(result: { outcomes: Array<{ url: string }> }) {
  for (const outcome of result.outcomes) {
    const item = await database.pageCaptureItem.findFirst({ where: { sourceUrl: outcome.url }, select: { externalId: true, opportunityId: true } });
    if (item && !itemExternalIds.includes(item.externalId)) itemExternalIds.push(item.externalId);
  }
}

beforeEach(async () => {
  await cleanup.before();
  navigated.splice(0);
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup);
  await database.activeUserProfile.upsert({
    where: { domain: "customer-success" },
    create: { domain: "customer-success", userProfileId: profile.id },
    update: { userProfileId: profile.id },
  });
  pairing = await database.extensionPairing.create({ data: { label: "Batch test", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const items = await database.pageCaptureItem.findMany({ where: { externalId: { in: itemExternalIds } }, select: { opportunityId: true } });
  const opportunityIds = [...new Set([...items.map((item) => item.opportunityId).filter((id): id is string => Boolean(id)), ...cleanup.opportunityIds])];
  await database.pageCaptureItem.deleteMany({ where: { externalId: { in: itemExternalIds.splice(0) } } });
  // Capture-history sessions left with none of their jobs (November 5, 2026).
  await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } }, select: { id: true } });
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

describe("Mode B on the test database", () => {
  it("stages a batch without creating any opportunity, record, listing, source or evaluation, and repeats idempotently", async () => {
    const before = await tableCounts();
    const id = randomUUID();
    const first = await intake.capture(batch(["evaluate", "review"], id), pairing);
    await track(first);
    expect(first.counts).toEqual({ queued: 2, seenAgain: 0, alreadySaved: 0, rejected: 0 });
    expect(await tableCounts()).toEqual(before);

    const repeat = await intake.capture(batch(["evaluate", "review"], id), pairing);
    expect(repeat.counts).toMatchObject({ queued: 0, seenAgain: 2 });
    expect((await stagedItems()).map((item) => item.sightings)).toEqual([1, 1]);

    clock.now = new Date(clock.now.getTime() + 60_000);
    await intake.capture(batch(["evaluate"]), pairing);
    const items = await stagedItems();
    expect(items.find((item) => item.title.endsWith("evaluate"))).toMatchObject({ sightings: 2, status: "QUEUED", firstSeenAt: new Date("2026-11-03T12:00:00.000Z") });
    expect(await tableCounts()).toEqual(before);
  });

  it("acquires details automatically, ingests through the normal path and hands each job to the triage-gated evaluation request", async () => {
    const before = await tableCounts();
    const staged = await intake.capture(batch(["evaluate", "review", "reject", "gone"]), pairing);
    await track(staged);
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ site: "e2e-results", claimed: 4, ingested: 3, unavailable: 1, stopped: null });
    expect(navigated.sort()).toEqual([jobUrl("evaluate"), jobUrl("gone"), jobUrl("reject"), jobUrl("review")].sort());

    const items = await stagedItems();
    const byName = (name: string) => items.find((item) => item.title.endsWith(` ${name}`))!;
    expect(byName("gone")).toMatchObject({ status: "UNAVAILABLE", opportunityId: null });
    for (const name of ["evaluate", "review", "reject"]) {
      const item = byName(name);
      expect(item.status, name).toBe("INGESTED");
      const record = await database.sourceRecord.findFirst({ where: { opportunityId: item.opportunityId! } });
      expect(record, name).toMatchObject({ source: "browser-extension", sourceType: "BROWSER_EXTENSION", externalId: item.externalId, retrievalSourceId: null });
      const opportunity = await database.opportunity.findUnique({ where: { id: item.opportunityId! } });
      expect(opportunity?.discoveredAt.toISOString(), name).toBe(item.firstSeenAt.toISOString());
      expect(opportunity?.jobDescription, name).toBeTruthy();
    }
    expect(byName("evaluate")).toMatchObject({ handoffOutcome: "QUEUED" });
    expect(byName("review")).toMatchObject({ handoffOutcome: "NEEDS_REVIEW" });
    expect(byName("reject")).toMatchObject({ handoffOutcome: "REJECT" });
    expect(await triageRepository.get(byName("evaluate").opportunityId!)).toMatchObject({ outcome: "EVALUATE" });
    expect(await triageRepository.get(byName("review").opportunityId!)).toMatchObject({ outcome: "NEEDS_REVIEW", manualDecision: null });
    expect(await triageRepository.get(byName("reject").opportunityId!)).toMatchObject({ outcome: "REJECT" });

    // Only EVALUATE reached admission; nothing reached a provider.
    for (const [name, admissions] of [["evaluate", 1], ["review", 0], ["reject", 0]] as const) {
      const opportunityId = byName(name).opportunityId!;
      expect(await database.evaluationAdmission.count({ where: { opportunityId } }), name).toBe(admissions);
      expect(await database.evaluation.count({ where: { opportunityId } }), name).toBe(admissions);
    }
    const after = await tableCounts();
    expect(after.attempts).toBe(before.attempts);
    expect(after.sources).toBe(before.sources);
    expect(after.listings).toBe(before.listings);
    expect(after.opportunities).toBe(before.opportunities + 3);

    // Nothing is fetched twice, and a job already handed off is not resubmitted.
    navigated.splice(0);
    expect(await acquisition.runOnce()).toBeNull();
    expect(navigated).toEqual([]);

    // The progress list resolves each job to its opportunity and shows its stored triage.
    const listed = await repository.list({ statuses: null, site: "e2e-results", page: 1, pageSize: 50 });
    const review = listed.rows.find((row) => row.id === byName("review").id)!;
    expect(review).toMatchObject({ resolvedOpportunityId: byName("review").opportunityId, triageOutcome: "NEEDS_REVIEW", evaluationStatus: null });
  });

  it("lets a later single-job capture of a batch job re-observe the same opportunity, and marks a job already saved at intake", async () => {
    const staged = await intake.capture(batch(["evaluate"]), pairing);
    await track(staged);
    await acquisition.runOnce();
    const [item] = await stagedItems();
    // The item is replaced below by one that resolves this opportunity only
    // at read time, so register it for cleanup now.
    cleanup.opportunityIds.push(item!.opportunityId!);
    const before = await tableCounts();
    const modeA = await singleJob.capture(
      {
        schemaVersion: extensionCaptureSchemaVersion,
        pageUrl: jobUrl("evaluate"),
        extractor: "structured-data",
        capturedAt: clock.now.toISOString(),
        extensionVersion: "0.2.0",
        fields: {
          title: "Customer Success Manager evaluate",
          company: `Batch evaluate ${run}`,
          description:
            "Customer Success Manager for a workflow SaaS platform.\n\nThis is a fully remote role. Applicants must reside in the United States.\n\nBase salary $72,000-$88,000.\n\nOwn onboarding, adoption, education, and retention for a portfolio of B2B customers.",
        },
      },
      { ...pairing, tokenHint: "test" },
    );
    expect(modeA.result.opportunityId).toBe(item!.opportunityId);
    expect(["UNCHANGED", "CHANGED"]).toContain(modeA.result.outcome);
    expect((await tableCounts()).opportunities).toBe(before.opportunities);
    // The staged item is never modified by the single-job capture.
    expect((await stagedItems())[0]).toMatchObject({ status: "INGESTED", opportunityId: item!.opportunityId, sightings: 1 });

    // A batch seeing a job that is already in the app does not queue it.
    await database.pageCaptureItem.deleteMany({ where: { id: item!.id } });
    const again = await intake.capture(batch(["evaluate"]), pairing);
    expect(again.counts).toMatchObject({ alreadySaved: 1, queued: 0 });
    expect(again.outcomes[0]).toMatchObject({ outcome: "ALREADY_SAVED", opportunityId: item!.opportunityId });
    const resaved = (await stagedItems())[0]!;
    expect(resaved).toMatchObject({ status: "ALREADY_SAVED", opportunityId: null });
    expect((await repository.list({ statuses: ["ALREADY_SAVED"], site: "e2e-results", page: 1, pageSize: 50 })).rows.find((row) => row.id === resaved.id)).toMatchObject({
      resolvedOpportunityId: item!.opportunityId,
    });
  });

  it("supports retry, dismiss and restore only from the states that allow them", async () => {
    const staged = await createPageCaptureService({ repository, enabledSites: () => ({ cards: ["e2e-results"], details: [] }), now: () => clock.now }).capture(batch(["review"]), pairing);
    await track(staged);
    const [waiting] = await stagedItems();
    expect(waiting).toMatchObject({ status: "AWAITING_DETAILS", lastReason: "NOT_SUPPORTED" });
    expect(await repository.dismiss(waiting!.id)).toMatchObject({ status: "DISMISSED" });
    expect(await repository.retry(waiting!.id)).toBeNull();
    expect(await repository.restore(waiting!.id)).toMatchObject({ status: "AWAITING_DETAILS" });
    expect(await repository.retry(waiting!.id)).toMatchObject({ status: "QUEUED", attempts: 0 });
  });
});
