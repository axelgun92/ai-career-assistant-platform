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

// Legacy string-reference shape remains readable for historical/offline results.
// Production requests use createSemanticAlexFitTransportSchema below.
export const semanticAlexFitTransportSchema = semanticAlexFitSchema
  .extend({
    experienceAlignment: transportExperienceAlignmentSchema,
    workingStyleAlignment: z.array(transportWorkingStyleAlignmentSchema),
  })
  .strict();

export const customerSuccessAlexFitPromptVersion = "cs-alex-fit-v2";

// Only the stage's JD + profile ledger supplies evidence. Upstream Unknown
// codes, requirement IDs and dimension names remain context, never catalog rows.
export function alexFitEvidenceCatalog<T extends AvailableSemanticEvidence>(
  availableEvidence: T[],
) {
  const references = new Set<string>();
  if (availableEvidence.length === 0) {
    semanticContractViolation("ALEX_FIT_EVIDENCE_CATALOG_INVALID", "Alex Fit requires an available evidence catalog");
  }
  return availableEvidence.map((evidence, evidenceIndex) => {
    if (!evidence.referenceId.trim() || references.has(evidence.referenceId)) {
      semanticContractViolation("ALEX_FIT_EVIDENCE_CATALOG_INVALID", "Alex Fit evidence identifiers must be nonempty and unique");
    }
    references.add(evidence.referenceId);
    return { ...evidence, evidenceIndex };
  });
}

export function createSemanticAlexFitTransportSchema(
  availableEvidence: AvailableSemanticEvidence[],
) {
  const catalog = alexFitEvidenceCatalog(availableEvidence);
  const indexes = z.array(z.number().int().min(0).max(catalog.length - 1));
  const finding = supportedAlignmentFindingSchema.omit({ evidenceReferences: true })
    .extend({ evidenceIndexes: indexes.min(1) }).strict();
  const unknown = companyAlignmentUnknownSchema.omit({ evidenceReferences: true })
    .extend({ evidenceIndexes: indexes }).strict();
  const experience = z.union([
    z.object({ relationship: z.enum(["DIRECT", "RELATED", "TRANSFERABLE"]), explanation: requiredText, evidenceIndexes: indexes.min(1) }).strict(),
    z.object({ relationship: z.enum(["UNSUPPORTED", "UNKNOWN"]), explanation: requiredText, evidenceIndexes: indexes }).strict(),
  ]);
  const workStyle = z.union([
    z.object({ area: requiredText, alignment: z.enum(["SUPPORTED", "CONCERN"]), explanation: requiredText, evidenceIndexes: indexes.min(1) }).strict(),
    z.object({ area: requiredText, alignment: z.literal("UNKNOWN"), explanation: requiredText, evidenceIndexes: indexes }).strict(),
  ]);
  return semanticAlexFitTransportSchema.omit({ evidenceReferences: true }).extend({
    experienceAlignment: experience,
    workingStyleAlignment: z.array(workStyle),
    careerStrategyAlignment: fitAssessmentSchema.omit({ evidenceReferences: true }).extend({ evidenceIndexes: indexes.min(1) }).strict(),
    strongestMatches: z.array(finding),
    partialMatches: z.array(finding),
    concerns: z.array(finding),
    strategicValue: z.array(finding),
    unknowns: z.array(unknown),
    evidenceIndexes: indexes.min(1),
    contradictions: z.array(contradictionDraftSchema.omit({ evidenceReferencesA: true, evidenceReferencesB: true }).extend({
      evidenceIndexesA: indexes.min(1), evidenceIndexesB: indexes.min(1),
    }).strict()),
  }).strict();
}

export function semanticAlexFitFromIndexedTransport(
  value: unknown,
  availableEvidence: AvailableSemanticEvidence[],
) {
  const catalog = alexFitEvidenceCatalog(availableEvidence);
  const transport = parseSemanticDomainResult({
    schema: createSemanticAlexFitTransportSchema(availableEvidence), value,
    code: "ALEX_FIT_EVIDENCE_INVALID",
    message: "Alex Fit provider output must use valid available evidence indexes",
  });
  // Repeated citations have always been allowed within a finding. Preserve
  // them; the complete stage selects distinct ledger records using its Set.
  const restore = (indexes: number[]) => indexes.map(index => catalog[index].referenceId);
  const restoreFinding = <T extends { evidenceIndexes: number[] }>(item: T) => {
    const { evidenceIndexes, ...rest } = item;
    return { ...rest, evidenceReferences: restore(evidenceIndexes) };
  };
  const { evidenceIndexes, ...rest } = transport;
  return semanticAlexFitFromTransport({
    ...rest,
    experienceAlignment: restoreFinding(transport.experienceAlignment),
    workingStyleAlignment: transport.workingStyleAlignment.map(restoreFinding),
    careerStrategyAlignment: restoreFinding(transport.careerStrategyAlignment),
    strongestMatches: transport.strongestMatches.map(restoreFinding),
    partialMatches: transport.partialMatches.map(restoreFinding),
    concerns: transport.concerns.map(restoreFinding),
    strategicValue: transport.strategicValue.map(restoreFinding),
    unknowns: transport.unknowns.map(restoreFinding),
    evidenceReferences: restore(evidenceIndexes),
    contradictions: transport.contradictions.map(({ evidenceIndexesA, evidenceIndexesB, ...contradiction }) => ({
      ...contradiction, evidenceReferencesA: restore(evidenceIndexesA), evidenceReferencesB: restore(evidenceIndexesB),
    })),
  }, availableEvidence);
}

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
