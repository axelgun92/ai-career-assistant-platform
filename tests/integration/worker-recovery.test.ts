import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EvaluationWorkerLock,
  getDatabaseClient,
  isEvaluationWorkerConnected,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  readQueueSnapshot,
} from "@ai-career/database";
import { createDoctorReads, runDoctorChecks } from "../../apps/web/src/server/doctor";
import { EvaluationApiError } from "../../apps/web/src/server/evaluation-errors";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import {
  captureOpportunity,
  createCleanup,
  createHarness,
  createProfile,
  database,
  setBudget,
  tasks,
} from "../support/budget-integration";

const cleanup = createCleanup();
const clock = { now: new Date() };
let harness = createHarness(clock);
const repository = new PrismaEvaluationTaskRepository();
const locks: EvaluationWorkerLock[] = [];

beforeEach(async () => {
  clock.now = new Date();
  harness = createHarness(clock);
  await cleanup.before();
});
afterEach(async () => {
  for (const lock of locks.splice(0)) await lock.release();
  await cleanup.after();
});
afterAll(() => database.$disconnect());

async function queued() {
  const profile = await createProfile(cleanup);
  const opportunityId = await captureOpportunity(cleanup);
  const result = await harness.service.requestEvaluation(opportunityId, { userProfileId: profile.id });
  if (result.outcome !== "QUEUED") throw new Error("expected a queued evaluation");
  return { opportunityId, profileId: profile.id, evaluationId: result.evaluationId, taskId: result.taskId };
}

// Test data only: put the queued task into the state a crashed worker leaves.
async function strand(taskId: string, evaluationId: string, input: { exhausted: boolean; expired: boolean }) {
  const task = await database.evaluationTask.findUniqueOrThrow({ where: { id: taskId } });
  const now = Date.now();
  await database.evaluationTask.update({
    where: { id: taskId },
    data: {
      status: "RUNNING",
      attempt: input.exhausted ? task.maxAttempts : 0,
      claimedAt: new Date(now - 600_000),
      startedAt: new Date(now - 600_000),
      leaseExpiresAt: new Date(input.expired ? now - 60_000 : now + 600_000),
    },
  });
  await database.evaluation.update({ where: { id: evaluationId }, data: { status: "RUNNING", startedAt: new Date(now - 600_000) } });
  // The first stage was mid-run when the worker died.
  const updated = await database.stageResult.updateMany({
    where: { evaluationId, position: 0 },
    data: { status: "RUNNING", startedAt: new Date(now - 600_000) },
  });
  expect(updated.count).toBe(1);
}

const ours = (ids: string[], evaluationId: string) => ids.filter((id) => id === evaluationId);

describe("worker-owned recovery of crashed final attempts", () => {
  it("fails an exhausted, expired task with its stage and evaluation, releasing the hold and allowing reevaluation", async () => {
    await setBudget({ amount: 5, reservePerEvaluation: 0.6 });
    const { opportunityId, profileId, evaluationId, taskId } = await queued();
    await strand(taskId, evaluationId, { exhausted: true, expired: true });
    const before = await harness.budget.status();
    if (!before.configured) throw new Error("expected a budget");
    expect(before.held).toBeCloseTo(0.6);
    await expect(harness.service.requestEvaluation(opportunityId, { userProfileId: profileId }))
      .rejects.toMatchObject({ code: "EVALUATION_ALREADY_ACTIVE" });

    expect(ours(await repository.failExpiredExhaustedTasks(), evaluationId)).toEqual([evaluationId]);
    expect(await database.evaluationTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
      status: "FAILED",
      errorCode: "EVALUATION_LEASE_EXPIRED",
      leaseExpiresAt: null,
    });
    expect(await database.stageResult.findFirstOrThrow({ where: { evaluationId, position: 0 } })).toMatchObject({
      status: "FAILED",
      failureCode: "WORKER_INTERRUPTED",
    });
    expect((await database.evaluation.findUniqueOrThrow({ where: { id: evaluationId } })).status).toBe("FAILED");
    const after = await harness.budget.status();
    if (!after.configured) throw new Error("expected a budget");
    expect(after.held).toBe(0);

    const latest = await harness.service.getLatestEvaluation(opportunityId);
    expect(latest).toMatchObject({ status: "FAILED", queueState: "FAILED", task: { errorCode: "EVALUATION_LEASE_EXPIRED" } });
    expect((await harness.service.requestEvaluation(opportunityId, { userProfileId: profileId })).outcome).toBe("QUEUED");
  });

  it("leaves expired tasks with attempts left to claimNext, and never touches a live lease", async () => {
    const reclaimable = await queued();
    await strand(reclaimable.taskId, reclaimable.evaluationId, { exhausted: false, expired: true });
    const live = await queued();
    await strand(live.taskId, live.evaluationId, { exhausted: true, expired: false });

    const recovered = await repository.failExpiredExhaustedTasks();
    expect(recovered).not.toContain(reclaimable.evaluationId);
    expect(recovered).not.toContain(live.evaluationId);
    expect((await database.evaluationTask.findUniqueOrThrow({ where: { id: live.taskId } })).status).toBe("RUNNING");
    expect((await harness.service.getLatestEvaluation(live.opportunityId)).queueState).toBe("RUNNING");
    expect((await harness.service.getLatestEvaluation(reclaimable.opportunityId)).queueState).toBe("RUNNING_STALE");

    const claimed = await tasks.claimNext({ leaseSeconds: 60 });
    expect(claimed?.id).toBe(reclaimable.taskId);
    expect(claimed).toMatchObject({ status: "RUNNING", attempt: 1 });
  });
});

