import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";

const requiredText = z.string().trim().min(1);
const evidenceReferences = z.array(requiredText);

export const burnoutRiskClassificationSchema = z.enum([
  "VERY_LOW",
  "LOW",
  "MIXED_MODERATE",
  "HIGH",
  "VERY_HIGH",
]);

export const semanticBurnoutRiskSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    scoreExplanation: requiredText,
    scoreEvidenceReferences: evidenceReferences.min(1),
    summary: requiredText,
    majorContributors: z.array(supportedAlignmentFindingSchema),
    positiveIndicators: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    evidenceReferences: evidenceReferences.min(1),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

export const burnoutRiskDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({
      evaluated: z.literal(true),
      classification: burnoutRiskClassificationSchema,
      risk: semanticBurnoutRiskSchema,
    })
    .strict(),
]);

export type BurnoutRiskData = z.infer<typeof burnoutRiskDataSchema>;
export type SemanticBurnoutRisk = z.infer<typeof semanticBurnoutRiskSchema>;
