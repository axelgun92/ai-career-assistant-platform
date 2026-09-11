import {
  defineCustomerSuccessPreferences,
  burnoutRiskAffirmativeFactCatalog,
  ownershipFunctions,
  organizationalMaturityRelationshipTransport,
  responsibilityAreas,
  type CustomerSuccessSemanticOperations,
  type SemanticCompanyAlignment,
  type SemanticOrganizationalMaturity,
  type SemanticAlexFit,
  type SemanticBurnoutRisk,
  type SemanticResumeMatch,
  type SemanticOpportunityPriority,
  type SemanticGhostJobRisk,
  type SemanticReconstruction,
} from "../../domains/customer-success/src/index";
import {
  StageExecutionError,
  type SemanticProviderTransport,
} from "../../packages/evaluation/src/index";
import type { EvidenceRecordDraft } from "../../packages/evidence/src/index";

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

// Test-only encoding. This declares controlled fixture judgments; it must not
// be used to project a historical model score whose support has changed.
export function toBurnoutRiskProviderTransport(domain: SemanticBurnoutRisk, evidence: EvidenceRecordDraft[]) {
  const catalog = burnoutRiskAffirmativeFactCatalog(evidence);
  const indexes = (references: string[]) => references.map(reference => {
    const index = catalog.findIndex(fact => fact.evidenceReference === reference);
    if (index < 0) throw new Error("Fixture lacks an affirmative Burnout Risk fact");
    return index;
  });
  const finding = (item: SemanticBurnoutRisk["positiveIndicators"][number], effect: "SUPPORTED_RISK" | "SUPPORTED_MITIGATION") => ({
    finding: item.finding, effect, evidenceState: "SUPPORTED_PRESENT" as const,
    factIndexes: indexes(item.evidenceReferences),
  });
  const { scoreEvidenceReferences, ...rest } = domain;
  return {
    ...rest, scoreFactIndexes: indexes(scoreEvidenceReferences),
    majorContributors: domain.majorContributors.map(item => finding(item, "SUPPORTED_RISK")),
    positiveIndicators: domain.positiveIndicators.map(item => finding(item, "SUPPORTED_MITIGATION")),
  };
}

export interface CompanyAlignmentFixtureOptions {
  businessModel?: SemanticCompanyAlignment["businessModel"]["classification"];
  customerType?: SemanticCompanyAlignment["customerType"]["classification"];
  productType?: SemanticCompanyAlignment["productType"]["classification"];
  customerSegment?: SemanticCompanyAlignment["customerSegment"]["classification"];
  enterpriseConcernSupported?: boolean;
  developerConcernSupported?: boolean;
  contradictoryCompanyEvidence?: boolean;
}

export interface OrganizationalMaturityFixtureOptions {
  existingFunction?: SemanticOrganizationalMaturity["existingCustomerSuccessFunction"]["classification"];
  operatingModel?: SemanticOrganizationalMaturity["customerOperatingModel"]["classification"];
  score?: number;
  scopeCreepSupported?: boolean;
  multipleJobsSupported?: boolean;
  unrealisticOwnershipSupported?: boolean;
  contradictoryOrganizationEvidence?: boolean;
}

export interface AlexFitFixtureOptions {
  classification?: SemanticAlexFit["classification"];
  experienceRelationship?: SemanticAlexFit["experienceAlignment"]["relationship"];
  workingStyleConcern?: boolean;
  missingWorkingStyleInformation?: boolean;
  contradictoryFitEvidence?: boolean;
  preferredKeywordOnly?: boolean;
  customerCallsOnly?: boolean;
}

export interface BurnoutRiskFixtureOptions {
  score?: number;
  substantialDistinctFunctionOwnership?: boolean;
  complementaryCustomerSuccessScope?: boolean;
  genericPhrasesOnly?: boolean;
  contradictoryWorkloadEvidence?: boolean;
}

export interface ResumeMatchFixtureOptions {
  score?: number;
  effectiveLevelFit?: SemanticResumeMatch["effectiveSeniority"]["effectiveLevelFit"];
  actualResponsibilitySeniority?: SemanticResumeMatch["effectiveSeniority"]["actualResponsibilitySeniority"]["classification"];
  requirementClassifications?: SemanticResumeMatch["requirementAssessments"][number]["classification"][];
  matchedExperienceSpecificities?: SemanticResumeMatch["requirementAssessments"][number]["matchedExperienceSpecificity"][];
  decisionImpacts?: SemanticResumeMatch["requirementAssessments"][number]["decisionImpact"][];
  contradiction?:
    | "INFLATED_YEARS"
    | "LOW_YEARS_SENIOR_SCOPE"
    | "SENIOR_TITLE_ROUTINE_SCOPE"
    | "JUNIOR_TITLE_SENIOR_SCOPE";
}

type ProviderRequirement = SemanticReconstruction["requirements"][number] & {
  requirementIndex: number;
};

export function toResumeMatchProviderTransport(
  output: SemanticResumeMatch,
  providerRequirements: ProviderRequirement[],
  availableEvidence: Pick<
    EvidenceRecordDraft,
    "referenceId" | "sourceType" | "evidenceType"
  >[],
) {
  const profileReferences = new Set(
    availableEvidence
      .filter((evidence) => evidence.sourceType === "USER_PROFILE")
      .map((evidence) => evidence.referenceId),
  );
  const splitEvidence = (references: string[]) => ({
    jdEvidenceReferences: references.filter(
      (reference) => !profileReferences.has(reference),
    ),
    profileEvidenceReferences: references.filter((reference) =>
      profileReferences.has(reference),
    ),
  });
  const jobEvidenceIndexes = new Map(
    availableEvidence
      .filter((evidence) => evidence.sourceType !== "USER_PROFILE")
      .map((evidence, index) => [evidence.referenceId, index]),
  );
  const toJobEvidenceIndexes = (references: string[]) =>
    references.map((reference) => {
      const index = jobEvidenceIndexes.get(reference);
      if (index === undefined) {
        throw new Error("Role seniority fixture requires job-side evidence");
      }
      return index;
    });
  const {
    scoreEvidenceReferences,
    effectiveSeniority,
    positioningRecommendations,
    genuineGaps: _genuineGaps,
    ...result
  } = output;
  const {
    evidenceReferences: effectiveSeniorityEvidenceReferences,
    actualResponsibilitySeniority,
    ...effectiveSeniorityFields
  } = effectiveSeniority;
  return {
    ...result,
    scoreEvidence: splitEvidence(scoreEvidenceReferences),
    requirementAssessments: output.requirementAssessments.map(
      ({
        requirementText: _requirementText,
        category: _category,
        strength: _strength,
        statedYears: _statedYears,
        statedYearsMaximum: _statedYearsMaximum,
        statedYearsOpenEnded: _statedYearsOpenEnded,
        requestedExperienceSpecificity: _requestedExperienceSpecificity,
        isAmbiguous: _isAmbiguous,
        ambiguityExplanation: _ambiguityExplanation,
        decisionImpactEvidenceReferences,
        jdEvidenceReferences,
        profileEvidenceReferences,
        ...assessment
      }) => {
        const partition = (references: string[]) => ({
          decisionImpactReferences: references.filter((reference) => decisionImpactEvidenceReferences.includes(reference)),
          assessmentOnlyReferences: references.filter((reference) => !decisionImpactEvidenceReferences.includes(reference)),
        });
        if (decisionImpactEvidenceReferences.some((reference) =>
          ![...jdEvidenceReferences, ...profileEvidenceReferences].includes(reference))) {
          throw new Error("Fixture decision-impact evidence must belong to its assessment");
        }
        return {
          ...assessment,
          jdEvidence: partition(jdEvidenceReferences),
          profileEvidence: partition(profileEvidenceReferences),
          experienceEvidenceBasis:
            assessment.classification === "UNKNOWN"
              ? "UNKNOWN"
              : assessment.classification === "GENUINE_GAP"
                ? "NO_SUPPORTING_EXPERIENCE"
                : assessment.classification === "TRANSFERABLE_MATCH"
                  ? "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE"
                  : providerRequirements[assessment.requirementIndex]!
                        .category === "TOOL"
                    ? "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE"
                    : [
                          "DIRECT_SAAS_CUSTOMER_SUCCESS",
                          "DIRECT_CUSTOMER_SUCCESS",
                          "RELATED_CUSTOMER_RELATIONSHIP",
                        ].includes(assessment.matchedExperienceSpecificity)
                      ? "DIRECT_OR_RELATED_WORK_EXPERIENCE"
                      : "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE",
          requirementIndex:
            providerRequirements[assessment.requirementIndex]!.requirementIndex,
        };
      },
    ),
    effectiveSeniority: {
      ...effectiveSeniorityFields,
      actualResponsibilitySeniority: {
        ...(({
          evidenceReferences: _evidenceReferences,
          ...responsibilityFields
        }) => responsibilityFields)(actualResponsibilitySeniority),
        signals: actualResponsibilitySeniority.signals.map(
          ({ evidenceReferences, ...signal }) => ({
            ...signal,
            evidenceIndexes: toJobEvidenceIndexes(evidenceReferences),
          }),
        ),
        evidenceIndexes: toJobEvidenceIndexes(
          actualResponsibilitySeniority.evidenceReferences,
        ),
      },
      evidence: splitEvidence(effectiveSeniorityEvidenceReferences),
    },
    positioningRecommendations: positioningRecommendations.map(
      ({ evidenceReferences, ...recommendation }) => ({
        ...recommendation,
        evidence: splitEvidence(evidenceReferences),
      }),
    ),
  };
}

