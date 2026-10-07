"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDateTime } from "./budget-format";
import { DeferralReason } from "./deferral-reason";
import { runDeferredAction } from "./deferred-actions";
import type { DeferralView } from "./types";

// Shown on an opportunity whose evaluation request is waiting for budget.
// Resuming happens through the page's evaluate button (which resumes this
// same request); this notice explains why and offers to cancel.
export function DeferredNotice({
  deferral,
  activeProfile,
  onChanged,
}: {
  deferral: DeferralView;
  activeProfile: { id: string; version: number } | null;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const profileDiffers = activeProfile && deferral.userProfileId && activeProfile.id !== deferral.userProfileId;
  return (
    <section className="deferred-notice" aria-labelledby="deferred-notice-title" role="region">
      <p className="eyebrow">Evaluation deferred</p>
      <h3 id="deferred-notice-title">Waiting for AI budget</h3>
      <DeferralReason snapshot={deferral.snapshot} />
      <p className="field-help">
        Requested {formatDateTime(deferral.createdAt)} · last checked {formatDateTime(deferral.lastCheckedAt)}.{" "}
        {deferral.userProfileId
          ? `It will run with profile version ${deferral.userProfileVersion}.`
          : "The profile version it was requested with no longer exists; cancel it and request a new evaluation."}
        {profileDiffers
          ? ` Your active profile is now version ${activeProfile.version}; cancel and request again to use it instead.`
          : ""}
      </p>
      <div className="evaluation-actions">
        {confirming ? (
          <span className="confirm-inline" role="group" aria-label="Confirm cancelling the deferred request">
            <button
              type="button"
              className="secondary-button danger-button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setError(null);
                const result = await runDeferredAction(deferral.id, "cancel");
                setPending(false);
                setConfirming(false);
                if (result.kind === "error") setError(result.message);
                else onChanged();
              }}
            >
              Cancel request
            </button>
            <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>
              Keep request
            </button>
          </span>
        ) : (
          <button type="button" className="secondary-button" onClick={() => setConfirming(true)}>
            Cancel request…
          </button>
        )}
        <Link href="/budget">Budget settings</Link>
      </div>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
