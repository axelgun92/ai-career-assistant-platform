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

export const customerSuccessFitAreaSchema = z.enum([
  "ONBOARDING",
  "EDUCATION",
  "ENABLEMENT",
  "RELATIONSHIP_MANAGEMENT",
  "ENGAGEMENT",
  "RETENTION",
  "ADOPTION",
  "CUSTOMER_INSIGHTS",
  "CROSS_FUNCTIONAL_COLLABORATION",
  "DOCUMENTATION",
  "PROBLEM_SOLVING",
  "STRATEGY",
  "MODERATE_SALES",
  "RENEWALS",
  "EXPANSION",
  "METRICS",
  "ADOPTION_TRACKING",
  "PRODUCT_FEEDBACK",
  "ANALYSIS",
]);

export const customerSuccessWorkStyleSchema = z.enum([
  "ASYNC_WORK",
  "DEEP_WORK",
  "DOCUMENTATION",
  "PROCESS_IMPROVEMENT",
  "EDUCATION",
  "CROSS_FUNCTIONAL_COLLABORATION",
  "FEEDBACK_LOOPS",
  "STRATEGIC_OWNERSHIP",
]);

export const customerSuccessLowerAlignmentPatternSchema = z.enum([
  "REACTIVE_SUPPORT",
  "CALL_CENTER_WORK",
  "CONSTANT_INTERRUPTION",
  "MEETING_HEAVY_WORK",
  "CALL_VOLUME_KPIS",
  "LITTLE_STRATEGIC_RESPONSIBILITY",
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
    fitPreferences: z
      .object({
        preferredAreas: z.array(customerSuccessFitAreaSchema).default([
          "ONBOARDING",
          "EDUCATION",
          "ENABLEMENT",
          "RELATIONSHIP_MANAGEMENT",
          "ENGAGEMENT",
          "RETENTION",
          "ADOPTION",
          "CUSTOMER_INSIGHTS",
          "CROSS_FUNCTIONAL_COLLABORATION",
          "DOCUMENTATION",
          "PROBLEM_SOLVING",
          "STRATEGY",
        ]),
        comfortableAreas: z.array(customerSuccessFitAreaSchema).default([
          "MODERATE_SALES",
          "RENEWALS",
          "EXPANSION",
          "METRICS",
          "ADOPTION_TRACKING",
          "PRODUCT_FEEDBACK",
          "ANALYSIS",
        ]),
        lowerAlignmentPatterns: z
          .array(customerSuccessLowerAlignmentPatternSchema)
          .default([
            "REACTIVE_SUPPORT",
            "CALL_CENTER_WORK",
            "CONSTANT_INTERRUPTION",
            "MEETING_HEAVY_WORK",
            "CALL_VOLUME_KPIS",
            "LITTLE_STRATEGIC_RESPONSIBILITY",
          ]),
      })
      .strict()
      .prefault({}),
    workStylePreferences: z
      .object({
        preferred: z.array(customerSuccessWorkStyleSchema).default([
          "ASYNC_WORK",
          "DEEP_WORK",
          "DOCUMENTATION",
          "PROCESS_IMPROVEMENT",
          "EDUCATION",
          "CROSS_FUNCTIONAL_COLLABORATION",
          "FEEDBACK_LOOPS",
          "STRATEGIC_OWNERSHIP",
        ]),
      })
      .strict()
      .prefault({}),
    workloadPreferences: z
      .object({
        complementaryCustomerSuccessResponsibilities: z
          .array(requiredText)
          .default([
            "onboarding",
            "adoption",
            "education",
            "enablement",
            "relationship management",
            "retention",
          ]),
        distinctFunctionOwnershipConcerns: z
          .array(requiredText)
          .default([
            "implementation",
            "project management",
            "support",
            "product management",
            "community management",
            "revenue ownership",
            "large-scale documentation production",
            "recurring travel",
          ]),
        genericPhrasesRequireCorroboration: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    careerStrategy: z
      .object({
        goals: z.array(requiredText).default([]),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type CustomerSuccessPreferences = z.infer<
  typeof customerSuccessPreferencesSchema
>;

export const customerSuccessDomainPreferencesSchema = z
  .object({
    customerSuccess: customerSuccessPreferencesSchema,
  })
  .strict();

export function defineCustomerSuccessPreferences(
  input: z.input<typeof customerSuccessPreferencesSchema>,
): CustomerSuccessPreferences {
  return customerSuccessPreferencesSchema.parse(input);
}

export function loadCustomerSuccessPreferencesFromProfile(
  domainPreferences: unknown,
): CustomerSuccessPreferences {
  return customerSuccessDomainPreferencesSchema.parse(domainPreferences)
    .customerSuccess;
}