const organizationalMaturityOwnershipDimensions = [
  "roleBoundaries",
  "teamBoundaries",
  "handoffs",
  "sharedOwnership",
  "crossFunctionalRelationships",
  "unrelatedResponsibilities",
  "scopeCreep",
  "multipleJobsCombined",
  "unrealisticOwnership",
] as const;

export function toOrganizationalMaturityProviderTransport(
  maturity: SemanticOrganizationalMaturity,
  relationshipCatalog?: Parameters<typeof organizationalMaturityRelationshipTransport>[0],
) {
  const design = maturity.ownershipAndCrossFunctionalDesign;
  const weakSignalAssessmentArea =
    design.scopeCreep.conclusion?.includes("scope creep")
      ? ("SCOPE_CREEP" as const)
      : design.multipleJobsCombined.conclusion?.includes("combines multiple")
        ? ("MULTIPLE_JOBS_COMBINED" as const)
        : ("UNREALISTIC_OWNERSHIP" as const);
  const dimensions = Object.fromEntries(
    organizationalMaturityOwnershipDimensions.map((key) => {
      const dimension = design[key];
      if (dimension.unknown) {
        return [
          key,
          {
            evidenceState: "NOT_ESTABLISHED" as const,
            conclusion: null,
            evidenceReferences: dimension.evidenceReferences,
          },
        ];
      }
      const supportedAbsent =
        /\b(?:does not|do not|no unrelated|one bounded|retains ownership|remains with)\b/i.test(
          dimension.conclusion ?? "",
        );
      return [
        key,
        {
          evidenceState: supportedAbsent
            ? ("SUPPORTED_ABSENT" as const)
            : ("SUPPORTED_PRESENT" as const),
          conclusion: dimension.conclusion,
          evidenceReferences: dimension.evidenceReferences,
        },
      ];
    }),
  );
  return {
    ...maturity,
    ownershipAndCrossFunctionalDesign: {
      summary: design.summary,
      ...dimensions,
      ...(relationshipCatalog === undefined ? {} : {
        crossFunctionalRelationships: organizationalMaturityRelationshipTransport(relationshipCatalog),
      }),
      evidenceReferences: design.evidenceReferences,
    },
    weakSignals: maturity.weakSignals.map((signal) => ({
      assessmentArea: weakSignalAssessmentArea,
      evidenceState: "SUPPORTED_WEAKNESS" as const,
      finding: signal.finding,
      affirmativeEvidenceReferences: signal.evidenceReferences,
    })),
    unknowns: maturity.unknowns.map((unknown) => ({
      ...unknown,
      assessmentArea: unknown.code.includes("unrealistic-ownership")
        ? ("UNREALISTIC_OWNERSHIP" as const)
        : unknown.code.includes("scope-creep")
          ? ("SCOPE_CREEP" as const)
          : unknown.code.includes("cs-function")
            ? ("EXISTING_CS_FUNCTION" as const)
            : ("CUSTOMER_OPERATING_MODEL" as const),
    })),
  };
}

export function toAlexFitProviderTransport(
  value: SemanticAlexFit,
  catalog: Array<{ referenceId: string; evidenceIndex: number }>,
): unknown {
  const indexes = new Map(catalog.map(item => [item.referenceId, item.evidenceIndex]));
  function convert(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(convert);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (/^evidenceReferences(?:A|B)?$/.test(key)) {
        return [key.replace("evidenceReferences", "evidenceIndexes"), (child as string[]).map(reference => {
          const index = indexes.get(reference);
          if (index === undefined) throw new Error("Fixture references unavailable Alex Fit evidence");
          return index;
        })];
      }
      return [key, convert(child)];
    }));
  }
  return convert(value);
}

export function toOpportunityPriorityProviderTransport(
  priority: SemanticOpportunityPriority,
  availableEvidenceCatalog: Array<{
    evidenceIndex: number;
    referenceId: string;
  }>,
) {
  const indexByReference = new Map(
    availableEvidenceCatalog.map((evidence) => [
      evidence.referenceId,
      evidence.evidenceIndex,
    ]),
  );
  const indexes = (references: string[]) =>
    references.map((reference) => {
      const index = indexByReference.get(reference);
      if (index === undefined) {
        throw new Error(
          `Opportunity Priority fixture evidence is unavailable: ${reference}`,
        );
      }
      return index;
    });
  return {
    score: priority.score,
    scoreExplanation: priority.scoreExplanation,
    scoreEvidenceIndexes: indexes(priority.scoreEvidenceReferences),
    strategicValueSummary: priority.strategicValueSummary,
    strategicValueEvidenceIndexes: indexes(
      priority.strategicValueEvidenceReferences,
    ),
    applicationEffort: {
      classification: priority.applicationEffort.classification,
      explanation: priority.applicationEffort.explanation,
      evidenceIndexes: indexes(
        priority.applicationEffort.evidenceReferences,
      ),
    },
    reasonsForPrioritization: priority.reasonsForPrioritization.map(
      ({ evidenceReferences, ...finding }) => ({
        ...finding,
        evidenceIndexes: indexes(evidenceReferences),
      }),
    ),
    reasonsForReducedPriority: priority.reasonsForReducedPriority.map(
      ({ evidenceReferences, ...finding }) => ({
        ...finding,
        evidenceIndexes: indexes(evidenceReferences),
      }),
    ),
    unknowns: priority.unknowns.map(
      ({ evidenceReferences, ...unknown }) => ({
        ...unknown,
        evidenceIndexes: indexes(evidenceReferences),
      }),
    ),
    evidenceIndexes: indexes(priority.evidenceReferences),
    contradictions: priority.contradictions.map(
      ({ evidenceReferencesA, evidenceReferencesB, ...contradiction }) => ({
        ...contradiction,
        evidenceIndexesA: indexes(evidenceReferencesA),
        evidenceIndexesB: indexes(evidenceReferencesB),
      }),
    ),
  };
}

function toJdReconstructionProviderTransport(
  reconstruction: SemanticReconstruction,
) {
  return {
    ...reconstruction,
    responsibilityMap: {
      areas: responsibilityAreas.map((area) => ({
        area,
        ...reconstruction.responsibilityMap.areas[area],
      })),
      other: reconstruction.responsibilityMap.other,
    },
    ownershipMap: {
      functions: ownershipFunctions.flatMap((functionName) => {
        const assessment =
          reconstruction.ownershipMap.functions[functionName];
        return assessment
          ? [{ function: functionName, ...assessment }]
          : [];
      }),
    },
    evidence: reconstruction.evidence.map((item) => ({
      ...item,
      collectedAt: item.collectedAt?.toISOString() ?? null,
    })),
  };
}

