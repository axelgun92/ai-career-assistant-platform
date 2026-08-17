import { customerSuccessTestPreferences } from "../fixtures/customer-success";
import { createNeutralEvaluationSubject } from "../support/in-memory-evaluation-repository";
import {
  evaluationSnapshotSchema,
  evaluationTaskSchema,
  EvaluationWorkerError,
  createSemanticExecutor,
  createEvaluationWorker,
  type EvaluationRepository,
  type EvaluationTask,
  type EvaluationTaskRepository,
  type SemanticOperationAttempt,
} from "@ai-career/evaluation";
import { readSemanticEnvironment } from "@ai-career/shared";
import { createEvaluationApiHandlers } from "../../apps/web/src/server/evaluation-api";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const timestamp = new Date("2026-08-17T12:00:00.000Z");

function taskRecord(status: EvaluationTask["status"] = "PENDING") {
  return evaluationTaskSchema.parse({
    id: randomUUID(),
    evaluationId: randomUUID(),
    status,
    attempt: status === "PENDING" ? 0 : 1,
    maxAttempts: 2,
    availableAt: timestamp,
    claimedAt: status === "PENDING" ? null : timestamp,
    leaseExpiresAt: null,
    startedAt: status === "PENDING" ? null : timestamp,
    completedAt: ["COMPLETED", "FAILED"].includes(status) ? timestamp : null,
    errorCode: status === "FAILED" ? "TERMINAL" : null,
    errorMessage: status === "FAILED" ? "Evaluation failed" : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function validSubject() {
  const subject = createNeutralEvaluationSubject();
  subject.opportunity.domain = "customer-success";
  subject.opportunity.status = "NORMALIZED";
  subject.opportunity.jobDescription = "Customer Success role description";
  subject.userProfile = {
    id: randomUUID(),
    version: 4,
    data: {
      label: "Versioned Customer Success profile",
      careerGoals: [],
      experience: [],
      skills: [],
      transferableSkills: [],
      locationPreferences: null,
      compensationPreferences: null,
      workPreferences: [],
      companyPreferences: null,
      domainPreferences: { customerSuccess: customerSuccessTestPreferences },
    },
  };
  return subject;
}

function snapshot(status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED") {
  const evaluationId = randomUUID();
  return evaluationSnapshotSchema.parse({
    id: evaluationId,
    opportunityId: randomUUID(),
    userProfileId: randomUUID(),
    domain: "customer-success",
    status,
    evaluationVersion: "cs-evaluation-v1.1-m9",
    domainVersion: "customer-success-v1.1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-m9-prompts-v1",
    userProfileVersion: 4,
    executionMetadata: { provider: "openai", model: "gpt-5.6-terra" },
    domainResult: status === "COMPLETED" ? { recommendation: "APPLY" } : null,
    recommendation: null,
    errorMessage: status === "FAILED" ? "Evaluation failed" : null,
    startedAt: status === "PENDING" ? null : timestamp,
    completedAt: ["COMPLETED", "FAILED"].includes(status) ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    stageResults: [],
    evidenceRecords: [],
    contradictions: [],
  });
}

function fakeTaskRepository(initial = taskRecord()): EvaluationTaskRepository & {
  enqueuedInput?: unknown;
} {
  let task = initial;
  const operations: SemanticOperationAttempt[] = [];
  return {
    async enqueue(input) {
      this.enqueuedInput = input;
      task = { ...task, evaluationId: randomUUID() };
      return task;
    },
    async claimNext() { return null; },
    async complete() { return { ...task, status: "COMPLETED" }; },
    async fail() { return { ...task, status: "FAILED" }; },
    async getByEvaluationId() { return task; },
    async recordSemanticOperation(_evaluationId, attempt) { operations.push(attempt); },
    async listSemanticOperations() {
      return operations.map((operation) => ({
        id: randomUUID(),
        evaluationId: task.evaluationId,
        operationId: operation.operationId,
        promptVersion: operation.promptVersion,
        attempt: operation.attempt,
        provider: operation.provider,
        model: operation.model,
        status: operation.status,
        inputTokens: operation.usage.inputTokens,
        outputTokens: operation.usage.outputTokens,
        totalTokens: operation.usage.totalTokens,
        durationMs: operation.durationMs,
        providerRequestId: operation.providerRequestId,
        errorCode: operation.errorCode,
        errorMessage: operation.errorMessage,
        createdAt: timestamp,
      }));
    },
  };
}

describe("evaluation API", () => {
  it("returns 202 and enqueues a versioned Customer Success evaluation without persisting the API key", async () => {
    const subject = validSubject();
    const tasks = fakeTaskRepository();
    const service = createEvaluationService({
      queries: {
        async findOpportunityForEvaluation() {
          return {
            id: subject.opportunity.id,
            domain: "customer-success",
            status: "NORMALIZED",
            jobDescription: subject.opportunity.jobDescription,
            sourceRecords: [{ id: subject.rawSources[0]!.id }],
          };
        },
        async resolveUserProfile() {
          return { id: subject.userProfile!.id, version: 4 };
        },
        async findLatestEvaluationId() { return null; },
      },
      evaluations: {
        async loadSubject() { return subject; },
      } as unknown as EvaluationRepository,
      tasks,
      semanticConfig: {
        apiKey: "server-only-secret",
        model: "gpt-5.6-terra",
        maxOutputTokens: 12_000,
        retryLimit: 1,
        callBudget: 16,
        timeoutMs: 120_000,
      },
      jobMaxAttempts: 3,
    });
    const response = await createEvaluationApiHandlers(service).post(
      new Request("http://localhost/api/opportunities/id/evaluate", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      subject.opportunity.id,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      opportunityId: subject.opportunity.id,
      domain: "customer-success",
      status: "PENDING",
    });
    expect(JSON.stringify(tasks.enqueuedInput)).not.toContain("server-only-secret");
  });

  it("returns safe errors for a missing opportunity, unsupported domain, and missing profile", async () => {
    const subject = validSubject();
    const baseDependencies = {
      evaluations: { async loadSubject() { return subject; } } as unknown as EvaluationRepository,
      tasks: fakeTaskRepository(),
      semanticConfig: {
        apiKey: "secret",
        model: "gpt-5.6-terra",
        maxOutputTokens: 100,
        retryLimit: 0,
        callBudget: 10,
        timeoutMs: 5_000,
      },
      jobMaxAttempts: 2,
    };
    const request = new Request("http://localhost/evaluate", { method: "POST" });
    const missing = createEvaluationService({
      ...baseDependencies,
      queries: {
        async findOpportunityForEvaluation() { return null; },
        async resolveUserProfile() { return null; },
        async findLatestEvaluationId() { return null; },
      },
    });
    expect((await createEvaluationApiHandlers(missing).post(request, randomUUID())).status).toBe(404);

    const unsupported = createEvaluationService({
      ...baseDependencies,
      queries: {
        async findOpportunityForEvaluation() {
          return { id: subject.opportunity.id, domain: "freelance-writing", status: "NORMALIZED", jobDescription: "Text", sourceRecords: [] };
        },
        async resolveUserProfile() { return { id: subject.userProfile!.id, version: 4 }; },
        async findLatestEvaluationId() { return null; },
      },
    });
    expect((await createEvaluationApiHandlers(unsupported).post(new Request("http://localhost/evaluate", { method: "POST" }), subject.opportunity.id)).status).toBe(422);

    const noProfile = createEvaluationService({
      ...baseDependencies,
      queries: {
        async findOpportunityForEvaluation() {
          return { id: subject.opportunity.id, domain: "customer-success", status: "NORMALIZED", jobDescription: "Text", sourceRecords: [] };
        },
        async resolveUserProfile() { return null; },
        async findLatestEvaluationId() { return null; },
      },
    });
    expect((await createEvaluationApiHandlers(noProfile).post(new Request("http://localhost/evaluate", { method: "POST" }), subject.opportunity.id)).status).toBe(422);
  });

  it.each(["PENDING", "RUNNING", "COMPLETED", "FAILED"] as const)(
    "retrieves a safe %s evaluation representation",
    async (status) => {
      const evaluation = snapshot(status);
      const task = taskRecord(status);
      const service = createEvaluationService({
        queries: {
          async findOpportunityForEvaluation() {
            return { id: evaluation.opportunityId, domain: "customer-success", status: "NORMALIZED", jobDescription: "Text", sourceRecords: [] };
          },
          async resolveUserProfile() { return null; },
          async findLatestEvaluationId() { return evaluation.id; },
        },
        evaluations: {
          async getEvaluationSnapshot() { return evaluation; },
        } as unknown as EvaluationRepository,
        tasks: {
          ...fakeTaskRepository(task),
          async getByEvaluationId() { return { ...task, evaluationId: evaluation.id }; },
        },
        semanticConfig: { apiKey: "secret", model: "gpt-5.6-terra", maxOutputTokens: 100, retryLimit: 0, callBudget: 10, timeoutMs: 5_000 },
        jobMaxAttempts: 2,
      });
      const response = await createEvaluationApiHandlers(service).get(
        evaluation.opportunityId,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe(status);
      expect(JSON.stringify(body)).not.toContain("secret");
      if (status === "COMPLETED") {
        expect(body.result).toEqual({ recommendation: "APPLY" });
      }
    },
  );

  it("requires explicit server-side semantic configuration", () => {
    expect(() => readSemanticEnvironment({})).toThrow();
  });

  it("does not expose unexpected internal errors or sensitive values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = createEvaluationApiHandlers({
      async requestEvaluation() {
        throw new Error("server-only-secret-value");
      },
      async getLatestEvaluation() {
        throw new Error("server-only-secret-value");
      },
    });
    const response = await handlers.get(randomUUID());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      "server-only-secret-value",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "server-only-secret-value",
    );
    log.mockRestore();
  });
});

