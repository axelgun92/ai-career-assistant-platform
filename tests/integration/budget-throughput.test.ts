import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
} from "@ai-career/database";
import { createBudgetApiHandlers, createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import {
  captureOpportunity,
  createCleanup,
  createHarness,
  createProfile,
  database,
  recordAttempt,
  runWorker,
  semanticConfig,
  tasks,
} from "../support/budget-integration";

// Throughput limits, warnings, the per-evaluation call allowance and the
// operational report. Window tests run on a fixed clock far from real time
// so their day/week windows contain only rows these tests create.

const cleanup = createCleanup();
const clock = { now: new Date("2031-03-12T15:00:00.000Z") }; // a Wednesday
let harness = createHarness(clock);
let profileId = "";

beforeEach(async () => {
  clock.now = new Date("2031-03-12T15:00:00.000Z");
  harness = createHarness(clock);
  await cleanup.before();
  profileId = (await createProfile(cleanup)).id;
});
afterEach(() => cleanup.after());
afterAll(() => database.$disconnect());

const baseSettings = {
  amount: 100,
  currency: "USD",
  timeZone: "UTC",
  reservePerEvaluation: 0.01,
  enforced: true,
};

function settings(patch: Record<string, unknown> = {}, budget = harness.budget) {
  return budget.updateSettings({ ...baseSettings, ...patch });
}

async function request(opportunityId: string, service = harness.service) {
  return service.requestEvaluation(opportunityId, { userProfileId: profileId });
}

async function deferralFor(opportunityId: string) {
  return database.deferredEvaluation.findFirstOrThrow({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
}

describe("volume limits", () => {
  it("defer as an operational state, keep the request, and release it after the day resets", async () => {
    await settings({ dailyEvaluationLimit: 1 });
    const first = await captureOpportunity(cleanup);
    const second = await captureOpportunity(cleanup);
    expect(await request(first)).toMatchObject({ outcome: "QUEUED" });

    const deferred = await request(second);
    expect(deferred).toMatchObject({ outcome: "DEFERRED", reason: "USAGE_LIMIT_REACHED" });
    const row = await deferralFor(second);
    expect(row).toMatchObject({ status: "DEFERRED", reasonCode: "USAGE_LIMIT_REACHED", userProfileId: profileId });
    expect((row.reasonSnapshot as { limits: { reached: string[] } }).limits.reached).toEqual(["DAILY_EVALUATIONS"]);
    expect(await database.evaluation.count({ where: { opportunityId: second } })).toBe(0);
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: second } })).status).toBe("NORMALIZED");

    // Same day: still deferred; the next day (UTC) it is released exactly once.
    expect(await harness.service.resumeDeferred(row.id)).toMatchObject({ outcome: "DEFERRED", resumed: true });
    clock.now = new Date("2031-03-13T00:00:01.000Z");
    expect(await harness.service.resumeDeferred(row.id)).toMatchObject({ outcome: "QUEUED" });
    expect(await database.evaluationAdmission.count({ where: { opportunityId: second, abandonedAt: null } })).toBe(1);
    expect((await database.evaluation.findFirstOrThrow({ where: { opportunityId: second } })).userProfileId).toBe(profileId);

    // Restart-safe: a fresh service instance reads the same persisted usage.
    const status = await createHarness(clock).budget.status();
    if (!status.configured) throw new Error("expected a budget");
    expect(status.limits.daily).toMatchObject({ limit: 1, used: 1, window: "2031-03-13" });
  });

  it("weekly limits reset on Monday in the budget time zone", async () => {
    await settings({ weeklyEvaluationLimit: 1, timeZone: "America/New_York" });
    // Sunday 23:30 in New York (EDT) is already Monday in UTC.
    clock.now = new Date("2031-03-17T03:30:00.000Z");
    const first = await captureOpportunity(cleanup);
    const second = await captureOpportunity(cleanup);
    expect(await request(first)).toMatchObject({ outcome: "QUEUED" });
    expect(await request(second)).toMatchObject({ outcome: "DEFERRED", reason: "USAGE_LIMIT_REACHED" });
    const status = await harness.budget.status();
    if (!status.configured) throw new Error("expected a budget");
    expect(status.limits.weekly).toMatchObject({ used: 1, window: "2031-03-10", resetsAt: "2031-03-17T04:00:00.000Z" });

    clock.now = new Date("2031-03-17T04:30:00.000Z"); // Monday 00:30 in New York
    expect(await harness.service.resumeDeferred((await deferralFor(second)).id)).toMatchObject({ outcome: "QUEUED" });
  });

  it("simultaneous requests never exceed the daily limit", async () => {
    await settings({ dailyEvaluationLimit: 2 });
    const opportunities = await Promise.all(Array.from({ length: 6 }, () => captureOpportunity(cleanup)));
    const results = await Promise.all(opportunities.map((id) => request(id)));
    expect(results.filter((result) => result.outcome === "QUEUED")).toHaveLength(2);
    expect(results.filter((result) => result.outcome === "DEFERRED")).toHaveLength(4);
    expect(await database.evaluationAdmission.count({ where: { opportunityId: { in: opportunities }, abandonedAt: null } })).toBe(2);
  });

  it("when the budget and a limit both block, the reason names the budget and both are recorded", async () => {
    await settings({ dailyEvaluationLimit: 1, amount: 0.5, reservePerEvaluation: 0.4 });
    const first = await captureOpportunity(cleanup);
    const second = await captureOpportunity(cleanup);
    expect(await request(first)).toMatchObject({ outcome: "QUEUED" });
    expect(await request(second)).toMatchObject({ outcome: "DEFERRED", reason: "AI_BUDGET_LIMIT" });
    const snapshot = (await deferralFor(second)).reasonSnapshot as { limits: { reached: string[] } };
    expect(snapshot.limits.reached).toEqual(["BUDGET", "DAILY_EVALUATIONS"]);
  });

  it("are reported but never defer while enforcement is off", async () => {
    await settings({ dailyEvaluationLimit: 1, enforced: false, reservePerEvaluation: 0 });
    const first = await captureOpportunity(cleanup);
    const second = await captureOpportunity(cleanup);
    expect(await request(first)).toMatchObject({ outcome: "QUEUED" });
    expect(await request(second)).toMatchObject({ outcome: "QUEUED" });
    const status = await harness.budget.status();
    if (!status.configured) throw new Error("expected a budget");
    expect(status.limits).toMatchObject({ enforced: false, reached: ["DAILY_EVALUATIONS"], daily: { used: 2, limit: 1 } });
  });
});