export interface OpportunityPriorityFixtureOptions {
  score?: number;
  applicationEffort?: SemanticOpportunityPriority["applicationEffort"]["classification"];
}

export interface GhostJobRiskFixtureOptions {
  classification?: SemanticGhostJobRisk["classification"];
  contradictoryHistory?: boolean;
}

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
  failCompanyAlignmentOnce?: boolean;
  failOrganizationalMaturityOnce?: boolean;
  failAlexFitOnce?: boolean;
  failBurnoutRiskOnce?: boolean;
  failResumeMatchOnce?: boolean;
  failOpportunityPriorityOnce?: boolean;
  failGhostJobRiskOnce?: boolean;
  companyAlignment?: CompanyAlignmentFixtureOptions;
  organizationalMaturity?: OrganizationalMaturityFixtureOptions;
  alexFit?: AlexFitFixtureOptions;
  burnoutRisk?: BurnoutRiskFixtureOptions;
  resumeMatch?: ResumeMatchFixtureOptions;
  opportunityPriority?: OpportunityPriorityFixtureOptions;
  ghostJobRisk?: GhostJobRiskFixtureOptions;
}) {
  const stats = {
    reconstructionCalls: 0,
    jobEvaluationCalls: 0,
    companyAlignmentCalls: 0,
    organizationalMaturityCalls: 0,
    alexFitCalls: 0,
    burnoutRiskCalls: 0,
    resumeMatchCalls: 0,
    opportunityPriorityCalls: 0,
    ghostJobRiskCalls: 0,
    companyAlignmentReceivedMaps: false,
    companyAlignmentReceivedPreferences: false,
    organizationalMaturityReceivedPriorResults: false,
    alexFitReceivedProfileAndPriorResults: false,
    burnoutRiskReceivedMapsAndPriorResults: false,
    resumeMatchReceivedMapsProfileAndPriorResults: false,
    opportunityPriorityReceivedValidatedInputs: false,
    ghostJobRiskReceivedObjectiveFacts: false,
  };
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
        evidence({
          referenceId: "company-model",
          claim:
            input.scenario === "software-only"
              ? "The posting establishes only that the company uses office software."
              : "The company sells a subscription workflow software platform.",
          sourceText:
            input.scenario === "software-only"
              ? "Our team uses Microsoft Office and Slack."
              : "We provide a subscription workflow platform to customer teams.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "customer-context",
          claim: "The role serves a stated customer segment and customer type.",
          sourceText:
            "Guide mid-market business customers through adoption and outcomes.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "cs-function",
          claim: "The role joins an existing Customer Success function.",
          sourceText:
            "Join a team of six CSMs reporting to the VP of Customer Success.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "handoff-design",
          claim: "The posting describes a bounded Support handoff.",
          sourceText:
            "Coordinate escalations with Support, which owns technical resolution.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "founding-function",
          claim: "The posting describes the first Customer Success hire.",
          sourceText:
            "You will be our first Customer Success hire and build the function.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "scope-creep",
          claim: "The role combines several separately owned functions.",
          sourceText:
            "Own Customer Success, implementation, support, renewals, and Product Management.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "company-model-conflict",
          claim: "The posting also describes a services-only business.",
          sourceText: "We are a professional services consultancy with no software product.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
        evidence({
          referenceId: "healthy-cs-scope",
          claim: "The role combines complementary Customer Success work.",
          sourceText:
            "Own onboarding, adoption, education, enablement, engagement, retention, customer insights, light renewals, and light expansion opportunities.",
          sourceRecordId: source.sourceRecordId,
          provenanceId: source.provenanceId,
        }),
      ];
      if (
        input.burnoutRisk?.substantialDistinctFunctionOwnership ||
        input.burnoutRisk?.contradictoryWorkloadEvidence ||
        input.alexFit?.workingStyleConcern ||
        input.alexFit?.contradictoryFitEvidence
      ) {
        baseEvidence.push(
          evidence({
            referenceId: "workload-risk",
            claim:
              "The role owns distinct functions and a high reactive workload.",
            sourceText:
              "Own implementation, Support escalations, Product Management, 100 accounts, and daily customer calls.",
            sourceRecordId: source.sourceRecordId,
            provenanceId: source.provenanceId,
          }),
        );
      }
      if (input.burnoutRisk?.genericPhrasesOnly) {
        baseEvidence.push(
          evidence({
            referenceId: "generic-pace",
            claim:
              "The posting uses a generic pace phrase without workload detail.",
            sourceText: "Thrive in a fast-paced environment and wear many hats.",
            sourceRecordId: source.sourceRecordId,
            provenanceId: source.provenanceId,
          }),
        );
      }
      if (input.alexFit?.customerCallsOnly) {
        baseEvidence.push(
          evidence({
            referenceId: "ordinary-customer-calls",
            claim: "The role includes ordinary scheduled customer calls.",
            sourceText: "Hold scheduled customer check-ins and business reviews.",
            sourceRecordId: source.sourceRecordId,
            provenanceId: source.provenanceId,
          }),
        );
      }
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
                prominence: input.alexFit?.preferredKeywordOnly
                  ? "OCCASIONAL"
                  : "PRIMARY",
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
    async evaluateCompanyAlignment(company) {
      stats.companyAlignmentCalls += 1;
      if (
        input.failCompanyAlignmentOnce &&
        stats.companyAlignmentCalls === 1
      ) {
        throw new StageExecutionError({
          code: "CS_COMPANY_ALIGNMENT_TEMPORARY_FAILURE",
          message: "Fixture Company Alignment failed temporarily",
          retryable: true,
        });
      }
      stats.companyAlignmentReceivedMaps =
        company.responsibilityMap.areas.adoption !== undefined &&
        company.ownershipMap.functions.product !== undefined &&
        company.jobEvaluation.evaluated;
      stats.companyAlignmentReceivedPreferences =
        company.preferences.companyPreferences.preferredBusinessModels.includes(
          "SAAS",
        ) &&
        company.preferences.productPreferences.moderatelyTechnicalAlignedWork.includes(
          "ONBOARDING",
        ) &&
        company.preferences.customerPreferences
          .enterpriseRequiresContextualEvidenceForConcern;
      const options = input.companyAlignment ?? {};
      const businessModel =
        options.businessModel ??
        (input.scenario === "software-only" ? "UNKNOWN" : "SAAS");
      const customerType = options.customerType ?? "LIGHT_B2B";
      const productType =
        options.productType ??
        (input.scenario === "software-only" ? "UNKNOWN" : "WORKFLOW");
      const customerSegment = options.customerSegment ?? "MID_MARKET";
      const assessment = <T extends string>(
        classification: T,
        explanation: string,
        references: string[],
      ) => ({
        classification,
        explanation,
        evidenceReferences: classification === "UNKNOWN" ? [] : references,
      });
      const unknowns = [
        businessModel === "UNKNOWN"
          ? {
              code: "business-model-unknown",
              description:
                "The available evidence does not establish the company's business model.",
              materiality: "Company alignment is incomplete.",
              evidenceReferences: [],
            }
          : null,
        productType === "UNKNOWN"
          ? {
              code: "product-type-unknown",
              description:
                "The available evidence does not establish the product type.",
              materiality: "Product alignment is incomplete.",
              evidenceReferences: [],
            }
          : null,
        customerType === "UNKNOWN"
          ? {
              code: "customer-type-unknown",
              description: "Customer type is not established.",
              materiality: null,
              evidenceReferences: [],
            }
          : null,
        customerSegment === "UNKNOWN"
          ? {
              code: "customer-segment-unknown",
              description: "Customer segment is not established.",
              materiality: null,
              evidenceReferences: [],
            }
          : null,
      ].filter((item) => item !== null);
      const enterpriseConcern =
        options.enterpriseConcernSupported === true &&
        (customerType === "ENTERPRISE_HEAVY_B2B" ||
          customerSegment === "ENTERPRISE");
      const developerConcern =
        options.developerConcernSupported === true &&
        productType === "DEVELOPER_FOCUSED";
      const evidenceReferences = [
        ...(businessModel === "UNKNOWN" ? [] : ["company-model"]),
        ...(productType === "UNKNOWN" ? [] : ["company-model"]),
        ...(customerType === "UNKNOWN" ? [] : ["customer-context"]),
        ...(customerSegment === "UNKNOWN" ? [] : ["customer-context"]),
        ...(enterpriseConcern || developerConcern ? ["actual-work"] : []),
      ];
      return {
        businessModel: assessment(
          businessModel,
          businessModel === "UNKNOWN"
            ? "Using software does not establish a software business model."
            : `The evidence supports the ${businessModel} business model classification.`,
          ["company-model"],
        ),
        customerType: assessment(
          customerType,
          customerType === "UNKNOWN"
            ? "Customer type remains Unknown."
            : `The evidence supports the ${customerType} customer type.`,
          ["customer-context"],
        ),
        productType: assessment(
          productType,
          productType === "UNKNOWN"
            ? "Technical terminology or software use alone does not establish a product type."
            : `The evidence supports the ${productType} product type.`,
          ["company-model", "technology-work"],
        ),
        customerSegment: assessment(
          customerSegment,
          customerSegment === "UNKNOWN"
            ? "Customer segment remains Unknown."
            : `The evidence supports the ${customerSegment} customer segment.`,
          ["customer-context"],
        ),
        alignmentSummary:
          unknowns.length > 0
            ? "Company alignment is only partially assessable from the available evidence."
            : "The company context is assessed against the configured Customer Success preferences without numerical ranking.",
        strategicAdvantages:
          businessModel !== "UNKNOWN" && productType !== "UNKNOWN"
            ? [
                {
                  finding:
                    "The evidenced business and product context supports the configured career direction.",
                  evidenceReferences: ["company-model"],
                },
              ]
            : [],
        potentialConcerns: [
          ...(enterpriseConcern
            ? [
                {
                  finding:
                    "The enterprise environment is concerning because the role evidence also establishes incompatible scope or expectations.",
                  evidenceReferences: ["customer-context", "actual-work"],
                },
              ]
            : []),
          ...(developerConcern
            ? [
                {
                  finding:
                    "The developer-focused product is concerning because the actual role requires deep engineering work.",
                  evidenceReferences: ["company-model", "actual-work"],
                },
              ]
            : []),
        ],
        unknowns,
        evidenceReferences: [...new Set(evidenceReferences)],
        contradictions: options.contradictoryCompanyEvidence
          ? [
              {
                claimA: "The company sells a subscription software platform.",
                claimB: "The company is a services-only consultancy.",
                interpretation:
                  "The available business-model descriptions conflict.",
                relevantField: "businessModel",
                significance: "MATERIAL",
                evidenceReferencesA: ["company-model"],
                evidenceReferencesB: ["company-model-conflict"],
              },
            ]
          : [],
      };
    },
    async evaluateOrganizationalMaturity(organization) {
      stats.organizationalMaturityCalls += 1;
      if (
        input.failOrganizationalMaturityOnce &&
        stats.organizationalMaturityCalls === 1
      ) {
        throw new StageExecutionError({
          code: "CS_ORGANIZATIONAL_MATURITY_TEMPORARY_FAILURE",
          message: "Fixture Organizational Maturity failed temporarily",
          retryable: true,
        });
      }
      stats.organizationalMaturityReceivedPriorResults =
        organization.jobEvaluation.evaluated &&
        organization.companyAlignment.evaluated &&
        organization.responsibilityMap.areas.adoption !== undefined;
      const options = input.organizationalMaturity ?? {};
      const existingFunction = options.existingFunction ?? "ESTABLISHED";
      const operatingModel =
        options.operatingModel ??
        (input.scenario === "support-heavy"
          ? "SUPPORT_HEAVY"
          : input.scenario === "implementation-heavy"
            ? "IMPLEMENTATION_HEAVY"
            : input.scenario === "technical-cs"
              ? "TECHNICAL_CS"
              : input.scenario === "sales-heavy"
                ? "EXPANSION_FOCUSED"
                : "ADOPTION_FOCUSED");
      const functionReference =
        existingFunction === "BUILDING_FROM_SCRATCH"
          ? "founding-function"
          : "cs-function";
      const score =
        options.score ??
        (existingFunction === "ESTABLISHED"
          ? 84
          : existingFunction === "PARTIALLY_ESTABLISHED"
            ? 68
            : existingFunction === "EMERGING"
              ? 52
              : existingFunction === "BUILDING_FROM_SCRATCH"
                ? 34
                : 55);
      const knownDimension = (conclusion: string, reference: string) => ({
        conclusion,
        unknown: false,
        evidenceReferences: [reference],
      });
      const scopeCreep = options.scopeCreepSupported === true;
      const multipleJobs = options.multipleJobsSupported === true;
      const unrealisticOwnership = options.unrealisticOwnershipSupported === true;
      const functionReferences =
        existingFunction === "UNKNOWN" ? [] : [functionReference];
      const operatingReferences =
        operatingModel === "UNKNOWN" ? [] : ["actual-work"];
      const scoreEvidenceReferences = [
        "actual-work",
        "product-collaboration",
        "handoff-design",
        ...functionReferences,
        ...(scopeCreep || multipleJobs || unrealisticOwnership
          ? ["scope-creep"]
          : []),
      ];
      return {
        score,
        scoreExplanation:
          "The bounded score holistically interprets the three criteria; it is not a weighted calculation.",
        scoreEvidenceReferences: [...new Set(scoreEvidenceReferences)],
        existingCustomerSuccessFunction: {
          classification: existingFunction,
          explanation:
            existingFunction === "UNKNOWN"
              ? "The available evidence does not establish whether a CS function exists."
              : `The evidence supports ${existingFunction} CS-function maturity.`,
          evidenceReferences: functionReferences,
        },
        customerOperatingModel: {
          classification: operatingModel,
          explanation:
            operatingModel === "UNKNOWN"
              ? "Responsibility patterns are insufficient to establish an operating model."
              : `The responsibility and ownership patterns support ${operatingModel}.`,
          evidenceReferences: operatingReferences,
          substantialPatterns:
            operatingModel === "UNKNOWN"
              ? []
              : operatingModel === "HYBRID"
                ? ["ADOPTION_FOCUSED", "EDUCATION_FOCUSED"]
                : [operatingModel],
        },
        ownershipAndCrossFunctionalDesign: {
          summary:
            scopeCreep || multipleJobs || unrealisticOwnership
              ? "The evidence establishes material ownership-design concerns."
              : "Collaboration and handoffs are bounded; broad collaboration alone is not treated as poor maturity.",
          roleBoundaries: knownDimension(
            "Customer Success owns customer outcomes while Product retains Product ownership.",
            "product-collaboration",
          ),
          teamBoundaries: knownDimension(
            "Support retains technical-resolution ownership.",
            "handoff-design",
          ),
          handoffs: knownDimension(
            "The posting describes an explicit Support handoff.",
            "handoff-design",
          ),
          sharedOwnership: knownDimension(
            "Product collaboration does not transfer Product ownership.",
            "product-collaboration",
          ),
          crossFunctionalRelationships: knownDimension(
            "The role collaborates with Product through a bounded relationship.",
            "product-collaboration",
          ),
          unrelatedResponsibilities:
            scopeCreep || multipleJobs
              ? knownDimension(
                  "The role includes unrelated functional ownership.",
                  "scope-creep",
                )
              : knownDimension(
                  "The evidenced cross-functional work remains collaborative.",
                  "product-collaboration",
                ),
          scopeCreep: scopeCreep
            ? knownDimension(
                "The evidence establishes scope creep across distinct functions.",
                "scope-creep",
              )
            : {
                conclusion: null,
                unknown: true,
                evidenceReferences: [],
              },
          multipleJobsCombined: multipleJobs
            ? knownDimension(
                "The posting combines multiple separately owned jobs.",
                "scope-creep",
              )
            : knownDimension(
                "The available ownership evidence describes one bounded CS role.",
                "handoff-design",
              ),
          unrealisticOwnership: unrealisticOwnership
            ? knownDimension(
                "The role is solely accountable for several separate functions.",
                "scope-creep",
              )
            : {
                conclusion: null,
                unknown: true,
                evidenceReferences: [],
              },
          evidenceReferences: [
            "product-collaboration",
            "handoff-design",
            ...(scopeCreep || multipleJobs || unrealisticOwnership
              ? ["scope-creep"]
              : []),
          ],
        },
        summary:
          "Organizational maturity is assessed from the existing CS function, operating model, and ownership design only.",
        positiveSignals: [
          {
            finding: "The posting describes bounded cross-functional handoffs.",
            evidenceReferences: ["handoff-design"],
          },
        ],
        weakSignals:
          scopeCreep || multipleJobs || unrealisticOwnership
            ? [
                {
                  finding:
                    "The role combines ownership across distinct organizational functions.",
                  evidenceReferences: ["scope-creep"],
                },
              ]
            : [],
        unknowns: [
          ...(existingFunction === "UNKNOWN"
            ? [
                {
                  code: "cs-function-unknown",
                  description:
                    "The posting does not establish whether an existing CS function exists.",
                  materiality: "The maturity assessment is less complete.",
                  evidenceReferences: [],
                },
              ]
            : []),
          ...(!scopeCreep
            ? [
                {
                  code: "organizational-maturity-scope-creep-not-established",
                  description:
                    "Scope-creep presence or absence is not established by the available evidence.",
                  materiality:
                    "This limits completeness of the ownership and cross-functional design assessment.",
                  evidenceReferences: [],
                },
              ]
            : []),
          ...(!unrealisticOwnership
            ? [
                {
                  code: "organizational-maturity-unrealistic-ownership-not-established",
                  description:
                    "Unrealistic-ownership presence or absence is not established by the available evidence.",
                  materiality:
                    "This limits completeness of the ownership and cross-functional design assessment.",
                  evidenceReferences: [],
                },
              ]
            : []),
        ],
        evidenceReferences: [...new Set(scoreEvidenceReferences)],
        contradictions: options.contradictoryOrganizationEvidence
          ? [
              {
                claimA: "The role joins an established CS team.",
                claimB: "The role is the first CS hire.",
                interpretation:
                  "The organizational-function descriptions conflict.",
                relevantField: "existingCustomerSuccessFunction",
                significance: "MATERIAL",
                evidenceReferencesA: ["cs-function"],
                evidenceReferencesB: ["founding-function"],
              },
            ]
          : [],
      };
    },
    async evaluateAlexFit(fitInput) {
      stats.alexFitCalls += 1;
      if (input.failAlexFitOnce && stats.alexFitCalls === 1) {
        throw new StageExecutionError({
          code: "CS_ALEX_FIT_TEMPORARY_FAILURE",
          message: "Fixture Alex Fit failed temporarily",
          retryable: true,
        });
      }
      stats.alexFitReceivedProfileAndPriorResults =
        fitInput.userProfile.version > 0 &&
        fitInput.jobEvaluation.evaluated &&
        fitInput.companyAlignment.evaluated &&
        fitInput.organizationalMaturity.evaluated &&
        fitInput.responsibilityMap.areas.adoption !== undefined;
      const options = input.alexFit ?? {};
      const profileReference = fitInput.availableEvidence.find(
        (item) => item.sourceType === "USER_PROFILE",
      )?.referenceId;
      if (!profileReference) {
        throw new Error("The Alex Fit fixture requires profile evidence");
      }
      const classification =
        options.classification ??
        (options.preferredKeywordOnly ? "MIXED" : "STRONG");
      const relationship = options.experienceRelationship ?? "DIRECT";
      const roleReference = "actual-work";
      const combinedReferences = [profileReference, roleReference];
      const workingStyleAlignment = options.missingWorkingStyleInformation
        ? [
            {
              area: "Meeting cadence",
              alignment: "UNKNOWN" as const,
              explanation:
                "The available evidence does not establish meeting cadence.",
              evidenceReferences: [],
            },
          ]
        : [
            {
              area: "Strategic ownership",
              alignment: options.workingStyleConcern
                ? ("CONCERN" as const)
                : ("SUPPORTED" as const),
              explanation: options.workingStyleConcern
                ? "The role evidence establishes a reactive work pattern."
                : "The role and profile evidence support strategic ownership.",
              evidenceReferences: options.workingStyleConcern
                ? ["workload-risk", profileReference]
                : combinedReferences,
            },
          ];
      return {
        classification,
        summary:
          "The categorical fit assessment compares evidenced role content with the versioned profile and configured preferences.",
        experienceAlignment: {
          relationship,
          explanation: `The profile-to-role experience relationship is ${relationship}.`,
          evidenceReferences: [profileReference, roleReference],
        },
        workingStyleAlignment,
        careerStrategyAlignment: {
          conclusion:
            "The role provides evidenced Customer Success work relevant to the configured career direction.",
          evidenceReferences: combinedReferences,
        },
        strongestMatches: [
          {
            finding:
              "The role's evidenced customer-outcome work matches a demonstrated profile strength.",
            evidenceReferences: combinedReferences,
          },
        ],
        partialMatches:
          relationship === "RELATED" || relationship === "TRANSFERABLE"
            ? [
                {
                  finding:
                    "The profile evidence is relevant but not identical to the role requirement.",
                  evidenceReferences: combinedReferences,
                },
              ]
            : [],
        concerns: options.workingStyleConcern
          ? [
              {
                finding:
                  "The evidenced reactive workload conflicts with a configured work preference.",
                evidenceReferences: ["workload-risk", profileReference],
              },
            ]
          : [],
        strategicValue: [
          {
            finding:
              "The role supplies strategically relevant Customer Success experience.",
            evidenceReferences: combinedReferences,
          },
        ],
        unknowns: options.missingWorkingStyleInformation
          ? [
              {
                code: "meeting-cadence-unknown",
                description: "Meeting cadence is not stated.",
                materiality: "Working-style alignment is incomplete.",
                evidenceReferences: [],
              },
            ]
          : [],
        evidenceReferences: [
          ...new Set([
            ...combinedReferences,
            ...(options.workingStyleConcern ? ["workload-risk"] : []),
          ]),
        ],
        contradictions: options.contradictoryFitEvidence
          ? [
              {
                claimA: "The role supports strategic deep work.",
                claimB: "The role requires constant reactive interruptions.",
                interpretation:
                  "The stated working-style conditions conflict.",
                relevantField: "workingStyle",
                significance: "MATERIAL",
                evidenceReferencesA: ["healthy-cs-scope"],
                evidenceReferencesB: ["workload-risk"],
              },
            ]
          : [],
      } satisfies SemanticAlexFit;
    },
    async evaluateBurnoutRisk(riskInput) {
      stats.burnoutRiskCalls += 1;
      if (input.failBurnoutRiskOnce && stats.burnoutRiskCalls === 1) {
        throw new StageExecutionError({
          code: "CS_BURNOUT_RISK_TEMPORARY_FAILURE",
          message: "Fixture Burnout Risk failed temporarily",
          retryable: true,
        });
      }
      stats.burnoutRiskReceivedMapsAndPriorResults =
        riskInput.jobEvaluation.evaluated &&
        riskInput.organizationalMaturity.evaluated &&
        riskInput.responsibilityMap.areas.adoption !== undefined &&
        riskInput.ownershipMap.functions.customerSuccess !== undefined;
      const options = input.burnoutRisk ?? {};
      const genericOnly = options.genericPhrasesOnly === true;
      const distinctOwnership =
        options.substantialDistinctFunctionOwnership === true;
      const score = options.score ?? (distinctOwnership ? 82 : 18);
      const primaryReference = genericOnly
        ? "generic-pace"
        : distinctOwnership
          ? "workload-risk"
          : "healthy-cs-scope";
      return {
        score,
        scoreExplanation:
          "The score is a holistic semantic assessment of supported workload evidence, not an additive or weighted formula.",
        scoreEvidenceReferences: [primaryReference],
        summary: genericOnly
          ? "Generic pace language alone does not establish elevated burnout risk."
          : distinctOwnership
            ? "Substantial ownership across separate functions and reactive load creates high burnout risk."
            : "The role describes a coherent set of complementary Customer Success responsibilities.",
        majorContributors: distinctOwnership
          ? [
              {
                finding:
                  "The role substantially owns multiple distinct functions and a high reactive workload.",
                evidenceReferences: ["workload-risk"],
              },
            ]
          : [],
        positiveIndicators:
          !distinctOwnership && !genericOnly
            ? [
                {
                  finding:
                    "The responsibilities form a coherent Customer Success workload.",
                  evidenceReferences: ["healthy-cs-scope"],
                },
              ]
            : [],
        unknowns: genericOnly
          ? [
              {
                code: "workload-details-unknown",
                description:
                  "The generic phrase does not establish account load, customer complexity, meeting burden, escalation volume, reactive workload, or travel.",
                materiality: "Burnout assessment confidence is limited.",
                evidenceReferences: ["generic-pace"],
              },
            ]
          : [],
        evidenceReferences: [primaryReference],
        contradictions: options.contradictoryWorkloadEvidence
          ? [
              {
                claimA: "The role has bounded complementary CS scope.",
                claimB: "The role owns several distinct functions.",
                interpretation: "The workload descriptions conflict.",
                relevantField: "workloadScope",
                significance: "MATERIAL",
                evidenceReferencesA: ["healthy-cs-scope"],
                evidenceReferencesB: ["workload-risk"],
              },
            ]
          : [],
      } satisfies SemanticBurnoutRisk;
    },
    async evaluateResumeMatch(resumeInput) {
      stats.resumeMatchCalls += 1;
      if (input.failResumeMatchOnce && stats.resumeMatchCalls === 1) {
        throw new StageExecutionError({
          code: "CS_RESUME_MATCH_TEMPORARY_FAILURE",
          message: "Fixture Resume Match failed temporarily",
          retryable: true,
        });
      }
      stats.resumeMatchReceivedMapsProfileAndPriorResults =
        resumeInput.userProfile.version > 0 &&
        resumeInput.jobEvaluation.evaluated &&
        resumeInput.companyAlignment.evaluated &&
        resumeInput.organizationalMaturity.evaluated &&
        resumeInput.alexFit.evaluated &&
        resumeInput.burnoutRisk.evaluated &&
        resumeInput.responsibilityMap.areas.adoption !== undefined &&
        resumeInput.ownershipMap.functions.customerSuccess !== undefined;
      const options = input.resumeMatch ?? {};
      const profileEvidence = resumeInput.availableEvidence.filter(
        (item) => item.sourceType === "USER_PROFILE",
      );
      const directProfileReference =
        profileEvidence.find((item) =>
          item.evidenceType.includes("DIRECT_EXPERIENCE"),
        )?.referenceId ?? profileEvidence[0]?.referenceId;
      const transferableProfileReference =
        profileEvidence.find(
          (item) => item.evidenceType === "TRANSFERABLE_SKILL",
        )?.referenceId ?? directProfileReference;
      const gapProfileReference =
        profileEvidence.find((item) =>
          /\b(?:no|lack|without|not have|have not)\b/i.test(item.claim),
        )?.referenceId ?? directProfileReference;
      if (!directProfileReference || !transferableProfileReference) {
        throw new Error("The Resume Match fixture requires profile evidence");
      }
      const requirementEvidence = [
        ...new Set(
          resumeInput.requirementMap.flatMap(
            (requirement) => requirement.evidenceReferences,
          ),
        ),
      ];
      const requirementIndexes = resumeInput.requirementMap.map((_, index) => index);
      const classifications = options.requirementClassifications ?? [];
      const specificities = options.matchedExperienceSpecificities ?? [];
      const decisionImpacts = options.decisionImpacts ?? [];
      const requirementAssessments = resumeInput.requirementMap.map(
        (requirement, index) => {
          const classification =
            classifications[index] ?? (index === 0 ? "STRONG_MATCH" : "UNKNOWN");
          const matchedExperienceSpecificity =
            specificities[index] ??
            (classification === "STRONG_MATCH"
              ? "DIRECT_CUSTOMER_SUCCESS"
              : classification === "TRANSFERABLE_MATCH"
                ? "TRANSFERABLE"
                : classification === "PARTIAL_MATCH"
                  ? "RELATED_CUSTOMER_RELATIONSHIP"
                  : classification === "GENUINE_GAP"
                    ? "UNSUPPORTED"
                    : "UNKNOWN");
          const profileReference =
            classification === "TRANSFERABLE_MATCH"
              ? transferableProfileReference
              : classification === "GENUINE_GAP"
                ? gapProfileReference
              : directProfileReference;
          const decisionImpact =
            decisionImpacts[index] ?? "NON_DECISIVE";
          return {
            requirementIndex: index,
            requirementText: requirement.requirement,
            category: requirement.category,
            strength: requirement.strength,
            statedYears: requirement.statedYears,
            statedYearsMaximum: requirement.statedYearsMaximum,
            statedYearsOpenEnded: requirement.statedYearsOpenEnded,
            requestedExperienceSpecificity: requirement.experienceSpecificity,
            isAmbiguous: requirement.ambiguity.isAmbiguous,
            ambiguityExplanation: requirement.ambiguity.explanation,
            classification,
            matchedExperienceSpecificity,
            importanceExplanation: `${requirement.strength} requirements retain their documented strength.`,
            decisionImpact,
            decisionImpactExplanation:
              decisionImpact === "DECISIVE_DISQUALIFIER"
                ? "The controlled fixture establishes that this required, genuinely unsupported requirement is decisive for eligibility."
                : decisionImpact === "MATERIAL_UNCERTAINTY"
                  ? "The controlled fixture leaves the requirement's applicability or decision importance materially unresolved."
                  : "The available evidence does not establish this requirement as a decisive disqualifier.",
            decisionImpactEvidenceReferences:
              decisionImpact === "NON_DECISIVE"
                ? []
                : [...requirement.evidenceReferences, profileReference],
            explanation:
              classification === "UNKNOWN"
                ? "The profile does not provide enough evidence to assess this requirement."
                : `The controlled fixture supports ${classification} without changing the JD requirement.`,
            supportedPortion:
              classification === "PARTIAL_MATCH"
                ? "Related customer-relationship work is supported."
                : null,
            unsupportedPortion:
              classification === "PARTIAL_MATCH"
                ? "The specific SaaS context remains unsupported."
                : null,
            jdEvidenceReferences: requirement.evidenceReferences,
            profileEvidenceReferences:
              classification === "UNKNOWN" ? [] : [profileReference],
          };
        },
      );
      const score = options.score ?? 82;
      const levelFit = options.effectiveLevelFit ?? "TARGET_LEVEL";
      const responsibilitySeniority =
        options.actualResponsibilitySeniority ?? "MID_LEVEL";
      const jdSeniorityReferences = [
        "actual-work",
        ...(requirementEvidence.length > 0 ? requirementEvidence : []),
      ];
      const combinedEvidence = [
        ...new Set([...jdSeniorityReferences, directProfileReference]),
      ];
      const contradictionReference = requirementEvidence[0] ?? "role-inference";
      const contradictions = options.contradiction
        ? [
            {
              claimA:
                options.contradiction === "LOW_YEARS_SENIOR_SCOPE"
                  ? "The posting requests only two to three years of experience."
                  : options.contradiction === "SENIOR_TITLE_ROUTINE_SCOPE"
                    ? "The title describes the role as senior."
                    : options.contradiction === "JUNIOR_TITLE_SENIOR_SCOPE"
                      ? "The title describes the role as junior or associate."
                      : "The posting requests five or more years of experience.",
              claimB:
                options.contradiction === "INFLATED_YEARS" ||
                options.contradiction === "SENIOR_TITLE_ROUTINE_SCOPE"
                  ? "The actual responsibilities reflect routine early-to-mid-level scope."
                  : "The actual responsibilities require substantial autonomy, authority, and strategic ownership.",
              interpretation:
                "The stated level signal conflicts with the reconstructed responsibility seniority.",
              relevantField: "effectiveSeniority",
              significance: "MATERIAL" as const,
              evidenceReferencesA: [contradictionReference],
              evidenceReferencesB: ["actual-work"],
            },
          ]
        : [];
      const findingFor = (
        assessment: (typeof requirementAssessments)[number],
      ) => ({
        finding: assessment.explanation,
        evidenceReferences: [
          ...assessment.jdEvidenceReferences,
          ...assessment.profileEvidenceReferences,
        ],
      });
      return {
        score,
        scoreExplanation:
          "The score holistically interprets requirement strength, experience specificity, responsibility alignment, gaps, and Unknowns without keyword counts or fixed weights.",
        scoreEvidenceReferences: combinedEvidence,
        summary:
          "The resume assessment compares structured requirements and responsibilities with versioned profile evidence.",
        requirementAssessments,
        effectiveSeniority: {
          statedYears: {
            summary:
              "Stated years are interpreted with their requirement strength rather than used alone.",
            requirementIndexes: requirementIndexes.filter(
              (index) => resumeInput.requirementMap[index]?.statedYears !== null,
            ),
            evidenceReferences: requirementEvidence,
          },
          requirementStrength: {
            summary:
              "Required, preferred, ideal, and nice-to-have expectations remain distinct.",
            requirementIndexes,
            evidenceReferences: requirementEvidence,
          },
          experienceSpecificity: {
            summary:
              "Direct, related, broader customer-facing, transferable, and Unknown experience remain distinct.",
            requirementIndexes,
            evidenceReferences: requirementEvidence,
          },
          actualResponsibilitySeniority: {
            classification: responsibilitySeniority,
            summary:
              "Responsibility seniority is reconstructed from autonomy, authority, complexity, and ownership across the role.",
            signals: [
              {
                signal: "STRATEGIC_OWNERSHIP",
                assessment:
                  responsibilitySeniority === "SENIOR" ||
                  responsibilitySeniority === "HIGHLY_SENIOR"
                    ? "ADVANCED"
                    : "MODERATE",
                explanation:
                  "The actual-work evidence establishes the controlled responsibility level.",
                evidenceReferences: ["actual-work"],
              },
            ],
            evidenceReferences: ["actual-work"],
          },
          effectiveLevelFit: levelFit,
          explanation:
            "Effective Level Fit combines years, requirement strength, specificity, profile evidence, and actual responsibility seniority.",
          evidenceReferences: combinedEvidence,
        },
        strongStrengths: requirementAssessments
          .filter((item) =>
            ["STRONG_MATCH", "TRANSFERABLE_MATCH"].includes(
              item.classification,
            ),
          )
          .map(findingFor),
        partialMatches: requirementAssessments
          .filter((item) => item.classification === "PARTIAL_MATCH")
          .map(findingFor),
        genuineGaps: requirementAssessments
          .filter((item) => item.classification === "GENUINE_GAP")
          .map(findingFor),
        unknowns: [
          ...requirementAssessments
            .filter((item) => item.classification === "UNKNOWN")
            .map((item) => ({
              code: `requirement-${item.requirementIndex}-unknown`,
              description: item.explanation,
              materiality: `${item.strength} requirement remains unassessed.`,
              evidenceReferences: item.jdEvidenceReferences,
            })),
          ...(resumeInput.requirementMap.length === 0
            ? [
                {
                  code: "requirements-not-stated",
                  description:
                    "The available JD evidence contains no explicit candidate requirements.",
                  materiality: "Requirement-level match completeness is limited.",
                  evidenceReferences: [] as string[],
                },
              ]
            : []),
        ],
        positioningRecommendations: [
          {
            recommendation:
              "Emphasize the evidenced customer-outcome work using truthful profile language; do not claim unsupported direct experience or metrics.",
            evidenceReferences: ["actual-work", directProfileReference],
          },
        ],
        evidenceReferences: combinedEvidence,
        contradictions,
      } satisfies SemanticResumeMatch;
    },
    async evaluateOpportunityPriority(priorityInput) {
      stats.opportunityPriorityCalls += 1;
      if (
        input.failOpportunityPriorityOnce &&
        stats.opportunityPriorityCalls === 1
      ) {
        throw new StageExecutionError({
          code: "CS_OPPORTUNITY_PRIORITY_TEMPORARY_FAILURE",
          message: "Fixture Opportunity Priority failed temporarily",
          retryable: true,
        });
      }
      stats.opportunityPriorityReceivedValidatedInputs =
        priorityInput.companyAlignment.evaluated &&
        priorityInput.alexFit.evaluated &&
        priorityInput.burnoutRisk.evaluated &&
        priorityInput.resumeMatch.evaluated &&
        priorityInput.effectiveLevelFit ===
          priorityInput.resumeMatch.match.effectiveSeniority.effectiveLevelFit;
      const options = input.opportunityPriority ?? {};
      const profileReference = priorityInput.availableEvidence.find(
        (item) => item.sourceType === "USER_PROFILE",
      )?.referenceId;
      if (!profileReference) {
        throw new Error("The Opportunity Priority fixture requires profile evidence");
      }
      const timingReferences = priorityInput.postingTiming.evidenceReferences;
      const oldPosting = ["REVIEW", "CAUTION"].includes(
        priorityInput.postingTiming.classification,
      );
      return {
        score: options.score ?? 84,
        scoreExplanation:
          "Priority is a holistic bounded assessment of timing, strategic value, fit, level, salary, effort, and risk without fixed weights or an age-only formula.",
        scoreEvidenceReferences: ["actual-work", profileReference],
        strategicValueSummary:
          "The role offers evidenced Customer Success and technology-bridge value aligned with the profile's career direction.",
        strategicValueEvidenceReferences: ["actual-work", profileReference],
        applicationEffort: {
          classification: options.applicationEffort ?? "UNKNOWN",
          explanation:
            options.applicationEffort && options.applicationEffort !== "UNKNOWN"
              ? "The controlled fixture provides an explicit application-effort assessment."
              : "Application effort is not established by available source evidence and remains Unknown.",
          evidenceReferences:
            options.applicationEffort && options.applicationEffort !== "UNKNOWN"
              ? ["actual-work"]
              : [],
        },
        reasonsForPrioritization: [
          {
            finding:
              "The role combines substantive Customer Success work with strategic technology exposure.",
            evidenceReferences: ["actual-work", profileReference],
          },
        ],
        reasonsForReducedPriority:
          oldPosting && timingReferences.length > 0
            ? [
                {
                  finding:
                    "The deterministic posting-age band reduces urgency without rejecting the opportunity.",
                  evidenceReferences: timingReferences,
                },
              ]
            : [],
        unknowns:
          options.applicationEffort && options.applicationEffort !== "UNKNOWN"
            ? []
            : [
                {
                  code: "application-effort-unknown",
                  description:
                    "The available evidence does not establish the effort needed to apply.",
                  materiality:
                    "Priority completeness is limited, but suitability is unaffected.",
                  evidenceReferences: [],
                },
              ],
        evidenceReferences: ["actual-work", profileReference],
        contradictions: [],
      } satisfies SemanticOpportunityPriority;
    },
    async evaluateGhostJobRisk(ghostInput) {
      stats.ghostJobRiskCalls += 1;
      if (input.failGhostJobRiskOnce && stats.ghostJobRiskCalls === 1) {
        throw new StageExecutionError({
          code: "CS_GHOST_JOB_RISK_TEMPORARY_FAILURE",
          message: "Fixture Ghost Job Risk failed temporarily",
          retryable: true,
        });
      }
      stats.ghostJobRiskReceivedObjectiveFacts =
        ghostInput.objectiveFacts.length > 0;
      const options = input.ghostJobRisk ?? {};
      const riskFacts = ghostInput.objectiveFacts.filter((fact) =>
        [
          "REPOSTED",
          "UNCHANGED_OVER_TIME",
          "EVERGREEN_LANGUAGE",
          "FARMING_INDICATOR",
          "CLOSED_ATS_VISIBLE_ELSEWHERE",
          "RECURRING_IDENTICAL_REQUISITION",
        ].includes(fact.type),
      );
      const positiveFacts = ghostInput.objectiveFacts.filter((fact) =>
        ["ACTIVE_ATS", "CURRENT_POSTING"].includes(fact.type),
      );
      const classification =
        options.classification ??
        (riskFacts.length >= 2
          ? "ELEVATED"
          : riskFacts.length === 1
            ? "POSSIBLE"
            : positiveFacts.length > 0
              ? "LOW"
              : "UNKNOWN");
      const evidenceReferences = ghostInput.objectiveFacts.flatMap(
        (fact) => fact.evidenceReferences,
      );
      const firstRisk = riskFacts[0]?.evidenceReferences[0];
      const firstPositive = positiveFacts[0]?.evidenceReferences[0];
      return {
        classification,
        assessment:
          classification === "UNKNOWN"
            ? "The available history facts are insufficient for a categorical risk conclusion."
            : `The controlled posting-history evidence supports ${classification} Ghost Job Risk.`,
        interpretation:
          classification === "LOW"
            ? "Current source-status evidence supports an active opportunity."
            : classification === "UNKNOWN"
              ? "No supported risk interpretation is asserted."
              : "Repeated or conflicting posting-history signals warrant caution without labeling the job as fake.",
        evidenceReferences:
          classification === "UNKNOWN" ? [] : evidenceReferences,
        unknowns:
          classification === "UNKNOWN"
            ? [
                {
                  code: "posting-history-insufficient",
                  description:
                    "The objective history does not establish an active or suspicious pattern.",
                  materiality:
                    "Ghost Job Risk remains Unknown rather than guessed.",
                  evidenceReferences,
                },
              ]
            : [],
        contradictions:
          options.contradictoryHistory && firstRisk && firstPositive
            ? [
                {
                  claimA: "The preserved history contains a risk signal.",
                  claimB: "The preserved history also reports an active current status.",
                  interpretation:
                    "Posting-history evidence conflicts and remains visible for review.",
                  relevantField: "ghostJobRisk",
                  significance: "MATERIAL",
                  evidenceReferencesA: [firstRisk],
                  evidenceReferencesB: [firstPositive],
                },
              ]
            : [],
      } satisfies SemanticGhostJobRisk;
    },
  };
  return { semanticOperations, stats };
}

