import {
  StructuredOutputValidationError,
  defineEvaluationStage,
} from "@ai-career/evaluation";
import type { CustomerSuccessDomainData } from "../evaluator";
import { companyAlignmentDataSchema } from "../schemas/company-alignment";
import {
  assertCustomerOperatingModelResponsibilitySupport,
  customerSuccessOrganizationalMaturityPromptVersion,
  organizationalMaturityBand,
  organizationalMaturityDataSchema,
  semanticOrganizationalMaturitySchema,
  restoreOrganizationalMaturityRelationships,
  type OrganizationalMaturityData,
} from "../schemas/organizational-maturity";
import {
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "../schemas/results";

export function createOrganizationalMaturityStage() {
  return defineEvaluationStage<
    CustomerSuccessDomainData,
    OrganizationalMaturityData
  >({
    id: "organizational-maturity",
    version: "cs-organizational-maturity-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: customerSuccessOrganizationalMaturityPromptVersion,
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: organizationalMaturityDataSchema,
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
      if (
        hardFilters.overall === "FAIL" ||
        !jobEvaluation.evaluated ||
        !companyAlignment.evaluated
      ) {
        const reason =
          "Organizational Maturity was not performed because a hard filter failed.";
        const data = organizationalMaturityDataSchema.parse({
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
      const maturity = restoreOrganizationalMaturityRelationships(
        semanticOrganizationalMaturitySchema.parse(
          await context.domainData.semanticOperations.evaluateOrganizationalMaturity(
            {
              responsibilityMap: reconstruction.responsibilityMap,
              requirementMap: reconstruction.requirements,
              ownershipMap: reconstruction.ownershipMap,
              jobEvaluation,
              companyAlignment,
              availableEvidence: reconstruction.evidence,
            },
          ),
        ),
        reconstruction.ownershipMap,
        reconstruction.evidence,
      );
      assertCustomerOperatingModelResponsibilitySupport(
        maturity.customerOperatingModel,
        reconstruction.responsibilityMap,
      );
      const design = maturity.ownershipAndCrossFunctionalDesign;
      const references = new Set([
        ...maturity.scoreEvidenceReferences,
        ...maturity.existingCustomerSuccessFunction.evidenceReferences,
        ...maturity.customerOperatingModel.evidenceReferences,
        ...design.evidenceReferences,
        ...design.roleBoundaries.evidenceReferences,
        ...design.teamBoundaries.evidenceReferences,
        ...design.handoffs.evidenceReferences,
        ...design.sharedOwnership.evidenceReferences,
        ...design.crossFunctionalRelationships.evidenceReferences,
        ...design.unrelatedResponsibilities.evidenceReferences,
        ...design.scopeCreep.evidenceReferences,
        ...design.multipleJobsCombined.evidenceReferences,
        ...design.unrealisticOwnership.evidenceReferences,
        ...maturity.evidenceReferences,
        ...maturity.positiveSignals.flatMap((item) => item.evidenceReferences),
        ...maturity.weakSignals.flatMap((item) => item.evidenceReferences),
        ...maturity.unknowns.flatMap((item) => item.evidenceReferences),
        ...maturity.contradictions.flatMap((item) => [
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
          `Organizational Maturity references unknown evidence: ${missing.join(", ")}`,
        );
      }
      const data = organizationalMaturityDataSchema.parse({
        evaluated: true,
        maturity,
      });
      const selectedEvidence = [...references].map(
        (reference) => knownEvidence.get(reference)!,
      );
      const confidence =
        maturity.contradictions.length > 0
          ? "CONFLICTING"
          : selectedEvidence.some((item) =>
                ["CONFIRMED", "STRONG_EVIDENCE"].includes(item.evidenceLevel),
              )
            ? "STRONG_EVIDENCE"
            : selectedEvidence.some((item) => item.evidenceLevel === "POSSIBLE")
              ? "POSSIBLE"
              : "UNKNOWN";
      return {
        classification: organizationalMaturityBand(maturity.score),
        data,
        evidence: selectedEvidence,
        findings: [
          maturity.summary,
          maturity.scoreExplanation,
          maturity.existingCustomerSuccessFunction.explanation,
          maturity.customerOperatingModel.explanation,
          design.summary,
        ],
        strengths: maturity.positiveSignals.map((item) => item.finding),
        concerns: maturity.weakSignals.map((item) => item.finding),
        unknowns: maturity.unknowns.map(({ code, description, materiality }) => ({
          code,
          description,
          materiality,
        })),
        contradictions: maturity.contradictions,
        confidence,
        completeness: maturity.unknowns.length > 0 ? "PARTIAL" : "COMPLETE",
      };
    },
  });
}
