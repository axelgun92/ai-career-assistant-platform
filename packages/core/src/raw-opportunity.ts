import { z } from "zod";
import { opportunitySourceTypeSchema } from "./opportunity";

const nullableText = z.string().trim().min(1).nullable();

export const rawOpportunitySchema = z.object({
  source: z.string().trim().min(1),
  sourceType: opportunitySourceTypeSchema,
  sourceUrl: z.url().nullable(),
  externalId: nullableText,
  requisitionId: nullableText,
  title: nullableText,
  company: nullableText,
  location: nullableText,
  description: nullableText,
  salaryText: nullableText,
  employmentType: nullableText,
  postingDate: nullableText,
  sourceMetadata: z.record(z.string(), z.unknown()).nullable(),
  rawPayload: z.unknown().nullable(),
  discoveredAt: z.coerce.date(),
});

export type RawOpportunity = z.infer<typeof rawOpportunitySchema>;
