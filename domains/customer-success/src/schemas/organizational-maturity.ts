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
import {
  ownershipFunctions,
  ownershipMapSchema,
  responsibilityMapSchema,
} from "./maps";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

export const customerSuccessOrganizationalMaturityPromptVersion =
  "cs-organizational-maturity-v7";

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
  functionalOwnershipRule:
    "Ownership of functional work does not establish a separate collaborating team or stakeholder of the same name. Use the authoritative crossFunctionalRelationshipCatalog for named relationships, not OWNS or UNCLEAR_BOUNDARIES entries. Education, Marketing, or any other owned work may still support responsibility and operating-model conclusions. Preserve the catalog's distinctions between collaboration, shared work, and handoffs; do not infer healthy boundaries from a relationship's existence.",
  teamBoundariesRule:
    "Team boundaries require affirmative evidence of how responsibilities are divided between organizational teams or functions. A reporting line or collaboration with named functions alone does not establish team boundaries; explicit retained ownership, handoffs, or organizational separation may establish them.",
  weakSignalRules: [
    "Weak signals are affirmative evidence of an actual structural weakness, not missing or unresolved information.",
    "A weak signal must identify its assessment area and cite evidence that affirmatively supports the weakness.",
    "A fact classified as Unknown or NOT_ESTABLISHED must not also be a weak signal; missing information belongs only in Unknowns, while a distinct actual weakness requires separate affirmative evidence.",
  ],
  semanticImpactRules: [
    "Unknown is neutral: missing information is neither strength nor weakness.",
    "SUPPORTED_POSITIVE requires affirmative evidence of an actual maturity strength.",
    "SUPPORTED_WEAKNESS requires affirmative evidence of an actual structural weakness.",
    "NEUTRAL means the dimension is established but is neither a maturity strength nor a structural weakness.",
    "NOT_ESTABLISHED means unresolved and cannot carry positive or weak semantic impact.",
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
  organizationalMaturityCalibration.functionalOwnershipRule,
  organizationalMaturityCalibration.teamBoundariesRule,
  organizationalMaturityOperatingModelRules.renewalFocused,
  `Weak-signal handling: ${organizationalMaturityCalibration.weakSignalRules.join(" ")}`,
  `Dimension-local impact handling: ${organizationalMaturityCalibration.semanticImpactRules.join(" ")}`,
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

const transportMaturityUnknownSchema = companyAlignmentUnknownSchema;

const transportKnownMaturityImpactSchema = z.union([
  z
    .object({
      impact: z.literal("SUPPORTED_POSITIVE"),
      finding: requiredText.describe(
        "An affirmatively evidenced maturity strength. Missing, unclear, or unreported information is not a strength.",
      ),
      affirmativeEvidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      impact: z.literal("SUPPORTED_WEAKNESS"),
      finding: requiredText.describe(
        "An affirmatively evidenced structural weakness. Missing, unclear, or unreported information is not a weakness.",
      ),
      affirmativeEvidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      impact: z.literal("NEUTRAL"),
      finding: z.null(),
      affirmativeEvidenceReferences: evidenceReferences.max(0),
    })
    .strict(),
]).describe([
  ...organizationalMaturityCalibration.weakSignalRules,
  ...organizationalMaturityCalibration.semanticImpactRules,
].join(" "));

const transportNotEstablishedMaturityImpactSchema = z
  .object({
    impact: z.literal("NOT_ESTABLISHED"),
    finding: z.null(),
    affirmativeEvidenceReferences: evidenceReferences.max(0),
  })
  .strict();

const transportKnownMaturityAssessmentShape = {
  semanticImpact: transportKnownMaturityImpactSchema,
  unknowns: z.array(transportMaturityUnknownSchema),
};

const transportNotEstablishedMaturityAssessmentShape = {
  semanticImpact: transportNotEstablishedMaturityImpactSchema,
  unknowns: z.array(transportMaturityUnknownSchema).min(1),
};

const missingInformationLanguage =
  /\b(?:missing|not (?:described|stated|specified|provided|available|established|evidenced)|no (?:evidence|information|details?|description|mention)|absence of (?:evidence|information|details?|description)|insufficient (?:evidence|information)|unclear|unknown|cannot (?:determine|establish)|could not (?:determine|establish))\b/i;

const semanticComparisonStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but",
  "by", "can", "does", "for", "from", "has", "have", "in", "is", "it",
  "its", "of", "on", "or", "that", "the", "their", "there", "this", "to",
  "was", "were", "with", "without", "work", "information", "evidence",
  "detail", "details", "description", "described", "stated", "specified",
  "provided", "available", "established", "evidenced", "missing", "unclear",
  "unknown", "clear", "known", "not", "no", "absence", "insufficient",
  "cannot", "could", "determine", "remain", "remains",
]);

