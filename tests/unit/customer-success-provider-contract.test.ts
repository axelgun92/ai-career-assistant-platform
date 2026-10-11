import {
  createSemanticOrganizationalMaturityTransportSchema,
  customerOperatingModelSchema,
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
  opportunityPriorityEvidenceCatalog,
  semanticOrganizationalMaturityFromTransport,
  organizationalMaturityDataSchema,
  semanticOrganizationalMaturitySchema,
  semanticOrganizationalMaturityTransportSchema,
  responsibilityAreas,
  ownershipFunctions,
  organizationalMaturityRelationshipCatalog,
  organizationalMaturityRelationshipTransport,
  restoreOrganizationalMaturityRelationships,
} from "@ai-career/customer-success";
import { describe, expect, it } from "vitest";

const availableEvidence = [{ referenceId: "e1", sourceType: "MANUAL" }];
const evidenceReferences = ["e1"];

describe("Organizational Maturity authoritative cross-functional relationships", () => {
  const evidence = ["education-work", "marketing-work", "product-team", "sales-team", "support-team", "education-team", "handoff"].map(
    (referenceId) => ({ referenceId, sourceType: "MANUAL" }),
  );
  const map = {
    functions: {
      education: { relationship: "OWNS" as const, evidenceReferences: ["education-work"] },
      marketing: { relationship: "OWNS" as const, evidenceReferences: ["marketing-work"] },
      product: { relationship: "COLLABORATES" as const, evidenceReferences: ["product-team"] },
      sales: { relationship: "COLLABORATES" as const, evidenceReferences: ["sales-team"] },
      support: { relationship: "COLLABORATES" as const, evidenceReferences: ["support-team"] },
    },
  };

  it.each(ownershipFunctions)("does not turn owned %s work into a separate collaborator", (functionName) => {
    const catalog = organizationalMaturityRelationshipCatalog({ functions: {
      [functionName]: { relationship: "OWNS", evidenceReferences: ["education-work"] },
    } }, evidence);
    expect(catalog).toEqual([]);
    expect(organizationalMaturityRelationshipTransport(catalog)).toEqual({
      evidenceState: "NOT_ESTABLISHED", conclusion: null, evidenceReferences: [],
    });
  });

  it("keeps Product/Sales/Support collaboration while excluding owned Education/Marketing", () => {
    const catalog = organizationalMaturityRelationshipCatalog(map, evidence);
    expect(catalog.map((entry) => entry.function)).toEqual(["sales", "support", "product"]);
    const dimension = organizationalMaturityRelationshipTransport(catalog);
    expect(dimension.conclusion).toBe("Cross-functional relationships: collaborates with Sales; collaborates with Support; collaborates with Product.");
    expect(dimension.evidenceReferences).toEqual(["sales-team", "support-team", "product-team"]);
    expect(map.functions.education.relationship).toBe("OWNS");
  });

  it.each(["COLLABORATES", "SHARES", "HANDS_OFF_TO", "RECEIVES_FROM"] as const)(
    "preserves explicit %s relationships without recasting every relationship as collaboration", (relationship) => {
      const catalog = organizationalMaturityRelationshipCatalog({ functions: {
        education: { relationship, evidenceReferences: ["education-team"] },
      } }, evidence);
      expect(catalog[0]?.relationship).toBe(relationship);
      expect(organizationalMaturityRelationshipTransport(catalog).conclusion).toContain("Education");
      if (relationship !== "COLLABORATES") expect(organizationalMaturityRelationshipTransport(catalog).conclusion).not.toContain("collaborates");
    },
  );

  it("allows owned education responsibilities alongside an independently evidenced Education collaborator", () => {
    const responsibilities = responsibilityMapWithRenewals("UNKNOWN");
    responsibilities.areas.education = { prominence: "PRIMARY", ownership: "OWNS", evidenceReferences: ["education-work"] };
    const catalog = organizationalMaturityRelationshipCatalog({ functions: {
      education: { relationship: "COLLABORATES", evidenceReferences: ["education-team"] },
    } }, evidence);
    const schema = createSemanticOrganizationalMaturityTransportSchema(responsibilities, catalog);
    const candidate = validOrganizationalMaturity();
    const transport = { ...candidate, ownershipAndCrossFunctionalDesign: {
      ...candidate.ownershipAndCrossFunctionalDesign, crossFunctionalRelationships: providerRelationshipDimension(catalog),
    } };
    expect(schema.safeParse(transport).success).toBe(true);
    expect(responsibilities.areas.education.ownership).toBe("OWNS");
  });

  it("requires resolvable relationship evidence and does not turn unclear boundaries into supported absence", () => {
    expect(() => organizationalMaturityRelationshipCatalog({ functions: {
      education: { relationship: "COLLABORATES", evidenceReferences: ["missing"] },
    } }, evidence)).toThrow("authoritative relationship evidence");
    expect(() => organizationalMaturityRelationshipCatalog({ functions: {
      education: { relationship: "COLLABORATES", evidenceReferences: [] },
    } }, evidence)).toThrow();
    expect(organizationalMaturityRelationshipCatalog({ functions: {
      education: { relationship: "UNCLEAR_BOUNDARIES", evidenceReferences: ["education-work"] },
    } }, evidence)).toEqual([]);
  });

  it("rejects unsupported collaborators and ownership-only evidence in the request-specific schema", () => {
    const catalog = organizationalMaturityRelationshipCatalog(map, evidence);
    const schema = createSemanticOrganizationalMaturityTransportSchema(responsibilityMapWithRenewals("UNKNOWN"), catalog);
    const candidate = validOrganizationalMaturity();
    const dimension = providerRelationshipDimension(catalog);
    const make = (replacement: unknown) => ({ ...candidate, ownershipAndCrossFunctionalDesign: {
      ...candidate.ownershipAndCrossFunctionalDesign, crossFunctionalRelationships: replacement,
    } });
    expect(schema.safeParse(make(dimension)).success).toBe(true);
    expect(schema.safeParse(make({ ...dimension, conclusion: "Collaborates with Education and Marketing." })).success).toBe(false);
    expect(schema.safeParse(make({ ...dimension, evidenceReferences: ["education-work"] })).success).toBe(false);
    expect(schema.safeParse(make({ ...dimension, evidenceReferences: [] })).success).toBe(false);
    expect(schema.safeParse(make({ ...dimension, evidenceState: "SUPPORTED_ABSENT" })).success).toBe(false);
    expect(schema.safeParse(make({ ...dimension, conclusion: null })).success).toBe(false);
  });

  it("forces Unknown when only owned work is known, without discarding education operating-model evidence", () => {
    const catalog = organizationalMaturityRelationshipCatalog({ functions: { education: map.functions.education } }, evidence);
    const schema = createSemanticOrganizationalMaturityTransportSchema(responsibilityMapWithRenewals("UNKNOWN"), catalog);
    const candidate = validOrganizationalMaturity();
    const transport = { ...candidate, customerOperatingModel: {
      ...candidate.customerOperatingModel, classification: "EDUCATION_FOCUSED", substantialPatterns: ["EDUCATION_FOCUSED"],
    }, ownershipAndCrossFunctionalDesign: {
      ...candidate.ownershipAndCrossFunctionalDesign, crossFunctionalRelationships: providerRelationshipDimension(catalog),
    } };
    expect(schema.safeParse(transport).success).toBe(true);
    const domain = semanticOrganizationalMaturityFromTransport(schema.parse(transport), [...availableEvidence, ...evidence], responsibilityMapWithRenewals("UNKNOWN"), catalog);
    expect(domain.ownershipAndCrossFunctionalDesign.crossFunctionalRelationships).toEqual({ unknown: true, conclusion: null, evidenceReferences: [] });
    expect(domain.unknowns.map((unknown) => unknown.code)).toContain("organizational-maturity-cross-functional-relationships-not-established");
    expect(domain.weakSignals).toEqual([]);
    expect(domain.customerOperatingModel.classification).toBe("EDUCATION_FOCUSED");
    expect(domain.score).toBe(candidate.score);
    expect(schema.safeParse({ ...transport, ownershipAndCrossFunctionalDesign: {
      ...transport.ownershipAndCrossFunctionalDesign, crossFunctionalRelationships: supportedOwnershipDimension(),
    } }).success).toBe(false);
  });

  it("retains weak-signal/Unknown rejection after authoritative relationship restoration", () => {
    const catalog = organizationalMaturityRelationshipCatalog({ functions: { education: map.functions.education } }, evidence);
    const candidate = toLegacyOrganizationalMaturityTransport(
      validOrganizationalMaturity(),
    );
    const transport = { ...candidate,
      weakSignals: [supportedWeakSignal("CROSS_FUNCTIONAL_RELATIONSHIPS")],
      ownershipAndCrossFunctionalDesign: { ...candidate.ownershipAndCrossFunctionalDesign,
        crossFunctionalRelationships: organizationalMaturityRelationshipTransport(catalog) },
    };
    expect(() => semanticOrganizationalMaturityFromTransport(transport, [...availableEvidence, ...evidence], responsibilityMapWithRenewals("UNKNOWN"), catalog))
      .toThrow("NOT_ESTABLISHED ownership dimension cannot also be a weak signal");
  });

  it("restores complete relationship evidence deterministically and projects legacy v5 without changing public shape or other fields", () => {
    const catalog = organizationalMaturityRelationshipCatalog(map, evidence);
    const currentCandidate = validOrganizationalMaturity();
    currentCandidate.score = 58;
    const candidate = toLegacyOrganizationalMaturityTransport(currentCandidate);
    candidate.ownershipAndCrossFunctionalDesign.crossFunctionalRelationships = {
      evidenceState: "SUPPORTED_PRESENT", conclusion: "Collaborates with Product and Education through education ownership.", evidenceReferences: ["product-team", "education-work"],
    };
    const sources = [...availableEvidence, ...evidence];
    const legacy = semanticOrganizationalMaturityFromTransport(candidate, sources);
    const snapshot = structuredClone(legacy);
    const projected = restoreOrganizationalMaturityRelationships(legacy, map, sources);
    const converted = semanticOrganizationalMaturityFromTransport(candidate, sources, responsibilityMapWithRenewals("UNKNOWN"), catalog);
    expect(projected).toEqual(converted);
    expect(legacy).toEqual(snapshot);
    expect(projected).toEqual({ ...legacy, ownershipAndCrossFunctionalDesign: {
      ...legacy.ownershipAndCrossFunctionalDesign, crossFunctionalRelationships: {
        unknown: false, conclusion: organizationalMaturityRelationshipTransport(catalog).conclusion,
        evidenceReferences: ["sales-team", "support-team", "product-team"],
      },
    } });
    expect(semanticOrganizationalMaturitySchema.parse(projected)).toEqual(projected);
    expect(restoreOrganizationalMaturityRelationships(projected, map, sources)).toEqual(projected);
    expect(organizationalMaturityDataSchema.parse({ evaluated: true, maturity: JSON.parse(JSON.stringify(projected)) })).toEqual({ evaluated: true, maturity: projected });
    const dimension = organizationalMaturityRelationshipTransport(catalog);
    const schema = createSemanticOrganizationalMaturityTransportSchema(responsibilityMapWithRenewals("UNKNOWN"), catalog);
    const repeated = { ...currentCandidate, ownershipAndCrossFunctionalDesign: {
      ...currentCandidate.ownershipAndCrossFunctionalDesign,
      crossFunctionalRelationships: {
        ...providerRelationshipDimension(catalog),
        evidenceReferences: ["product-team", "product-team"],
      },
    } };
    expect(semanticOrganizationalMaturityFromTransport(schema.parse(repeated), sources, responsibilityMapWithRenewals("UNKNOWN"), catalog)).toEqual(projected);
    expect(() => restoreOrganizationalMaturityRelationships({ ...legacy, ownershipAndCrossFunctionalDesign: {
      ...legacy.ownershipAndCrossFunctionalDesign, crossFunctionalRelationships: { ...legacy.ownershipAndCrossFunctionalDesign.crossFunctionalRelationships, evidenceReferences: ["missing"] },
    } }, map, sources)).toThrow("unavailable evidence");
  });
});
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

