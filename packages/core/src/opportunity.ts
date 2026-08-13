import { z } from "zod";

export const opportunityLifecycleStateSchema = z.enum([
  "DISCOVERED",
  "NORMALIZED",
  "EVALUATED",
  "RECOMMENDED",
  "SAVED",
  "APPLIED",
  "REJECTED_BY_USER",
  "CLOSED",
  "ARCHIVED",
]);

export const opportunitySourceTypeSchema = z.enum([
  "MANUAL",
  "BROWSER_EXTENSION",
  "PUBLIC_SEARCH",
  "ATS",
  "API",
  "COMPANY_WATCHLIST",
  "OTHER",
]);

const nullableText = z.string().trim().min(1).nullable();
const nullablePreservedText = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Must contain visible text")
  .nullable();
const nullableUrl = z.url().nullable();
const nullableDate = z.coerce.date().nullable();
const nullableAmount = z.number().nonnegative().nullable();

export const normalizedOpportunitySchema = z.object({
  domain: nullableText,

  externalListingId: nullableText,
  atsRequisitionId: nullableText,
  canonicalUrl: nullableUrl,
  applicationUrl: nullableUrl,
  originalSource: nullableText,
  discoveredAt: z.coerce.date(),
  sourceUpdatedAt: nullableDate,
  firstSeenAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),

  companyName: nullableText,
  brand: nullableText,
  parentCompany: nullableText,
  industry: nullableText,
  headquarters: nullableText,
  companySize: nullableText,

  title: nullableText,
  department: nullableText,
  employmentType: nullableText,
  seniority: nullableText,

  location: nullableText,
  remoteStatus: nullableText,
  timeZoneRequirements: nullableText,

  salaryMin: nullableAmount,
  salaryMax: nullableAmount,
  salaryText: nullableText,
  bonus: nullableText,
  equity: nullableText,
  currency: nullableText,
  compensationNotes: nullableText,

  postingDate: nullableDate,
  closingDate: nullableDate,
  source: nullableText,
  sourceType: opportunitySourceTypeSchema.nullable(),
  atsPlatform: nullableText,

  jobDescription: nullablePreservedText,
  responsibilities: nullableText,
  requirements: nullableText,
  benefits: nullableText,
  additionalNotes: nullableText,

  status: opportunityLifecycleStateSchema,
});

export type NormalizedOpportunity = z.infer<typeof normalizedOpportunitySchema>;
export type OpportunityLifecycleState = z.infer<typeof opportunityLifecycleStateSchema>;
export type OpportunitySourceType = z.infer<typeof opportunitySourceTypeSchema>;
