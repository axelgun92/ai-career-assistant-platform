import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";

const requiredText = z.string().trim().min(1);
const evidenceReferences = z.array(requiredText);

export const customerSuccessRecommendationClassificationSchema = z.enum([
  "APPLY",
  "REVIEW",
  "SKIP",
]);

export const customerSuccessRecommendationStageReferenceSchema = z.enum([
  "hard-filters",
  "job-evaluation",
  "company-alignment",
  "organizational-maturity",
  "alex-fit",
  "burnout-risk",
  "resume-match",
  "opportunity-priority",
  "ghost-job-risk",
]);

export const customerSuccessRecommendationSchema = z
  .object({
    recommendation: customerSuccessRecommendationClassificationSchema,
    summary: requiredText,
    majorStrengths: z.array(supportedAlignmentFindingSchema),
    majorConcerns: z.array(supportedAlignmentFindingSchema),
    decisionRelevantUnknowns: z.array(companyAlignmentUnknownSchema),
    contradictions: z.array(contradictionDraftSchema),
    evidenceReferences: evidenceReferences.min(1),
    precedenceReasons: z.array(requiredText).min(1),
    stageReferences: z
      .array(customerSuccessRecommendationStageReferenceSchema)
      .min(1),
  })
  .strict();

export type CustomerSuccessRecommendation = z.infer<
  typeof customerSuccessRecommendationSchema
>;
