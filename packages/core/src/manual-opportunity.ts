import { z } from "zod";
import {
  compensationCurrencyCodes,
  employmentTypeValues,
  seniorityValues,
  workArrangementValues,
} from "./opportunity";

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
    // Optional details the user states explicitly. Each one is recorded as
    // entered; nothing here is guessed from the job text.
    workArrangement: z.enum(workArrangementValues).optional(),
    seniority: z.enum(seniorityValues).optional(),
    employmentType: z.enum(employmentTypeValues).optional(),
    department: optionalSuppliedText.refine(
      (value) => value === undefined || value.trim().length <= 120,
      "Department must be at most 120 characters",
    ),
    closingDate: z.iso.date().optional(),
    compensationCurrency: z.enum(compensationCurrencyCodes).optional(),
    domain: optionalSuppliedText.refine(
      (value) =>
        value === undefined || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
      "Domain must be a lowercase slug such as customer-success",
    ),
  })
  .strict();

// The explicitly stated details as preserved in the manual SourceRecord's
// sourceMetadata.details. Older records have none; every value is optional.
export const manualStatedDetailsSchema = z
  .object({
    workArrangement: z.enum(workArrangementValues).nullable().default(null),
    seniority: z.enum(seniorityValues).nullable().default(null),
    department: z.string().nullable().default(null),
    closingDate: z.string().nullable().default(null),
    compensationCurrency: z.enum(compensationCurrencyCodes).nullable().default(null),
  })
  .default({
    workArrangement: null,
    seniority: null,
    department: null,
    closingDate: null,
    compensationCurrency: null,
  });

export type ManualStatedDetails = z.infer<typeof manualStatedDetailsSchema>;

export const opportunityIdSchema = z.uuid();

export type ManualOpportunitySubmission = z.infer<
  typeof manualOpportunitySubmissionSchema
>;