describe("monthly output-token limit", () => {
  it("counts only provider-reported output tokens, keeps unreported ones Unknown, and never stops running work", async () => {
    await settings({ monthlyOutputTokenLimit: 300 });
    const [a, b, c] = [await captureOpportunity(cleanup), await captureOpportunity(cleanup), await captureOpportunity(cleanup)];
    const queuedA = await request(a);
    if (queuedA.outcome !== "QUEUED") throw new Error("expected a queued evaluation");
    await recordAttempt(queuedA.evaluationId, 1, 0.01, clock.now); // 200 output tokens
    await recordAttempt(queuedA.evaluationId, 2, null, clock.now); // tokens not reported

    const queuedB = await request(b);
    if (queuedB.outcome !== "QUEUED") throw new Error("200 of 300 tokens should still admit");
    await recordAttempt(queuedB.evaluationId, 1, 0.01, clock.now); // 400 reported in total

    expect(await request(c)).toMatchObject({ outcome: "DEFERRED", reason: "USAGE_LIMIT_REACHED" });
    expect(((await deferralFor(c)).reasonSnapshot as { limits: { reached: string[] } }).limits.reached).toEqual([
      "MONTHLY_OUTPUT_TOKENS",
    ]);
    const status = await harness.budget.status();
    if (!status.configured) throw new Error("expected a budget");
    expect(status.limits.outputTokens).toEqual({ limit: 300, used: 400, unreportedAttempts: 1 });
    // Already-queued work is not cancelled by reaching (or lowering) a limit.
    for (const evaluationId of [queuedA.evaluationId, queuedB.evaluationId]) {
      expect((await tasks.getByEvaluationId(evaluationId))?.status).toBe("PENDING");
    }
  });
});

