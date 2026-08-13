import type { NormalizedOpportunity } from "@ai-career/core";
import {
  contradictionDraftSchema,
  evidenceLevelSchema,
  evidenceRecordDraftSchema,
  persistedContradictionSchema,
  persistedEvidenceRecordSchema,
  type PersistedContradiction,
  type PersistedEvidenceRecord,
} from "@ai-career/evidence";
import { z } from "zod";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const identifier = requiredText.regex(/^[a-z][a-z0-9-]*$/);

export const evaluationStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

export const stageFailurePolicySchema = z.enum(["STOP", "CONTINUE"]);

export const completenessSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "INSUFFICIENT",
]);

export const unknownFindingSchema = z
  .object({
    code: identifier,
    description: requiredText,
    materiality: optionalText,
  })
  .strict();

export const stageOutputBaseSchema = z
  .object({
    classification: optionalText,
    data: z.json(),
    evidence: z.array(evidenceRecordDraftSchema),
    findings: z.array(requiredText),
    strengths: z.array(requiredText),
    concerns: z.array(requiredText),
    unknowns: z.array(unknownFindingSchema),
    contradictions: z.array(contradictionDraftSchema),
    confidence: evidenceLevelSchema.nullable(),
    completeness: completenessSchema,
  })
  .strict();

export const persistedStageOutputSchema = stageOutputBaseSchema
  .omit({ evidence: true, contradictions: true })
  .extend({
    evidenceRecordIds: z.array(z.uuid()),
    contradictionIds: z.array(z.uuid()),
  })
  .strict();

export const stageDefinitionMetadataSchema = z
  .object({
    id: identifier,
    version: requiredText,
    ruleVersion: requiredText,
    promptVersion: optionalText,
    onFailure: stageFailurePolicySchema,
    maxAttempts: z.number().int().positive(),
    invalidOutputRetryable: z.boolean(),
  })
  .strict();

export const evaluatorMetadataSchema = z
  .object({
    domain: identifier,
    evaluationVersion: requiredText,
    domainVersion: requiredText,
    ruleVersion: requiredText,
    promptVersion: optionalText,
  })
  .strict();

export const stageFailureSchema = z
  .object({
    code: requiredText,
    reason: requiredText,
    retryable: z.boolean(),
  })
  .strict();