const maturityAssessmentAreas = [
  "EXISTING_CS_FUNCTION",
  "CUSTOMER_OPERATING_MODEL",
  "ROLE_BOUNDARIES",
  "TEAM_BOUNDARIES",
  "HANDOFFS",
  "SHARED_OWNERSHIP",
  "CROSS_FUNCTIONAL_RELATIONSHIPS",
  "UNRELATED_RESPONSIBILITIES",
  "SCOPE_CREEP",
  "MULTIPLE_JOBS_COMBINED",
  "UNREALISTIC_OWNERSHIP",
] as const;

const ownershipKeyByAssessmentArea = {
  ROLE_BOUNDARIES: "roleBoundaries",
  TEAM_BOUNDARIES: "teamBoundaries",
  HANDOFFS: "handoffs",
  SHARED_OWNERSHIP: "sharedOwnership",
  CROSS_FUNCTIONAL_RELATIONSHIPS: "crossFunctionalRelationships",
  UNRELATED_RESPONSIBILITIES: "unrelatedResponsibilities",
  SCOPE_CREEP: "scopeCreep",
  MULTIPLE_JOBS_COMBINED: "multipleJobsCombined",
  UNREALISTIC_OWNERSHIP: "unrealisticOwnership",
} as const;

const neutralMaturityImpact = () => ({
  impact: "NEUTRAL" as const,
  finding: null,
  affirmativeEvidenceReferences: [] as string[],
});

const positiveMaturityImpact = (
  findingText = finding.finding,
  references = evidenceReferences,
) => ({
  impact: "SUPPORTED_POSITIVE" as const,
  finding: findingText,
  affirmativeEvidenceReferences: references,
});

const weakMaturityImpact = (
  findingText = "The posting explicitly combines ownership across separate functions.",
  references = evidenceReferences,
) => ({
  impact: "SUPPORTED_WEAKNESS" as const,
  finding: findingText,
  affirmativeEvidenceReferences: references,
});

const notEstablishedMaturityImpact = () => ({
  impact: "NOT_ESTABLISHED" as const,
  finding: null,
  affirmativeEvidenceReferences: [] as string[],
});

function contextualMaturityUnknown(code = "maturity-information-unknown") {
  return {
    code,
    description: "The available evidence does not resolve this information.",
    materiality: "Completeness is reduced.",
    evidenceReferences: [] as string[],
  };
}

function supportedOwnershipDimension(
  evidenceState: "SUPPORTED_PRESENT" | "SUPPORTED_ABSENT" =
    "SUPPORTED_PRESENT",
) {
  return {
    evidenceState,
    conclusion: "The boundary is supported.",
    evidenceReferences,
    semanticImpact: neutralMaturityImpact(),
    unknowns: [] as ReturnType<typeof contextualMaturityUnknown>[],
  };
}

function unknownOwnershipDimension() {
  return {
    evidenceState: "NOT_ESTABLISHED" as const,
    conclusion: null,
    evidenceReferences: [] as string[],
    semanticImpact: notEstablishedMaturityImpact(),
    unknowns: [contextualMaturityUnknown()],
  };
}

