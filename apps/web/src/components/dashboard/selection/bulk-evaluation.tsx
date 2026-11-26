"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSelection } from "./opportunity-selection";
import { confirmationText, ineligibleText, limitShortfallText, queuedText, reservationText } from "./bulk-evaluation-text";

// Bulk evaluation (November 26, 2026), shown in the dashboard's Evaluate
// section below the selection toolbar, apart from Move. The user selects
// jobs (individually or all on this page) and asks to evaluate them; the
// server checks the whole selection against every enabled Budget limit and
// either the user confirms and every job is queued, or nothing is submitted
// and the reason is shown. Nothing is spent before the confirmation.

type Outcome =
  | { status: "READY"; count: number; reservation: { perEvaluation: number; total: number; currency: string } | null }
  | { status: "QUEUED"; queued: Array<{ opportunityId: string; evaluationId: string }> }
  | { status: "INELIGIBLE"; items: Array<{ opportunityId: string; title: string | null; reason: string }> }
  | { status: "LIMITS_EXCEEDED"; selected: number; shortfalls: Array<{ limit: string; remaining: number }> };

type Panel =
  | { kind: "confirm"; ids: readonly string[]; reservation: Extract<Outcome, { status: "READY" }>["reservation"] }
  | { kind: "limits"; selected: number; shortfalls: Array<{ limit: string; remaining: number }> }
  | { kind: "ineligible"; items: Array<{ opportunityId: string; title: string | null; reason: string }> }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

async function post(url: string, opportunityIds: readonly string[]) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityIds }) });
  return { ok: response.ok, body: (await response.json().catch(() => ({}))) as Partial<Outcome> & { error?: string } };
}

export function BulkEvaluation() {
  const router = useRouter();
  const selection = useSelection();
  const [panel, setPanel] = useState<Panel | null>(null);
  if (!selection) return null;
  const { rows, selected, busy } = selection;
  const ids = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
  const count = ids.length;
  const titleOf = (id: string, title: string | null) => title ?? rows.find((row) => row.id === id)?.title ?? "An opportunity";
  // The selection changed after it was checked: confirm only after checking
  // it again.
  const changed = panel?.kind === "confirm" && (panel.ids.length !== count || panel.ids.some((id) => !selected.has(id)));

  const show = (body: Partial<Outcome> & { error?: string }, fallback: string): boolean => {
    if (body.status === "LIMITS_EXCEEDED") {
      setPanel({ kind: "limits", selected: body.selected ?? count, shortfalls: body.shortfalls ?? [] });
      return true;
    }
    if (body.status === "INELIGIBLE") {
      setPanel({ kind: "ineligible", items: body.items ?? [] });
      return true;
    }
    if (body.error || !body.status) {
      setPanel({ kind: "error", text: body.error ?? fallback });
      return true;
    }
    return false;
  };

  // Asks the server whether the whole selection can be evaluated now. No
  // provider call and nothing reserved or queued.
  const check = () =>
    selection.run(async () => {
      setPanel(null);
      try {
        const { body } = await post("/api/opportunities/bulk/evaluate/preflight", ids);
        if (body.status === "READY") setPanel({ kind: "confirm", ids, reservation: body.reservation ?? null });
        else show(body, "The selection could not be checked.");
      } catch {
        setPanel({ kind: "error", text: "The application could not reach the server." });
      }
      return null;
    });

  // The confirmed submit of exactly the jobs that were checked: the server
  // checks everything again and queues every one of them, or none.
  const submit = (confirmed: readonly string[]) =>
    selection.run(async () => {
      try {
        const { body } = await post("/api/opportunities/bulk/evaluate", confirmed);
        if (body.status === "QUEUED") {
          setPanel({ kind: "done", text: queuedText(body.queued?.length ?? confirmed.length) });
          selection.clear();
          router.refresh();
        } else {
          show(body, "Nothing was submitted.");
        }
      } catch {
        setPanel({ kind: "error", text: "The application could not reach the server. Nothing was submitted." });
      }
      return null;
    });

  return (
    <div className="bulk-evaluation" role="region" aria-label="Paid evaluation">
      <div className="selection-toolbar-row">
        <span className="bulk-evaluation-label">Paid evaluation</span>
        <button type="button" disabled={busy || !count} onClick={() => void check()}>
          Evaluate {count} selected…
        </button>
        <span className="field-help">Uses your configured AI budget after you confirm.</span>
      </div>
      {panel?.kind === "confirm" ? (
        <div className="bulk-evaluation-confirmation" role="alertdialog" aria-labelledby="bulk-evaluation-title">
          <p id="bulk-evaluation-title">
            <strong>{confirmationText(panel.ids.length)}</strong>
          </p>
          {panel.reservation ? <p>{reservationText(panel.reservation)}</p> : null}
          {changed ? <p className="field-error">Your selection changed. Choose Evaluate selected again to check it.</p> : null}
          <div className="selection-toolbar-row">
            <button type="button" disabled={busy || changed} onClick={() => void submit(panel.ids)}>
              Evaluate {panel.ids.length} {panel.ids.length === 1 ? "job" : "jobs"}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {panel?.kind === "limits" ? (
        <div className="error-message" role="alert">
          <p>Nothing was submitted.</p>
          <ul>
            {panel.shortfalls.map((shortfall) => (
              <li key={shortfall.limit}>{limitShortfallText(shortfall.limit, shortfall.remaining, panel.selected)}</li>
            ))}
          </ul>
          <p>
            Select fewer jobs or change your <Link href="/budget#budget-settings-title">Budget settings</Link>.
          </p>
        </div>
      ) : null}
      {panel?.kind === "ineligible" ? (
        <div className="error-message" role="alert">
          <p>Some selected jobs can&apos;t be evaluated now; nothing was submitted. Review your selection and try again.</p>
          <ul>
            {panel.items.map((item) => (
              <li key={item.opportunityId}>
                {titleOf(item.opportunityId, item.title)}: {ineligibleText(item.reason)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              selection.deselect(panel.items.map((item) => item.opportunityId));
              setPanel(null);
            }}
          >
            Deselect these jobs
          </button>
        </div>
      ) : null}
      {panel?.kind === "done" ? (
        <div className="success-message" role="status">
          <p>{panel.text}</p>
        </div>
      ) : null}
      {panel?.kind === "error" ? (
        <div className="error-message" role="alert">
          <p>{panel.text}</p>
        </div>
      ) : null}
    </div>
  );
}
