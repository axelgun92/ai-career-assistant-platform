import {
  contradictionDraftSchema,
  type EvidenceRecordDraft,
} from "@ai-career/evidence";
import { StageExecutionError } from "@ai-career/evaluation";
import { z } from "zod";
import {
  requirementCategorySchema,
  requirementMapSchema,
  requirementStrengthSchema,
} from "./maps";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

export const customerSuccessResumeMatchPromptVersion = "cs-resume-match-v2";

export const requirementMatchClassificationSchema = z.enum([
  "STRONG_MATCH",
  "TRANSFERABLE_MATCH",
  "PARTIAL_MATCH",
  "GENUINE_GAP",
  "UNKNOWN",
]);

export const matchedExperienceSpecificitySchema = z.enum([
  "DIRECT_SAAS_CUSTOMER_SUCCESS",
  "DIRECT_CUSTOMER_SUCCESS",
  "RELATED_CUSTOMER_RELATIONSHIP",
  "BROADER_CUSTOMER_FACING",
  "TRANSFERABLE",
  "UNSUPPORTED",
  "UNKNOWN",
]);

export const requirementDecisionImpactSchema = z.enum([
  "DECISIVE_DISQUALIFIER",
  "MATERIAL_UNCERTAINTY",
  "NON_DECISIVE",
]);

export const effectiveLevelFitSchema = z.enum([
  "TARGET_LEVEL",
  "STRETCH",
  "ABOVE_LEVEL",
]);

export const resumeMatchBandSchema = z.enum([
  "VERY_LOW",
  "LOW",
  "MIXED_MODERATE",
  "GOOD_HIGH",
  "VERY_STRONG_VERY_HIGH",
]);

export const responsibilitySeniorityClassificationSchema = z.enum([
  "EARLY_MID_LEVEL",
  "MID_LEVEL",
  "SENIOR",
  "HIGHLY_SENIOR",
  "UNKNOWN",
]);

export const senioritySignalTypeSchema = z.enum([
  "AUTONOMY",
  "DECISION_AUTHORITY",
  "STRATEGIC_OWNERSHIP",
  "ACCOUNT_COMPLEXITY",
  "STRATEGIC_ACCOUNT_OWNERSHIP",
  "EXECUTIVE_INTERACTION",
  "COMMERCIAL_RESPONSIBILITY",
  "COMMERCIAL_NEGOTIATION",
  "ARR_RESPONSIBILITY",
  "PROGRAM_OWNERSHIP",
  "PROCESS_OWNERSHIP",
  "LEADERSHIP_EXPECTATIONS",
  "MENTORING",
  "TECHNICAL_COMPLEXITY",
  "CROSS_FUNCTIONAL_SCOPE",
]);

export const senioritySignalAssessmentSchema = z.enum([
  "ROUTINE",
  "MODERATE",
  "ADVANCED",
  "UNKNOWN",
]);

export const requirementMatchAssessmentSchema = z
  .object({
    requirementIndex: z.number().int().nonnegative(),
    requirementText: requiredText,
    category: requirementCategorySchema,
    strength: requirementStrengthSchema,
    statedYears: z.number().nonnegative().nullable(),
    statedYearsMaximum: z.number().nonnegative().nullable(),
    statedYearsOpenEnded: z.boolean(),
    requestedExperienceSpecificity: optionalText,
    isAmbiguous: z.boolean(),
    ambiguityExplanation: optionalText,
    classification: requirementMatchClassificationSchema,
    matchedExperienceSpecificity: matchedExperienceSpecificitySchema,
    importanceExplanation: requiredText,
    decisionImpact: requirementDecisionImpactSchema,
    decisionImpactExplanation: requiredText,
    decisionImpactEvidenceReferences: evidenceReferences,
    explanation: requiredText,
    supportedPortion: optionalText,
    unsupportedPortion: optionalText,
    jdEvidenceReferences: evidenceReferences.min(1),
    profileEvidenceReferences: evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.classification !== "UNKNOWN" &&
      value.profileEvidenceReferences.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["profileEvidenceReferences"],
        message:
          "Assessed requirement matches and gaps require user-profile evidence",
      });
    }
    if (
      value.classification === "TRANSFERABLE_MATCH" &&
      value.matchedExperienceSpecificity !== "TRANSFERABLE"
    ) {
      context.addIssue({
        code: "custom",
        path: ["matchedExperienceSpecificity"],
        message: "Transferable matches must remain classified as transferable",
      });
    }
    if (
      value.classification === "STRONG_MATCH" &&
      ["TRANSFERABLE", "UNSUPPORTED", "UNKNOWN"].includes(
        value.matchedExperienceSpecificity,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["matchedExperienceSpecificity"],
        message: "Strong matches cannot relabel transferable experience as direct",
      });
    }
    if (
      value.classification === "UNKNOWN" &&
      value.matchedExperienceSpecificity !== "UNKNOWN"
    ) {
      context.addIssue({
        code: "custom",
        path: ["matchedExperienceSpecificity"],
        message: "Unknown requirement matches cannot assert experience specificity",
      });
    }
    if (
      value.classification === "GENUINE_GAP" &&
      value.matchedExperienceSpecificity !== "UNSUPPORTED"
    ) {
      context.addIssue({
        code: "custom",
        path: ["matchedExperienceSpecificity"],
        message: "Genuine gaps must preserve unsupported experience specificity",
      });
    }
    if (value.classification === "GENUINE_GAP" && value.isAmbiguous) {
      context.addIssue({
        code: "custom",
        path: ["classification"],
        message: "Ambiguous requirements must remain Unknown rather than gaps",
      });
    }
    if (
      value.classification !== "GENUINE_GAP" &&
      value.decisionImpact !== "NON_DECISIVE"
    ) {
      context.addIssue({
        code: "custom",
        path: ["decisionImpact"],
        message:
          "Only a Genuine Gap may have disqualifying or materially uncertain decision impact",
      });
    }
    if (
      value.decisionImpact === "DECISIVE_DISQUALIFIER" &&
      value.strength !== "REQUIRED"
    ) {
      context.addIssue({
        code: "custom",
        path: ["decisionImpact"],
        message:
          "Only an evidenced required Genuine Gap may be a decisive disqualifier",
      });
    }
    if (
      value.decisionImpact === "DECISIVE_DISQUALIFIER" &&
      value.decisionImpactEvidenceReferences.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["decisionImpactEvidenceReferences"],
        message: "A decisive disqualifier requires explicit supporting evidence",
      });
    }
    if (
      value.classification === "PARTIAL_MATCH" &&
      (value.supportedPortion === null || value.unsupportedPortion === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supportedPortion"],
        message:
          "Partial matches must explain both supported and unsupported portions",
      });
    }
  });

