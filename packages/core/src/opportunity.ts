import { z } from "zod";
import { residencyRequirementValues } from "./geography";

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

// Product vocabularies for normalized position and compensation fields. The
// stored columns stay free text (the shared normalized contract is not
// narrowed); product normalization writes only these values, and anything
// it cannot state explicitly stays null (Unknown).
export const workArrangementValues = ["REMOTE", "HYBRID", "ONSITE"] as const;
export const seniorityValues = [
  "ENTRY",
  "MID",
  "SENIOR",
  "LEAD",
  "PRINCIPAL",
  "DIRECTOR",
  "EXECUTIVE",
] as const;
export const employmentTypeValues = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "TEMPORARY",
  "INTERNSHIP",
] as const;
// ISO 4217 codes the product recognizes in compensation text. No conversion
// exists: amounts are only ever compared within one currency.
export const compensationCurrencyCodes = [
  "USD",
  "CAD",
  "AUD",
  "NZD",
  "EUR",
  "GBP",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "INR",
  "SGD",
  "JPY",
  "MXN",
  "BRL",
  "ZAR",
] as const;
// Currencies written with a "$" sign.
export const dollarCurrencyCodes = ["USD", "CAD", "AUD", "NZD", "SGD", "MXN"] as const;

export type WorkArrangement = (typeof workArrangementValues)[number];
export type Seniority = (typeof seniorityValues)[number];
export type EmploymentType = (typeof employmentTypeValues)[number];
export type CompensationCurrency = (typeof compensationCurrencyCodes)[number];

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
  // Explicit residency / geographic eligibility (see geography.ts). Optional
  // on input so existing producers stay valid; Unknown is null / [].
  residencyRequirement: z.enum(residencyRequirementValues).nullable().default(null),
  residencyRegions: z.array(z.string().trim().min(1)).default([]),

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

// True once deterministic normalization has produced the Opportunity record.
// Every lifecycle state after DISCOVERED (system or user-owned) keeps the
// normalized data, so evaluation may run on it; product rules about which
// states may *request* evaluation live outside Core.
export function isNormalizedLifecycleState(status: OpportunityLifecycleState): boolean {
  return status !== "DISCOVERED";
}
