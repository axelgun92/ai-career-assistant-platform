import { z } from "zod";
import type { DomainEvaluatorDefinition, JsonValue } from "./contracts";
import type { SemanticOperationAttempt } from "./semantic-executor";

const requiredText = z.string().trim().min(1);

export const evaluationTaskSchema = z
  .object({
    id: z.uuid(),
    evaluationId: z.uuid(),
    status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]),
    attempt: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    availableAt: z.coerce.date(),
    claimedAt: z.coerce.date().nullable(),
    leaseExpiresAt: z.coerce.date().nullable(),
    startedAt: z.coerce.date().nullable(),
    completedAt: z.coerce.date().nullable(),
    errorCode: requiredText.nullable(),
    errorMessage: requiredText.nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .strict();

export const semanticOperationAttemptRecordSchema = z
  .object({
    id: z.uuid(),
    evaluationId: z.uuid(),
    operationId: requiredText,
    promptVersion: requiredText,
    attempt: z.number().int().positive(),
    provider: requiredText,
    model: requiredText,
    status: z.enum([
      "SUCCESS",
      "VALIDATION_FAILURE",
      "PROVIDER_FAILURE",
      "TIMEOUT",
    ]),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    durationMs: z.number().int().nonnegative(),
    providerRequestId: requiredText.nullable(),
    errorCode: requiredText.nullable(),
    errorMessage: requiredText.nullable(),
    createdAt: z.coerce.date(),
  })
  .strict();

export interface EvaluationTaskRepository {
  enqueue(input: {
    opportunityId: string;
    userProfileId: string;
    userProfileVersion: number;
    evaluator: DomainEvaluatorDefinition<unknown, unknown>;
    executionMetadata: Record<string, JsonValue>;
    maxAttempts: number;
  }): Promise<EvaluationTask>;
  claimNext(input: { leaseSeconds: number }): Promise<EvaluationTask | null>;
  complete(taskId: string): Promise<EvaluationTask>;
  fail(input: {
    taskId: string;
    code: string;
    message: string;
    retryable: boolean;
  }): Promise<EvaluationTask>;
  getByEvaluationId(evaluationId: string): Promise<EvaluationTask | null>;
  recordSemanticOperation(
    evaluationId: string,
    attempt: SemanticOperationAttempt,
  ): Promise<void>;
  listSemanticOperations(
    evaluationId: string,
  ): Promise<SemanticOperationAttemptRecord[]>;
}

export type EvaluationTask = z.infer<typeof evaluationTaskSchema>;
export type SemanticOperationAttemptRecord = z.infer<
  typeof semanticOperationAttemptRecordSchema
>;
