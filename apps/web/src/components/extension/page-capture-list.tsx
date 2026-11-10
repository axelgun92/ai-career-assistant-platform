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

import { captureMethodText, saveAgainHint, savedBeforeText, statusText, type PageCaptureRowView } from "./page-capture-labels";
import { formatDateTime } from "@/components/budget/budget-format";

export { addedStateText, captureMethodLabels, captureMethodText, reasonLabels, saveAgainHint, savedBeforeText, statusText, type PageCaptureRowView } from "./page-capture-labels";

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
            {rows.some((row) => row.method) ? <th scope="col">Captured</th> : null}
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
                {row.sourceUrl ? (
                  <>
                    <br />
                    <ExternalLink href={row.sourceUrl}>Open job ↗</ExternalLink>
                  </>
                ) : null}
              </td>
              <td>{row.company ?? "—"}</td>
              <td>{row.location ?? "—"}</td>
              <td>{row.postedText ?? "—"}</td>
              <td>{row.siteName}</td>
              {rows.some((candidate) => candidate.method) ? (
                <td>
                  {captureMethodText(row)}
                  {row.capturedAt ? (
                    <>
                      <br />
                      <span className="muted">{formatDateTime(row.capturedAt)}</span>
                    </>
                  ) : null}
                </td>
              ) : null}
              <td>
                {statusText(row)}
                {row.savedBefore ? (
                  <>
                    <br />
                    <span className="muted">{savedBeforeText}</span>
                  </>
                ) : null}
              </td>
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
