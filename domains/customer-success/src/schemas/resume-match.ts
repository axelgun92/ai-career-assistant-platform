import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  requirementCategorySchema,
  requirementStrengthSchema,
} from "./maps";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

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
