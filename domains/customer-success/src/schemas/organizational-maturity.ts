import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";

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
