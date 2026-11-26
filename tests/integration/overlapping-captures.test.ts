// Overlapping captures on the isolated test database (November 5, 2026):
// - batch A saves 10 jobs and batch B saves 10 jobs, 3 of them in A too:
//   the app holds 17 opportunities, not 20; each job's page is read once;
//   B reports the 3 as already saved (not "in progress"), and both captures
//   stay listed with their own jobs: a later capture never removes a job from
//   an earlier one;
// - a job saved alone (Single Job) and then on a results page (Batch
//   Capture), or the other way round, is one opportunity and one Captured
//   Jobs row, with both capture methods recorded.
// The detail pages come from a fixture browser: no site is contacted.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createRetrievalIngestionService, extensionCaptureSchemaVersion, pageReaderRevision } from "@ai-career/core";
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
import { capturedJobs, extensionCaptureSession, extensionCaptureSessions } from "../../apps/web/src/server/page-capture-progress";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";
import { testSiteJobPage } from "../support/page-capture-pages";

const cleanup = createCleanup();
const clock = { now: new Date("2026-11-05T09:00:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() });
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] }).gate,
  triageGate: createPreEvaluatorTriageService({ repository: new PrismaPreEvaluatorTriageRepository(), now: () => clock.now }).gate,
});
const intake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }), now: () => clock.now });
const singleJob = createExtensionCaptureService({
  ingestion,
  lookup: new PrismaExtensionLookupRepository(),
  latestEvaluation: async () => null,
  discovery: customerSuccessDiscoveryConfiguration,
  now: () => clock.now,
});

// A run-specific suffix keeps these jobs apart from any other test data. Each
// job has its own company, so no two of them are probable duplicates.
const run = randomUUID().slice(0, 8);
const jobUrl = (name: string) => `https://jobs.e2e.invalid/jobs/${name}-${run}`;
const title = (name: string) => `Customer Success Manager ${name}`;
const company = (name: string) => `Overlap ${name} ${run}`;
// Salary not stated: the triage holds each job for review, so nothing is
// admitted and nothing can reach a provider.
const descriptionHtml = [
  "<p>Customer Success Manager for a workflow SaaS platform.</p>",
  "<p>This is a fully remote role. Applicants must reside in the United States.</p>",
  "<p>Own onboarding, adoption, education, and retention for a portfolio of B2B customers.</p>",
].join("");
const navigated: string[] = [];
const driver: BrowserDriver = {
  async navigate(url) {
    navigated.push(url);
    const name = url.slice("https://jobs.e2e.invalid/jobs/".length, -(run.length + 1));
    return { status: 200, finalUrl: url, html: testSiteJobPage({ id: `${name}-${run}`, title: title(name), company: company(name), description: descriptionHtml }), cookieNames: [] };
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
  extensionVersion: "0.3.0",
  counts: { loaded: names.length, skippedUnloaded: 0, overCap: 0 },
  cards: names.map((name) => ({ url: jobUrl(name), title: title(name), siteJobId: `${name}-${run}`, company: company(name), location: "Remote" })),
});

const singleCapture = (name: string) => ({
  schemaVersion: extensionCaptureSchemaVersion,
  pageUrl: jobUrl(name),
  extractor: "structured-data",
  capturedAt: clock.now.toISOString(),
  extensionVersion: "0.3.0",
  // The current companion's reader (a record without one is re-read).
  readerRevision: pageReaderRevision,
  fields: {
    title: title(name),
    company: company(name),
    description:
      "Customer Success Manager for a workflow SaaS platform.\n\nThis is a fully remote role. Applicants must reside in the United States.\n\nOwn onboarding, adoption, education, and retention for a portfolio of B2B customers.",
  },
});

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
let activeBefore: { userProfileId: string } | null = null;
const names = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
const allNames = [...names("a", 10), ...names("b", 7), ...names("s", 4)];
const ourExternalIds = new Set<string>();
const sessionIds: string[] = [];