const seniorityDimensionSchema = z
  .object({
    summary: requiredText,
    requirementIndexes: z.array(z.number().int().nonnegative()),
    evidenceReferences,
  })
  .strict();

export const actualResponsibilitySenioritySchema = z
  .object({
    classification: responsibilitySeniorityClassificationSchema,
    summary: requiredText,
    signals: z.array(
      z
        .object({
          signal: senioritySignalTypeSchema,
          assessment: senioritySignalAssessmentSchema,
          explanation: requiredText,
          evidenceReferences,
        })
        .strict()
        .superRefine((value, context) => {
          if (
            value.assessment !== "UNKNOWN" &&
            value.evidenceReferences.length === 0
          ) {
            context.addIssue({
              code: "custom",
              path: ["evidenceReferences"],
              message: "Known seniority signals require evidence",
            });
          }
        }),
    ),
    evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.classification !== "UNKNOWN" &&
      value.evidenceReferences.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known responsibility seniority requires evidence",
      });
    }
  });

export const effectiveSeniorityAssessmentSchema = z
  .object({
    statedYears: seniorityDimensionSchema,
    requirementStrength: seniorityDimensionSchema,
    experienceSpecificity: seniorityDimensionSchema,
    actualResponsibilitySeniority: actualResponsibilitySenioritySchema,
    effectiveLevelFit: effectiveLevelFitSchema,
    explanation: requiredText,
    evidenceReferences: evidenceReferences.min(1),
  })
  .strict();

export const resumePositioningRecommendationSchema = z
  .object({
    recommendation: requiredText,
    evidenceReferences: evidenceReferences.min(1),
  })
  .strict();

export const semanticResumeMatchSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    scoreExplanation: requiredText,
    scoreEvidenceReferences: evidenceReferences.min(1),
    summary: requiredText,
    requirementAssessments: z.array(requirementMatchAssessmentSchema),
    effectiveSeniority: effectiveSeniorityAssessmentSchema,
    strongStrengths: z.array(supportedAlignmentFindingSchema),
    partialMatches: z.array(supportedAlignmentFindingSchema),
    genuineGaps: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    positioningRecommendations: z.array(resumePositioningRecommendationSchema),
    evidenceReferences: evidenceReferences.min(1),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

// OpenAI Structured Outputs validates JSON Schema, which cannot represent the
// domain schema's superRefine rules. Keep a provider-facing transport schema
// whose unions make those relationships structural, then convert to the
// unchanged domain contract below.
const transportRequiredText = z.string().min(1).regex(/\S/);
const transportOptionalText = transportRequiredText.nullable();
const transportEvidenceReferences = z.array(transportRequiredText);
const transportBothSourceEvidenceSchema = z
  .object({
    jdEvidenceReferences: transportEvidenceReferences.min(1),
    profileEvidenceReferences: transportEvidenceReferences.min(1),
  })
  .strict();
const transportUnknownCode = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/);

export const requirementExperienceEvidenceBasisSchema = z.enum([
  "DIRECT_OR_RELATED_WORK_EXPERIENCE",
  "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE",
  "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE",
  "NO_SUPPORTING_EXPERIENCE",
  "UNKNOWN",
]);

const transportRequirementFields = {
  requirementIndex: z.number().int().nonnegative(),
  importanceExplanation: transportRequiredText,
  decisionImpactExplanation: transportRequiredText,
  explanation: transportRequiredText,
  jdEvidenceReferences: transportEvidenceReferences.min(1),
};

const transportNonGapFields = {
  ...transportRequirementFields,
  decisionImpact: z.literal("NON_DECISIVE"),
  decisionImpactEvidenceReferences: transportEvidenceReferences,
};

// Provider-facing decision-impact evidence is assessment-local. OpenAI JSON
// Schema cannot express a subset relationship between sibling arrays, so the
// provider returns positions into the evidence it selected for this assessment
// instead of independently selecting Core evidence identifiers again.
const transportDecisionImpactEvidenceIndexes = z.array(
  z.number().int().nonnegative(),
);
const providerNonGapFields = {
  ...transportRequirementFields,
  decisionImpact: z.literal("NON_DECISIVE"),
  decisionImpactEvidenceIndexes: transportDecisionImpactEvidenceIndexes,
};

const transportStrongRequirementSchema = z
  .object({
    ...transportNonGapFields,
    classification: z.literal("STRONG_MATCH"),
    matchedExperienceSpecificity: z.enum([
      "DIRECT_SAAS_CUSTOMER_SUCCESS",
      "DIRECT_CUSTOMER_SUCCESS",
      "RELATED_CUSTOMER_RELATIONSHIP",
      "BROADER_CUSTOMER_FACING",
    ]),
    experienceEvidenceBasis: z.enum([
      "DIRECT_OR_RELATED_WORK_EXPERIENCE",
      "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE",
      "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE",
    ]),
    supportedPortion: transportOptionalText,
    unsupportedPortion: transportOptionalText,
    profileEvidenceReferences: transportEvidenceReferences.min(1),
  })
  .strict();

const transportTransferableRequirementSchema = z
  .object({
    ...transportNonGapFields,
    classification: z.literal("TRANSFERABLE_MATCH"),
    matchedExperienceSpecificity: z.literal("TRANSFERABLE"),
    experienceEvidenceBasis: z.literal(
      "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE",
    ),
    supportedPortion: transportOptionalText,
    unsupportedPortion: transportOptionalText,
    profileEvidenceReferences: transportEvidenceReferences.min(1),
  })
  .strict();

const transportPartialRequirementSchema = z
  .object({
    ...transportNonGapFields,
    classification: z.literal("PARTIAL_MATCH"),
    matchedExperienceSpecificity: matchedExperienceSpecificitySchema,
    experienceEvidenceBasis: z.enum([
      "DIRECT_OR_RELATED_WORK_EXPERIENCE",
      "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE",
      "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE",
    ]),
    supportedPortion: transportRequiredText,
    unsupportedPortion: transportRequiredText,
    profileEvidenceReferences: transportEvidenceReferences.min(1),
  })
  .strict();

const transportGapFields = {
  ...transportRequirementFields,
  classification: z.literal("GENUINE_GAP"),
  matchedExperienceSpecificity: z.literal("UNSUPPORTED"),
  experienceEvidenceBasis: z.literal("NO_SUPPORTING_EXPERIENCE"),
  supportedPortion: transportOptionalText,
  unsupportedPortion: transportOptionalText,
  profileEvidenceReferences: transportEvidenceReferences.min(1),
};

