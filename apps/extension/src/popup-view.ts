import type { ApiResult, CaptureResponse } from "./api";
import type { PageExtractor } from "./extract";

// What the popup says. Every state comes from the server's persisted data;
// the extension never decides or recomputes an evaluation or a
// recommendation.

export const formatLabel = (value: string) => {
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const extractorLabels: Record<PageExtractor, string> = {
  "structured-data": "the page's structured job data",
  "site:linkedin": "LinkedIn's job details",
  selection: "your selected text",
  "main-content": "the page's main content",
};

export function siteLine(site: { name: string; knownHost: boolean } | null): string {
  if (!site) return "";
  return site.knownHost ? site.name : `${site.name}: an unrecognised site, saved as a lower-priority source`;
}

export function captureMessage(capture: CaptureResponse): string {
  const base: Record<CaptureResponse["outcome"], string> = {
    CREATED: "Saved as a new opportunity.",
    ATTACHED: "Added to an opportunity you already have, as another source.",
    UNCHANGED: "Already saved. Nothing changed.",
    CHANGED: "Already saved. The posting changed, so the new version was recorded.",
  };
  const parts = [base[capture.outcome]];
  if (capture.probableDuplicate) parts.push("It may duplicate an opportunity you already have; review it in AI Job Assistant.");
  if (capture.outsideRoleFamilies) parts.push("Its title is outside your Customer Success role families.");
  if (!capture.site.knownHost) parts.push("It came from an unrecognised site, so it is kept as a lower-priority source.");
  return parts.join(" ");
}

const activeStates = new Set(["QUEUED", "QUEUED_LONG", "RUNNING", "RUNNING_STALE"]);

// The persisted state as the server reports it (capture, lookup or the
// evaluation status read).
type EvaluationState = { queueState: string; recommendation: { decision: string } | null; evaluatedEarlierVersion?: boolean };

export const evaluationActive = (evaluation: Pick<EvaluationState, "queueState"> | null) =>
  evaluation !== null && activeStates.has(evaluation.queueState);

export function evaluationLine(evaluation: EvaluationState | null): string {
  if (!evaluation) return "Not evaluated yet.";
  switch (evaluation.queueState) {
    case "QUEUED":
      return "Evaluation queued.";
    case "QUEUED_LONG":
      return "Evaluation queued; it is waiting for the evaluation worker to start.";
    case "RUNNING":
    case "RUNNING_STALE":
      return "Evaluation running.";
    case "FAILED":
      return "The last evaluation failed.";
    default: {
      const completed = evaluation.recommendation
        ? `Evaluation completed. Recommendation: ${formatLabel(evaluation.recommendation.decision)}.`
        : "Evaluation completed.";
      return evaluation.evaluatedEarlierVersion
        ? `${completed} It evaluated an earlier version of this posting; request evaluation to evaluate the version saved now.`
        : completed;
    }
  }
}

// The server's answer to "Request evaluation", in words.
export function evaluationRequestMessage(result: ApiResult<{ outcome?: string; reason?: string }>): string {
  if (result.ok) {
    if (result.body.outcome === "DEFERRED") {
      return result.body.reason === "USAGE_LIMIT_REACHED"
        ? "Evaluation deferred: an AI usage limit is reached right now. Nothing was spent."
        : "Evaluation deferred: the budget does not have room right now. Nothing was spent.";
    }
    return "Evaluation requested and queued.";
  }
  if (result.code === "DUPLICATE_LISTING_ALREADY_EVALUATED") {
    return "Already evaluated: a duplicate of this listing has an evaluation. View the result in AI Job Assistant.";
  }
  return result.error;
}