describe("warning thresholds", () => {
  it("derive the warning from configured thresholds over spent plus reserved", async () => {
    await settings({ amount: 1, reservePerEvaluation: 0.3, warningThresholds: [80, 25, 50] });
    const status = await harness.budget.status();
    if (!status.configured) throw new Error("expected a budget");
    expect(status.settings.warningThresholds).toEqual([25, 50, 80]);
    expect(status.warning).toMatchObject({ reached: null, usedPercent: 0 });

    const queued = await request(await captureOpportunity(cleanup)); // holds 0.30
    if (queued.outcome !== "QUEUED") throw new Error("expected a queued evaluation");
    const held = await harness.budget.status();
    if (!held.configured) throw new Error("expected a budget");
    expect(held.warning).toEqual({ usedPercent: 30, reached: 25, thresholds: [25, 50, 80] });
  });

  it("rejects invalid limit settings with field errors and saves nothing", async () => {
    await expect(settings({ warningThresholds: [80, 80] })).rejects.toMatchObject({
      code: "BUDGET_INVALID",
      issues: expect.arrayContaining([expect.objectContaining({ path: "warningThresholds" })]),
    });
    await expect(settings({ dailyEvaluationLimit: 5, weeklyEvaluationLimit: 3 })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: "weeklyEvaluationLimit" })]),
    });
    expect(await database.budgetSetting.count()).toBe(0);
  });
});

describe("per-evaluation AI call allowance", () => {
  it("can only lower the system maximum, never below a normal evaluation, and is persisted on each evaluation", async () => {
    const budget = createBudgetService({
      now: () => clock.now,
      pricingCurrencies: () => ["USD"],
      callLimitBounds: () => ({ minimum: 9, maximum: semanticConfig.callBudget }),
    });
    const service = createEvaluationService({
      queries: new PrismaEvaluationQueryRepository(),
      evaluations: new PrismaEvaluationRepository(),
      tasks,
      semanticConfig,
      jobMaxAttempts: 1,
      admissionGate: budget.gate,
    });
    await expect(settings({ evaluationCallLimit: semanticConfig.callBudget + 1 }, budget)).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: "evaluationCallLimit", message: expect.stringContaining("system maximum") })],
    });
    await expect(settings({ evaluationCallLimit: 8 }, budget)).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: "evaluationCallLimit", message: expect.stringContaining("at least 9") })],
    });
    // Without AI configuration the bounds are unknown, so it cannot be set.
    await expect(settings({ evaluationCallLimit: 10 })).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: "evaluationCallLimit" })],
    });

    await settings({ evaluationCallLimit: 10 }, budget);
    const limited = await request(await captureOpportunity(cleanup), service);
    if (limited.outcome !== "QUEUED") throw new Error("expected a queued evaluation");
    const metadata = (await database.evaluation.findUniqueOrThrow({ where: { id: limited.evaluationId } }))
      .executionMetadata as { semanticCallBudget: number };
    expect(metadata.semanticCallBudget).toBe(10);

    await settings({ evaluationCallLimit: null }, budget);
    const unlimited = await request(await captureOpportunity(cleanup), service);
    if (unlimited.outcome !== "QUEUED") throw new Error("expected a queued evaluation");
    expect(
      ((await database.evaluation.findUniqueOrThrow({ where: { id: unlimited.evaluationId } })).executionMetadata as {
        semanticCallBudget: number;
      }).semanticCallBudget,
    ).toBe(semanticConfig.callBudget);
    // The earlier evaluation keeps the allowance it was queued with.
    expect(
      ((await database.evaluation.findUniqueOrThrow({ where: { id: limited.evaluationId } })).executionMetadata as {
        semanticCallBudget: number;
      }).semanticCallBudget,
    ).toBe(10);
  });
});