const transportGapRequirementSchema = z.union([
  z
    .object({
      ...transportGapFields,
      decisionImpact: z.literal("DECISIVE_DISQUALIFIER"),
      decisionImpactExplanation: transportRequiredText,
      decisionImpactEvidence: transportBothSourceEvidenceSchema,
    })
    .strict(),
  z
    .object({
      ...transportGapFields,
      decisionImpact: z.literal("MATERIAL_UNCERTAINTY"),
      decisionImpactExplanation: transportRequiredText,
      decisionImpactEvidenceReferences: transportEvidenceReferences,
    })
    .strict(),
  z
    .object({
      ...transportGapFields,
      decisionImpact: z.literal("NON_DECISIVE"),
      decisionImpactExplanation: transportRequiredText,
      decisionImpactEvidenceReferences: transportEvidenceReferences,
    })
    .strict(),
]);

const transportUnknownRequirementSchema = z
  .object({
    ...transportRequirementFields,
    classification: z.literal("UNKNOWN"),
    matchedExperienceSpecificity: z.literal("UNKNOWN"),
    experienceEvidenceBasis: z.literal("UNKNOWN"),
    decisionImpact: z.literal("NON_DECISIVE"),
    decisionImpactEvidenceReferences: transportEvidenceReferences,
    supportedPortion: transportOptionalText,
    unsupportedPortion: transportOptionalText,
    profileEvidenceReferences: transportEvidenceReferences,
  })
  .strict();

const transportRequirementAssessmentSchema = z.union([
  transportStrongRequirementSchema,
  transportTransferableRequirementSchema,
  transportPartialRequirementSchema,
  transportGapRequirementSchema,
  transportUnknownRequirementSchema,
]);

const directOrRelatedWorkEvidenceTypes = new Set([
  "DIRECT_EXPERIENCE",
  "RELATED_EXPERIENCE",
]);
const broaderOrTransferableWorkEvidenceTypes = new Set([
  "DIRECT_EXPERIENCE",
  "RELATED_EXPERIENCE",
  "TRANSFERABLE_EXPERIENCE",
  "TRANSFERABLE_SKILL",
]);
const requirementRelevantKnowledgeEvidenceTypes = new Set([
  "SKILL",
  "TRANSFERABLE_SKILL",
]);

type PositiveExperienceEvidenceBasis = Exclude<
  z.infer<typeof requirementExperienceEvidenceBasisSchema>,
  "NO_SUPPORTING_EXPERIENCE" | "UNKNOWN"
>;

function providerProfileReferenceSchema(referenceIds: string[]) {
  const uniqueReferenceIds = [...new Set(referenceIds)];
  if (uniqueReferenceIds.length === 0) {
    return null;
  }
  return z.array(
    uniqueReferenceIds.length === 1
      ? z.literal(uniqueReferenceIds[0]!)
      : z.enum(uniqueReferenceIds as [string, ...string[]]),
  ).min(1);
}

function profileReferencesForEvidenceBasis(
  availableEvidence: AvailableResumeMatchEvidence[],
  evidenceBasis: PositiveExperienceEvidenceBasis,
) {
  const eligibleTypes =
    evidenceBasis === "DIRECT_OR_RELATED_WORK_EXPERIENCE"
      ? directOrRelatedWorkEvidenceTypes
      : evidenceBasis === "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE"
        ? broaderOrTransferableWorkEvidenceTypes
        : requirementRelevantKnowledgeEvidenceTypes;
  return availableEvidence
    .filter(
      (evidence) =>
        evidence.sourceType === "USER_PROFILE" &&
        eligibleTypes.has(evidence.evidenceType),
    )
    .map((evidence) => evidence.referenceId);
}

function createPositiveRequirementSchema(input: {
  classification: "STRONG_MATCH" | "TRANSFERABLE_MATCH" | "PARTIAL_MATCH";
  evidenceBasis: PositiveExperienceEvidenceBasis;
  profileReferenceIds: string[];
}) {
  const profileEvidenceReferences = providerProfileReferenceSchema(
    input.profileReferenceIds,
  );
  if (!profileEvidenceReferences) {
    return null;
  }
  const matchedExperienceSpecificity =
    input.classification === "STRONG_MATCH"
      ? z.enum([
          "DIRECT_SAAS_CUSTOMER_SUCCESS",
          "DIRECT_CUSTOMER_SUCCESS",
          "RELATED_CUSTOMER_RELATIONSHIP",
          "BROADER_CUSTOMER_FACING",
        ])
      : input.classification === "TRANSFERABLE_MATCH"
        ? z.literal("TRANSFERABLE")
        : matchedExperienceSpecificitySchema;
  return z
    .object({
      ...providerNonGapFields,
      classification: z.literal(input.classification),
      matchedExperienceSpecificity,
      experienceEvidenceBasis: z.literal(input.evidenceBasis),
      supportedPortion:
        input.classification === "PARTIAL_MATCH"
          ? transportRequiredText
          : transportOptionalText,
      unsupportedPortion:
        input.classification === "PARTIAL_MATCH"
          ? transportRequiredText
          : transportOptionalText,
      profileEvidenceReferences,
    })
    .strict();
}

const providerGapFields = {
  ...transportRequirementFields,
  classification: z.literal("GENUINE_GAP"),
  matchedExperienceSpecificity: z.literal("UNSUPPORTED"),
  experienceEvidenceBasis: z.literal("NO_SUPPORTING_EXPERIENCE"),
  supportedPortion: transportOptionalText,
  unsupportedPortion: transportOptionalText,
  profileEvidenceReferences: transportEvidenceReferences.min(1),
};

