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
const evidenceReferences = z.array(requiredText);

export const alexFitClassificationSchema = z.enum([
  "STRONG",
  "GOOD",
  "MIXED",
  "LOW",
]);

export const alexFitRelationshipSchema = z.enum([
  "DIRECT",
  "RELATED",
  "TRANSFERABLE",
  "UNSUPPORTED",
  "UNKNOWN",
]);

export const workStyleAlignmentSchema = z.enum([
  "SUPPORTED",
  "CONCERN",
  "UNKNOWN",
]);

const fitAssessmentSchema = z
  .object({
    conclusion: requiredText,
    evidenceReferences: evidenceReferences.min(1),
  })
  .strict();

export const semanticAlexFitSchema = z
  .object({
    classification: alexFitClassificationSchema,
    summary: requiredText,
    experienceAlignment: z
      .object({
        relationship: alexFitRelationshipSchema,
        explanation: requiredText,
        evidenceReferences,
      })
      .strict()
      .superRefine((value, context) => {
        if (
          !["UNSUPPORTED", "UNKNOWN"].includes(value.relationship) &&
          value.evidenceReferences.length === 0
        ) {
          context.addIssue({
            code: "custom",
            path: ["evidenceReferences"],
            message: "Supported experience relationships require evidence",
          });
        }
      }),
    workingStyleAlignment: z.array(
      z
        .object({
          area: requiredText,
          alignment: workStyleAlignmentSchema,
          explanation: requiredText,
          evidenceReferences,
        })
        .strict()
        .superRefine((value, context) => {
          if (
            value.alignment !== "UNKNOWN" &&
            value.evidenceReferences.length === 0
          ) {
            context.addIssue({
              code: "custom",
              path: ["evidenceReferences"],
              message: "Known working-style conclusions require evidence",
            });
          }
        }),
    ),
    careerStrategyAlignment: fitAssessmentSchema,
    strongestMatches: z.array(supportedAlignmentFindingSchema),
    partialMatches: z.array(supportedAlignmentFindingSchema),
    concerns: z.array(supportedAlignmentFindingSchema),
    strategicValue: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    evidenceReferences: evidenceReferences.min(1),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

const transportExperienceAlignmentSchema = z.union([
  z
    .object({
      relationship: z.enum(["DIRECT", "RELATED", "TRANSFERABLE"]),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      relationship: z.enum(["UNSUPPORTED", "UNKNOWN"]),
      explanation: requiredText,
      evidenceReferences,
    })
    .strict(),
]);

const transportWorkingStyleAlignmentSchema = z.union([
  z
    .object({
      area: requiredText,
      alignment: z.enum(["SUPPORTED", "CONCERN"]),
      explanation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      area: requiredText,
      alignment: z.literal("UNKNOWN"),
      explanation: requiredText,
      evidenceReferences,
    })
    .strict(),
]);

export const semanticAlexFitTransportSchema = semanticAlexFitSchema
  .extend({
    experienceAlignment: transportExperienceAlignmentSchema,
    workingStyleAlignment: z.array(transportWorkingStyleAlignmentSchema),
  })
  .strict();

export function semanticAlexFitFromTransport(
  value: z.input<typeof semanticAlexFitTransportSchema>,
  availableEvidence: AvailableSemanticEvidence[],
) {
  const transport = semanticAlexFitTransportSchema.parse(value);
  const result = parseSemanticDomainResult({
    schema: semanticAlexFitSchema,
    value: transport,
    code: "ALEX_FIT_DOMAIN_INVALID",
    message: "Alex Fit violated the domain contract",
  });
  assertSemanticEvidenceReferences({
    references: [
      ...result.evidenceReferences,
      ...result.experienceAlignment.evidenceReferences,
      ...result.workingStyleAlignment.flatMap(
        (assessment) => assessment.evidenceReferences,
      ),
      ...result.careerStrategyAlignment.evidenceReferences,
      ...result.strongestMatches.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.partialMatches.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.concerns.flatMap((finding) => finding.evidenceReferences),
      ...result.strategicValue.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.unknowns.flatMap((unknown) => unknown.evidenceReferences),
      ...result.contradictions.flatMap((contradiction) => [
        ...contradiction.evidenceReferencesA,
        ...contradiction.evidenceReferencesB,
      ]),
    ],
    availableEvidence,
    code: "ALEX_FIT_EVIDENCE_INVALID",
    message: "Alex Fit references unavailable evidence",
  });
  return result;
}

export const alexFitDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({ evaluated: z.literal(true), fit: semanticAlexFitSchema })
    .strict(),
]);

export type AlexFitData = z.infer<typeof alexFitDataSchema>;
export type SemanticAlexFit = z.infer<typeof semanticAlexFitSchema>;
