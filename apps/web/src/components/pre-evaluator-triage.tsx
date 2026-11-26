"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PreEvaluatorTriagePresentation {
  outcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT";
  automaticOutcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT";
  reasons: Array<{
    code: string;
    fields: string[];
    disposition: "NEEDS_REVIEW" | "REJECT";
    message: string;
  }>;
  manualDecision: "EVALUATE" | "REJECT" | null;
  manuallyDecidedAt: string | null;
  userProfileVersion: number | null;
  assessedAt: string;
}

export function PreEvaluatorTriageContent({
  opportunityId,
  triage,
  pending,
  message,
  error,
  onDecide,
}: {
  opportunityId: string;
  triage: PreEvaluatorTriagePresentation;
  pending: "EVALUATE" | "REJECT" | null;
  message: string | null;
  error: string | null;
  onDecide: (decision: "EVALUATE" | "REJECT") => void;
}) {
  return (
    <section className="pre-evaluator-triage" aria-labelledby={`triage-${opportunityId}`}>
      <p className="eyebrow">Pre-evaluator triage</p>
      <h2 id={`triage-${opportunityId}`}>{heading(triage)}</h2>
      {triage.reasons.length ? (
        <ul>
          {triage.reasons.map((reason) => (
            <li key={reason.code}>
              {reason.message}
              <span className="field-help"> Fields: {reason.fields.join(", ")}.</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No structured hard prerequisite blocks admission.</p>
      )}
      {triage.manualDecision ? (
        <p className="field-help">
          Manual decision: {triage.manualDecision === "EVALUATE" ? "Evaluate" : "Reject"}
          {triage.manuallyDecidedAt ? ` on ${new Date(triage.manuallyDecidedAt).toLocaleString()}` : ""}.
          The underlying structured facts were not changed.
        </p>
      ) : null}
      {triage.outcome === "NEEDS_REVIEW" && !triage.manualDecision ? (
        <div className="triage-actions" role="group" aria-label="Resolve pre-evaluator review">
          <button type="button" disabled={pending !== null} onClick={() => onDecide("EVALUATE")}>
            {pending === "EVALUATE" ? "Releasing…" : "Evaluate"}
          </button>
          <button
            type="button"
            className="secondary-button danger-button"
            disabled={pending !== null}
            onClick={() => onDecide("REJECT")}
          >
            {pending === "REJECT" ? "Rejecting…" : "Reject"}
          </button>
        </div>
      ) : null}
      <div aria-live="polite">
        {message ? <p className="success-message">{message}</p> : null}
        {error ? <p className="error-message">{error}</p> : null}
      </div>
    </section>
  );
}

function heading(triage: PreEvaluatorTriagePresentation) {
  if (triage.outcome === "NEEDS_REVIEW") return "Needs Review before evaluation";
  if (triage.outcome === "REJECT") return "Rejected before evaluation";
  return "Cleared for evaluation admission";
}

export function PreEvaluatorTriagePanel({
  opportunityId,
  triage,
  onChanged,
}: {
  opportunityId: string;
  triage: PreEvaluatorTriagePresentation;
  onChanged?: (outcome: string) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"EVALUATE" | "REJECT" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "EVALUATE" | "REJECT") {
    setPending(decision);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/triage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        outcome?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "The pre-evaluator decision could not be saved.");
        return;
      }
      const outcome = body.outcome ?? decision;
      setMessage(
        decision === "REJECT"
          ? "Rejected before evaluation. No evaluator work was created."
          : outcome === "DEFERRED"
            ? "Approved for evaluation; the normal admission path deferred it for budget or capacity."
            : "Approved for evaluation and released to the normal admission path.",
      );
      onChanged?.(outcome);
      router.refresh();
    } catch {
      setError("The application could not save the pre-evaluator decision.");
    } finally {
      setPending(null);
    }
  }

  return (
    <PreEvaluatorTriageContent
      opportunityId={opportunityId}
      triage={triage}
      pending={pending}
      message={message}
      error={error}
      onDecide={decide}
    />
  );
}
