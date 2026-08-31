import { contradictionDraftSchema, type EvidenceRecordDraft } from "@ai-career/evidence";
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

export const burnoutRiskClassificationSchema = z.enum([
  "VERY_LOW",
  "LOW",
  "MIXED_MODERATE",
  "HIGH",
  "VERY_HIGH",
]);

export const semanticBurnoutRiskSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    scoreExplanation: requiredText,
    scoreEvidenceReferences: evidenceReferences.min(1),
    summary: requiredText,
    majorContributors: z.array(supportedAlignmentFindingSchema),
    positiveIndicators: z.array(supportedAlignmentFindingSchema),
    unknowns: z.array(companyAlignmentUnknownSchema),
    evidenceReferences: evidenceReferences.min(1),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

// Retain the historical domain/string-reference reader. Production uses the
// affirmative-fact transport below; no persisted result migration is needed.
export const customerSuccessBurnoutRiskPromptVersion = "cs-burnout-risk-v2";

export const burnoutRiskSemanticInstructions = [
  "Assess workload and burnout risk from evidenced role design, ownership, travel, and prior validated results. Broad collaboration alone is not scope creep.",
  "Higher scores mean greater burnout risk. Keep the existing holistic 0-100 assessment: no weights, additive points, keyword counts, or new thresholds.",
  "Missing evidence is neutral on BOTH sides of the assessment: not a risk, not protection, and not a reason to increase or decrease the score. NOT_ESTABLISHED is not SUPPORTED_ABSENT.",
  "Only affirmativeFactCatalog facts may support majorContributors, positiveIndicators, or scoreFactIndexes. This catalog establishes source facts, NOT their risk direction: interpret their relevance cautiously. Never infer an unmentioned condition from a different fact sharing its evidence record.",
  "SUPPORTED_PRESENT requires affirmative evidence of the stated condition. SUPPORTED_ABSENT requires affirmative evidence explicitly excluding or limiting it. Silence, a missing mention, an unresolved boundary, or no evidence of a problem NEVER establishes its absence.",
  "A positiveIndicator must be SUPPORTED_MITIGATION with affirmative support for reduced burden, such as explicit limits, workload boundaries, staffing coverage, or ownership by another team. A majorContributor must be SUPPORTED_RISK with affirmative support for burden. Cite distinct underlying facts without compounding repeated references.",
  "Apply these rules to hours, after-hours/on-call, customer volume, account load, meetings, travel, time-zone burden, implementation, renewals, support, staffing/capacity, handoffs, role boundaries, multiple-job scope, and technical work, as well as any other workload dimension.",
  "Travel not mentioned, unstated hours, unclear implementation/renewal ownership and unknown support volume or staffing remain Unknown. A company gathering does not establish absence of other travel. Collaboration does not establish another team's ownership or capacity.",
  "Upstream Unknowns and non-affirmative ledger records remain context only. Preserve them in unknowns with materiality/completeness implications, never in protective or risk findings. Summary and scoreExplanation must obey the same rule; do not describe missing risks as tempering or mitigating the score.",
].join(" ");

export function burnoutRiskAffirmativeFactCatalog(availableEvidence: EvidenceRecordDraft[]) {
  const references = new Set<string>();
  for (const evidence of availableEvidence) {
    if (!evidence.referenceId.trim() || references.has(evidence.referenceId)) {
      semanticContractViolation("BURNOUT_RISK_FACT_CATALOG_INVALID", "Burnout Risk evidence identifiers must be nonempty and unique");
    }
    references.add(evidence.referenceId);
  }
  // Raw source facts can support new cautious interpretations. Inferred,
  // conflicting, possible and Unknown claims are still supplied as context,
  // but cannot be laundered into affirmative scoring/mitigation evidence.
  return availableEvidence.filter(evidence =>
    evidence.origin === "EXPLICIT" &&
    ["CONFIRMED", "STRONG_EVIDENCE"].includes(evidence.evidenceLevel) &&
    evidence.sourceType !== "USER_PROFILE" &&
    Boolean(evidence.sourceText?.trim()),
  ).map((evidence, factIndex) => ({
    factIndex,
    sourceFact: evidence.sourceText!.trim(),
    evidenceReference: evidence.referenceId,
    sourceType: evidence.sourceType,
  }));
}

