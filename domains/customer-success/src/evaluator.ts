import {
  defineDomainEvaluator,
  type CoreEvaluationContext,
} from "@ai-career/evaluation";
import type { CustomerSuccessPreferences } from "./config/preferences";
import { createHardFiltersStage } from "./evaluation/hard-filters";
import { createJobEvaluationStage } from "./evaluation/job-evaluation";
import { createCompanyAlignmentStage } from "./evaluation/company-alignment";
import { createOrganizationalMaturityStage } from "./evaluation/organizational-maturity";
import { createAlexFitStage } from "./evaluation/alex-fit";
import { createBurnoutRiskStage } from "./evaluation/burnout-risk";
import { createResumeMatchStage } from "./evaluation/resume-match";
import type { CustomerSuccessSemanticOperations } from "./extraction/extractor";
import type { CustomerSuccessJdReconstruction } from "./schemas/maps";
import type { CustomerSuccessProfileContext } from "./profile/user-profile";
import {
  customerSuccessMilestoneSevenResultSchema,
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "./schemas/results";
import { companyAlignmentDataSchema } from "./schemas/company-alignment";
import { organizationalMaturityDataSchema } from "./schemas/organizational-maturity";
import { alexFitDataSchema } from "./schemas/alex-fit";
import { burnoutRiskDataSchema } from "./schemas/burnout-risk";
import { resumeMatchDataSchema } from "./schemas/resume-match";

export interface CustomerSuccessDomainData {
  preferences: CustomerSuccessPreferences;
  semanticOperations: CustomerSuccessSemanticOperations;
  reconstruction: CustomerSuccessJdReconstruction | null;
  userProfile: CustomerSuccessProfileContext | null;
}

export function createCustomerSuccessDomainData(input: {
  preferences: CustomerSuccessPreferences;
  semanticOperations: CustomerSuccessSemanticOperations;
}): CustomerSuccessDomainData {
  return { ...input, reconstruction: null, userProfile: null };
}

export function createCustomerSuccessEvaluator() {
  return defineDomainEvaluator({
    domain: "customer-success",
    evaluationVersion: "cs-evaluation-v1.1-m7",
    domainVersion: "customer-success-v1.1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-m7-prompts-v1",
    stages: [
      createHardFiltersStage(),
      createJobEvaluationStage(),
      createCompanyAlignmentStage(),
      createOrganizationalMaturityStage(),
      createAlexFitStage(),
      createBurnoutRiskStage(),
      createResumeMatchStage(),
    ],
    resultSchema: customerSuccessMilestoneSevenResultSchema,
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
      const alexFit = context.previousStageResults.find(
        (stage) => stage.stageId === "alex-fit",
      );
      const burnoutRisk = context.previousStageResults.find(
        (stage) => stage.stageId === "burnout-risk",
      );
      const resumeMatch = context.previousStageResults.find(
        (stage) => stage.stageId === "resume-match",
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
        alexFit: alexFitDataSchema.parse(alexFit?.result?.data),
        burnoutRisk: burnoutRiskDataSchema.parse(burnoutRisk?.result?.data),
        resumeMatch: resumeMatchDataSchema.parse(resumeMatch?.result?.data),
      };
    },
  });
}
