import {
  defineDomainEvaluator,
  type CoreEvaluationContext,
} from "@ai-career/evaluation";
import type { CustomerSuccessPreferences } from "./config/preferences";
import { createHardFiltersStage } from "./evaluation/hard-filters";
import { createJobEvaluationStage } from "./evaluation/job-evaluation";
import type {
  CustomerSuccessSemanticOperations,
} from "./extraction/extractor";
import type { CustomerSuccessJdReconstruction } from "./schemas/maps";
import {
  customerSuccessMilestoneFourResultSchema,
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "./schemas/results";

export interface CustomerSuccessDomainData {
  preferences: CustomerSuccessPreferences;
  semanticOperations: CustomerSuccessSemanticOperations;
  reconstruction: CustomerSuccessJdReconstruction | null;
}

export function createCustomerSuccessDomainData(input: {
  preferences: CustomerSuccessPreferences;
  semanticOperations: CustomerSuccessSemanticOperations;
}): CustomerSuccessDomainData {
  return { ...input, reconstruction: null };
}

export function createCustomerSuccessEvaluator() {
  return defineDomainEvaluator({
    domain: "customer-success",
    evaluationVersion: "cs-evaluation-v1.1-m4",
    domainVersion: "customer-success-v1.1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-m4-prompts-v1",
    stages: [createHardFiltersStage(), createJobEvaluationStage()],
    resultSchema: customerSuccessMilestoneFourResultSchema,
    async finalize(context: CoreEvaluationContext<CustomerSuccessDomainData>) {
      const hardFilters = context.previousStageResults.find(
        (stage) => stage.stageId === "hard-filters",
      );
      const jobEvaluation = context.previousStageResults.find(
        (stage) => stage.stageId === "job-evaluation",
      );
      return {
        hardFilters: hardFiltersDataSchema.parse(hardFilters?.result?.data),
        jobEvaluation: jobEvaluationDataSchema.parse(jobEvaluation?.result?.data),
      };
    },
  });
}