class ClaimingTaskRepository implements EvaluationTaskRepository {
  task = taskRecord();
  operations: SemanticOperationAttempt[] = [];

  async enqueue() { return this.task; }
  async claimNext() {
    if (this.task.status !== "PENDING") return null;
    this.task = { ...this.task, status: "RUNNING", attempt: this.task.attempt + 1 };
    return this.task;
  }
  async complete() {
    this.task = { ...this.task, status: "COMPLETED", completedAt: timestamp };
    return this.task;
  }
  async fail(input: { code: string; message: string; retryable: boolean }) {
    const retry = input.retryable && this.task.attempt < this.task.maxAttempts;
    this.task = {
      ...this.task,
      status: retry ? "PENDING" : "FAILED",
      errorCode: input.code,
      errorMessage: input.message,
    };
    return this.task;
  }
  async getByEvaluationId() { return this.task; }
  async recordSemanticOperation(_evaluationId: string, attempt: SemanticOperationAttempt) { this.operations.push(attempt); }
  async listSemanticOperations() { return []; }
}

describe("database-backed worker contract", () => {
  it("gives two sequential evaluations independent semantic-call budgets", async () => {
    const queued = [taskRecord(), taskRecord()];
    const tasks: EvaluationTaskRepository = {
      async enqueue() { throw new Error("not used"); },
      async claimNext() {
        const index = queued.findIndex((task) => task.status === "PENDING");
        if (index < 0) return null;
        const claimed = {
          ...queued[index]!,
          status: "RUNNING" as const,
          attempt: queued[index]!.attempt + 1,
        };
        queued[index] = claimed;
        return claimed;
      },
      async complete(taskId) {
        const index = queued.findIndex((task) => task.id === taskId);
        queued[index] = { ...queued[index]!, status: "COMPLETED" };
        return queued[index]!;
      },
      async fail({ taskId, code, message }) {
        const index = queued.findIndex((task) => task.id === taskId);
        queued[index] = {
          ...queued[index]!,
          status: "FAILED",
          errorCode: code,
          errorMessage: message,
        };
        return queued[index]!;
      },
      async getByEvaluationId(evaluationId) {
        return queued.find((task) => task.evaluationId === evaluationId) ?? null;
      },
      async recordSemanticOperation() {},
      async listSemanticOperations() { return []; },
    };
    let providerCalls = 0;
    const worker = createEvaluationWorker({
      tasks,
      leaseSeconds: 60,
      processor: {
        async process() {
          const executor = createSemanticExecutor({
            config: {
              apiKey: "test-key",
              model: "gpt-5.6-terra",
              maxOutputTokens: 100,
              retryLimit: 0,
              callBudget: 1,
              timeoutMs: 5_000,
            },
            transport: {
              async execute() {
                providerCalls += 1;
                return {
                  outputText: '{"ok":true}',
                  providerRequestId: null,
                  usage: {
                    inputTokens: null,
                    outputTokens: null,
                    totalTokens: null,
                  },
                };
              },
            },
            recorder: { async record() {} },
          });
          await executor.execute({
            operationId: "worker-budget.operation",
            promptVersion: "v1",
            schema: z.object({ ok: z.literal(true) }).strict(),
            systemRules: "Rules",
            domainInstructions: "Instructions",
            userConfiguration: {},
            trustedContext: {},
          });
        },
      },
    });

    expect((await worker.runOnce())?.status).toBe("COMPLETED");
    expect((await worker.runOnce())?.status).toBe("COMPLETED");
    expect(providerCalls).toBe(2);
  });

  it("claims once, completes successfully, and cannot execute the same task concurrently", async () => {
    const tasks = new ClaimingTaskRepository();
    const process = vi.fn(async () => {});
    const first = createEvaluationWorker({ tasks, processor: { process }, leaseSeconds: 60 });
    const second = createEvaluationWorker({ tasks, processor: { process }, leaseSeconds: 60 });
    const results = await Promise.all([first.runOnce(), second.runOnce()]);
    expect(process).toHaveBeenCalledTimes(1);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(tasks.task.status).toBe("COMPLETED");
  });

  it("requeues retryable failures only within the bounded task attempts", async () => {
    const tasks = new ClaimingTaskRepository();
    const worker = createEvaluationWorker({
      tasks,
      leaseSeconds: 60,
      processor: {
        async process() {
          throw new EvaluationWorkerError("PROVIDER_TIMEOUT", "Provider timed out", true);
        },
      },
    });
    expect((await worker.runOnce())?.status).toBe("PENDING");
    expect((await worker.runOnce())?.status).toBe("FAILED");
    expect(tasks.task.attempt).toBe(2);
  });

  it("records terminal failures without reporting success", async () => {
    const tasks = new ClaimingTaskRepository();
    const worker = createEvaluationWorker({
      tasks,
      leaseSeconds: 60,
      processor: {
        async process() {
          throw new EvaluationWorkerError("INVALID_RESPONSE", "Invalid response", false);
        },
      },
    });
    expect((await worker.runOnce())?.status).toBe("FAILED");
    expect(tasks.task.errorCode).toBe("INVALID_RESPONSE");
  });

  it("does not persist sensitive details from unexpected worker errors", async () => {
    const tasks = new ClaimingTaskRepository();
    const worker = createEvaluationWorker({
      tasks,
      leaseSeconds: 60,
      processor: {
        async process() {
          throw new Error("server-only-secret-value");
        },
      },
    });

    expect((await worker.runOnce())?.status).toBe("FAILED");
    expect(tasks.task.errorCode).toBe("EVALUATION_WORKER_FAILED");
    expect(tasks.task.errorMessage).toBe("Evaluation worker execution failed");
    expect(tasks.task.errorMessage).not.toContain("server-only-secret-value");
  });
});