async function opportunityCount() {
  return database.opportunity.count();
}

async function ourItems() {
  return database.pageCaptureItem.findMany({ where: { sourceUrl: { in: allNames.map(jobUrl) } } });
}

async function remember() {
  for (const item of await ourItems()) ourExternalIds.add(item.externalId);
  const records = await database.sourceRecord.findMany({ where: { source: "browser-extension", sourceUrl: { in: allNames.map(jobUrl) } }, select: { externalId: true } });
  for (const record of records) if (record.externalId) ourExternalIds.add(record.externalId);
}

const ourRows = (rows: Array<{ sourceUrl: string }>) => rows.filter((row) => allNames.some((name) => row.sourceUrl === jobUrl(name)));

beforeEach(async () => {
  await cleanup.before();
  navigated.splice(0);
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup);
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: profile.id }, update: { userProfileId: profile.id } });
  pairing = await database.extensionPairing.create({ data: { label: "Overlap test", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  await remember();
  const externalIds = [...ourExternalIds];
  const items = await database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } }, select: { opportunityId: true } });
  const records = await database.sourceRecord.findMany({ where: { source: "browser-extension", externalId: { in: externalIds } }, select: { opportunityId: true } });
  const opportunityIds = [
    ...new Set([...items.map((item) => item.opportunityId), ...records.map((record) => record.opportunityId), ...cleanup.opportunityIds].filter((id): id is string => Boolean(id))),
  ];
  await database.pageCaptureItem.deleteMany({ where: { externalId: { in: externalIds } } });
  await database.pageCaptureSession.deleteMany({ where: { id: { in: sessionIds.splice(0) } } });
  await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  if (activeBefore) {
    await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: activeBefore.userProfileId }, update: { userProfileId: activeBefore.userProfileId } });
  }
  await cleanup.after();
  if (!activeBefore) await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
  ourExternalIds.clear();
  clock.now = new Date("2026-11-05T09:00:00.000Z");
});

afterAll(() => database.$disconnect());

