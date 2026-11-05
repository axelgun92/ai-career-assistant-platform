// Captured Jobs, capture history and triage at single-job save, on the
// isolated test database (November 5, 2026):
// - each results-page save is recorded once as a capture session listing its
//   jobs, with their live state, and a repeated batch is the same session;
// - Captured Jobs lists results-page jobs and single-job captures together,
//   one row per job, a job captured both ways once, filterable by method,
//   status, site and session (in page order);
// - a single-job save runs the deterministic pre-evaluator triage only
//   (EVALUATE / NEEDS_REVIEW / REJECT, never admission or evaluation), and
//   with no active profile the job is saved and reported not triaged;
// - a pairing records the extension version it last reported.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRetrievalIngestionService, extensionCaptureSchemaVersion } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaExtensionLookupRepository,
  PrismaExtensionPairingRepository,
  PrismaManualOpportunityRepository,
  PrismaPageCaptureRepository,
  PrismaPreEvaluatorTriageRepository,
} from "@ai-career/database";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { buildPageCaptureBatch } from "../../apps/extension/src/page-capture-view";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { captureTriageFrom } from "../../apps/web/src/server/extension-api";
import { requirePairing } from "../../apps/web/src/server/extension-auth";
import { capturedPageIdentity, createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService, enabledSitesFromEnvironment } from "../../apps/web/src/server/page-capture";
import { capturedJobs, extensionCaptureSession, extensionCaptureSessions } from "../../apps/web/src/server/page-capture-progress";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { generatePairingCredential } from "../../apps/web/src/server/extension-auth";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";
import { runResultsReader } from "../support/page-capture-pages";
import { wttjF0, wttjF0ResultsPage, wttjF0Urls } from "../support/wttj-tab-pages";

const clock = { now: new Date("2026-11-05T12:00:00.000Z") };
const cleanup = createCleanup();
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
const intake = createPageCaptureService({ repository, enabledSites: () => enabledSitesFromEnvironment({ PAGE_CAPTURE_ACCEPTANCE_SITES: "welcome-to-the-jungle" }), now: () => clock.now });
const singleJob = createExtensionCaptureService({
  ingestion,
  lookup: new PrismaExtensionLookupRepository(),
  latestEvaluation: async () => null,
  triage: async (opportunityId) => captureTriageFrom(await evaluation.assessTriage(opportunityId)),
  discovery: customerSuccessDiscoveryConfiguration,
  now: () => clock.now,
});

const token = randomUUID().slice(0, 8);
const singleUrls = {
  evaluate: `https://careers.example-${token}.com/jobs/csm-evaluate`,
  review: `https://careers.example-${token}.com/jobs/csm-review`,
  reject: `https://careers.example-${token}.com/jobs/csm-reject`,
  band: `https://careers.example-${token}.com/jobs/csm-band`,
};
const externalIds = [...wttjF0Urls.map((url) => capturedPageIdentity(url).externalId!), ...Object.values(singleUrls).map((url) => capturedPageIdentity(url).externalId!)];

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
let activeBefore: { userProfileId: string } | null = null;
const sessionIds: string[] = [];

function savedBatch(kept: boolean[], batchId = randomUUID()) {
  const reading = runResultsReader(wttjF0ResultsPage(), wttjF0.page, "welcome-to-the-jungle");
  const built = buildPageCaptureBatch(reading, kept, { site: "welcome-to-the-jungle", batchId, extensionVersion: "0.3.0", capturedAt: clock.now });
  if (!built.ok) throw new Error(built.problem);
  sessionIds.push(batchId);
  return built.batch;
}

const description = (salary: string | null) =>
  [
    "Customer Success Manager for a workflow SaaS platform.",
    "This is a fully remote role. Applicants must reside in the United States.",
    salary ? `Base salary ${salary}.` : "Compensation is not stated.",
    "Own onboarding, adoption, education, and retention for a portfolio of B2B customers.",
  ].join("\n");
const capture = (url: string, salary: string | null) => ({
  schemaVersion: extensionCaptureSchemaVersion,
  pageUrl: url,
  extractor: "main-content",
  capturedAt: clock.now.toISOString(),
  extensionVersion: "0.3.0",
  fields: { title: "Customer Success Manager", company: `Singleco ${token}`, location: "United States", description: description(salary) },
});

async function activateProfile() {
  activeBefore ??= await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup);
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: profile.id }, update: { userProfileId: profile.id } });
}

