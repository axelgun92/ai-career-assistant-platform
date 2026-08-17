import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import { companyAlignmentUnknownSchema } from "./company-alignment";

const requiredText = z.string().trim().min(1);
const evidenceReferences = z.array(requiredText);

export const ghostJobRiskClassificationSchema = z.enum([
  "LOW",
  "POSSIBLE",
  "ELEVATED",
  "HIGH",
  "UNKNOWN",
]);

export const postingHistoryFactTypeSchema = z.enum([
  "REPOSTED",
  "UNCHANGED_OVER_TIME",
  "EVERGREEN_LANGUAGE",
  "FARMING_INDICATOR",
  "CLOSED_ATS_VISIBLE_ELSEWHERE",
  "RECURRING_IDENTICAL_REQUISITION",
  "AGGREGATOR_VISIBILITY",
  "ACTIVE_ATS",
  "CURRENT_POSTING",
]);

export const postingHistoryFactSchema = z
  .object({
    type: postingHistoryFactTypeSchema,
    description: requiredText,
    occurredAt: z.iso.datetime().nullable(),
    evidenceReferences: evidenceReferences.min(1),
  })
  .strict();

export const sourcePostingHistoryFactSchema = z
  .object({
    type: postingHistoryFactTypeSchema,
    description: requiredText,
    occurredAt: z.coerce.date().nullable().default(null),
  })
  .strict();

export const semanticGhostJobRiskSchema = z
  .object({
    classification: ghostJobRiskClassificationSchema,
    assessment: requiredText,
    interpretation: requiredText,
    evidenceReferences,
    unknowns: z.array(companyAlignmentUnknownSchema),
    contradictions: z.array(contradictionDraftSchema),
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
        message: "A non-Unknown Ghost Job Risk requires evidence",
      });
    }
  });

export const ghostJobRiskDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({
      evaluated: z.literal(true),
      objectiveFacts: z.array(postingHistoryFactSchema),
      risk: semanticGhostJobRiskSchema,
    })
    .strict(),
]);

export type PostingHistoryFact = z.infer<typeof postingHistoryFactSchema>;
export type GhostJobRiskData = z.infer<typeof ghostJobRiskDataSchema>;
export type SemanticGhostJobRisk = z.infer<
  typeof semanticGhostJobRiskSchema
>;
