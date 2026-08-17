import {
  defineCustomerSuccessPreferences,
  ownershipFunctions,
  responsibilityAreas,
  type CustomerSuccessSemanticOperations,
  type SemanticReconstruction,
} from "@ai-career/customer-success";
import { StageExecutionError } from "@ai-career/evaluation";
import type { EvidenceRecordDraft } from "@ai-career/evidence";

export type CustomerSuccessScenario =
  | "strong"
  | "misleading-title"
  | "support-heavy"
  | "sales-heavy"
  | "implementation-heavy"
  | "technical-cs"
  | "unrelated"
  | "software-only"
  | "contradictory";

export const customerSuccessTestPreferences = defineCustomerSuccessPreferences({
  salary: {
    currency: "USD",
    passMinimum: 60_000,
    reviewMinimum: 55_000,
    substantiallyLowerCostCountries: ["Mexico", "Colombia"],
  },
  location: {
    allowedCountries: ["United States", "Mexico", "Colombia"],
    disallowedCountries: [],
    allowUnitedStatesOnlyRoles: true,
  },
  travel: {
    allowInfrequentCompanyEvents: true,
    allowExceptionalCustomerVisits: true,
    recurringCustomerOnsiteResult: "FAIL",
    fieldTravelResult: "FAIL",
  },
  workArrangement: { allowed: ["REMOTE"], unknownResult: "UNKNOWN" },
  roleFamilies: {
    continuingClassifications: [
      "CORE_CS",
      "CS_ADJACENT",
      "SUPPORT_HEAVY",
      "SALES_HEAVY",
      "IMPLEMENTATION_HEAVY",
      "TECHNICAL_CS",
    ],
  },
});

function evidence(input: {
  referenceId: string;
  claim: string;
  sourceText: string;
  sourceRecordId: string | null;
  provenanceId: string | null;
  origin?: "EXPLICIT" | "INFERRED";
}): EvidenceRecordDraft {
  return {
    referenceId: input.referenceId,
    criterionId: "jd-reconstruction",
    claim: input.claim,
    sourceType: "MANUAL",
    sourceRecordId: input.sourceRecordId,
    provenanceId: input.provenanceId,
    sourceField: "jobDescription",
    sourceReference: "manual-submission",
    sourceText: input.sourceText,
    evidenceType: "JD_RECONSTRUCTION",
    origin: input.origin ?? "EXPLICIT",
    evidenceLevel: input.origin === "INFERRED" ? "STRONG_EVIDENCE" : "CONFIRMED",
    collectedAt: null,
  };
}

function roleFor(scenario: CustomerSuccessScenario) {
  if (scenario === "support-heavy") return "SUPPORT_HEAVY" as const;
  if (scenario === "sales-heavy") return "SALES_HEAVY" as const;
  if (scenario === "implementation-heavy") return "IMPLEMENTATION_HEAVY" as const;
  if (scenario === "technical-cs") return "TECHNICAL_CS" as const;
  if (scenario === "unrelated") return "UNRELATED" as const;
  return "CORE_CS" as const;
}

function responsibilityFor(scenario: CustomerSuccessScenario) {
  if (scenario === "support-heavy") return "support" as const;
  if (scenario === "sales-heavy") return "expansion" as const;
  if (scenario === "implementation-heavy") return "implementation" as const;
  if (scenario === "technical-cs") return "technicalTroubleshooting" as const;
  if (scenario === "unrelated") return "projectManagement" as const;
  return "adoption" as const;
}

