import {
  StageExecutionError,
  defineDomainEvaluator,
  defineEvaluationStage,
} from "@ai-career/evaluation";
import { z } from "zod";

export interface NeutralDomainData {
  executionOrder: string[];
  failStageThree: boolean;
}

const sequenceDataSchema = z
  .object({ sequence: z.array(z.string()) })
  .strict();

function emptySections() {
  return {
    findings: [] as string[],
    strengths: [] as string[],
    concerns: [] as string[],
    contradictions: [],
    confidence: "CONFIRMED" as const,
    completeness: "COMPLETE" as const,
  };
}

export function createNeutralEvaluator() {
  return defineDomainEvaluator<
    NeutralDomainData,
    { completedStageIds: string[]; unknownCount: number }
  >({
    domain: "neutral-test",
    evaluationVersion: "test-evaluation-v1",
    domainVersion: "test-domain-v1",
    ruleVersion: "test-rules-v1",
    promptVersion: null,
    stages: [
      defineEvaluationStage({
        id: "stage-one",
        version: "stage-one-v1",
        ruleVersion: "test-rules-v1",
        promptVersion: null,
        onFailure: "STOP",
        maxAttempts: 1,
        invalidOutputRetryable: false,
        dataSchema: sequenceDataSchema,
        async evaluate(context) {
          context.domainData.executionOrder.push("stage-one");
          const source = context.rawSources[0];
          return {
            classification: "INFORMATIONAL",
            data: { sequence: ["stage-one"] },
            evidence: [
              {
                referenceId: "stage-one-source",
                criterionId: null,
                claim: "The neutral source record is available.",
                sourceType: source?.sourceType ?? "TEST_FIXTURE",
                sourceRecordId: source?.id ?? null,
                provenanceId: null,
                sourceField: "rawDescription",
                sourceReference: source?.sourceUrl ?? "neutral://source",
                sourceText: source?.rawDescription ?? "Neutral source text",
                evidenceType: "SOURCE_FACT",
                origin: "EXPLICIT",
                evidenceLevel: "CONFIRMED",
                collectedAt: null,
              },
            ],
            ...emptySections(),
            unknowns: [
              {
                code: "missing-neutral-detail",
                description: "A neutral fixture detail was not supplied.",
                materiality: "Completeness only; this is not negative evidence.",
              },
            ],
            completeness: "PARTIAL",
          };
        },
      }),
      defineEvaluationStage({
        id: "stage-two",
        version: "stage-two-v1",
        ruleVersion: "test-rules-v1",
        promptVersion: null,
        onFailure: "CONTINUE",
        maxAttempts: 1,
        invalidOutputRetryable: false,
        dataSchema: sequenceDataSchema,
        async evaluate(context) {
          context.domainData.executionOrder.push("stage-two");
          const priorSequence = context.previousStageResults.map(
            (stage) => stage.stageId,
          );
          const source = context.rawSources[0];
          return {
            classification: "CONTEXTUAL",
            data: { sequence: [...priorSequence, "stage-two"] },
            evidence: [
              {
                referenceId: "claim-a",
                criterionId: "neutral-comparison",
                claim: "Neutral claim A is explicitly present.",
                sourceType: source?.sourceType ?? "TEST_FIXTURE",
                sourceRecordId: source?.id ?? null,
                provenanceId: null,
                sourceField: "rawDescription",
                sourceReference: source?.sourceUrl ?? "neutral://source",
                sourceText: source?.rawDescription ?? "Neutral claim A",
                evidenceType: "SOURCE_FACT",
                origin: "EXPLICIT",
                evidenceLevel: "CONFIRMED",
                collectedAt: null,
              },
              {
                referenceId: "claim-b",
                criterionId: "neutral-comparison",
                claim: "Neutral claim B conflicts with claim A.",
                sourceType: "TEST_FIXTURE",
                sourceRecordId: null,
                provenanceId: null,
                sourceField: null,
                sourceReference: "neutral://conflicting-source",
                sourceText: "Neutral claim B",
                evidenceType: "SOURCE_FACT",
                origin: "EXPLICIT",
                evidenceLevel: "CONFLICTING",
                collectedAt: null,
              },
            ],
            ...emptySections(),
            findings: [
              `Received ${context.previousStageResults.length} prior stage result.`,
              `Received ${context.evidenceLedger.length} prior evidence record.`,
            ],
            contradictions: [
              {
                claimA: "Neutral claim A",
                claimB: "Neutral claim B",
                interpretation: "The fixture intentionally preserves both claims.",
                relevantField: "neutralField",
                significance: "MATERIAL",
                evidenceReferencesA: ["claim-a"],
                evidenceReferencesB: ["claim-b"],
              },
            ],
            unknowns: [],
          };
        },
      }),
      defineEvaluationStage({
        id: "stage-three",
        version: "stage-three-v1",
        ruleVersion: "test-rules-v1",
        promptVersion: null,
        onFailure: "STOP",
        maxAttempts: 2,
        invalidOutputRetryable: true,
        dataSchema: sequenceDataSchema,
        async evaluate(context) {
          context.domainData.executionOrder.push("stage-three");
          if (context.domainData.failStageThree) {
            throw new StageExecutionError({
              code: "NEUTRAL_TRANSIENT_FAILURE",
              message: "Neutral stage requested a retryable fixture failure",
              retryable: true,
            });
          }
          const priorSequence = context.previousStageResults.map(
            (stage) => stage.stageId,
          );
          return {
            classification: "INFORMATIONAL",
            data: { sequence: [...priorSequence, "stage-three"] },
            evidence: [],
            ...emptySections(),
            unknowns: [],
          };
        },
      }),
    ],
    resultSchema: z
      .object({
        completedStageIds: z.array(z.string()),
        unknownCount: z.number().int().nonnegative(),
      })
      .strict(),
    async finalize(context) {
      return {
        completedStageIds: context.previousStageResults
          .filter((stage) => stage.status === "COMPLETED")
          .map((stage) => stage.stageId),
        unknownCount: context.unknowns.length,
      };
    },
  });
}
