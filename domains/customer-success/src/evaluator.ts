import {
  defineDomainEvaluator,
  type CoreEvaluationContext,
} from "@ai-career/evaluation";
import type { CustomerSuccessPreferences } from "./config/preferences";
import { createHardFiltersStage } from "./evaluation/hard-filters";
import { createJobEvaluationStage } from "./evaluation/job-evaluation";
import { createCompanyAlignmentStage } from "./evaluation/company-alignment";
import { createOrganizationalMaturityStage } from "./evaluation/organizational-maturity";
import type {
  CustomerSuccessSemanticOperations,
} from "./extraction/extractor";
import type { CustomerSuccessJdReconstruction } from "./schemas/maps";
import {
  customerSuccessMilestoneFiveResultSchema,
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "./schemas/results";
import { companyAlignmentDataSchema } from "./schemas/company-alignment";
import { organizationalMaturityDataSchema } from "./schemas/organizational-maturity";

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
    evaluationVersion: "cs-evaluation-v1.1-m5",
    domainVersion: "customer-success-v1.1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-m5-prompts-v1",
    stages: [
      createHardFiltersStage(),
      createJobEvaluationStage(),
      createCompanyAlignmentStage(),
      createOrganizationalMaturityStage(),
    ],
    resultSchema: customerSuccessMilestoneFiveResultSchema,
    async finalize(context: CoreEvaluationContext<CustomerSuccessDomainData>) {
      const hardFilters = context.previousStageResults.find(
        (stage) => stage.stageId === "hard-filters",
      );
      const jobEvaluation = context.previousStageResults.find(
        (stage) => stage.stageId === "job-evaluation",
      );
      const companyAlignment = context.previousStageResults.find(
        (stage) => stage.stageId === "company-alignment",
      );
      const organizationalMaturity = context.previousStageResults.find(
        (stage) => stage.stageId === "organizational-maturity",
      );
      return {
        hardFilters: hardFiltersDataSchema.parse(hardFilters?.result?.data),
        jobEvaluation: jobEvaluationDataSchema.parse(jobEvaluation?.result?.data),
        companyAlignment: companyAlignmentDataSchema.parse(
          companyAlignment?.result?.data,
        ),
        organizationalMaturity: organizationalMaturityDataSchema.parse(
          organizationalMaturity?.result?.data,
        ),
      };
    },
  });
}
