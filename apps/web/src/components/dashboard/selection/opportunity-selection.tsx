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
  // The Move to destinations valid for this row's current state (absent:
  // every destination is offered, and the server reports each result).
  destinations?: readonly OpportunityMoveDestination[];
}

interface SelectionState {
  rows: readonly SelectableRow[];
  selected: ReadonlySet<string>;
  toggle(id: string): void;
  selectAll(): void;
  clear(): void;
  busy: boolean;
  run(work: () => Promise<string | null>): Promise<void>;
  message: SelectionMessage | null;
  report(message: SelectionMessage | null): void;
}

// One listing's own result in a bulk action (November 25, 2026): keyed by
// its opportunity ID, never by its title or message, which two listings can
// share.
export interface SelectionResultItem {
  opportunityId: string;
  title: string;
  outcome: "skipped" | "failed";
  reason: string;
}

export interface SelectionMessage {
  kind: "success" | "error";
  text: string;
  items: SelectionResultItem[];
}

// The per-listing summary of a bulk action: moved or deleted, skipped
// (already in the destination), and refused, each listing independently.
export function summarizeBulkResults(
  results: ReadonlyArray<{ opportunityId: string; result: string; reason?: string }>,
  rows: readonly SelectableRow[],
  verb: string,
): SelectionMessage {
  const done = results.filter((item) => item.result === "MOVED" || item.result === "DELETED").length;
  const items: SelectionResultItem[] = results
    .filter((item) => item.result !== "MOVED" && item.result !== "DELETED")
    .map((item) => ({
      opportunityId: item.opportunityId,
      title: titleOf(rows, item.opportunityId),
      outcome: item.result === "ALREADY_THERE" ? "skipped" : "failed",
      reason: item.reason ?? "not changed",
    }));
  const skipped = items.filter((item) => item.outcome === "skipped").length;
  const failed = items.length - skipped;
  const parts = [`${done} ${verb}`, ...(skipped ? [`${skipped} skipped (already there)`] : []), ...(failed ? [`${failed} could not be`] : [])];
  return { kind: failed ? "error" : "success", text: `${parts.join("; ")}.`, items };
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
  skipped?: number;
  failed?: number;
  result?: string;
  reason?: string;
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
      selection?.report({
        kind: "success",
        text: body.result === "ALREADY_THERE" ? `“${title}”: ${body.reason ?? "already there"}; nothing changed.` : `Moved “${title}” to ${moveDestinationLabels[destination]}.`,
        items: [],
      });
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
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const ids = selectedRows.map((row) => row.id);
  const count = ids.length;
  // Only destinations that would move at least one selected listing; a
  // listing already there is skipped by the server, never failed.
  const offered = bulkDestinations.filter((item) => selectedRows.some((row) => !row.destinations || row.destinations.includes(item)));
  const chosen = offered.includes(destination) ? destination : (offered[0] ?? destination);

  const summarize = (body: MoveResponse, verb: string) => selection.report(summarizeBulkResults(body.results ?? [], rows, verb));

  const move = (target: OpportunityMoveDestination) =>
    selection.run(async () => {
      try {
        const { ok, body } = await postJson("/api/opportunities/bulk/move", { destination: target, opportunityIds: ids });
        if (!ok) {
          selection.report({ kind: "error", text: body.error ?? "The move could not be completed.", items: [] });
          return null;
        }
        summarize(body, `moved to ${moveDestinationLabels[target]}`);
        selection.clear();
        router.refresh();
      } catch {
        selection.report({ kind: "error", text: "The application could not reach the server.", items: [] });
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
          selection.report({ kind: "error", text: body.error ?? "Nothing was deleted.", items: [] });
          return null;
        }
        summarize(body, "permanently deleted");
        selection.clear();
        router.refresh();
      } catch {
        selection.report({ kind: "error", text: "The application could not reach the server.", items: [] });
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
          <select id="bulk-move-to" value={chosen} disabled={busy || !offered.length} onChange={(event) => setDestination(event.target.value as OpportunityMoveDestination)}>
            {offered.map((item) => (
              <option key={item} value={item}>
                {moveDestinationLabels[item]}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy || !offered.length} onClick={() => void move(chosen)}>
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
          {message.items.length ? (
            <ul>
              {message.items.map((item) => (
                <li key={item.opportunityId} data-outcome={item.outcome}>
                  {item.title}: {item.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
