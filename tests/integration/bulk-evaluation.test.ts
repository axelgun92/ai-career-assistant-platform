// Bulk evaluation on the isolated test database (November 26, 2026), wired
// as in production (budget gate, triage gate, duplicate repository and the
// duplicate-spend lock). Proves: a batch that fits is admitted and queued
// exactly once per job with the active profile version; no provider call;
// each enabled limit rejects the whole batch and is named with what remains;
// disabled limits are ignored; several shortfalls are reported; stale,
// active, completed, deferred, duplicate and triage-held jobs refuse the
// whole batch with nothing written; capacity consumed after the preflight
// rejects the submit; simultaneous batches never overshoot; a 50-job batch
// commits in one transaction. And the three review corrections:
//   C1 output tokens bound the whole batch before the limit is reached;
//   C2 eligibility matches the individual request (FAILED latest retryable,
//      an older completed evaluation, the listing version and profile);
//   C3 the duplicate-spend lock, the admission lock, the final checks and
//      every write are one transaction: a concurrent request cannot enter
//      between the batch's final checks and its commit.
// And the approved clarification on output-token potential: scoped to the
// current monthly window, each provider call counted once, reported usage
// replacing that call's estimate, unused potential released when an
// evaluation completes, fails permanently or its admission is abandoned.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { budgetPeriod, createManualOpportunityService, worstCaseOutputTokens } from "@ai-career/core";
import {
  PrismaBudgetRepository,
  PrismaDuplicateRepository,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
  PrismaPreEvaluatorTriageRepository,
  withDuplicateSpendLock,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { committedOutputTokenPotential, createBudgetService } from "../../apps/web/src/server/budget-service";
import { EvaluationApiError } from "../../apps/web/src/server/evaluation-errors";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { createCleanup, createProfile, database, recordAttempt, runWorker, semanticConfig, tasks } from "../support/budget-integration";

// A fixed Wednesday far from real time: its day, week and month windows
// contain only what these tests create.
const clock = { now: new Date("2032-06-16T15:00:00.000Z") };
const cleanup = createCleanup();
const budget = createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] });
const service = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks,
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: budget.gate,
  duplicates: new PrismaDuplicateRepository(),
  duplicateSpendLock: (work) => withDuplicateSpendLock(work),
  triageGate: createPreEvaluatorTriageService({ repository: new PrismaPreEvaluatorTriageRepository(), now: () => clock.now }).gate,
});
const manual = createManualOpportunityService({ repository: new PrismaManualOpportunityRepository(), normalizer: createManualOpportunityNormalizer() });
let profile = { id: "", version: 1 };
let activeBefore: string | null = null;

beforeAll(async () => {
  activeBefore = (await database.activeUserProfile.findUnique({ where: { domain: "customer-success" } }))?.userProfileId ?? null;
});

beforeEach(async () => {
  clock.now = new Date("2032-06-16T15:00:00.000Z");
  await cleanup.before();
  const created = await createProfile(cleanup, `Bulk ${randomUUID().slice(0, 8)}`);
  profile = { id: created.id, version: created.version };
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: created.id }, update: { userProfileId: created.id } });
});

afterEach(async () => {
  if (activeBefore) await database.activeUserProfile.update({ where: { domain: "customer-success" }, data: { userProfileId: activeBefore } });
  else await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  await cleanup.after();
});

afterAll(() => database.$disconnect());

const eligibleText = (company: string, salary = "$72,000-$88,000") =>
  [
    `Customer Success Manager at ${company}, a SaaS workflow platform.`,
    "Remote. Applicants must reside in the United States.",
    "Employment type: Full-time",
    salary ? `Salary ${salary}. No travel required.` : "Compensation is not stated.",
    "Own onboarding, adoption, education, retention, and business reviews.",
  ].join("\n");