function maturityStatementClauses(value: string) {
  return value
    .split(/(?:[.;!?]+|\b(?:although|however|whereas|while)\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function maturitySemanticTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((token) =>
        token.length > 4 && token.endsWith("ies")
          ? `${token.slice(0, -3)}y`
          : token.length > 3 && token.endsWith("s")
            ? token.slice(0, -1)
            : token,
      )
      .filter(
        (token) => token.length > 2 && !semanticComparisonStopWords.has(token),
      ),
  );
}

function materiallySameMaturityProposition(left: string, right: string) {
  const leftTokens = maturitySemanticTokens(left);
  const rightTokens = maturitySemanticTokens(right);
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  if (smallerSize < 2) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap >= 2 && overlap / smallerSize >= 0.8;
}

function contextualUnknownCoversMaturityClause(
  unresolvedClause: string,
  unknownDescription: string,
) {
  const clauseTokens = maturitySemanticTokens(unresolvedClause);
  const unknownTokens = maturitySemanticTokens(unknownDescription);
  const smallerSize = Math.min(clauseTokens.size, unknownTokens.size);
  if (smallerSize < 2) return false;
  const overlap = [...clauseTokens].filter((token) =>
    unknownTokens.has(token),
  ).length;
  return overlap >= 2 && overlap / smallerSize >= 0.4;
}

type MaturityAssessmentConsistencyInput = {
  assessmentArea: string;
  evidenceState: "SUPPORTED_PRESENT" | "SUPPORTED_ABSENT" | "NOT_ESTABLISHED";
  statement: string | null;
  evidenceReferences: string[];
  semanticImpact: {
    impact:
      | "SUPPORTED_POSITIVE"
      | "SUPPORTED_WEAKNESS"
      | "NEUTRAL"
      | "NOT_ESTABLISHED";
    finding: string | null;
    affirmativeEvidenceReferences: string[];
  };
  unknowns: Array<z.infer<typeof transportMaturityUnknownSchema>>;
};

function assertMaturityAssessmentConsistency({
  assessmentArea,
  evidenceState,
  statement,
  evidenceReferences: assessmentEvidenceReferences,
  semanticImpact,
  unknowns,
}: MaturityAssessmentConsistencyInput) {
  if (evidenceState === "NOT_ESTABLISHED") return;
  if (statement === null) {
    semanticContractViolation(
      "ORGANIZATIONAL_MATURITY_EVIDENCE_STATE_INVALID",
      "Supported Organizational Maturity conclusions must be present",
    );
  }

  const clauses = maturityStatementClauses(statement);
  const unresolvedClauses = clauses.filter((clause) =>
    missingInformationLanguage.test(clause),
  );
  const supportedClauses = clauses.filter(
    (clause) => !missingInformationLanguage.test(clause),
  );
  if (unresolvedClauses.length > 0) {
    if (unknowns.length === 0) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_MIXED_STATE_INVALID",
        "Unresolved Organizational Maturity details must be represented as contextual Unknowns",
      );
    }
    if (supportedClauses.length === 0) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_EVIDENCE_STATE_INVALID",
        "Supported Organizational Maturity conclusions cannot consist only of missing information",
      );
    }
    for (const unresolvedClause of unresolvedClauses) {
      if (
        !unknowns.some((unknown) =>
          contextualUnknownCoversMaturityClause(
            unresolvedClause,
            unknown.description,
          ),
        )
      ) {
        semanticContractViolation(
          "ORGANIZATIONAL_MATURITY_MIXED_STATE_INVALID",
          `Every unresolved ${assessmentArea} sub-detail must have a matching contextual Unknown`,
        );
      }
    }
  }

  if (
    semanticImpact.impact === "SUPPORTED_POSITIVE" ||
    semanticImpact.impact === "SUPPORTED_WEAKNESS"
  ) {
    if (
      semanticImpact.finding === null ||
      missingInformationLanguage.test(semanticImpact.finding)
    ) {
      semanticContractViolation(
        semanticImpact.impact === "SUPPORTED_POSITIVE"
          ? "ORGANIZATIONAL_MATURITY_POSITIVE_SIGNAL_INVALID"
          : "ORGANIZATIONAL_MATURITY_WEAK_SIGNAL_INVALID",
        semanticImpact.impact === "SUPPORTED_POSITIVE"
          ? "Organizational Maturity positive signals require affirmative evidence of an actual strength"
          : "Organizational Maturity weak signals require affirmative evidence of an actual weakness",
      );
    }
    const assessmentEvidence = new Set(assessmentEvidenceReferences);
    if (
      semanticImpact.affirmativeEvidenceReferences.some(
        (reference) => !assessmentEvidence.has(reference),
      )
    ) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_IMPACT_EVIDENCE_INVALID",
        "Organizational Maturity impact evidence must belong to its assessment evidence",
      );
    }
  }

  const supportedPropositions =
    semanticImpact.impact === "SUPPORTED_POSITIVE" ||
    semanticImpact.impact === "SUPPORTED_WEAKNESS"
      ? [semanticImpact.finding!]
      : supportedClauses;
  for (const unknown of unknowns) {
    if (
      supportedPropositions.some((supportedProposition) =>
        materiallySameMaturityProposition(
          supportedProposition,
          unknown.description,
        ),
      )
    ) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_MIXED_STATE_INVALID",
        `A contextual Unknown cannot contradict the supported ${assessmentArea} proposition`,
      );
    }
  }
}

