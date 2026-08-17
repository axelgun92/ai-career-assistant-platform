import {
  contradictionDraftSchema,
  evidenceRecordDraftSchema,
} from "@ai-career/evidence";
import { z } from "zod";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

export const responsibilityAreas = [
  "onboarding",
  "adoption",
  "engagement",
  "retention",
  "renewals",
  "expansion",
  "education",
  "enablement",
  "relationshipManagement",
  "support",
  "implementation",
  "projectManagement",
  "technicalTroubleshooting",
  "analytics",
  "customerInsights",
  "productFeedback",
  "executiveEngagement",
  "processDevelopment",
] as const;

export const responsibilityAreaSchema = z.enum(responsibilityAreas);

export const responsibilityProminenceSchema = z.enum([
  "PRIMARY",
  "SUBSTANTIAL",
  "SECONDARY",
  "OCCASIONAL",
  "ABSENT",
  "UNKNOWN",
]);

export const responsibilityOwnershipSchema = z.enum([
  "OWNS",
  "SHARES",
  "SUPPORTS",
  "COLLABORATES",
  "RECEIVES_HANDOFF",
  "HANDS_OFF",
  "UNKNOWN",
]);

export const responsibilityAssessmentSchema = z
  .object({
    prominence: responsibilityProminenceSchema,
    ownership: responsibilityOwnershipSchema,
    evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.prominence !== "UNKNOWN" &&
      value.evidenceReferences.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known responsibility conclusions require evidence",
      });
    }
  });

