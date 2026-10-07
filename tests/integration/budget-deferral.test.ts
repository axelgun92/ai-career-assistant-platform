import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaOpportunityLifecycleRepository } from "@ai-career/database";
import {
  activeEvaluationCount,
  captureOpportunity,
  createCleanup,
  createHarness,
  createProfile,
  database,
  recordAttempt,
  runWorker,
  setBudget,
  tasks,
} from "../support/budget-integration";

const cleanup = createCleanup();
const clock = { now: new Date() };
let { budget, service } = createHarness(clock);

beforeEach(async () => {
  clock.now = new Date();
  ({ budget, service } = createHarness(clock));
  await cleanup.before();
});
afterEach(() => cleanup.after());
afterAll(() => database.$disconnect());

async function setup() {
  const profile = await createProfile(cleanup);
  return { profile, opportunityId: await captureOpportunity(cleanup) };
}

async function admissionFor(evaluationId: string) {
  return database.evaluationAdmission.findUniqueOrThrow({
    where: { evaluationId },
    include: { reservation: true },
  });
}

async function completeTask(evaluationId: string) {
  const task = await database.evaluationTask.findUniqueOrThrow({ where: { evaluationId } });
  await database.evaluationTask.update({ where: { id: task.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await database.evaluation.update({ where: { id: evaluationId }, data: { status: "COMPLETED", completedAt: new Date() } });
}

async function configuredStatus() {
  const status = await budget.status();
  if (!status.configured) throw new Error("Expected a configured budget");
  return status;
}

describe("no budget configured", () => {
  it("queues as before, with no reservation and no deferral", async () => {
    const { profile, opportunityId } = await setup();
    const result = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(result).toMatchObject({ outcome: "QUEUED", status: "PENDING", domain: "customer-success" });
    if (result.outcome !== "QUEUED") throw new Error("unreachable");
    const admission = await admissionFor(result.evaluationId);
    expect(admission.reservation).toBeNull();
    expect(await database.deferredEvaluation.count({ where: { opportunityId } })).toBe(0);
    expect(await budget.status()).toEqual({ configured: false, openDeferrals: 0 });
  });
});

describe("budget gate", () => {
  it("admits an evaluation that fits, holding the reserve", async () => {
    await setBudget({ amount: 1, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    const result = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(result.outcome).toBe("QUEUED");
    if (result.outcome !== "QUEUED") throw new Error("unreachable");
    expect((await admissionFor(result.evaluationId)).reservation).toMatchObject({ currency: "USD", enforced: true });
    const status = await configuredStatus();
    expect(status).toMatchObject({ knownSpent: 0, held: 0.6, remaining: 0.4, heldEvaluations: 1 });
  });

  it("defers when budget is unavailable: no evaluation, task or attempt, and the lifecycle is untouched", async () => {
    await setBudget({ amount: 1, reservePerEvaluation: 0.6 });
    const first = await setup();
    await service.requestEvaluation(first.opportunityId, { userProfileId: first.profile.id });
    const second = await setup();
    const lifecycle = new PrismaOpportunityLifecycleRepository();
    expect((await lifecycle.applyUserAction({ opportunityId: second.opportunityId, action: "SAVE" })).status).toBe("APPLIED");

    const result = await service.requestEvaluation(second.opportunityId, { userProfileId: second.profile.id });
    expect(result).toMatchObject({
      outcome: "DEFERRED",
      reason: "BUDGET_UNAVAILABLE",
      resumed: false,
      userProfileVersion: 1,
      budget: { amount: 1, held: 0.6, available: 0.4, reserve: 0.6, currency: "USD", enforced: true },
    });
    expect(await database.evaluation.count({ where: { opportunityId: second.opportunityId } })).toBe(0);
    expect(await database.evaluationTask.count({ where: { evaluation: { opportunityId: second.opportunityId } } })).toBe(0);
    expect(await database.semanticOperationAttempt.count({ where: { opportunityId: second.opportunityId } })).toBe(0);
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: second.opportunityId } })).status).toBe("SAVED");

    // Persistent backlog, visible to fresh service instances ("restart").
    const restarted = createHarness(clock);
    const open = await restarted.service.getOpenDeferral(second.opportunityId);
    expect(open).toMatchObject({ status: "DEFERRED", userProfileId: second.profile.id, reasonCode: "BUDGET_UNAVAILABLE" });
    expect((await restarted.budget.listDeferred("DEFERRED")).map((item) => item.opportunityId)).toContain(second.opportunityId);
    expect((await configuredStatus()).openDeferrals).toBe(1);
  });

  it("resume re-checks budget, then queues once budget is available and reconciles to the actual cost", async () => {
    await setBudget({ amount: 1, reservePerEvaluation: 0.6 });
    const first = await setup();
    await service.requestEvaluation(first.opportunityId, { userProfileId: first.profile.id });
    const second = await setup();
    const deferred = await service.requestEvaluation(second.opportunityId, { userProfileId: second.profile.id });
    if (deferred.outcome !== "DEFERRED") throw new Error("expected deferral");

    clock.now = new Date(clock.now.getTime() + 60_000);
    const still = await service.resumeDeferred(deferred.deferredEvaluationId);
    expect(still).toMatchObject({ outcome: "DEFERRED", resumed: true });
    const row = await database.deferredEvaluation.findUniqueOrThrow({ where: { id: deferred.deferredEvaluationId } });
    expect(row).toMatchObject({ status: "DEFERRED", lastCheckedAt: clock.now });

    // The first evaluation finishes; its hold becomes its actual cost.
    expect((await runWorker())?.status).toBe("COMPLETED");
    const resumed = await service.resumeDeferred(deferred.deferredEvaluationId);
    expect(resumed).toMatchObject({ outcome: "QUEUED" });
    if (resumed.outcome !== "QUEUED") throw new Error("unreachable");
    expect(await database.deferredEvaluation.findUniqueOrThrow({ where: { id: deferred.deferredEvaluationId } })).toMatchObject({
      status: "RESUMED",
      resumedAt: clock.now,
    });
    expect((await service.getOpenDeferral(second.opportunityId))).toBeNull();
    expect((await budget.listDeferred("RESUMED")).find((item) => item.id === deferred.deferredEvaluationId)?.resumedEvaluationId)
      .toBe(resumed.evaluationId);

    expect((await runWorker())?.status).toBe("COMPLETED");
    const attempts = await database.semanticOperationAttempt.findMany({
      where: { opportunityId: { in: [first.opportunityId, second.opportunityId] } },
      select: { estimatedCost: true },
    });
    expect(attempts.length).toBeGreaterThan(0);
    const actual = Number(attempts.reduce((total, attempt) => total + (attempt.estimatedCost?.toNumber() ?? 0), 0).toFixed(12));
    const status = await configuredStatus();
    expect(status).toMatchObject({ knownSpent: actual, held: 0, heldEvaluations: 0 });
    expect(status.remaining).toBeCloseTo(1 - actual, 12);
  });

  it("counts known cost even when the same evaluation has an unknown-cost attempt, and keeps its hold", async () => {
    await setBudget({ amount: 1, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    const result = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    if (result.outcome !== "QUEUED") throw new Error("expected queue");
    await recordAttempt(result.evaluationId, 1, 0.07);
    await recordAttempt(result.evaluationId, 2, null);
    await completeTask(result.evaluationId);

    const status = await configuredStatus();
    expect(status).toMatchObject({ knownSpent: 0.07, unknownAttempts: 1, otherCurrencyAttempts: 0, heldEvaluations: 1 });
    // Unknown cost is never $0: the rest of the reserve stays held.
    expect(status.held).toBeCloseTo(0.53, 12);
    expect(status.remaining).toBeCloseTo(0.4, 12);
  });

  it("two requests with room for one: exactly one queued, one deferred", async () => {
    await setBudget({ amount: 1, reservePerEvaluation: 0.6 });
    const a = await setup();
    const b = await setup();
    const results = await Promise.all([
      service.requestEvaluation(a.opportunityId, { userProfileId: a.profile.id }),
      service.requestEvaluation(b.opportunityId, { userProfileId: b.profile.id }),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["DEFERRED", "QUEUED"]);
    expect((await configuredStatus()).held).toBe(0.6);
  });

  it("two resumes with room for one: exactly one resumes", async () => {
    await setBudget({ amount: 1, reservePerEvaluation: 0.6 });
    const blocker = await setup();
    const blocking = await service.requestEvaluation(blocker.opportunityId, { userProfileId: blocker.profile.id });
    if (blocking.outcome !== "QUEUED") throw new Error("expected queue");
    const a = await setup();
    const b = await setup();
    const deferredA = await service.requestEvaluation(a.opportunityId, { userProfileId: a.profile.id });
    const deferredB = await service.requestEvaluation(b.opportunityId, { userProfileId: b.profile.id });
    if (deferredA.outcome !== "DEFERRED" || deferredB.outcome !== "DEFERRED") throw new Error("expected deferrals");

    await completeTask(blocking.evaluationId); // hold released; room for one more
    const results = await Promise.all([
      service.resumeDeferred(deferredA.deferredEvaluationId),
      service.resumeDeferred(deferredB.deferredEvaluationId),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["DEFERRED", "QUEUED"]);
    expect(await database.deferredEvaluation.count({ where: { status: "RESUMED", opportunityId: { in: [a.opportunityId, b.opportunityId] } } })).toBe(1);
  });
});

describe("deferred request contract", () => {
  it("resumes with the pinned profile version even after another version becomes active", async () => {
    await setBudget({ amount: 0.5, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    const deferred = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    if (deferred.outcome !== "DEFERRED") throw new Error("expected deferral");

    const other = await createProfile(cleanup);
    const activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" } });
    await database.activeUserProfile.upsert({
      where: { domain: "customer-success" },
      create: { domain: "customer-success", userProfileId: other.id },
      update: { userProfileId: other.id },
    });
    try {
      // A plain request for the opportunity resumes the deferral rather than
      // creating a second request with the newly active profile.
      await setBudget({ amount: 5, reservePerEvaluation: 0.6 });
      const resumed = await service.requestEvaluation(opportunityId, {});
      if (resumed.outcome !== "QUEUED") throw new Error("expected queue");
      expect(await database.evaluation.findUniqueOrThrow({ where: { id: resumed.evaluationId } })).toMatchObject({
        userProfileId: profile.id,
        userProfileVersion: 1,
      });
      expect(await database.deferredEvaluation.count({ where: { opportunityId } })).toBe(1);
    } finally {
      await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
      if (activeBefore) await database.activeUserProfile.create({ data: activeBefore });
    }
  });

  it("refuses to resume when the pinned profile no longer exists, and keeps the request", async () => {
    await setBudget({ amount: 0.5, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    const deferred = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    if (deferred.outcome !== "DEFERRED") throw new Error("expected deferral");
    await database.userProfile.delete({ where: { id: profile.id } });
    await setBudget({ amount: 5, reservePerEvaluation: 0.6 });
    await expect(service.resumeDeferred(deferred.deferredEvaluationId)).rejects.toMatchObject({
      code: "DEFERRED_PROFILE_UNAVAILABLE",
    });
    expect((await service.getOpenDeferral(opportunityId))?.id).toBe(deferred.deferredEvaluationId);
  });

  it("does not resume an archived opportunity, and can be cancelled", async () => {
    await setBudget({ amount: 0.5, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    const deferred = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    if (deferred.outcome !== "DEFERRED") throw new Error("expected deferral");
    await new PrismaOpportunityLifecycleRepository().applyUserAction({ opportunityId, action: "ARCHIVE" });
    await setBudget({ amount: 5, reservePerEvaluation: 0.6 });
    await expect(service.resumeDeferred(deferred.deferredEvaluationId)).rejects.toMatchObject({
      code: "OPPORTUNITY_NOT_EVALUABLE",
    });
    expect(await service.cancelDeferred(deferred.deferredEvaluationId)).toEqual({
      deferredEvaluationId: deferred.deferredEvaluationId,
      status: "CANCELLED",
    });
    await expect(service.resumeDeferred(deferred.deferredEvaluationId)).rejects.toMatchObject({ code: "DEFERRAL_NOT_OPEN" });
    await expect(service.cancelDeferred(deferred.deferredEvaluationId)).rejects.toMatchObject({ code: "DEFERRAL_NOT_OPEN" });
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(0);
  });

  it("a resume whose enqueue never happened returns to the backlog after the admission is abandoned", async () => {
    await setBudget({ amount: 0.5, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    const deferred = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    if (deferred.outcome !== "DEFERRED") throw new Error("expected deferral");
    await setBudget({ amount: 5, reservePerEvaluation: 0.6 });
    // Simulate a crash after the resume was admitted but before enqueue.
    const outcome = await budget.gate.admit({
      opportunityId,
      domain: "customer-success",
      profile: { id: profile.id, version: 1 },
      resumeDeferralId: deferred.deferredEvaluationId,
    });
    expect(outcome.outcome).toBe("ADMITTED");
    expect(await service.getOpenDeferral(opportunityId)).toBeNull();

    clock.now = new Date(clock.now.getTime() + 11 * 60_000);
    expect((await service.getOpenDeferral(opportunityId))?.id).toBe(deferred.deferredEvaluationId);
    const resumed = await service.resumeDeferred(deferred.deferredEvaluationId);
    expect(resumed.outcome).toBe("QUEUED");
    expect(await activeEvaluationCount(opportunityId)).toBe(1);
  });

  it("disabling or removing the budget never rewrites usage or cost records", async () => {
    await setBudget({ amount: 1, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    const result = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    if (result.outcome !== "QUEUED") throw new Error("expected queue");
    await recordAttempt(result.evaluationId, 1, 0.07);
    const before = await database.semanticOperationAttempt.findMany({ where: { opportunityId }, orderBy: { attempt: "asc" } });
    await budget.updateSettings({ amount: 1, currency: "USD", timeZone: "UTC", reservePerEvaluation: 0, enforced: false });
    await budget.removeBudget();
    expect(await database.semanticOperationAttempt.findMany({ where: { opportunityId }, orderBy: { attempt: "asc" } })).toEqual(before);
    expect(await tasks.getByEvaluationId(result.evaluationId)).toMatchObject({ status: "PENDING" });
  });

  it("rejects settings in a currency the AI pricing does not use", async () => {
    await expect(
      budget.updateSettings({ amount: 1, currency: "EUR", timeZone: "UTC", reservePerEvaluation: 0.5, enforced: true }),
    ).rejects.toMatchObject({ code: "BUDGET_INVALID", issues: [expect.objectContaining({ path: "currency" })] });
  });
});

describe("budget period boundaries", () => {
  const october = new Date("2031-10-31T23:59:00Z");
  const november = new Date("2031-11-01T00:30:00Z");

  it("keeps an admitted run held into the next period and splits actual spend by attempt period", async () => {
    await setBudget({ amount: 5, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    clock.now = october;
    const result = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    if (result.outcome !== "QUEUED") throw new Error("expected queue");

    clock.now = november;
    let status = await configuredStatus();
    expect(status.period.label).toBe("2031-11");
    expect(status).toMatchObject({ knownSpent: 0, held: 0.6, heldEvaluations: 1 });

    await recordAttempt(result.evaluationId, 1, 0.05, new Date("2031-10-31T23:59:30Z"));
    await recordAttempt(result.evaluationId, 2, 0.03, new Date("2031-11-01T00:10:00Z"));
    status = await configuredStatus();
    expect(status.knownSpent).toBe(0.03);
    expect(status.held).toBeCloseTo(0.52, 12); // reserve minus everything known so far

    await completeTask(result.evaluationId);
    status = await configuredStatus();
    expect(status).toMatchObject({ knownSpent: 0.03, held: 0, heldEvaluations: 0 });
    clock.now = new Date("2031-10-15T00:00:00Z");
    expect(await configuredStatus()).toMatchObject({ knownSpent: 0.05, held: 0 });
  });

  it("holds a finished run with unknown cost only in the period of the unknown attempt", async () => {
    await setBudget({ amount: 5, reservePerEvaluation: 0.6 });
    const { profile, opportunityId } = await setup();
    clock.now = october;
    const result = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    if (result.outcome !== "QUEUED") throw new Error("expected queue");
    await recordAttempt(result.evaluationId, 1, null, new Date("2031-10-31T23:59:30Z"));
    await completeTask(result.evaluationId);

    expect(await configuredStatus()).toMatchObject({ unknownAttempts: 1, held: 0.6, heldEvaluations: 1 });
    clock.now = november;
    expect(await configuredStatus()).toMatchObject({ unknownAttempts: 0, held: 0, heldEvaluations: 0 });
  });

  it("uses the configured time zone for the period", async () => {
    await setBudget({ amount: 5, reservePerEvaluation: 0.6, timeZone: "America/New_York" });
    clock.now = new Date("2031-11-01T02:00:00Z"); // still 31 Oct in New York
    const status = await configuredStatus();
    expect(status.period).toMatchObject({ label: "2031-10", timeZone: "America/New_York", end: "2031-11-01T04:00:00.000Z" });
  });
});
