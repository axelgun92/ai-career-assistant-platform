import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";
import type { AvailableSemanticEvidence } from "./semantic-contract";
import {
  assertSemanticEvidenceReferences,
  parseSemanticDomainResult,
  semanticContractViolation,
} from "./semantic-contract";
import { responsibilityMapSchema } from "./maps";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

export const customerSuccessOrganizationalMaturityPromptVersion =
  "cs-organizational-maturity-v5";

export const organizationalMaturityOperatingModelRules = {
  renewalFocused:
    "RENEWAL_FOCUSED means renewals are an affirmatively evidenced Primary or Substantial responsibility pattern. Renewal ownership is not required: owned, shared, supported, collaborative, or Unknown ownership may qualify when the responsibility prominence and its evidence establish material renewal involvement. Secondary, Occasional, Absent, or Unknown renewal prominence does not establish a renewal-focused operating model.",
} as const;

export const organizationalMaturityCalibration = {
  measure:
    "Organizational Maturity measures how established and well-structured the Customer Success operating environment appears across the existing CS function, customer operating model, and ownership and cross-functional design.",
  scoreDirection: "Higher scores mean greater organizational maturity.",
  excludedMeasures: [
    "company prestige",
    "culture",
    "management quality",
    "job fit",
    "organizational risk",
  ],
  bands: [
    {
      minimum: 0,
      maximum: 19,
      classification: "VERY_LOW",
      meaning:
        "Affirmative evidence of a substantially undeveloped function, operating model, and ownership design. Unknowns alone cannot justify this band.",
    },
    {
      minimum: 20,
      maximum: 39,
      classification: "LOW",
      meaning:
        "Emerging or weak operating design with supported structural weaknesses, despite limited positive signals.",
    },
    {
      minimum: 40,
      maximum: 59,
      classification: "MIXED_MODERATE",
      meaning:
        "Material strengths and weaknesses coexist, or important organizational-design information remains unresolved.",
    },
    {
      minimum: 60,
      maximum: 79,
      classification: "GOOD_HIGH",
      meaning:
        "A meaningfully developed and repeatable CS environment with substantially understandable ownership; weaknesses are bounded.",
    },
    {
      minimum: 80,
      maximum: 100,
      classification: "VERY_STRONG_VERY_HIGH",
      meaning:
        "Strong evidence across all three criteria: established function, repeatable operating model, and clear, realistic ownership and handoffs.",
    },
  ],
  unknownRules: [
    "Unknowns must not automatically lower the score.",
    "Unknowns must not automatically raise the score.",
    "Unknowns must not become zero, positive evidence, or negative evidence.",
    "Unknowns reduce completeness and may reduce confidence when material.",
  ],
  broadResponsibilityRules: [
    "Repeatable programs support the existence of an operating model.",
    "Breadth alone does not prove healthy maturity.",
    "Missing staffing, metrics, handoffs, capacity, or role and team boundaries remain Unknown.",
    "Breadth becomes negative only when evidence affirmatively establishes scope creep, combined jobs, or unrealistic ownership.",
  ],
  collaborationOwnershipRule:
    "Cross-functional collaboration must remain distinct from ownership of another function's work.",
  teamBoundariesRule:
    "Team boundaries require affirmative evidence of how responsibilities are divided between organizational teams or functions. A reporting line or collaboration with named functions alone does not establish team boundaries; explicit retained ownership, handoffs, or organizational separation may establish them.",
  weakSignalRules: [
    "Weak signals are affirmative evidence of an actual structural weakness, not missing or unresolved information.",
    "A weak signal must identify its assessment area and cite evidence that affirmatively supports the weakness.",
    "A fact classified as Unknown or NOT_ESTABLISHED must not also be a weak signal; missing information belongs only in Unknowns, while a distinct actual weakness requires separate affirmative evidence.",
  ],
  evidenceStates: {
    SUPPORTED_PRESENT:
      "Available evidence affirmatively supports that the assessed condition is present.",
    SUPPORTED_ABSENT:
      "Available evidence affirmatively supports that the assessed condition is absent; silence or missing information is not sufficient.",
    NOT_ESTABLISHED:
      "Available evidence does not establish whether the assessed condition is present or absent.",
  },
} as const;

