import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";

const requiredText = z.string().trim().min(1);
const evidenceReferences = z.array(requiredText);

export const postingAgePrioritySchema = z.enum([
  "HIGHEST_PRIORITY",
  "STRONG_PRIORITY",
  "GOOD_OPPORTUNITY",
  "REVIEW",
  "CAUTION",
  "UNKNOWN",
]);

export const opportunityPriorityBandSchema = z.enum([
  "VERY_LOW",
  "LOW",
  "MIXED_MODERATE",
  "HIGH",
  "VERY_HIGH",
]);

export const applicationEffortSchema = z.enum([
  "LOW",
  "MODERATE",
  "HIGH",
  "UNKNOWN",
]);

export const postingTimingSchema = z
  .object({
    postingDate: z.iso.date().nullable(),
    evaluationDate: z.iso.date(),
    ageDays: z.number().int().nonnegative().nullable(),
    classification: postingAgePrioritySchema,
    explanation: requiredText,
    evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.classification === "UNKNOWN") {
      if (value.ageDays !== null) {
        context.addIssue({
          code: "custom",
          path: ["ageDays"],
          message: "Unknown posting age cannot contain a calculated age",
        });
      }
      return;
    }
    if (value.ageDays === null || value.evidenceReferences.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known posting age requires a calculated age and evidence",
      });
    }
  });

export const applicationEffortAssessmentSchema = z
  .object({
    classification: applicationEffortSchema,
    explanation: requiredText,
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
        message: "Known application effort requires evidence",
      });
    }
  });

export const semanticOpportunityPrioritySchema = z
  .object({
    score: z.number().int().min(0).max(100),
    scoreExplanation: requiredText,
    scoreEvidenceReferences: evidenceReferences.min(1),
    strategicValueSummary: requiredText,
    strategicValueEvidenceReferences: evidenceReferences.min(1),
    applicationEffort: applicationEffortAssessmentSchema,
    reasonsForPrioritization: z.array(supportedAlignmentFindingSchema),
    reasonsForReducedPriority: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    evidenceReferences: evidenceReferences.min(1),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

export const opportunityPriorityDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({
      evaluated: z.literal(true),
      band: opportunityPriorityBandSchema,
      timing: postingTimingSchema,
      priority: semanticOpportunityPrioritySchema,
    })
    .strict(),
]);

export type PostingTiming = z.infer<typeof postingTimingSchema>;
export type ApplicationEffortAssessment = z.infer<
  typeof applicationEffortAssessmentSchema
>;
export type OpportunityPriorityData = z.infer<
  typeof opportunityPriorityDataSchema
>;
export type SemanticOpportunityPriority = z.infer<
  typeof semanticOpportunityPrioritySchema
>;
