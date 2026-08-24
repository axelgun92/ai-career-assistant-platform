import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";
import type { AvailableSemanticEvidence } from "./semantic-contract";
import {
  assertSemanticEvidenceReferences,
  parseSemanticDomainResult,
} from "./semantic-contract";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

export const existingCustomerSuccessFunctionSchema = z.enum([
  "ESTABLISHED",
  "PARTIALLY_ESTABLISHED",
  "EMERGING",
  "BUILDING_FROM_SCRATCH",
  "UNKNOWN",
]);

export const customerOperatingModelSchema = z.enum([
  "STRATEGIC_CS",
  "ADOPTION_FOCUSED",
  "EDUCATION_FOCUSED",
  "ENABLEMENT_FOCUSED",
  "COMMERCIAL_CS",
  "RENEWAL_FOCUSED",
  "EXPANSION_FOCUSED",
  "IMPLEMENTATION_HEAVY",
  "TECHNICAL_CS",
  "SUPPORT_HEAVY",
  "HYBRID",
  "UNKNOWN",
]);

const substantialOperatingModelPatternSchema = customerOperatingModelSchema.exclude([
  "HYBRID",
  "UNKNOWN",
]);

const maturityCriterionSchema = <T extends z.ZodEnum>(classification: T) =>
  z
    .object({
      classification,
      explanation: requiredText,
      evidenceReferences,
    })
    .strict()
    .superRefine((value, context) => {
      const assessed = value as {
        classification: string;
        evidenceReferences: string[];
      };
      if (
        assessed.classification !== "UNKNOWN" &&
        assessed.evidenceReferences.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidenceReferences"],
          message: "Known Organizational Maturity criteria require evidence",
        });
      }
    });

const ownershipDesignDimensionSchema = z
  .object({
    conclusion: optionalText,
    unknown: z.boolean(),
    evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.unknown && value.evidenceReferences.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known ownership-design conclusions require evidence",
      });
    }
    if (value.unknown && value.conclusion !== null) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "Unknown ownership-design conclusions must remain null",
      });
    }
    if (!value.unknown && value.conclusion === null) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "Known ownership-design conclusions must be present",
      });
    }
  });

export const ownershipAndCrossFunctionalDesignSchema = z
  .object({
    summary: requiredText,
    roleBoundaries: ownershipDesignDimensionSchema,
    teamBoundaries: ownershipDesignDimensionSchema,
    handoffs: ownershipDesignDimensionSchema,
    sharedOwnership: ownershipDesignDimensionSchema,
    crossFunctionalRelationships: ownershipDesignDimensionSchema,
    unrelatedResponsibilities: ownershipDesignDimensionSchema,
    scopeCreep: ownershipDesignDimensionSchema,
    multipleJobsCombined: ownershipDesignDimensionSchema,
    unrealisticOwnership: ownershipDesignDimensionSchema,
    evidenceReferences,
  })
  .strict();

export const semanticOrganizationalMaturitySchema = z
  .object({
    score: z.number().int().min(0).max(100),
    scoreExplanation: requiredText,
    scoreEvidenceReferences: evidenceReferences.min(1),
    existingCustomerSuccessFunction: maturityCriterionSchema(
      existingCustomerSuccessFunctionSchema,
    ),
    customerOperatingModel: maturityCriterionSchema(
      customerOperatingModelSchema,
    ).extend({
      substantialPatterns: z.array(substantialOperatingModelPatternSchema),
    }).superRefine((value, context) => {
      if (
        value.classification === "HYBRID" &&
        value.substantialPatterns.length < 2
      ) {
        context.addIssue({
          code: "custom",
          path: ["substantialPatterns"],
          message: "Hybrid operating models require at least two substantial patterns",
        });
      }
      if (
        value.classification === "UNKNOWN" &&
        value.substantialPatterns.length > 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["substantialPatterns"],
          message: "Unknown operating models cannot assert substantial patterns",
        });
      }
    }),
    ownershipAndCrossFunctionalDesign:
      ownershipAndCrossFunctionalDesignSchema,
    summary: requiredText,
    positiveSignals: z.array(supportedAlignmentFindingSchema),
    weakSignals: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    evidenceReferences: evidenceReferences.min(1),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