const transportKnownMaturityCriterionSchema = <T extends z.ZodEnum>(
  classification: T,
) =>
  z
    .object({
      classification: classification.exclude(["UNKNOWN"]),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
      ...transportKnownMaturityAssessmentShape,
    })
    .strict();

const transportUnknownMaturityCriterionSchema = z
  .object({
    classification: z.literal("UNKNOWN"),
    explanation: requiredText,
    evidenceReferences,
    ...transportNotEstablishedMaturityAssessmentShape,
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
      ...transportKnownMaturityAssessmentShape,
    })
    .strict(),
  z
    .object({
      classification: z.literal("HYBRID"),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
      substantialPatterns: substantialOperatingModelPatternsSchema.min(2),
      ...transportKnownMaturityAssessmentShape,
    })
    .strict(),
  z
    .object({
      classification: z.literal("UNKNOWN"),
      explanation: requiredText,
      evidenceReferences,
      substantialPatterns: substantialOperatingModelPatternsSchema.max(0),
      ...transportNotEstablishedMaturityAssessmentShape,
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
      ...transportKnownMaturityAssessmentShape,
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
      ...transportKnownMaturityAssessmentShape,
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
      ...transportNotEstablishedMaturityAssessmentShape,
    })
    .strict(),
]);

const legacyTransportWeakMaturitySignalSchema = z
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

const legacyTransportMaturityUnknownSchema = z
  .object({
    ...companyAlignmentUnknownSchema.shape,
    assessmentArea: organizationalMaturityAssessmentAreaSchema.describe(
      "The Organizational Maturity criterion or ownership-design dimension whose evidence remains insufficient.",
    ),
  })
  .strict();

const semanticOrganizationalMaturityTransportShape = {
  ...semanticOrganizationalMaturitySchema.omit({
    positiveSignals: true,
    weakSignals: true,
    unknowns: true,
  }).shape,
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
};

