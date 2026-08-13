import { z } from "zod";

const optionalText = z.string().trim().min(1).nullable();

export const evidenceLevelSchema = z.enum([
  "CONFIRMED",
  "STRONG_EVIDENCE",
  "POSSIBLE",
  "UNKNOWN",
  "CONFLICTING",
]);

export const evidenceOriginSchema = z.enum([
  "EXPLICIT",
  "DERIVED",
  "INFERRED",
]);

const evidenceRecordBaseSchema = z
  .object({
    referenceId: z.string().trim().min(1),
    criterionId: optionalText,
    claim: z.string().trim().min(1),
    sourceType: z.string().trim().min(1),
    sourceRecordId: z.uuid().nullable(),
    provenanceId: z.uuid().nullable(),
    sourceField: optionalText,
    sourceReference: optionalText,
    sourceText: optionalText,
    evidenceType: z.string().trim().min(1),
    origin: evidenceOriginSchema,
    evidenceLevel: evidenceLevelSchema,
    collectedAt: z.coerce.date().nullable(),
  })
  .strict();

export const evidenceRecordDraftSchema = evidenceRecordBaseSchema.superRefine(
  (evidence, context) => {
    if (
      evidence.sourceRecordId === null &&
      evidence.provenanceId === null &&
      evidence.sourceReference === null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Evidence must reference a SourceRecord, FieldProvenance record, or source reference",
        path: ["sourceReference"],
      });
    }
  },
);

export const persistedEvidenceRecordSchema = evidenceRecordBaseSchema
  .omit({ referenceId: true })
  .extend({
    id: z.uuid(),
    evaluationId: z.uuid(),
    stageResultId: z.uuid(),
    stageId: z.string().trim().min(1),
    createdAt: z.coerce.date(),
  })
  .strict();

export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;
export type EvidenceOrigin = z.infer<typeof evidenceOriginSchema>;
export type EvidenceRecordDraft = z.infer<typeof evidenceRecordDraftSchema>;
export type PersistedEvidenceRecord = z.infer<
  typeof persistedEvidenceRecordSchema
>;
