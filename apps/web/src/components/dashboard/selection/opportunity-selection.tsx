"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { OpportunityMoveDestination } from "@ai-career/core";
import { moveDestinationLabels } from "../../opportunity-actions";

// Dashboard selection and Move to (November 22, 2026). Selection covers the
// opportunities on the current page only; changing the search, a filter,
// the sort or the page starts a new, empty selection (the provider is keyed
// by the query). Every action sends the explicitly selected IDs, never a
// query, and reports each opportunity's own result.

export interface SelectableRow {
  id: string;
  title: string;
}

interface SelectionState {
  rows: readonly SelectableRow[];
  selected: ReadonlySet<string>;
  toggle(id: string): void;
  selectAll(): void;
  clear(): void;
  busy: boolean;
  run(work: () => Promise<string | null>): Promise<void>;
  message: { kind: "success" | "error"; text: string; failures: string[] } | null;
  report(message: SelectionState["message"]): void;
}

const SelectionContext = createContext<SelectionState | null>(null);

export function OpportunitySelectionProvider({ rows, children }: { rows: readonly SelectableRow[]; children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, report] = useState<SelectionState["message"]>(null);
  const value = useMemo<SelectionState>(
    () => ({
      rows,
      selected,
      toggle: (id) =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      selectAll: () => setSelected(new Set(rows.map((row) => row.id))),
      clear: () => setSelected(new Set()),
      busy,
      async run(work) {
        setBusy(true);
        try {
          await work();
        } finally {
          setBusy(false);
        }
      },
      message,
      report,
    }),
    [rows, selected, busy, message],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function RowSelect({ id, title }: { id: string; title: string }) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <label className="opportunity-row-select">
      <input type="checkbox" checked={selection.selected.has(id)} disabled={selection.busy} onChange={() => selection.toggle(id)} />
      <span className="visually-hidden">Select {title}</span>
    </label>
  );
}

interface MoveResponse {
  results?: Array<{ opportunityId: string; result: string; reason?: string }>;
  moved?: number;
  failed?: number;
  error?: string;
}

const titleOf = (rows: readonly SelectableRow[], id: string) => rows.find((row) => row.id === id)?.title ?? "An opportunity";

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; body: MoveResponse & Record<string, unknown> }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, body: (await response.json().catch(() => ({}))) as MoveResponse & Record<string, unknown> };
}