async function job(options: { salary?: string | null; token?: string; sourceUrl?: string; separate?: boolean } = {}) {
  const company = `Bulkco ${options.token ?? randomUUID().slice(0, 8)}`;
  const salary = options.salary === undefined ? "$72,000-$88,000" : options.salary;
  const detail = await manual.submit({
    title: "Customer Success Manager",
    company,
    location: "Remote - United States",
    ...(salary ? { compensationText: salary } : {}),
    domain: "customer-success",
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    ...(options.separate ? { duplicateResolution: "SEPARATE" as const } : {}),
    rawText: eligibleText(company, salary ?? ""),
  });
  cleanup.opportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

const jobs = async (count: number) => Promise.all(Array.from({ length: count }, () => job()));

// Two captures of one listing, kept as an unresolved exact match (the
// duplicate-spend twin), as in the duplicate-spend guard's tests.
async function twinPair() {
  const token = randomUUID().slice(0, 8);
  const sourceUrl = `https://jobs.example.com/bulk/${token}`;
  const a = await job({ token, sourceUrl });
  const b = await job({ token, sourceUrl, separate: true });
  await database.duplicateReference.deleteMany({ where: { opportunityId: b } });
  return { a, b };
}

const settings = (patch: Record<string, unknown> = {}) =>
  budget.updateSettings({ amount: 100, currency: "USD", timeZone: "UTC", reservePerEvaluation: 1, enforced: true, ...patch });

async function rows(ids: readonly string[]) {
  const where = { opportunityId: { in: [...ids] } };
  return {
    admissions: await database.evaluationAdmission.count({ where }),
    reservations: await database.evaluationBudgetReservation.count({ where: { admission: where } }),
    evaluations: await database.evaluation.count({ where }),
    tasks: await database.evaluationTask.count({ where: { evaluation: where } }),
    deferrals: await database.deferredEvaluation.count({ where }),
    attempts: await database.semanticOperationAttempt.count({ where: { evaluation: where } }),
  };
}
const none = { admissions: 0, reservations: 0, evaluations: 0, tasks: 0, deferrals: 0, attempts: 0 };

const preflight = (ids: readonly string[]) => service.requestEvaluationBatch(ids, { mode: "PREFLIGHT" });
const submit = (ids: readonly string[], beforeCommit?: () => Promise<void>) =>
  service.requestEvaluationBatch(ids, { mode: "SUBMIT", ...(beforeCommit ? { beforeCommit } : {}) });
const single = (id: string) => service.requestEvaluation(id, {});
async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(EvaluationApiError);
  return (error as EvaluationApiError).code;
}
async function markLatestFailed(opportunityId: string) {
  const latest = await database.evaluation.findFirstOrThrow({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  await database.evaluation.update({ where: { id: latest.id }, data: { status: "FAILED" } });
  await database.evaluationTask.updateMany({ where: { evaluationId: latest.id }, data: { status: "FAILED" } });
}

describe("a batch that fits", () => {
  it("is checked without writing anything, then queued exactly once per job with the active profile version, and calls no provider", async () => {
    await settings();
    const ids = await jobs(3);
    expect(await preflight(ids)).toEqual({ outcome: "READY", count: 3, reservation: { perEvaluation: 1, total: 3, currency: "USD" } });
    expect(await rows(ids)).toEqual(none);

    const result = await submit(ids);
    expect(result.outcome).toBe("QUEUED");
    expect(result.outcome === "QUEUED" && result.queued.map((item) => item.opportunityId)).toEqual(ids);
    expect(await rows(ids)).toEqual({ admissions: 3, reservations: 3, evaluations: 3, tasks: 3, deferrals: 0, attempts: 0 });
    for (const id of ids) {
      const evaluation = await database.evaluation.findFirstOrThrow({ where: { opportunityId: id }, include: { task: true } });
      expect(evaluation).toMatchObject({ userProfileId: profile.id, userProfileVersion: profile.version, task: { status: "PENDING" } });
      // Every admission consumed by its evaluation.
      expect(await database.evaluationAdmission.findFirstOrThrow({ where: { opportunityId: id } })).toMatchObject({ evaluationId: evaluation.id, abandonedAt: null });
    }
    // Asking again: each job is now queued; nothing more is created.
    expect(await submit(ids)).toMatchObject({ outcome: "INELIGIBLE" });
    expect(await rows(ids)).toMatchObject({ admissions: 3, evaluations: 3 });
  });
});

describe("limits", () => {
  it("rejects in full a batch over the daily, weekly or monthly budget limit, naming it with what remains", async () => {
    const ids = await jobs(3);
    await settings({ dailyEvaluationLimit: 2, weeklyEvaluationLimit: 10 });
    expect(await submit(ids)).toEqual({ outcome: "LIMITS_EXCEEDED", shortfalls: [{ limit: "DAILY_EVALUATIONS", remaining: 2 }] });
    await settings({ dailyEvaluationLimit: null, weeklyEvaluationLimit: 2 });
    expect(await submit(ids)).toEqual({ outcome: "LIMITS_EXCEEDED", shortfalls: [{ limit: "WEEKLY_EVALUATIONS", remaining: 2 }] });
    await settings({ amount: 2.5 });
    expect(await submit(ids)).toEqual({ outcome: "LIMITS_EXCEEDED", shortfalls: [{ limit: "BUDGET", remaining: 2 }] });
    expect(await rows(ids)).toEqual(none);
  });

  it("reports every exceeded limit together, and ignores limits that are off or not enforced", async () => {
    const ids = await jobs(3);
    await settings({ amount: 1, dailyEvaluationLimit: 1, weeklyEvaluationLimit: 2 });
    expect(await preflight(ids)).toEqual({
      outcome: "LIMITS_EXCEEDED",
      shortfalls: [{ limit: "BUDGET", remaining: 1 }, { limit: "DAILY_EVALUATIONS", remaining: 1 }, { limit: "WEEKLY_EVALUATIONS", remaining: 2 }],
    });
    expect(await rows(ids)).toEqual(none);
    // The same limits, not enforced: they never block (as for one request).
    await settings({ amount: 1, dailyEvaluationLimit: 1, weeklyEvaluationLimit: 2, enforced: false });
    expect(await submit(ids)).toMatchObject({ outcome: "QUEUED" });
    // No budget configured at all: unrestricted, with no reservation.
    await database.budgetSetting.deleteMany({ where: { id: "global" } });
    const more = await jobs(2);
    expect(await preflight(more)).toEqual({ outcome: "READY", count: 2, reservation: null });
  });

  it("rejects the whole submit when capacity was consumed after the preflight", async () => {
    const ids = await jobs(3);
    const other = await job();
    await settings({ dailyEvaluationLimit: 3 });
    expect(await preflight(ids)).toMatchObject({ outcome: "READY" });
    expect((await single(other)).outcome).toBe("QUEUED");
    expect(await submit(ids)).toEqual({ outcome: "LIMITS_EXCEEDED", shortfalls: [{ limit: "DAILY_EVALUATIONS", remaining: 2 }] });
    expect(await rows(ids)).toEqual(none);
  });

  it("never overshoots with simultaneous batches: room for one batch admits exactly one", async () => {
    const first = await jobs(2);
    const second = await jobs(2);
    await settings({ dailyEvaluationLimit: 2 });
    const results = await Promise.all([submit(first), submit(second)]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["LIMITS_EXCEEDED", "QUEUED"]);
    expect((await rows([...first, ...second])).evaluations).toBe(2);
  });

  it("admits a 50-job batch in one transaction", async () => {
    const ids = await jobs(50);
    const started = Date.now();
    const result = await submit(ids);
    expect(result.outcome).toBe("QUEUED");
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(await rows(ids)).toMatchObject({ admissions: 50, evaluations: 50, tasks: 50 });
  });
});

describe("C1: output tokens bound the whole batch", () => {
  it("refuses a batch the remaining allowance cannot hold although the limit is not reached, counting queued work at its worst case", async () => {
    // Precondition: no other queued, running or admitted work in the
    // database, so the committed worst case is only what this test creates.
    expect(await database.evaluationTask.count({ where: { status: { in: ["PENDING", "RUNNING"] } } })).toBe(0);
    expect(await database.evaluationAdmission.count({ where: { evaluationId: null, abandonedAt: null } })).toBe(0);
    const worst = worstCaseOutputTokens({
      callBudget: semanticConfig.callBudget,
      maxOutputTokens: semanticConfig.maxOutputTokens,
      operationMaximums: Object.values(semanticConfig.executionPolicy?.operations ?? {}).map((operation) => operation.maximumOutputTokens),
    });
    const ids = await jobs(3);
    // Nothing used yet; room for two and a half worst cases.
    await settings({ monthlyOutputTokenLimit: Math.floor(worst * 2.5) });
    expect(await preflight(ids)).toEqual({ outcome: "LIMITS_EXCEEDED", shortfalls: [{ limit: "MONTHLY_OUTPUT_TOKENS", remaining: 2 }] });
    expect(await preflight(ids.slice(0, 2))).toMatchObject({ outcome: "READY" });
    // A single request is still admitted under the existing single rule
    // (usage below the limit), and its worst case now counts.
    const queued = await job();
    expect((await single(queued)).outcome).toBe("QUEUED");
    expect(await preflight(ids.slice(0, 2))).toEqual({ outcome: "LIMITS_EXCEEDED", shortfalls: [{ limit: "MONTHLY_OUTPUT_TOKENS", remaining: 1 }] });
    // Calls the queued evaluation already made reduce its remaining worst
    // case; their reported tokens count as used.
    const evaluation = await database.evaluation.findFirstOrThrow({ where: { opportunityId: queued } });
    await recordAttempt(evaluation.id, 1, 0.01, clock.now);
    expect(await preflight(ids.slice(0, 1))).toMatchObject({ outcome: "READY" });
    expect(await rows(ids)).toEqual(none);
  });
});

describe("output-token potential: each provider call counted once in the current window", () => {
  const budgets = new PrismaBudgetRepository();
  const callBudget = semanticConfig.callBudget;
  const operationMaximums = Object.values(semanticConfig.executionPolicy?.operations ?? {}).map((operation) => operation.maximumOutputTokens);
  const worst = worstCaseOutputTokens({ callBudget, maxOutputTokens: semanticConfig.maxOutputTokens, operationMaximums });
  const perCall = worst / callBudget;
  // recordAttempt reports 200 output tokens per call (null when it reports none).
  const reportedPerCall = 200;
  const potential = () =>
    committedOutputTokenPotential({
      budgets,
      period: budgetPeriod(clock.now, "UTC"),
      execution: { callBudget, maxOutputTokens: semanticConfig.maxOutputTokens, operationMaximums },
      perEvaluation: worst,
    });
  async function queuedEvaluation() {
    const id = await job();
    expect((await single(id)).outcome).toBe("QUEUED");
    return { id, evaluation: await database.evaluation.findFirstOrThrow({ where: { opportunityId: id } }) };
  }
  const finish = async (evaluationId: string, status: "COMPLETED" | "FAILED" | "PENDING") => {
    await database.evaluationTask.updateMany({ where: { evaluationId }, data: { status } });
    await database.evaluation.update({ where: { id: evaluationId }, data: { status } });
  };

  beforeEach(async () => {
    // Precondition: nothing else queued, admitted or used in this window.
    await settings();
    expect(await database.evaluationTask.count({ where: { status: { in: ["PENDING", "RUNNING"] } } })).toBe(0);
    expect(await database.evaluationAdmission.count({ where: { evaluationId: null, abandonedAt: null } })).toBe(0);
    expect((await potential()).total).toBe(0);
  });

  it("replaces a call's estimate with its reported usage, and counts an unreported call once", async () => {
    const { evaluation } = await queuedEvaluation();
    expect(await potential()).toEqual({ reported: 0, unreported: 0, notYetMade: worst, admitted: 0, total: worst });
    // Call 1 reports its usage: the actual tokens replace its maximum.
    await recordAttempt(evaluation.id, 1, 0.01, clock.now);
    expect(await potential()).toEqual({
      reported: reportedPerCall,
      unreported: 0,
      notYetMade: (callBudget - 1) * perCall,
      admitted: 0,
      total: reportedPerCall + (callBudget - 1) * perCall,
    });
    // Call 2 reports none: it counts at its maximum, and only once (it is no
    // longer among the calls still to come).
    await recordAttempt(evaluation.id, 2, null, clock.now);
    expect(await potential()).toEqual({
      reported: reportedPerCall,
      unreported: perCall,
      notYetMade: (callBudget - 2) * perCall,
      admitted: 0,
      total: reportedPerCall + (callBudget - 1) * perCall,
    });
  });

  it("releases unused potential on completion, permanent failure and abandonment, keeping only the calls made", async () => {
    const completed = await queuedEvaluation();
    const failed = await queuedEvaluation();
    const retried = await queuedEvaluation();
    await recordAttempt(completed.evaluation.id, 1, 0.01, clock.now);
    await recordAttempt(failed.evaluation.id, 1, 0.01, clock.now);
    await recordAttempt(retried.evaluation.id, 1, 0.01, clock.now);
    expect((await potential()).total).toBe(3 * (reportedPerCall + (callBudget - 1) * perCall));
    await finish(completed.evaluation.id, "COMPLETED");
    await finish(failed.evaluation.id, "FAILED");
    // A retryable failure goes back to the queue and keeps what it may still use.
    await finish(retried.evaluation.id, "PENDING");
    expect(await potential()).toEqual({
      reported: 3 * reportedPerCall,
      unreported: 0,
      notYetMade: (callBudget - 1) * perCall,
      admitted: 0,
      total: 3 * reportedPerCall + (callBudget - 1) * perCall,
    });
    // An admission not yet enqueued holds the worst case until abandoned.
    const admitted = await job();
    const admission = await database.evaluationAdmission.create({ data: { opportunityId: admitted, createdAt: clock.now } });
    expect((await potential()).admitted).toBe(worst);
    await budget.gate.abandon(admission.id);
    expect((await potential()).admitted).toBe(0);
  });

  it("counts only this window: calls made last month are neither used now nor still to come", async () => {
    const { evaluation } = await queuedEvaluation();
    const lastMonth = new Date("2032-05-20T12:00:00.000Z");
    await recordAttempt(evaluation.id, 1, 0.01, lastMonth);
    await recordAttempt(evaluation.id, 2, null, lastMonth);
    expect(await potential()).toEqual({ reported: 0, unreported: 0, notYetMade: (callBudget - 2) * perCall, admitted: 0, total: (callBudget - 2) * perCall });
    // A finished evaluation from last month counts nothing in this window.
    await finish(evaluation.id, "COMPLETED");
    expect((await potential()).total).toBe(0);
  });
});

describe("eligibility", () => {
  it("refuses the whole batch for queued, completed, deferred or triage-held jobs and writes nothing", async () => {
    await settings();
    const fresh = await job();
    const queued = await job();
    const completed = await job();
    const deferred = await job();
    const review = await job({ salary: null });
    // Complete one job's evaluation first (the worker takes the oldest
    // queued task), then queue another.
    expect((await single(completed)).outcome).toBe("QUEUED");
    while ((await database.evaluation.count({ where: { opportunityId: completed, status: "COMPLETED" } })) === 0) await runWorker();
    expect((await single(queued)).outcome).toBe("QUEUED");
    await settings({ amount: 0.5 });
    expect((await single(deferred)).outcome).toBe("DEFERRED");
    await settings();
    const result = await submit([fresh, queued, completed, deferred, review]);
    expect(result).toEqual({
      outcome: "INELIGIBLE",
      items: [{ opportunityId: review, reason: "TRIAGE_NEEDS_REVIEW" }],
    });
    // Triage passes for the others; the locked checks then name each one.
    const locked = await submit([fresh, queued, completed, deferred]);
    expect(locked).toEqual({
      outcome: "INELIGIBLE",
      items: [
        { opportunityId: queued, reason: "ALREADY_ACTIVE" },
        { opportunityId: completed, reason: "ALREADY_EVALUATED" },
        { opportunityId: deferred, reason: "DEFERRED" },
      ],
    });
    expect(await rows([fresh])).toEqual(none);
  });

  it("refuses a job whose exact duplicate has an evaluation, and two selected captures of one listing", async () => {
    await settings();
    const pair = await twinPair();
    expect(await submit([pair.a, pair.b])).toEqual({
      outcome: "INELIGIBLE",
      items: [{ opportunityId: pair.a, reason: "SAME_LISTING_SELECTED" }, { opportunityId: pair.b, reason: "SAME_LISTING_SELECTED" }],
    });
    expect((await single(pair.a)).outcome).toBe("QUEUED");
    expect(await submit([pair.b])).toEqual({ outcome: "INELIGIBLE", items: [{ opportunityId: pair.b, reason: "DUPLICATE_OF_EVALUATED" }] });
    expect(await rows([pair.b])).toEqual(none);
  });
});

describe("C2: eligibility matches the individual request", () => {
  it("a FAILED latest evaluation is retried by both, even after an older completed one; a pending one is refused by both", async () => {
    await settings();
    // Two jobs in identical states, one per path.
    const [bulkJob, singleJob] = await jobs(2);
    for (const id of [bulkJob!, singleJob!]) {
      expect((await single(id)).outcome).toBe("QUEUED");
      await markLatestFailed(id);
    }
    expect(await submit([bulkJob!])).toMatchObject({ outcome: "QUEUED" });
    expect((await single(singleJob!)).outcome).toBe("QUEUED");
    // Now both are pending: both paths refuse.
    expect(await submit([bulkJob!])).toEqual({ outcome: "INELIGIBLE", items: [{ opportunityId: bulkJob, reason: "ALREADY_ACTIVE" }] });
    expect(await refusal(single(singleJob!))).toBe("EVALUATION_ALREADY_ACTIVE");

    // An older COMPLETED evaluation, then a FAILED latest one: both retry.
    const [older1, older2] = await jobs(2);
    for (const id of [older1!, older2!]) {
      expect((await single(id)).outcome).toBe("QUEUED");
      while ((await database.evaluation.count({ where: { opportunityId: id, status: "COMPLETED" } })) === 0) await runWorker();
      expect((await single(id)).outcome).toBe("QUEUED");
      await markLatestFailed(id);
    }
    expect(await submit([older1!])).toMatchObject({ outcome: "QUEUED" });
    expect((await single(older2!)).outcome).toBe("QUEUED");
  });

  it("creates the same evaluation as the individual request (listing version, profile version, execution metadata)", async () => {
    await settings();
    // A per-evaluation call allowance below the deployment maximum (seeded
    // directly: this test's budget service has no allowance bounds).
    const allowance = semanticConfig.callBudget - 1;
    await database.budgetSetting.update({ where: { id: "global" }, data: { evaluationCallLimit: allowance } });
    const id = await job();
    expect(await submit([id])).toMatchObject({ outcome: "QUEUED" });
    await markLatestFailed(id);
    expect((await single(id)).outcome).toBe("QUEUED");
    const [individual, bulk] = await database.evaluation.findMany({ where: { opportunityId: id }, orderBy: { createdAt: "desc" } });
    const comparable = (evaluation: typeof bulk) => ({
      sourceRecordId: evaluation!.sourceRecordId,
      userProfileId: evaluation!.userProfileId,
      userProfileVersion: evaluation!.userProfileVersion,
      evaluationVersion: evaluation!.evaluationVersion,
      promptVersion: evaluation!.promptVersion,
      executionMetadata: evaluation!.executionMetadata,
    });
    expect(comparable(bulk)).toEqual(comparable(individual));
    expect(bulk!.sourceRecordId).not.toBeNull();
    expect((bulk!.executionMetadata as { semanticCallBudget: number }).semanticCallBudget).toBe(allowance);
    // The same reservation as a single admission.
    const reservations = await database.evaluationBudgetReservation.findMany({ where: { admission: { opportunityId: id } } });
    expect(reservations.map((reservation) => Number(reservation.amount))).toEqual([1, 1]);
  });

  it("decides duplicate spend the same way: a twin of an evaluated job is refused by both", async () => {
    await settings();
    const first = await twinPair();
    const second = await twinPair();
    for (const pair of [first, second]) {
      expect((await single(pair.a)).outcome).toBe("QUEUED");
    }
    expect(await submit([first.b])).toEqual({ outcome: "INELIGIBLE", items: [{ opportunityId: first.b, reason: "DUPLICATE_OF_EVALUATED" }] });
    expect(await refusal(single(second.b))).toBe("DUPLICATE_LISTING_ALREADY_EVALUATED");
  });
});

describe("C3: one transaction from the final checks to the commit", () => {
  it("a concurrent request cannot enter between the batch's final checks and its commit", async () => {
    await settings();
    const pair = await twinPair();
    let entered!: () => void;
    let release!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    const batch = submit([pair.a], async () => {
      entered();
      await held;
    });
    await inside;
    // The batch has passed every check and written its rows; it holds both
    // locks until its commit. Requests for the twin and for the job itself:
    const settled: string[] = [];
    const twin = single(pair.b).then(() => "admitted", (error: EvaluationApiError) => error.code).then((code) => (settled.push(`twin:${code}`), code));
    const same = single(pair.a).then(() => "admitted", (error: EvaluationApiError) => error.code).then((code) => (settled.push(`same:${code}`), code));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    // Neither request got past the locks while the batch held them.
    expect(settled).toEqual([]);
    expect(await database.evaluation.count({ where: { opportunityId: { in: [pair.a, pair.b] } } })).toBe(0);
    release();
    expect(await batch).toMatchObject({ outcome: "QUEUED" });
    expect(await twin).toBe("DUPLICATE_LISTING_ALREADY_EVALUATED");
    expect(await same).toBe("EVALUATION_ALREADY_ACTIVE");
    // One paid evaluation for the listing; no deadlock.
    expect(await database.evaluation.count({ where: { opportunityId: { in: [pair.a, pair.b] } } })).toBe(1);
  });

  it("and the reverse: an individual admission committed first makes the batch's final check refuse", async () => {
    await settings();
    const pair = await twinPair();
    expect((await single(pair.a)).outcome).toBe("QUEUED");
    expect(await submit([pair.b])).toEqual({ outcome: "INELIGIBLE", items: [{ opportunityId: pair.b, reason: "DUPLICATE_OF_EVALUATED" }] });
    expect(await submit([pair.a])).toEqual({ outcome: "INELIGIBLE", items: [{ opportunityId: pair.a, reason: "ALREADY_ACTIVE" }] });
  });
});
