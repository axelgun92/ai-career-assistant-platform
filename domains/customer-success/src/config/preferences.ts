import { z } from "zod";

const requiredText = z.string().trim().min(1);

export const businessModelPreferenceSchema = z.enum([
  "SAAS",
  "SOFTWARE",
  "TECHNOLOGY",
  "EDTECH",
  "MARKETPLACE",
  "SUBSCRIPTION",
  "OTHER",
]);

export const customerTypePreferenceSchema = z.enum([
  "B2C",
  "B2B2C",
  "LIGHT_B2B",
  "ENTERPRISE_HEAVY_B2B",
  "MIXED",
]);

export const productTypePreferenceSchema = z.enum([
  "WORKFLOW",
  "PRODUCTIVITY",
  "COLLABORATION",
  "LEARNING",
  "AUTOMATION",
  "NO_CODE",
  "LOW_CODE",
  "MODERATELY_TECHNICAL",
  "DEVELOPER_FOCUSED",
  "OTHER",
]);

export const customerSegmentPreferenceSchema = z.enum([
  "SMB",
  "MID_MARKET",
  "COMMERCIAL",
  "ENTERPRISE",
  "MIXED",
]);

export const customerSuccessPreferencesSchema = z
  .object({
    salary: z
      .object({
        currency: requiredText.default("USD"),
        passMinimum: z.number().nonnegative().default(60_000),
        reviewMinimum: z.number().nonnegative().default(55_000),
        substantiallyLowerCostCountries: z.array(requiredText).default([]),
      })
      .refine((value) => value.passMinimum > value.reviewMinimum, {
        message: "The salary pass threshold must exceed the review threshold",
      }),
    location: z.object({
      allowedCountries: z.array(requiredText).default([]),
      disallowedCountries: z.array(requiredText).default([]),
      allowUnitedStatesOnlyRoles: z.boolean().default(true),
    }),
    travel: z.object({
      allowInfrequentCompanyEvents: z.boolean().default(true),
      allowExceptionalCustomerVisits: z.boolean().default(true),
      recurringCustomerOnsiteResult: z.literal("FAIL").default("FAIL"),
      fieldTravelResult: z.literal("FAIL").default("FAIL"),
    }),
    workArrangement: z.object({
      allowed: z
        .array(z.enum(["REMOTE", "HYBRID", "ONSITE"]))
        .min(1)
        .default(["REMOTE"]),
      unknownResult: z.enum(["REVIEW", "UNKNOWN"]).default("UNKNOWN"),
    }),
    roleFamilies: z.object({
      continuingClassifications: z
        .array(
          z.enum([
            "CORE_CS",
            "CS_ADJACENT",
            "SUPPORT_HEAVY",
            "SALES_HEAVY",
            "IMPLEMENTATION_HEAVY",
            "TECHNICAL_CS",
          ]),
        )
        .min(1),
    }),
    companyPreferences: z
      .object({
        preferredBusinessModels: z
          .array(businessModelPreferenceSchema)
          .default(["SAAS", "SOFTWARE", "TECHNOLOGY"]),
        alsoAlignedBusinessModels: z
          .array(businessModelPreferenceSchema)
          .default(["EDTECH", "MARKETPLACE", "SUBSCRIPTION"]),
      })
      .strict()
      .prefault({}),
    productPreferences: z
      .object({
        preferredProductTypes: z
          .array(productTypePreferenceSchema)
          .default([
            "WORKFLOW",
            "PRODUCTIVITY",
            "COLLABORATION",
            "LEARNING",
            "AUTOMATION",
            "NO_CODE",
            "LOW_CODE",
          ]),
        moderatelyTechnicalAlignedWork: z
          .array(
            z.enum([
              "ONBOARDING",
              "EDUCATION",
              "ENABLEMENT",
              "ADOPTION",
              "CUSTOMER_GUIDANCE",
            ]),
          )
          .default([
            "ONBOARDING",
            "EDUCATION",
            "ENABLEMENT",
            "ADOPTION",
            "CUSTOMER_GUIDANCE",
          ]),
        developerFocusedRequiresDeepEngineeringConcern: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    customerPreferences: z
      .object({
        customerTypes: z.array(customerTypePreferenceSchema).default([
          "B2C",
          "B2B2C",
          "LIGHT_B2B",
          "ENTERPRISE_HEAVY_B2B",
          "MIXED",
        ]),
        customerSegments: z.array(customerSegmentPreferenceSchema).default([
          "SMB",
          "MID_MARKET",
          "COMMERCIAL",
          "ENTERPRISE",
          "MIXED",
        ]),
        enterpriseRequiresContextualEvidenceForConcern: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    workStylePreferences: z.record(z.string(), z.json()).default({}),
    careerStrategy: z.record(z.string(), z.json()).default({}),
  })
  .strict();

export type CustomerSuccessPreferences = z.infer<
  typeof customerSuccessPreferencesSchema
>;

export function defineCustomerSuccessPreferences(
  input: z.input<typeof customerSuccessPreferencesSchema>,
): CustomerSuccessPreferences {
  return customerSuccessPreferencesSchema.parse(input);
}