// The row's ⋯ menu: Move to, with only the destinations valid for its state.
export function RowMoveMenu({ id, title, destinations }: { id: string; title: string; destinations: readonly OpportunityMoveDestination[] }) {
  const router = useRouter();
  const selection = useContext(SelectionContext);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!destinations.length) return null;
  async function move(destination: OpportunityMoveDestination) {
    setBusy(true);
    setError(null);
    try {
      const { ok, body } = await postJson(`/api/opportunities/${encodeURIComponent(id)}/move`, { destination });
      if (!ok) {
        setError(typeof body.error === "string" ? body.error : "The move could not be completed.");
        return;
      }
      selection?.report({ kind: "success", text: `Moved “${title}” to ${moveDestinationLabels[destination]}.`, failures: [] });
      router.refresh();
    } catch {
      setError("The application could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="row-menu">
      <summary aria-label={`Actions for ${title}`}>⋯</summary>
      <div className="row-menu-items" role="group" aria-label={`Move ${title} to`}>
        <span className="row-menu-heading">Move to</span>
        {destinations.map((destination) => (
          <button key={destination} type="button" className="secondary-button" disabled={busy} onClick={() => void move(destination)}>
            {moveDestinationLabels[destination]}
          </button>
        ))}
        {error ? <p className="error-message" role="alert">{error}</p> : null}
      </div>
    </details>
  );
}

const bulkDestinations: OpportunityMoveDestination[] = ["ACTIVE", "SAVED", "DISMISSED", "ARCHIVED", "RESTORE"];

// The toolbar above the list: selection, bulk Move to, and in Dismissed,
// Restore, permanent deletion of the selection, and Empty Dismissed.
export function SelectionToolbar({ dismissedView, dismissedTotal }: { dismissedView: boolean; dismissedTotal: number }) {
  const router = useRouter();
  const selection = useContext(SelectionContext);
  const [destination, setDestination] = useState<OpportunityMoveDestination>("SAVED");
  const [confirming, setConfirming] = useState<"selected" | "all" | null>(null);
  if (!selection) return null;
  const { rows, selected, busy, message } = selection;
  const ids = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
  const count = ids.length;

  const summarize = (body: MoveResponse, verb: string) => {
    const failures = (body.results ?? [])
      .filter((item) => item.result !== "MOVED" && item.result !== "DELETED")
      .map((item) => `${titleOf(rows, item.opportunityId)}: ${item.reason ?? "not changed"}`);
    const done = (body.results ?? []).length - failures.length;
    selection.report({
      kind: failures.length ? "error" : "success",
      text: failures.length ? `${done} ${verb}; ${failures.length} could not be:` : `${done} ${verb}.`,
      failures,
    });
  };

  const move = (target: OpportunityMoveDestination) =>
    selection.run(async () => {
      try {
        const { ok, body } = await postJson("/api/opportunities/bulk/move", { destination: target, opportunityIds: ids });
        if (!ok) {
          selection.report({ kind: "error", text: body.error ?? "The move could not be completed.", failures: [] });
          return null;
        }
        summarize(body, `moved to ${moveDestinationLabels[target]}`);
        selection.clear();
        router.refresh();
      } catch {
        selection.report({ kind: "error", text: "The application could not reach the server.", failures: [] });
      }
      return null;
    });

  const remove = (scope: "selected" | "all") =>
    selection.run(async () => {
      try {
        const { ok, body } =
          scope === "selected"
            ? await postJson("/api/opportunities/dismissed/delete", { opportunityIds: ids })
            : await postJson("/api/opportunities/dismissed/empty", { expectedCount: dismissedTotal });
        setConfirming(null);
        if (!ok) {
          selection.report({ kind: "error", text: body.error ?? "Nothing was deleted.", failures: [] });
          return null;
        }
        summarize(body, "permanently deleted");
        selection.clear();
        router.refresh();
      } catch {
        selection.report({ kind: "error", text: "The application could not reach the server.", failures: [] });
      }
      return null;
    });

  return (
    <div className="selection-toolbar" role="region" aria-label="Selection">
      <div className="selection-toolbar-row">
        <button type="button" className="secondary-button" disabled={busy || !rows.length} onClick={selection.selectAll}>
          Select all on this page
        </button>
        <button type="button" className="secondary-button" disabled={busy || !count} onClick={selection.clear}>
          Clear selection
        </button>
        <span className="selection-count" aria-live="polite">
          {count} selected
        </span>
      </div>
      {count ? (
        <div className="selection-toolbar-row">
          <label htmlFor="bulk-move-to">Move selected to</label>
          <select id="bulk-move-to" value={destination} disabled={busy} onChange={(event) => setDestination(event.target.value as OpportunityMoveDestination)}>
            {bulkDestinations.map((item) => (
              <option key={item} value={item}>
                {moveDestinationLabels[item]}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={() => void move(destination)}>
            Move {count} selected
          </button>
          {dismissedView ? (
            <>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void move("RESTORE")}>
                Restore {count} selected
              </button>
              <button type="button" className="danger-button" disabled={busy} onClick={() => setConfirming("selected")}>
                Delete {count} selected permanently…
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {dismissedView && dismissedTotal > 0 ? (
        <div className="selection-toolbar-row">
          <button type="button" className="danger-button" disabled={busy} onClick={() => setConfirming("all")}>
            Empty Dismissed ({dismissedTotal})…
          </button>
        </div>
      ) : null}
      {confirming ? (
        <div className="delete-confirmation" role="alertdialog" aria-labelledby="delete-confirmation-title">
          <p id="delete-confirmation-title">
            <strong>
              {confirming === "selected"
                ? `Permanently delete ${count} selected dismissed ${count === 1 ? "opportunity" : "opportunities"}?`
                : `Permanently delete all ${dismissedTotal} dismissed ${dismissedTotal === 1 ? "opportunity" : "opportunities"}?`}
            </strong>
          </p>
          <p>
            This cannot be undone. Unlike dismissing, which you can restore, deletion removes each job with its evaluations, notes and
            history. Your AI usage and budget totals are kept, and automatic capture will not add these jobs again. Opportunities with
            application history are never deleted.
          </p>
          <div className="selection-toolbar-row">
            <button type="button" className="danger-button" disabled={busy} onClick={() => void remove(confirming)}>
              {confirming === "selected" ? `Delete ${count} permanently` : `Delete all ${dismissedTotal} permanently`}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {message ? (
        <div className={message.kind === "success" ? "success-message" : "error-message"} role={message.kind === "success" ? "status" : "alert"}>
          <p>{message.text}</p>
          {message.failures.length ? (
            <ul>
              {message.failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
