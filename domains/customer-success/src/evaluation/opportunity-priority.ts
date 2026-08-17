import {
  StructuredOutputValidationError,
  defineEvaluationStage,
  type CoreEvaluationContext,
} from "@ai-career/evaluation";
import {
  evidenceRecordDraftSchema,
  type EvidenceRecordDraft,
} from "@ai-career/evidence";
import type { CustomerSuccessDomainData } from "../evaluator";
import { alexFitDataSchema } from "../schemas/alex-fit";
import { burnoutRiskDataSchema } from "../schemas/burnout-risk";
import { companyAlignmentDataSchema } from "../schemas/company-alignment";
import { organizationalMaturityDataSchema } from "../schemas/organizational-maturity";
import {
  opportunityPriorityDataSchema,
  semanticOpportunityPrioritySchema,
  type OpportunityPriorityData,
  type PostingTiming,
} from "../schemas/opportunity-priority";
import { resumeMatchDataSchema } from "../schemas/resume-match";
import {
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "../schemas/results";

const DAY_MS = 24 * 60 * 60 * 1_000;

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function calendarDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function postingAgePriority(ageDays: number) {
  if (ageDays <= 3) return "HIGHEST_PRIORITY" as const;
  if (ageDays <= 7) return "STRONG_PRIORITY" as const;
  if (ageDays <= 14) return "GOOD_OPPORTUNITY" as const;
  if (ageDays <= 21) return "REVIEW" as const;
  return "CAUTION" as const;
}

export function opportunityPriorityBand(score: number) {
  if (score <= 19) return "VERY_LOW" as const;
  if (score <= 39) return "LOW" as const;
  if (score <= 59) return "MIXED_MODERATE" as const;
  if (score <= 79) return "HIGH" as const;
  return "VERY_HIGH" as const;
}

function postingDateEvidence(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
  postingDate: Date,
): EvidenceRecordDraft {
  const provenance = context.provenance.find(
    (item) => item.fieldName === "postingDate",
  );
  const source =
    context.rawSources.find((item) => item.id === provenance?.sourceRecordId) ??
    context.rawSources[0];
  return evidenceRecordDraftSchema.parse({
    referenceId: "opportunity-posting-date",
    criterionId: "opportunity-priority",
    claim: `The normalized posting date is ${isoDate(postingDate)}.`,
    sourceType: source?.sourceType ?? context.opportunity.sourceType ?? "NORMALIZED_OPPORTUNITY",
    sourceRecordId: provenance?.sourceRecordId ?? source?.id ?? null,
    provenanceId: provenance?.id ?? null,
    sourceField: provenance?.sourceField ?? "postingDate",
    sourceReference:
      provenance?.sourceReference ??
      source?.sourceUrl ??
      `opportunity:${context.opportunity.id}`,
    sourceText: provenance?.sourceText ?? isoDate(postingDate),
    evidenceType: "POSTING_DATE",
    origin: "EXPLICIT",
    evidenceLevel: "CONFIRMED",
    collectedAt: null,
  });
}

export function determinePostingTiming(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
): { timing: PostingTiming; evidence: EvidenceRecordDraft[] } {
  const evaluationDate = context.domainData.evaluationDate;
  const postingDate = context.opportunity.postingDate;
  if (postingDate === null) {
    return {
      timing: {
        postingDate: null,
        evaluationDate: isoDate(evaluationDate),
        ageDays: null,
        classification: "UNKNOWN",
        explanation: "Posting date is unavailable, so posting age remains Unknown.",
        evidenceReferences: [],
      },
      evidence: [],
    };
  }

  const evidence = postingDateEvidence(context, postingDate);
  const ageDays = Math.floor(
    (calendarDay(evaluationDate) - calendarDay(postingDate)) / DAY_MS,
  );
  if (!Number.isSafeInteger(ageDays) || ageDays < 0) {
    return {
      timing: {
        postingDate: isoDate(postingDate),
        evaluationDate: isoDate(evaluationDate),
        ageDays: null,
        classification: "UNKNOWN",
        explanation:
          "The posting date is later than the evaluation date or cannot be safely compared, so posting age remains Unknown.",
        evidenceReferences: [evidence.referenceId],
      },
      evidence: [evidence],
    };
  }

  const classification = postingAgePriority(ageDays);
  return {
    timing: {
      postingDate: isoDate(postingDate),
      evaluationDate: isoDate(evaluationDate),
      ageDays,
      classification,
      explanation: `The opportunity was posted ${ageDays} day${ageDays === 1 ? "" : "s"} before evaluation and maps deterministically to ${classification}.`,
      evidenceReferences: [evidence.referenceId],
    },
    evidence: [evidence],
  };
}

function notEvaluated(reason: string) {
  const data = opportunityPriorityDataSchema.parse({ evaluated: false, reason });
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

function addDerivedEvidence(
  data: CustomerSuccessDomainData,
  evidence: EvidenceRecordDraft[],
) {
  const known = new Set(data.derivedEvidence.map((item) => item.referenceId));
  data.derivedEvidence.push(
    ...evidence.filter((item) => !known.has(item.referenceId)),
  );
}

export function createOpportunityPriorityStage() {
  return defineEvaluationStage<CustomerSuccessDomainData, OpportunityPriorityData>({
    id: "opportunity-priority",
    version: "cs-opportunity-priority-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-opportunity-priority-v1",
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: opportunityPriorityDataSchema,
    async evaluate(context) {
      const stageData = (stageId: string) =>
        context.previousStageResults.find((stage) => stage.stageId === stageId)
          ?.result?.data;
      const hardFilters = hardFiltersDataSchema.parse(stageData("hard-filters"));
      const jobEvaluation = jobEvaluationDataSchema.parse(
        stageData("job-evaluation"),
      );
      const companyAlignment = companyAlignmentDataSchema.parse(
        stageData("company-alignment"),
      );
      const organizationalMaturity = organizationalMaturityDataSchema.parse(
        stageData("organizational-maturity"),
      );
      const alexFit = alexFitDataSchema.parse(stageData("alex-fit"));
      const burnoutRisk = burnoutRiskDataSchema.parse(stageData("burnout-risk"));
      const resumeMatch = resumeMatchDataSchema.parse(stageData("resume-match"));

      if (
        hardFilters.overall === "FAIL" ||
        !jobEvaluation.evaluated ||
        !companyAlignment.evaluated ||
        !organizationalMaturity.evaluated ||
        !alexFit.evaluated ||
        !burnoutRisk.evaluated ||
        !resumeMatch.evaluated
      ) {
        return notEvaluated(
          "Opportunity Priority was not performed because substantive evaluation did not continue.",
        );
      }

      const reconstruction =
        context.domainData.reconstruction ?? hardFilters.reconstruction;
      context.domainData.reconstruction = reconstruction;
      const { timing, evidence: timingEvidence } = determinePostingTiming(context);
      addDerivedEvidence(context.domainData, timingEvidence);
      const availableEvidence = [
        ...reconstruction.evidence,
        ...(context.domainData.userProfile?.evidence ?? []),
        ...context.domainData.derivedEvidence,
      ];
      const knownEvidence = new Map(
        availableEvidence.map((item) => [item.referenceId, item]),
      );
      const priority = semanticOpportunityPrioritySchema.parse(
        await context.domainData.semanticOperations.evaluateOpportunityPriority({
          postingTiming: timing,
          salary: hardFilters.salary,
          strategicBridgeValue: jobEvaluation.evaluation.strategicBridgeValue,
          applicationEffort: {
            classification: "UNKNOWN",
            explanation:
              "Application effort is not represented by the available normalized opportunity or reconstructed maps.",
            evidenceReferences: [],
          },
          companyAlignment,
          alexFit,
          burnoutRisk,
          resumeMatch,
          effectiveLevelFit:
            resumeMatch.match.effectiveSeniority.effectiveLevelFit,
          availableEvidence,
        }),
      );

      const references = new Set([
        ...timing.evidenceReferences,
        ...priority.scoreEvidenceReferences,
        ...priority.strategicValueEvidenceReferences,
        ...priority.applicationEffort.evidenceReferences,
        ...priority.reasonsForPrioritization.flatMap(
          (item) => item.evidenceReferences,
        ),
        ...priority.reasonsForReducedPriority.flatMap(
          (item) => item.evidenceReferences,
        ),
        ...priority.unknowns.flatMap((item) => item.evidenceReferences),
        ...priority.evidenceReferences,
        ...priority.contradictions.flatMap((item) => [
          ...item.evidenceReferencesA,
          ...item.evidenceReferencesB,
        ]),
      ]);
      const missing = [...references].filter(
        (reference) => !knownEvidence.has(reference),
      );
      if (missing.length > 0) {
        throw new StructuredOutputValidationError(
          `Opportunity Priority references unknown evidence: ${missing.join(", ")}`,
        );
      }
      if (
        priority.scoreEvidenceReferences.every((reference) =>
          timing.evidenceReferences.includes(reference),
        )
      ) {
        throw new StructuredOutputValidationError(
          "Opportunity Priority cannot be supported by posting age alone",
        );
      }

      const band = opportunityPriorityBand(priority.score);
      const data = opportunityPriorityDataSchema.parse({
        evaluated: true,
        band,
        timing,
        priority,
      });
      const selectedEvidence = [...references].map(
        (reference) => knownEvidence.get(reference)!,
      );
      const timingUnknown =
        timing.classification === "UNKNOWN"
          ? [
              {
                code: "posting-age-unknown",
                description: timing.explanation,
                materiality: "Timing urgency cannot be calibrated from posting age.",
              },
            ]
          : [];
      return {
        classification: band,
        data,
        evidence: selectedEvidence,
        findings: [
          timing.explanation,
          priority.scoreExplanation,
          priority.strategicValueSummary,
        ],
        strengths: priority.reasonsForPrioritization.map(
          (item) => item.finding,
        ),
        concerns: priority.reasonsForReducedPriority.map(
          (item) => item.finding,
        ),
        unknowns: [
          ...timingUnknown,
          ...priority.unknowns.map(({ code, description, materiality }) => ({
            code,
            description,
            materiality,
          })),
        ],
        contradictions: priority.contradictions,
        confidence:
          priority.contradictions.length > 0
            ? "CONFLICTING"
            : "STRONG_EVIDENCE",
        completeness:
          timingUnknown.length > 0 || priority.unknowns.length > 0
            ? "PARTIAL"
            : "COMPLETE",
      };
    },
  });
}