const maturityBandDescriptions = organizationalMaturityCalibration.bands
  .map(
    (band) =>
      `${band.minimum}-${band.maximum} ${band.classification}: ${band.meaning}`,
  )
  .join(" ");

const organizationalMaturityScoreDescription = [
  organizationalMaturityCalibration.measure,
  organizationalMaturityCalibration.scoreDirection,
  maturityBandDescriptions,
  "These are semantic anchors, not weights or a mathematical formula.",
].join(" ");

export const organizationalMaturitySemanticInstructions = [
  "Assess the existing CS function, customer operating model, and ownership and cross-functional design from the validated maps and earlier results.",
  organizationalMaturityCalibration.measure,
  organizationalMaturityCalibration.scoreDirection,
  `Semantic score anchors: ${maturityBandDescriptions}`,
  `Unknown handling: ${organizationalMaturityCalibration.unknownRules.join(" ")}`,
  `Broad-responsibility interpretation: ${organizationalMaturityCalibration.broadResponsibilityRules.join(" ")}`,
  organizationalMaturityCalibration.collaborationOwnershipRule,
  organizationalMaturityCalibration.teamBoundariesRule,
  organizationalMaturityOperatingModelRules.renewalFocused,
  `Weak-signal handling: ${organizationalMaturityCalibration.weakSignalRules.join(" ")}`,
  `Evidence-state meanings: SUPPORTED_PRESENT means ${organizationalMaturityCalibration.evidenceStates.SUPPORTED_PRESENT} SUPPORTED_ABSENT means ${organizationalMaturityCalibration.evidenceStates.SUPPORTED_ABSENT} NOT_ESTABLISHED means ${organizationalMaturityCalibration.evidenceStates.NOT_ESTABLISHED}`,
  `Do not assess ${organizationalMaturityCalibration.excludedMeasures.join(", ")}. Do not use weights, keyword points, prestige, culture, management assumptions, or a mathematical scoring formula.`,
].join(" ");

export function organizationalMaturityBand(score: number) {
  const band = organizationalMaturityCalibration.bands.find(
    (candidate) => score >= candidate.minimum && score <= candidate.maximum,
  );
  if (!band) {
    throw new RangeError("Organizational Maturity score must be between 0 and 100");
  }
  return band.classification;
}

export const existingCustomerSuccessFunctionSchema = z.enum([
  "ESTABLISHED",
  "PARTIALLY_ESTABLISHED",
  "EMERGING",
  "BUILDING_FROM_SCRATCH",
  "UNKNOWN",
]);

export const customerOperatingModelSchema = z.enum([
  "STRATEGIC_CS",
  "ADOPTION_FOCUSED",
  "EDUCATION_FOCUSED",
  "ENABLEMENT_FOCUSED",
  "COMMERCIAL_CS",
  "RENEWAL_FOCUSED",
  "EXPANSION_FOCUSED",
  "IMPLEMENTATION_HEAVY",
  "TECHNICAL_CS",
  "SUPPORT_HEAVY",
  "HYBRID",
  "UNKNOWN",
]);

const substantialOperatingModelPatternSchema = customerOperatingModelSchema.exclude([
  "HYBRID",
  "UNKNOWN",
]);

const substantialOperatingModelPatternsSchema = z
  .array(substantialOperatingModelPatternSchema)
  .describe(organizationalMaturityOperatingModelRules.renewalFocused);

const maturityCriterionSchema = <T extends z.ZodEnum>(classification: T) =>
  z
    .object({
      classification,
      explanation: requiredText,
      evidenceReferences,
    })
    .strict()
    .superRefine((value, context) => {
      const assessed = value as {
        classification: string;
        evidenceReferences: string[];
      };
      if (
        assessed.classification !== "UNKNOWN" &&
        assessed.evidenceReferences.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidenceReferences"],
          message: "Known Organizational Maturity criteria require evidence",
        });
      }
    });

