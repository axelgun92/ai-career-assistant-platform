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
  // When the job's page was last opened to be read (ISO), if recorded.
  lastAttemptAt?: string | null;
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
  NO_BROWSER: "No browser is configured for reading job details (RETRIEVAL_BROWSER_EXECUTABLE); they are read automatically once it is",
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
  INCOMPLETE_PAGE: "The job's page arrived without its full posting, so nothing was saved from it",
};

// Reasons a queued job waits that are not its turn: a site stop, a worker
// with no browser, or job pages arriving incomplete (read again in an hour).
const waitingReasons = new Set(["NO_BROWSER", "RATE_LIMITED", "ACCESS_STOPPED", "INCOMPLETE_PAGE"]);

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

// A saved job read again by a later save (selective re-observation,
// November 5, 2026): how its refresh went. The saved job is never changed by
// a refresh that did not read the page.
// readAt: when the page was opened for that read, as recorded (never
// guessed; without it the outcome is shown undated).
export function refreshText(lastReason: string | null, readAt: string | null = null): string | null {
  const reason = lastReason ?? "";
  if (/^REFRESH:\d+$/.test(reason)) return "Reading again to update";
  const read = /^REFRESHED:([A-Z_]+):\d+$/.exec(reason);
  if (read) return read[1] === "CHANGED" ? "Updated from a new read" : "Read again: no change";
  if (/^REFRESH_UNAVAILABLE:/.test(reason)) {
    const day = readAt && !Number.isNaN(Date.parse(readAt)) ? new Date(readAt).toISOString().slice(0, 10) : null;
    return day
      ? `Read again on ${day}: the listing was no longer available; the saved job is unchanged`
      : "Read again: the listing is no longer available; the saved job is unchanged";
  }
  if (/^REFRESH_DEFERRED:/.test(reason)) return "Not read again: the site restricted access; the saved job is unchanged";
  if (/^REFRESH_STOPPED:/.test(reason)) return "Not read again: reading was stopped; the saved job is unchanged";
  if (/^REFRESH_FAILED:/.test(reason)) return "Could not be read again; the saved job is unchanged";
  return null;
}

export function statusText(row: PageCaptureRowView): string {
  const refresh = refreshText(row.lastReason, row.lastAttemptAt ?? null);
  switch (row.status) {
    case "QUEUED":
    case "ACQUIRING":
      // A job waiting for a reason other than its turn says why (November 7,
      // 2026: queued behind a site stop or a missing browser read "Getting
      // details").
      if (!refresh && row.status === "QUEUED" && row.lastReason && waitingReasons.has(row.lastReason)) return `Waiting: ${reasonLabels[row.lastReason]}`;
      return refresh ?? "Getting details";
    case "INGESTED":
      return refresh ? `${addedStateText(row)} · ${refresh}` : addedStateText(row);
    case "ALREADY_SAVED":
      return refresh ? `Already in AI Job Assistant · ${refresh}` : "Already in AI Job Assistant";
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

