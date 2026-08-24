import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import { companyAlignmentUnknownSchema } from "./company-alignment";
import type { AvailableSemanticEvidence } from "./semantic-contract";
import {
  assertSemanticEvidenceReferences,
  parseSemanticDomainResult,
  semanticContractViolation,
} from "./semantic-contract";

const requiredText = z.string().trim().min(1);
const evidenceReferences = z.array(requiredText);

export const ghostJobRiskClassificationSchema = z.enum([
  "LOW",
  "POSSIBLE",
  "ELEVATED",
  "HIGH",
  "UNKNOWN",
]);

export const postingHistoryFactTypeSchema = z.enum([
  "REPOSTED",
  "UNCHANGED_OVER_TIME",
  "EVERGREEN_LANGUAGE",
  "FARMING_INDICATOR",
  "CLOSED_ATS_VISIBLE_ELSEWHERE",
  "RECURRING_IDENTICAL_REQUISITION",
  "AGGREGATOR_VISIBILITY",
  "ACTIVE_ATS",
  "CURRENT_POSTING",
]);

export const postingHistoryFactSchema = z
  .object({
    type: postingHistoryFactTypeSchema,
    description: requiredText,
    occurredAt: z.iso.datetime().nullable(),
    evidenceReferences: evidenceReferences.min(1),
  })
  .strict();

export const sourcePostingHistoryFactSchema = z
  .object({
    type: postingHistoryFactTypeSchema,
    description: requiredText,
    occurredAt: z.coerce.date().nullable().default(null),
  })
  .strict();

export const semanticGhostJobRiskSchema = z
  .object({
    classification: ghostJobRiskClassificationSchema,
    assessment: requiredText,
    interpretation: requiredText,
    evidenceReferences,
    unknowns: z.array(companyAlignmentUnknownSchema),
    contradictions: z.array(contradictionDraftSchema),
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
        message: "A non-Unknown Ghost Job Risk requires evidence",
      });
    }
  });

const transportGhostJobRiskAssessmentSchema = z.union([
  z
    .object({
      classification: ghostJobRiskClassificationSchema.exclude(["UNKNOWN"]),
      assessment: requiredText,
      interpretation: requiredText,
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      classification: z.literal("UNKNOWN"),
      assessment: requiredText,
      interpretation: requiredText,
      evidenceReferences,
    })
    .strict(),
]);

export const semanticGhostJobRiskTransportSchema = z
  .object({
    risk: transportGhostJobRiskAssessmentSchema,
    unknowns: semanticGhostJobRiskSchema.shape.unknowns,
    contradictions: semanticGhostJobRiskSchema.shape.contradictions,
  })
  .strict();

const riskSignalTypes = new Set<PostingHistoryFact["type"]>([
  "REPOSTED",
  "UNCHANGED_OVER_TIME",
  "EVERGREEN_LANGUAGE",
  "FARMING_INDICATOR",
  "CLOSED_ATS_VISIBLE_ELSEWHERE",
  "RECURRING_IDENTICAL_REQUISITION",
]);

const compoundRiskSignalTypes = new Set<PostingHistoryFact["type"]>([
  "CLOSED_ATS_VISIBLE_ELSEWHERE",
  "RECURRING_IDENTICAL_REQUISITION",
]);

export function semanticGhostJobRiskFromTransport(
  value: z.input<typeof semanticGhostJobRiskTransportSchema>,
  input: {
    objectiveFacts: PostingHistoryFact[];
    availableEvidence: AvailableSemanticEvidence[];
  },
) {
  const transport = semanticGhostJobRiskTransportSchema.parse(value);
  const domainCandidate = {
    ...transport.risk,
    unknowns: transport.unknowns,
    contradictions: transport.contradictions,
  };
  const result = parseSemanticDomainResult({
    schema: semanticGhostJobRiskSchema,
    value: domainCandidate,
    code: "GHOST_JOB_RISK_DOMAIN_INVALID",
    message: "Ghost Job Risk violated the domain contract",
  });
  assertSemanticEvidenceReferences({
    references: [
      ...result.evidenceReferences,
      ...result.unknowns.flatMap((unknown) => unknown.evidenceReferences),
      ...result.contradictions.flatMap((contradiction) => [
        ...contradiction.evidenceReferencesA,
        ...contradiction.evidenceReferencesB,
      ]),
    ],
    availableEvidence: input.availableEvidence,
    code: "GHOST_JOB_RISK_EVIDENCE_INVALID",
    message: "Ghost Job Risk references unavailable evidence",
  });
  const factReferences = new Set(
    input.objectiveFacts.flatMap((fact) => fact.evidenceReferences),
  );
  if (
    result.classification !== "UNKNOWN" &&
    !result.evidenceReferences.some((reference) => factReferences.has(reference))
  ) {
    semanticContractViolation(
      "GHOST_JOB_RISK_EVIDENCE_INVALID",
      "A known Ghost Job Risk must reference objective posting-history evidence",
    );
  }
  const activeFacts = input.objectiveFacts.filter((fact) =>
    ["ACTIVE_ATS", "CURRENT_POSTING"].includes(fact.type),
  );
  if (result.classification === "LOW" && activeFacts.length === 0) {
    semanticContractViolation(
      "GHOST_JOB_RISK_FACTS_INVALID",
      "Low Ghost Job Risk lacks required active posting evidence",
    );
  }
  const riskFacts = input.objectiveFacts.filter((fact) =>
    riskSignalTypes.has(fact.type),
  );
  const compoundRiskFacts = input.objectiveFacts.filter((fact) =>
    compoundRiskSignalTypes.has(fact.type),
  );
  if (
    ["POSSIBLE", "ELEVATED", "HIGH"].includes(result.classification) &&
    riskFacts.length < 2 &&
    compoundRiskFacts.length === 0
  ) {
    semanticContractViolation(
      "GHOST_JOB_RISK_FACTS_INVALID",
      "Ghost Job Risk classification lacks sufficient objective risk signals",
    );
  }
  return result;
}

export const ghostJobRiskDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({
      evaluated: z.literal(true),
      objectiveFacts: z.array(postingHistoryFactSchema),
      risk: semanticGhostJobRiskSchema,
    })
    .strict(),
]);

export type PostingHistoryFact = z.infer<typeof postingHistoryFactSchema>;
export type GhostJobRiskData = z.infer<typeof ghostJobRiskDataSchema>;
export type SemanticGhostJobRisk = z.infer<
  typeof semanticGhostJobRiskSchema
>;