const ownershipDesignDimensionSchema = z
  .object({
    conclusion: optionalText,
    unknown: z.boolean(),
    evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.unknown && value.evidenceReferences.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known ownership-design conclusions require evidence",
      });
    }
    if (value.unknown && value.conclusion !== null) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "Unknown ownership-design conclusions must remain null",
      });
    }
    if (!value.unknown && value.conclusion === null) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "Known ownership-design conclusions must be present",
      });
    }
  });

export const ownershipAndCrossFunctionalDesignSchema = z
  .object({
    summary: requiredText,
    roleBoundaries: ownershipDesignDimensionSchema,
    teamBoundaries: ownershipDesignDimensionSchema,
    handoffs: ownershipDesignDimensionSchema,
    sharedOwnership: ownershipDesignDimensionSchema,
    crossFunctionalRelationships: ownershipDesignDimensionSchema,
    unrelatedResponsibilities: ownershipDesignDimensionSchema,
    scopeCreep: ownershipDesignDimensionSchema,
    multipleJobsCombined: ownershipDesignDimensionSchema,
    unrealisticOwnership: ownershipDesignDimensionSchema,
    evidenceReferences,
  })
  .strict();

export const semanticOrganizationalMaturitySchema = z
  .object({
    score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(organizationalMaturityScoreDescription),
    scoreExplanation: requiredText,
    scoreEvidenceReferences: evidenceReferences.min(1),
    existingCustomerSuccessFunction: maturityCriterionSchema(
      existingCustomerSuccessFunctionSchema,
    ),
    customerOperatingModel: maturityCriterionSchema(
      customerOperatingModelSchema,
    ).extend({
      substantialPatterns: substantialOperatingModelPatternsSchema,
    }).superRefine((value, context) => {
      if (
        value.classification === "HYBRID" &&
        value.substantialPatterns.length < 2
      ) {
        context.addIssue({
          code: "custom",
          path: ["substantialPatterns"],
          message: "Hybrid operating models require at least two substantial patterns",
        });
      }
      if (
        value.classification === "UNKNOWN" &&
        value.substantialPatterns.length > 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["substantialPatterns"],
          message: "Unknown operating models cannot assert substantial patterns",
        });
      }
    }),
    ownershipAndCrossFunctionalDesign:
      ownershipAndCrossFunctionalDesignSchema,
    summary: requiredText,
    positiveSignals: z.array(supportedAlignmentFindingSchema),
    weakSignals: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    evidenceReferences: evidenceReferences.min(1),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

