import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";

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

export const alexFitDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({ evaluated: z.literal(true), fit: semanticAlexFitSchema })
    .strict(),
]);

export type AlexFitData = z.infer<typeof alexFitDataSchema>;
export type SemanticAlexFit = z.infer<typeof semanticAlexFitSchema>;
