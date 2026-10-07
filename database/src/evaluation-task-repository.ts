import {
  evaluationTaskSchema,
  semanticOperationAttemptRecordSchema,
  type DomainEvaluatorDefinition,
  type EvaluationTaskRepository,
  type JsonValue,
  type SemanticOperationAttempt,
  SemanticOperationPersistenceError,
} from "@ai-career/evaluation";
import { Prisma } from "../generated/prisma/client";
import { randomUUID } from "node:crypto";
import { getDatabaseClient } from "./client";

function asInputJson(value: JsonValue | unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function persistenceCategory(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : null;
  if (code === "P2002") return "UNIQUE_CONSTRAINT" as const;
  if (code === "P2003") return "FOREIGN_KEY_CONSTRAINT" as const;
  if (code === "P2011") return "NULL_CONSTRAINT" as const;
  if (code === "P2000") return "VALUE_CONSTRAINT" as const;
  if (code === "P2028") return "TRANSACTION_FAILURE" as const;
  if (code?.startsWith("P1")) return "DATABASE_UNAVAILABLE" as const;
  return "UNKNOWN_DATABASE_ERROR" as const;
}

export interface EnqueueEvaluationInput {
  opportunityId: string;
  userProfileId: string;
  userProfileVersion: number;
  evaluator: DomainEvaluatorDefinition<unknown, unknown>;
  executionMetadata: Record<string, JsonValue>;
  maxAttempts: number;
}

export class AdmissionNotConsumableError extends Error {
  constructor(readonly admissionId: string) {
    super("The evaluation admission was already used or abandoned");
    this.name = "AdmissionNotConsumableError";
  }
}

async function createEvaluationAndTask(
  transaction: Prisma.TransactionClient,
  input: EnqueueEvaluationInput,
) {
  const evaluation = await transaction.evaluation.create({
    data: {
      opportunityId: input.opportunityId,
      userProfileId: input.userProfileId,
      domain: input.evaluator.domain,
      evaluationVersion: input.evaluator.evaluationVersion,
      domainVersion: input.evaluator.domainVersion,
      ruleVersion: input.evaluator.ruleVersion,
      promptVersion: input.evaluator.promptVersion,
      userProfileVersion: input.userProfileVersion,
      executionMetadata: asInputJson(input.executionMetadata),
      stageResults: {
        create: input.evaluator.stages.map((stage, position) => ({
          stageId: stage.id,
          position,
          stageVersion: stage.version,
          ruleVersion: stage.ruleVersion,
          promptVersion: stage.promptVersion,
        })),
      },
    },
    select: { id: true },
  });
  return transaction.evaluationTask.create({
    data: {
      evaluationId: evaluation.id,
      maxAttempts: input.maxAttempts,
      availableAt: new Date(),
    },
  });
}

export class PrismaEvaluationTaskRepository implements EvaluationTaskRepository {
  private readonly database = getDatabaseClient();

  async enqueue(input: EnqueueEvaluationInput) {
    const task = await this.database.$transaction((transaction) =>
      createEvaluationAndTask(transaction, input),
    );
    return evaluationTaskSchema.parse(task);
  }

  // Product request path only. Creates exactly what enqueue() creates and, in
  // the same transaction, consumes one live EvaluationAdmission. If the
  // admission was already consumed or abandoned, the transaction rolls back,
  // so an abandoned admission can never produce an Evaluation.
  async enqueueAdmitted(input: EnqueueEvaluationInput & { admissionId: string }) {
    const task = await this.database.$transaction(async (transaction) => {
      const created = await createEvaluationAndTask(transaction, input);
      const consumed = await transaction.evaluationAdmission.updateMany({
        where: { id: input.admissionId, evaluationId: null, abandonedAt: null },
        data: { evaluationId: created.evaluationId, attachedAt: new Date() },
      });
      if (consumed.count !== 1) throw new AdmissionNotConsumableError(input.admissionId);
      return created;
    });
    return evaluationTaskSchema.parse(task);
  }

  async claimNext(input: { leaseSeconds: number }) {
    const claimTime = new Date();
    return this.database.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "EvaluationTask"
          WHERE "attempt" < "maxAttempts"
            AND (
              ("status" = 'PENDING' AND "availableAt" <= ${claimTime})
              OR ("status" = 'RUNNING' AND "leaseExpiresAt" < ${claimTime})
            )
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
      );
      const candidate = candidates[0];
      if (!candidate) return null;
      const existing = await transaction.evaluationTask.findUniqueOrThrow({
        where: { id: candidate.id },
      });

      const interruptedStages = await transaction.stageResult.updateMany({
        where: { evaluationId: existing.evaluationId, status: "RUNNING" },
        data: {
          status: "FAILED",
          retryable: true,
          failureCode: "WORKER_INTERRUPTED",
          errorMessage: "Worker execution ended before the stage completed",
          completedAt: claimTime,
        },
      });
      if (interruptedStages.count > 0) {
        await transaction.evaluation.update({
          where: { id: existing.evaluationId },
          data: {
            status: "PENDING",
            errorMessage: "Worker execution was interrupted and reclaimed",
            completedAt: null,
          },
        });
      }

      const now = claimTime;
      const leaseExpiresAt = new Date(now.getTime() + input.leaseSeconds * 1_000);
      const claimed = await transaction.evaluationTask.update({
        where: { id: existing.id },
        data: {
          status: "RUNNING",
          attempt: { increment: 1 },
          claimedAt: now,
          leaseExpiresAt,
          startedAt: existing.startedAt ?? now,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      return evaluationTaskSchema.parse(claimed);
    });
  }

  async complete(taskId: string) {
    const task = await this.database.evaluationTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    return evaluationTaskSchema.parse(task);
  }

  async fail(input: {
    taskId: string;
    code: string;
    message: string;
    retryable: boolean;
  }) {
    const current = await this.database.evaluationTask.findUniqueOrThrow({
      where: { id: input.taskId },
    });
    const retry = input.retryable && current.attempt < current.maxAttempts;
    const task = await this.database.evaluationTask.update({
      where: { id: input.taskId },
      data: retry
        ? {
            status: "PENDING",
            availableAt: new Date(),
            claimedAt: null,
            leaseExpiresAt: null,
            errorCode: input.code,
            errorMessage: input.message,
          }
        : {
            status: "FAILED",
            completedAt: new Date(),
            leaseExpiresAt: null,
            errorCode: input.code,
            errorMessage: input.message,
          },
    });
    return evaluationTaskSchema.parse(task);
  }

  async getByEvaluationId(evaluationId: string) {
    const task = await this.database.evaluationTask.findUnique({
      where: { evaluationId },
    });
    return task ? evaluationTaskSchema.parse(task) : null;
  }

  async recordSemanticOperation(
    evaluationId: string,
    attempt: SemanticOperationAttempt,
  ) {
    try {
      await this.database.$transaction(async (transaction) => {
        const evaluation = await transaction.evaluation.findUniqueOrThrow({
          where: { id: evaluationId },
          select: {
            opportunityId: true,
            domain: true,
            opportunity: {
              select: {
                source: true,
                sourceRecords: {
                  orderBy: { createdAt: "asc" },
                  select: { id: true, source: true },
                  take: 1,
                },
              },
            },
          },
        });
        const pricing = attempt.pricingConfiguration;
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "AiModelPricingConfiguration" (
            "id",
            "provider",
            "model",
            "version",
            "currency",
            "inputCostPerMillionTokens",
            "cachedInputCostPerMillionTokens",
            "outputCostPerMillionTokens",
            "longContextThresholdTokens",
            "longContextInputMultiplier",
            "longContextOutputMultiplier",
            "effectiveFrom",
            "effectiveTo"
          ) VALUES (
            ${randomUUID()}::uuid,
            ${pricing.provider},
            ${pricing.model},
            ${pricing.version},
            ${pricing.currency},
            ${pricing.inputCostPerMillionTokens}::numeric,
            ${pricing.cachedInputCostPerMillionTokens}::numeric,
            ${pricing.outputCostPerMillionTokens}::numeric,
            ${pricing.longContextThresholdTokens}::integer,
            ${pricing.longContextInputMultiplier}::numeric,
            ${pricing.longContextOutputMultiplier}::numeric,
            ${pricing.effectiveFrom.toISOString()}::timestamptz,
            ${pricing.effectiveTo?.toISOString() ?? null}::timestamptz
          )
          ON CONFLICT ("provider", "model", "version") DO NOTHING
        `);
        const pricingRecords = await transaction.$queryRaw<
          Array<{ id: string; matches: boolean }>
        >(Prisma.sql`
          SELECT (
            "currency" = ${pricing.currency}
            AND "inputCostPerMillionTokens" =
              ${pricing.inputCostPerMillionTokens}::numeric
            AND "cachedInputCostPerMillionTokens" =
              ${pricing.cachedInputCostPerMillionTokens}::numeric
            AND "outputCostPerMillionTokens" =
              ${pricing.outputCostPerMillionTokens}::numeric
            AND "longContextThresholdTokens" IS NOT DISTINCT FROM
              ${pricing.longContextThresholdTokens}::integer
            AND "longContextInputMultiplier" =
              ${pricing.longContextInputMultiplier}::numeric
            AND "longContextOutputMultiplier" =
              ${pricing.longContextOutputMultiplier}::numeric
            AND "effectiveFrom" =
              ${pricing.effectiveFrom.toISOString()}::timestamptz
            AND "effectiveTo" IS NOT DISTINCT FROM
              ${pricing.effectiveTo?.toISOString() ?? null}::timestamptz
          ) AS "matches", "id"::text
          FROM "AiModelPricingConfiguration"
          WHERE "provider" = ${pricing.provider}
            AND "model" = ${pricing.model}
            AND "version" = ${pricing.version}
        `);
        const pricingRecord = pricingRecords[0];
        if (!pricingRecord || pricingRecord.matches !== true) {
          throw new SemanticOperationPersistenceError(
            "PRICING_CONFIGURATION_MISMATCH",
          );
        }
        const latest = await transaction.semanticOperationAttempt.aggregate({
          where: { evaluationId, operationId: attempt.operationId },
          _max: { attempt: true },
        });
        await transaction.semanticOperationAttempt.create({
          data: {
            evaluationId,
            opportunityId: evaluation.opportunityId,
            domain: evaluation.domain,
            sourceRecordId: evaluation.opportunity.sourceRecords[0]?.id ?? null,
            jobSource:
              evaluation.opportunity.sourceRecords[0]?.source ??
              evaluation.opportunity.source,
            operationId: attempt.operationId,
            promptVersion: attempt.promptVersion,
            attempt: (latest._max.attempt ?? 0) + 1,
            provider: attempt.provider,
            model: attempt.model,
            status: attempt.status,
            inputTokens: attempt.usage.inputTokens,
            outputTokens: attempt.usage.outputTokens,
            cachedInputTokens: attempt.usage.cachedInputTokens,
            reasoningTokens: attempt.usage.reasoningTokens,
            totalTokens: attempt.usage.totalTokens,
            estimatedCost: attempt.estimatedCost,
            pricingConfigurationId: pricingRecord.id,
            durationMs: attempt.durationMs,
            providerRequestId: attempt.providerRequestId,
            errorCode: attempt.errorCode,
            errorMessage: attempt.errorMessage,
          },
        });
      });
    } catch (error) {
      if (error instanceof SemanticOperationPersistenceError) throw error;
      throw new SemanticOperationPersistenceError(persistenceCategory(error));
    }
  }

  async listSemanticOperations(evaluationId: string) {
    const records = await this.database.semanticOperationAttempt.findMany({
      where: { evaluationId },
      orderBy: [{ createdAt: "asc" }, { attempt: "asc" }],
      include: { pricingConfiguration: true },
    });
    return records.map((record) =>
      semanticOperationAttemptRecordSchema.parse({
        id: record.id,
        evaluationId: record.evaluationId,
        opportunityId: record.opportunityId,
        domain: record.domain,
        sourceRecordId: record.sourceRecordId,
        jobSource: record.jobSource,
        operationId: record.operationId,
        promptVersion: record.promptVersion,
        attempt: record.attempt,
        provider: record.provider,
        model: record.model,
        status: record.status,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cachedInputTokens: record.cachedInputTokens,
        reasoningTokens: record.reasoningTokens,
        totalTokens: record.totalTokens,
        estimatedCost: record.estimatedCost?.toNumber() ?? null,
        pricingConfigurationVersion:
          record.pricingConfiguration?.version ?? null,
        pricingCurrency: record.pricingConfiguration?.currency ?? null,
        durationMs: record.durationMs,
        providerRequestId: record.providerRequestId,
        errorCode: record.errorCode,
        errorMessage: record.errorMessage,
        createdAt: record.createdAt,
      }),
    );
  }
}