function providerRelationshipDimension(
  catalog: ReturnType<typeof organizationalMaturityRelationshipCatalog>,
) {
  const dimension = organizationalMaturityRelationshipTransport(catalog);
  return dimension.evidenceState === "NOT_ESTABLISHED"
    ? {
        ...dimension,
        semanticImpact: notEstablishedMaturityImpact(),
        unknowns: [contextualMaturityUnknown("relationship-design-unknown")],
      }
    : {
        ...dimension,
        semanticImpact: neutralMaturityImpact(),
        unknowns: [] as ReturnType<typeof contextualMaturityUnknown>[],
      };
}

function supportedWeakSignal(
  assessmentArea:
    | "EXISTING_CS_FUNCTION"
    | "CUSTOMER_OPERATING_MODEL"
    | "ROLE_BOUNDARIES"
    | "TEAM_BOUNDARIES"
    | "HANDOFFS"
    | "SHARED_OWNERSHIP"
    | "CROSS_FUNCTIONAL_RELATIONSHIPS"
    | "UNRELATED_RESPONSIBILITIES"
    | "SCOPE_CREEP"
    | "MULTIPLE_JOBS_COMBINED"
    | "UNREALISTIC_OWNERSHIP" = "SCOPE_CREEP",
  findingText = "The posting explicitly combines ownership across separate functions.",
) {
  return {
    assessmentArea,
    evidenceState: "SUPPORTED_WEAKNESS" as const,
    finding: findingText,
    affirmativeEvidenceReferences: evidenceReferences,
  };
}

function maturityUnknown(
  assessmentArea: ReturnType<typeof supportedWeakSignal>["assessmentArea"],
  code = "maturity-information-unknown",
) {
  return {
    assessmentArea,
    code,
    description: "The available evidence does not resolve this information.",
    materiality: "Completeness is reduced.",
    evidenceReferences: [] as string[],
  };
}

function setMaturityAssessment(
  transport: ReturnType<typeof validOrganizationalMaturity>,
  assessmentArea: ReturnType<typeof supportedWeakSignal>["assessmentArea"],
  semanticImpact: ReturnType<
    | typeof neutralMaturityImpact
    | typeof positiveMaturityImpact
    | typeof weakMaturityImpact
    | typeof notEstablishedMaturityImpact
  >,
  unknowns: ReturnType<typeof contextualMaturityUnknown>[] = [],
) {
  if (assessmentArea === "EXISTING_CS_FUNCTION") {
    Object.assign(transport.existingCustomerSuccessFunction, {
      semanticImpact,
      unknowns,
    });
    return;
  }
  if (assessmentArea === "CUSTOMER_OPERATING_MODEL") {
    Object.assign(transport.customerOperatingModel, { semanticImpact, unknowns });
    return;
  }
  Object.assign(
    transport.ownershipAndCrossFunctionalDesign[
      ownershipKeyByAssessmentArea[assessmentArea]
    ],
    { semanticImpact, unknowns },
  );
}

function maturityAssessmentFor(
  transport: ReturnType<typeof validOrganizationalMaturity>,
  assessmentArea: (typeof maturityAssessmentAreas)[number],
) {
  if (assessmentArea === "EXISTING_CS_FUNCTION") {
    return transport.existingCustomerSuccessFunction;
  }
  if (assessmentArea === "CUSTOMER_OPERATING_MODEL") {
    return transport.customerOperatingModel;
  }
  return transport.ownershipAndCrossFunctionalDesign[
    ownershipKeyByAssessmentArea[assessmentArea]
  ];
}

function setMaturityAssessmentStatement(
  transport: ReturnType<typeof validOrganizationalMaturity>,
  assessmentArea: (typeof maturityAssessmentAreas)[number],
  statement: string,
) {
  const assessment = maturityAssessmentFor(transport, assessmentArea);
  if ("explanation" in assessment) assessment.explanation = statement;
  else assessment.conclusion = statement;
}

function setMaturityAssessmentNotEstablished(
  transport: ReturnType<typeof validOrganizationalMaturity>,
  assessmentArea: (typeof maturityAssessmentAreas)[number],
) {
  if (assessmentArea === "EXISTING_CS_FUNCTION") {
    transport.existingCustomerSuccessFunction = {
      classification: "UNKNOWN",
      explanation: "The existing Customer Success function is unresolved.",
      evidenceReferences: [],
      semanticImpact: notEstablishedMaturityImpact(),
      unknowns: [contextualMaturityUnknown("cs-function-unknown")],
    } as never;
    return;
  }
  if (assessmentArea === "CUSTOMER_OPERATING_MODEL") {
    transport.customerOperatingModel = {
      classification: "UNKNOWN",
      explanation: "The customer operating model is unresolved.",
      evidenceReferences: [],
      substantialPatterns: [],
      semanticImpact: notEstablishedMaturityImpact(),
      unknowns: [contextualMaturityUnknown("operating-model-unknown")],
    } as never;
    return;
  }
  transport.ownershipAndCrossFunctionalDesign[
    ownershipKeyByAssessmentArea[assessmentArea]
  ] = unknownOwnershipDimension() as never;
}

function toLegacyOrganizationalMaturityTransport(
  current: ReturnType<typeof validOrganizationalMaturity>,
) {
  const areas = [
    ["EXISTING_CS_FUNCTION", current.existingCustomerSuccessFunction],
    ["CUSTOMER_OPERATING_MODEL", current.customerOperatingModel],
    ...ownershipDimensions.map((key, index) => [
      [
        "ROLE_BOUNDARIES",
        "TEAM_BOUNDARIES",
        "HANDOFFS",
        "SHARED_OWNERSHIP",
        "CROSS_FUNCTIONAL_RELATIONSHIPS",
        "UNRELATED_RESPONSIBILITIES",
        "SCOPE_CREEP",
        "MULTIPLE_JOBS_COMBINED",
        "UNREALISTIC_OWNERSHIP",
      ][index],
      current.ownershipAndCrossFunctionalDesign[key],
    ]),
  ] as Array<[ReturnType<typeof supportedWeakSignal>["assessmentArea"], any]>;
  const stripAssessment = ({ semanticImpact: _impact, unknowns: _unknowns, ...value }: any) => value;
  const positiveSignals = areas.flatMap(([, assessment]) =>
    assessment.semanticImpact.impact === "SUPPORTED_POSITIVE"
      ? [{
          finding: assessment.semanticImpact.finding,
          evidenceReferences: assessment.semanticImpact.affirmativeEvidenceReferences,
        }]
      : [],
  );
  const weakSignals = areas.flatMap(([assessmentArea, assessment]) =>
    assessment.semanticImpact.impact === "SUPPORTED_WEAKNESS"
      ? [{
          assessmentArea,
          evidenceState: "SUPPORTED_WEAKNESS" as const,
          finding: assessment.semanticImpact.finding,
          affirmativeEvidenceReferences: assessment.semanticImpact.affirmativeEvidenceReferences,
        }]
      : [],
  );
  const unknowns = areas.flatMap(([assessmentArea, assessment]) =>
    assessment.unknowns.map((unknown: ReturnType<typeof contextualMaturityUnknown>) => ({
      assessmentArea,
      ...unknown,
    })),
  );
  return {
    ...current,
    existingCustomerSuccessFunction: stripAssessment(
      current.existingCustomerSuccessFunction,
    ),
    customerOperatingModel: stripAssessment(current.customerOperatingModel),
    ownershipAndCrossFunctionalDesign: {
      ...current.ownershipAndCrossFunctionalDesign,
      ...Object.fromEntries(
        ownershipDimensions.map((key) => [
          key,
          stripAssessment(current.ownershipAndCrossFunctionalDesign[key]),
        ]),
      ),
    },
    positiveSignals,
    weakSignals,
    unknowns,
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
      semanticImpact: positiveMaturityImpact(),
      unknowns: [] as ReturnType<typeof contextualMaturityUnknown>[],
    },
    customerOperatingModel: {
      classification: "ADOPTION_FOCUSED" as const,
      explanation: "The operating model is adoption focused.",
      evidenceReferences,
      substantialPatterns: ["ADOPTION_FOCUSED" as const],
      semanticImpact: neutralMaturityImpact(),
      unknowns: [] as ReturnType<typeof contextualMaturityUnknown>[],
    },
    ownershipAndCrossFunctionalDesign: {
      summary: "The ownership design is bounded.",
      roleBoundaries: supportedOwnershipDimension(),
      teamBoundaries: supportedOwnershipDimension(),
      handoffs: supportedOwnershipDimension(),
      sharedOwnership: supportedOwnershipDimension(),
      crossFunctionalRelationships: supportedOwnershipDimension(),
      unrelatedResponsibilities: supportedOwnershipDimension(),
      scopeCreep: supportedOwnershipDimension(),
      multipleJobsCombined: supportedOwnershipDimension(),
      unrealisticOwnership: supportedOwnershipDimension(),
      evidenceReferences,
    },
    summary: "The organization has a supported operating structure.",
    evidenceReferences,
    contradictions: [],
  };
}