describe("operational report", () => {
  it("reports counts, provider-reported tokens, estimates with their basis, spend over time and no secrets", async () => {
    clock.now = new Date();
    harness = createHarness(clock);
    const budget = createBudgetService({
      now: () => clock.now,
      pricingCurrencies: () => ["USD"],
      executableDomains: ["customer-success"],
      executionBasis: () => ({ policyVersion: "policy-from-config", pricingVersions: ["pricing-a"], currency: "USD" }),
    });
    const before = await budget.report();

    await settings({ amount: 100, reservePerEvaluation: 0.5, dailyEvaluationLimit: 50 }, budget);
    const evaluated = await captureOpportunity(cleanup);
    const queued = await request(evaluated);
    if (queued.outcome !== "QUEUED") throw new Error("expected a queued evaluation");
    expect(await runWorker()).toMatchObject({ status: "COMPLETED" });
    await captureOpportunity(cleanup); // eligible, never evaluated
    const waiting = await captureOpportunity(cleanup);
    await settings({ amount: 0, reservePerEvaluation: 0.5 }, budget);
    expect(await request(waiting)).toMatchObject({ outcome: "DEFERRED" });
    await recordAttempt(queued.evaluationId, 99, null); // a later attempt with unknown cost and tokens

    const report = await budget.report();
    expect(report.counts.totals.evaluated - before.counts.totals.evaluated).toBe(1);
    expect(report.counts.totals.deferred - before.counts.totals.deferred).toBe(1);
    expect(report.counts.totals.eligibleNotEvaluated - before.counts.totals.eligibleNotEvaluated).toBe(1);
    expect(report.counts.breakdown.find((row) => row.domain === "customer-success" && row.sourceType === "MANUAL"))
      .toBeDefined();

    expect(report.tokens.attempts).toBeGreaterThan(0);
    expect(report.tokens.attemptsWithoutOutputTokens).toBeGreaterThanOrEqual(1);
    expect(report.basis).toMatchObject({ policyVersion: "policy-from-config", configuredPricingVersions: ["pricing-a"] });

    const costs = (await database.semanticOperationAttempt.findMany({ where: { evaluationId: queued.evaluationId } }))
      .map((attempt) => attempt.estimatedCost?.toNumber() ?? null);
    if (costs.every((cost) => cost !== null)) {
      // (Only when the fixture recorded every cost; otherwise the estimate stays Unknown.)
      expect(report.capacity.averageEvaluationCost).not.toBeNull();
    }
    // Deferred backlog cost is average × deferred count, or Unknown without a basis.
    expect(report.capacity.deferredBacklogCost).toBe(
      report.capacity.averageEvaluationCost === null
        ? null
        : Number((report.capacity.averageEvaluationCost * report.counts.totals.deferred).toFixed(12)),
    );
    const today = report.spendOverTime.daily.at(-1)!;
    expect(today.label).toBe(clock.now.toISOString().slice(0, 10));
    expect(today.unknownCostAttempts).toBeGreaterThanOrEqual(1);
    expect(report.spendOverTime.monthly.at(-1)?.label).toBe(report.period.label);

    const response = await createBudgetApiHandlers(budget).report();
    expect(response.status).toBe(200);
    const json = await response.text();
    for (const secret of ["providerRequestId", "req-budget-", "apiKey", "deterministic-integration-key"]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("deferral reason naming", () => {
  it("records AI_BUDGET_LIMIT, and reads rows written as BUDGET_UNAVAILABLE as the same reason without rewriting them", async () => {
    await settings({ amount: 0.2, reservePerEvaluation: 0.5 });
    const opportunityId = await captureOpportunity(cleanup);
    expect(await request(opportunityId)).toMatchObject({ outcome: "DEFERRED", reason: "AI_BUDGET_LIMIT" });
    const row = await deferralFor(opportunityId);
    expect(row.reasonCode).toBe("AI_BUDGET_LIMIT");

    // A row written before the TDD name was adopted.
    await database.$executeRaw`UPDATE "DeferredEvaluation" SET "reasonCode" = 'BUDGET_UNAVAILABLE' WHERE "id" = ${row.id}::uuid`;
    expect((await harness.budget.listDeferred("DEFERRED")).find((item) => item.id === row.id)?.reasonCode).toBe("AI_BUDGET_LIMIT");
    expect((await harness.budget.gate.findOpenDeferral(opportunityId))?.reasonCode).toBe("AI_BUDGET_LIMIT");
    expect((await deferralFor(opportunityId)).reasonCode).toBe("BUDGET_UNAVAILABLE"); // reads never rewrite

    // A normal recheck records the current reason, as it always did.
    expect(await harness.service.resumeDeferred(row.id)).toMatchObject({ outcome: "DEFERRED", reason: "AI_BUDGET_LIMIT", resumed: true });
    expect((await deferralFor(opportunityId)).reasonCode).toBe("AI_BUDGET_LIMIT");
  });
});