export const responsibilityMapSchema = z
  .object({
    areas: z.record(responsibilityAreaSchema, responsibilityAssessmentSchema),
    other: z.array(
      z
        .object({
          responsibility: requiredText,
          prominence: responsibilityProminenceSchema,
          ownership: responsibilityOwnershipSchema,
          evidenceReferences: evidenceReferences.min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const requirementStrengthSchema = z.enum([
  "REQUIRED",
  "PREFERRED",
  "IDEAL",
  "NICE_TO_HAVE",
  "AMBIGUOUS",
]);

export const requirementCategorySchema = z.enum([
  "EXPERIENCE",
  "CAPABILITY",
  "TOOL",
  "INDUSTRY",
  "EDUCATION",
  "CERTIFICATION",
  "TECHNICAL_KNOWLEDGE",
  "LANGUAGE",
  "LOCATION",
  "TRAVEL",
]);

export const requirementSchema = z
  .object({
    requirement: requiredText,
    category: requirementCategorySchema,
    strength: requirementStrengthSchema,
    statedYears: z.number().nonnegative().nullable(),
    statedYearsMaximum: z.number().nonnegative().nullable(),
    statedYearsOpenEnded: z.boolean(),
    experienceSpecificity: optionalText,
    evidenceReferences: evidenceReferences.min(1),
    ambiguity: z
      .object({
        isAmbiguous: z.boolean(),
        explanation: optionalText,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.statedYears !== null &&
      value.statedYearsMaximum !== null &&
      value.statedYearsMaximum < value.statedYears
    ) {
      context.addIssue({
        code: "custom",
        path: ["statedYearsMaximum"],
        message: "The maximum stated years cannot be below the minimum",
      });
    }
  });

export const requirementMapSchema = z.array(requirementSchema);

export const ownershipFunctions = [
  "customerSuccess",
  "sales",
  "support",
  "product",
  "implementation",
  "education",
  "community",
  "marketing",
  "projectManagement",
] as const;

export const ownershipFunctionSchema = z.enum(ownershipFunctions);

export const crossFunctionalOwnershipSchema = z.enum([
  "OWNS",
  "SHARES",
  "COLLABORATES",
  "HANDS_OFF_TO",
  "RECEIVES_FROM",
  "UNCLEAR_BOUNDARIES",
]);

export const ownershipMapSchema = z
  .object({
    functions: z.partialRecord(
      ownershipFunctionSchema,
      z
        .object({
          relationship: crossFunctionalOwnershipSchema,
          evidenceReferences: evidenceReferences.min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const roleClassificationSchema = z.enum([
  "CORE_CS",
  "CS_ADJACENT",
  "SUPPORT_HEAVY",
  "SALES_HEAVY",
  "IMPLEMENTATION_HEAVY",
  "TECHNICAL_CS",
  "UNRELATED",
]);

export const locationFactsSchema = z
  .object({
    countryRestrictions: z.array(requiredText),
    remoteStatus: z.enum(["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"]),
    timeZoneRequirements: z.array(requiredText),
    internationalEligibility: z.enum([
      "EXPLICITLY_ALLOWED",
      "EXPLICITLY_NOT_ALLOWED",
      "UNKNOWN",
    ]),
    visaSponsorship: z.enum(["AVAILABLE", "NOT_AVAILABLE", "UNKNOWN"]),
    relocation: z.enum(["AVAILABLE", "REQUIRED", "NOT_AVAILABLE", "UNKNOWN"]),
    eor: z.enum(["AVAILABLE", "NOT_AVAILABLE", "UNKNOWN"]),
    evidenceReferences,
  })
  .strict();

export const salaryFactsSchema = z
  .object({
    minimum: z.number().nonnegative().nullable(),
    maximum: z.number().nonnegative().nullable(),
    currency: optionalText,
    disclosure: z.enum(["DISCLOSED", "COMPETITIVE", "UNDISCLOSED"]),
    evidenceReferences,
  })
  .strict();

export const travelFactsSchema = z
  .object({
    statedPercentage: z.number().min(0).max(100).nullable(),
    frequency: optionalText,
    mandatory: z.boolean().nullable(),
    scope: z.enum(["DOMESTIC", "INTERNATIONAL", "BOTH", "UNKNOWN"]),
    purpose: z.enum([
      "CUSTOMER_ONSITE",
      "COMPANY_EVENT",
      "CONFERENCE",
      "FIELD_TRAVEL",
      "NONE",
      "OTHER",
      "UNKNOWN",
    ]),
    evidenceReferences,
  })
  .strict();

export const semanticReconstructionSchema = z
  .object({
    responsibilityMap: responsibilityMapSchema,
    requirements: requirementMapSchema,
    ownershipMap: ownershipMapSchema,
    roleMetadata: z
      .object({
        actualRoleClassification: roleClassificationSchema,
        evidenceReferences: evidenceReferences.min(1),
      })
      .strict(),
    evidence: z.array(evidenceRecordDraftSchema),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

export const customerSuccessJdReconstructionSchema = semanticReconstructionSchema
  .extend({
    location: locationFactsSchema,
    salary: salaryFactsSchema,
    travel: travelFactsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const known = new Set(value.evidence.map((item) => item.referenceId));
    const references: string[] = [
      ...value.roleMetadata.evidenceReferences,
      ...value.location.evidenceReferences,
      ...value.salary.evidenceReferences,
      ...value.travel.evidenceReferences,
      ...Object.values(value.responsibilityMap.areas).flatMap(
        (item) => item.evidenceReferences,
      ),
      ...value.responsibilityMap.other.flatMap(
        (item) => item.evidenceReferences,
      ),
      ...value.requirements.flatMap((item) => item.evidenceReferences),
      ...Object.values(value.ownershipMap.functions).flatMap(
        (item) => item.evidenceReferences,
      ),
      ...value.contradictions.flatMap((item) => [
        ...item.evidenceReferencesA,
        ...item.evidenceReferencesB,
      ]),
    ];
    for (const reference of references) {
      if (!known.has(reference)) {
        context.addIssue({
          code: "custom",
          path: ["evidence"],
          message: `Unknown evidence reference: ${reference}`,
        });
      }
    }
  });

export type CustomerSuccessJdReconstruction = z.infer<
  typeof customerSuccessJdReconstructionSchema
>;
export type SemanticReconstruction = z.infer<
  typeof semanticReconstructionSchema
>;
