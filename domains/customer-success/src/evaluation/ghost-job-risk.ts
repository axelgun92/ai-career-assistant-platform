import {
  StructuredOutputValidationError,
  defineEvaluationStage,
  type CoreEvaluationContext,
} from "@ai-career/evaluation";
import {
  evidenceRecordDraftSchema,
  type EvidenceRecordDraft,
} from "@ai-career/evidence";
import { z } from "zod";
import type { CustomerSuccessDomainData } from "../evaluator";
import {
  ghostJobRiskDataSchema,
  semanticGhostJobRiskSchema,
  sourcePostingHistoryFactSchema,
  type GhostJobRiskData,
  type PostingHistoryFact,
} from "../schemas/ghost-job-risk";
import { opportunityPriorityDataSchema } from "../schemas/opportunity-priority";
import { hardFiltersDataSchema } from "../schemas/results";

const postingHistoryPayloadSchema = z
  .object({
    postingHistory: z.array(sourcePostingHistoryFactSchema),
  })
  .passthrough();

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

function addDerivedEvidence(
  data: CustomerSuccessDomainData,
  evidence: EvidenceRecordDraft[],
) {
  const known = new Set(data.derivedEvidence.map((item) => item.referenceId));
  data.derivedEvidence.push(
    ...evidence.filter((item) => !known.has(item.referenceId)),
  );
}

export function extractPostingHistory(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
): { facts: PostingHistoryFact[]; evidence: EvidenceRecordDraft[] } {
  const facts: PostingHistoryFact[] = [];
  const evidence: EvidenceRecordDraft[] = [];
  context.rawSources.forEach((source, sourceIndex) => {
    const parsed = postingHistoryPayloadSchema.safeParse(source.rawPayload);
    if (!parsed.success) return;
    parsed.data.postingHistory.forEach((fact, factIndex) => {
      const referenceId = `posting-history-${sourceIndex}-${factIndex}`;
      const draft = evidenceRecordDraftSchema.parse({
        referenceId,
        criterionId: "ghost-job-risk",
        claim: fact.description,
        sourceType: source.sourceType,
        sourceRecordId: source.id,
        provenanceId: null,
        sourceField: "rawPayload.postingHistory",
        sourceReference: source.sourceUrl ?? `source-record:${source.id}`,
        sourceText: fact.description,
        evidenceType: fact.type,
        origin: "EXPLICIT",
        evidenceLevel: "CONFIRMED",
        collectedAt: fact.occurredAt,
      });
      evidence.push(draft);
      facts.push({
        type: fact.type,
        description: fact.description,
        occurredAt: fact.occurredAt?.toISOString() ?? null,
        evidenceReferences: [referenceId],
      });
    });
  });
  return { facts, evidence };
}

function notEvaluated(reason: string) {
  const data = ghostJobRiskDataSchema.parse({ evaluated: false, reason });
  return {
    classification: "NOT_EVALUATED",
    data,
    evidence: [],
    findings: [reason],
    strengths: [],
    concerns: [reason],
    unknowns: [],
    contradictions: [],
    confidence: null,
    completeness: "INSUFFICIENT" as const,
  };
}