export const semanticOrganizationalMaturityTransportSchema = z
  .object(semanticOrganizationalMaturityTransportShape)
  .strict();

const legacyTransportOwnershipDesignDimensionSchema = z.union([
  z.object({
    evidenceState: z.literal("SUPPORTED_PRESENT"),
    conclusion: requiredText,
    evidenceReferences: evidenceReferences.min(1),
  }).strict(),
  z.object({
    evidenceState: z.literal("SUPPORTED_ABSENT"),
    conclusion: requiredText,
    evidenceReferences: evidenceReferences.min(1),
  }).strict(),
  z.object({
    evidenceState: z.literal("NOT_ESTABLISHED"),
    conclusion: z.null(),
    evidenceReferences,
  }).strict(),
]);

// Historical raw responses remain replayable offline. Production generation
// uses only semanticOrganizationalMaturityTransportSchema above.
const legacySemanticOrganizationalMaturityTransportSchema = z
  .object({
    ...semanticOrganizationalMaturitySchema.shape,
    existingCustomerSuccessFunction: z.union([
      z.object({
        classification: existingCustomerSuccessFunctionSchema.exclude(["UNKNOWN"]),
        explanation: requiredText,
        evidenceReferences: evidenceReferences.min(1),
      }).strict(),
      z.object({
        classification: z.literal("UNKNOWN"),
        explanation: requiredText,
        evidenceReferences,
      }).strict(),
    ]),
    customerOperatingModel: z.union([
      z.object({
        classification: customerOperatingModelSchema.exclude(["HYBRID", "UNKNOWN"]),
        explanation: requiredText,
        evidenceReferences: evidenceReferences.min(1),
        substantialPatterns: substantialOperatingModelPatternsSchema,
      }).strict(),
      z.object({
        classification: z.literal("HYBRID"),
        explanation: requiredText,
        evidenceReferences: evidenceReferences.min(1),
        substantialPatterns: substantialOperatingModelPatternsSchema.min(2),
      }).strict(),
      z.object({
        classification: z.literal("UNKNOWN"),
        explanation: requiredText,
        evidenceReferences,
        substantialPatterns: substantialOperatingModelPatternsSchema.max(0),
      }).strict(),
    ]),
    ownershipAndCrossFunctionalDesign: z.object({
      summary: requiredText,
      roleBoundaries: legacyTransportOwnershipDesignDimensionSchema,
      teamBoundaries: legacyTransportOwnershipDesignDimensionSchema,
      handoffs: legacyTransportOwnershipDesignDimensionSchema,
      sharedOwnership: legacyTransportOwnershipDesignDimensionSchema,
      crossFunctionalRelationships: legacyTransportOwnershipDesignDimensionSchema,
      unrelatedResponsibilities: legacyTransportOwnershipDesignDimensionSchema,
      scopeCreep: legacyTransportOwnershipDesignDimensionSchema,
      multipleJobsCombined: legacyTransportOwnershipDesignDimensionSchema,
      unrealisticOwnership: legacyTransportOwnershipDesignDimensionSchema,
      evidenceReferences,
    }).strict(),
    weakSignals: z.array(legacyTransportWeakMaturitySignalSchema),
    unknowns: z.array(legacyTransportMaturityUnknownSchema),
  })
  .strict();

const relationshipDescriptions = {
  SHARES: "shares work with",
  COLLABORATES: "collaborates with",
  HANDS_OFF_TO: "hands off to",
  RECEIVES_FROM: "receives work from",
} as const;

const functionLabels = {
  customerSuccess: "Customer Success",
  sales: "Sales",
  support: "Support",
  product: "Product",
  implementation: "Implementation",
  education: "Education",
  community: "Community",
  marketing: "Marketing",
  projectManagement: "Project Management",
} as const;

