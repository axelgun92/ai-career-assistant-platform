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
  semanticContractViolation,
} from "./semantic-contract";

const requiredText = z.string().trim().min(1);
const evidenceReferences = z.array(requiredText);

export const postingAgePrioritySchema = z.enum([
  "HIGHEST_PRIORITY",
  "STRONG_PRIORITY",
  "GOOD_OPPORTUNITY",
  "REVIEW",
  "CAUTION",
  "UNKNOWN",
]);

export const opportunityPriorityBandSchema = z.enum([
  "VERY_LOW",
  "LOW",
  "MIXED_MODERATE",
  "HIGH",
  "VERY_HIGH",
]);

export const applicationEffortSchema = z.enum([
  "LOW",
  "MODERATE",
  "HIGH",
  "UNKNOWN",
]);

export const postingTimingSchema = z
  .object({
    postingDate: z.iso.date().nullable(),
    evaluationDate: z.iso.date(),
    ageDays: z.number().int().nonnegative().nullable(),
    classification: postingAgePrioritySchema,
    explanation: requiredText,
    evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.classification === "UNKNOWN") {
      if (value.ageDays !== null) {
        context.addIssue({
          code: "custom",
          path: ["ageDays"],
          message: "Unknown posting age cannot contain a calculated age",
        });
      }
      return;
    }
    if (value.ageDays === null || value.evidenceReferences.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known posting age requires a calculated age and evidence",
      });
    }
  });

export const applicationEffortAssessmentSchema = z
  .object({
    classification: applicationEffortSchema,
    explanation: requiredText,
    evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.classification !== "UNKNOWN" &&
      value.evidenceReferences.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known application effort requires evidence",
      });
    }
  });

export const semanticOpportunityPrioritySchema = z
  .object({
    score: z.number().int().min(0).max(100),
    scoreExplanation: requiredText,
    scoreEvidenceReferences: evidenceReferences.min(1),
    strategicValueSummary: requiredText,
    strategicValueEvidenceReferences: evidenceReferences.min(1),
    applicationEffort: applicationEffortAssessmentSchema,
    reasonsForPrioritization: z.array(supportedAlignmentFindingSchema),
    reasonsForReducedPriority: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    evidenceReferences: evidenceReferences.min(1),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

const transportApplicationEffortSchema = z.union([
  z
    .object({
      classification: z.enum(["LOW", "MODERATE", "HIGH"]),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      classification: z.literal("UNKNOWN"),
      explanation: requiredText,
      evidenceReferences,
    })
    .strict(),
]);

export const semanticOpportunityPriorityTransportSchema =
  semanticOpportunityPrioritySchema
    .extend({ applicationEffort: transportApplicationEffortSchema })
    .strict();

export function semanticOpportunityPriorityFromTransport(
  value: z.input<typeof semanticOpportunityPriorityTransportSchema>,
  input: {
    availableEvidence: AvailableSemanticEvidence[];
    postingTimingEvidenceReferences: string[];
  },
) {
  const transport = semanticOpportunityPriorityTransportSchema.parse(value);
  const result = parseSemanticDomainResult({
    schema: semanticOpportunityPrioritySchema,
    value: transport,
    code: "OPPORTUNITY_PRIORITY_DOMAIN_INVALID",
    message: "Opportunity Priority violated the domain contract",
  });
  assertSemanticEvidenceReferences({
    references: [
      ...result.scoreEvidenceReferences,
      ...result.strategicValueEvidenceReferences,
      ...result.applicationEffort.evidenceReferences,
      ...result.reasonsForPrioritization.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.reasonsForReducedPriority.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.unknowns.flatMap((unknown) => unknown.evidenceReferences),
      ...result.evidenceReferences,
      ...result.contradictions.flatMap((contradiction) => [
        ...contradiction.evidenceReferencesA,
        ...contradiction.evidenceReferencesB,
      ]),
    ],
    availableEvidence: input.availableEvidence,
    code: "OPPORTUNITY_PRIORITY_EVIDENCE_INVALID",
    message: "Opportunity Priority references unavailable evidence",
  });
  if (
    result.scoreEvidenceReferences.every((reference) =>
      input.postingTimingEvidenceReferences.includes(reference),
    )
  ) {
    semanticContractViolation(
      "OPPORTUNITY_PRIORITY_EVIDENCE_INVALID",
      "Opportunity Priority cannot be supported by posting age alone",
    );
  }
  return result;
}

export const opportunityPriorityDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({
      evaluated: z.literal(true),
      band: opportunityPriorityBandSchema,
      timing: postingTimingSchema,
      priority: semanticOpportunityPrioritySchema,
    })
    .strict(),
]);

export type PostingTiming = z.infer<typeof postingTimingSchema>;
export type ApplicationEffortAssessment = z.infer<
  typeof applicationEffortAssessmentSchema
>;
export type OpportunityPriorityData = z.infer<
  typeof opportunityPriorityDataSchema
>;
export type SemanticOpportunityPriority = z.infer<
  typeof semanticOpportunityPrioritySchema
>;
