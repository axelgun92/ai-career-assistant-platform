import {
  contradictionDraftSchema,
  evidenceRecordDraftSchema,
} from "@ai-career/evidence";
import { z } from "zod";
import {
  assertSemanticEvidenceReferences,
  parseSemanticDomainResult,
  semanticContractViolation,
} from "./semantic-contract";

const requiredText = z.string().trim().min(1).regex(/\S/);
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

const ownershipFunctionAssessmentSchema = z
  .object({
    relationship: crossFunctionalOwnershipSchema,
    evidenceReferences: evidenceReferences.min(1),
  })
  .strict();

export const ownershipMapSchema = z
  .object({
    functions: z.partialRecord(
      ownershipFunctionSchema,
      ownershipFunctionAssessmentSchema,
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

const knownResponsibilityProminences = [
  "PRIMARY",
  "SUBSTANTIAL",
  "SECONDARY",
  "OCCASIONAL",
  "ABSENT",
] as const;

const transportResponsibilityAreaEntrySchema = z.union([
  z
    .object({
      area: responsibilityAreaSchema,
      prominence: z.enum(knownResponsibilityProminences),
      ownership: responsibilityOwnershipSchema,
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      area: responsibilityAreaSchema,
      prominence: z.literal("UNKNOWN"),
      ownership: responsibilityOwnershipSchema,
      evidenceReferences,
    })
    .strict(),
]);

const transportResponsibilityAreasSchema = z
  .array(transportResponsibilityAreaEntrySchema)
  .length(responsibilityAreas.length);

const transportOwnershipFunctionsSchema = z
  .array(
    z
      .object({
        function: ownershipFunctionSchema,
        relationship: crossFunctionalOwnershipSchema,
        evidenceReferences: evidenceReferences.min(1),
      })
      .strict(),
  )
  .max(ownershipFunctions.length);

const transportRequirementSchema = z
  .object({ ...requirementSchema.shape })
  .strict();

const transportEvidenceRecordBaseShape = {
  ...evidenceRecordDraftSchema.shape,
  referenceId: requiredText,
  criterionId: optionalText,
  claim: requiredText,
  sourceType: requiredText,
  sourceField: optionalText,
  sourceReference: optionalText,
  sourceText: optionalText,
  evidenceType: requiredText,
  collectedAt: z.iso.datetime({ offset: true }).nullable(),
};

const transportEvidenceRecordDraftSchema = z.union([
  z
    .object({
      ...transportEvidenceRecordBaseShape,
      sourceRecordId: z.uuid(),
    })
    .strict(),
  z
    .object({
      ...transportEvidenceRecordBaseShape,
      provenanceId: z.uuid(),
    })
    .strict(),
  z
    .object({
      ...transportEvidenceRecordBaseShape,
      sourceReference: requiredText,
    })
    .strict(),
]);

const transportContradictionDraftSchema = z
  .object({
    ...contradictionDraftSchema.shape,
    claimA: requiredText,
    claimB: requiredText,
    interpretation: requiredText,
    relevantField: optionalText,
    significance: optionalText,
    evidenceReferencesA: evidenceReferences.min(1),
    evidenceReferencesB: evidenceReferences.min(1),
  })
  .strict();

export const semanticReconstructionTransportSchema = z
  .object({
    responsibilityMap: z
      .object({
        areas: transportResponsibilityAreasSchema,
        other: responsibilityMapSchema.shape.other,
      })
      .strict(),
    requirements: z.array(transportRequirementSchema),
    ownershipMap: z
      .object({
        functions: transportOwnershipFunctionsSchema,
      })
      .strict(),
    roleMetadata: semanticReconstructionSchema.shape.roleMetadata,
    evidence: z.array(transportEvidenceRecordDraftSchema),
    contradictions: z.array(transportContradictionDraftSchema),
  })
  .strict();

export type SemanticReconstructionTransport = z.infer<
  typeof semanticReconstructionTransportSchema
>;
export type SemanticReconstruction = z.infer<
  typeof semanticReconstructionSchema
>;

export function semanticReconstructionFromTransport(
  input: unknown,
): SemanticReconstruction {
  const transport = semanticReconstructionTransportSchema.parse(input);
  const uniqueAreas = new Set(
    transport.responsibilityMap.areas.map((entry) => entry.area),
  );
  if (uniqueAreas.size !== responsibilityAreas.length) {
    semanticContractViolation(
      "JD_RECONSTRUCTION_IDENTITY_INVALID",
      "JD Reconstruction must contain every responsibility area exactly once",
    );
  }
  const uniqueFunctions = new Set(
    transport.ownershipMap.functions.map((entry) => entry.function),
  );
  if (uniqueFunctions.size !== transport.ownershipMap.functions.length) {
    semanticContractViolation(
      "JD_RECONSTRUCTION_IDENTITY_INVALID",
      "JD Reconstruction contains a repeated ownership function",
    );
  }
  const areas = Object.fromEntries(
    transport.responsibilityMap.areas.map(({ area, ...assessment }) => [
      area,
      assessment,
    ]),
  );
  const functions = Object.fromEntries(
    transport.ownershipMap.functions.map(
      ({ function: functionName, ...assessment }) => [functionName, assessment],
    ),
  );

  const result = parseSemanticDomainResult({
    schema: semanticReconstructionSchema,
    value: {
    ...transport,
    responsibilityMap: {
      areas,
      other: transport.responsibilityMap.other,
    },
    ownershipMap: { functions },
    },
    code: "JD_RECONSTRUCTION_DOMAIN_INVALID",
    message: "JD Reconstruction violated the domain contract",
  });
  assertSemanticEvidenceReferences({
    references: [
      ...result.roleMetadata.evidenceReferences,
      ...Object.values(result.responsibilityMap.areas).flatMap(
        (assessment) => assessment.evidenceReferences,
      ),
      ...result.responsibilityMap.other.flatMap(
        (assessment) => assessment.evidenceReferences,
      ),
      ...result.requirements.flatMap(
        (requirement) => requirement.evidenceReferences,
      ),
      ...Object.values(result.ownershipMap.functions).flatMap(
        (assessment) => assessment.evidenceReferences,
      ),
      ...result.contradictions.flatMap((contradiction) => [
        ...contradiction.evidenceReferencesA,
        ...contradiction.evidenceReferencesB,
      ]),
    ],
    availableEvidence: result.evidence,
    code: "JD_RECONSTRUCTION_EVIDENCE_INVALID",
    message: "JD Reconstruction references unavailable evidence",
  });
  return result;
}

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
