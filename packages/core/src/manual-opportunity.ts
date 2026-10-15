import { z } from "zod";
import {
  parseGeographyList,
  residencyRequirementFor,
  residencyRequirementValues,
} from "./geography";
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
    workArrangement: z.enum(workArrangementValues).optional(),
    seniority: z.enum(seniorityValues).optional(),
    employmentType: z.enum(employmentTypeValues).optional(),
    department: optionalSuppliedText.refine(
      (value) => value === undefined || value.trim().length <= 120,
      "Department must be at most 120 characters",
    ),
    closingDate: z.iso.date().optional(),
    compensationCurrency: z.enum(compensationCurrencyCodes).optional(),
    residencyRequirement: z.enum(residencyRequirementValues).optional(),
    residencyRegions: optionalSuppliedText.refine(
      (value) =>
        value === undefined ||
        (value.length <= 200 && parseGeographyList(value) !== null),
      "List countries, states, provinces or regions using an unambiguous name",
    ),
    domain: optionalSuppliedText.refine(
      (value) =>
        value === undefined || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
      "Domain must be a lowercase slug such as customer-success",
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.residencyRequirement || !value.residencyRegions) return;
    const regions = parseGeographyList(value.residencyRegions);
    if (regions && residencyRequirementFor(regions) !== value.residencyRequirement) {
      context.addIssue({
        code: "custom",
        path: ["residencyRegions"],
        message: "The stated residency requirement conflicts with the stated eligible regions",
      });
    }
  });

export const manualStatedDetailsSchema = z
  .object({
    workArrangement: z.enum(workArrangementValues).nullable().default(null),
    seniority: z.enum(seniorityValues).nullable().default(null),
    department: z.string().nullable().default(null),
    closingDate: z.string().nullable().default(null),
    compensationCurrency: z.enum(compensationCurrencyCodes).nullable().default(null),
    residencyRequirement: z.enum(residencyRequirementValues).nullable().default(null),
    residencyRegions: z.string().nullable().default(null),
  })
  .default({
    workArrangement: null,
    seniority: null,
    department: null,
    closingDate: null,
    compensationCurrency: null,
    residencyRequirement: null,
    residencyRegions: null,
  });

export type ManualStatedDetails = z.infer<typeof manualStatedDetailsSchema>;

export const opportunityIdSchema = z.uuid();

export type ManualOpportunitySubmission = z.infer<
  typeof manualOpportunitySubmissionSchema
>;