function responsibilityMapWithRenewals(
  prominence:
    | "PRIMARY"
    | "SUBSTANTIAL"
    | "SECONDARY"
    | "OCCASIONAL"
    | "ABSENT"
    | "UNKNOWN",
  ownership:
    | "OWNS"
    | "SHARES"
    | "SUPPORTS"
    | "COLLABORATES"
    | "RECEIVES_HANDOFF"
    | "HANDS_OFF"
    | "UNKNOWN" = "UNKNOWN",
  supportingEvidence = prominence === "UNKNOWN" ? [] : evidenceReferences,
) {
  return {
    areas: Object.fromEntries(
      responsibilityAreas.map((area) => [
        area,
        area === "renewals"
          ? {
              prominence,
              ownership,
              evidenceReferences: supportingEvidence,
            }
          : {
              prominence: "UNKNOWN",
              ownership: "UNKNOWN",
              evidenceReferences: [],
            },
      ]),
    ),
    other: [],
  } as never;
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

function validOpportunityPriorityTransport() {
  return {
    score: 80,
    scoreExplanation: "The opportunity merits priority.",
    scoreEvidenceIndexes: [0],
    strategicValueSummary: "Strategic value is supported.",
    strategicValueEvidenceIndexes: [0],
    applicationEffort: {
      classification: "LOW" as const,
      explanation: "Low effort is supported.",
      evidenceIndexes: [0],
    },
    reasonsForPrioritization: [
      { finding: finding.finding, evidenceIndexes: [0] },
    ],
    reasonsForReducedPriority: [],
    unknowns: [],
    evidenceIndexes: [0],
    contradictions: [],
  };
}

function validOpportunityPriorityDomain() {
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
    reasonsForPrioritization: [
      { finding: finding.finding, evidenceReferences: [...evidenceReferences] },
    ],
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
    "makes every Organizational Maturity %s evidence-state combination structural",
    (key) => {
      const knownWithoutConclusion = validOrganizationalMaturity();
      knownWithoutConclusion.ownershipAndCrossFunctionalDesign[key] = {
        ...supportedOwnershipDimension(),
        conclusion: null as never,
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(
          knownWithoutConclusion,
        ).success,
      ).toBe(false);

      const unknownWithConclusion = validOrganizationalMaturity();
      unknownWithConclusion.ownershipAndCrossFunctionalDesign[key] = {
        ...unknownOwnershipDimension(),
        conclusion: "An unknown must not assert this.",
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(
          unknownWithConclusion,
        ).success,
      ).toBe(false);

      const knownWithoutEvidence = validOrganizationalMaturity();
      knownWithoutEvidence.ownershipAndCrossFunctionalDesign[key] = {
        ...supportedOwnershipDimension(),
        conclusion: "Known conclusion.",
        evidenceReferences: [],
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(
          knownWithoutEvidence,
        ).success,
      ).toBe(false);

      const absentWithoutEvidence = validOrganizationalMaturity();
      absentWithoutEvidence.ownershipAndCrossFunctionalDesign[key] = {
        ...supportedOwnershipDimension("SUPPORTED_ABSENT"),
        conclusion: "The evidence affirmatively supports absence.",
        evidenceReferences: [],
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(
          absentWithoutEvidence,
        ).success,
      ).toBe(false);

      const validUnknown = validOrganizationalMaturity();
      validUnknown.ownershipAndCrossFunctionalDesign[key] =
        unknownOwnershipDimension();
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(validUnknown)
          .success,
      ).toBe(true);
    },
  );

  it.each(ownershipDimensions)(
    "co-locates positive, weak, neutral, and unresolved impact for %s",
    (key) => {
      const positive = validOrganizationalMaturity();
      positive.ownershipAndCrossFunctionalDesign[key] =
        supportedOwnershipDimension();
      positive.ownershipAndCrossFunctionalDesign[key].semanticImpact =
        positiveMaturityImpact(`Supported positive ${key}.`);
      const positiveResult = semanticOrganizationalMaturityFromTransport(
        semanticOrganizationalMaturityTransportSchema.parse(positive),
        availableEvidence,
      );
      expect(positiveResult.positiveSignals).toContainEqual({
        finding: `Supported positive ${key}.`,
        evidenceReferences,
      });
      expect(positiveResult.weakSignals).not.toContainEqual(
        expect.objectContaining({ finding: `Supported positive ${key}.` }),
      );

      const weak = validOrganizationalMaturity();
      weak.ownershipAndCrossFunctionalDesign[key] = supportedOwnershipDimension();
      weak.ownershipAndCrossFunctionalDesign[key].semanticImpact =
        weakMaturityImpact(`Supported weakness ${key}.`);
      const weakResult = semanticOrganizationalMaturityFromTransport(
        semanticOrganizationalMaturityTransportSchema.parse(weak),
        availableEvidence,
      );
      expect(weakResult.weakSignals).toContainEqual({
        finding: `Supported weakness ${key}.`,
        evidenceReferences,
      });
      expect(weakResult.positiveSignals).not.toContainEqual(
        expect.objectContaining({ finding: `Supported weakness ${key}.` }),
      );

      const neutral = validOrganizationalMaturity();
      neutral.ownershipAndCrossFunctionalDesign[key] = supportedOwnershipDimension();
      const neutralResult = semanticOrganizationalMaturityFromTransport(
        semanticOrganizationalMaturityTransportSchema.parse(neutral),
        availableEvidence,
      );
      expect(neutralResult.positiveSignals).not.toContainEqual(
        expect.objectContaining({ finding: expect.stringContaining(key) }),
      );
      expect(neutralResult.weakSignals).not.toContainEqual(
        expect.objectContaining({ finding: expect.stringContaining(key) }),
      );
      expect(neutralResult.ownershipAndCrossFunctionalDesign[key].unknown).toBe(
        false,
      );

      const unresolved = validOrganizationalMaturity();
      unresolved.ownershipAndCrossFunctionalDesign[key] =
        unknownOwnershipDimension();
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(unresolved)
          .success,
      ).toBe(true);
      const unresolvedResult = semanticOrganizationalMaturityFromTransport(
        unresolved,
        availableEvidence,
      );
      expect(
        unresolvedResult.ownershipAndCrossFunctionalDesign[key].unknown,
      ).toBe(true);
      expect(unresolvedResult.positiveSignals).toHaveLength(1);
      expect(unresolvedResult.weakSignals).toEqual([]);

      for (const invalidImpact of [
        positiveMaturityImpact("Invalid unresolved positive."),
        weakMaturityImpact("Invalid unresolved weakness."),
      ]) {
        const invalid = structuredClone(unresolved);
        invalid.ownershipAndCrossFunctionalDesign[key].semanticImpact =
          invalidImpact as never;
        expect(
          semanticOrganizationalMaturityTransportSchema.safeParse(invalid)
            .success,
        ).toBe(false);
      }
    },
  );

  it.each(["SUPPORTED_POSITIVE", "SUPPORTED_WEAKNESS"] as const)(
    "requires affirmative evidence for %s impact",
    (impact) => {
      const transport = validOrganizationalMaturity();
      transport.ownershipAndCrossFunctionalDesign.scopeCreep.semanticImpact = {
        impact,
        finding: "A claimed maturity impact.",
        affirmativeEvidenceReferences: [],
      };
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(transport)
          .success,
      ).toBe(false);
    },
  );

  it.each(maturityAssessmentAreas)(
    "prevents NOT_ESTABLISHED from carrying positive or weak impact for %s",
    (assessmentArea) => {
      for (const semanticImpact of [
        positiveMaturityImpact("Invalid unresolved positive."),
        weakMaturityImpact("Invalid unresolved weakness."),
      ]) {
        const transport = validOrganizationalMaturity();
        setMaturityAssessmentNotEstablished(transport, assessmentArea);
        const assessment = maturityAssessmentFor(transport, assessmentArea);
        assessment.semanticImpact = semanticImpact as never;
        expect(
          semanticOrganizationalMaturityTransportSchema.safeParse(transport)
            .success,
        ).toBe(false);
      }
    },
  );

  it.each(maturityAssessmentAreas)(
    "accepts an independently supported positive with a narrower contextual Unknown for %s",
    (assessmentArea) => {
      const transport = validOrganizationalMaturity();
      setMaturityAssessmentStatement(
        transport,
        assessmentArea,
        "The documented operating design is established; implementation capacity is unclear.",
      );
      setMaturityAssessment(
        transport,
        assessmentArea,
        positiveMaturityImpact("The documented operating design is repeatable."),
        [
          {
            ...contextualMaturityUnknown(
              `${assessmentArea.toLowerCase().replaceAll("_", "-")}-capacity`,
            ),
            description: "Implementation capacity is unclear.",
          },
        ],
      );

      const domain = semanticOrganizationalMaturityFromTransport(
        transport,
        availableEvidence,
      );
      expect(domain.positiveSignals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            finding: "The documented operating design is repeatable.",
          }),
        ]),
      );
      expect(domain.unknowns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: `${assessmentArea.toLowerCase().replaceAll("_", "-")}-capacity`,
          }),
        ]),
      );
    },
  );

  it.each(maturityAssessmentAreas)(
    "accepts an independently supported weakness with a narrower contextual Unknown for %s",
    (assessmentArea) => {
      const transport = validOrganizationalMaturity();
      setMaturityAssessmentStatement(
        transport,
        assessmentArea,
        "The documented ownership design combines unrelated functions; staffing capacity is not described.",
      );
      setMaturityAssessment(
        transport,
        assessmentArea,
        weakMaturityImpact(
          "The documented ownership design combines unrelated functions.",
        ),
        [
          {
            ...contextualMaturityUnknown(
              `${assessmentArea.toLowerCase().replaceAll("_", "-")}-staffing`,
            ),
            description: "Staffing capacity is not described.",
          },
        ],
      );

      const domain = semanticOrganizationalMaturityFromTransport(
        transport,
        availableEvidence,
      );
      expect(domain.weakSignals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            finding:
              "The documented ownership design combines unrelated functions.",
          }),
        ]),
      );
    },
  );

  it.each(maturityAssessmentAreas)(
    "accepts a neutral established assessment with a contextual Unknown for %s",
    (assessmentArea) => {
      const transport = validOrganizationalMaturity();
      setMaturityAssessmentStatement(
        transport,
        assessmentArea,
        "The documented operating condition is established.",
      );
      setMaturityAssessment(
        transport,
        assessmentArea,
        neutralMaturityImpact(),
        [
          {
            ...contextualMaturityUnknown(
              `${assessmentArea.toLowerCase().replaceAll("_", "-")}-detail`,
            ),
            description: "A narrower staffing detail is unclear.",
          },
        ],
      );

      const domain = semanticOrganizationalMaturityFromTransport(
        transport,
        availableEvidence,
      );
      expect(domain.weakSignals).toEqual([]);
      expect(domain.unknowns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: `${assessmentArea.toLowerCase().replaceAll("_", "-")}-detail`,
          }),
        ]),
      );
    },
  );

  it.each(["SUPPORTED_POSITIVE", "SUPPORTED_WEAKNESS"] as const)(
    "accepts %s whose display finding mentions missing information; impact kind and evidence decide",
    (impact) => {
      const transport = validOrganizationalMaturity();
      setMaturityAssessment(
        transport,
        "TEAM_BOUNDARIES",
        impact === "SUPPORTED_POSITIVE"
          ? positiveMaturityImpact("Team boundaries are not described.")
          : weakMaturityImpact("Team boundaries are not described."),
        [
          {
            ...contextualMaturityUnknown("team-boundaries-unknown"),
            description: "Team boundaries are not described.",
          },
        ],
      );
      const domain = semanticOrganizationalMaturityFromTransport(
        transport,
        availableEvidence,
      );
      const signals =
        impact === "SUPPORTED_POSITIVE" ? domain.positiveSignals : domain.weakSignals;
      expect(signals).toContainEqual({
        finding: "Team boundaries are not described.",
        evidenceReferences,
      });
      expect(domain.unknowns.map((unknown) => unknown.code)).toContain(
        "team-boundaries-unknown",
      );
    },
  );

  it("keeps an established conclusion as display text without inspecting its wording", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.teamBoundaries = {
      ...supportedOwnershipDimension(),
      conclusion: "Team boundaries are not described.",
      unknowns: [
        {
          ...contextualMaturityUnknown("team-boundaries-unknown"),
          description: "Team boundaries are not described.",
        },
      ],
    };
    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );
    expect(domain.ownershipAndCrossFunctionalDesign.teamBoundaries).toEqual({
      conclusion: "Team boundaries are not described.",
      unknown: false,
      evidenceReferences,
    });
  });

  it("derives unresolved semantics only from contextual Unknown records, never from conclusion clauses", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.roleBoundaries = {
      ...supportedOwnershipDimension(),
      conclusion:
        "Lifecycle ownership is established; implementation boundaries are unclear.",
      unknowns: [
        {
          ...contextualMaturityUnknown("staffing-unknown"),
          description: "Staffing capacity is unclear.",
        },
      ],
    };
    const control = structuredClone(transport);
    control.ownershipAndCrossFunctionalDesign.roleBoundaries.conclusion =
      "Lifecycle ownership is established.";
    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );
    const controlDomain = semanticOrganizationalMaturityFromTransport(
      control,
      availableEvidence,
    );
    expect(domain.unknowns).toEqual(controlDomain.unknowns);
    expect(domain.positiveSignals).toEqual(controlDomain.positiveSignals);
    expect(domain.weakSignals).toEqual(controlDomain.weakSignals);
  });

  it("keeps a supported positive impact and a neutral contextual Unknown independent of their wording", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.roleBoundaries = {
      ...supportedOwnershipDimension(),
      conclusion: "Role boundaries are clear.",
      semanticImpact: positiveMaturityImpact("Role boundaries are clear."),
      unknowns: [
        {
          ...contextualMaturityUnknown("role-boundaries-unknown"),
          description: "Role boundaries are unclear.",
        },
      ],
    };
    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );
    expect(domain.positiveSignals).toContainEqual({
      finding: "Role boundaries are clear.",
      evidenceReferences,
    });
    expect(domain.unknowns.map((unknown) => unknown.code)).toContain(
      "role-boundaries-unknown",
    );
    expect(domain.score).toBe(transport.score);
  });

  it("requires positive and weak impact evidence to belong to its assessment", () => {
    for (const semanticImpact of [
      positiveMaturityImpact("A supported strength.", ["e2"]),
      weakMaturityImpact("A supported weakness.", ["e2"]),
    ]) {
      const transport = validOrganizationalMaturity();
      setMaturityAssessment(
        transport,
        "CUSTOMER_OPERATING_MODEL",
        semanticImpact,
      );
      expectNonRetryableEvidenceFailure(
        () =>
          semanticOrganizationalMaturityFromTransport(
            transport,
            [
              ...availableEvidence,
              { referenceId: "e2", sourceType: "MANUAL" },
            ],
          ),
        "ORGANIZATIONAL_MATURITY_IMPACT_EVIDENCE_INVALID",
      );
    }
  });

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
      semanticImpact: notEstablishedMaturityImpact(),
      unknowns: [contextualMaturityUnknown("cs-function-unknown")],
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
      semanticImpact: neutralMaturityImpact(),
      unknowns: [],
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
      semanticImpact: notEstablishedMaturityImpact(),
      unknowns: [contextualMaturityUnknown("operating-model-unknown")],
    };
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(invalidUnknown)
        .success,
    ).toBe(false);
  });

  it.each(["UNKNOWN", "SECONDARY", "OCCASIONAL", "ABSENT"] as const)(
    "removes renewal focus from both provider fields for %s prominence",
    (prominence) => {
      const schema = createSemanticOrganizationalMaturityTransportSchema(
        responsibilityMapWithRenewals(prominence),
      );
      for (const classification of [
        "RENEWAL_FOCUSED", "HYBRID", "ADOPTION_FOCUSED", "UNKNOWN",
      ]) {
        const candidate = validOrganizationalMaturity();
        expect(schema.safeParse({
          ...candidate,
          customerOperatingModel: {
            ...candidate.customerOperatingModel,
            classification,
            substantialPatterns: ["ADOPTION_FOCUSED", "RENEWAL_FOCUSED"],
          },
        }).success).toBe(false);
      }
      const candidate = validOrganizationalMaturity();
      expect(schema.safeParse({
        ...candidate,
        customerOperatingModel: {
          ...candidate.customerOperatingModel,
          classification: "RENEWAL_FOCUSED",
          substantialPatterns: [],
        },
      }).success).toBe(false);
      expect(schema.safeParse(candidate).success).toBe(true);
    },
  );

  it.each(["PRIMARY", "SUBSTANTIAL"] as const)(
    "allows evidenced %s renewal focus without requiring renewal ownership",
    (prominence) => {
      for (const ownership of ["OWNS", "SHARES", "SUPPORTS", "COLLABORATES", "UNKNOWN"] as const) {
        const map = responsibilityMapWithRenewals(prominence, ownership);
        const schema = createSemanticOrganizationalMaturityTransportSchema(map);
        const candidate = {
          ...validOrganizationalMaturity(),
          customerOperatingModel: {
            classification: "RENEWAL_FOCUSED" as const,
            explanation: "Material renewal work is established, independently of ownership.",
            evidenceReferences,
            substantialPatterns: ["RENEWAL_FOCUSED"],
            semanticImpact: neutralMaturityImpact(),
            unknowns: [],
          },
        };
        const domain = semanticOrganizationalMaturityFromTransport(
          schema.parse(candidate), availableEvidence, map,
        );
        expect(semanticOrganizationalMaturitySchema.parse(domain)).toEqual(domain);
        expect(organizationalMaturityDataSchema.parse({ evaluated: true, maturity: domain })).toEqual({ evaluated: true, maturity: domain });
        expect(domain.customerOperatingModel).toEqual({
          classification: candidate.customerOperatingModel.classification,
          explanation: candidate.customerOperatingModel.explanation,
          evidenceReferences: candidate.customerOperatingModel.evidenceReferences,
          substantialPatterns: candidate.customerOperatingModel.substantialPatterns,
        });
      }
    },
  );

  it.each(["PRIMARY", "SUBSTANTIAL"] as const)(
    "blocks %s renewal focus with no supporting evidence before generation",
    (prominence) => {
      const map = responsibilityMapWithRenewals(prominence, "OWNS", []);
      const candidate = {
        ...validOrganizationalMaturity(),
        customerOperatingModel: {
          classification: "HYBRID" as const,
          explanation: "The provider claims renewal focus without evidence.",
          evidenceReferences,
          substantialPatterns: ["ADOPTION_FOCUSED", "RENEWAL_FOCUSED"],
          semanticImpact: neutralMaturityImpact(),
          unknowns: [],
        },
      };
      expect(createSemanticOrganizationalMaturityTransportSchema(map).safeParse(candidate).success).toBe(false);
      expectNonRetryableEvidenceFailure(
        () => semanticOrganizationalMaturityFromTransport(candidate, availableEvidence, map),
        "ORGANIZATIONAL_MATURITY_OPERATING_MODEL_INVALID",
      );
    },
  );

  it("rejects the saved v4 failure combination at the request-specific provider boundary", () => {
    const candidate = {
      ...validOrganizationalMaturity(),
      score: 58,
      customerOperatingModel: {
        classification: "HYBRID" as const,
        explanation: "Repeatable adoption, education and enablement programs exist; renewals and implementation are not established.",
        evidenceReferences,
        substantialPatterns: ["ADOPTION_FOCUSED", "EDUCATION_FOCUSED", "ENABLEMENT_FOCUSED", "RENEWAL_FOCUSED"],
        semanticImpact: neutralMaturityImpact(),
        unknowns: [],
      },
    };
    expect(semanticOrganizationalMaturityTransportSchema.safeParse(candidate).success).toBe(true);
    expect(createSemanticOrganizationalMaturityTransportSchema(
      responsibilityMapWithRenewals("UNKNOWN"),
    ).safeParse(candidate).success).toBe(false);
  });

  it("preserves every unrelated pattern and the public domain shape", () => {
    const map = responsibilityMapWithRenewals("UNKNOWN");
    const schema = createSemanticOrganizationalMaturityTransportSchema(map);
    for (const pattern of customerOperatingModelSchema.options.filter(
      value => !["HYBRID", "UNKNOWN", "RENEWAL_FOCUSED"].includes(value),
    )) {
      const candidate = {
        ...validOrganizationalMaturity(),
        customerOperatingModel: {
          classification: pattern,
          explanation: "The non-renewal pattern retains its existing semantic interpretation.",
          evidenceReferences,
          substantialPatterns: [pattern],
          semanticImpact: neutralMaturityImpact(),
          unknowns: [],
        },
      };
      expect(semanticOrganizationalMaturityFromTransport(schema.parse(candidate), availableEvidence, map))
        .toEqual(semanticOrganizationalMaturityFromTransport(semanticOrganizationalMaturityTransportSchema.parse(candidate), availableEvidence, map));
    }
  });

  it("rejects RENEWAL_FOCUSED when renewal responsibility is Unknown", () => {
    const transport = validOrganizationalMaturity() as Record<string, any>;
    transport.customerOperatingModel = {
      classification: "HYBRID" as const,
      explanation: "The model combines adoption and renewal work.",
      evidenceReferences,
      substantialPatterns: ["ADOPTION_FOCUSED", "RENEWAL_FOCUSED"],
      semanticImpact: neutralMaturityImpact(),
      unknowns: [],
    };

    expectNonRetryableEvidenceFailure(
      () =>
        semanticOrganizationalMaturityFromTransport(
          transport,
          availableEvidence,
          responsibilityMapWithRenewals("UNKNOWN"),
        ),
      "ORGANIZATIONAL_MATURITY_OPERATING_MODEL_INVALID",
    );
  });

  it.each(["OWNS", "SHARES", "SUPPORTS", "COLLABORATES", "UNKNOWN"] as const)(
    "allows materially renewal-focused work with %s ownership",
    (ownership) => {
      const transport = validOrganizationalMaturity() as Record<string, any>;
      transport.customerOperatingModel = {
        classification: "RENEWAL_FOCUSED" as const,
        explanation: "Renewals are a substantial operating pattern.",
        evidenceReferences,
        substantialPatterns: ["RENEWAL_FOCUSED"],
        semanticImpact: neutralMaturityImpact(),
        unknowns: [],
      };

      const result = semanticOrganizationalMaturityFromTransport(
        transport,
        availableEvidence,
        responsibilityMapWithRenewals("SUBSTANTIAL", ownership),
      );
      expect(result.customerOperatingModel.classification).toBe(
        "RENEWAL_FOCUSED",
      );
    },
  );

  it.each(["SECONDARY", "OCCASIONAL", "ABSENT"] as const)(
    "rejects RENEWAL_FOCUSED when renewal prominence is only %s",
    (prominence) => {
      const transport = validOrganizationalMaturity() as Record<string, any>;
      transport.customerOperatingModel = {
        classification: "RENEWAL_FOCUSED" as const,
        explanation: "Renewals are claimed as the operating model.",
        evidenceReferences,
        substantialPatterns: ["RENEWAL_FOCUSED"],
        semanticImpact: neutralMaturityImpact(),
        unknowns: [],
      };
      expectNonRetryableEvidenceFailure(
        () =>
          semanticOrganizationalMaturityFromTransport(
            transport,
            availableEvidence,
            responsibilityMapWithRenewals(prominence, "SUPPORTS"),
          ),
        "ORGANIZATIONAL_MATURITY_OPERATING_MODEL_INVALID",
      );
    },
  );

  it("retains Organizational Maturity runtime validation as defense in depth", () => {
    const invalid = semanticOrganizationalMaturityFromTransport(
      validOrganizationalMaturity(),
      availableEvidence,
    );
    invalid.ownershipAndCrossFunctionalDesign.scopeCreep = {
      conclusion: null as never,
      unknown: false,
      evidenceReferences,
    };
    expect(semanticOrganizationalMaturitySchema.safeParse(invalid).success).toBe(
      false,
    );
  });

  it("converts transport evidence states into the unchanged domain representation", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.handoffs =
      unknownOwnershipDimension();
    transport.ownershipAndCrossFunctionalDesign.scopeCreep =
      supportedOwnershipDimension("SUPPORTED_ABSENT");

    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );

    expect(domain.ownershipAndCrossFunctionalDesign.handoffs).toEqual({
      conclusion: null,
      unknown: true,
      evidenceReferences: [],
    });
    expect(domain.ownershipAndCrossFunctionalDesign.roleBoundaries).toEqual({
      conclusion: "The boundary is supported.",
      unknown: false,
      evidenceReferences,
    });
    expect(domain.ownershipAndCrossFunctionalDesign.scopeCreep).toEqual({
      conclusion: "The boundary is supported.",
      unknown: false,
      evidenceReferences,
    });
  });

  it("keeps historical domain and persisted-result shapes readable without transport fields", () => {
    const domain = semanticOrganizationalMaturityFromTransport(
      validOrganizationalMaturity(),
      availableEvidence,
    );
    const historical = {
      evaluated: true as const,
      maturity: domain,
    };

    expect(organizationalMaturityDataSchema.parse(historical)).toEqual(
      historical,
    );
    expect(JSON.stringify(historical)).not.toContain("evidenceState");
    expect(
      historical.maturity.ownershipAndCrossFunctionalDesign.roleBoundaries,
    ).toHaveProperty("unknown", false);
  });

  it("accepts a structurally supported absence without inspecting its conclusion wording", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.handoffs = {
      ...supportedOwnershipDimension("SUPPORTED_ABSENT"),
      evidenceState: "SUPPORTED_ABSENT",
      conclusion: "Formal handoffs are not described.",
    };
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(transport).success,
    ).toBe(true);
    expect(
      semanticOrganizationalMaturityFromTransport(transport, availableEvidence)
        .ownershipAndCrossFunctionalDesign.handoffs,
    ).toEqual({
      conclusion: "Formal handoffs are not described.",
      unknown: false,
      evidenceReferences,
    });
  });

  it("preserves affirmative evidence of absence as a Known conclusion", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.unrealisticOwnership = {
      ...supportedOwnershipDimension("SUPPORTED_ABSENT"),
      evidenceState: "SUPPORTED_ABSENT",
      conclusion:
        "The posting explicitly assigns technical escalation ownership to Support, so the CS role does not own that function.",
    };
    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );
    expect(
      domain.ownershipAndCrossFunctionalDesign.unrealisticOwnership,
    ).toEqual({
      conclusion:
        "The posting explicitly assigns technical escalation ownership to Support, so the CS role does not own that function.",
      unknown: false,
      evidenceReferences,
    });
  });

  it("keeps missing handoff and unrealistic-ownership information Unknown", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.handoffs =
      unknownOwnershipDimension();
    transport.ownershipAndCrossFunctionalDesign.unrealisticOwnership =
      unknownOwnershipDimension();
    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );
    expect(domain.ownershipAndCrossFunctionalDesign.handoffs.unknown).toBe(true);
    expect(
      domain.ownershipAndCrossFunctionalDesign.unrealisticOwnership.unknown,
    ).toBe(true);
  });

  it("accepts an affirmatively supported structural weakness and restores the unchanged domain finding", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.scopeCreep =
      supportedOwnershipDimension("SUPPORTED_PRESENT");
    setMaturityAssessment(transport, "SCOPE_CREEP", weakMaturityImpact());

    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );

    expect(domain.weakSignals).toEqual([
      {
        finding:
          "The posting explicitly combines ownership across separate functions.",
        evidenceReferences,
      },
    ]);
    expect(JSON.stringify(domain)).not.toContain("SUPPORTED_WEAKNESS");
    expect(JSON.stringify(domain)).not.toContain("assessmentArea");
    expect(JSON.stringify(domain)).not.toContain(
      "affirmativeEvidenceReferences",
    );
  });

  it.each([
    ["HANDOFFS", "Formal handoffs are not described."],
    ["EXISTING_CS_FUNCTION", "Staffing and capacity are missing."],
    ["CUSTOMER_OPERATING_MODEL", "Operating metrics are not provided."],
    [
      "TEAM_BOUNDARIES",
      "Technical and implementation boundaries are not established.",
    ],
  ] as const)(
    "accepts %s weak signals whatever their finding wording",
    (assessmentArea, findingText) => {
      const transport = validOrganizationalMaturity();
      setMaturityAssessment(
        transport,
        assessmentArea,
        weakMaturityImpact(findingText),
      );
      expect(
        semanticOrganizationalMaturityTransportSchema.safeParse(transport)
          .success,
      ).toBe(true);
      expect(
        semanticOrganizationalMaturityFromTransport(transport, availableEvidence)
          .weakSignals,
      ).toContainEqual({ finding: findingText, evidenceReferences });
    },
  );

  it("keeps an unresolved fact only in Unknowns without creating a weak signal", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.handoffs =
      unknownOwnershipDimension();

    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );

    expect(domain.weakSignals).toEqual([]);
    expect(domain.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "maturity-information-unknown" }),
      ]),
    );
  });

  it("rejects a weak signal for an ownership dimension that is NOT_ESTABLISHED", () => {
    const transport = validOrganizationalMaturity();
    transport.ownershipAndCrossFunctionalDesign.handoffs =
      unknownOwnershipDimension();
    setMaturityAssessment(
      transport,
      "HANDOFFS",
      weakMaturityImpact(
        "The handoff process creates repeated ownership failures.",
      ),
    );
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(transport).success,
    ).toBe(false);
  });

  it("allows one source to support a weakness and a distinct contextual Unknown", () => {
    const transport = validOrganizationalMaturity();
    setMaturityAssessment(
      transport,
      "CUSTOMER_OPERATING_MODEL",
      weakMaturityImpact(
        "The documented operating process is internally inconsistent.",
        evidenceReferences,
      ),
      [{
        ...contextualMaturityUnknown(),
        evidenceReferences,
      }],
    );

    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );
    expect(domain.weakSignals).toEqual([
      {
        finding: "The documented operating process is internally inconsistent.",
        evidenceReferences,
      },
    ]);
    expect(domain.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "maturity-information-unknown" }),
      ]),
    );
  });

  it("allows a distinct evidenced weakness alongside a separate Unknown in the same criterion", () => {
    const transport = validOrganizationalMaturity();
    transport.customerOperatingModel.evidenceReferences = ["e1", "e2"];
    setMaturityAssessment(
      transport,
      "CUSTOMER_OPERATING_MODEL",
      weakMaturityImpact(
        "The posting explicitly assigns renewal accountability without a defined renewal process.",
        ["e2"],
      ),
      [{
        ...contextualMaturityUnknown(),
        evidenceReferences,
      }],
    );
    const domain = semanticOrganizationalMaturityFromTransport(transport, [
      ...availableEvidence,
      { referenceId: "e2", sourceType: "MANUAL" },
    ]);

    expect(domain.weakSignals[0]?.evidenceReferences).toEqual(["e2"]);
    expect(domain.unknowns[0]?.evidenceReferences).toEqual(evidenceReferences);
  });

  it("preserves valid Terra-style mixed output and supported positive signals", () => {
    const transport = validOrganizationalMaturity();
    transport.score = 56;
    transport.ownershipAndCrossFunctionalDesign.teamBoundaries =
      unknownOwnershipDimension();
    transport.ownershipAndCrossFunctionalDesign.handoffs =
      unknownOwnershipDimension();
    transport.ownershipAndCrossFunctionalDesign.teamBoundaries.unknowns = [
      contextualMaturityUnknown("team-boundaries-unknown"),
    ];
    transport.ownershipAndCrossFunctionalDesign.handoffs.unknowns = [
      contextualMaturityUnknown("handoffs-unknown"),
    ];

    const domain = semanticOrganizationalMaturityFromTransport(
      transport,
      availableEvidence,
    );

    expect(domain.score).toBe(56);
    expect(domain.positiveSignals).toEqual([finding]);
    expect(domain.weakSignals).toEqual([]);
    expect(domain.ownershipAndCrossFunctionalDesign.teamBoundaries.unknown).toBe(
      true,
    );
  });

  it("requires dimension-local weak signals to carry affirmative evidence", () => {
    const missingMetadata = validOrganizationalMaturity() as Record<string, any>;
    missingMetadata.ownershipAndCrossFunctionalDesign.scopeCreep.semanticImpact = {
      finding: "Missing discriminator.",
      affirmativeEvidenceReferences: evidenceReferences,
    };
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(missingMetadata)
        .success,
    ).toBe(false);

    const missingEvidence = validOrganizationalMaturity();
    setMaturityAssessment(
      missingEvidence,
      "SCOPE_CREEP",
      weakMaturityImpact("An affirmative weakness.", []),
    );
    expect(
      semanticOrganizationalMaturityTransportSchema.safeParse(missingEvidence)
        .success,
    ).toBe(false);
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
    const priority = validOpportunityPriorityTransport();
    priority.applicationEffort.evidenceIndexes = [];
    expect(
      semanticOpportunityPriorityTransportSchema.safeParse(priority).success,
    ).toBe(false);
    priority.applicationEffort = {
      classification: "UNKNOWN" as never,
      explanation: "Application effort is unknown.",
      evidenceIndexes: [],
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

  it.each([
    "postingTiming",
    "strategicBridgeValue",
    "alexFit",
    "burnoutRisk",
  ])("rejects the ordinary Opportunity Priority label %s as evidence", (label) => {
    const priority = validOpportunityPriorityTransport() as Record<string, any>;
    priority.scoreEvidenceIndexes = [label];
    expect(
      semanticOpportunityPriorityTransportSchema.safeParse(priority).success,
    ).toBe(false);
  });

  it("restores valid source and upstream-derived evidence indexes to Core evidence IDs", () => {
    const available = [
      { referenceId: "jd-evidence", sourceType: "JOB_DESCRIPTION" },
      { referenceId: "derived-stage-evidence", sourceType: "DERIVED" },
    ];
    const transport = validOpportunityPriorityTransport();
    transport.strategicValueEvidenceIndexes = [1];
    transport.evidenceIndexes = [0, 1];

    expect(opportunityPriorityEvidenceCatalog(available)).toEqual([
      { evidenceIndex: 0, ...available[0] },
      { evidenceIndex: 1, ...available[1] },
    ]);
    const expected = validOpportunityPriorityDomain();
    expected.scoreEvidenceReferences = ["jd-evidence"];
    expected.strategicValueEvidenceReferences = ["derived-stage-evidence"];
    expected.applicationEffort.evidenceReferences = ["jd-evidence"];
    expected.reasonsForPrioritization[0]!.evidenceReferences = ["jd-evidence"];
    expected.evidenceReferences = [
      "jd-evidence",
      "derived-stage-evidence",
    ];
    expect(
      semanticOpportunityPriorityFromTransport(transport, {
        availableEvidence: available,
        postingTimingEvidenceReferences: [],
      }),
    ).toEqual(expected);
  });

  it.each([
    [[2], "out-of-range"],
    [[0, 0], "duplicated"],
  ] as const)("rejects %s Opportunity Priority evidence indexes", (indexes) => {
    const transport = validOpportunityPriorityTransport();
    transport.scoreEvidenceIndexes = [...indexes];
    expectNonRetryableEvidenceFailure(
      () =>
        semanticOpportunityPriorityFromTransport(transport, {
          availableEvidence,
          postingTimingEvidenceReferences: [],
        }),
      "OPPORTUNITY_PRIORITY_EVIDENCE_INVALID",
    );
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
    const convertedMaturity = semanticOrganizationalMaturityFromTransport(
      validOrganizationalMaturity(),
      availableEvidence,
    );
    expect(semanticOrganizationalMaturitySchema.parse(convertedMaturity)).toEqual(
      convertedMaturity,
    );
    expect(
      convertedMaturity.ownershipAndCrossFunctionalDesign.roleBoundaries,
    ).toEqual({
      conclusion: "The boundary is supported.",
      unknown: false,
      evidenceReferences,
    });
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
      semanticOpportunityPriorityFromTransport(
        validOpportunityPriorityTransport(),
        {
        availableEvidence,
        postingTimingEvidenceReferences: [],
        },
      ),
    ).toEqual(validOpportunityPriorityDomain());
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
          semanticOpportunityPriorityFromTransport(validOpportunityPriorityTransport(), {
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