beforeEach(async () => {
  const existing = await database.sourceRecord.count({ where: { externalId: { in: externalIds } } });
  const staged = await database.pageCaptureItem.count({ where: { externalId: { in: externalIds } } });
  expect({ existing, staged }, "the test database already holds these jobs").toEqual({ existing: 0, staged: 0 });
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  pairing = await database.extensionPairing.create({ data: { label: "Captured jobs test", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const staged = await database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } } });
  const records = await database.sourceRecord.findMany({ where: { externalId: { in: externalIds } }, select: { opportunityId: true } });
  const opportunityIds = [...new Set([...staged.map((item) => item.opportunityId), ...records.map((record) => record.opportunityId), ...cleanup.opportunityIds].filter((id): id is string => Boolean(id)))];
  await database.pageCaptureItem.deleteMany({ where: { externalId: { in: externalIds } } });
  await database.pageCaptureSession.deleteMany({ where: { id: { in: sessionIds } } });
  await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  sessionIds.splice(0);
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { OR: [{ opportunityId: { in: opportunityIds } }, { externalId: { in: externalIds } }], laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  if (activeBefore) {
    await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: activeBefore.userProfileId }, update: { userProfileId: activeBefore.userProfileId } });
  } else {
    await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  }
  await cleanup.after();
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
  activeBefore = null;
});

afterAll(() => database.$disconnect());

