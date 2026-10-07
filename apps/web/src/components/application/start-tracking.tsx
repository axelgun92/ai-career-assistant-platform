"use client";

import { useState } from "react";
import type { ApplicationCreationMode } from "@ai-career/core";
import { CommandFeedback, FieldError } from "./command-feedback";
import { fieldError, useApplicationRequest } from "./use-application-command";

// Starting to track an application. An opportunity already marked as applied
// can only be tracked as submitted (dated from that action when known); a
// plan is offered only while the opportunity has not been applied to.
export function StartTracking({
  opportunityId,
  modes,
  alreadyApplied,
  effectiveAppliedOn,
  today,
}: {
  opportunityId: string;
  modes: ApplicationCreationMode[];
  alreadyApplied: boolean;
  effectiveAppliedOn: string | null;
  today: string;
}) {
  const request = useApplicationRequest();
  const [appliedOn, setAppliedOn] = useState(effectiveAppliedOn ?? today);
  const [showSubmitted, setShowSubmitted] = useState(alreadyApplied);
  const url = `/api/opportunities/${encodeURIComponent(opportunityId)}/application`;

  if (modes.length === 0) {
    return (
      <p className="status-note">
        Applications can be tracked for opportunities you have not dismissed or archived. Restore this opportunity to
        start tracking.
      </p>
    );
  }

  const dateError = fieldError(request.error, "appliedOn");
  return (
    <div className="start-tracking">
      {alreadyApplied ? (
        <p>
          {effectiveAppliedOn
            ? `Marked as applied on ${effectiveAppliedOn}.`
            : "Marked as applied. Date not recorded — please confirm."}{" "}
          Track this application to record its stages, contacts, and follow-ups.
        </p>
      ) : (
        <p>Track this application to record when you apply, who you talk to, and what happens next.</p>
      )}
      {modes.includes("plan") && !showSubmitted ? (
        <div className="evaluation-actions">
          <button type="button" disabled={request.pending} onClick={() => request.send(url, { mode: "plan" })}>
            Planning to apply
          </button>
          {modes.includes("submitted") ? (
            <button type="button" className="secondary-button" onClick={() => setShowSubmitted(true)}>
              I&apos;ve applied
            </button>
          ) : null}
        </div>
      ) : null}
      {modes.includes("submitted") && showSubmitted ? (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void request.send(url, { mode: "submitted", appliedOn });
          }}
        >
          <label>
            Applied on (UTC date)
            <input
              type="date"
              required
              value={appliedOn}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? "start-applied-on-error" : undefined}
              onChange={(event) => setAppliedOn(event.target.value)}
            />
            <FieldError message={dateError} id="start-applied-on-error" />
          </label>
          <div className="evaluation-actions">
            <button type="submit" disabled={request.pending}>
              {alreadyApplied ? "Track this application" : "Save as applied"}
            </button>
            {!alreadyApplied ? (
              <button type="button" className="secondary-button" onClick={() => setShowSubmitted(false)}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
      <CommandFeedback error={request.error} onReload={request.reload} />
    </div>
  );
}
