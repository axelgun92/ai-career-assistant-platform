"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "@/components/external-link";

// The progress of jobs the extension saved from results pages (Mode B). Each
// job's state is read as stored: getting its details, added (with its
// pre-evaluator triage and evaluation state, decided elsewhere), already in
// AI Job Assistant, awaiting details, unavailable or dismissed. Decisions on
// a job that needs review before evaluation are made on its opportunity
// page, in the pre-evaluator triage panel; nothing is decided here.

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
}

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

async function act(id: string, action: "retry" | "dismiss" | "restore"): Promise<string | null> {
  try {
    const response = await fetch(`/api/page-captures/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (response.ok) return null;
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return payload?.error ?? "The change could not be saved.";
  } catch {
    return "The server could not be reached.";
  }
}

export function PageCaptureActions({ row }: { row: Pick<PageCaptureRowView, "id" | "status" | "resolvedOpportunityId" | "retryable"> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: "retry" | "dismiss" | "restore") => {
    setBusy(true);
    setError(null);
    const problem = await act(row.id, action);
    setBusy(false);
    if (problem) setError(problem);
    else router.refresh();
  };
  return (
    <span className="page-capture-actions">
      {row.status === "AWAITING_DETAILS" && !row.resolvedOpportunityId && row.retryable !== false ? (
        <button type="button" className="link-button" disabled={busy} onClick={() => void run("retry")}>
          Retry
        </button>
      ) : null}
      {row.status === "AWAITING_DETAILS" && !row.resolvedOpportunityId && row.retryable === false ? <span className="muted">{saveAgainHint}</span> : null}
      {["QUEUED", "AWAITING_DETAILS", "UNAVAILABLE"].includes(row.status) ? (
        <button type="button" className="link-button" disabled={busy} onClick={() => void run("dismiss")}>
          Dismiss
        </button>
      ) : null}
      {row.status === "DISMISSED" ? (
        <button type="button" className="link-button" disabled={busy} onClick={() => void run("restore")}>
          Restore
        </button>
      ) : null}
      {error ? (
        <span className="error-message" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function PageCaptureTable({ rows }: { rows: PageCaptureRowView[] }) {
  if (!rows.length) return <p className="muted">No jobs here yet.</p>;
  return (
    <div className="table-scroll">
      <table className="page-capture-table">
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">Company</th>
            <th scope="col">Location</th>
            <th scope="col">Posted</th>
            <th scope="col">Site</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                {row.resolvedOpportunityId ? <Link href={`/opportunities/${row.resolvedOpportunityId}`}>{row.opportunityTitle ?? row.title}</Link> : row.title}
                <br />
                <ExternalLink href={row.sourceUrl}>Open job ↗</ExternalLink>
              </td>
              <td>{row.company ?? "—"}</td>
              <td>{row.location ?? "—"}</td>
              <td>{row.postedText ?? "—"}</td>
              <td>{row.siteName}</td>
              <td>{statusText(row)}</td>
              <td>
                <PageCaptureActions row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
