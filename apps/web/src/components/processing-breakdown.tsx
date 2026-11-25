import type { ProcessingStatus } from "./processing-status";

// The opportunity page's processing breakdown (November 23, 2026): one line
// per stage, from the stored records. The evaluation stage follows the page's
// live evaluation status.

export interface CaptureStage {
  // False only for a job whose capture has not been normalized yet.
  normalized: boolean;
  // Stored source observations (each capture or retrieval of the listing).
  observations: number;
  firstFoundAt: string;
}

// The duplicate check's outcome from the job's stored relationships.
export type DuplicateStage = "NONE" | "MATCH" | "PROBABLE_MATCH" | "RESOLVED_DISTINCT";

const duplicateText: Record<DuplicateStage, string> = {
  NONE: "No duplicate of another saved job found.",
  MATCH: "Duplicate listing of another saved job (see the notice above).",
  PROBABLE_MATCH: "Possible duplicate of another saved job: your decision is needed (see the notice above).",
  RESOLVED_DISTINCT: "Checked: you marked the similar jobs as distinct openings.",
};

export function duplicateStageOf(relationships: ReadonlyArray<{ decision: string; resolution: string | null }>): DuplicateStage {
  const open = relationships.filter((relationship) => relationship.resolution === null && relationship.decision !== "NO_MATCH");
  if (open.some((relationship) => relationship.decision === "MATCH")) return "MATCH";
  if (relationships.some((relationship) => relationship.resolution === "SAME_JOB")) return "MATCH";
  if (open.length) return "PROBABLE_MATCH";
  return relationships.some((relationship) => relationship.resolution === "DISTINCT") ? "RESOLVED_DISTINCT" : "NONE";
}

export function ProcessingBreakdown({
  opportunityId,
  capture,
  duplicate,
  status,
  checkingEvaluation = false,
}: {
  opportunityId: string;
  capture: CaptureStage;
  duplicate: DuplicateStage;
  status: ProcessingStatus;
  checkingEvaluation?: boolean;
}) {
  const observations = `${capture.observations} source ${capture.observations === 1 ? "observation" : "observations"}`;
  return (
    <section className="processing-breakdown" aria-labelledby={`processing-${opportunityId}`}>
      <h2 id={`processing-${opportunityId}`}>Processing status</h2>
      <p className="processing-summary">{checkingEvaluation ? "Checking…" : status.summary}</p>
      <dl>
        <div>
          <dt>Capture</dt>
          <dd>
            {capture.normalized ? "Captured and normalized" : "Captured; not normalized yet"} ({observations}; first found{" "}
            {new Date(capture.firstFoundAt).toLocaleDateString()}).
          </dd>
        </div>
        <div>
          <dt>Duplicate check</dt>
          <dd>{duplicateText[duplicate]}</dd>
        </div>
        <div>
          <dt>Pre-evaluator triage</dt>
          <dd>
            {status.triage.label}. {status.triage.detail}
          </dd>
        </div>
        <div>
          <dt>AI evaluation</dt>
          <dd>{checkingEvaluation ? "Checking…" : status.evaluation.label}</dd>
        </div>
        <div>
          <dt>AI recommendation</dt>
          <dd>
            {status.recommendation
              ? status.recommendation.label
              : "None yet: a recommendation needs a completed AI evaluation."}
          </dd>
        </div>
      </dl>
    </section>
  );
}
