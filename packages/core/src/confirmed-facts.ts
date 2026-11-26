import { z } from "zod";
import { compensationCurrencyCodes, employmentTypeValues, seniorityValues, workArrangementValues } from "./opportunity";

// Facts the user confirmed from a job description (November 25, 2026): the
// structured values a reviewer can supply when a hard requirement is
// Unknown. Each is stored apart from the captured evidence and overlays the
// normalized value wherever facts are read, so triage and the opportunity
// page always agree, and a later capture never overwrites it.

const amount = z.number().finite().positive().max(10_000_000);
const region = z.string().trim().min(2).max(40);

export const confirmedFactValueSchemas = {
  salaryRange: z
    .object({ minimum: amount.nullable(), maximum: amount.nullable() })
    .strict()
    .refine((value) => value.minimum !== null || value.maximum !== null, "State a minimum or a maximum")
    .refine((value) => value.minimum === null || value.maximum === null || value.minimum <= value.maximum, "The minimum is above the maximum"),
  currency: z.enum(compensationCurrencyCodes),
  compensationBasis: z.enum(["BASE", "OTE"]),
  // The tier (by its label) that applies to this job.
  applicableTier: z.object({ label: z.string().trim().min(1).max(80) }).strict(),
  residency: z
    .object({ requirement: z.enum(["US_REQUIRED", "NON_US"]), regions: z.array(region).max(20) })
    .strict()
    .refine((value) => value.requirement === "US_REQUIRED" || value.regions.length > 0, "Name the eligible regions"),
  workArrangements: z.array(z.enum(workArrangementValues)).min(1).max(3),
  employmentType: z.object({ type: z.enum(employmentTypeValues), fullTimeSchedule: z.boolean() }).strict(),
  workAuthorization: z
    .object({
      requirement: z.enum(["RIGHT_TO_WORK", "CITIZENSHIP"]).nullable(),
      regions: z.array(region).max(20),
      visaSponsorship: z.enum(["AVAILABLE", "NOT_AVAILABLE"]).nullable(),
    })
    .strict(),
  seniority: z.enum(seniorityValues),
} as const;

export type ConfirmedFactField = keyof typeof confirmedFactValueSchemas;
export const confirmedFactFields = Object.keys(confirmedFactValueSchemas) as ConfirmedFactField[];
export type ConfirmedFactValue<F extends ConfirmedFactField> = z.infer<(typeof confirmedFactValueSchemas)[F]>;

export const confirmedFactLabels: Record<ConfirmedFactField, string> = {
  salaryRange: "Salary range",
  currency: "Salary currency",
  compensationBasis: "Compensation basis",
  applicableTier: "Applicable pay tier",
  residency: "Location or residency eligibility",
  workArrangements: "Work arrangement",
  employmentType: "Employment type",
  workAuthorization: "Work authorization and sponsorship",
  seniority: "Seniority",
};

export const confirmedFactInputSchema = z
  .object({
    fieldName: z.enum(confirmedFactFields as [ConfirmedFactField, ...ConfirmedFactField[]]),
    value: z.unknown(),
    quotation: z.string().trim().max(2000).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .transform((input, context) => {
    const parsed = confirmedFactValueSchemas[input.fieldName].safeParse(input.value);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: parsed.error.issues[0]?.message ?? "The value is invalid", path: ["value"] });
      return z.NEVER;
    }
    return { fieldName: input.fieldName, value: parsed.data as unknown, quotation: input.quotation || null, note: input.note || null };
  });

export interface ConfirmedFact {
  fieldName: ConfirmedFactField;
  value: unknown;
}

// The normalized facts a confirmed fact can replace.
export interface ConfirmableFacts {
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  compensationBasis: string | null;
  compensationTiers?: Array<{ label: string; minimum: number | null; maximum: number | null; currency: string | null }>;
  residencyRequirement: string | null;
  residencyRegions: string[];
  remoteStatus: string | null;
  workArrangements: string[];
  employmentType?: string | null;
  workAuthorizationRequirement: string | null;
  workAuthorizationRegions: string[];
  visaSponsorship: string | null;
  seniority?: string | null;
  // A full-time schedule the user confirmed (for a contract role).
  fullTimeScheduleConfirmed?: boolean;
}