export function createCustomerSuccessFixtureOperations(input: {
  scenario: CustomerSuccessScenario;
  failReconstructionOnce?: boolean;
}) {
  const stats = { reconstructionCalls: 0, jobEvaluationCalls: 0 };
  const semanticOperations: CustomerSuccessSemanticOperations = {
    async reconstructJobDescription(source) {
      stats.reconstructionCalls += 1;
      if (input.failReconstructionOnce && stats.reconstructionCalls === 1) {
        throw new StageExecutionError({
          code: "CS_SEMANTIC_TEMPORARY_FAILURE",
          message: "Fixture reconstruction failed temporarily",
          retryable: true,
        });
      }
      const primaryArea = responsibilityFor(input.scenario);
      const baseEvidence = [
        evidence({
          referenceId: "actual-work",
          claim: "The description explicitly states the role's primary work.",
          sourceText:
            input.scenario === "unrelated"
              ? "Own internal marketing project schedules and campaign delivery."
              : input.scenario === "support-heavy"
                ? "Resolve a high volume of customer tickets and escalations."
                : input.scenario === "sales-heavy"
                  ? "Own quota-carrying expansion sales and close new revenue."
                  : input.scenario === "implementation-heavy"
                    ? "Lead customer implementations, configuration, and go-live projects."
                    : input.scenario === "technical-cs"
                      ? "Troubleshoot APIs and integrations while guiding customer adoption."
                      : "Own customer adoption, success plans, retention, and business reviews.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "role-inference",
          claim: "The combined responsibilities support the actual-role classification.",
          sourceText: "Role classification derived from the reconstructed responsibilities.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
          origin: "INFERRED",
        }),
        evidence({
          referenceId: "product-collaboration",
          claim: "The role collaborates with Product rather than owning Product work.",
          sourceText: "Collaborate with Product to share customer feedback.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "technology-work",
          claim:
            input.scenario === "software-only"
              ? "The company uses ordinary office software."
              : "The role uses product analytics and works with engineering on integrations.",
          sourceText:
            input.scenario === "software-only"
              ? "Use Microsoft Office and Slack."
              : "Use product analytics and collaborate with engineering on API integrations.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
      ];
      if (input.scenario === "contradictory") {
        baseEvidence.push(
          evidence({
            referenceId: "remote-claim",
            claim: "The role is described as fully remote.",
            sourceText: "This is a fully remote role.",
            sourceRecordId: source.sourceRecordId,
            provenanceId: source.provenanceId,
          }),
          evidence({
            referenceId: "office-claim",
            claim: "The role also requires office attendance.",
            sourceText: "Employees must attend the office three days each week.",
            sourceRecordId: source.sourceRecordId,
            provenanceId: source.provenanceId,
          }),
        );
      }
      const areas = Object.fromEntries(
        responsibilityAreas.map((area) => [
          area,
          area === primaryArea
            ? {
                prominence: "PRIMARY",
                ownership: "OWNS",
                evidenceReferences: ["actual-work"],
              }
            : {
                prominence: "UNKNOWN",
                ownership: "UNKNOWN",
                evidenceReferences: [],
              },
        ]),
      );
      const functions = Object.fromEntries(
        ownershipFunctions
          .filter((item) => item === "product" || item === "customerSuccess")
          .map((item) => [
            item,
            item === "product"
              ? {
                  relationship: "COLLABORATES",
                  evidenceReferences: ["product-collaboration"],
                }
              : {
                  relationship: "OWNS",
                  evidenceReferences: ["actual-work"],
                },
          ]),
      );
      const reconstruction: SemanticReconstruction = {
        responsibilityMap: { areas: areas as never, other: [] },
        requirements: [],
        ownershipMap: { functions: functions as never },
        roleMetadata: {
          actualRoleClassification: roleFor(input.scenario),
          evidenceReferences: ["actual-work", "role-inference"],
        },
        evidence: baseEvidence,
        contradictions:
          input.scenario === "contradictory"
            ? [
                {
                  claimA: "The role is fully remote.",
                  claimB: "The role requires office attendance three days weekly.",
                  interpretation: "The work-arrangement statements conflict.",
                  relevantField: "workArrangement",
                  significance: "MATERIAL",
                  evidenceReferencesA: ["remote-claim"],
                  evidenceReferencesB: ["office-claim"],
                },
              ]
            : [],
      };
      return reconstruction;
    },
    async evaluateJob(job) {
      stats.jobEvaluationCalls += 1;
      const softwareOnly = input.scenario === "software-only";
      const dimension = (conclusion: string, reference = "actual-work") => ({
        conclusion,
        evidenceReferences: [reference],
        unknown: false,
      });
      return {
        practicalSummary:
          input.scenario === "misleading-title"
            ? "Despite the support-oriented title, the employee owns adoption, retention, and customer outcomes."
            : "The employee performs the primary work reconstructed from the responsibility and ownership maps.",
        primaryWork: [
          `Primary responsibility: ${responsibilityFor(input.scenario)}.`,
        ],
        customerLifecycleInvolvement: dimension("The role participates in the customer lifecycle."),
        customerOwnership: dimension("The role owns the work identified in the map."),
        strategicResponsibility: dimension("The role connects work to customer outcomes."),
        technicalExposure: dimension(
          softwareOnly
            ? "Only ordinary software use is supported."
            : "Product analytics and integration work provide meaningful technical exposure.",
          "technology-work",
        ),
        commercialResponsibility: dimension("Commercial responsibility follows the reconstructed role scope."),
        crossFunctionalInvolvement: dimension(
          "The role collaborates with Product without owning Product work.",
          "product-collaboration",
        ),
        businessImpact: dimension("The work affects customer outcomes."),
        strategicBridgeValue: {
          classification: softwareOnly ? "LOW" : "HIGH",
          explanation: softwareOnly
            ? "Ordinary software use alone is not meaningful technical bridge evidence."
            : "Product analytics, engineering collaboration, and integration work create bridge value.",
          evidenceReferences: ["technology-work"],
        },
        evidenceReferences: [
          "actual-work",
          "product-collaboration",
          "technology-work",
        ],
        strengths: softwareOnly ? [] : ["Meaningful product and engineering exposure."],
        concerns: softwareOnly ? ["No meaningful technical bridge evidence."] : [],
        unknowns: [],
        contradictions: [],
      };
    },
  };
  return { semanticOperations, stats };
}
