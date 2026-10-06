"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OpportunityUserAction } from "@ai-career/core";

const actionLabels: Record<OpportunityUserAction, string> = {
  SAVE: "Save",
  MARK_APPLIED: "Mark as applied",
  DISMISS: "Dismiss",
  ARCHIVE: "Archive",
  RESTORE: "Restore",
};

export function OpportunityActions({
  opportunityId,
  statusLabel,
  availableActions,
}: {
  opportunityId: string;
  statusLabel: string;
  availableActions: OpportunityUserAction[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<OpportunityUserAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(action: OpportunityUserAction) {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The action could not be completed.");
        return;
      }
      router.refresh();
    } catch {
      setError("The application could not reach the server.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="opportunity-actions" aria-labelledby="opportunity-status-title">
      <p className="eyebrow">Opportunity status</p>
      <h2 id="opportunity-status-title">{statusLabel}</h2>
      {availableActions.length ? (
        <div className="evaluation-actions">
          {availableActions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === "SAVE" || action === "MARK_APPLIED" ? undefined : "secondary-button"}
              disabled={pending !== null}
              onClick={() => apply(action)}
            >
              {pending === action ? "Updating…" : actionLabels[action]}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
    </section>
  );
}