// The facts with every confirmed value applied (a confirmed value always
// wins; an unconfirmed field keeps its captured value). Pure.
export function applyConfirmedFacts<T extends ConfirmableFacts>(facts: T, confirmed: readonly ConfirmedFact[]): T {
  const result: T = { ...facts };
  for (const fact of confirmed) {
    const schema = confirmedFactValueSchemas[fact.fieldName];
    const parsed = schema.safeParse(fact.value);
    if (!parsed.success) continue;
    const value = parsed.data as never;
    switch (fact.fieldName) {
      case "salaryRange": {
        const range = value as ConfirmedFactValue<"salaryRange">;
        result.salaryMin = range.minimum;
        result.salaryMax = range.maximum;
        break;
      }
      case "currency":
        result.currency = value;
        break;
      case "compensationBasis":
        result.compensationBasis = value;
        break;
      case "applicableTier": {
        const label = (value as ConfirmedFactValue<"applicableTier">).label;
        const tier = (facts.compensationTiers ?? []).find((item) => item.label === label);
        if (tier) {
          result.compensationTiers = [];
          result.salaryMin = tier.minimum;
          result.salaryMax = tier.maximum;
          result.currency = tier.currency ?? result.currency;
        }
        break;
      }
      case "residency": {
        const residency = value as ConfirmedFactValue<"residency">;
        result.residencyRequirement = residency.requirement;
        result.residencyRegions = residency.requirement === "US_REQUIRED" && residency.regions.length === 0 ? ["US"] : [...residency.regions];
        break;
      }
      case "workArrangements": {
        const arrangements = [...new Set(value as ConfirmedFactValue<"workArrangements">)];
        result.workArrangements = arrangements;
        result.remoteStatus = arrangements.length === 1 ? arrangements[0]! : null;
        break;
      }
      case "employmentType": {
        const employment = value as ConfirmedFactValue<"employmentType">;
        result.employmentType = employment.type;
        result.fullTimeScheduleConfirmed = employment.fullTimeSchedule;
        break;
      }
      case "workAuthorization": {
        const authorization = value as ConfirmedFactValue<"workAuthorization">;
        result.workAuthorizationRequirement = authorization.requirement;
        result.workAuthorizationRegions = [...authorization.regions];
        result.visaSponsorship = authorization.visaSponsorship;
        break;
      }
      case "seniority":
        result.seniority = value;
        break;
    }
  }
  return result;
}

// The captured value of a field, in the confirmed value's shape, to show
// beside a confirmation and to detect a later capture that disagrees.
export function capturedFactValue(field: ConfirmedFactField, facts: ConfirmableFacts): unknown {
  switch (field) {
    case "salaryRange":
      return facts.salaryMin === null && facts.salaryMax === null ? null : { minimum: facts.salaryMin, maximum: facts.salaryMax };
    case "currency":
      return facts.currency;
    case "compensationBasis":
      return facts.compensationBasis;
    case "applicableTier":
      return null;
    case "residency":
      return facts.residencyRequirement ? { requirement: facts.residencyRequirement, regions: facts.residencyRegions } : null;
    case "workArrangements":
      return facts.workArrangements.length ? facts.workArrangements : facts.remoteStatus ? [facts.remoteStatus] : null;
    case "employmentType":
      return facts.employmentType ? { type: facts.employmentType } : null;
    case "workAuthorization":
      return facts.workAuthorizationRequirement || facts.visaSponsorship
        ? { requirement: facts.workAuthorizationRequirement, regions: facts.workAuthorizationRegions, visaSponsorship: facts.visaSponsorship }
        : null;
    case "seniority":
      return facts.seniority ?? null;
  }
}