export const persistedStageResultSchema = z
  .object({
    id: z.uuid(),
    evaluationId: z.uuid(),
    stageId: identifier,
    position: z.number().int().nonnegative(),
    status: evaluationStatusSchema,
    stageVersion: requiredText,
    ruleVersion: requiredText,
    promptVersion: optionalText,
    attempt: z.number().int().positive(),
    retryable: z.boolean(),
    failureCode: optionalText,
    result: persistedStageOutputSchema.nullable(),
    errorMessage: optionalText,
    startedAt: z.coerce.date().nullable(),
    completedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .strict();

export const evaluationSnapshotSchema = z
  .object({
    id: z.uuid(),
    opportunityId: z.uuid(),
    userProfileId: z.uuid().nullable(),
    domain: identifier,
    status: evaluationStatusSchema,
    evaluationVersion: requiredText,
    domainVersion: requiredText,
    ruleVersion: requiredText,
    promptVersion: optionalText,
    userProfileVersion: z.number().int().positive().nullable(),
    executionMetadata: z.record(z.string(), z.json()).nullable(),
    errorMessage: optionalText,
    startedAt: z.coerce.date().nullable(),
    completedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    stageResults: z.array(persistedStageResultSchema),
    evidenceRecords: z.array(persistedEvidenceRecordSchema),
    contradictions: z.array(persistedContradictionSchema),
  })
  .strict();

export interface EvaluationSourceContext {
  id: string;
  source: string;
  sourceType: string;
  sourceUrl: string | null;
  rawDescription: string | null;
  rawPayload: unknown;
}

export interface EvaluationProvenanceContext {
  id: string;
  sourceRecordId: string | null;
  fieldName: string;
  sourceField: string;
  kind: "DIRECT" | "DETERMINISTIC";
  normalizedValue: unknown;
  sourceReference: string | null;
  sourceText: string | null;
}

export interface EvaluationSubject {
  opportunity: NormalizedOpportunity & { id: string };
  rawSources: EvaluationSourceContext[];
  provenance: EvaluationProvenanceContext[];
  userProfile: {
    id: string;
    version: number;
    data: unknown;
  } | null;
}

export interface CoreEvaluationContext<TDomainData> {
  evaluationId: string;
  domain: string;
  evaluationVersion: string;
  domainVersion: string;
  ruleVersion: string;
  promptVersion: string | null;
  opportunity: EvaluationSubject["opportunity"];
  rawSources: EvaluationSourceContext[];
  provenance: EvaluationProvenanceContext[];
  userProfile: EvaluationSubject["userProfile"];
  previousStageResults: PersistedStageResult[];
  evidenceLedger: PersistedEvidenceRecord[];
  contradictions: PersistedContradiction[];
  unknowns: UnknownFinding[];
  executionMetadata: Record<string, JsonValue>;
  domainData: TDomainData;
}

export interface CoreEvaluationStage<TDomainData> {
  id: string;
  version: string;
  ruleVersion: string;
  promptVersion: string | null;
  onFailure: StageFailurePolicy;
  maxAttempts: number;
  invalidOutputRetryable: boolean;
  dataSchema: z.ZodType<unknown>;
  evaluate(context: CoreEvaluationContext<TDomainData>): Promise<unknown>;
}

export interface DomainEvaluatorDefinition<TDomainData, TResult> {
  domain: string;
  evaluationVersion: string;
  domainVersion: string;
  ruleVersion: string;
  promptVersion: string | null;
  stages: CoreEvaluationStage<TDomainData>[];
  resultSchema: z.ZodType<TResult>;
  finalize(context: CoreEvaluationContext<TDomainData>): Promise<unknown>;
}

export interface CoreEvaluationResult<TResult> {
  evaluation: EvaluationSnapshot;
  domainResult: TResult | null;
}

export interface EvaluationRepository {
  loadSubject(input: {
    opportunityId: string;
    userProfileId: string | null;
  }): Promise<EvaluationSubject | null>;
  createEvaluation(input: {
    opportunityId: string;
    userProfileId: string | null;
    userProfileVersion: number | null;
    evaluator: DomainEvaluatorDefinition<unknown, unknown>;
    executionMetadata: Record<string, JsonValue>;
  }): Promise<string>;
  getEvaluationSnapshot(evaluationId: string): Promise<EvaluationSnapshot | null>;
  markEvaluationRunning(evaluationId: string): Promise<void>;
  beginStage(input: {
    evaluationId: string;
    stageId: string;
    maxAttempts: number;
  }): Promise<PersistedStageResult>;
  completeStage(input: {
    evaluationId: string;
    opportunityId: string;
    stageResultId: string;
    stageId: string;
    output: StageOutput;
  }): Promise<PersistedStageResult>;
  failStage(input: {
    stageResultId: string;
    failure: StageFailure;
  }): Promise<PersistedStageResult>;
  finishEvaluation(input: {
    evaluationId: string;
    status: "COMPLETED" | "FAILED";
    errorMessage: string | null;
  }): Promise<void>;
}

export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type StageFailurePolicy = z.infer<typeof stageFailurePolicySchema>;
export type Completeness = z.infer<typeof completenessSchema>;
export type UnknownFinding = z.infer<typeof unknownFindingSchema>;
export type StageOutput = z.infer<typeof stageOutputBaseSchema>;
export type PersistedStageOutput = z.infer<typeof persistedStageOutputSchema>;
export type StageFailure = z.infer<typeof stageFailureSchema>;
export type PersistedStageResult = z.infer<
  typeof persistedStageResultSchema
>;
export type EvaluationSnapshot = z.infer<typeof evaluationSnapshotSchema>;
