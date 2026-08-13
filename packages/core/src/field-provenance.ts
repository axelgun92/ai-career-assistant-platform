import { z } from "zod";

export const provenanceKindSchema = z.enum(["DIRECT", "DETERMINISTIC"]);

export const fieldProvenanceInputSchema = z.object({
  fieldName: z.string().trim().min(1),
  sourceField: z.string().trim().min(1),
  kind: provenanceKindSchema,
  normalizedValue: z.json(),
  sourceReference: z.string().trim().min(1).nullable(),
  sourceText: z.string().min(1).nullable(),
  collectedAt: z.coerce.date().nullable(),
});

export type ProvenanceKind = z.infer<typeof provenanceKindSchema>;
export type FieldProvenanceInput = z.infer<
  typeof fieldProvenanceInputSchema
>;