describe("capture history and Captured Jobs on the test database", () => {
  it("records each results-page save once as a session listing its jobs, with their live state", async () => {
    const batchId = randomUUID();
    const first = await intake.capture(savedBatch([true, true, false, true, true], batchId), pairing);
    expect(first.sessionId).toBe(batchId);
    // The same batch again is the same session.
    await intake.capture(savedBatch([true, true, false, true, true], batchId), pairing);
    const sessions = await database.pageCaptureSession.findMany({ where: { id: batchId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.itemIds).toEqual(first.acquisition!.items.map((item) => item.itemId));
    expect(sessions[0]!.counts).toMatchObject({ loaded: 5, staged: 4, rejected: 0 });

    // A later save of the same page is a new session with the same jobs (no duplicate job rows).
    clock.now = new Date(clock.now.getTime() + 60_000);
    const later = await intake.capture(savedBatch([true, true, true, true, true]), pairing);
    expect(await database.pageCaptureItem.count({ where: { externalId: { in: externalIds } } })).toBe(5);
    const history = await extensionCaptureSessions(10, repository, () => clock.now);
    const ours = history.sessions.filter((session) => [batchId, later.sessionId].includes(session.id));
    expect(ours.map((session) => session.id)).toEqual([later.sessionId, batchId]);
    expect(ours[0]).toMatchObject({ jobs: 5, pending: 5, inProgress: true, siteName: "Welcome to the Jungle / Otta" });

    const detail = await extensionCaptureSession(batchId, repository, () => clock.now);
    expect(detail!.jobs.map((job) => job.title)).toEqual(["Customer Success Manager", "Senior Customer Success Manager (Solutions)", "Senior Customer Success Manager - Central", "Senior Customer Success Manager"]);
    expect(detail!.jobs.every((job) => job.statusText === "Getting details" && job.opportunityPath === null)).toBe(true);
    expect(await extensionCaptureSession(randomUUID(), repository)).toBeNull();
    clock.now = new Date("2026-11-05T12:00:00.000Z");
  });

  it("lists single-job and results-page captures together, once per job, with method, status, site and session filters", async () => {
    const batchId = randomUUID();
    await intake.capture(savedBatch([true, true, false, false, false], batchId), pairing);
    const single = await singleJob.capture(capture(singleUrls.evaluate, "$72,000-$88,000"), pairing);
    cleanup.opportunityIds.push(single.result.opportunityId);
    // A batch job also captured alone stays one (batch) row.
    const both = await singleJob.capture({ ...capture(wttjF0Urls[0], null), fields: { title: "Customer Success Manager", company: "FourKites", location: "Chicago", description: description("$90,000-$100,000") } }, pairing);
    cleanup.opportunityIds.push(both.result.opportunityId);

    const all = await capturedJobs({ method: "all", filter: "all", site: null, sessionId: null, page: 1 }, repository, () => clock.now);
    const ours = all.rows.filter((row) => externalIds.some((id) => id.endsWith(new URL(row.sourceUrl || "https://x.invalid").pathname)) || row.title === "Customer Success Manager");
    const singleRow = all.rows.find((row) => row.resolvedOpportunityId === single.result.opportunityId);
    expect(singleRow).toMatchObject({ method: "single", status: "INGESTED", sourceUrl: singleUrls.evaluate, retryable: false });
    expect(all.rows.filter((row) => row.sourceUrl === wttjF0Urls[0])).toHaveLength(1);
    expect(all.rows.find((row) => row.sourceUrl === wttjF0Urls[0])).toMatchObject({ method: "batch" });
    expect(ours.length).toBeGreaterThanOrEqual(3);

    const onlySingle = await capturedJobs({ method: "single", filter: "all", site: null, sessionId: null, page: 1 }, repository);
    expect(onlySingle.rows.every((row) => row.method === "single")).toBe(true);
    expect(onlySingle.rows.some((row) => row.resolvedOpportunityId === single.result.opportunityId)).toBe(true);
    const waiting = await capturedJobs({ method: "all", filter: "waiting", site: null, sessionId: null, page: 1 }, repository);
    expect(waiting.rows.every((row) => row.method === "batch")).toBe(true);
    const site = await capturedJobs({ method: "all", filter: "all", site: "welcome-to-the-jungle", sessionId: null, page: 1 }, repository);
    expect(site.rows.every((row) => row.site === "welcome-to-the-jungle")).toBe(true);

    const session = await capturedJobs({ method: "all", filter: "all", site: null, sessionId: batchId, page: 1 }, repository);
    expect(session.session).toMatchObject({ id: batchId, siteName: "Welcome to the Jungle / Otta" });
    expect(session.rows.map((row) => row.sourceUrl)).toEqual([wttjF0Urls[0], wttjF0Urls[1]]);
    expect(session.sessions.some((entry) => entry.id === batchId)).toBe(true);
  });

  it("triages a single-job save only (no admission or evaluation) when a profile is active", async () => {
    await activateProfile();
    const admissionsBefore = await database.evaluationAdmission.count();
    const evaluationsBefore = await database.evaluation.count();
    const results = {
      evaluate: (await singleJob.capture(capture(singleUrls.evaluate, "$72,000-$88,000"), pairing)).result,
      review: (await singleJob.capture(capture(singleUrls.review, null), pairing)).result,
      reject: (await singleJob.capture(capture(singleUrls.reject, "$45,000-$50,000"), pairing)).result,
    };
    for (const result of Object.values(results)) cleanup.opportunityIds.push(result.opportunityId);
    expect(results.evaluate.triage).toMatchObject({ status: "ASSESSED", outcome: "EVALUATE" });
    expect(results.review.triage).toMatchObject({ status: "ASSESSED", outcome: "NEEDS_REVIEW" });
    expect(results.reject.triage).toMatchObject({ status: "ASSESSED", outcome: "REJECT" });
    expect((results.reject.triage as { reasons: string[] }).reasons.length).toBeGreaterThan(0);
    // Triage only: nothing admitted, nothing evaluated.
    expect(await database.evaluationAdmission.count()).toBe(admissionsBefore);
    expect(await database.evaluation.count()).toBe(evaluationsBefore);
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: { in: Object.values(results).map((result) => result.opportunityId) } } })).toBe(3);
    // Saving again is idempotent: one triage record, the same outcome.
    const again = await singleJob.capture(capture(singleUrls.review, null), pairing);
    expect(again.result.triage).toMatchObject({ status: "ASSESSED", outcome: "NEEDS_REVIEW" });
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: results.review.opportunityId } })).toBe(1);
  });

  it("holds a U.S. job in the $55,000-$59,999 band for review (salary policy v4), with no admission or evaluation", async () => {
    await activateProfile();
    const admissionsBefore = await database.evaluationAdmission.count();
    const evaluationsBefore = await database.evaluation.count();
    const band = (await singleJob.capture(capture(singleUrls.band, "$57,000-$59,000"), pairing)).result;
    cleanup.opportunityIds.push(band.opportunityId);
    expect(band.triage).toMatchObject({ status: "ASSESSED", outcome: "NEEDS_REVIEW" });
    const stored = await database.preEvaluatorTriage.findUniqueOrThrow({ where: { opportunityId: band.opportunityId } });
    expect(JSON.stringify(stored.reasons)).toContain("salary-us-review");
    expect(JSON.stringify(stored.reasons)).not.toContain("salary-us-threshold");
    expect(await database.evaluationAdmission.count()).toBe(admissionsBefore);
    expect(await database.evaluation.count()).toBe(evaluationsBefore);
  });

  it("saves a single job and reports it not triaged when no profile is active", async () => {
    await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
    const saved = await singleJob.capture(capture(singleUrls.review, null), pairing);
    cleanup.opportunityIds.push(saved.result.opportunityId);
    expect(saved.status).toBe(201);
    expect(saved.result.triage).toEqual({ status: "NO_PROFILE" });
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: saved.result.opportunityId } })).toBe(0);
  });

  it("records the extension version a pairing last reported", async () => {
    const { credential, tokenHash, tokenHint } = generatePairingCredential();
    const repositoryOfPairings = new PrismaExtensionPairingRepository();
    const created = await repositoryOfPairings.create({ label: "Version test", tokenHash, tokenHint });
    try {
      const request = (version?: string) =>
        new Request("http://127.0.0.1:3000/api/extension/status", { headers: { authorization: `Bearer ${credential}`, ...(version ? { "x-extension-version": version } : {}) } });
      expect((await requirePairing(request("0.3.0"), repositoryOfPairings)).ok).toBe(true);
      expect((await repositoryOfPairings.list()).find((row) => row.id === created.id)).toMatchObject({ lastExtensionVersion: "0.3.0" });
      // An unparseable version is ignored, the last good one kept.
      await requirePairing(request("<script>"), repositoryOfPairings);
      expect((await repositoryOfPairings.list()).find((row) => row.id === created.id)).toMatchObject({ lastExtensionVersion: "0.3.0" });
    } finally {
      await database.extensionPairing.deleteMany({ where: { id: created.id } });
    }
  });
});