// The Responsibility Map can describe owned Education work while the Ownership
// Map independently records collaboration with Education. OWNS alone is not a
// relationship with another team. Do not reinterpret raw JD prose here.
export function organizationalMaturityRelationshipCatalog(
  ownershipMap: z.infer<typeof ownershipMapSchema>,
  availableEvidence: AvailableSemanticEvidence[],
) {
  const map = ownershipMapSchema.parse(ownershipMap);
  return ownershipFunctions.flatMap((functionName) => {
    const entry = map.functions[functionName];
    if (
      !entry ||
      entry.relationship === "OWNS" ||
      entry.relationship === "UNCLEAR_BOUNDARIES"
    ) return [];
    assertSemanticEvidenceReferences({
      references: entry.evidenceReferences,
      availableEvidence,
      code: "ORGANIZATIONAL_MATURITY_RELATIONSHIP_EVIDENCE_INVALID",
      message: "Cross-functional relationships require available authoritative relationship evidence",
    });
    return [{
      function: functionName,
      relationship: entry.relationship,
      evidenceReferences: [...new Set(entry.evidenceReferences)],
    }];
  });
}

type RelationshipCatalog = ReturnType<
  typeof organizationalMaturityRelationshipCatalog
>;

export function organizationalMaturityRelationshipTransport(
  catalog: RelationshipCatalog,
) {
  if (catalog.length === 0) return {
    evidenceState: "NOT_ESTABLISHED" as const,
    conclusion: null,
    evidenceReferences: [] as string[],
  };
  const relationships = catalog.map((entry) =>
    `${relationshipDescriptions[entry.relationship]} ${functionLabels[entry.function]}`,
  );
  return {
    evidenceState: "SUPPORTED_PRESENT" as const,
    conclusion: `Cross-functional relationships: ${relationships.join("; ")}.`,
    evidenceReferences: [...new Set(catalog.flatMap((entry) => entry.evidenceReferences))],
  };
}