describe("overlapping captures on the test database", () => {
  it("keeps two overlapping batches (10 + 10, 3 shared) as 17 jobs, both captures intact, the second reporting the 3 already saved", async () => {
    const before = await opportunityCount();
    const aNames = names("a", 10);
    const bNames = [...aNames.slice(7), ...names("b", 7)];
    expect(bNames).toHaveLength(10);

    const batchA = await intake.capture(batch(aNames), pairing);
    sessionIds.push(batchA.sessionId!);
    await remember();
    expect(batchA.counts).toEqual({ queued: 10, seenAgain: 0, alreadySaved: 0, refreshing: 0, rejected: 0 });
    expect(await acquisition.runOnce()).toMatchObject({ claimed: 10, ingested: 10 });
    expect(await opportunityCount()).toBe(before + 10);

    clock.now = new Date(clock.now.getTime() + 30 * 60_000);
    navigated.splice(0);
    const batchB = await intake.capture(batch(bNames), pairing);
    sessionIds.push(batchB.sessionId!);
    await remember();
    // The 3 shared jobs are reported as already saved, with their opportunity.
    expect(batchB.counts).toEqual({ queued: 7, seenAgain: 0, alreadySaved: 3, refreshing: 0, rejected: 0 });
    const shared = batchB.outcomes.filter((outcome) => outcome.outcome === "ALREADY_SAVED");
    expect(shared.map((outcome) => outcome.url).sort()).toEqual(aNames.slice(7).map(jobUrl).sort());
    expect(shared.every((outcome) => outcome.opportunityId)).toBe(true);
    expect(await acquisition.runOnce()).toMatchObject({ claimed: 7, ingested: 7 });
    // Only B's new jobs were read; the shared ones were not read again.
    expect(navigated.sort()).toEqual(names("b", 7).map(jobUrl).sort());

    // 17 opportunities, 17 staged jobs, one browser-extension record per job.
    expect(await opportunityCount()).toBe(before + 17);
    const items = await ourItems();
    expect(items).toHaveLength(17);
    expect(new Set(items.map((item) => item.opportunityId)).size).toBe(17);
    expect(items.every((item) => item.status === "INGESTED")).toBe(true);
    const sharedItems = items.filter((item) => aNames.slice(7).map(jobUrl).includes(item.sourceUrl));
    expect(sharedItems.every((item) => item.sightings === 2 && item.firstSeenAt.toISOString() === "2026-11-05T09:00:00.000Z")).toBe(true);

    // Both captures stay listed with their own 10 jobs; the later one never
    // takes a job out of the earlier one.
    const sessionA = await database.pageCaptureSession.findUniqueOrThrow({ where: { id: batchA.sessionId! } });
    const sessionB = await database.pageCaptureSession.findUniqueOrThrow({ where: { id: batchB.sessionId! } });
    expect(sessionA.itemIds).toHaveLength(10);
    expect(sessionB.itemIds).toHaveLength(10);
    expect(sessionA.itemIds.filter((id) => sessionB.itemIds.includes(id))).toHaveLength(3);
    expect(sessionB.counts).toMatchObject({ alreadySaved: 3, seenAgain: 0, staged: 10 });

    const history = await extensionCaptureSessions(25, repository, () => clock.now);
    const listed = history.sessions.filter((session) => [batchA.sessionId, batchB.sessionId].includes(session.id));
    expect(listed.map((session) => session.id)).toEqual([batchB.sessionId, batchA.sessionId]);
    expect(listed[0]).toMatchObject({ jobs: 10, added: 10, alreadySaved: 3, inProgress: false });
    expect(listed[1]).toMatchObject({ jobs: 10, added: 10, alreadySaved: 0, inProgress: false });

    // Each capture's own view: A in A's page order, nothing saved before it;
    // B marks exactly the 3 jobs A had already saved.
    const viewA = await extensionCaptureSession(batchA.sessionId!, repository, () => clock.now);
    expect(viewA!.jobs.map((job) => job.title)).toEqual(aNames.map(title));
    expect(viewA!.jobs.some((job) => job.savedBefore)).toBe(false);
    const viewB = await extensionCaptureSession(batchB.sessionId!, repository, () => clock.now);
    expect(viewB!.jobs.map((job) => job.title)).toEqual(bNames.map(title));
    expect(viewB!.jobs.filter((job) => job.savedBefore).map((job) => job.title)).toEqual(aNames.slice(7).map(title));
    expect(viewB!.jobs.every((job) => job.opportunityPath)).toBe(true);
    const webB = await capturedJobs({ method: "all", filter: "all", site: null, sessionId: batchB.sessionId!, page: 1 }, repository, () => clock.now);
    expect(webB.rows.filter((row) => row.savedBefore).map((row) => row.sourceUrl)).toEqual(aNames.slice(7).map(jobUrl));

    // Captured Jobs: one row per job, 17 rows.
    const all = await capturedJobs({ method: "all", filter: "all", site: "e2e-results", sessionId: null, page: 1 }, repository, () => clock.now);
    const rows = ourRows(all.rows);
    expect(rows).toHaveLength(17);
    expect(new Set(rows.map((row) => row.sourceUrl)).size).toBe(17);
    expect(rows.every((row) => row.method === "batch" && !row.alsoSingle)).toBe(true);

    // Saving B again (the same batch) changes nothing.
    const repeat = await intake.capture(batch(bNames, batchB.sessionId!), pairing);
    expect(repeat.counts).toEqual({ queued: 0, seenAgain: 0, alreadySaved: 10, refreshing: 0, rejected: 0 });
    expect(await opportunityCount()).toBe(before + 17);
    expect(await database.pageCaptureSession.count({ where: { id: { in: [batchA.sessionId!, batchB.sessionId!] } } })).toBe(2);
  });

  it("keeps a job saved as a single job and then on a results page (and the other way round) as one job and one row, with both methods recorded", async () => {
    const before = await opportunityCount();
    // Single first, then a batch showing it and another job.
    const single = await singleJob.capture(singleCapture("s0"), pairing);
    cleanup.opportunityIds.push(single.result.opportunityId);
    clock.now = new Date(clock.now.getTime() + 60_000);
    const saved = await intake.capture(batch(["s0", "s1"]), pairing);
    sessionIds.push(saved.sessionId!);
    await remember();
    expect(saved.counts).toEqual({ queued: 1, seenAgain: 0, alreadySaved: 1, refreshing: 0, rejected: 0 });
    expect(saved.outcomes.find((outcome) => outcome.url === jobUrl("s0"))).toMatchObject({ outcome: "ALREADY_SAVED", opportunityId: single.result.opportunityId });
    await acquisition.runOnce();
    // The single-saved job's page was not read again.
    expect(navigated).toEqual([jobUrl("s1")]);

    // Batch first, then the same job alone.
    clock.now = new Date(clock.now.getTime() + 60_000);
    const second = await intake.capture(batch(["s2"]), pairing);
    sessionIds.push(second.sessionId!);
    await remember();
    await acquisition.runOnce();
    const s2 = (await ourItems()).find((item) => item.sourceUrl === jobUrl("s2"))!;
    expect(s2).toMatchObject({ status: "INGESTED" });
    clock.now = new Date(clock.now.getTime() + 60_000);
    const alone = await singleJob.capture(singleCapture("s2"), pairing);
    expect(alone.result.opportunityId).toBe(s2.opportunityId);
    expect(["UNCHANGED", "CHANGED"]).toContain(alone.result.outcome);

    // 3 jobs, 3 opportunities.
    expect(await opportunityCount()).toBe(before + 3);
    // Provenance: the single-job saves and the results-page read are recorded as such.
    const records = await database.sourceRecord.findMany({ where: { source: "browser-extension", sourceUrl: { in: ["s0", "s1", "s2"].map(jobUrl) } }, orderBy: { createdAt: "asc" } });
    const method = (name: string) => records.filter((record) => record.sourceUrl === jobUrl(name)).map((record) => (record.sourceMetadata as { capture?: { method?: string } }).capture?.method);
    expect(method("s0")).toEqual(["single"]);
    expect(method("s1")).toEqual(["batch"]);
    expect(method("s2")).toEqual(["batch", "single"]);

    const all = await capturedJobs({ method: "all", filter: "all", site: null, sessionId: null, page: 1 }, repository, () => clock.now);
    const rows = ourRows(all.rows);
    expect(rows.map((row) => row.sourceUrl).sort()).toEqual(["s0", "s1", "s2"].map(jobUrl).sort());
    const row = (name: string) => rows.find((candidate) => candidate.sourceUrl === jobUrl(name))!;
    expect(row("s0")).toMatchObject({ method: "batch", alsoSingle: true, resolvedOpportunityId: single.result.opportunityId });
    expect(row("s1")).toMatchObject({ method: "batch", alsoSingle: false });
    expect(row("s2")).toMatchObject({ method: "batch", alsoSingle: true, resolvedOpportunityId: s2.opportunityId });
    // The single-job filter does not list them again.
    const singles = await capturedJobs({ method: "single", filter: "all", site: null, sessionId: null, page: 1 }, repository, () => clock.now);
    expect(ourRows(singles.rows)).toHaveLength(0);
    // The capture marks the job saved before it.
    const view = await extensionCaptureSession(saved.sessionId!, repository, () => clock.now);
    expect(view!.jobs.map((job) => [job.title, job.savedBefore])).toEqual([
      [title("s0"), true],
      [title("s1"), false],
    ]);
  });
});
