// The wording of a captured job's state (Mode B progress and Captured Jobs),
// shared by the pages and the extension's routes. Pure: no React, no I/O.

export interface PageCaptureRowView {
  id: string;
  site: string;
  siteName: string;
  title: string;
  company: string | null;
  location: string | null;
  postedText: string | null;
  sourceUrl: string;
  firstSeenAt: string;
  status: string;
  lastReason: string | null;
  resolvedOpportunityId: string | null;
  opportunityTitle: string | null;
  triageOutcome: string | null;
  triageManualDecision: string | null;
  evaluationStatus: string | null;
  recommendation: string | null;
  handoffOutcome: string | null;
  // False for a job read in the extension's background tabs: it is read
  // again by saving the results page again, not by Retry.
  retryable?: boolean;
  // Captured Jobs: how the job was captured, and when last.
  method?: "batch" | "single";
  capturedAt?: string;
  // A results-page job also saved alone with the single-job capture: one
  // row, both ways recorded.
  alsoSingle?: boolean;
  // One capture's own view: the job was already saved by an earlier capture
  // when this one was made.
  savedBefore?: boolean;
}

export const captureMethodLabels = { batch: "Results page", single: "Single job" } as const;

export function captureMethodText(row: Pick<PageCaptureRowView, "method" | "alsoSingle">): string {
  if (!row.method) return "—";
  return row.method === "batch" && row.alsoSingle ? "Results page and single job" : captureMethodLabels[row.method];
}

export const savedBeforeText = "Already saved before this capture";

export const reasonLabels: Record<string, string> = {
  NOT_SUPPORTED: "Automatic details are not available for this site yet",
  NO_BROWSER: "No browser is configured for reading job details (RETRIEVAL_BROWSER_EXECUTABLE)",
  UNREADABLE: "The job's page could not be read",
  ACCESS_STOPPED: "The site refused or challenged the request; it will not be contacted again for at least a day",
  RATE_LIMITED: "The site asked us to slow down; it will not be contacted again for at least a day",
  FAILED_REPEATEDLY: "Reading the job's page failed repeatedly",
  NOT_INGESTED: "The job could not be added",
  INTERRUPTED: "Reading the job's page was interrupted (its tab was closed, or the browser or extension stopped)",
  IDENTITY_MISMATCH: "The page that opened was not this job, so reading stopped for this batch",
  BATCH_STOPPED: "Reading stopped for this batch before this job",
  USER_STOPPED: "You stopped reading the details",
  PERMISSION_MISSING: "The extension no longer has permission to read this site's job pages",
};

// For a job read in background tabs, how to read it again.
export const saveAgainHint = "Save the results page that shows it again to read its details.";

// The opportunity's state after it was added, from its stored triage and
// evaluation. "Needs Review before evaluation" is the pre-evaluator triage
// outcome, distinct from the evaluator's final Review recommendation.
export function addedStateText(row: Pick<PageCaptureRowView, "triageOutcome" | "triageManualDecision" | "evaluationStatus" | "recommendation" | "handoffOutcome">): string {
  if (row.recommendation) return `Evaluated: ${row.recommendation}`;
  if (row.evaluationStatus === "PENDING") return "Queued for evaluation";
  if (row.evaluationStatus === "RUNNING") return "Evaluation in progress";
  if (row.evaluationStatus === "FAILED") return "Evaluation failed";
  const triage = row.triageManualDecision ?? row.triageOutcome;
  if (triage === "NEEDS_REVIEW") return "Needs Review before evaluation";
  if (triage === "REJECT") return "Rejected before evaluation";
  if (row.handoffOutcome === "DEFERRED") return "Waiting: AI budget";
  // No active profile: nothing was triaged (no outcome is invented); the
  // job is saved and is triaged when a profile is active and evaluation is
  // requested.
  if (row.handoffOutcome === "FAILED:USER_PROFILE_NOT_FOUND") return "Added; not triaged yet: no active profile";
  if (row.handoffOutcome === "FAILED:CUSTOMER_SUCCESS_CONFIGURATION_INVALID") return "Added; not triaged yet: the active profile's preferences are incomplete";
  if (row.handoffOutcome?.startsWith("FAILED:")) return "Added; the evaluation request was not accepted";
  if (triage === "EVALUATE") return "Queued for evaluation";
  return "Added";
}

export function statusText(row: PageCaptureRowView): string {
  switch (row.status) {
    case "QUEUED":
    case "ACQUIRING":
      return "Getting details";
    case "INGESTED":
      return addedStateText(row);
    case "ALREADY_SAVED":
      return "Already in AI Job Assistant";
    case "AWAITING_DETAILS":
      return `Awaiting details: ${reasonLabels[row.lastReason ?? ""] ?? "not read yet"}`;
    case "UNAVAILABLE":
      return "No longer available";
    case "DISMISSED":
      return "Dismissed";
    default:
      return row.status;
  }
}

