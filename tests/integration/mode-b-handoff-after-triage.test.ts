// Being triaged is not being submitted for evaluation (November 23, 2026), on
// the isolated test database: configured-source retrieval triages new jobs
// only; a later results-page capture (Mode B) of the same job attaches to it
// (no second opportunity) and its hand-off then requests an evaluation when
// the job's only record is an EVALUATE triage. Needs review, Reject and a
// manual Reject keep their safeguard (ALREADY_HANDLED, nothing admitted); a
// job already evaluated is never requested twice. Fixture adapter, fixture
// browser and no evaluation worker: nothing reaches a site or a provider.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaPageCaptureRepository,
  PrismaPreEvaluatorTriageRepository,
  PrismaRetrievalSourceRepository,
} from "@ai-career/database";
import { createAdapterRegistry, createFixtureTransport, type BrowserDriver, type TransportResponse } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createAutomaticTriage } from "../../apps/web/src/server/automatic-triage";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, evaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { createRetrievalWorker } from "../../apps/web/src/server/retrieval-worker";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";
import { testSiteJobPage } from "../support/page-capture-pages";
import { createTestAdapter, jsonResponse, testBoardUrl, type TestJob } from "../support/retrieval-test-adapter";

const clock = { now: new Date("2026-11-23T09:00:00.000Z") };
const cleanup = createCleanup();
const run = randomUUID().slice(0, 8);
const triageService = createPreEvaluatorTriageService({ repository: new PrismaPreEvaluatorTriageRepository(), now: () => clock.now });
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] }).gate,
  triageGate: triageService.gate,
});
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() });

// Configured source: the synthetic test adapter, wired as the worker CLI wires
// automatic triage.
const store = new PrismaRetrievalSourceRepository();
const ats = createTestAdapter({ key: "test-ats", name: "Test ATS", sourceCategory: "ATS", sourceType: "ATS" });
const responses: Record<string, Omit<TransportResponse, "url">> = {};
const worker = createRetrievalWorker({
  store,
  ingestion,
  registry: createAdapterRegistry([ats]),
  transport: () => createFixtureTransport(responses),
  discovery: customerSuccessDiscoveryConfiguration,
  triage: createAutomaticTriage({ assess: (id) => evaluation.assessTriage(id), existing: (id) => evaluation.getTriage(id) }),
  env: () => ({}),
  now: () => clock.now,
  log: { info: () => undefined, warn: () => undefined },
});

// Results-page capture with its real evaluation hand-off and a fixture browser.
type Salary = { min: number; max: number } | null;
const jobs: Record<string, Salary> = { evaluate: { min: 85000, max: 100000 }, review: null, reject: { min: 45000, max: 50000 }, decided: null };
const jobUrl = (name: string) => `https://jobs.e2e.invalid/jobs/${name}-${run}`;
const title = "Customer Success Manager";
const company = (name: string) => `Handoff ${name} ${run}`;
const description = "<p>Own onboarding, adoption and renewals for SaaS customers. This is a fully remote role. Applicants must reside in the United States.</p>";
const repository = new PrismaPageCaptureRepository();
const intake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }), now: () => clock.now });
const driver: BrowserDriver = {
  async navigate(url) {
    const name = url.slice("https://jobs.e2e.invalid/jobs/".length, -(run.length + 1));
    const salary = jobs[name] ?? null;
    return {
      status: 200, finalUrl: url, cookieNames: [],
      html: testSiteJobPage({ id: `${name}-${run}`, title, company: company(name), description, salary: salary ? { ...salary, currency: "USD" } : null }),
    };
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

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
let activeBefore: { userProfileId: string } | null = null;
const sourceIds: string[] = [];
const sessionIds: string[] = [];

beforeEach(async () => {
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup);
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: profile.id }, update: { userProfileId: profile.id } });
  pairing = await database.extensionPairing.create({ data: { label: "Hand-off test", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const urls = Object.keys(jobs).map(jobUrl);
  const items = await database.pageCaptureItem.findMany({ where: { sourceUrl: { in: urls } }, select: { opportunityId: true } });
  const opportunityIds = [
    ...new Set([
      ...items.map((item) => item.opportunityId),
      ...(await database.opportunity.findMany({ where: { company: { name: { contains: run } } }, select: { id: true } })).map((row) => row.id),
    ].filter((id): id is string => Boolean(id))),
  ];
  await database.pageCaptureItem.deleteMany({ where: { sourceUrl: { in: urls } } });
  await database.pageCaptureSession.deleteMany({ where: { id: { in: sessionIds.splice(0) } } });
  const ids = sourceIds.splice(0);
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { OR: [{ opportunityId: { in: opportunityIds } }, { retrievalSourceId: { in: ids } }], laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.retrievedListing.deleteMany({ where: { retrievalSourceId: { in: ids } } });
  cleanup.opportunityIds.push(...opportunityIds);
  if (activeBefore) {
    await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: activeBefore.userProfileId }, update: { userProfileId: activeBefore.userProfileId } });
  }
  await cleanup.after();
  if (!activeBefore) await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  await database.retrievalRun.deleteMany({ where: { retrievalSourceId: { in: ids } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: ids } } });
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
});

afterAll(() => database.$disconnect());

