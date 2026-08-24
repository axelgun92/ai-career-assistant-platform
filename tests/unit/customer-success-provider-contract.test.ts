import {
  semanticAlexFitFromTransport,
  semanticAlexFitTransportSchema,
  semanticBurnoutRiskFromTransport,
  semanticCompanyAlignmentFromTransport,
  semanticCompanyAlignmentTransportSchema,
  semanticGhostJobRiskFromTransport,
  semanticGhostJobRiskTransportSchema,
  semanticJobEvaluationFromTransport,
  semanticJobEvaluationTransportSchema,
  semanticOpportunityPriorityFromTransport,
  semanticOpportunityPriorityTransportSchema,
  semanticOrganizationalMaturityFromTransport,
  semanticOrganizationalMaturitySchema,
  semanticOrganizationalMaturityTransportSchema,
} from "@ai-career/customer-success";
import { describe, expect, it } from "vitest";

const availableEvidence = [{ referenceId: "e1", sourceType: "MANUAL" }];
const evidenceReferences = ["e1"];
const finding = { finding: "Supported finding.", evidenceReferences };

function knownJobDimension() {
  return {
    conclusion: "The conclusion is supported.",
    evidenceReferences,
    unknown: false as const,
  };
}

function validJobEvaluation() {
  return {
    practicalSummary: "The role owns customer outcomes.",
    primaryWork: ["Own customer outcomes."],
    customerLifecycleInvolvement: knownJobDimension(),
    customerOwnership: knownJobDimension(),
    strategicResponsibility: knownJobDimension(),
    technicalExposure: knownJobDimension(),
    commercialResponsibility: knownJobDimension(),
    crossFunctionalInvolvement: knownJobDimension(),
    businessImpact: knownJobDimension(),
    strategicBridgeValue: {
      classification: "HIGH" as const,
      explanation: "The work includes meaningful product collaboration.",
      evidenceReferences,
    },
    evidenceReferences,
    strengths: ["Supported strength."],
    concerns: [],
    unknowns: [],
    contradictions: [],
  };
}

function classification(classificationValue: string) {
  return {
    classification: classificationValue,
    explanation: "The classification is supported.",
    evidenceReferences,
  };
}

function validCompanyAlignment() {
  return {
    businessModel: classification("SAAS"),
    customerType: classification("LIGHT_B2B"),
    productType: classification("WORKFLOW"),
    customerSegment: classification("MID_MARKET"),
    alignmentSummary: "The company context is aligned.",
    strategicAdvantages: [finding],
    potentialConcerns: [],
    unknowns: [],
    evidenceReferences,
    contradictions: [],
  };
}

