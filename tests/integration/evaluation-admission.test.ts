import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCustomerSuccessEvaluator } from "@ai-career/customer-success";
import {
  AdmissionNotConsumableError,
  admissionAbandonAfterMs,
  PrismaEvaluationAdmissionRepository,
} from "@ai-career/database";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { PrismaEvaluationQueryRepository, PrismaEvaluationRepository } from "@ai-career/database";
import {
  activeEvaluationCount,
  captureOpportunity,
  createCleanup,
  createHarness,
  createProfile,
  database,
  semanticConfig,
  setBudget,
  tasks,
} from "../support/budget-integration";

const admissions = new PrismaEvaluationAdmissionRepository();
const cleanup = createCleanup();
const clock = { now: new Date() };
const { service } = createHarness(clock);

beforeEach(async () => {
  clock.now = new Date();
  await cleanup.before();
});
afterEach(() => cleanup.after());
afterAll(() => database.$disconnect());

const afterTimeout = () => new Date(clock.now.getTime() + admissionAbandonAfterMs + 60_000);

function enqueueInput(opportunityId: string, profile: { id: string; version: number }) {
  return {
    opportunityId,
    userProfileId: profile.id,
    userProfileVersion: profile.version,
    evaluator: createCustomerSuccessEvaluator(),
    executionMetadata: { provider: "openai", model: semanticConfig.model },
    maxAttempts: 1,
  };
}

async function insertLiveAdmission(opportunityId: string, reservation?: { amount: number }) {
  return admissions.withAdmissionLock((transaction) =>
    admissions.insert(transaction, {
      opportunityId,
      now: clock.now,
      reservation: reservation ? { ...reservation, currency: "USD", enforced: true } : undefined,
    }),
  );
}

describe("admission recovery", () => {
  it("an admission whose enqueue never happens blocks only until it can be abandoned", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await captureOpportunity(cleanup);
    const stuck = await insertLiveAdmission(opportunityId);

    // While live it protects against a duplicate request.
    await expect(service.requestEvaluation(opportunityId, { userProfileId: profile.id })).rejects.toMatchObject({
      code: "EVALUATION_ALREADY_ACTIVE",
    });

    clock.now = afterTimeout();
    const queued = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(queued).toMatchObject({ outcome: "QUEUED" });
    expect(await database.evaluationAdmission.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({
      evaluationId: null,
      abandonedAt: clock.now,
    });
    expect(await activeEvaluationCount(opportunityId)).toBe(1);
  });

  it("a successful enqueue is durably associated in the same commit and is never abandoned by age", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await captureOpportunity(cleanup);
    const admission = await insertLiveAdmission(opportunityId);
    const task = await tasks.enqueueAdmitted({ ...enqueueInput(opportunityId, profile), admissionId: admission.id });
    // "Process died right after": no further product step runs.
    const row = await database.evaluationAdmission.findUniqueOrThrow({ where: { id: admission.id } });
    expect(row.evaluationId).toBe(task.evaluationId);
    expect(row.attachedAt).not.toBeNull();

    clock.now = afterTimeout();
    expect(await admissions.abandonStale({ now: clock.now })).toBe(0);
    expect((await database.evaluationAdmission.findUniqueOrThrow({ where: { id: admission.id } })).abandonedAt).toBeNull();
    await expect(service.requestEvaluation(opportunityId, { userProfileId: profile.id })).rejects.toMatchObject({
      code: "EVALUATION_ALREADY_ACTIVE",
    });
    expect(await activeEvaluationCount(opportunityId)).toBe(1);
  });
});