const transportKnownMaturityCriterionSchema = <T extends z.ZodEnum>(
  classification: T,
) =>
  z
    .object({
      classification: classification.exclude(["UNKNOWN"]),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict();

const transportUnknownMaturityCriterionSchema = z
  .object({
    classification: z.literal("UNKNOWN"),
    explanation: requiredText,
    evidenceReferences,
  })
  .strict();

const transportExistingCustomerSuccessFunctionSchema = z.union([
  transportKnownMaturityCriterionSchema(existingCustomerSuccessFunctionSchema),
  transportUnknownMaturityCriterionSchema,
]);

const transportCustomerOperatingModelSchema = z.union([
  z
    .object({
      classification: customerOperatingModelSchema.exclude([
        "HYBRID",
        "UNKNOWN",
      ]),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
      substantialPatterns: substantialOperatingModelPatternsSchema,
    })
    .strict(),
  z
    .object({
      classification: z.literal("HYBRID"),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
      substantialPatterns: substantialOperatingModelPatternsSchema.min(2),
    })
    .strict(),
  z
    .object({
      classification: z.literal("UNKNOWN"),
      explanation: requiredText,
      evidenceReferences,
      substantialPatterns: substantialOperatingModelPatternsSchema.max(0),
    })
    .strict(),
]);

export const organizationalMaturityEvidenceStateSchema = z.enum([
  "SUPPORTED_PRESENT",
  "SUPPORTED_ABSENT",
  "NOT_ESTABLISHED",
]);

export const organizationalMaturityAssessmentAreaSchema = z.enum([
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
]);

const transportOwnershipDesignDimensionSchema = z.union([
  z
    .object({
      evidenceState: z
        .literal("SUPPORTED_PRESENT")
        .describe(
          organizationalMaturityCalibration.evidenceStates.SUPPORTED_PRESENT,
        ),
      conclusion: requiredText.describe(
        "A conclusion affirmatively supported by the cited evidence; it must not describe missing, unclear, or unavailable information.",
      ),
      evidenceReferences: evidenceReferences.min(1).describe(
        "At least one resolvable evidence reference affirmatively supporting presence.",
      ),
    })
    .strict(),
  z
    .object({
      evidenceState: z
        .literal("SUPPORTED_ABSENT")
        .describe(
          organizationalMaturityCalibration.evidenceStates.SUPPORTED_ABSENT,
        ),
      conclusion: requiredText.describe(
        "A negative conclusion affirmatively supported by cited evidence; source silence or a statement that information is not described is not affirmative absence evidence.",
      ),
      evidenceReferences: evidenceReferences.min(1).describe(
        "At least one resolvable evidence reference affirmatively supporting absence.",
      ),
    })
    .strict(),
  z
    .object({
      evidenceState: z
        .literal("NOT_ESTABLISHED")
        .describe(
          organizationalMaturityCalibration.evidenceStates.NOT_ESTABLISHED,
        ),
      conclusion: z.null().describe(
        "Must remain null because the available evidence establishes neither presence nor absence.",
      ),
      evidenceReferences: evidenceReferences.describe(
        "Optional references explaining why the dimension remains unresolved; they must not be treated as positive or negative evidence.",
      ),
    })
    .strict(),
]);

const transportWeakMaturitySignalSchema = z
  .object({
    assessmentArea: organizationalMaturityAssessmentAreaSchema.describe(
      "The Organizational Maturity criterion or ownership-design dimension that this affirmative weakness assesses.",
    ),
    evidenceState: z.literal("SUPPORTED_WEAKNESS").describe(
      "The cited evidence affirmatively supports an actual structural weakness; missing, unclear, or unreported information is not a supported weakness.",
    ),
    finding: requiredText.describe(
      "An affirmatively evidenced structural weakness. Do not describe information as missing, not described, not established, unclear, or Unknown.",
    ),
    affirmativeEvidenceReferences: evidenceReferences.min(1).describe(
      "At least one resolvable evidence reference that affirmatively supports the weakness, not merely the absence of information.",
    ),
  })
  .strict();

const transportMaturityUnknownSchema = z
  .object({
    ...companyAlignmentUnknownSchema.shape,
    assessmentArea: organizationalMaturityAssessmentAreaSchema.describe(
      "The Organizational Maturity criterion or ownership-design dimension whose evidence remains insufficient.",
    ),
  })
  .strict();

const semanticOrganizationalMaturityTransportShape = {
  ...semanticOrganizationalMaturitySchema.shape,
  existingCustomerSuccessFunction:
    transportExistingCustomerSuccessFunctionSchema,
  customerOperatingModel: transportCustomerOperatingModelSchema,
  ownershipAndCrossFunctionalDesign: z
    .object({
      summary: requiredText,
      roleBoundaries: transportOwnershipDesignDimensionSchema,
      teamBoundaries: transportOwnershipDesignDimensionSchema.describe(
        organizationalMaturityCalibration.teamBoundariesRule,
      ),
      handoffs: transportOwnershipDesignDimensionSchema,
      sharedOwnership: transportOwnershipDesignDimensionSchema,
      crossFunctionalRelationships: transportOwnershipDesignDimensionSchema,
      unrelatedResponsibilities: transportOwnershipDesignDimensionSchema,
      scopeCreep: transportOwnershipDesignDimensionSchema,
      multipleJobsCombined: transportOwnershipDesignDimensionSchema,
      unrealisticOwnership: transportOwnershipDesignDimensionSchema,
      evidenceReferences,
    })
    .strict(),
  weakSignals: z
    .array(transportWeakMaturitySignalSchema)
    .describe(organizationalMaturityCalibration.weakSignalRules.join(" ")),
  unknowns: z.array(transportMaturityUnknownSchema),
};

export const semanticOrganizationalMaturityTransportSchema = z
  .object(semanticOrganizationalMaturityTransportShape)
  .strict();

type ResponsibilityMap = z.infer<typeof responsibilityMapSchema>;

function hasMaterialRenewalResponsibility(responsibilityMap: ResponsibilityMap) {
  const renewal = responsibilityMap.areas.renewals;
  return Boolean(
    renewal &&
      ["PRIMARY", "SUBSTANTIAL"].includes(renewal.prominence) &&
      renewal.evidenceReferences.length > 0,
  );
}

const nonRenewalPatternsSchema = z
  .array(substantialOperatingModelPatternSchema.exclude(["RENEWAL_FOCUSED"]))
  .describe(organizationalMaturityOperatingModelRules.renewalFocused);

const nonRenewalMaturityTransportSchema =
  semanticOrganizationalMaturityTransportSchema.extend({
    customerOperatingModel: z.union([
      transportCustomerOperatingModelSchema.options[0].extend({
        classification:
          transportCustomerOperatingModelSchema.options[0].shape.classification.exclude([
            "RENEWAL_FOCUSED",
          ]),
        substantialPatterns: nonRenewalPatternsSchema,
      }),
      transportCustomerOperatingModelSchema.options[1].extend({
        substantialPatterns: nonRenewalPatternsSchema.min(2),
      }),
      transportCustomerOperatingModelSchema.options[2].extend({
        substantialPatterns: nonRenewalPatternsSchema.max(0),
      }),
    ]),
  });

export function createSemanticOrganizationalMaturityTransportSchema(
  responsibilityMap: ResponsibilityMap,
) {
  // Resolve the input-dependent rule before generation. Other patterns retain
  // their existing semantic meaning and choice space; ownership is not a gate.
  return hasMaterialRenewalResponsibility(responsibilityMap)
    ? semanticOrganizationalMaturityTransportSchema
    : nonRenewalMaturityTransportSchema;
}

export function assertCustomerOperatingModelResponsibilitySupport(
  operatingModel: {
    classification: z.infer<typeof customerOperatingModelSchema>;
    substantialPatterns: z.infer<typeof substantialOperatingModelPatternSchema>[];
  },
  responsibilityMap: ResponsibilityMap,
) {
  const assertsRenewalFocus =
    operatingModel.classification === "RENEWAL_FOCUSED" ||
    operatingModel.substantialPatterns.includes("RENEWAL_FOCUSED");
  if (!assertsRenewalFocus) return;

  if (!hasMaterialRenewalResponsibility(responsibilityMap)) {
    semanticContractViolation(
      "ORGANIZATIONAL_MATURITY_OPERATING_MODEL_INVALID",
      "Renewal-focused operating models require affirmative evidence of material renewal responsibility",
    );
  }
}

export function semanticOrganizationalMaturityFromTransport(
  value: z.input<typeof semanticOrganizationalMaturityTransportSchema>,
  availableEvidence: AvailableSemanticEvidence[],
  responsibilityMap?: ResponsibilityMap,
) {
  const transport = semanticOrganizationalMaturityTransportSchema.parse(value);
  if (
    transport.customerOperatingModel.classification === "RENEWAL_FOCUSED" ||
    transport.customerOperatingModel.substantialPatterns.includes(
      "RENEWAL_FOCUSED",
    )
  ) {
    if (!responsibilityMap) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_OPERATING_MODEL_INVALID",
        "Renewal-focused operating models require the authoritative Responsibility Map",
      );
    }
    assertCustomerOperatingModelResponsibilitySupport(
      transport.customerOperatingModel,
      responsibilityMap,
    );
  }
  const transportDesign = transport.ownershipAndCrossFunctionalDesign;
  const missingInformationConclusion =
    /\b(?:missing|not (?:described|stated|specified|provided|available|established|evidenced)|no (?:evidence|information|details?|description|mention)|absence of (?:evidence|information|details?|description)|insufficient (?:evidence|information)|unclear|unknown|cannot (?:determine|establish)|could not (?:determine|establish))\b/i;
  const toDomainDimension = (
    dimension: z.infer<typeof transportOwnershipDesignDimensionSchema>,
  ) => {
    if (dimension.evidenceState === "NOT_ESTABLISHED") {
      return {
        conclusion: null,
        unknown: true as const,
        evidenceReferences: dimension.evidenceReferences,
      };
    }
    if (missingInformationConclusion.test(dimension.conclusion)) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_EVIDENCE_STATE_INVALID",
        "Supported Organizational Maturity conclusions cannot be based on missing information",
      );
    }
    return {
      conclusion: dimension.conclusion,
      unknown: false as const,
      evidenceReferences: dimension.evidenceReferences,
    };
  };
  const convertedDimensions = {
    roleBoundaries: toDomainDimension(transportDesign.roleBoundaries),
    teamBoundaries: toDomainDimension(transportDesign.teamBoundaries),
    handoffs: toDomainDimension(transportDesign.handoffs),
    sharedOwnership: toDomainDimension(transportDesign.sharedOwnership),
    crossFunctionalRelationships: toDomainDimension(
      transportDesign.crossFunctionalRelationships,
    ),
    unrelatedResponsibilities: toDomainDimension(
      transportDesign.unrelatedResponsibilities,
    ),
    scopeCreep: toDomainDimension(transportDesign.scopeCreep),
    multipleJobsCombined: toDomainDimension(
      transportDesign.multipleJobsCombined,
    ),
    unrealisticOwnership: toDomainDimension(
      transportDesign.unrealisticOwnership,
    ),
  };
  const ownershipDimensionByAssessmentArea = {
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
  for (const signal of transport.weakSignals) {
    if (missingInformationConclusion.test(signal.finding)) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_WEAK_SIGNAL_INVALID",
        "Organizational Maturity weak signals require affirmative evidence of an actual weakness",
      );
    }
    const dimensionKey =
      ownershipDimensionByAssessmentArea[
        signal.assessmentArea as keyof typeof ownershipDimensionByAssessmentArea
      ];
    if (
      dimensionKey &&
      transportDesign[dimensionKey].evidenceState === "NOT_ESTABLISHED"
    ) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_WEAK_SIGNAL_INVALID",
        "A NOT_ESTABLISHED ownership dimension cannot also be a weak signal",
      );
    }
    const relatedUnknownReferences = new Set(
      transport.unknowns
        .filter(
          (unknown) => unknown.assessmentArea === signal.assessmentArea,
        )
        .flatMap((unknown) => unknown.evidenceReferences),
    );
    if (
      relatedUnknownReferences.size > 0 &&
      signal.affirmativeEvidenceReferences.every((reference) =>
        relatedUnknownReferences.has(reference),
      )
    ) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_WEAK_SIGNAL_INVALID",
        "The same unresolved evidence cannot also support a weak signal",
      );
    }
  }
  const convertedWeakSignals = transport.weakSignals.map((signal) => ({
    finding: signal.finding,
    evidenceReferences: signal.affirmativeEvidenceReferences,
  }));
  const convertedUnknowns = transport.unknowns.map(
    ({ assessmentArea: _assessmentArea, ...unknown }) => unknown,
  );
  const dimensionLabels: Record<keyof typeof convertedDimensions, string> = {
    roleBoundaries: "Role boundaries",
    teamBoundaries: "Team boundaries",
    handoffs: "Formal handoff design",
    sharedOwnership: "Shared ownership design",
    crossFunctionalRelationships: "Cross-functional relationship design",
    unrelatedResponsibilities: "Unrelated-responsibility ownership",
    scopeCreep: "Scope-creep presence or absence",
    multipleJobsCombined: "Multiple-jobs-combined presence or absence",
    unrealisticOwnership: "Unrealistic-ownership presence or absence",
  };
  const dimensionCodes: Record<keyof typeof convertedDimensions, string> = {
    roleBoundaries: "role-boundaries",
    teamBoundaries: "team-boundaries",
    handoffs: "handoffs",
    sharedOwnership: "shared-ownership",
    crossFunctionalRelationships: "cross-functional-relationships",
    unrelatedResponsibilities: "unrelated-responsibilities",
    scopeCreep: "scope-creep",
    multipleJobsCombined: "multiple-jobs-combined",
    unrealisticOwnership: "unrealistic-ownership",
  };
  const existingUnknownCodes = new Set(
    convertedUnknowns.map((unknown) => unknown.code),
  );
  const dimensionUnknowns = (
    Object.entries(convertedDimensions) as Array<
      [keyof typeof convertedDimensions, (typeof convertedDimensions)[keyof typeof convertedDimensions]]
    >
  )
    .filter(([, dimension]) => dimension.unknown)
    .map(([key, dimension]) => ({
      code: `organizational-maturity-${dimensionCodes[key]}-not-established`,
      description: `${dimensionLabels[key]} is not established by the available evidence.`,
      materiality:
        "This limits completeness of the ownership and cross-functional design assessment.",
      evidenceReferences: dimension.evidenceReferences,
    }))
    .filter((unknown) => !existingUnknownCodes.has(unknown.code));
  const result = parseSemanticDomainResult({
    schema: semanticOrganizationalMaturitySchema,
    value: {
      ...transport,
      ownershipAndCrossFunctionalDesign: {
        summary: transportDesign.summary,
        ...convertedDimensions,
        evidenceReferences: transportDesign.evidenceReferences,
      },
      weakSignals: convertedWeakSignals,
      unknowns: [...convertedUnknowns, ...dimensionUnknowns],
    },
    code: "ORGANIZATIONAL_MATURITY_DOMAIN_INVALID",
    message: "Organizational Maturity violated the domain contract",
  });
  const design = result.ownershipAndCrossFunctionalDesign;
  assertSemanticEvidenceReferences({
    references: [
      ...result.scoreEvidenceReferences,
      ...result.existingCustomerSuccessFunction.evidenceReferences,
      ...result.customerOperatingModel.evidenceReferences,
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
      ...result.evidenceReferences,
      ...result.positiveSignals.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.weakSignals.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.unknowns.flatMap((unknown) => unknown.evidenceReferences),
      ...result.contradictions.flatMap((contradiction) => [
        ...contradiction.evidenceReferencesA,
        ...contradiction.evidenceReferencesB,
      ]),
    ],
    availableEvidence,
    code: "ORGANIZATIONAL_MATURITY_EVIDENCE_INVALID",
    message: "Organizational Maturity references unavailable evidence",
  });
  return result;
}

export const organizationalMaturityDataSchema = z.discriminatedUnion(
  "evaluated",
  [
    z
      .object({
        evaluated: z.literal(false),
        reason: requiredText,
      })
      .strict(),
    z
      .object({
        evaluated: z.literal(true),
        maturity: semanticOrganizationalMaturitySchema,
      })
      .strict(),
  ],
);

export type SemanticOrganizationalMaturity = z.infer<
  typeof semanticOrganizationalMaturitySchema
>;
export type OrganizationalMaturityData = z.infer<
  typeof organizationalMaturityDataSchema
>;