// Also usable to project an already-validated historical result without a new
// semantic call or a persisted-contract migration. No score or other dimension
// is recalculated, and the source object is not mutated.
export function restoreOrganizationalMaturityRelationships(
  maturity: z.infer<typeof semanticOrganizationalMaturitySchema>,
  ownershipMap: z.infer<typeof ownershipMapSchema>,
  availableEvidence: AvailableSemanticEvidence[],
) {
  assertSemanticEvidenceReferences({
    references:
      maturity.ownershipAndCrossFunctionalDesign.crossFunctionalRelationships.evidenceReferences,
    availableEvidence,
    code: "ORGANIZATIONAL_MATURITY_EVIDENCE_INVALID",
    message: "Organizational Maturity references unavailable evidence",
  });
  const dimension = organizationalMaturityRelationshipTransport(
    organizationalMaturityRelationshipCatalog(ownershipMap, availableEvidence),
  );
  const code = "organizational-maturity-cross-functional-relationships-not-established";
  const unknowns = maturity.unknowns.filter((unknown) => unknown.code !== code);
  if (dimension.evidenceState === "NOT_ESTABLISHED") {
    unknowns.push({
      code,
      description: "Cross-functional relationship design is not established by the available evidence.",
      materiality: "This limits completeness of the ownership and cross-functional design assessment.",
      evidenceReferences: [],
    });
  }
  return semanticOrganizationalMaturitySchema.parse({
    ...maturity,
    unknowns,
    ownershipAndCrossFunctionalDesign: {
      ...maturity.ownershipAndCrossFunctionalDesign,
      crossFunctionalRelationships: {
        conclusion: dimension.conclusion,
        unknown: dimension.evidenceState === "NOT_ESTABLISHED",
        evidenceReferences: dimension.evidenceReferences,
      },
    },
  });
}

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
  relationshipCatalog?: RelationshipCatalog,
) {
  // Resolve the input-dependent rule before generation. Other patterns retain
  // their existing semantic meaning and choice space; ownership is not a gate.
  const schema = hasMaterialRenewalResponsibility(responsibilityMap)
    ? semanticOrganizationalMaturityTransportSchema
    : nonRenewalMaturityTransportSchema;
  // The context-free schema remains available for historical transport parsing.
  // Production always supplies the validated, request-specific catalog.
  if (relationshipCatalog === undefined) return schema;
  const dimension = organizationalMaturityRelationshipTransport(relationshipCatalog);
  const references = dimension.evidenceReferences;
  const dimensionSchema = dimension.evidenceState === "NOT_ESTABLISHED"
    ? z.object({
        evidenceState: z.literal("NOT_ESTABLISHED"),
        conclusion: z.null(),
        evidenceReferences: evidenceReferences.max(0),
        ...transportNotEstablishedMaturityAssessmentShape,
      }).strict()
    : z.object({
        evidenceState: z.literal("SUPPORTED_PRESENT"),
        conclusion: z.literal(dimension.conclusion),
        evidenceReferences: z.array(z.enum(references as [string, ...string[]])).min(1),
        ...transportKnownMaturityAssessmentShape,
      }).strict();
  return schema.extend({
    ownershipAndCrossFunctionalDesign:
      schema.shape.ownershipAndCrossFunctionalDesign.extend({
        crossFunctionalRelationships: dimensionSchema,
      }),
  });
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
  value: unknown,
  availableEvidence: AvailableSemanticEvidence[],
  responsibilityMap?: ResponsibilityMap,
  relationshipCatalog?: RelationshipCatalog,
) {
  const currentTransport = semanticOrganizationalMaturityTransportSchema.safeParse(value);
  const legacyTransport = currentTransport.success
    ? null
    : legacySemanticOrganizationalMaturityTransportSchema.parse(value);
  const transport = currentTransport.success
    ? currentTransport.data
    : legacyTransport!;
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
  assertSemanticEvidenceReferences({
    references:
      transport.ownershipAndCrossFunctionalDesign.crossFunctionalRelationships.evidenceReferences,
    availableEvidence,
    code: "ORGANIZATIONAL_MATURITY_EVIDENCE_INVALID",
    message: "Organizational Maturity references unavailable evidence",
  });
  const restoreRelationshipDimension = <T extends {
    crossFunctionalRelationships: object;
  }>(design: T) => ({
    ...design,
    ...(relationshipCatalog === undefined ? {} : {
      crossFunctionalRelationships: {
        ...design.crossFunctionalRelationships,
        ...organizationalMaturityRelationshipTransport(relationshipCatalog),
      },
    }),
  });
  const currentDesign = currentTransport.success
    ? restoreRelationshipDimension(
        currentTransport.data.ownershipAndCrossFunctionalDesign,
      )
    : null;
  const transportDesign = currentDesign ?? restoreRelationshipDimension(
    legacyTransport!.ownershipAndCrossFunctionalDesign,
  );
  const toDomainDimension = (dimension: {
    evidenceState: z.infer<typeof organizationalMaturityEvidenceStateSchema>;
    conclusion: string | null;
    evidenceReferences: string[];
  }) => {
    if (dimension.evidenceState === "NOT_ESTABLISHED") {
      return {
        conclusion: null,
        unknown: true as const,
        evidenceReferences: dimension.evidenceReferences,
      };
    }
    if (dimension.conclusion === null) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_EVIDENCE_STATE_INVALID",
        "Supported Organizational Maturity conclusions must be present",
      );
    }
    if (
      !currentTransport.success &&
      missingInformationLanguage.test(dimension.conclusion)
    ) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_EVIDENCE_STATE_INVALID",
        "Legacy supported Organizational Maturity conclusions cannot be based on missing information",
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
  const currentAssessments = currentTransport.success
    ? ([
        ["EXISTING_CS_FUNCTION", currentTransport.data.existingCustomerSuccessFunction],
        ["CUSTOMER_OPERATING_MODEL", currentTransport.data.customerOperatingModel],
        ["ROLE_BOUNDARIES", currentDesign!.roleBoundaries],
        ["TEAM_BOUNDARIES", currentDesign!.teamBoundaries],
        ["HANDOFFS", currentDesign!.handoffs],
        ["SHARED_OWNERSHIP", currentDesign!.sharedOwnership],
        ["CROSS_FUNCTIONAL_RELATIONSHIPS", currentDesign!.crossFunctionalRelationships],
        ["UNRELATED_RESPONSIBILITIES", currentDesign!.unrelatedResponsibilities],
        ["SCOPE_CREEP", currentDesign!.scopeCreep],
        ["MULTIPLE_JOBS_COMBINED", currentDesign!.multipleJobsCombined],
        ["UNREALISTIC_OWNERSHIP", currentDesign!.unrealisticOwnership],
      ] as const)
    : [];
  for (const [assessmentArea, assessment] of currentAssessments) {
    const criterion = "classification" in assessment;
    const evidenceState = criterion
      ? assessment.classification === "UNKNOWN"
        ? "NOT_ESTABLISHED"
        : "SUPPORTED_PRESENT"
      : assessment.evidenceState;
    assertMaturityAssessmentConsistency({
      assessmentArea,
      evidenceState,
      statement: criterion ? assessment.explanation : assessment.conclusion,
      evidenceReferences: assessment.evidenceReferences,
      semanticImpact: assessment.semanticImpact,
      unknowns: assessment.unknowns,
    });
  }
  const convertedPositiveSignals = currentTransport.success
    ? currentAssessments.flatMap(([, assessment]) =>
        assessment.semanticImpact.impact === "SUPPORTED_POSITIVE"
          ? [{
              finding: assessment.semanticImpact.finding,
              evidenceReferences:
                assessment.semanticImpact.affirmativeEvidenceReferences,
            }]
          : [],
      )
    : legacyTransport!.positiveSignals;
  const transportWeakSignals = currentTransport.success
    ? currentAssessments.flatMap(([assessmentArea, assessment]) =>
        assessment.semanticImpact.impact === "SUPPORTED_WEAKNESS"
          ? [{
              assessmentArea,
              evidenceState: "SUPPORTED_WEAKNESS" as const,
              finding: assessment.semanticImpact.finding,
              affirmativeEvidenceReferences:
                assessment.semanticImpact.affirmativeEvidenceReferences,
            }]
          : [],
      )
    : legacyTransport!.weakSignals;
  const transportUnknowns = currentTransport.success
    ? currentAssessments.flatMap(([assessmentArea, assessment]) =>
        assessment.unknowns.map((unknown) => ({
          assessmentArea,
          ...unknown,
        })),
      )
    : legacyTransport!.unknowns;
  for (const signal of convertedPositiveSignals) {
    if (missingInformationLanguage.test(signal.finding)) {
      semanticContractViolation(
        "ORGANIZATIONAL_MATURITY_POSITIVE_SIGNAL_INVALID",
        "Organizational Maturity positive signals require affirmative evidence of an actual strength",
      );
    }
  }
  for (const signal of transportWeakSignals) {
    if (missingInformationLanguage.test(signal.finding)) {
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
  }
  const convertedWeakSignals = transportWeakSignals.map((signal) => ({
    finding: signal.finding,
    evidenceReferences: signal.affirmativeEvidenceReferences,
  }));
  const convertedUnknowns = transportUnknowns.map(
    ({ assessmentArea: _assessmentArea, ...unknown }) => unknown,
  );
  const toDomainCriterion = <T extends {
    semanticImpact: unknown;
    unknowns: unknown;
  }>({ semanticImpact: _semanticImpact, unknowns: _unknowns, ...criterion }: T) =>
    criterion;
  const domainExistingCustomerSuccessFunction = currentTransport.success
    ? toDomainCriterion(currentTransport.data.existingCustomerSuccessFunction)
    : legacyTransport!.existingCustomerSuccessFunction;
  const domainCustomerOperatingModel = currentTransport.success
    ? toDomainCriterion(currentTransport.data.customerOperatingModel)
    : legacyTransport!.customerOperatingModel;
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
      existingCustomerSuccessFunction: domainExistingCustomerSuccessFunction,
      customerOperatingModel: domainCustomerOperatingModel,
      ownershipAndCrossFunctionalDesign: {
        summary: transportDesign.summary,
        ...convertedDimensions,
        evidenceReferences: transportDesign.evidenceReferences,
      },
      positiveSignals: convertedPositiveSignals,
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
