import {
  contradictionDraftSchema,
  type EvidenceRecordDraft,
} from "@ai-career/evidence";
import { StageExecutionError } from "@ai-career/evaluation";
import { z } from "zod";
import {
  customerSuccessExperienceLadder,
  requirementCategorySchema,
  requirementMapSchema,
  requirementStrengthSchema,
  type RequirementExperienceLevel,
} from "./maps";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";
import { profileLimitationEvidenceType } from "../profile/user-profile";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

export const customerSuccessResumeMatchPromptVersion = "cs-resume-match-v4";

export const requirementMatchClassificationSchema = z.enum([
  "STRONG_MATCH",
  "TRANSFERABLE_MATCH",
  "PARTIAL_MATCH",
  "GENUINE_GAP",
  "UNKNOWN",
]);

export const matchedExperienceSpecificitySchema = z.enum([
  ...customerSuccessExperienceLadder,
  // Evidence directly demonstrates a requirement whose subject is not a
  // Customer Success level, such as remote work or process improvement.
  "REQUIREMENT_SPECIFIC",
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

const providerNonGapFields = {
  ...transportRequirementFields,
  decisionImpact: z.literal("NON_DECISIVE"),
};

const transportStrongRequirementSchema = z
  .object({
    ...transportNonGapFields,
    classification: z.literal("STRONG_MATCH"),
    matchedExperienceSpecificity: z.enum([
      ...customerSuccessExperienceLadder,
      "REQUIREMENT_SPECIFIC",
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
// Actual work-experience records, by declared basis, for INDUSTRY matching.
const industryWorkEvidenceTypes = {
  DIRECT_OR_RELATED_WORK_EXPERIENCE: directOrRelatedWorkEvidenceTypes,
  BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE: new Set([
    "DIRECT_EXPERIENCE",
    "RELATED_EXPERIENCE",
    "TRANSFERABLE_EXPERIENCE",
  ]),
} as const;
const requirementRelevantKnowledgeEvidenceTypes = new Set([
  "SKILL",
  "TRANSFERABLE_SKILL",
]);

type PositiveExperienceEvidenceBasis = Exclude<
  z.infer<typeof requirementExperienceEvidenceBasisSchema>,
  "NO_SUPPORTING_EXPERIENCE" | "UNKNOWN"
>;

type ResumeMatchRequirement = z.infer<typeof requirementMapSchema>[number];
type PositiveRequirementClassification =
  | "STRONG_MATCH"
  | "TRANSFERABLE_MATCH"
  | "PARTIAL_MATCH";

const positiveSpecificities = {
  STRONG_MATCH: [...customerSuccessExperienceLadder, "REQUIREMENT_SPECIFIC"],
  TRANSFERABLE_MATCH: ["TRANSFERABLE"],
  // Preserve the existing partial-match contract, including unresolved portions.
  PARTIAL_MATCH: matchedExperienceSpecificitySchema.options,
} satisfies Record<PositiveRequirementClassification, string[]>;

// A Genuine Gap needs affirmative proof: a structured profile limitation, never
// mere absence of evidence and never wording. A limitation proves a gap only
// for a requirement of its own category; for EXPERIENCE, only when the level it
// disclaims covers every level that satisfies the requirement.
export interface ResumeMatchLimitation {
  category: z.infer<typeof requirementCategorySchema>;
  disclaimedExperienceSpecificity: RequirementExperienceLevel | null;
}

function profileLimitation(evidence: AvailableResumeMatchEvidence) {
  return evidence.sourceType === "USER_PROFILE" &&
    evidence.evidenceType === profileLimitationEvidenceType
    ? evidence.limitation
    : undefined;
}

function ladderRank(level: string) {
  return (customerSuccessExperienceLadder as readonly string[]).indexOf(level);
}

// An EXPERIENCE requirement without a level asserts no experience-level
// semantics: deterministic extraction never states one. No level is assumed;
// such a requirement gets no ladder gating and admits no gap proof. Maps from
// JD Reconstruction must carry the level (the Resume Match stage enforces it).
function requirementExperienceLevel(requirement?: ResumeMatchRequirement) {
  return requirement?.category === "EXPERIENCE"
    ? requirement.minimumExperienceSpecificity
    : undefined;
}

function establishesGenuineGap(
  evidence: AvailableResumeMatchEvidence,
  requirement: ResumeMatchRequirement,
) {
  const limitation = profileLimitation(evidence);
  if (!limitation || limitation.category !== requirement.category) return false;
  if (requirement.category !== "EXPERIENCE") return true;
  const required = requirementExperienceLevel(requirement);
  const disclaimed = limitation.disclaimedExperienceSpecificity;
  // Without a structured level on both sides, relevance is not established.
  if (required === undefined || disclaimed === null) return false;
  if (required === "ANY_WORK_EXPERIENCE" || disclaimed === "ANY_WORK_EXPERIENCE") {
    return required === disclaimed;
  }
  // Disclaiming a rung also disclaims every more specific rung.
  return ladderRank(required) <= ladderRank(disclaimed);
}

// A limitation without a ladder level (any non-EXPERIENCE category, or
// EXPERIENCE disclaiming ANY_WORK_EXPERIENCE) is relevant by category alone:
// limitations carry no subject key, so it cannot say which same-category
// requirement it disclaims. It proves a gap only when it is the sole such
// limitation and the requirement the sole assessed requirement under that
// key; otherwise the requirement fails safe to Unknown. This is a conservative
// residual until limitations and requirements carry subject keys.
function categoryOnlyRelevanceKey(
  category: string,
  level: RequirementExperienceLevel | null | undefined,
) {
  if (category !== "EXPERIENCE") return category;
  return level === "ANY_WORK_EXPERIENCE" ? "EXPERIENCE:ANY_WORK_EXPERIENCE" : undefined;
}

function genuineGapProofByRequirement(
  availableEvidence: AvailableResumeMatchEvidence[],
  requirements: ReadonlyArray<ResumeMatchRequirement>,
): ReadonlyMap<number, ReadonlySet<string>> {
  const count = (keys: Array<string | undefined>) => {
    const counts = new Map<string, number>();
    for (const key of keys) {
      if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const assessed = requirements
    .map((requirement, index) => ({ requirement, index }))
    .filter(({ requirement }) => !requirement.ambiguity.isAmbiguous);
  const requirementCounts = count(assessed.map(({ requirement }) =>
    categoryOnlyRelevanceKey(requirement.category, requirementExperienceLevel(requirement))));
  const limitationCounts = count(availableEvidence.map((evidence) => {
    const limitation = profileLimitation(evidence);
    return limitation
      ? categoryOnlyRelevanceKey(limitation.category, limitation.disclaimedExperienceSpecificity)
      : undefined;
  }));
  return new Map(assessed.map(({ requirement, index }) => {
    const key = categoryOnlyRelevanceKey(
      requirement.category,
      requirementExperienceLevel(requirement),
    );
    const unique = key === undefined ||
      (requirementCounts.get(key) === 1 && limitationCounts.get(key) === 1);
    return [index, new Set(unique
      ? availableEvidence
          .filter((evidence) => establishesGenuineGap(evidence, requirement))
          .map((evidence) => evidence.referenceId)
      : [])];
  }));
}

function createPositiveRequirementSchema(input: {
  classification: "STRONG_MATCH" | "TRANSFERABLE_MATCH" | "PARTIAL_MATCH";
  evidenceBasis: PositiveExperienceEvidenceBasis;
  profileReferenceIds: string[];
  specificities: string[];
  referenceCatalogs: Map<string, z.ZodType<string>>;
}) {
  const profileEvidenceReferences = providerProfileReferenceSchema(
    input.profileReferenceIds,
    input.referenceCatalogs,
  );
  if (!profileEvidenceReferences) return null;
  return z.object({
    ...providerNonGapFields,
    classification: z.literal(input.classification),
    matchedExperienceSpecificity: z.enum(
      input.specificities as [string, ...string[]],
    ),
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
  }).strict();
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
  z.object({
    ...providerGapFields,
    decisionImpact: z.literal("DECISIVE_DISQUALIFIER"),
    decisionImpactExplanation: transportRequiredText,
  }).strict(),
  z.object({
    ...providerGapFields,
    decisionImpact: z.literal("MATERIAL_UNCERTAINTY"),
    decisionImpactExplanation: transportRequiredText,
  }).strict(),
  z.object({
    ...providerGapFields,
    decisionImpact: z.literal("NON_DECISIVE"),
    decisionImpactExplanation: transportRequiredText,
  }).strict(),
]);

const providerUnknownRequirementSchema = z.object({
  ...transportRequirementFields,
  classification: z.literal("UNKNOWN"),
  matchedExperienceSpecificity: z.literal("UNKNOWN"),
  experienceEvidenceBasis: z.literal("UNKNOWN"),
  decisionImpact: z.literal("NON_DECISIVE"),
  supportedPortion: z.null(),
  unsupportedPortion: z.null(),
  profileEvidenceReferences: transportEvidenceReferences,
}).strict();

// Experience-level and startup legality come only from the structured
// requirement fields authored by JD Reconstruction; requirement wording is
// never consulted.

const startupSpecializationPattern = /\b(?:startup|start-up|startups|start-ups)\b/i;

function requiresStartupSpecialization(requirement?: ResumeMatchRequirement) {
  return requirement?.category === "EXPERIENCE" &&
    requirement.requiresStartupExperience === true;
}

function supportsStartupSpecialization(evidence: AvailableResumeMatchEvidence) {
  if (evidence.sourceType !== "USER_PROFILE") return false;
  if (evidence.startupSpecialization !== undefined) {
    return evidence.startupSpecialization;
  }
  if (!broaderOrTransferableWorkEvidenceTypes.has(evidence.evidenceType)) {
    return false;
  }
  return startupSpecializationPattern.test(
    [evidence.claim, evidence.sourceText].filter(Boolean).join(" "),
  );
}

// The most specific ladder rung each profile record type can establish. Profile
// relationship labels are relative to Customer Success, as is the ladder.
const evidenceLadderReach: Readonly<Record<string, number>> = {
  DIRECT_EXPERIENCE: ladderRank("DIRECT_SAAS_CUSTOMER_SUCCESS"),
  RELATED_EXPERIENCE: ladderRank("RELATED_CUSTOMER_RELATIONSHIP"),
  TRANSFERABLE_EXPERIENCE: ladderRank("BROADER_CUSTOMER_FACING"),
  TRANSFERABLE_SKILL: ladderRank("BROADER_CUSTOMER_FACING"),
};

// One relational model for provider variants and pre-domain conversion checks.
// Compatibility is relative to the requirement. For a requirement on the
// Customer Success ladder, a ladder label must be one the cited record can
// establish and a strong match must reach the requirement's minimum level.
// REQUIREMENT_SPECIFIC describes requirements whose subject is not a ladder
// level; their ladder labels keep the existing direct-label rule.
function positiveRequirementCompatibility(
  classification: PositiveRequirementClassification,
  specificity: string,
  basis: PositiveExperienceEvidenceBasis,
  requirement?: ResumeMatchRequirement,
): ReadonlySet<string> {
  if (
    !(positiveSpecificities[classification] as readonly string[]).includes(specificity) ||
    (classification === "TRANSFERABLE_MATCH" && basis !== "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE") ||
    (requirement?.category === "EXPERIENCE" && basis === "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE")
  ) return new Set();
  // INDUSTRY is relative to its own subject, not the Customer Success ladder:
  // actual work-experience records establish it whatever their Customer
  // Success relationship, and whether the cited work belongs to the industry
  // is the provider's bounded judgment. Skills, certifications, coursework,
  // tools, self-study and readiness never establish it, nor does transfer.
  if (requirement?.category === "INDUSTRY") {
    return specificity === "REQUIREMENT_SPECIFIC" &&
      classification !== "TRANSFERABLE_MATCH" &&
      basis !== "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE"
      ? industryWorkEvidenceTypes[basis]
      : new Set();
  }
  const basisTypes = basis === "DIRECT_OR_RELATED_WORK_EXPERIENCE"
    ? directOrRelatedWorkEvidenceTypes
    : basis === "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE"
      ? broaderOrTransferableWorkEvidenceTypes
      : requirementRelevantKnowledgeEvidenceTypes;
  const level = requirementExperienceLevel(requirement);
  const required = level === undefined ? -1 : ladderRank(level);
  if (specificity === "REQUIREMENT_SPECIFIC") {
    return required < 0 ? basisTypes : new Set();
  }
  if (required >= 0) {
    if (classification === "STRONG_MATCH" && ladderRank(specificity) > required) {
      return new Set();
    }
    // Direct Customer Success employment cannot be met by transfer.
    if (
      classification === "TRANSFERABLE_MATCH" &&
      required <= ladderRank("DIRECT_CUSTOMER_SUCCESS")
    ) return new Set();
  }
  const labelRank = ladderRank(specificity);
  if (labelRank < 0) return basisTypes;
  if (labelRank <= ladderRank("DIRECT_CUSTOMER_SUCCESS")) {
    return basis === "DIRECT_OR_RELATED_WORK_EXPERIENCE"
      ? new Set(["DIRECT_EXPERIENCE"])
      : new Set();
  }
  if (required < 0) return basisTypes;
  return new Set([...basisTypes].filter((type) =>
    (evidenceLadderReach[type] ?? Number.POSITIVE_INFINITY) <= labelRank));
}

function providerProfileReferenceSchema(
  referenceIds: string[],
  catalogs: Map<string, z.ZodType<string>>,
) {
  const uniqueReferenceIds = [...new Set(referenceIds)];
  if (uniqueReferenceIds.length === 0) {
    return null;
  }
  const key = JSON.stringify(uniqueReferenceIds);
  let element = catalogs.get(key);
  if (!element) {
    element = (uniqueReferenceIds.length === 1
      ? z.literal(uniqueReferenceIds[0]!)
      : z.enum(uniqueReferenceIds as [string, ...string[]]))
      .meta({ id: `resumeMatchEvidenceCatalog${catalogs.size}` });
    catalogs.set(key, element);
  }
  // Named definitions keep repeated source/basis catalogs within the strict
  // provider enum limit. Catalog instances belong to this schema construction.
  return z.array(element).min(1);
}

// One source-local collection gives each selected evidence identity exactly one
// authored purpose. JSON Schema cannot enforce uniqueness by one object field,
// so conversion still rejects repeated identities, but the provider can no
// longer select the same reference independently in two sibling partitions.
function providerAssessmentEvidenceSchema(
  references: z.ZodArray | null,
  id: string,
  required: boolean,
) {
  const assignment = z.object({
    evidenceReference: references
      ? references.element
      : z.literal("NO_REFERENCES_AVAILABLE"),
    purpose: z.enum(["DECISION_IMPACT", "ASSESSMENT_ONLY"]),
  }).strict();
  const assignments = references
    ? z.array(assignment)
    : z.array(assignment).max(0);
  return z.object({
    evidenceAssignments: (required ? assignments.min(1) : assignments).describe(
      "Evidence assignments for one source and requirement. Include each evidenceReference at most once and assign exactly one purpose: DECISION_IMPACT when it changes the decision, otherwise ASSESSMENT_ONLY. Never repeat or reassign one reference.",
    ),
  }).strict().meta({ id });
}

// A Genuine Gap must cite at least one relevant profile limitation. Those
// records get their own collection, bound per requirement, so the provider
// grammar carries both the proof and the relevance rule. The ordinary gap
// profileEvidence catalog excludes limitations, keeping one identity in exactly
// one collection.
function providerGapEvidenceSchema(references: z.ZodArray, id: string) {
  const assignment = z.object({
    evidenceReference: references.element,
    purpose: z.enum(["DECISION_IMPACT", "ASSESSMENT_ONLY"]),
  }).strict();
  return z.object({
    evidenceAssignments: z.array(assignment).min(1).describe(
      "Profile evidence that explicitly establishes this requirement is absent. Include at least one; list each evidenceReference at most once with exactly one purpose: DECISION_IMPACT when it changes the decision (a decisive gap needs at least one), otherwise ASSESSMENT_ONLY.",
    ),
  }).strict().meta({ id });
}

function providerRequirementAssessmentSchema(
  availableEvidence: AvailableResumeMatchEvidence[],
  requirementMap?: z.infer<typeof requirementMapSchema>,
) {
  const referenceCatalogs = new Map<string, z.ZodType<string>>();
  const semanticRequirements = requirementMap?.map((requirement, index) => ({ requirement, index }))
    .filter(({ requirement }) => !requirement.ambiguity.isAmbiguous);
  const hasStartupEvidence = availableEvidence.some(supportsStartupSpecialization);
  const predeterminedStartupUnknownIndexes = new Set(
    semanticRequirements
      ?.filter(({ requirement }) =>
        requiresStartupSpecialization(requirement) && !hasStartupEvidence)
      .map(({ index }) => index) ?? [],
  );
  const constrainIndexes = (schema: z.ZodObject, indexes?: number[]) =>
    indexes === undefined ? schema : schema.extend({
      requirementIndex: indexes.length === 1
        ? z.literal(indexes[0]!)
        : z.union(indexes.map((index) => z.literal(index)) as [
            z.ZodLiteral<number>,
            z.ZodLiteral<number>,
            ...z.ZodLiteral<number>[],
          ]),
    });
  const bases: PositiveExperienceEvidenceBasis[] = [
    "DIRECT_OR_RELATED_WORK_EXPERIENCE",
    "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE",
    "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE",
  ];
  const groups = new Map<
    string,
    { requirement?: ResumeMatchRequirement; indexes?: number[] }
  >();
  if (semanticRequirements === undefined) groups.set("unspecified", {});
  for (const { requirement, index } of semanticRequirements ?? []) {
    if (predeterminedStartupUnknownIndexes.has(index)) continue;
    // Requirements share variants exactly when they share an evidence contract.
    const key = requirement.category === "INDUSTRY"
      ? "industry"
      : requirement.category === "EXPERIENCE"
        ? `experience:${requirementExperienceLevel(requirement) ?? "unspecified"}:${requiresStartupSpecialization(requirement)}`
        : "ordinary";
    const group = groups.get(key) ?? { requirement, indexes: [] };
    group.indexes!.push(index);
    groups.set(key, group);
  }
  const schemas: z.ZodObject[] = [];
  // Requirements in different groups often admit identical variants; each
  // distinct variant is emitted once with the union of its requirement indexes.
  const variants = new Map<string, {
    classification: PositiveRequirementClassification;
    evidenceBasis: PositiveExperienceEvidenceBasis;
    catalog: { specificities: string[]; profileReferenceIds: string[] };
    indexes?: number[];
  }>();
  for (const group of groups.values()) {
    for (const evidenceBasis of bases) {
      for (
        const classification of Object.keys(
          positiveSpecificities,
        ) as PositiveRequirementClassification[]
      ) {
        const catalogs = new Map<
          string,
          { specificities: string[]; profileReferenceIds: string[] }
        >();
        for (const specificity of positiveSpecificities[classification]) {
          const types = positiveRequirementCompatibility(
            classification,
            specificity,
            evidenceBasis,
            group.requirement,
          );
          const profileReferenceIds = availableEvidence
            .filter((evidence) =>
              evidence.sourceType === "USER_PROFILE" &&
              types.has(evidence.evidenceType) &&
              (!requiresStartupSpecialization(group.requirement) ||
                supportsStartupSpecialization(evidence)),
            )
            .map((evidence) => evidence.referenceId);
          if (profileReferenceIds.length === 0) continue;
          const key = JSON.stringify(profileReferenceIds);
          const catalog = catalogs.get(key) ?? {
            specificities: [],
            profileReferenceIds,
          };
          catalog.specificities.push(specificity);
          catalogs.set(key, catalog);
        }
        for (const catalog of catalogs.values()) {
          const key = JSON.stringify([classification, evidenceBasis, catalog]);
          const variant = variants.get(key);
          if (variant) {
            variant.indexes = variant.indexes && group.indexes
              ? [...variant.indexes, ...group.indexes]
              : undefined;
          } else {
            variants.set(key, { classification, evidenceBasis, catalog, indexes: group.indexes });
          }
        }
      }
    }
  }
  for (const { classification, evidenceBasis, catalog, indexes } of variants.values()) {
    const schema = createPositiveRequirementSchema({
      classification,
      evidenceBasis,
      ...catalog,
      referenceCatalogs,
    });
    if (schema) {
      schemas.push(constrainIndexes(schema, indexes && [...indexes].sort((a, b) => a - b)));
    }
  }
  const allIndexes = semanticRequirements?.map(({ index }) => index);
  const profileReferences = providerProfileReferenceSchema(availableEvidence
    .filter((evidence) => evidence.sourceType === "USER_PROFILE")
    .map((evidence) => evidence.referenceId), referenceCatalogs);
  const jdReferences = providerProfileReferenceSchema(availableEvidence
    .filter((evidence) => evidence.sourceType !== "USER_PROFILE")
    .map((evidence) => evidence.referenceId), referenceCatalogs);
  if (semanticRequirements === undefined) {
    for (const schema of providerGapRequirementSchema.options) {
      if (profileReferences) {
        schemas.push(schema.extend({ profileEvidenceReferences: profileReferences }));
      }
    }
  }
  if (allIndexes === undefined || allIndexes.length > 0) {
    schemas.push(constrainIndexes(
      providerUnknownRequirementSchema.extend({
        profileEvidenceReferences: profileReferences
          ? z.array(profileReferences.element)
          : transportEvidenceReferences.max(0),
      }),
      allIndexes,
    ));
  }

  const groupedEvidenceByElement = new Map<
    unknown,
    { required?: z.ZodObject; optional?: z.ZodObject }
  >();
  let groupedEvidenceSchemaCount = 0;
  let emptyAssessmentEvidence: z.ZodObject | undefined;
  const groupedEvidence = (
    references: z.ZodArray | null,
    required: boolean,
  ): z.ZodObject => {
    if (!references) {
      emptyAssessmentEvidence ??= providerAssessmentEvidenceSchema(
        null,
        "resumeMatchEmptyAssessmentEvidence",
        false,
      );
      return emptyAssessmentEvidence;
    }
    const cached = groupedEvidenceByElement.get(references.element);
    const cacheKey = required ? "required" : "optional";
    const cachedSchema = cached?.[cacheKey];
    if (cachedSchema) return cachedSchema;
    const created = providerAssessmentEvidenceSchema(
      references,
      "resumeMatchAssessmentEvidence" + groupedEvidenceSchemaCount++,
      required,
    );
    groupedEvidenceByElement.set(references.element, {
      ...cached,
      [cacheKey]: created,
    });
    return created;
  };
  const bindEvidence = (schema: z.ZodObject) =>
    schema
      .omit({ jdEvidenceReferences: true, profileEvidenceReferences: true })
      .extend({
        jdEvidence: groupedEvidence(jdReferences, true),
        profileEvidence: groupedEvidence(
          schema.shape.profileEvidenceReferences as z.ZodArray,
          schema.shape.classification.value !== "UNKNOWN",
        ),
      });
  const boundGapSchemas: z.ZodObject[] = [];
  // Limitation records are only ever gap proof, never ordinary gap context.
  const contextReferences = providerProfileReferenceSchema(
    availableEvidence
      .filter((evidence) =>
        evidence.sourceType === "USER_PROFILE" && !profileLimitation(evidence))
      .map((evidence) => evidence.referenceId),
    referenceCatalogs,
  );
  const gapEvidenceByElement = new Map<unknown, z.ZodObject>();
  const gapProof = requirementMap === undefined
    ? new Map<number, ReadonlySet<string>>()
    : genuineGapProofByRequirement(availableEvidence, requirementMap);
  for (const schema of providerGapRequirementSchema.options) {
    if (semanticRequirements === undefined) break;
    const decisive = schema.shape.decisionImpact.value === "DECISIVE_DISQUALIFIER";
    // Each requirement may cite as gap proof only the limitations relevant to
    // it; requirements with the same relevant limitations share one variant.
    const groupsByProof = new Map<string, { proof: string[]; indexes: number[] }>();
    for (const { requirement, index } of semanticRequirements) {
      if (
        predeterminedStartupUnknownIndexes.has(index) ||
        (decisive && requirement.strength !== "REQUIRED")
      ) continue;
      const proof = [...(gapProof.get(index) ?? [])];
      if (proof.length === 0) continue;
      const key = JSON.stringify(proof);
      const group = groupsByProof.get(key) ?? { proof, indexes: [] };
      group.indexes.push(index);
      groupsByProof.set(key, group);
    }
    for (const { proof, indexes } of groupsByProof.values()) {
      const references = providerProfileReferenceSchema(proof, referenceCatalogs)!;
      let gapEvidence = gapEvidenceByElement.get(references.element);
      if (!gapEvidence) {
        gapEvidence = providerGapEvidenceSchema(
          references,
          `resumeMatchGapEvidence${gapEvidenceByElement.size}`,
        );
        gapEvidenceByElement.set(references.element, gapEvidence);
      }
      boundGapSchemas.push(constrainIndexes(
        schema
          .omit({ jdEvidenceReferences: true, profileEvidenceReferences: true })
          .extend({
            jdEvidence: groupedEvidence(jdReferences, true),
            gapEvidence,
            profileEvidence: groupedEvidence(contextReferences, false),
          }),
        indexes,
      ));
    }
  }
  const sourcedSchemas = [...schemas.map(bindEvidence), ...boundGapSchemas];
  return sourcedSchemas.length === 0
    ? bindEvidence(providerUnknownRequirementSchema)
    : sourcedSchemas.length === 1
      ? sourcedSchemas[0]!
      : z.union([
          sourcedSchemas[0]!,
          sourcedSchemas[1]!,
          ...sourcedSchemas.slice(2),
        ]);
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
  const requirements = authoritativeRequirementMap === undefined
    ? undefined : requirementMapSchema.parse(authoritativeRequirementMap);
  const assessments = z.array(providerRequirementAssessmentSchema(availableEvidence, requirements));
  const referenceElement = (referenceIds: string[], id: string) => {
    const unique = [...new Set(referenceIds)];
    if (unique.length === 0) return null;
    return (unique.length === 1
      ? z.literal(unique[0]!)
      : z.enum(unique as [string, ...string[]]))
      .meta({ id });
  };
  const jdReference = referenceElement(
    availableEvidence
      .filter((evidence) => evidence.sourceType !== "USER_PROFILE")
      .map((evidence) => evidence.referenceId),
    "resumeMatchJdEvidenceReference",
  );
  const profileReference = referenceElement(
    availableEvidence
      .filter((evidence) => evidence.sourceType === "USER_PROFILE")
      .map((evidence) => evidence.referenceId),
    "resumeMatchProfileEvidenceReference",
  );
  const allReference = referenceElement(
    availableEvidence.map((evidence) => evidence.referenceId),
    "resumeMatchAnyEvidenceReference",
  );
  const sourceReferences = z.object({
    jdEvidenceReferences: jdReference
      ? z.array(jdReference).min(1)
      : transportEvidenceReferences.max(0),
    profileEvidenceReferences: profileReference
      ? z.array(profileReference).min(1)
      : transportEvidenceReferences.max(0),
  }).strict();
  const anyReferences = allReference
    ? z.array(allReference)
    : transportEvidenceReferences.max(0);
  const supportedFinding = transportSupportedFindingSchema.extend({
    evidenceReferences: anyReferences.min(1),
  });
  const unknown = transportUnknownSchema.extend({
    evidenceReferences: anyReferences,
  });
  const contradiction = transportContradictionSchema.extend({
    evidenceReferencesA: anyReferences.min(1),
    evidenceReferencesB: anyReferences.min(1),
  });
  const seniorityDimension = transportSeniorityDimensionSchema.extend({
    evidenceReferences: anyReferences,
  });
  const effectiveSeniority = semanticResumeMatchTransportSchema.shape
    .effectiveSeniority.extend({
      statedYears: seniorityDimension,
      requirementStrength: seniorityDimension,
      experienceSpecificity: seniorityDimension,
      evidence: sourceReferences,
    });
  return semanticResumeMatchTransportSchema.extend({
    requirementAssessments: requirements?.every((requirement) => requirement.ambiguity.isAmbiguous) ||
      !availableEvidence.some((evidence) => evidence.sourceType !== "USER_PROFILE")
      ? assessments.max(0) : assessments,
    scoreEvidence: sourceReferences,
    effectiveSeniority,
    strongStrengths: z.array(supportedFinding),
    partialMatches: z.array(supportedFinding),
    unknowns: z.array(unknown),
    positioningRecommendations: z.array(z.object({
      recommendation: transportRequiredText,
      evidence: sourceReferences,
    }).strict()),
    evidenceReferences: anyReferences.min(1),
    contradictions: z.array(contradiction),
  });
}

export function semanticResumeMatchRequirementsForProvider(
  authoritativeRequirementMap: z.input<typeof requirementMapSchema>,
  providerReferenceByCoreReference?: ReadonlyMap<string, string>,
) {
  return requirementMapSchema
    .parse(authoritativeRequirementMap)
    // The historical direct-work key carries no semantics and is not shown.
    // Statement provenance is application bookkeeping.
    .map(({
      requiresDirectWorkExperience: _historical,
      sourceStatement: _sourceStatement,
      ...requirement
    }, requirementIndex) => ({
      requirementIndex,
      ...requirement,
      evidenceReferences: providerReferenceByCoreReference
        ? requirement.evidenceReferences.map((reference) => {
            const providerReference =
              providerReferenceByCoreReference.get(reference);
            if (!providerReference) {
              evidenceResultViolation(
                `Resume Match requirement ${requirementIndex} references evidence outside the provider catalog`,
              );
            }
            return providerReference;
          })
        : requirement.evidenceReferences,
    }))
    .filter((requirement) => !requirement.ambiguity.isAmbiguous);
}

type ResumeMatchProviderInputEvidence = Pick<
  EvidenceRecordDraft,
  | "referenceId"
  | "claim"
  | "sourceType"
  | "sourceField"
  | "sourceText"
  | "evidenceType"
  | "origin"
  | "evidenceLevel"
> & { limitation?: ResumeMatchLimitation };

export interface ResumeMatchProviderEvidenceCatalogEntry {
  evidenceIndex: number;
  evidenceReference: string;
  evidenceType: string;
  statement: string;
  sourceExcerpt: string | null;
  sourceField: string | null;
  origin: EvidenceRecordDraft["origin"];
  evidenceLevel: EvidenceRecordDraft["evidenceLevel"];
  limitationCategory?: ResumeMatchLimitation["category"];
  disclaimedExperienceSpecificity?: ResumeMatchLimitation["disclaimedExperienceSpecificity"];
}

export interface ResumeMatchProviderJdEvidenceCatalogEntry
  extends ResumeMatchProviderEvidenceCatalogEntry {
  sourceType: string;
}

export interface ResumeMatchProviderInputProjection {
  profileEvidenceCatalog: ResumeMatchProviderEvidenceCatalogEntry[];
  jdEvidenceCatalog: ResumeMatchProviderJdEvidenceCatalogEntry[];
  schemaEvidence: AvailableResumeMatchEvidence[];
  providerReferenceByCoreReference: ReadonlyMap<string, string>;
  coreReferenceByProviderReference: ReadonlyMap<string, string>;
}

function compactEvidenceContent(evidence: ResumeMatchProviderInputEvidence) {
  return {
    evidenceType: evidence.evidenceType,
    statement: evidence.claim,
    sourceExcerpt:
      evidence.sourceText === evidence.claim ? null : evidence.sourceText,
    sourceField: evidence.sourceField,
    origin: evidence.origin,
    evidenceLevel: evidence.evidenceLevel,
  };
}

/**
 * Builds the only model-visible Resume Match evidence inventories. Core IDs and
 * full provenance records remain application-side in the returned lookup maps.
 */
export function createResumeMatchProviderInputProjection(
  availableEvidence: ResumeMatchProviderInputEvidence[],
): ResumeMatchProviderInputProjection {
  const providerReferenceByCoreReference = new Map<string, string>();
  const coreReferenceByProviderReference = new Map<string, string>();
  const schemaEvidence: AvailableResumeMatchEvidence[] = [];
  const profileEvidenceCatalog: ResumeMatchProviderEvidenceCatalogEntry[] = [];
  const jdEvidenceCatalog: ResumeMatchProviderJdEvidenceCatalogEntry[] = [];

  for (const evidence of availableEvidence) {
    if (providerReferenceByCoreReference.has(evidence.referenceId)) {
      evidenceResultViolation(
        "Available Resume Match evidence contains duplicate reference identifiers",
      );
    }
    const isProfile = evidence.sourceType === "USER_PROFILE";
    const evidenceIndex = isProfile
      ? profileEvidenceCatalog.length
      : jdEvidenceCatalog.length;
    const evidenceReference = `${isProfile ? "profile" : "jd"}-${evidenceIndex}`;
    providerReferenceByCoreReference.set(
      evidence.referenceId,
      evidenceReference,
    );
    coreReferenceByProviderReference.set(
      evidenceReference,
      evidence.referenceId,
    );
    schemaEvidence.push({
      referenceId: evidenceReference,
      sourceType: evidence.sourceType,
      evidenceType: evidence.evidenceType,
      claim: evidence.claim,
      sourceText: evidence.sourceText,
      startupSpecialization:
        evidence.sourceType === "USER_PROFILE" &&
        broaderOrTransferableWorkEvidenceTypes.has(evidence.evidenceType) &&
        startupSpecializationPattern.test(
          [evidence.claim, evidence.sourceText].filter(Boolean).join(" "),
        ),
      ...(evidence.limitation ? { limitation: evidence.limitation } : {}),
    });
    const entry = {
      evidenceIndex,
      evidenceReference,
      ...compactEvidenceContent(evidence),
      // Limitation semantics are structured profile data shown with the record.
      ...(isProfile && profileLimitation(evidence)
        ? {
            limitationCategory: evidence.limitation!.category,
            disclaimedExperienceSpecificity:
              evidence.limitation!.disclaimedExperienceSpecificity,
          }
        : {}),
    };
    if (isProfile) {
      profileEvidenceCatalog.push(entry);
    } else {
      jdEvidenceCatalog.push({ ...entry, sourceType: evidence.sourceType });
    }
  }

  return {
    profileEvidenceCatalog,
    jdEvidenceCatalog,
    schemaEvidence,
    providerReferenceByCoreReference,
    coreReferenceByProviderReference,
  };
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
> &
  Partial<Pick<EvidenceRecordDraft, "claim" | "sourceText">> & {
    startupSpecialization?: boolean;
    limitation?: ResumeMatchLimitation;
  };

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

type AssessmentEvidenceAssignment = {
  evidenceReference: string;
  purpose: "DECISION_IMPACT" | "ASSESSMENT_ONLY";
};
type AssessmentEvidenceSelection = {
  evidenceAssignments: AssessmentEvidenceAssignment[];
};
type ProviderRequirementAssessment = {
  requirementIndex: number;
  decisionImpact: string;
  jdEvidence: AssessmentEvidenceSelection;
  gapEvidence?: AssessmentEvidenceSelection;
  profileEvidence: AssessmentEvidenceSelection;
  [key: string]: unknown;
};

type LegacyAssessmentEvidencePartition = {
  decisionImpactReferences: string[];
  assessmentOnlyReferences: string[];
};

function legacyPartitionToAssignments(
  partition: LegacyAssessmentEvidencePartition,
  requirementIndex: number,
  source: "JD" | "profile",
) {
  if (
    !Array.isArray(partition.decisionImpactReferences) ||
    !Array.isArray(partition.assessmentOnlyReferences) ||
    partition.decisionImpactReferences.some((reference) => typeof reference !== "string") ||
    partition.assessmentOnlyReferences.some((reference) => typeof reference !== "string")
  ) {
    evidenceResultViolation(
      `Requirement ${requirementIndex} ${source} evidence contains malformed evidence assignments`,
    );
  }
  return {
    evidenceAssignments: [
      ...partition.decisionImpactReferences.map((evidenceReference) => ({
        evidenceReference,
        purpose: "DECISION_IMPACT" as const,
      })),
      ...partition.assessmentOnlyReferences.map((evidenceReference) => ({
        evidenceReference,
        purpose: "ASSESSMENT_ONLY" as const,
      })),
    ],
  };
}

function normalizeLegacyAssessmentEvidence(input: unknown) {
  if (
    input === null ||
    typeof input !== "object" ||
    !("requirementAssessments" in input) ||
    !Array.isArray(input.requirementAssessments)
  ) {
    return input;
  }
  return {
    ...input,
    requirementAssessments: input.requirementAssessments.map((candidate) => {
      if (candidate === null || typeof candidate !== "object") return candidate;
      const assessment = candidate as Record<string, unknown>;
      const requirementIndex =
        typeof assessment.requirementIndex === "number"
          ? assessment.requirementIndex
          : -1;
      const convert = (source: "jdEvidence" | "profileEvidence") => {
        const selection = assessment[source];
        if (selection === null || typeof selection !== "object") return selection;
        if ("evidenceAssignments" in selection) return selection;
        if (
          "decisionImpactReferences" in selection ||
          "assessmentOnlyReferences" in selection
        ) {
          return legacyPartitionToAssignments(
            selection as LegacyAssessmentEvidencePartition,
            requirementIndex,
            source === "jdEvidence" ? "JD" : "profile",
          );
        }
        return selection;
      };
      return {
        ...assessment,
        ...(Object.hasOwn(assessment, "jdEvidence")
          ? { jdEvidence: convert("jdEvidence") }
          : {}),
        ...(Object.hasOwn(assessment, "profileEvidence")
          ? { profileEvidence: convert("profileEvidence") }
          : {}),
      };
    }),
  };
}

// Historical grouped outputs predate the separate gapEvidence collection.
// Move only the selected limitations relevant to the requirement, keeping
// identity and purpose; never add, drop or reassign one.
function normalizeLegacyGapEvidence(
  input: unknown,
  availableEvidence: AvailableResumeMatchEvidence[],
  requirements: z.infer<typeof requirementMapSchema>,
) {
  if (
    input === null ||
    typeof input !== "object" ||
    !("requirementAssessments" in input) ||
    !Array.isArray(input.requirementAssessments)
  ) {
    return input;
  }
  const gapProof = genuineGapProofByRequirement(availableEvidence, requirements);
  return {
    ...input,
    requirementAssessments: input.requirementAssessments.map((candidate) => {
      if (candidate === null || typeof candidate !== "object") return candidate;
      const assessment = candidate as Record<string, unknown>;
      const requirement =
        typeof assessment.requirementIndex === "number"
          ? requirements[assessment.requirementIndex]
          : undefined;
      const profileEvidence = assessment.profileEvidence as
        | { evidenceAssignments?: unknown }
        | undefined;
      if (
        assessment.classification !== "GENUINE_GAP" ||
        Object.hasOwn(assessment, "gapEvidence") ||
        !requirement ||
        profileEvidence === null ||
        typeof profileEvidence !== "object" ||
        !Array.isArray(profileEvidence.evidenceAssignments)
      ) {
        return candidate;
      }
      const eligible = gapProof.get(assessment.requirementIndex as number) ??
        new Set<string>();
      const assignments = profileEvidence.evidenceAssignments as Array<{
        evidenceReference?: unknown;
      }>;
      const isGapProof = (assignment: { evidenceReference?: unknown }) =>
        typeof assignment.evidenceReference === "string" &&
        eligible.has(assignment.evidenceReference);
      if (!assignments.some(isGapProof)) {
        evidenceResultViolation(
          `Requirement ${assessment.requirementIndex} claims a Genuine Gap without a relevant profile limitation`,
        );
      }
      return {
        ...assessment,
        gapEvidence: { evidenceAssignments: assignments.filter(isGapProof) },
        profileEvidence: {
          ...profileEvidence,
          evidenceAssignments: assignments.filter(
            (assignment) => !isGapProof(assignment),
          ),
        },
      };
    }),
  };
}

function restoreAssessmentEvidence(input: unknown) {
  const groupedTransport = input as Record<string, unknown> & {
    requirementAssessments: ProviderRequirementAssessment[];
  };
  // Genuine Gap proof records are profile evidence with their authored
  // purpose. Their provider catalog is disjoint from the ordinary gap profile
  // catalog, so merging cannot create a duplicate except through an alias that
  // restores to the same Core identity, which the check below rejects.
  const providerTransport = {
    ...groupedTransport,
    requirementAssessments: groupedTransport.requirementAssessments.map(
      ({ gapEvidence, ...assessment }) => gapEvidence === undefined
        ? assessment
        : {
            ...assessment,
            profileEvidence: {
              evidenceAssignments: [
                ...gapEvidence.evidenceAssignments,
                ...assessment.profileEvidence.evidenceAssignments,
              ],
            },
          },
    ),
  };
  // JSON Schema cannot enforce uniqueness by one object field. Validate the
  // selected provider identity after authoritative restoration so aliases that
  // collapse to one Core identity are rejected too. Never deduplicate or guess.
  const duplicatePartitions: string[] = [];
  for (const assessment of providerTransport.requirementAssessments) {
    for (const [source, selection] of [
      ["JD", assessment.jdEvidence],
      ["profile", assessment.profileEvidence],
    ] as const) {
      const purposes = new Map<string, Set<AssessmentEvidenceAssignment["purpose"]>>();
      for (const assignment of selection.evidenceAssignments) {
        const assigned = purposes.get(assignment.evidenceReference) ?? new Set();
        assigned.add(assignment.purpose);
        purposes.set(assignment.evidenceReference, assigned);
      }
      const reasons: string[] = [];
      for (const [reference, assignedPurposes] of purposes) {
        const assignments = selection.evidenceAssignments.filter(
          (assignment) => assignment.evidenceReference === reference,
        );
        if (assignments.length <= 1) continue;
        if (assignedPurposes.size > 1) {
          reasons.push("across decision-impact and assessment-only purposes");
        } else if (assignedPurposes.has("DECISION_IMPACT")) {
          reasons.push("within decision-impact purpose");
        } else {
          reasons.push("within assessment-only purpose");
        }
      }
      if (reasons.length > 0) {
        duplicatePartitions.push(`Requirement ${assessment.requirementIndex} ${source} evidence contains duplicate evidence references (${[...new Set(reasons)].join("; ")})`);
      }
    }
  }
  if (duplicatePartitions.length > 0) evidenceResultViolation(duplicatePartitions.join("; "));
  return {
    ...providerTransport,
    requirementAssessments: providerTransport.requirementAssessments.map(
      (assessment) => {
        const { jdEvidence, profileEvidence, ...rest } = assessment;
        const referencesFor = (
          selection: AssessmentEvidenceSelection,
          purpose?: AssessmentEvidenceAssignment["purpose"],
        ) => selection.evidenceAssignments
          .filter((assignment) => purpose === undefined || assignment.purpose === purpose)
          .map((assignment) => assignment.evidenceReference);
        const jdEvidenceReferences = referencesFor(jdEvidence);
        const profileEvidenceReferences = referencesFor(profileEvidence);
        const jdDecisionImpactReferences = referencesFor(
          jdEvidence,
          "DECISION_IMPACT",
        );
        const profileDecisionImpactReferences = referencesFor(
          profileEvidence,
          "DECISION_IMPACT",
        );
        return {
          ...rest,
          jdEvidenceReferences,
          profileEvidenceReferences,
          ...(assessment.decisionImpact === "DECISIVE_DISQUALIFIER"
            ? { decisionImpactEvidence: {
                jdEvidenceReferences: jdDecisionImpactReferences,
                profileEvidenceReferences: profileDecisionImpactReferences,
              } }
            : { decisionImpactEvidenceReferences: [
                ...jdDecisionImpactReferences,
                ...profileDecisionImpactReferences,
              ] }),
        };
      },
    ),
  };
}

const providerEvidenceReferenceKeys = new Set([
  "evidenceReferences",
  "jdEvidenceReferences",
  "profileEvidenceReferences",
  "decisionImpactReferences",
  "assessmentOnlyReferences",
  "evidenceReferencesA",
  "evidenceReferencesB",
]);
const providerSingleEvidenceReferenceKeys = new Set(["evidenceReference"]);

function mapResumeMatchEvidenceReferences(
  value: unknown,
  resolveReference: (reference: string, key: string) => string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      mapResumeMatchEvidenceReferences(item, resolveReference),
    );
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (providerSingleEvidenceReferenceKeys.has(key)) {
        if (typeof child !== "string") {
          evidenceResultViolation(
            `Resume Match provider field ${key} contains a malformed evidence reference`,
          );
        }
        return [key, resolveReference(child, key)];
      }
      if (providerEvidenceReferenceKeys.has(key)) {
        if (
          !Array.isArray(child) ||
          child.some((reference) => typeof reference !== "string")
        ) {
          evidenceResultViolation(
            `Resume Match provider field ${key} contains malformed evidence references`,
          );
        }
        return [
          key,
          child.map((reference) => resolveReference(reference, key)),
        ];
      }
      return [
        key,
        mapResumeMatchEvidenceReferences(child, resolveReference),
      ];
    }),
  );
}

export function projectResumeMatchContextForProvider(
  value: unknown,
  providerReferenceByCoreReference: ReadonlyMap<string, string>,
) {
  return mapResumeMatchEvidenceReferences(value, (coreReference, key) => {
    const providerReference =
      providerReferenceByCoreReference.get(coreReference);
    if (!providerReference) {
      evidenceResultViolation(
        `Resume Match provider context field ${key} references evidence outside the provider catalog`,
      );
    }
    return providerReference;
  });
}

function restoreProviderEvidenceReferences(
  value: unknown,
  coreReferenceByProviderReference: ReadonlyMap<string, string>,
) {
  return mapResumeMatchEvidenceReferences(value, (providerReference, key) => {
    const coreReference =
      coreReferenceByProviderReference.get(providerReference);
    if (!coreReference) {
      evidenceResultViolation(
        `Resume Match provider field ${key} references unknown provider evidence`,
      );
    }
    return coreReference;
  });
}

const bracketedProviderCitationPattern =
  /\[\s*((?:jd|profile)-[^\]]*)\s*\]/gi;
const providerCitationTokenPattern = /^(?:jd|profile)-\d+$/;
const unbracketedProviderCitationPattern =
  /(^|[^A-Za-z0-9_-])((?:jd|profile)-\d+)(?=$|[^A-Za-z0-9_-])/g;

// Narrative text is display-only. Structured evidence fields carry provenance
// and are validated separately. Inside prose, each well-formed provider-local
// reference that resolves is translated to its Core ID, and a bracket group
// whose tokens all resolve uniquely is rendered as one bracket per reference.
// Unresolvable or malformed citation text stays as authored and never decides
// acceptance.
function restoreProviderNarrativeCitations(
  value: unknown,
  coreReferenceByProviderReference: ReadonlyMap<string, string>,
  parentKey?: string,
): unknown {
  if (typeof value === "string") {
    if (
      parentKey &&
      (providerEvidenceReferenceKeys.has(parentKey) ||
        providerSingleEvidenceReferenceKeys.has(parentKey))
    ) return value;
    const bracketRestored = value.replace(
      bracketedProviderCitationPattern,
      (citation, providerReferencesText: string) => {
        const providerReferences = providerReferencesText
          .split(",")
          .map((providerReference) => providerReference.trim());
        const coreReferences = providerReferences.map((providerReference) =>
          providerCitationTokenPattern.test(providerReference)
            ? coreReferenceByProviderReference.get(providerReference)
            : undefined,
        );
        if (
          new Set(providerReferences).size !== providerReferences.length ||
          coreReferences.some((coreReference) => coreReference === undefined)
        ) return citation;
        return coreReferences.map((coreReference) => `[${coreReference}]`).join(" ");
      },
    );
    return bracketRestored.replace(
      unbracketedProviderCitationPattern,
      (citation, prefix: string, providerReference: string) => {
        const coreReference =
          coreReferenceByProviderReference.get(providerReference);
        return coreReference ? `${prefix}${coreReference}` : citation;
      },
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      restoreProviderNarrativeCitations(
        item,
        coreReferenceByProviderReference,
        parentKey,
      ),
    );
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      restoreProviderNarrativeCitations(
        child,
        coreReferenceByProviderReference,
        key,
      ),
    ]),
  );
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
        !hasEvidenceType([
          "DIRECT_EXPERIENCE",
          "RELATED_EXPERIENCE",
          "TRANSFERABLE_EXPERIENCE",
        ])
      ) {
        evidenceResultViolation(
          `${label} treats an industry requirement as a match without work-experience evidence`,
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
      // Experience-level legality is the requirement-relative compatibility
      // relation already enforced during conversion; it is not restated here.
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
  providerInputProjection?: ResumeMatchProviderInputProjection,
): SemanticResumeMatch {
  // A duplicated inventory ID could otherwise denote both JD and profile
  // evidence. Reject it before source catalogs or partitions can restore IDs.
  if (new Set(availableEvidence.map((item) => item.referenceId)).size !== availableEvidence.length) {
    evidenceResultViolation("Available Resume Match evidence contains duplicate reference identifiers");
  }
  const schemaEvidence = providerInputProjection?.schemaEvidence ?? availableEvidence;
  const normalizedProviderValue = normalizeLegacyGapEvidence(
    normalizeLegacyAssessmentEvidence(value),
    schemaEvidence,
    requirementMapSchema.parse(authoritativeRequirementMap),
  );
  const providerResult = createSemanticResumeMatchTransportSchema(
    schemaEvidence,
    authoritativeRequirementMap,
  ).safeParse(normalizedProviderValue);
  const assessments = normalizedProviderValue !== null &&
      typeof normalizedProviderValue === "object" &&
      "requirementAssessments" in normalizedProviderValue
    ? normalizedProviderValue.requirementAssessments
    : null;
  const hasGroupedEvidence = Array.isArray(assessments) && assessments.some(
    (assessment) => assessment !== null && typeof assessment === "object" &&
      ("jdEvidence" in assessment || "profileEvidence" in assessment),
  );
  if (!providerResult.success && hasGroupedEvidence) {
    // Historical flat results remain readable. Malformed current partitions
    // must not fall through to that reader and become retryable Zod failures.
    evidenceResultViolation("Resume Match grouped assessment evidence or compatibility is invalid");
  }
  const restoredProviderResult = providerResult.success
    ? providerInputProjection
      ? restoreProviderEvidenceReferences(
          restoreProviderNarrativeCitations(
            providerResult.data,
            providerInputProjection.coreReferenceByProviderReference,
          ),
          providerInputProjection.coreReferenceByProviderReference,
        )
      : providerResult.data
    : value;
  const transportParse = semanticResumeMatchTransportSchema.safeParse(
    providerResult.success
      ? restoreAssessmentEvidence(restoredProviderResult)
      : value,
  );
  if (!transportParse.success) {
    // The compact provider schema deliberately avoids expanding deterministic
    // compatibility relationships into runtime-specific branches. Preserve the
    // same fail-closed, nonretryable boundary before any domain result exists.
    evidenceResultViolation(
      "Resume Match requirement assessment compatibility is invalid",
    );
  }
  const transport = transportParse.data;
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
  const gapProof = genuineGapProofByRequirement(availableEvidence, requirements);
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
    const startupSpecializationRequired =
      requiresStartupSpecialization(authoritative);
    const startupSpecializationAvailable = availableEvidence.some(
      supportsStartupSpecialization,
    );
    if (
      startupSpecializationRequired &&
      !startupSpecializationAvailable &&
      assessment.classification !== "UNKNOWN"
    ) {
      evidenceResultViolation(
        `Requirement ${assessment.requirementIndex} must remain Unknown without startup-specific experience evidence`,
      );
    }
    if (
      startupSpecializationRequired &&
      ["STRONG_MATCH", "PARTIAL_MATCH", "TRANSFERABLE_MATCH"].includes(
        assessment.classification,
      ) &&
      !assessment.profileEvidenceReferences.some((reference) =>
        supportsStartupSpecialization(knownEvidence.get(reference)!),
      )
    ) {
      evidenceResultViolation(
        `Requirement ${assessment.requirementIndex} treats generic experience as startup specialization`,
      );
    }
    // An Unknown asserts nothing about the candidate, so it cannot carry
    // supported or unsupported portions; partial support is PARTIAL_MATCH.
    if (
      assessment.classification === "UNKNOWN" &&
      (assessment.supportedPortion !== null ||
        assessment.unsupportedPortion !== null)
    ) {
      authoritativeResultViolation(
        `Requirement ${assessment.requirementIndex} is Unknown but carries supported or unsupported portions`,
      );
    }
    if (
      assessment.classification === "STRONG_MATCH" ||
      assessment.classification === "TRANSFERABLE_MATCH" ||
      assessment.classification === "PARTIAL_MATCH"
    ) {
      const compatibleTypes = positiveRequirementCompatibility(
        assessment.classification,
        assessment.matchedExperienceSpecificity,
        assessment.experienceEvidenceBasis,
        authoritative,
      );
      if (
        compatibleTypes.size === 0 ||
        assessment.profileEvidenceReferences.length === 0 ||
        assessment.profileEvidenceReferences.some((reference) =>
          !compatibleTypes.has(knownEvidence.get(reference)!.evidenceType),
        )
      ) {
        evidenceResultViolation(
          `Requirement ${assessment.requirementIndex} has incompatible classification, specificity, evidence basis or profile evidence`,
        );
      }
    }
    if (assessment.classification === "GENUINE_GAP") {
      const proof = gapProof.get(assessment.requirementIndex) ?? new Set<string>();
      const establishesGap = (reference: string) => proof.has(reference);
      if (!assessment.profileEvidenceReferences.some(establishesGap)) {
        evidenceResultViolation(
          `Requirement ${assessment.requirementIndex} claims a Genuine Gap without a relevant profile limitation`,
        );
      }
      // An unrelated limitation can never accompany a gap, even as context.
      if (
        assessment.profileEvidenceReferences.some((reference) =>
          profileLimitation(knownEvidence.get(reference)!) !== undefined &&
          !establishesGap(reference))
      ) {
        evidenceResultViolation(
          `Requirement ${assessment.requirementIndex} cites a profile limitation that is not relevant to the requirement`,
        );
      }
      const decisionReferences =
        "decisionImpactEvidence" in assessment
          ? mergeBothSourceEvidence(assessment.decisionImpactEvidence)
          : assessment.decisionImpactEvidenceReferences;
      if (
        assessment.decisionImpact === "DECISIVE_DISQUALIFIER" &&
        !decisionReferences.some(establishesGap)
      ) {
        evidenceResultViolation(
          `Requirement ${assessment.requirementIndex} assigns decisive gap impact without a relevant profile limitation`,
        );
      }
    }
    if (!assessment.jdEvidenceReferences.some((reference) => authoritative.evidenceReferences.includes(reference))) {
      evidenceResultViolation(`Requirement ${assessment.requirementIndex} is not connected to authoritative JD evidence`);
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
