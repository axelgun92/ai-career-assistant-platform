import {
  StructuredOutputValidationError,
  defineEvaluationStage,
} from "@ai-career/evaluation";
import type { CustomerSuccessDomainData } from "../evaluator";
import { alexFitDataSchema } from "../schemas/alex-fit";
import { companyAlignmentDataSchema } from "../schemas/company-alignment";
import {
  burnoutRiskDataSchema,
  semanticBurnoutRiskSchema,
  type BurnoutRiskData,
} from "../schemas/burnout-risk";
import { organizationalMaturityDataSchema } from "../schemas/organizational-maturity";
import {
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "../schemas/results";

export function burnoutRiskBand(score: number) {
  if (score <= 19) return "VERY_LOW" as const;
  if (score <= 39) return "LOW" as const;
  if (score <= 59) return "MIXED_MODERATE" as const;
  if (score <= 79) return "HIGH" as const;
  return "VERY_HIGH" as const;
}

export function createBurnoutRiskStage() {
  return defineEvaluationStage<CustomerSuccessDomainData, BurnoutRiskData>({
    id: "burnout-risk",
    version: "cs-burnout-risk-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-burnout-risk-v1",
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: burnoutRiskDataSchema,
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
      const organizationalMaturity = organizationalMaturityDataSchema.parse(
        context.previousStageResults.find(
          (stage) => stage.stageId === "organizational-maturity",
        )?.result?.data,
      );
      const companyAlignment = companyAlignmentDataSchema.parse(
        context.previousStageResults.find(
          (stage) => stage.stageId === "company-alignment",
        )?.result?.data,
      );
      const alexFit = alexFitDataSchema.parse(
        context.previousStageResults.find(
          (stage) => stage.stageId === "alex-fit",
        )?.result?.data,
      );
      if (
        hardFilters.overall === "FAIL" ||
        !jobEvaluation.evaluated ||
        !companyAlignment.evaluated ||
        !organizationalMaturity.evaluated
      ) {
        const reason =
          "Burnout Risk was not performed because substantive evaluation did not continue.";
        const data = burnoutRiskDataSchema.parse({ evaluated: false, reason });
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
          completeness: "INSUFFICIENT",
        };
      }

      const reconstruction =
        context.domainData.reconstruction ?? hardFilters.reconstruction;
      context.domainData.reconstruction = reconstruction;
      const profileEvidence = context.domainData.userProfile?.evidence ?? [];
      const availableEvidence = [...reconstruction.evidence, ...profileEvidence];
      const risk = semanticBurnoutRiskSchema.parse(
        await context.domainData.semanticOperations.evaluateBurnoutRisk({
          responsibilityMap: reconstruction.responsibilityMap,
          ownershipMap: reconstruction.ownershipMap,
          travel: reconstruction.travel,
          jobEvaluation,
          companyAlignment,
          organizationalMaturity,
          alexFit,
          preferences: {
            workloadPreferences:
              context.domainData.preferences.workloadPreferences,
            workStylePreferences:
              context.domainData.preferences.workStylePreferences,
          },
          availableEvidence,
        }),
      );
      const references = new Set([
        ...risk.scoreEvidenceReferences,
        ...risk.evidenceReferences,
        ...risk.majorContributors.flatMap((item) => item.evidenceReferences),
        ...risk.positiveIndicators.flatMap((item) => item.evidenceReferences),
        ...risk.unknowns.flatMap((item) => item.evidenceReferences),
        ...risk.contradictions.flatMap((item) => [
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
          `Burnout Risk references unknown evidence: ${missing.join(", ")}`,
        );
      }
      const classification = burnoutRiskBand(risk.score);
      const data = burnoutRiskDataSchema.parse({
        evaluated: true,
        classification,
        risk,
      });
      const selectedEvidence = [...references].map(
        (reference) => knownEvidence.get(reference)!,
      );
      return {
        classification,
        data,
        evidence: selectedEvidence,
        findings: [risk.summary, risk.scoreExplanation],
        strengths: risk.positiveIndicators.map((item) => item.finding),
        concerns: risk.majorContributors.map((item) => item.finding),
        unknowns: risk.unknowns.map(({ code, description, materiality }) => ({
          code,
          description,
          materiality,
        })),
        contradictions: risk.contradictions,
        confidence:
          risk.contradictions.length > 0 ? "CONFLICTING" : "STRONG_EVIDENCE",
        completeness: risk.unknowns.length > 0 ? "PARTIAL" : "COMPLETE",
      };
    },
  });
}
