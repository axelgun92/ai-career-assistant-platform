"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OpportunityMoveDestination } from "@ai-career/core";

// The opportunity page's status section (November 22, 2026): ordinary
// lifecycle changes under one Move to, through the same rules as the
// dashboard. Applied is not a folder: an application is recorded in the
// Application Tracker, which is unchanged.

export const moveDestinationLabels: Record<OpportunityMoveDestination, string> = {
  ACTIVE: "Active",
  SAVED: "Saved",
  DISMISSED: "Dismissed",
  ARCHIVED: "Archived",
  RESTORE: "Restore (previous state)",
};

export function OpportunityActions({
  opportunityId,
  statusLabel,
  moveDestinations,
  blockedMoves = [],
  applicationPointer = false,
  automaticDismissal = null,
}: {
  opportunityId: string;
  statusLabel: string;
  // Set when the app moved the job to Dismissed itself (November 25, 2026).
  automaticDismissal?: "TRIAGE_REJECT" | "OUTSIDE_TARGET_TITLES" | null;
  moveDestinations: OpportunityMoveDestination[];
  // Allowed by the lifecycle but blocked by the application record.
  blockedMoves?: Array<{ destination: OpportunityMoveDestination; reason: string }>;
  // Whether recording an application is possible now (shown as a pointer to
  // the Application Tracker).
  applicationPointer?: boolean;
}) {
  const router = useRouter();
  const [destination, setDestination] = useState<OpportunityMoveDestination | "">(moveDestinations[0] ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = moveDestinations.includes(destination as OpportunityMoveDestination) ? destination : (moveDestinations[0] ?? "");

  async function move() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: selected }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The move could not be completed.");
        return;
      }
      router.refresh();
    } catch {
      setError("The application could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="opportunity-actions" aria-labelledby="opportunity-status-title">
      <p className="eyebrow">Opportunity status</p>
      <h2 id="opportunity-status-title">{statusLabel}</h2>
      {automaticDismissal ? (
        <p className="field-help" role="note">
          Moved to Dismissed automatically:{" "}
          {automaticDismissal === "TRIAGE_REJECT" ? "pre-evaluator triage rejected it" : "its title is outside your target job titles"}. Its
          triage, sources and history are kept; restore it to bring it back.
        </p>
      ) : null}
      {moveDestinations.length ? (
        <div className="evaluation-actions move-to">
          <label htmlFor="opportunity-move-to">Move to</label>
          <select
            id="opportunity-move-to"
            value={selected}
            disabled={pending}
            onChange={(event) => setDestination(event.target.value as OpportunityMoveDestination)}
          >
            {moveDestinations.map((item) => (
              <option key={item} value={item}>
                {moveDestinationLabels[item]}
              </option>
            ))}
          </select>
          <button type="button" disabled={pending || !selected} onClick={() => void move()}>
            {pending ? "Moving…" : "Move"}
          </button>
        </div>
      ) : null}
      {applicationPointer ? (
        <p className="field-help">Applied: record your application in the Application Tracker below.</p>
      ) : null}
      {blockedMoves.length ? (
        <ul className="blocked-actions">
          {blockedMoves.map((blocked) => (
            <li key={blocked.destination} className="field-help">
              {moveDestinationLabels[blocked.destination]} — {blocked.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
    </section>
  );
}