describe("single-worker lock", () => {
  it("admits one holder at a time and is visible read-only", async () => {
    const first = new EvaluationWorkerLock();
    const second = new EvaluationWorkerLock();
    locks.push(first, second);
    expect(await first.acquire()).toBe(true);
    expect(first.isHeld()).toBe(true);
    expect(await second.acquire()).toBe(false);
    expect(second.isHeld()).toBe(false);
    expect(await isEvaluationWorkerConnected()).toBe(true);
    await first.release();
    expect(await isEvaluationWorkerConnected()).toBe(false);
    expect(await second.acquire()).toBe(true);
  });
});

describe("pnpm app:doctor", () => {
  it("only reads: every accessed database operation is a read, and nothing changes", async () => {
    const { taskId, evaluationId } = await queued();
    await strand(taskId, evaluationId, { exhausted: true, expired: true });
    const snapshot = async () =>
      JSON.stringify(await Promise.all([
        database.evaluationTask.findMany({ orderBy: { id: "asc" } }),
        database.evaluation.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, completedAt: true, errorMessage: true } }),
        database.stageResult.findMany({ where: { evaluationId }, orderBy: { id: "asc" } }),
        database.deferredEvaluation.findMany({ orderBy: { id: "asc" } }),
        database.evaluationAdmission.findMany({ orderBy: { id: "asc" } }),
        database.activeUserProfile.findMany({ orderBy: { domain: "asc" } }),
      ]));
    const before = await snapshot();

    const accessed: string[] = [];
    const client = getDatabaseClient();
    const spy = new Proxy(client, {
      get(target, property: string) {
        const value = (target as unknown as Record<string, unknown>)[property];
        if (property.startsWith("$")) {
          accessed.push(property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        if (value && typeof value === "object") {
          return new Proxy(value as object, {
            get(model, method: string) {
              accessed.push(`${property}.${method}`);
              const fn = (model as Record<string, unknown>)[method];
              return typeof fn === "function" ? fn.bind(model) : fn;
            },
          });
        }
        return value;
      },
    });
    const reads = createDoctorReads(spy, {
      workerConnected: () => isEvaluationWorkerConnected(spy),
      queueSnapshot: (now) => readQueueSnapshot(spy, now),
    });
    const checks = await runDoctorChecks({
      environment: process.env,
      nodeVersion: process.versions.node,
      migrationFolders: [],
      prismaClientGenerated: true,
      reads,
      now: new Date(),
    });
    expect(checks.find((check) => check.label === "Stale evaluations")?.detail).toMatch(/does not prove the worker stopped/);
    expect(accessed.length).toBeGreaterThan(0);
    for (const operation of accessed) {
      expect(operation, operation).toMatch(/^(\$queryRaw|[a-zA-Z]+\.(count|findFirst|findMany|findUnique))$/);
    }
    expect(await snapshot()).toBe(before);
  });
});

describe("evaluation reads and the public API shape", () => {
  it("a fresh service sees a queued evaluation after the requesting client goes away", async () => {
    const { opportunityId } = await queued();
    const fresh = createHarness(clock).service;
    expect(await fresh.getLatestEvaluation(opportunityId)).toMatchObject({ status: "PENDING", queueState: "QUEUED" });
  });

  it("reads work without AI configuration; requests fail with 503 before writing anything", async () => {
    const { opportunityId, profileId, taskId, evaluationId } = await queued();
    await strand(taskId, evaluationId, { exhausted: true, expired: true });
    await repository.failExpiredExhaustedTasks();
    const unconfigured = createEvaluationService({
      queries: new PrismaEvaluationQueryRepository(),
      evaluations: new PrismaEvaluationRepository(),
      tasks: new PrismaEvaluationTaskRepository(),
      resolveExecution: () => {
        throw new EvaluationApiError("PRODUCTION_CONFIGURATION_MISSING", "AI evaluation is not configured.", 503);
      },
      admissionGate: harness.budget.gate,
    });
    const view = await unconfigured.getLatestEvaluation(opportunityId);
    expect(view.status).toBe("FAILED");
    const json = JSON.stringify(view);
    expect(json).not.toContain("errorMessage");
    expect(json).not.toContain("providerRequestId");
    expect(json).not.toContain("lease expired after the final attempt");
    expect(view).not.toHaveProperty("error");

    const counts = async () => [
      await database.evaluation.count({ where: { opportunityId } }),
      await database.evaluationAdmission.count({ where: { opportunityId } }),
      await database.deferredEvaluation.count({ where: { opportunityId } }),
    ];
    const before = await counts();
    await expect(unconfigured.requestEvaluation(opportunityId, { userProfileId: profileId }))
      .rejects.toMatchObject({ code: "PRODUCTION_CONFIGURATION_MISSING", status: 503 });
    expect(await counts()).toEqual(before);
  });
});