export function createGhostJobRiskStage() {
  return defineEvaluationStage<CustomerSuccessDomainData, GhostJobRiskData>({
    id: "ghost-job-risk",
    version: "cs-ghost-job-risk-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-ghost-job-risk-v1",
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: ghostJobRiskDataSchema,
    async evaluate(context) {
      const stageData = (stageId: string) =>
        context.previousStageResults.find((stage) => stage.stageId === stageId)
          ?.result?.data;
      const hardFilters = hardFiltersDataSchema.parse(stageData("hard-filters"));
      const priority = opportunityPriorityDataSchema.parse(
        stageData("opportunity-priority"),
      );
      if (hardFilters.overall === "FAIL" || !priority.evaluated) {
        return notEvaluated(
          "Ghost Job Risk was not evaluated because substantive evaluation did not continue.",
        );
      }

      const { facts, evidence } = extractPostingHistory(context);
      addDerivedEvidence(context.domainData, evidence);
      if (facts.length === 0) {
        const risk = semanticGhostJobRiskSchema.parse({
          classification: "UNKNOWN",
          assessment:
            "Ghost Job Risk is Unknown because no posting-history evidence is available.",
          interpretation:
            "No interpretation was attempted without objective posting-history facts.",
          evidenceReferences: [],
          unknowns: [
            {
              code: "posting-history-unavailable",
              description:
                "Reposting, ATS-status, and unchanged-listing history are unavailable.",
              materiality:
                "The listing's current hiring activity cannot be verified from preserved source history.",
              evidenceReferences: [],
            },
          ],
          contradictions: [],
        });
        const data = ghostJobRiskDataSchema.parse({
          evaluated: true,
          objectiveFacts: [],
          risk,
        });
        return {
          classification: "UNKNOWN",
          data,
          evidence: [],
          findings: [risk.assessment],
          strengths: [],
          concerns: [],
          unknowns: risk.unknowns.map(({ code, description, materiality }) => ({
            code,
            description,
            materiality,
          })),
          contradictions: [],
          confidence: "UNKNOWN",
          completeness: "INSUFFICIENT" as const,
        };
      }

      const reconstruction =
        context.domainData.reconstruction ?? hardFilters.reconstruction;
      const availableEvidence = [
        ...reconstruction.evidence,
        ...(context.domainData.userProfile?.evidence ?? []),
        ...context.domainData.derivedEvidence,
      ];
      const knownEvidence = new Map(
        availableEvidence.map((item) => [item.referenceId, item]),
      );
      const risk = semanticGhostJobRiskSchema.parse(
        await context.domainData.semanticOperations.evaluateGhostJobRisk({
          objectiveFacts: facts,
          availableEvidence,
        }),
      );
      const references = new Set([
        ...facts.flatMap((item) => item.evidenceReferences),
        ...risk.evidenceReferences,
        ...risk.unknowns.flatMap((item) => item.evidenceReferences),
        ...risk.contradictions.flatMap((item) => [
          ...item.evidenceReferencesA,
          ...item.evidenceReferencesB,
        ]),
      ]);
      const missing = [...references].filter(
        (reference) => !knownEvidence.has(reference),
      );
      if (missing.length > 0) {
        throw new StructuredOutputValidationError(
          `Ghost Job Risk references unknown evidence: ${missing.join(", ")}`,
        );
      }
      const factReferences = new Set(
        facts.flatMap((item) => item.evidenceReferences),
      );
      if (
        risk.classification !== "UNKNOWN" &&
        !risk.evidenceReferences.some((reference) =>
          factReferences.has(reference),
        )
      ) {
        throw new StructuredOutputValidationError(
          "A non-Unknown Ghost Job Risk must reference objective posting-history evidence",
        );
      }
      const riskFacts = facts.filter((fact) => riskSignalTypes.has(fact.type));
      const compoundRiskFacts = facts.filter((fact) =>
        compoundRiskSignalTypes.has(fact.type),
      );
      const activeFacts = facts.filter((fact) =>
        ["ACTIVE_ATS", "CURRENT_POSTING"].includes(fact.type),
      );
      if (risk.classification === "LOW" && activeFacts.length === 0) {
        throw new StructuredOutputValidationError(
          "Low Ghost Job Risk requires explicit current or active source-status evidence",
        );
      }
      if (
        ["POSSIBLE", "ELEVATED", "HIGH"].includes(risk.classification) &&
        riskFacts.length < 2 &&
        compoundRiskFacts.length === 0
      ) {
        throw new StructuredOutputValidationError(
          "Possible, Elevated, or High Ghost Job Risk requires more than one objective risk signal",
        );
      }

      const data = ghostJobRiskDataSchema.parse({
        evaluated: true,
        objectiveFacts: facts,
        risk,
      });
      return {
        classification: risk.classification,
        data,
        evidence: [...references].map(
          (reference) => knownEvidence.get(reference)!,
        ),
        findings: [risk.assessment, risk.interpretation],
        strengths:
          risk.classification === "LOW" ? [risk.interpretation] : [],
        concerns: ["POSSIBLE", "ELEVATED", "HIGH"].includes(
          risk.classification,
        )
          ? [risk.interpretation]
          : [],
        unknowns: risk.unknowns.map(({ code, description, materiality }) => ({
          code,
          description,
          materiality,
        })),
        contradictions: risk.contradictions,
        confidence:
          risk.contradictions.length > 0 ? "CONFLICTING" : "STRONG_EVIDENCE",
        completeness: risk.unknowns.length > 0 ? "PARTIAL" : "COMPLETE",
      };
    },
  });
}
