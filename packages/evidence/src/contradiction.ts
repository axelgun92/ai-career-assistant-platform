import { z } from "zod";

const optionalText = z.string().trim().min(1).nullable();

export const contradictionResolutionStatusSchema = z.enum([
  "UNRESOLVED",
  "RESOLVED",
]);

export const contradictionDraftSchema = z
  .object({
    claimA: z.string().trim().min(1),
    claimB: z.string().trim().min(1),
    interpretation: z.string().trim().min(1),
    relevantField: optionalText,
    significance: optionalText,
    evidenceReferencesA: z.array(z.string().trim().min(1)).min(1),
    evidenceReferencesB: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const persistedContradictionSchema = contradictionDraftSchema
  .omit({ evidenceReferencesA: true, evidenceReferencesB: true })
  .extend({
    id: z.uuid(),
    evaluationId: z.uuid(),
    stageResultId: z.uuid(),
    stageId: z.string().trim().min(1),
    evidenceIdsA: z.array(z.uuid()).min(1),
    evidenceIdsB: z.array(z.uuid()).min(1),
    resolutionStatus: contradictionResolutionStatusSchema,
    resolutionNote: optionalText,
    resolvedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
  })
  .strict();

export type ContradictionDraft = z.infer<typeof contradictionDraftSchema>;
export type PersistedContradiction = z.infer<
  typeof persistedContradictionSchema
>;