const transportKnownMaturityCriterionSchema = <T extends z.ZodEnum>(
  classification: T,
) =>
  z
    .object({
      classification: classification.exclude(["UNKNOWN"]),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict();

const transportUnknownMaturityCriterionSchema = z
  .object({
    classification: z.literal("UNKNOWN"),
    explanation: requiredText,
    evidenceReferences,
  })
  .strict();

const transportExistingCustomerSuccessFunctionSchema = z.union([
  transportKnownMaturityCriterionSchema(existingCustomerSuccessFunctionSchema),
  transportUnknownMaturityCriterionSchema,
]);

const transportCustomerOperatingModelSchema = z.union([
  z
    .object({
      classification: customerOperatingModelSchema.exclude([
        "HYBRID",
        "UNKNOWN",
      ]),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
      substantialPatterns: z.array(substantialOperatingModelPatternSchema),
    })
    .strict(),
  z
    .object({
      classification: z.literal("HYBRID"),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
      substantialPatterns: z
        .array(substantialOperatingModelPatternSchema)
        .min(2),
    })
    .strict(),
  z
    .object({
      classification: z.literal("UNKNOWN"),
      explanation: requiredText,
      evidenceReferences,
      substantialPatterns: z
        .array(substantialOperatingModelPatternSchema)
        .max(0),
    })
    .strict(),
]);

const transportOwnershipDesignDimensionSchema = z.union([
  z
    .object({
      conclusion: requiredText,
      unknown: z.literal(false),
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      conclusion: z.null(),
      unknown: z.literal(true),
      evidenceReferences,
    })
    .strict(),
]);

const semanticOrganizationalMaturityTransportShape = {
  ...semanticOrganizationalMaturitySchema.shape,
  existingCustomerSuccessFunction:
    transportExistingCustomerSuccessFunctionSchema,
  customerOperatingModel: transportCustomerOperatingModelSchema,
  ownershipAndCrossFunctionalDesign: z
    .object({
      summary: requiredText,
      roleBoundaries: transportOwnershipDesignDimensionSchema,
      teamBoundaries: transportOwnershipDesignDimensionSchema,
      handoffs: transportOwnershipDesignDimensionSchema,
      sharedOwnership: transportOwnershipDesignDimensionSchema,
      crossFunctionalRelationships: transportOwnershipDesignDimensionSchema,
      unrelatedResponsibilities: transportOwnershipDesignDimensionSchema,
      scopeCreep: transportOwnershipDesignDimensionSchema,
      multipleJobsCombined: transportOwnershipDesignDimensionSchema,
      unrealisticOwnership: transportOwnershipDesignDimensionSchema,
      evidenceReferences,
    })
    .strict(),
};

export const semanticOrganizationalMaturityTransportSchema = z
  .object(semanticOrganizationalMaturityTransportShape)
  .strict();

export function semanticOrganizationalMaturityFromTransport(
  value: z.input<typeof semanticOrganizationalMaturityTransportSchema>,
  availableEvidence: AvailableSemanticEvidence[],
) {
  const transport = semanticOrganizationalMaturityTransportSchema.parse(value);
  const result = parseSemanticDomainResult({
    schema: semanticOrganizationalMaturitySchema,
    value: transport,
    code: "ORGANIZATIONAL_MATURITY_DOMAIN_INVALID",
    message: "Organizational Maturity violated the domain contract",
  });
  const design = result.ownershipAndCrossFunctionalDesign;
  assertSemanticEvidenceReferences({
    references: [
      ...result.scoreEvidenceReferences,
      ...result.existingCustomerSuccessFunction.evidenceReferences,
      ...result.customerOperatingModel.evidenceReferences,
      ...design.evidenceReferences,
      ...design.roleBoundaries.evidenceReferences,
      ...design.teamBoundaries.evidenceReferences,
      ...design.handoffs.evidenceReferences,
      ...design.sharedOwnership.evidenceReferences,
      ...design.crossFunctionalRelationships.evidenceReferences,
      ...design.unrelatedResponsibilities.evidenceReferences,
      ...design.scopeCreep.evidenceReferences,
      ...design.multipleJobsCombined.evidenceReferences,
      ...design.unrealisticOwnership.evidenceReferences,
      ...result.evidenceReferences,
      ...result.positiveSignals.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.weakSignals.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.unknowns.flatMap((unknown) => unknown.evidenceReferences),
      ...result.contradictions.flatMap((contradiction) => [
        ...contradiction.evidenceReferencesA,
        ...contradiction.evidenceReferencesB,
      ]),
    ],
    availableEvidence,
    code: "ORGANIZATIONAL_MATURITY_EVIDENCE_INVALID",
    message: "Organizational Maturity references unavailable evidence",
  });
  return result;
}

export const organizationalMaturityDataSchema = z.discriminatedUnion(
  "evaluated",
  [
    z
      .object({
        evaluated: z.literal(false),
        reason: requiredText,
      })
      .strict(),
    z
      .object({
        evaluated: z.literal(true),
        maturity: semanticOrganizationalMaturitySchema,
      })
      .strict(),
  ],
);

export type SemanticOrganizationalMaturity = z.infer<
  typeof semanticOrganizationalMaturitySchema
>;
export type OrganizationalMaturityData = z.infer<
  typeof organizationalMaturityDataSchema
>;