async function retrieve(names: string[]) {
  const created = await store.create({
    adapterKey: ats.key, name: `Test ATS ${run}`, domain: "customer-success", retrievalType: ats.retrievalType,
    sourceCategory: ats.sourceCategory, config: { board: run }, scheduleMinutes: 720,
  });
  sourceIds.push(created.id);
  await store.update(created.id, { enabled: true });
  responses[testBoardUrl(ats.key, run, 1)] = jsonResponse({
    jobs: names.map((name): TestJob => {
      const salary = jobs[name] ?? null;
      return {
        id: `${name}-${run}`, title, company: company(name), location: "Remote - United States", html: description, url: jobUrl(name), workplace: "REMOTE", employment: "Full-time",
        salary: salary ? { ...salary, currency: "USD", period: "YEAR" } : null,
      };
    }),
  });
  await store.enqueueRun(created.id, "MANUAL", { now: clock.now });
  return (await worker.runOnce())!;
}

async function captureResultsPage(names: string[]) {
  const staged = await intake.capture({
    schemaVersion: 1, kind: "page-capture", batchId: randomUUID(), site: "e2e-results", pageUrl: "https://jobs.e2e.invalid/search", pageTitle: "Results",
    capturedAt: clock.now.toISOString(), extensionVersion: "0.4.0", counts: { loaded: names.length, skippedUnloaded: 0, overCap: 0 },
    cards: names.map((name) => ({ url: jobUrl(name), title, siteJobId: `${name}-${run}`, company: company(name), location: "Remote" })),
  }, pairing);
  sessionIds.push(staged.sessionId!);
  expect(staged.counts).toMatchObject({ queued: names.length });
  await acquisition.runOnce();
  return database.pageCaptureItem.findMany({ where: { sourceUrl: { in: names.map(jobUrl) } } });
}

const opportunityOf = async (name: string) =>
  (await database.sourceRecord.findFirstOrThrow({ where: { retrievalSourceId: { in: sourceIds }, externalId: `${name}-${run}` }, select: { opportunityId: true } })).opportunityId!;
const spend = async (opportunityId: string) => ({
  admissions: await database.evaluationAdmission.count({ where: { opportunityId } }),
  evaluations: await database.evaluation.count({ where: { opportunityId } }),
  tasks: await database.evaluationTask.count({ where: { evaluation: { opportunityId } } }),
});

describe("results-page capture of a job configured-source retrieval already triaged", () => {
  it("requests the evaluation for an EVALUATE triage only, keeps Needs review, Reject and manual decisions held, and never requests twice", async () => {
    const names = Object.keys(jobs);
    const retrieved = await retrieve(names);
    expect(retrieved.counts).toMatchObject({ created: 4, triage: { EVALUATE: 1, NEEDS_REVIEW: 2, REJECT: 1 } });
    const ids = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await opportunityOf(name)] as const)));
    // Retrieval itself requested nothing.
    for (const name of names) expect(await spend(ids[name]!), name).toEqual({ admissions: 0, evaluations: 0, tasks: 0 });
    // A manual decision on one held job.
    await triageService.gate.decide({ opportunityId: ids.decided!, decision: "REJECT" });
    const before = await database.preEvaluatorTriage.findMany({ where: { opportunityId: { in: Object.values(ids) } } });

    clock.now = new Date("2026-11-23T10:00:00.000Z");
    const items = await captureResultsPage(names);
    const item = (name: string) => items.find((row) => row.sourceUrl === jobUrl(name))!;
    // Each capture attached to the retrieved job: no second opportunity.
    for (const name of names) expect(item(name).opportunityId, name).toBe(ids[name]);
    expect(await database.opportunity.count({ where: { company: { name: { contains: run } } } })).toBe(4);

    // EVALUATE alone is not "already handled": the request went through the
    // triage gate and admission, once.
    expect(item("evaluate").handoffOutcome).toBe("QUEUED");
    expect(await spend(ids.evaluate!)).toEqual({ admissions: 1, evaluations: 1, tasks: 1 });
    // Holds keep their safeguard; nothing was admitted.
    for (const name of ["review", "reject", "decided"]) {
      expect(item(name).handoffOutcome, name).toBe("ALREADY_HANDLED");
      expect(await spend(ids[name]!), name).toEqual({ admissions: 0, evaluations: 0, tasks: 0 });
    }
    // Triage records and the manual decision are unchanged, apart from the
    // EVALUATE job's re-assessment by the evaluation request.
    const after = await database.preEvaluatorTriage.findMany({ where: { opportunityId: { in: Object.values(ids) } } });
    expect(after).toHaveLength(4);
    for (const row of after.filter((entry) => entry.opportunityId !== ids.evaluate)) {
      expect(row).toEqual(before.find((entry) => entry.opportunityId === row.opportunityId));
    }
    expect(after.find((row) => row.opportunityId === ids.decided)).toMatchObject({ outcome: "NEEDS_REVIEW", manualDecision: "REJECT" });
    expect(after.find((row) => row.opportunityId === ids.evaluate)).toMatchObject({ outcome: "EVALUATE", manualDecision: null });

    // Already evaluated now: the hand-off says so, and a request is refused
    // by the evaluation service's own idempotency check.
    const handoff = evaluationHandoff(evaluation);
    expect(await handoff.alreadyHandled(ids.evaluate!)).toBe(true);
    await expect(handoff.request(ids.evaluate!)).rejects.toMatchObject({ code: "EVALUATION_ALREADY_ACTIVE" });
    expect(await spend(ids.evaluate!)).toEqual({ admissions: 1, evaluations: 1, tasks: 1 });
    expect(await database.semanticOperationAttempt.count({ where: { evaluation: { opportunityId: { in: Object.values(ids) } } } })).toBe(0);
  });
});