const providerGapRequirementSchema = z.union([
  z
    .object({
      ...providerGapFields,
      decisionImpact: z.literal("DECISIVE_DISQUALIFIER"),
      decisionImpactExplanation: transportRequiredText,
      decisionImpactEvidence: z
        .object({
          jdEvidenceIndexes: transportDecisionImpactEvidenceIndexes.min(1),
          profileEvidenceIndexes:
            transportDecisionImpactEvidenceIndexes.min(1),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...providerGapFields,
      decisionImpact: z.literal("MATERIAL_UNCERTAINTY"),
      decisionImpactExplanation: transportRequiredText,
      decisionImpactEvidenceIndexes: transportDecisionImpactEvidenceIndexes,
    })
    .strict(),
  z
    .object({
      ...providerGapFields,
      decisionImpact: z.literal("NON_DECISIVE"),
      decisionImpactExplanation: transportRequiredText,
      decisionImpactEvidenceIndexes: transportDecisionImpactEvidenceIndexes,
    })
    .strict(),
]);

const providerUnknownRequirementSchema = z
  .object({
    ...transportRequirementFields,
    classification: z.literal("UNKNOWN"),
    matchedExperienceSpecificity: z.literal("UNKNOWN"),
    experienceEvidenceBasis: z.literal("UNKNOWN"),
    decisionImpact: z.literal("NON_DECISIVE"),
    decisionImpactEvidenceIndexes: transportDecisionImpactEvidenceIndexes,
    supportedPortion: transportOptionalText,
    unsupportedPortion: transportOptionalText,
    profileEvidenceReferences: transportEvidenceReferences,
  })
  .strict();

function providerRequirementAssessmentSchema(
  availableEvidence: AvailableResumeMatchEvidence[],
  requirementMap?: z.infer<typeof requirementMapSchema>,
) {
  const industryIndexes = requirementMap?.flatMap((requirement, index) =>
    requirement.category === "INDUSTRY" ? [index] : [],
  );
  const otherIndexes = requirementMap?.flatMap((requirement, index) =>
    requirement.category !== "INDUSTRY" ? [index] : [],
  );
  const constrainIndexes = (schema: z.ZodObject, indexes: number[]) =>
    schema.extend({
      requirementIndex: indexes.length === 1
        ? z.literal(indexes[0]!)
        : z.union(indexes.map((index) => z.literal(index)) as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
    });
  const bases: PositiveExperienceEvidenceBasis[] = [
    "DIRECT_OR_RELATED_WORK_EXPERIENCE",
    "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE",
    "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE",
  ];
  const positiveSchemas = bases.flatMap((evidenceBasis) => {
    const profileReferenceIds = profileReferencesForEvidenceBasis(
      availableEvidence,
      evidenceBasis,
    );
    const classifications = (
      evidenceBasis === "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE"
        ? ["STRONG_MATCH", "TRANSFERABLE_MATCH", "PARTIAL_MATCH"]
        : ["STRONG_MATCH", "PARTIAL_MATCH"]
    ) as Array<"STRONG_MATCH" | "TRANSFERABLE_MATCH" | "PARTIAL_MATCH">;
    return classifications
      .map((classification) =>
        createPositiveRequirementSchema({
          classification,
          evidenceBasis,
          profileReferenceIds,
        }),
      )
      .filter((schema): schema is NonNullable<typeof schema> => schema !== null);
  });
  const ordinarySchemas = otherIndexes === undefined
    ? positiveSchemas
    : otherIndexes.length === 0
      ? []
      : positiveSchemas.map((schema) => constrainIndexes(schema, otherIndexes));
  const specializedSchemas = industryIndexes?.length
    ? (["STRONG_MATCH", "PARTIAL_MATCH"] as const).flatMap((classification) => {
        const schema = createPositiveRequirementSchema({
          classification,
          evidenceBasis: "DIRECT_OR_RELATED_WORK_EXPERIENCE",
          profileReferenceIds: availableEvidence.filter((evidence) =>
            evidence.sourceType === "USER_PROFILE" &&
            evidence.evidenceType === "DIRECT_EXPERIENCE",
          ).map((evidence) => evidence.referenceId),
        });
        return schema ? [constrainIndexes(schema, industryIndexes)] : [];
      })
    : [];
  return z.union([
    ...ordinarySchemas,
    ...specializedSchemas,
    providerGapRequirementSchema,
    providerUnknownRequirementSchema,
  ] as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

const transportSeniorityDimensionSchema = z
  .object({
    summary: transportRequiredText,
    requirementIndexes: z.array(z.number().int().nonnegative()),
    evidenceReferences: transportEvidenceReferences,
  })
  .strict();

const transportSenioritySignalSchema = z.union([
  z
    .object({
      signal: senioritySignalTypeSchema,
      assessment: z.enum(["ROUTINE", "MODERATE", "ADVANCED"]),
      explanation: transportRequiredText,
      evidenceIndexes: z.array(z.number().int().nonnegative()).min(1),
    })
    .strict(),
  z
    .object({
      signal: senioritySignalTypeSchema,
      assessment: z.literal("UNKNOWN"),
      explanation: transportRequiredText,
      evidenceIndexes: z.array(z.number().int().nonnegative()),
    })
    .strict(),
]);

const transportActualResponsibilitySenioritySchema = z.union([
  z
    .object({
      classification: z.enum([
        "EARLY_MID_LEVEL",
        "MID_LEVEL",
        "SENIOR",
        "HIGHLY_SENIOR",
      ]),
      summary: transportRequiredText,
      signals: z.array(transportSenioritySignalSchema),
      evidenceIndexes: z.array(z.number().int().nonnegative()).min(1),
    })
    .strict(),
  z
    .object({
      classification: z.literal("UNKNOWN"),
      summary: transportRequiredText,
      signals: z.array(transportSenioritySignalSchema),
      evidenceIndexes: z.array(z.number().int().nonnegative()),
    })
    .strict(),
]);

const transportSupportedFindingSchema = z
  .object({
    finding: transportRequiredText,
    evidenceReferences: transportEvidenceReferences.min(1),
  })
  .strict();

const transportUnknownSchema = z
  .object({
    code: transportUnknownCode,
    description: transportRequiredText,
    materiality: transportOptionalText,
    evidenceReferences: transportEvidenceReferences,
  })
  .strict();

const transportContradictionSchema = z
  .object({
    claimA: transportRequiredText,
    claimB: transportRequiredText,
    interpretation: transportRequiredText,
    relevantField: transportOptionalText,
    significance: transportOptionalText,
    evidenceReferencesA: transportEvidenceReferences.min(1),
    evidenceReferencesB: transportEvidenceReferences.min(1),
  })
  .strict();

export const semanticResumeMatchTransportSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    scoreExplanation: transportRequiredText,
    scoreEvidence: transportBothSourceEvidenceSchema,
    summary: transportRequiredText,
    requirementAssessments: z.array(transportRequirementAssessmentSchema),
    effectiveSeniority: z
      .object({
        statedYears: transportSeniorityDimensionSchema,
        requirementStrength: transportSeniorityDimensionSchema,
        experienceSpecificity: transportSeniorityDimensionSchema,
        actualResponsibilitySeniority:
          transportActualResponsibilitySenioritySchema,
        effectiveLevelFit: effectiveLevelFitSchema,
        explanation: transportRequiredText,
        evidence: transportBothSourceEvidenceSchema,
      })
      .strict(),
    strongStrengths: z.array(transportSupportedFindingSchema),
    partialMatches: z.array(transportSupportedFindingSchema),
    unknowns: z.array(transportUnknownSchema),
    positioningRecommendations: z.array(
      z
        .object({
          recommendation: transportRequiredText,
          evidence: transportBothSourceEvidenceSchema,
        })
        .strict(),
    ),
    evidenceReferences: transportEvidenceReferences.min(1),
    contradictions: z.array(transportContradictionSchema),
  })
  .strict();

export function createSemanticResumeMatchTransportSchema(
  availableEvidence: AvailableResumeMatchEvidence[],
  authoritativeRequirementMap?: z.input<typeof requirementMapSchema>,
) {
  return semanticResumeMatchTransportSchema.extend({
    requirementAssessments: z.array(
      providerRequirementAssessmentSchema(
        availableEvidence,
        authoritativeRequirementMap === undefined
          ? undefined
          : requirementMapSchema.parse(authoritativeRequirementMap),
      ),
    ),
  });
}

export function semanticResumeMatchRequirementsForProvider(
  authoritativeRequirementMap: z.input<typeof requirementMapSchema>,
) {
  return requirementMapSchema
    .parse(authoritativeRequirementMap)
    .map((requirement, requirementIndex) => ({
      requirementIndex,
      ...requirement,
    }))
    .filter((requirement) => !requirement.ambiguity.isAmbiguous);
}

export function semanticResumeMatchJobEvidenceCatalog<
  TEvidence extends Pick<
    EvidenceRecordDraft,
    "referenceId" | "sourceType" | "evidenceType"
  >,
>(availableEvidence: TEvidence[]) {
  return availableEvidence
    .filter((evidence) => evidence.sourceType !== "USER_PROFILE")
    .map((evidence, evidenceIndex) => ({ evidenceIndex, ...evidence }));
}

function authoritativeResultViolation(message: string): never {
  throw new StageExecutionError({
    code: "RESUME_MATCH_AUTHORITATIVE_RESULT_INVALID",
    message,
    retryable: false,
  });
}

function evidenceResultViolation(message: string): never {
  throw new StageExecutionError({
    code: "RESUME_MATCH_EVIDENCE_INVALID",
    message,
    retryable: false,
  });
}

function assertUniqueRequirementProfileEvidenceReferences(
  transport: z.infer<typeof semanticResumeMatchTransportSchema>,
) {
  for (const assessment of transport.requirementAssessments) {
    if (
      new Set(assessment.profileEvidenceReferences).size !==
      assessment.profileEvidenceReferences.length
    ) {
      evidenceResultViolation(
        `Requirement ${assessment.requirementIndex} profile evidence contains duplicate evidence references`,
      );
    }
  }
}

type AvailableResumeMatchEvidence = Pick<
  EvidenceRecordDraft,
  "referenceId" | "sourceType" | "evidenceType"
>;

type ResumeMatchJobEvidenceCatalog = ReturnType<
  typeof semanticResumeMatchJobEvidenceCatalog
>;

function evidenceReferencesFromIndexes(
  indexes: number[],
  catalog: ResumeMatchJobEvidenceCatalog,
  label: string,
) {
  if (new Set(indexes).size !== indexes.length) {
    evidenceResultViolation(`${label} contains duplicate evidence indexes`);
  }
  return indexes.map((index) => {
    const evidence = catalog[index];
    if (!evidence || evidence.evidenceIndex !== index) {
      evidenceResultViolation(`${label} references unknown job evidence`);
    }
    return evidence.referenceId;
  });
}

function evidenceReferencesFromLocalIndexes(
  indexes: number[],
  assessmentEvidence: string[],
  label: string,
) {
  if (new Set(indexes).size !== indexes.length) {
    evidenceResultViolation(`${label} contains duplicate local evidence indexes`);
  }
  return indexes.map((index) => {
    const reference = assessmentEvidence[index];
    if (reference === undefined) {
      evidenceResultViolation(`${label} references evidence outside its assessment`);
    }
    return reference;
  });
}

type ProviderRequirementAssessment = {
  requirementIndex: number;
  jdEvidenceReferences: string[];
  profileEvidenceReferences: string[];
  decisionImpactEvidenceIndexes?: number[];
  decisionImpactEvidence?: {
    jdEvidenceIndexes: number[];
    profileEvidenceIndexes: number[];
  };
  [key: string]: unknown;
};

function restoreAssessmentLocalDecisionImpactEvidence(input: unknown) {
  const providerTransport = input as Record<string, unknown> & {
    requirementAssessments: ProviderRequirementAssessment[];
  };
  return {
    ...providerTransport,
    requirementAssessments: providerTransport.requirementAssessments.map(
      (assessment) => {
        const label = `Requirement ${assessment.requirementIndex} decision-impact evidence`;
        if (assessment.decisionImpactEvidence) {
          const { decisionImpactEvidence, ...rest } = assessment;
          return {
            ...rest,
            decisionImpactEvidence: {
              jdEvidenceReferences: evidenceReferencesFromLocalIndexes(
                decisionImpactEvidence.jdEvidenceIndexes,
                assessment.jdEvidenceReferences,
                `${label} JD evidence`,
              ),
              profileEvidenceReferences: evidenceReferencesFromLocalIndexes(
                decisionImpactEvidence.profileEvidenceIndexes,
                assessment.profileEvidenceReferences,
                `${label} profile evidence`,
              ),
            },
          };
        }
        const { decisionImpactEvidenceIndexes, ...rest } = assessment;
        return {
          ...rest,
          decisionImpactEvidenceReferences:
            evidenceReferencesFromLocalIndexes(
              decisionImpactEvidenceIndexes ?? [],
              [
                ...assessment.jdEvidenceReferences,
                ...assessment.profileEvidenceReferences,
              ],
              label,
            ),
        };
      },
    ),
  };
}

function mergeBothSourceEvidence(input: {
  jdEvidenceReferences: string[];
  profileEvidenceReferences: string[];
}) {
  return [...input.jdEvidenceReferences, ...input.profileEvidenceReferences];
}

function assertEvidenceReferences(input: {
  references: string[];
  knownEvidence: Map<string, AvailableResumeMatchEvidence>;
  label: string;
  expectedSource?: "JD" | "PROFILE";
}) {
  if (new Set(input.references).size !== input.references.length) {
    evidenceResultViolation(
      `${input.label} contains duplicate evidence references`,
    );
  }
  for (const reference of input.references) {
    const evidence = input.knownEvidence.get(reference);
    if (!evidence) {
      evidenceResultViolation(`${input.label} references unknown evidence`);
    }
    const isProfile = evidence.sourceType === "USER_PROFILE";
    if (
      (input.expectedSource === "PROFILE" && !isProfile) ||
      (input.expectedSource === "JD" && isProfile)
    ) {
      evidenceResultViolation(
        `${input.label} contains evidence from the wrong source`,
      );
    }
  }
}

function validateResumeMatchEvidence(
  match: SemanticResumeMatch,
  requirements: z.infer<typeof requirementMapSchema>,
  availableEvidence: AvailableResumeMatchEvidence[],
  transport: z.infer<typeof semanticResumeMatchTransportSchema>,
) {
  const knownEvidence = new Map<string, AvailableResumeMatchEvidence>();
  for (const evidence of availableEvidence) {
    if (knownEvidence.has(evidence.referenceId)) {
      evidenceResultViolation(
        "Available Resume Match evidence contains duplicate reference identifiers",
      );
    }
    knownEvidence.set(evidence.referenceId, evidence);
  }
  const any = (references: string[], label: string) =>
    assertEvidenceReferences({ references, knownEvidence, label });
  const jd = (references: string[], label: string) =>
    assertEvidenceReferences({
      references,
      knownEvidence,
      label,
      expectedSource: "JD",
    });
  const profile = (references: string[], label: string) =>
    assertEvidenceReferences({
      references,
      knownEvidence,
      label,
      expectedSource: "PROFILE",
    });

  jd(
    transport.scoreEvidence.jdEvidenceReferences,
    "Resume Match score JD evidence",
  );
  profile(
    transport.scoreEvidence.profileEvidenceReferences,
    "Resume Match score profile evidence",
  );
  any(match.scoreEvidenceReferences, "Resume Match score evidence");
  any(match.evidenceReferences, "Resume Match aggregate evidence");

  for (const assessment of match.requirementAssessments) {
    const label = `Requirement ${assessment.requirementIndex}`;
    jd(assessment.jdEvidenceReferences, `${label} JD evidence`);
    profile(assessment.profileEvidenceReferences, `${label} profile evidence`);
    const requirement = requirements[assessment.requirementIndex];
    const transportAssessment = transport.requirementAssessments.find(
      (candidate) => candidate.requirementIndex === assessment.requirementIndex,
    );
    if (!transportAssessment && !assessment.isAmbiguous) {
      authoritativeResultViolation(`${label} is missing its semantic assessment`);
    }
    if (transportAssessment) {
      const profileEvidence = assessment.profileEvidenceReferences.map(
        (reference) => knownEvidence.get(reference)!,
      );
      const hasEvidenceType = (types: string[]) =>
        profileEvidence.some((evidence) => types.includes(evidence.evidenceType));
      if (
        transportAssessment.experienceEvidenceBasis ===
          "DIRECT_OR_RELATED_WORK_EXPERIENCE" &&
        !hasEvidenceType(["DIRECT_EXPERIENCE", "RELATED_EXPERIENCE"])
      ) {
        evidenceResultViolation(
          `${label} claims direct or related work experience without matching experience evidence`,
        );
      }
      if (
        transportAssessment.experienceEvidenceBasis ===
          "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE" &&
        !hasEvidenceType([
          "DIRECT_EXPERIENCE",
          "RELATED_EXPERIENCE",
          "TRANSFERABLE_EXPERIENCE",
          "TRANSFERABLE_SKILL",
        ])
      ) {
        evidenceResultViolation(
          `${label} claims transferable experience without experience evidence`,
        );
      }
      if (
        transportAssessment.experienceEvidenceBasis ===
          "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE" &&
        !hasEvidenceType(["SKILL", "TRANSFERABLE_SKILL"])
      ) {
        evidenceResultViolation(
          `${label} claims relevant skill or knowledge without skill evidence`,
        );
      }
      if (
        requirement?.category === "INDUSTRY" &&
        ["STRONG_MATCH", "PARTIAL_MATCH", "TRANSFERABLE_MATCH"].includes(
          assessment.classification,
        ) &&
        (transportAssessment.experienceEvidenceBasis !==
          "DIRECT_OR_RELATED_WORK_EXPERIENCE" ||
          !hasEvidenceType(["DIRECT_EXPERIENCE"]))
      ) {
        evidenceResultViolation(
          `${label} treats a specialized industry requirement as a match without direct specialized-experience evidence`,
        );
      }
      if (
        requirement?.category === "EXPERIENCE" &&
        transportAssessment.experienceEvidenceBasis ===
          "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE" &&
        assessment.classification !== "UNKNOWN"
      ) {
        evidenceResultViolation(
          `${label} treats skill or knowledge evidence as employment experience`,
        );
      }
      const directExperienceRequested =
        requirement?.category === "EXPERIENCE" &&
        /\bdirect\b/i.test(
          [requirement.requirement, requirement.experienceSpecificity]
            .filter(Boolean)
            .join(" "),
        );
      if (
        directExperienceRequested &&
        ["STRONG_MATCH", "PARTIAL_MATCH", "TRANSFERABLE_MATCH"].includes(
          assessment.classification,
        ) &&
        (transportAssessment.experienceEvidenceBasis !==
          "DIRECT_OR_RELATED_WORK_EXPERIENCE" ||
          !hasEvidenceType(["DIRECT_EXPERIENCE"]))
      ) {
        evidenceResultViolation(
          `${label} treats preparation or transferable experience as direct work experience`,
        );
      }
      if (
        ["DIRECT_SAAS_CUSTOMER_SUCCESS", "DIRECT_CUSTOMER_SUCCESS"].includes(
          assessment.matchedExperienceSpecificity,
        ) &&
        (transportAssessment.experienceEvidenceBasis !==
          "DIRECT_OR_RELATED_WORK_EXPERIENCE" ||
          !hasEvidenceType(["DIRECT_EXPERIENCE"]))
      ) {
        evidenceResultViolation(
          `${label} claims direct experience without direct profile experience evidence`,
        );
      }
    }
    if (
      requirement &&
      !assessment.jdEvidenceReferences.some((reference) =>
        requirement.evidenceReferences.includes(reference),
      )
    ) {
      evidenceResultViolation(
        `${label} is not connected to authoritative JD evidence`,
      );
    }
    any(
      assessment.decisionImpactEvidenceReferences,
      `${label} decision-impact evidence`,
    );
    const assessmentReferences = new Set([
      ...assessment.jdEvidenceReferences,
      ...assessment.profileEvidenceReferences,
    ]);
    if (
      assessment.decisionImpactEvidenceReferences.some(
        (reference) => !assessmentReferences.has(reference),
      )
    ) {
      evidenceResultViolation(
        `${label} decision-impact evidence is outside its assessment evidence`,
      );
    }
    if (assessment.decisionImpact === "DECISIVE_DISQUALIFIER") {
      if (
        !transportAssessment ||
        !("decisionImpactEvidence" in transportAssessment)
      ) {
        evidenceResultViolation(
          `${label} decisive impact is missing source-separated evidence`,
        );
      }
      jd(
        transportAssessment.decisionImpactEvidence.jdEvidenceReferences,
        `${label} decisive-impact JD evidence`,
      );
      profile(
        transportAssessment.decisionImpactEvidence.profileEvidenceReferences,
        `${label} decisive-impact profile evidence`,
      );
      const decisionJd = assessment.decisionImpactEvidenceReferences.filter(
        (reference) => knownEvidence.get(reference)?.sourceType !== "USER_PROFILE",
      );
      const decisionProfile =
        assessment.decisionImpactEvidenceReferences.filter(
          (reference) =>
            knownEvidence.get(reference)?.sourceType === "USER_PROFILE",
        );
      if (decisionJd.length === 0 || decisionProfile.length === 0) {
        evidenceResultViolation(
          `${label} decisive impact requires both evidence sources`,
        );
      }
      jd(decisionJd, `${label} decisive-impact JD evidence`);
      profile(decisionProfile, `${label} decisive-impact profile evidence`);
    }
  }

  for (const [name, dimension] of Object.entries({
    statedYears: match.effectiveSeniority.statedYears,
    requirementStrength: match.effectiveSeniority.requirementStrength,
    experienceSpecificity: match.effectiveSeniority.experienceSpecificity,
  })) {
    any(dimension.evidenceReferences, `Effective Seniority ${name} evidence`);
  }
  jd(
    match.effectiveSeniority.actualResponsibilitySeniority.evidenceReferences,
    "Actual-responsibility seniority evidence",
  );
  for (const signal of match.effectiveSeniority.actualResponsibilitySeniority
    .signals) {
    jd(signal.evidenceReferences, `Seniority signal ${signal.signal} evidence`);
  }
  const effectiveEvidence = match.effectiveSeniority.evidenceReferences;
  jd(
    transport.effectiveSeniority.evidence.jdEvidenceReferences,
    "Effective Seniority JD evidence",
  );
  profile(
    transport.effectiveSeniority.evidence.profileEvidenceReferences,
    "Effective Seniority profile evidence",
  );
  any(effectiveEvidence, "Effective Seniority evidence");

  for (const [name, findings] of Object.entries({
    strongStrengths: match.strongStrengths,
    partialMatches: match.partialMatches,
    genuineGaps: match.genuineGaps,
  })) {
    for (const finding of findings) {
      any(finding.evidenceReferences, `${name} finding evidence`);
    }
  }
  for (const unknown of match.unknowns) {
    any(unknown.evidenceReferences, `Unknown ${unknown.code} evidence`);
  }
  for (const [
    index,
    recommendation,
  ] of match.positioningRecommendations.entries()) {
    const transportRecommendation =
      transport.positioningRecommendations[index]!;
    jd(
      transportRecommendation.evidence.jdEvidenceReferences,
      `Positioning recommendation ${index} JD evidence`,
    );
    profile(
      transportRecommendation.evidence.profileEvidenceReferences,
      `Positioning recommendation ${index} profile evidence`,
    );
    any(
      recommendation.evidenceReferences,
      "Positioning-recommendation evidence",
    );
  }
  for (const contradiction of match.contradictions) {
    any(contradiction.evidenceReferencesA, "Contradiction claim A evidence");
    any(contradiction.evidenceReferencesB, "Contradiction claim B evidence");
  }
}

function deterministicAmbiguousAssessment(
  requirement: z.infer<typeof requirementMapSchema>[number],
  requirementIndex: number,
) {
  return {
    requirementIndex,
    requirementText: requirement.requirement,
    category: requirement.category,
    strength: requirement.strength,
    statedYears: requirement.statedYears,
    statedYearsMaximum: requirement.statedYearsMaximum,
    statedYearsOpenEnded: requirement.statedYearsOpenEnded,
    requestedExperienceSpecificity: requirement.experienceSpecificity,
    isAmbiguous: requirement.ambiguity.isAmbiguous,
    ambiguityExplanation: requirement.ambiguity.explanation,
    classification: "UNKNOWN" as const,
    matchedExperienceSpecificity: "UNKNOWN" as const,
    importanceExplanation:
      "Requirement importance remains Unknown because the source requirement is ambiguous.",
    decisionImpact: "NON_DECISIVE" as const,
    decisionImpactExplanation:
      "Decision impact remains non-decisive because the source requirement is ambiguous.",
    decisionImpactEvidenceReferences: [],
    explanation:
      requirement.ambiguity.explanation ??
      "The source wording is ambiguous, so no candidate match judgment is made.",
    supportedPortion: null,
    unsupportedPortion: null,
    jdEvidenceReferences: requirement.evidenceReferences,
    profileEvidenceReferences: [],
  };
}

export function semanticResumeMatchFromTransport(
  value: unknown,
  authoritativeRequirementMap: z.input<typeof requirementMapSchema>,
  availableEvidence: AvailableResumeMatchEvidence[],
  jobEvidenceCatalog: ResumeMatchJobEvidenceCatalog =
    semanticResumeMatchJobEvidenceCatalog(availableEvidence),
): SemanticResumeMatch {
  const providerResult = createSemanticResumeMatchTransportSchema(
    availableEvidence,
    authoritativeRequirementMap,
  ).safeParse(value);
  const transport = semanticResumeMatchTransportSchema.parse(
    providerResult.success
      ? restoreAssessmentLocalDecisionImpactEvidence(providerResult.data)
      : value,
  );
  assertUniqueRequirementProfileEvidenceReferences(transport);
  // JSON Schema cannot compare sibling arrays. Reject before constructing any
  // domain result; never repair the model's evidence selection by substitution.
  const knownEvidence = new Map(availableEvidence.map((item) => [item.referenceId, item]));
  for (const assessment of transport.requirementAssessments) {
    const label = `Requirement ${assessment.requirementIndex}`;
    assertEvidenceReferences({ references: assessment.jdEvidenceReferences, knownEvidence, label: `${label} JD evidence`, expectedSource: "JD" });
    assertEvidenceReferences({ references: assessment.profileEvidenceReferences, knownEvidence, label: `${label} profile evidence`, expectedSource: "PROFILE" });
    const decisionReferences = "decisionImpactEvidence" in assessment
      ? mergeBothSourceEvidence(assessment.decisionImpactEvidence)
      : assessment.decisionImpactEvidenceReferences;
    assertEvidenceReferences({ references: decisionReferences, knownEvidence, label: `${label} decision-impact evidence` });
    const assessmentReferences = new Set([...assessment.jdEvidenceReferences, ...assessment.profileEvidenceReferences]);
    if (decisionReferences.some((reference) => !assessmentReferences.has(reference))) {
      evidenceResultViolation(`${label} decision-impact evidence is outside its assessment evidence`);
    }
  }
  const requirements = requirementMapSchema.parse(authoritativeRequirementMap);
  const assessmentsByIndex = new Map<
    number,
    (typeof transport.requirementAssessments)[number]
  >();

  for (const assessment of transport.requirementAssessments) {
    if (assessment.requirementIndex >= requirements.length) {
      authoritativeResultViolation(
        `Resume Match references unknown requirement index ${assessment.requirementIndex}`,
      );
    }
    if (requirements[assessment.requirementIndex]!.ambiguity.isAmbiguous) {
      authoritativeResultViolation(
        `Resume Match attempted to classify predetermined ambiguous requirement ${assessment.requirementIndex}`,
      );
    }
    if (assessmentsByIndex.has(assessment.requirementIndex)) {
      authoritativeResultViolation(
        `Resume Match repeats requirement index ${assessment.requirementIndex}`,
      );
    }
    const authoritative = requirements[assessment.requirementIndex]!;
    if (
      authoritative.category === "INDUSTRY" &&
      ["STRONG_MATCH", "PARTIAL_MATCH", "TRANSFERABLE_MATCH"].includes(assessment.classification) &&
      (assessment.experienceEvidenceBasis !== "DIRECT_OR_RELATED_WORK_EXPERIENCE" ||
        !assessment.profileEvidenceReferences.some((reference) =>
          knownEvidence.get(reference)?.evidenceType === "DIRECT_EXPERIENCE",
        ))
    ) {
      evidenceResultViolation(
        `Requirement ${assessment.requirementIndex} treats a specialized industry requirement as a match without direct specialized-experience evidence`,
      );
    }
    if (
      assessment.decisionImpact === "DECISIVE_DISQUALIFIER" &&
      authoritative.strength !== "REQUIRED"
    ) {
      authoritativeResultViolation(
        `Resume Match assigned decisive impact to ineligible requirement ${assessment.requirementIndex}`,
      );
    }
    assessmentsByIndex.set(assessment.requirementIndex, assessment);
  }

  const missingIndexes = requirements
    .map((requirement, index) => ({ requirement, index }))
    .filter(({ requirement }) => !requirement.ambiguity.isAmbiguous)
    .map(({ index }) => index)
    .filter((index) => !assessmentsByIndex.has(index));
  if (missingIndexes.length > 0) {
    authoritativeResultViolation(
      `Resume Match omitted requirement indexes: ${missingIndexes.join(", ")}`,
    );
  }

  const requirementAssessments = requirements.map((requirement, index) =>
    requirement.ambiguity.isAmbiguous
      ? deterministicAmbiguousAssessment(requirement, index)
      : (() => {
          const assessment = assessmentsByIndex.get(index)!;
          const {
            experienceEvidenceBasis: _experienceEvidenceBasis,
            ...assessmentWithoutBasis
          } = assessment;
          const semanticAssessment =
            "decisionImpactEvidence" in assessmentWithoutBasis
              ? (({ decisionImpactEvidence, ...semanticFields }) => ({
                  ...semanticFields,
                  decisionImpactEvidenceReferences:
                    mergeBothSourceEvidence(decisionImpactEvidence),
                }))(assessmentWithoutBasis)
              : assessmentWithoutBasis;
          return {
            ...semanticAssessment,
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
          };
        })(),
  );
  const {
    scoreEvidence,
    effectiveSeniority: transportEffectiveSeniority,
    positioningRecommendations: transportPositioningRecommendations,
    ...transportResult
  } = transport;
  const domainCandidate = {
    ...transportResult,
    scoreEvidenceReferences: mergeBothSourceEvidence(scoreEvidence),
    requirementAssessments,
    genuineGaps: requirementAssessments
      .filter((assessment) => assessment.classification === "GENUINE_GAP")
      .map((assessment) => ({
        finding: assessment.explanation,
        evidenceReferences: [
          ...assessment.jdEvidenceReferences,
          ...assessment.profileEvidenceReferences,
        ],
      })),
    effectiveSeniority: {
      ...((({
        evidence: _evidence,
        actualResponsibilitySeniority,
        ...semanticFields
      }) => ({
        ...semanticFields,
        actualResponsibilitySeniority: {
          ...(({
            evidenceIndexes: _evidenceIndexes,
            ...responsibilityFields
          }) => responsibilityFields)(actualResponsibilitySeniority),
          signals: actualResponsibilitySeniority.signals.map(
            ({ evidenceIndexes, ...signal }) => ({
              ...signal,
              evidenceReferences: evidenceReferencesFromIndexes(
                evidenceIndexes,
                jobEvidenceCatalog,
                `Seniority signal ${signal.signal}`,
              ),
            }),
          ),
          evidenceReferences: evidenceReferencesFromIndexes(
            actualResponsibilitySeniority.evidenceIndexes,
            jobEvidenceCatalog,
            "Actual-responsibility seniority",
          ),
        },
      }))(transportEffectiveSeniority)),
      evidenceReferences: mergeBothSourceEvidence(
        transportEffectiveSeniority.evidence,
      ),
    },
    positioningRecommendations: transportPositioningRecommendations.map(
      ({ evidence, ...recommendation }) => ({
        ...recommendation,
        evidenceReferences: mergeBothSourceEvidence(evidence),
      }),
    ),
  };
  const parsedMatch = semanticResumeMatchSchema.safeParse(domainCandidate);
  if (!parsedMatch.success) {
    authoritativeResultViolation(
      "Resume Match violated the authoritative domain contract",
    );
  }
  const match = parsedMatch.data;
  const seniorityRequirementIndexes = [
    ...match.effectiveSeniority.statedYears.requirementIndexes,
    ...match.effectiveSeniority.requirementStrength.requirementIndexes,
    ...match.effectiveSeniority.experienceSpecificity.requirementIndexes,
  ];
  if (
    seniorityRequirementIndexes.some(
      (requirementIndex) => requirementIndex >= requirements.length,
    )
  ) {
    authoritativeResultViolation(
      "Resume Match Effective Seniority references an unknown requirement",
    );
  }
  validateResumeMatchEvidence(
    match,
    requirements,
    availableEvidence,
    transport,
  );
  return match;
}

export const resumeMatchDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({
      evaluated: z.literal(true),
      band: resumeMatchBandSchema,
      match: semanticResumeMatchSchema,
    })
    .strict(),
]);

export type ResumeMatchData = z.infer<typeof resumeMatchDataSchema>;
export type SemanticResumeMatch = z.infer<typeof semanticResumeMatchSchema>;
