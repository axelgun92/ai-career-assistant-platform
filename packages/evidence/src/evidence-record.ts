import { z } from "zod";

export const evidenceLevelSchema = z.enum([
  "CONFIRMED",
  "STRONG_EVIDENCE",
  "POSSIBLE",
  "UNKNOWN",
  "CONFLICTING",
]);

export const evidenceRecordInputSchema = z.object({
  opportunityId: z.uuid(),
  stageId: z.string().trim().min(1).nullable(),
  criterionId: z.string().trim().min(1).nullable(),
  claim: z.string().trim().min(1),
  sourceType: z.string().trim().min(1),
  sourceReference: z.string().trim().min(1).nullable(),
  sourceText: z.string().trim().min(1).nullable(),
  evidenceLevel: evidenceLevelSchema,
  collectedAt: z.coerce.date().nullable(),
});

export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;
export type EvidenceRecordInput = z.infer<typeof evidenceRecordInputSchema>;
