import { z } from "zod";

const optionalSuppliedText = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Must contain visible text")
  .optional();

export const manualOpportunitySubmissionSchema = z
  .object({
    rawText: z
      .string()
      .min(1, "Raw opportunity text is required")
      .refine(
        (value) => value.trim().length > 0,
        "Raw opportunity text must contain visible text",
      ),
    title: optionalSuppliedText,
    company: optionalSuppliedText,
    location: optionalSuppliedText,
    compensationText: optionalSuppliedText,
    postingDate: z.iso.date().optional(),
    sourceUrl: z.url().optional(),
    applicationUrl: z.url().optional(),
    // The listing's own job/requisition identifier, when the user knows it.
    sourceJobId: optionalSuppliedText,
    // Where the user found the listing. Informational provenance only: manual
    // captures always keep source "manual-input" / sourceType MANUAL.
    foundOn: optionalSuppliedText,
    domain: optionalSuppliedText.refine(
      (value) =>
        value === undefined || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
      "Domain must be a lowercase slug such as customer-success",
    ),
  })
  .strict();

export const opportunityIdSchema = z.uuid();

export type ManualOpportunitySubmission = z.infer<
  typeof manualOpportunitySubmissionSchema
>;
