import {
  StructuredOutputValidationError,
  defineEvaluationStage,
} from "@ai-career/evaluation";
import type { CustomerSuccessDomainData } from "../evaluator";
import {
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
  semanticJobEvaluationSchema,
  type JobEvaluationData,
} from "../schemas/results";

export function createJobEvaluationStage() {
  return defineEvaluationStage<CustomerSuccessDomainData, JobEvaluationData>({
    id: "job-evaluation",
    version: "cs-job-evaluation-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-job-evaluation-v1",
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: jobEvaluationDataSchema,
    async evaluate(context) {
      const prior = context.previousStageResults.find(
        (stage) => stage.stageId === "hard-filters",
      );
      const hardFilters = hardFiltersDataSchema.parse(prior?.result?.data);
      if (hardFilters.overall === "FAIL") {
        const reason =
          "Job Evaluation was not performed because a hard filter failed.";
        const data = jobEvaluationDataSchema.parse({
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
      const reconstruction = context.domainData.reconstruction ?? hardFilters.reconstruction;
      context.domainData.reconstruction = reconstruction;
      const evaluation = semanticJobEvaluationSchema.parse(
        await context.domainData.semanticOperations.evaluateJob({
          responsibilityMap: reconstruction.responsibilityMap,
          ownershipMap: reconstruction.ownershipMap,
          roleMetadata: reconstruction.roleMetadata,
          companyData: {
            name: context.opportunity.companyName,
            industry: context.opportunity.industry,
            size: context.opportunity.companySize,
          },
          availableEvidence: reconstruction.evidence,
        }),
      );
      const knownEvidence = new Map(
        reconstruction.evidence.map((item) => [item.referenceId, item]),
      );
      const references = new Set([
        ...evaluation.evidenceReferences,
        ...evaluation.customerLifecycleInvolvement.evidenceReferences,
        ...evaluation.customerOwnership.evidenceReferences,
        ...evaluation.strategicResponsibility.evidenceReferences,
        ...evaluation.technicalExposure.evidenceReferences,
        ...evaluation.commercialResponsibility.evidenceReferences,
        ...evaluation.crossFunctionalInvolvement.evidenceReferences,
        ...evaluation.businessImpact.evidenceReferences,
        ...evaluation.strategicBridgeValue.evidenceReferences,
        ...evaluation.contradictions.flatMap((item) => [
          ...item.evidenceReferencesA,
          ...item.evidenceReferencesB,
        ]),
      ]);
      const missing = [...references].filter((reference) => !knownEvidence.has(reference));
      if (missing.length > 0) {
        throw new StructuredOutputValidationError(
          `Job Evaluation references unknown evidence: ${missing.join(", ")}`,
        );
      }
      const data = jobEvaluationDataSchema.parse({
        evaluated: true,
        roleClassification: reconstruction.roleMetadata.actualRoleClassification,
        evaluation,
      });
      return {
        classification: reconstruction.roleMetadata.actualRoleClassification,
        data,
        evidence: [...references].map((reference) => knownEvidence.get(reference)!),
        findings: [evaluation.practicalSummary, ...evaluation.primaryWork],
        strengths: evaluation.strengths,
        concerns: evaluation.concerns,
        unknowns: evaluation.unknowns,
        contradictions: evaluation.contradictions,
        confidence: references.size > 0 ? "STRONG_EVIDENCE" : "UNKNOWN",
        completeness: evaluation.unknowns.length > 0 ? "PARTIAL" : "COMPLETE",
      };
    },
  });
}
