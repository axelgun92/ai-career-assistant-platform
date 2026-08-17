import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

export const businessModelClassificationSchema = z.enum([
  "SAAS",
  "SOFTWARE",
  "TECHNOLOGY",
  "EDTECH",
  "MARKETPLACE",
  "SUBSCRIPTION",
  "OTHER",
  "UNKNOWN",
]);

export const customerTypeClassificationSchema = z.enum([
  "B2C",
  "B2B2C",
  "LIGHT_B2B",
  "ENTERPRISE_HEAVY_B2B",
  "MIXED",
  "UNKNOWN",
]);

export const productTypeClassificationSchema = z.enum([
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
  "UNKNOWN",
]);

export const customerSegmentClassificationSchema = z.enum([
  "SMB",
  "MID_MARKET",
  "COMMERCIAL",
  "ENTERPRISE",
  "MIXED",
  "UNKNOWN",
]);

function classificationAssessment<T extends z.ZodEnum>(classification: T) {
  return z
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
          message: "Known Company Alignment classifications require evidence",
        });
      }
    });
}

export const supportedAlignmentFindingSchema = z
  .object({
    finding: requiredText,
    evidenceReferences: evidenceReferences.min(1),
  })
  .strict();

export const companyAlignmentUnknownSchema = z
  .object({
    code: requiredText.regex(/^[a-z][a-z0-9-]*$/),
    description: requiredText,
    materiality: optionalText,
    evidenceReferences,
  })
  .strict();

export const semanticCompanyAlignmentSchema = z
  .object({
    businessModel: classificationAssessment(businessModelClassificationSchema),
    customerType: classificationAssessment(customerTypeClassificationSchema),
    productType: classificationAssessment(productTypeClassificationSchema),
    customerSegment: classificationAssessment(
      customerSegmentClassificationSchema,
    ),
    alignmentSummary: requiredText,
    strategicAdvantages: z.array(supportedAlignmentFindingSchema),
    potentialConcerns: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    evidenceReferences,
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

export const companyAlignmentDataSchema = z.discriminatedUnion("evaluated", [
  z
    .object({
      evaluated: z.literal(false),
      reason: requiredText,
    })
    .strict(),
  z
    .object({
      evaluated: z.literal(true),
      alignment: semanticCompanyAlignmentSchema,
    })
    .strict(),
]);

export type SemanticCompanyAlignment = z.infer<
  typeof semanticCompanyAlignmentSchema
>;
export type CompanyAlignmentData = z.infer<typeof companyAlignmentDataSchema>;
