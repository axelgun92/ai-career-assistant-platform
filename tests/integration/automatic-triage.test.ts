// Automatic pre-evaluator triage after configured-source retrieval
// (November 23, 2026) on the isolated test database: the retrieval worker with
// the fixture transport and a synthetic test adapter (".invalid" URLs; nothing
// reaches the network), wired to the real triage of the evaluation service as
// the worker CLI wires it. Covers the three outcomes recorded once per new
// opportunity, no evaluation, admission, deferral or provider call, unchanged
// and attached observations skipped, a manual decision kept, no active
// profile, and the dashboard row reading the stored triage.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualOpportunityService, createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityListRepository,
  PrismaPreEvaluatorTriageRepository,
  PrismaRetrievalSourceRepository,
} from "@ai-career/database";
import { createAdapterRegistry, createFixtureTransport, type TransportResponse } from "@ai-career/discovery";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createAutomaticTriage } from "../../apps/web/src/server/automatic-triage";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { createRetrievalWorker } from "../../apps/web/src/server/retrieval-worker";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";
import { createTestAdapter, jsonResponse, testBoardUrl, type TestJob } from "../support/retrieval-test-adapter";

const clock = { now: new Date("2026-11-23T09:00:00.000Z") };
const store = new PrismaRetrievalSourceRepository();
const repository = new PrismaManualOpportunityRepository();
const ats = createTestAdapter({ key: "test-ats", name: "Test ATS", sourceCategory: "ATS", sourceType: "ATS" });
const responses: Record<string, Omit<TransportResponse, "url">> = {};
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
const worker = createRetrievalWorker({
  store,
  ingestion: createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() }),
  registry: createAdapterRegistry([ats]),
  transport: () => createFixtureTransport(responses),
  discovery: customerSuccessDiscoveryConfiguration,
  triage: createAutomaticTriage({
    assess: (opportunityId, options) => evaluation.assessTriage(opportunityId, options),
    existing: (opportunityId) => evaluation.getTriage(opportunityId),
  }),
  env: () => ({}),
  now: () => clock.now,
  log: { info: () => undefined, warn: () => undefined },
});
const manual = createManualOpportunityService({ repository, normalizer: createManualOpportunityNormalizer() });
const cleanup = createCleanup();
const sourceIds: string[] = [];
let token = "";
let activeBefore: { userProfileId: string } | null = null;

beforeEach(async () => {
  token = `T${randomUUID().slice(0, 8)}`;
  clock.now = new Date("2026-11-23T09:00:00.000Z");
  for (const key of Object.keys(responses)) delete responses[key];
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
});

afterEach(async () => {
  const opportunityIds = (await database.opportunity.findMany({ where: { company: { name: { contains: token } } }, select: { id: true } })).map((row) => row.id);
  const ids = sourceIds.splice(0);
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { OR: [{ retrievalSourceId: { in: ids } }, { opportunityId: { in: opportunityIds } }], laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.retrievedListing.deleteMany({ where: { retrievalSourceId: { in: ids } } });
  cleanup.opportunityIds.push(...opportunityIds);
  if (activeBefore) {
    await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: activeBefore.userProfileId }, update: { userProfileId: activeBefore.userProfileId } });
  } else {
    await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  }
  await cleanup.after();
  await database.retrievalRun.deleteMany({ where: { retrievalSourceId: { in: ids } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: ids } } });
});

afterAll(() => database.$disconnect());

async function activateProfile() {
  const profile = await createProfile(cleanup);
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: profile.id }, update: { userProfileId: profile.id } });
}

async function addSource() {
  const source = await store.create({
    adapterKey: ats.key, name: `Test ATS ${token}`, domain: "customer-success", retrievalType: ats.retrievalType,
    sourceCategory: ats.sourceCategory, config: { board: token }, scheduleMinutes: 720,
  });
  sourceIds.push(source.id);
  return store.update(source.id, { enabled: true });
}

function job(id: string, salary: TestJob["salary"], overrides: Partial<TestJob> = {}): TestJob {
  return {
    id,
    title: "Customer Success Manager",
    company: `Acme ${token}`,
    location: "Remote - United States",
    html: "<p>Own onboarding, adoption and renewals for SaaS customers. Applicants must reside in the United States.</p>",
    url: `https://boards.example.com/${token}/jobs/${id}`,
    salary,
    workplace: "REMOTE",
    employment: "Full-time",
    ...overrides,
  };
}

const salary = (min: number, max: number): TestJob["salary"] => ({ min, max, currency: "USD", period: "YEAR" });

async function run(sourceId: string) {
  await store.enqueueRun(sourceId, "MANUAL", { now: clock.now });
  const outcome = await worker.runOnce();
  expect(outcome?.sourceId).toBe(sourceId);
  return outcome!;
}

async function opportunityFor(id: string) {
  const record = await database.sourceRecord.findFirstOrThrow({ where: { externalId: id, retrievalSourceId: { in: sourceIds } }, select: { opportunityId: true } });
  return record.opportunityId!;
}

async function spendCounts(opportunityIds: string[]) {
  const where = { opportunityId: { in: opportunityIds } };
  return {
    evaluations: await database.evaluation.count({ where }),
    admissions: await database.evaluationAdmission.count({ where }),
    deferrals: await database.deferredEvaluation.count({ where }),
    attempts: await database.semanticOperationAttempt.count({ where: { evaluation: where } }),
  };
}

