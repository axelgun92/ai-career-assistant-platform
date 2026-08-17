import {
  StructuredOutputValidationError,
  defineEvaluationStage,
} from "@ai-career/evaluation";
import type { CustomerSuccessDomainData } from "../evaluator";
import {
  alexFitDataSchema,
  semanticAlexFitSchema,
  type AlexFitData,
} from "../schemas/alex-fit";
import { companyAlignmentDataSchema } from "../schemas/company-alignment";
import { organizationalMaturityDataSchema } from "../schemas/organizational-maturity";
import {
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "../schemas/results";
import { createCustomerSuccessProfileContext } from "../profile/user-profile";

function notEvaluated(reason: string) {
  const data = alexFitDataSchema.parse({ evaluated: false, reason });
  return {
    classification: "NOT_EVALUATED",
    data,
    evidence: [],
    findings: [reason],
    strengths: [],
    concerns: [reason],
    unknowns: [],
    contradictions: [],
    confidence: null,
    completeness: "INSUFFICIENT" as const,
  };
}

export function createAlexFitStage() {
  return defineEvaluationStage<CustomerSuccessDomainData, AlexFitData>({
    id: "alex-fit",
    version: "cs-alex-fit-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-alex-fit-v1",
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: alexFitDataSchema,
    async evaluate(context) {
      const hardFilters = hardFiltersDataSchema.parse(
        context.previousStageResults.find(
          (stage) => stage.stageId === "hard-filters",
        )?.result?.data,
      );
      const jobEvaluation = jobEvaluationDataSchema.parse(
        context.previousStageResults.find(
          (stage) => stage.stageId === "job-evaluation",
        )?.result?.data,
      );
      const companyAlignment = companyAlignmentDataSchema.parse(
        context.previousStageResults.find(
          (stage) => stage.stageId === "company-alignment",
        )?.result?.data,
      );
      const organizationalMaturity = organizationalMaturityDataSchema.parse(
        context.previousStageResults.find(
          (stage) => stage.stageId === "organizational-maturity",
        )?.result?.data,
      );
      if (
        hardFilters.overall === "FAIL" ||
        !jobEvaluation.evaluated ||
        !companyAlignment.evaluated ||
        !organizationalMaturity.evaluated
      ) {
        return notEvaluated(
          "Alex Fit was not performed because substantive evaluation did not continue.",
        );
      }
      if (!context.userProfile) {
        return notEvaluated(
          "Alex Fit was not performed because no versioned user profile was supplied.",
        );
      }

      const reconstruction =
        context.domainData.reconstruction ?? hardFilters.reconstruction;
      context.domainData.reconstruction = reconstruction;
      const profile =
        context.domainData.userProfile ??
        createCustomerSuccessProfileContext(context.userProfile);
      context.domainData.userProfile = profile;
      const availableEvidence = [...reconstruction.evidence, ...profile.evidence];
      const fit = semanticAlexFitSchema.parse(
        await context.domainData.semanticOperations.evaluateAlexFit({
          responsibilityMap: reconstruction.responsibilityMap,
          requirementMap: reconstruction.requirements,
          ownershipMap: reconstruction.ownershipMap,
          jobEvaluation,
          companyAlignment,
          organizationalMaturity,
          userProfile: profile,
          preferences: {
            fitPreferences: context.domainData.preferences.fitPreferences,
            workStylePreferences:
              context.domainData.preferences.workStylePreferences,
            careerStrategy: context.domainData.preferences.careerStrategy,
          },
          availableEvidence,
        }),
      );
      const references = new Set([
        ...fit.evidenceReferences,
        ...fit.experienceAlignment.evidenceReferences,
        ...fit.workingStyleAlignment.flatMap(
          (item) => item.evidenceReferences,
        ),
        ...fit.careerStrategyAlignment.evidenceReferences,
        ...fit.strongestMatches.flatMap((item) => item.evidenceReferences),
        ...fit.partialMatches.flatMap((item) => item.evidenceReferences),
        ...fit.concerns.flatMap((item) => item.evidenceReferences),
        ...fit.strategicValue.flatMap((item) => item.evidenceReferences),
        ...fit.unknowns.flatMap((item) => item.evidenceReferences),
        ...fit.contradictions.flatMap((item) => [
          ...item.evidenceReferencesA,
          ...item.evidenceReferencesB,
        ]),
      ]);
      const knownEvidence = new Map(
        availableEvidence.map((item) => [item.referenceId, item]),
      );
      const missing = [...references].filter(
        (reference) => !knownEvidence.has(reference),
      );
      if (missing.length > 0) {
        throw new StructuredOutputValidationError(
          `Alex Fit references unknown evidence: ${missing.join(", ")}`,
        );
      }
      const data = alexFitDataSchema.parse({ evaluated: true, fit });
      const selectedEvidence = [...references].map(
        (reference) => knownEvidence.get(reference)!,
      );
      return {
        classification: fit.classification,
        data,
        evidence: selectedEvidence,
        findings: [
          fit.summary,
          fit.experienceAlignment.explanation,
          fit.careerStrategyAlignment.conclusion,
        ],
        strengths: fit.strongestMatches.map((item) => item.finding),
        concerns: fit.concerns.map((item) => item.finding),
        unknowns: fit.unknowns.map(({ code, description, materiality }) => ({
          code,
          description,
          materiality,
        })),
        contradictions: fit.contradictions,
        confidence:
          fit.contradictions.length > 0 ? "CONFLICTING" : "STRONG_EVIDENCE",
        completeness: fit.unknowns.length > 0 ? "PARTIAL" : "COMPLETE",
      };
    },
  });
}