export function createCustomerSuccessFixtureTransport(input: {
  scenario?: CustomerSuccessScenario;
  resumeMatch?: ResumeMatchFixtureOptions;
} = {}): SemanticProviderTransport {
  const fixture = createCustomerSuccessFixtureOperations({
    scenario: input.scenario ?? "strong",
    resumeMatch: input.resumeMatch,
  });
  return {
    async execute(request) {
      const payload = JSON.parse(request.input) as {
        userConfiguration: unknown;
        trustedStructuredContext: Record<string, unknown>;
        untrustedSourceContent: string | null;
      };
      const trusted = payload.trustedStructuredContext;
      let output: unknown;
      switch (request.operationId) {
        case "customer-success.jd-reconstruction":
          output = toJdReconstructionProviderTransport(
            (await fixture.semanticOperations.reconstructJobDescription({
              ...(trusted as never),
              untrustedJobDescription: payload.untrustedSourceContent!,
            })) as SemanticReconstruction,
          );
          break;
        case "customer-success.job-evaluation":
          output = await fixture.semanticOperations.evaluateJob(trusted as never);
          break;
        case "customer-success.company-alignment":
          output = await fixture.semanticOperations.evaluateCompanyAlignment({
            ...trusted,
            preferences: payload.userConfiguration,
          } as never);
          break;
        case "customer-success.organizational-maturity":
          output = toOrganizationalMaturityProviderTransport(
            (await fixture.semanticOperations.evaluateOrganizationalMaturity(
              trusted as never,
            )) as SemanticOrganizationalMaturity,
            trusted.crossFunctionalRelationshipCatalog as Parameters<typeof toOrganizationalMaturityProviderTransport>[1],
          );
          break;
        case "customer-success.alex-fit":
          output = toAlexFitProviderTransport(await fixture.semanticOperations.evaluateAlexFit({
            ...trusted,
            availableEvidence: trusted.availableEvidenceCatalog,
            preferences: payload.userConfiguration,
          } as never) as SemanticAlexFit, trusted.availableEvidenceCatalog as Parameters<typeof toAlexFitProviderTransport>[1]);
          break;
        case "customer-success.burnout-risk":
          output = toBurnoutRiskProviderTransport(await fixture.semanticOperations.evaluateBurnoutRisk({
            ...trusted,
            preferences: payload.userConfiguration,
          } as never) as SemanticBurnoutRisk, trusted.availableEvidence as EvidenceRecordDraft[]);
          break;
        case "customer-success.resume-match":
          {
            const providerRequirements = trusted.requirementMap as
              | ProviderRequirement[]
              | undefined;
            if (!providerRequirements) {
              throw new Error("Resume Match provider requirements are missing");
            }
            const domain = await fixture.semanticOperations.evaluateResumeMatch({
              ...trusted,
              requirementMap: providerRequirements.map(
                ({ requirementIndex: _requirementIndex, ...requirement }) =>
                  requirement,
              ),
              preferences: payload.userConfiguration,
            } as never);
            output = toResumeMatchProviderTransport(
              domain as SemanticResumeMatch,
              providerRequirements,
              trusted.availableEvidence as EvidenceRecordDraft[],
            );
          }
          break;
        case "customer-success.opportunity-priority":
          {
            const availableEvidenceCatalog =
              trusted.availableEvidenceCatalog as Array<
                EvidenceRecordDraft & { evidenceIndex: number }
              >;
            const availableEvidence = availableEvidenceCatalog.map(
              ({ evidenceIndex: _evidenceIndex, ...evidence }) => evidence,
            );
            const domain =
              await fixture.semanticOperations.evaluateOpportunityPriority({
                ...trusted,
                availableEvidence,
              } as never);
            output = toOpportunityPriorityProviderTransport(
              domain as SemanticOpportunityPriority,
              availableEvidenceCatalog,
            );
          }
          break;
        case "customer-success.ghost-job-risk":
          {
            const risk = (await fixture.semanticOperations.evaluateGhostJobRisk(
            trusted as never,
            )) as SemanticGhostJobRisk;
            output = {
              risk: {
                classification: risk.classification,
                assessment: risk.assessment,
                interpretation: risk.interpretation,
                evidenceReferences: risk.evidenceReferences,
              },
              unknowns: risk.unknowns,
              contradictions: risk.contradictions,
            };
          }
          break;
        default:
          throw new Error(`Unexpected semantic operation: ${request.operationId}`);
      }
      return {
        outputText: JSON.stringify(output),
        providerRequestId: `fixture-${request.operationId}`,
        usage: {
          inputTokens: 25,
          outputTokens: 15,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 40,
        },
      };
    },
  };
}
