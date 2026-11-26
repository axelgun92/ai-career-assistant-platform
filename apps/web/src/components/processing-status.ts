// Processing status (November 23, 2026): where a saved job is in the
// pipeline, read from the records that already exist (the opportunity, its
// duplicate relationships, its pre-evaluator triage record, its latest
// evaluation and open deferral, and its current recommendation). Nothing
// here is stored. Pre-evaluator triage is a deterministic admission check;
// its outcomes (Evaluate, Needs review, Reject) are always labelled
// "Triage" and are never the AI evaluator's recommendation (Apply, Review,
// Skip).

export type TriageStage = "NOT_ASSESSED" | "EVALUATE" | "NEEDS_REVIEW" | "REJECT";
export type EvaluationStage = "NOT_REQUESTED" | "QUEUED" | "RUNNING" | "DEFERRED" | "COMPLETED" | "FAILED";

export interface ProcessingStatusInput {
  triage: { outcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT"; manual: boolean } | null;
  // The latest evaluation's task-or-evaluation status (PENDING, RUNNING,
  // COMPLETED, FAILED), or null when no evaluation was ever requested.
  latestEvaluationStatus: string | null;
  // An open request waiting in the deferred backlog.
  deferred: boolean;
  recommendation: { decision: string; isLatest: boolean } | null;
}

export interface ProcessingStatus {
  triage: { stage: TriageStage; manual: boolean; label: string; detail: string };
  evaluation: { stage: EvaluationStage; label: string };
  recommendation: { decision: string; isLatest: boolean; label: string } | null;
  // One phrase for the job's overall position, for a card.
  summary: string;
}

const triageLabels: Record<TriageStage, string> = {
  NOT_ASSESSED: "Triage: not assessed",
  EVALUATE: "Triage: Evaluate",
  NEEDS_REVIEW: "Triage: Needs review",
  REJECT: "Triage: Reject",
};

const triageDetails: Record<TriageStage, string> = {
  NOT_ASSESSED: "Pre-evaluator triage has not run for this job.",
  EVALUATE: "Passed pre-evaluator triage: eligible for AI evaluation.",
  NEEDS_REVIEW: "Pre-evaluator triage holds this job for your review before any AI evaluation.",
  REJECT: "Pre-evaluator triage rejected this job before any AI evaluation.",
};

const evaluationLabels: Record<EvaluationStage, string> = {
  NOT_REQUESTED: "Not evaluated",
  QUEUED: "Evaluation queued",
  RUNNING: "Evaluation running",
  DEFERRED: "Evaluation deferred",
  COMPLETED: "Evaluation completed",
  FAILED: "Evaluation failed",
};

const decisionLabels: Record<string, string> = { APPLY: "Apply", REVIEW: "Review", SKIP: "Skip" };

export function evaluationStageOf(input: Pick<ProcessingStatusInput, "latestEvaluationStatus" | "deferred">): EvaluationStage {
  // An active evaluation wins over an open deferral, as on the opportunity
  // page; otherwise a deferral is the job's current state.
  if (input.latestEvaluationStatus === "PENDING") return "QUEUED";
  if (input.latestEvaluationStatus === "RUNNING") return "RUNNING";
  if (input.deferred) return "DEFERRED";
  if (input.latestEvaluationStatus === "COMPLETED") return "COMPLETED";
  if (input.latestEvaluationStatus === "FAILED") return "FAILED";
  return "NOT_REQUESTED";
}

export function processingStatusOf(input: ProcessingStatusInput): ProcessingStatus {
  const triageStage: TriageStage = input.triage?.outcome ?? "NOT_ASSESSED";
  const manual = input.triage?.manual ?? false;
  const evaluationStage = evaluationStageOf(input);
  const recommendation = input.recommendation
    ? {
        ...input.recommendation,
        label: `${decisionLabels[input.recommendation.decision] ?? input.recommendation.decision}${input.recommendation.isLatest ? "" : " (last completed)"}`,
      }
    : null;
  return {
    triage: {
      stage: triageStage,
      manual,
      label: `${triageLabels[triageStage]}${manual ? " (your decision)" : ""}`,
      detail: manual ? `${triageDetails[triageStage]} You decided this.` : triageDetails[triageStage],
    },
    evaluation: { stage: evaluationStage, label: evaluationLabels[evaluationStage] },
    recommendation,
    summary: summaryOf(triageStage, evaluationStage, recommendation),
  };
}

function summaryOf(triage: TriageStage, evaluation: EvaluationStage, recommendation: ProcessingStatus["recommendation"]): string {
  if (evaluation === "QUEUED" || evaluation === "RUNNING") return evaluationLabels[evaluation];
  if (evaluation === "DEFERRED") return "Evaluation deferred";
  if (evaluation === "COMPLETED") return recommendation ? `Evaluated: ${recommendation.label}` : "Evaluated";
  if (evaluation === "FAILED") return recommendation ? `Evaluation failed; last result ${recommendation.label}` : "Evaluation failed";
  if (triage === "EVALUATE") return "Passed triage; not yet evaluated";
  if (triage === "NEEDS_REVIEW") return "Held by triage for your review";
  if (triage === "REJECT") return "Rejected by triage before evaluation";
  return "Not yet triaged";
}
