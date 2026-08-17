import {
  StructuredOutputValidationError,
  defineEvaluationStage,
} from "@ai-career/evaluation";
import type { CustomerSuccessDomainData } from "../evaluator";
import type { CustomerSuccessPreferences } from "../config/preferences";
import {
  companyAlignmentDataSchema,
  semanticCompanyAlignmentSchema,
  type CompanyAlignmentData,
} from "../schemas/company-alignment";
import {
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "../schemas/results";

function configuredPreferenceFindings(
  alignment: Extract<CompanyAlignmentData, { evaluated: true }>["alignment"],
  preferences: CustomerSuccessPreferences,
): string[] {
  const businessModel = alignment.businessModel.classification;
  const businessFinding =
    businessModel === "UNKNOWN"
      ? "Configured business-model alignment remains Unknown."
      : preferences.companyPreferences.preferredBusinessModels.includes(
            businessModel,
          )
        ? `${businessModel} is a configured preferred business model.`
        : preferences.companyPreferences.alsoAlignedBusinessModels.includes(
              businessModel,
            )
          ? `${businessModel} is a configured also-aligned business model.`
          : `${businessModel} is not listed as a preferred or also-aligned business model.`;
  const productType = alignment.productType.classification;
  const productFinding =
    productType === "UNKNOWN"
      ? "Configured product-type alignment remains Unknown."
      : preferences.productPreferences.preferredProductTypes.includes(productType)
        ? `${productType} is a configured preferred product type.`
        : `${productType} requires contextual alignment evaluation.`;
  const customerType = alignment.customerType.classification;
  const customerFinding =
    customerType === "UNKNOWN"
      ? "Configured customer-type alignment remains Unknown."
      : preferences.customerPreferences.customerTypes.includes(customerType)
        ? `${customerType} is represented in the configured customer-type preferences.`
        : `${customerType} is outside the configured customer-type preferences.`;
  const customerSegment = alignment.customerSegment.classification;
  const segmentFinding =
    customerSegment === "UNKNOWN"
      ? "Configured customer-segment alignment remains Unknown."
      : preferences.customerPreferences.customerSegments.includes(customerSegment)
        ? `${customerSegment} is represented in the configured customer-segment preferences.`
        : `${customerSegment} is outside the configured customer-segment preferences.`;
  return [businessFinding, productFinding, customerFinding, segmentFinding];
}

export function createCompanyAlignmentStage() {
  return defineEvaluationStage<CustomerSuccessDomainData, CompanyAlignmentData>({
    id: "company-alignment",
    version: "cs-company-alignment-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-company-alignment-v1",
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: companyAlignmentDataSchema,
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
      if (hardFilters.overall === "FAIL" || !jobEvaluation.evaluated) {
        const reason =
          "Company Alignment was not performed because a hard filter failed.";
        const data = companyAlignmentDataSchema.parse({
          evaluated: false,
          reason,
        });
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
      const alignment = semanticCompanyAlignmentSchema.parse(
        await context.domainData.semanticOperations.evaluateCompanyAlignment({
          responsibilityMap: reconstruction.responsibilityMap,
          requirementMap: reconstruction.requirements,
          ownershipMap: reconstruction.ownershipMap,
          jobEvaluation,
          companyData: {
            name: context.opportunity.companyName,
            brand: context.opportunity.brand,
            parentCompany: context.opportunity.parentCompany,
            industry: context.opportunity.industry,
            headquarters: context.opportunity.headquarters,
            size: context.opportunity.companySize,
          },
          preferences: {
            companyPreferences: context.domainData.preferences.companyPreferences,
            productPreferences: context.domainData.preferences.productPreferences,
            customerPreferences: context.domainData.preferences.customerPreferences,
            careerStrategy: context.domainData.preferences.careerStrategy,
          },
          availableEvidence: reconstruction.evidence,
        }),
      );
      const references = new Set([
        ...alignment.businessModel.evidenceReferences,
        ...alignment.customerType.evidenceReferences,
        ...alignment.productType.evidenceReferences,
        ...alignment.customerSegment.evidenceReferences,
        ...alignment.evidenceReferences,
        ...alignment.strategicAdvantages.flatMap(
          (item) => item.evidenceReferences,
        ),
        ...alignment.potentialConcerns.flatMap(
          (item) => item.evidenceReferences,
        ),
        ...alignment.unknowns.flatMap((item) => item.evidenceReferences),
        ...alignment.contradictions.flatMap((item) => [
          ...item.evidenceReferencesA,
          ...item.evidenceReferencesB,
        ]),
      ]);
      const knownEvidence = new Map(
        reconstruction.evidence.map((item) => [item.referenceId, item]),
      );
      const missing = [...references].filter(
        (reference) => !knownEvidence.has(reference),
      );
      if (missing.length > 0) {
        throw new StructuredOutputValidationError(
          `Company Alignment references unknown evidence: ${missing.join(", ")}`,
        );
      }
      const data = companyAlignmentDataSchema.parse({
        evaluated: true,
        alignment,
      });
      const selectedEvidence = [...references].map(
        (reference) => knownEvidence.get(reference)!,
      );
      const confidence =
        alignment.contradictions.length > 0
          ? "CONFLICTING"
          : selectedEvidence.some((item) =>
                ["CONFIRMED", "STRONG_EVIDENCE"].includes(item.evidenceLevel),
              )
            ? "STRONG_EVIDENCE"
            : selectedEvidence.some((item) => item.evidenceLevel === "POSSIBLE")
              ? "POSSIBLE"
              : "UNKNOWN";
      return {
        classification: "ASSESSED",
        data,
        evidence: selectedEvidence,
        findings: [
          alignment.alignmentSummary,
          alignment.businessModel.explanation,
          alignment.customerType.explanation,
          alignment.productType.explanation,
          alignment.customerSegment.explanation,
          ...configuredPreferenceFindings(
            alignment,
            context.domainData.preferences,
          ),
        ],
        strengths: alignment.strategicAdvantages.map((item) => item.finding),
        concerns: alignment.potentialConcerns.map((item) => item.finding),
        unknowns: alignment.unknowns.map(({ code, description, materiality }) => ({
          code,
          description,
          materiality,
        })),
        contradictions: alignment.contradictions,
        confidence,
        completeness: alignment.unknowns.length > 0 ? "PARTIAL" : "COMPLETE",
      };
    },
  });
}