const ownershipDimensions = [
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

function knownOwnershipDimension() {
  return {
    conclusion: "The boundary is supported.",
    unknown: false as const,
    evidenceReferences,
  };
}

function validOrganizationalMaturity() {
  return {
    score: 75,
    scoreExplanation: "The holistic maturity assessment is supported.",
    scoreEvidenceReferences: evidenceReferences,
    existingCustomerSuccessFunction: {
      classification: "ESTABLISHED" as const,
      explanation: "An established function is supported.",
      evidenceReferences,
    },
    customerOperatingModel: {
      classification: "ADOPTION_FOCUSED" as const,
      explanation: "The operating model is adoption focused.",
      evidenceReferences,
      substantialPatterns: ["ADOPTION_FOCUSED" as const],
    },
    ownershipAndCrossFunctionalDesign: {
      summary: "The ownership design is bounded.",
      roleBoundaries: knownOwnershipDimension(),
      teamBoundaries: knownOwnershipDimension(),
      handoffs: knownOwnershipDimension(),
      sharedOwnership: knownOwnershipDimension(),
      crossFunctionalRelationships: knownOwnershipDimension(),
      unrelatedResponsibilities: knownOwnershipDimension(),
      scopeCreep: knownOwnershipDimension(),
      multipleJobsCombined: knownOwnershipDimension(),
      unrealisticOwnership: knownOwnershipDimension(),
      evidenceReferences,
    },
    summary: "The organization has a supported operating structure.",
    positiveSignals: [finding],
    weakSignals: [],
    unknowns: [],
    evidenceReferences,
    contradictions: [],
  };
}

function validAlexFit() {
  return {
    classification: "STRONG" as const,
    summary: "The role is strongly aligned.",
    experienceAlignment: {
      relationship: "DIRECT" as const,
      explanation: "Direct evidence supports the relationship.",
      evidenceReferences,
    },
    workingStyleAlignment: [
      {
        area: "Strategic ownership",
        alignment: "SUPPORTED" as const,
        explanation: "The work style is supported.",
        evidenceReferences,
      },
    ],
    careerStrategyAlignment: {
      conclusion: "The role supports the career strategy.",
      evidenceReferences,
    },
    strongestMatches: [finding],
    partialMatches: [],
    concerns: [],
    strategicValue: [finding],
    unknowns: [],
    evidenceReferences,
    contradictions: [],
  };
}

function validBurnoutRisk() {
  return {
    score: 20,
    scoreExplanation: "The supported workload indicates low risk.",
    scoreEvidenceReferences: evidenceReferences,
    summary: "The workload is bounded.",
    majorContributors: [],
    positiveIndicators: [finding],
    unknowns: [],
    evidenceReferences,
    contradictions: [],
  };
}

function validOpportunityPriority() {
  return {
    score: 80,
    scoreExplanation: "The opportunity merits priority.",
    scoreEvidenceReferences: evidenceReferences,
    strategicValueSummary: "Strategic value is supported.",
    strategicValueEvidenceReferences: evidenceReferences,
    applicationEffort: {
      classification: "LOW" as const,
      explanation: "Low effort is supported.",
      evidenceReferences,
    },
    reasonsForPrioritization: [finding],
    reasonsForReducedPriority: [],
    unknowns: [],
    evidenceReferences,
    contradictions: [],
  };
}

function validGhostJobRisk() {
  return {
    risk: {
      classification: "LOW" as const,
      assessment: "The posting is currently active.",
      interpretation: "Current active status supports low risk.",
      evidenceReferences,
    },
    unknowns: [],
    contradictions: [],
  };
}

function expectNonRetryableEvidenceFailure(run: () => unknown, code: string) {
  expect(run).toThrowError(expect.objectContaining({ code, retryable: false }));
}

describe("Customer Success provider/application contracts", () => {
  it.each([
    "customerLifecycleInvolvement",
    "customerOwnership",
    "strategicResponsibility",
    "technicalExposure",
    "commercialResponsibility",
    "crossFunctionalInvolvement",
    "businessImpact",
  ] as const)("structurally enforces Job Evaluation %s Known/Unknown evidence", (key) => {
    const knownWithoutEvidence = validJobEvaluation();
    knownWithoutEvidence[key] = {
      conclusion: "Unsupported conclusion.",
      unknown: false,
      evidenceReferences: [],
    };
    expect(
      semanticJobEvaluationTransportSchema.safeParse(knownWithoutEvidence)
        .success,
    ).toBe(false);

    const unknown = validJobEvaluation();
    unknown[key] = {
      conclusion: null,
      unknown: true,
      evidenceReferences: [],
    };
    expect(semanticJobEvaluationTransportSchema.safeParse(unknown).success).toBe(
      true,
    );
  });

  it.each([
    ["businessModel", "SAAS"],
    ["customerType", "LIGHT_B2B"],
    ["productType", "WORKFLOW"],
    ["customerSegment", "MID_MARKET"],
  ] as const)("structurally enforces Company Alignment %s evidence", (key, value) => {
    const knownWithoutEvidence = validCompanyAlignment() as Record<string, any>;
    knownWithoutEvidence[key] = {
      classification: value,
      explanation: "Known without evidence.",
      evidenceReferences: [],
    };
    expect(
      semanticCompanyAlignmentTransportSchema.safeParse(knownWithoutEvidence)
        .success,
    ).toBe(false);
    knownWithoutEvidence[key] = {
      classification: "UNKNOWN",
      explanation: "The value is unknown.",
      evidenceReferences: [],
    };
    expect(
      semanticCompanyAlignmentTransportSchema.safeParse(knownWithoutEvidence)
        .success,
    ).toBe(true);
  });

  it.each(ownershipDimensions)(
    "makes every Organizational Maturity %s null/Unknown combination structural",
    (key) => {
      const knownWithoutConclusion = validOrganizationalMaturity();
      knownWithoutConclusion.ownershipAndCrossFunctionalDesign[key] = {
        conclusion: null as never,
        unknown: false,
        evidenceReferences,
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(
          knownWithoutConclusion,
        ).success,
      ).toBe(false);

      const unknownWithConclusion = validOrganizationalMaturity();
      unknownWithConclusion.ownershipAndCrossFunctionalDesign[key] = {
        conclusion: "An unknown must not assert this.",
        unknown: true as never,
        evidenceReferences: [],
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(
          unknownWithConclusion,
        ).success,
      ).toBe(false);

      const knownWithoutEvidence = validOrganizationalMaturity();
      knownWithoutEvidence.ownershipAndCrossFunctionalDesign[key] = {
        conclusion: "Known conclusion.",
        unknown: false,
        evidenceReferences: [],
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(
          knownWithoutEvidence,
        ).success,
      ).toBe(false);

      const validUnknown = validOrganizationalMaturity();
      validUnknown.ownershipAndCrossFunctionalDesign[key] = {
        conclusion: null as never,
        unknown: true as never,
        evidenceReferences: [],
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(validUnknown)
          .success,
      ).toBe(true);
    },
  );

  it("structurally enforces every Organizational Maturity criterion branch", () => {
    const knownFunctionWithoutEvidence = validOrganizationalMaturity();
    knownFunctionWithoutEvidence.existingCustomerSuccessFunction.evidenceReferences =
      [];
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(
        knownFunctionWithoutEvidence,
      ).success,
    ).toBe(false);

    const unknownFunction = validOrganizationalMaturity() as Record<string, any>;
    unknownFunction.existingCustomerSuccessFunction = {
      classification: "UNKNOWN",
      explanation: "The function is unknown.",
      evidenceReferences: [],
    };
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(unknownFunction)
        .success,
    ).toBe(true);

    const invalidHybrid = validOrganizationalMaturity() as Record<string, any>;
    invalidHybrid.customerOperatingModel = {
      classification: "HYBRID",
      explanation: "Only one pattern was supplied.",
      evidenceReferences,
      substantialPatterns: ["ADOPTION_FOCUSED"],
    };
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(invalidHybrid)
        .success,
    ).toBe(false);

    const invalidUnknown = validOrganizationalMaturity() as Record<string, any>;
    invalidUnknown.customerOperatingModel = {
      classification: "UNKNOWN",
      explanation: "Unknown cannot assert patterns.",
      evidenceReferences: [],
      substantialPatterns: ["ADOPTION_FOCUSED"],
    };
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(invalidUnknown)
        .success,
    ).toBe(false);
  });

  it("retains Organizational Maturity runtime validation as defense in depth", () => {
    const invalid = validOrganizationalMaturity();
    invalid.ownershipAndCrossFunctionalDesign.scopeCreep = {
      conclusion: null as never,
      unknown: false,
      evidenceReferences,
    };
    expect(semanticOrganizationalMaturitySchema.safeParse(invalid).success).toBe(
      false,
    );
  });

  it("structurally enforces Alex Fit experience and work-style evidence branches", () => {
    for (const relationship of ["DIRECT", "RELATED", "TRANSFERABLE"] as const) {
      const invalid = validAlexFit();
      invalid.experienceAlignment = {
        relationship,
        explanation: "Known without evidence.",
        evidenceReferences: [],
      };
      expect(semanticAlexFitTransportSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
    for (const relationship of ["UNSUPPORTED", "UNKNOWN"] as const) {
      const valid = validAlexFit();
      valid.experienceAlignment = {
        relationship: relationship as never,
        explanation: "No supporting profile evidence is asserted.",
        evidenceReferences: [],
      };
      expect(semanticAlexFitTransportSchema.safeParse(valid).success).toBe(true);
    }
    const knownStyle = validAlexFit();
    knownStyle.workingStyleAlignment[0]!.evidenceReferences = [];
    expect(semanticAlexFitTransportSchema.safeParse(knownStyle).success).toBe(
      false,
    );
    const unknownStyle = validAlexFit();
    unknownStyle.workingStyleAlignment[0] = {
      area: "Meeting cadence",
      alignment: "UNKNOWN" as never,
      explanation: "Meeting cadence is unknown.",
      evidenceReferences: [],
    };
    expect(semanticAlexFitTransportSchema.safeParse(unknownStyle).success).toBe(
      true,
    );
  });

  it("structurally enforces Opportunity Priority and Ghost Job Risk branches", () => {
    const priority = validOpportunityPriority();
    priority.applicationEffort.evidenceReferences = [];
    expect(
      semanticOpportunityPriorityTransportSchema.safeParse(priority).success,
    ).toBe(false);
    priority.applicationEffort = {
      classification: "UNKNOWN" as never,
      explanation: "Application effort is unknown.",
      evidenceReferences: [],
    };
    expect(
      semanticOpportunityPriorityTransportSchema.safeParse(priority).success,
    ).toBe(true);

    const knownRisk = validGhostJobRisk();
    knownRisk.risk.evidenceReferences = [];
    expect(semanticGhostJobRiskTransportSchema.safeParse(knownRisk).success).toBe(
      false,
    );
    const unknownRisk = validGhostJobRisk();
    unknownRisk.risk = {
      classification: "UNKNOWN" as never,
      assessment: "Risk remains unknown.",
      interpretation: "No unsupported conclusion is made.",
      evidenceReferences: [],
    };
    expect(
      semanticGhostJobRiskTransportSchema.safeParse(unknownRisk).success,
    ).toBe(true);
  });

  it("converts every valid transport to the unchanged domain shape", () => {
    expect(
      semanticJobEvaluationFromTransport(
        validJobEvaluation(),
        availableEvidence,
      ),
    ).toEqual(validJobEvaluation());
    expect(
      semanticCompanyAlignmentFromTransport(
        validCompanyAlignment() as never,
        availableEvidence,
      ),
    ).toEqual(validCompanyAlignment());
    expect(
      semanticOrganizationalMaturityFromTransport(
        validOrganizationalMaturity(),
        availableEvidence,
      ),
    ).toEqual(validOrganizationalMaturity());
    expect(
      semanticAlexFitFromTransport(validAlexFit(), availableEvidence),
    ).toEqual(validAlexFit());
    expect(
      semanticBurnoutRiskFromTransport(
        validBurnoutRisk(),
        availableEvidence,
      ),
    ).toEqual(validBurnoutRisk());
    expect(
      semanticOpportunityPriorityFromTransport(validOpportunityPriority(), {
        availableEvidence,
        postingTimingEvidenceReferences: [],
      }),
    ).toEqual(validOpportunityPriority());
  });

  it("makes input-dependent contract failures non-retryable", () => {
    const cases: Array<[() => unknown, string]> = [
      [
        () =>
          semanticJobEvaluationFromTransport(validJobEvaluation(), []),
        "JOB_EVALUATION_EVIDENCE_INVALID",
      ],
      [
        () =>
          semanticCompanyAlignmentFromTransport(
            validCompanyAlignment() as never,
            [],
          ),
        "COMPANY_ALIGNMENT_EVIDENCE_INVALID",
      ],
      [
        () =>
          semanticOrganizationalMaturityFromTransport(
            validOrganizationalMaturity(),
            [],
          ),
        "ORGANIZATIONAL_MATURITY_EVIDENCE_INVALID",
      ],
      [
        () => semanticAlexFitFromTransport(validAlexFit(), []),
        "ALEX_FIT_EVIDENCE_INVALID",
      ],
      [
        () => semanticBurnoutRiskFromTransport(validBurnoutRisk(), []),
        "BURNOUT_RISK_EVIDENCE_INVALID",
      ],
      [
        () =>
          semanticOpportunityPriorityFromTransport(validOpportunityPriority(), {
            availableEvidence,
            postingTimingEvidenceReferences: evidenceReferences,
          }),
        "OPPORTUNITY_PRIORITY_EVIDENCE_INVALID",
      ],
    ];
    for (const [run, code] of cases) {
      expectNonRetryableEvidenceFailure(run, code);
    }
  });

  it("enforces Ghost Job Risk fact-dependent safeguards without retry", () => {
    expectNonRetryableEvidenceFailure(
      () =>
        semanticGhostJobRiskFromTransport(validGhostJobRisk(), {
          objectiveFacts: [
            {
              type: "AGGREGATOR_VISIBILITY",
              description: "An aggregator lists the role.",
              occurredAt: null,
              evidenceReferences,
            },
          ],
          availableEvidence,
        }),
      "GHOST_JOB_RISK_FACTS_INVALID",
    );

    const elevated = validGhostJobRisk();
    elevated.risk.classification = "ELEVATED";
    expectNonRetryableEvidenceFailure(
      () =>
        semanticGhostJobRiskFromTransport(elevated, {
          objectiveFacts: [
            {
              type: "REPOSTED",
              description: "The role was reposted once.",
              occurredAt: null,
              evidenceReferences,
            },
          ],
          availableEvidence,
        }),
      "GHOST_JOB_RISK_FACTS_INVALID",
    );
  });
});