function burnoutRiskProviderSchema(maximumFactIndex?: number) {
  const index = z.number().int().min(0);
  const indexes = z.array(maximumFactIndex === undefined ? index : index.max(maximumFactIndex)).min(1);
  const finding = (effect: "SUPPORTED_RISK" | "SUPPORTED_MITIGATION") => z.object({
    finding: requiredText,
    effect: z.literal(effect),
    evidenceState: z.enum(["SUPPORTED_PRESENT", "SUPPORTED_ABSENT"]),
    factIndexes: indexes,
  }).strict();
  return semanticBurnoutRiskSchema.omit({ scoreEvidenceReferences: true }).extend({
    scoreFactIndexes: indexes,
    majorContributors: z.array(finding("SUPPORTED_RISK")),
    positiveIndicators: z.array(finding("SUPPORTED_MITIGATION")),
  }).strict();
}

export const semanticBurnoutRiskTransportSchema = burnoutRiskProviderSchema();

export function createSemanticBurnoutRiskTransportSchema(availableEvidence: EvidenceRecordDraft[]) {
  const catalog = burnoutRiskAffirmativeFactCatalog(availableEvidence);
  if (catalog.length === 0) {
    // The unchanged domain requires a supported numerical assessment. Do not
    // spend a call, invent zero risk, or permit an Unknown-only score instead.
    semanticContractViolation("BURNOUT_RISK_FACT_CATALOG_EMPTY", "Burnout Risk lacks affirmative source facts for a supported assessment");
  }
  return burnoutRiskProviderSchema(catalog.length - 1);
}

export function semanticBurnoutRiskFromAffirmativeTransport(value: unknown, availableEvidence: EvidenceRecordDraft[]) {
  const catalog = burnoutRiskAffirmativeFactCatalog(availableEvidence);
  const transport = parseSemanticDomainResult({
    schema: createSemanticBurnoutRiskTransportSchema(availableEvidence), value,
    code: "BURNOUT_RISK_AFFIRMATIVE_EVIDENCE_INVALID",
    message: "Burnout Risk requires affirmative source facts for risk, mitigation and score evidence",
  });
  const restore = (indexes: number[]) => {
    if (new Set(indexes).size !== indexes.length) {
      semanticContractViolation("BURNOUT_RISK_DUPLICATE_FACT", "Burnout Risk repeated a source fact within one assessment");
    }
    return indexes.map(index => catalog[index].evidenceReference);
  };
  const restoreFinding = (item: { finding: string; factIndexes: number[] }) => ({
    finding: item.finding, evidenceReferences: restore(item.factIndexes),
  });
  const { scoreFactIndexes, ...rest } = transport;
  return semanticBurnoutRiskFromTransport({
    ...rest,
    scoreEvidenceReferences: restore(scoreFactIndexes),
    majorContributors: transport.majorContributors.map(restoreFinding),
    positiveIndicators: transport.positiveIndicators.map(restoreFinding),
  }, availableEvidence);
}

export function semanticBurnoutRiskFromTransport(
  value: z.input<typeof semanticBurnoutRiskSchema>,
  availableEvidence: AvailableSemanticEvidence[],
) {
  const transport = semanticBurnoutRiskSchema.parse(value);
  const result = parseSemanticDomainResult({
    schema: semanticBurnoutRiskSchema,
    value: transport,
    code: "BURNOUT_RISK_DOMAIN_INVALID",
    message: "Burnout Risk violated the domain contract",
  });
  assertSemanticEvidenceReferences({
    references: [
      ...result.scoreEvidenceReferences,
      ...result.evidenceReferences,
      ...result.majorContributors.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.positiveIndicators.flatMap(
        (finding) => finding.evidenceReferences,
      ),
      ...result.unknowns.flatMap((unknown) => unknown.evidenceReferences),
      ...result.contradictions.flatMap((contradiction) => [
        ...contradiction.evidenceReferencesA,
        ...contradiction.evidenceReferencesB,
      ]),
    ],
    availableEvidence,
    code: "BURNOUT_RISK_EVIDENCE_INVALID",
    message: "Burnout Risk references unavailable evidence",
  });
  return result;
}

export const burnoutRiskDataSchema = z.discriminatedUnion("evaluated", [
  z.object({ evaluated: z.literal(false), reason: requiredText }).strict(),
  z
    .object({
      evaluated: z.literal(true),
      classification: burnoutRiskClassificationSchema,
      risk: semanticBurnoutRiskSchema,
    })
    .strict(),
]);

export type BurnoutRiskData = z.infer<typeof burnoutRiskDataSchema>;
export type SemanticBurnoutRisk = z.infer<typeof semanticBurnoutRiskSchema>;