describe("an abandoned admission can never produce an evaluation", () => {
  it("rejects a delayed enqueue after abandonment, leaving exactly one active evaluation", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await captureOpportunity(cleanup);
    const delayed = await insertLiveAdmission(opportunityId);

    clock.now = afterTimeout();
    const second = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(second).toMatchObject({ outcome: "QUEUED" });

    await expect(
      tasks.enqueueAdmitted({ ...enqueueInput(opportunityId, profile), admissionId: delayed.id }),
    ).rejects.toBeInstanceOf(AdmissionNotConsumableError);
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(1);
    expect(await activeEvaluationCount(opportunityId)).toBe(1);
  });

  it("consume and abandon racing on one admission: exactly one wins, every time", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await captureOpportunity(cleanup);
    for (let run = 0; run < 20; run += 1) {
      const admission = await insertLiveAdmission(opportunityId);
      const [enqueued, abandoned] = await Promise.all([
        tasks
          .enqueueAdmitted({ ...enqueueInput(opportunityId, profile), admissionId: admission.id })
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof AdmissionNotConsumableError) return false;
            throw error;
          }),
        admissions.abandon(admission.id),
      ]);
      expect(enqueued).toBe(!abandoned);
      const row = await database.evaluationAdmission.findUniqueOrThrow({ where: { id: admission.id } });
      expect(Boolean(row.evaluationId)).toBe(enqueued);
      expect(Boolean(row.abandonedAt)).toBe(abandoned);
      expect(await database.evaluation.count({ where: { opportunityId } })).toBe(enqueued ? 1 : 0);
      await database.evaluation.deleteMany({ where: { opportunityId } });
    }
  });

  it("a failure inside the enqueue transaction creates nothing, releases the admission, and allows a retry", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await captureOpportunity(cleanup);
    const budget = createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] });
    const broken = createEvaluationService({
      queries: new PrismaEvaluationQueryRepository(),
      evaluations: new PrismaEvaluationRepository(),
      tasks: {
        enqueue: tasks.enqueue.bind(tasks),
        enqueueAdmitted: (input) =>
          tasks.enqueueAdmitted({
            ...input,
            // An invalid stage makes the Evaluation insert fail mid-transaction.
            evaluator: { ...input.evaluator, stages: [{ id: null } as never] },
          }),
      } as typeof tasks,
      semanticConfig,
      jobMaxAttempts: 1,
      admissionGate: budget.gate,
    });

    await expect(broken.requestEvaluation(opportunityId, { userProfileId: profile.id })).rejects.toBeDefined();
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(0);
    const [admission] = await database.evaluationAdmission.findMany({ where: { opportunityId } });
    expect(admission).toMatchObject({ evaluationId: null });
    expect(admission!.abandonedAt).not.toBeNull();

    await expect(service.requestEvaluation(opportunityId, { userProfileId: profile.id })).resolves.toMatchObject({
      outcome: "QUEUED",
    });
    expect(await activeEvaluationCount(opportunityId)).toBe(1);
  });

  it("the existing enqueue() path is unchanged and touches no admission rows", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await captureOpportunity(cleanup);
    const before = await database.evaluationAdmission.count();
    const task = await tasks.enqueue(enqueueInput(opportunityId, profile));
    expect(task.status).toBe("PENDING");
    expect(await database.stageResult.count({ where: { evaluationId: task.evaluationId } })).toBe(
      createCustomerSuccessEvaluator().stages.length,
    );
    expect(await database.evaluationAdmission.count()).toBe(before);
  });
});

describe("concurrent requests for the same opportunity", () => {
  it.each([
    ["with no budget", false],
    ["with a budget", true],
  ])("produce exactly one queued evaluation (%s)", async (_name, withBudget) => {
    if (withBudget) await setBudget({ amount: 100, reservePerEvaluation: 1 });
    const profile = await createProfile(cleanup);
    // Several rounds: a check-ordering race only shows up intermittently.
    for (let round = 0; round < 6; round += 1) {
      const opportunityId = await captureOpportunity(cleanup);
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.requestEvaluation(opportunityId, { userProfileId: profile.id })),
      );
      const queued = results.filter((result) => result.status === "fulfilled");
      expect(queued).toHaveLength(1);
      for (const result of results) {
        if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "EVALUATION_ALREADY_ACTIVE" });
      }
      expect(await database.evaluation.count({ where: { opportunityId } })).toBe(1);
      expect(await activeEvaluationCount(opportunityId)).toBe(1);
    }
  });

  it("with no budget configured: integrity without any monetary reservation or deferral", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await captureOpportunity(cleanup);
    const results = await Promise.allSettled([
      service.requestEvaluation(opportunityId, { userProfileId: profile.id }),
      service.requestEvaluation(opportunityId, { userProfileId: profile.id }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const admissionsForOpportunity = await database.evaluationAdmission.findMany({
      where: { opportunityId },
      select: { evaluationId: true, reservation: true },
    });
    expect(admissionsForOpportunity).toHaveLength(1);
    expect(admissionsForOpportunity[0]!.evaluationId).not.toBeNull();
    expect(admissionsForOpportunity[0]!.reservation).toBeNull();
    expect(await database.deferredEvaluation.count({ where: { opportunityId } })).toBe(0);
  });
});