describe("automatic triage after configured-source retrieval", () => {
  it("records EVALUATE, NEEDS_REVIEW and REJECT once per new opportunity, and nothing is evaluated", async () => {
    await activateProfile();
    const source = await addSource();
    responses[testBoardUrl(ats.key, token, 1)] = jsonResponse({
      jobs: [job("1", salary(85000, 100000)), job("2", null), job("3", salary(45000, 50000))],
    });
    const first = await run(source.id);
    expect(first).toMatchObject({ status: "COMPLETED", counts: { created: 3, triage: { EVALUATE: 1, NEEDS_REVIEW: 1, REJECT: 1 } } });
    const ids = [await opportunityFor("1"), await opportunityFor("2"), await opportunityFor("3")];
    const triage = await database.preEvaluatorTriage.findMany({ where: { opportunityId: { in: ids } } });
    expect(Object.fromEntries(triage.map((row) => [ids.indexOf(row.opportunityId), row.outcome]))).toEqual({ 0: "EVALUATE", 1: "NEEDS_REVIEW", 2: "REJECT" });
    // Triage only: no evaluation, admission, deferral or provider attempt.
    expect(await spendCounts(ids)).toEqual({ evaluations: 0, admissions: 0, deferrals: 0, attempts: 0 });

    // The dashboard row reads the stored triage, beside "not evaluated".
    const page = await new PrismaOpportunityListRepository().listPage({ filters: { searchTerms: [token] }, sort: "newest", page: 1, pageSize: 10 });
    const rows = Object.fromEntries(page.items.map((item) => [ids.indexOf(item.id), item]));
    expect(rows[0]).toMatchObject({ triage: { outcome: "EVALUATE", manual: false }, latestEvaluation: null, deferred: false });
    expect(rows[1]).toMatchObject({ triage: { outcome: "NEEDS_REVIEW", manual: false } });
    expect(rows[2]).toMatchObject({ triage: { outcome: "REJECT", manual: false } });

    // An unchanged re-observation is never triaged again.
    const assessedAt = new Map(triage.map((row) => [row.opportunityId, row.assessedAt.getTime()]));
    clock.now = new Date("2026-11-23T21:00:00.000Z");
    const again = await run(source.id);
    expect(again.counts).toMatchObject({ unchanged: 3, created: 0 });
    expect(again.counts.triage).toBeUndefined();
    const after = await database.preEvaluatorTriage.findMany({ where: { opportunityId: { in: ids } } });
    expect(after).toHaveLength(3);
    for (const row of after) expect(row.assessedAt.getTime()).toBe(assessedAt.get(row.opportunityId));
  });

  it("keeps an existing (manual) decision when the listing changes, and triages a changed listing never assessed", async () => {
    // No active profile: the job is stored, not triaged, and the run completes.
    const source = await addSource();
    responses[testBoardUrl(ats.key, token, 1)] = jsonResponse({ jobs: [job("1", null), job("2", salary(85000, 100000))] });
    const first = await run(source.id);
    expect(first).toMatchObject({ status: "COMPLETED", errorCode: null, counts: { created: 2, failed: 0, triage: { noProfile: 2 } } });
    const [held, never] = [await opportunityFor("1"), await opportunityFor("2")];
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: { in: [held, never] } } })).toBe(0);

    // With a profile, one job is assessed and decided by the user.
    await activateProfile();
    expect(await evaluation.assessTriage(held)).toMatchObject({ status: "ASSESSED", triage: { outcome: "NEEDS_REVIEW" } });
    await triageService.gate.decide({ opportunityId: held, decision: "REJECT" });
    const decided = await database.preEvaluatorTriage.findUniqueOrThrow({ where: { opportunityId: held } });

    // Both listings change: the decided one keeps its record untouched; the
    // never-assessed one is triaged now.
    clock.now = new Date("2026-11-23T21:00:00.000Z");
    responses[testBoardUrl(ats.key, token, 1)] = jsonResponse({
      jobs: [
        job("1", null, { html: "<p>Own onboarding and renewals for SaaS customers. Applicants must reside in the United States. Now leading QBRs.</p>" }),
        job("2", salary(85000, 100000), { html: "<p>Own adoption for SaaS customers. Applicants must reside in the United States. Now leading QBRs.</p>" }),
      ],
    });
    const changed = await run(source.id);
    expect(changed.counts).toMatchObject({ changed: 2, triage: { EVALUATE: 1 } });
    expect(await database.preEvaluatorTriage.findUniqueOrThrow({ where: { opportunityId: held } })).toMatchObject({
      manualDecision: "REJECT", outcome: decided.outcome, assessedAt: decided.assessedAt,
    });
    expect(await database.preEvaluatorTriage.findUniqueOrThrow({ where: { opportunityId: never } })).toMatchObject({ outcome: "EVALUATE", manualDecision: null });
    expect(await spendCounts([held, never])).toEqual({ evaluations: 0, admissions: 0, deferrals: 0, attempts: 0 });
  });

  it("never triages an exact duplicate attached to an existing opportunity", async () => {
    await activateProfile();
    const url = `https://boards.example.com/${token}/jobs/88`;
    const saved = await manual.submit({
      rawText: "Customer Success Manager. Employment type: Full-time. Own onboarding, adoption and renewals for SaaS customers.",
      title: "Customer Success Manager", company: `Acme ${token}`, sourceUrl: url, domain: "customer-success",
    });
    const source = await addSource();
    responses[testBoardUrl(ats.key, token, 1)] = jsonResponse({ jobs: [job("88", salary(85000, 100000), { url })] });
    const outcome = await run(source.id);
    expect(outcome.counts).toMatchObject({ attached: 1, created: 0 });
    expect(outcome.counts.triage).toBeUndefined();
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: saved.opportunity.id } })).toBe(0);
  });
});
