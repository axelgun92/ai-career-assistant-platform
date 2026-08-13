import { z } from "zod";
import {
  evaluatorMetadataSchema,
  stageDefinitionMetadataSchema,
  stageOutputBaseSchema,
  type CoreEvaluationStage,
  type DomainEvaluatorDefinition,
  type StageOutput,
} from "./contracts";
import { StructuredOutputValidationError } from "./errors";

export function defineEvaluationStage<TDomainData, TData>(input: {
  id: string;
  version: string;
  ruleVersion: string;
  promptVersion?: string | null;
  onFailure: "STOP" | "CONTINUE";
  maxAttempts: number;
  invalidOutputRetryable: boolean;
  dataSchema: z.ZodType<TData>;
  evaluate(context: Parameters<CoreEvaluationStage<TDomainData>["evaluate"]>[0]): Promise<unknown>;
}): CoreEvaluationStage<TDomainData> {
  const metadata = stageDefinitionMetadataSchema.parse({
    id: input.id,
    version: input.version,
    ruleVersion: input.ruleVersion,
    promptVersion: input.promptVersion ?? null,
    onFailure: input.onFailure,
    maxAttempts: input.maxAttempts,
    invalidOutputRetryable: input.invalidOutputRetryable,
  });

  return {
    ...metadata,
    dataSchema: input.dataSchema,
    evaluate: input.evaluate,
  };
}

export function defineDomainEvaluator<TDomainData, TResult>(
  input: DomainEvaluatorDefinition<TDomainData, TResult>,
): DomainEvaluatorDefinition<TDomainData, TResult> {
  const metadata = evaluatorMetadataSchema.parse({
    domain: input.domain,
    evaluationVersion: input.evaluationVersion,
    domainVersion: input.domainVersion,
    ruleVersion: input.ruleVersion,
    promptVersion: input.promptVersion,
  });
  if (input.stages.length === 0) {
    throw new Error("A domain evaluator must declare at least one stage");
  }

  const identifiers = new Set<string>();
  for (const stage of input.stages) {
    stageDefinitionMetadataSchema.parse({
      id: stage.id,
      version: stage.version,
      ruleVersion: stage.ruleVersion,
      promptVersion: stage.promptVersion,
      onFailure: stage.onFailure,
      maxAttempts: stage.maxAttempts,
      invalidOutputRetryable: stage.invalidOutputRetryable,
    });
    if (identifiers.has(stage.id)) {
      throw new Error(`Duplicate evaluation stage identifier: ${stage.id}`);
    }
    identifiers.add(stage.id);
  }

  return { ...input, ...metadata };
}

export function parseStageOutput(
  stage: CoreEvaluationStage<unknown>,
  value: unknown,
): StageOutput {
  const output = stageOutputBaseSchema.parse(value);
  stage.dataSchema.parse(output.data);

  const references = new Set<string>();
  for (const evidence of output.evidence) {
    if (references.has(evidence.referenceId)) {
      throw new StructuredOutputValidationError(
        `Duplicate evidence reference in stage ${stage.id}: ${evidence.referenceId}`,
      );
    }
    references.add(evidence.referenceId);
  }

  for (const contradiction of output.contradictions) {
    for (const reference of [
      ...contradiction.evidenceReferencesA,
      ...contradiction.evidenceReferencesB,
    ]) {
      if (!references.has(reference)) {
        throw new StructuredOutputValidationError(
          `Contradiction in stage ${stage.id} references unknown evidence: ${reference}`,
        );
      }
    }
  }

  return output;
}
