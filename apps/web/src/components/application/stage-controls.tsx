"use client";

import { useState } from "react";
import {
  applicationOutcomeSchema,
  canClose,
  isSubmitted,
  submittedActiveStages,
  type ApplicationOutcome,
  type SubmittedActiveStage,
} from "@ai-career/core";
import { CommandFeedback, FieldError } from "./command-feedback";
import { outcomeLabels, stageLabels } from "./labels";
import type { ApplicationView } from "./types";
import { fieldError, useApplicationCommand } from "./use-application-command";

type Props = { application: ApplicationView; today: string; reopenBlockedReason: string | null };

function SubmitForm({ application, today }: Props) {
  const command = useApplicationCommand(application.id);
  const [appliedOn, setAppliedOn] = useState(today);
  const error = fieldError(command.error, "appliedOn");
  return (
    <form
      className="inline-form"
      aria-label="Record submission"
      onSubmit={(event) => {
        event.preventDefault();
        void command.run({ command: "submit", expectedVersion: application.version, appliedOn });
      }}
    >
      <label>
        Applied on (UTC date)
        <input
          type="date"
          required
          max={today}
          value={appliedOn}
          onChange={(event) => setAppliedOn(event.target.value)}
        />
        <FieldError message={error} id="submit-applied-on-error" />
      </label>
      <button type="submit" disabled={command.pending}>
        I&apos;ve applied
      </button>
      <CommandFeedback error={command.error} onReload={command.reload} />
    </form>
  );
}

// Forms are not remounted when the application changes, so a refusal or a
// change made elsewhere never discards what the user chose; a choice that is
// no longer valid for the current stage falls back to the first valid one.
function StageForm({ application }: Props) {
  const command = useApplicationCommand(application.id);
  const options = submittedActiveStages.filter((stage) => stage !== application.stage);
  const [chosen, setStage] = useState<SubmittedActiveStage>(options[0]!);
  const stage = options.includes(chosen) ? chosen : options[0]!;
  return (
    <form
      className="inline-form"
      aria-label="Change stage"
      onSubmit={(event) => {
        event.preventDefault();
        void command.run({ command: "changeStage", expectedVersion: application.version, stage });
      }}
    >
      <label>
        Move to stage
        <select value={stage} onChange={(event) => setStage(event.target.value as SubmittedActiveStage)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {stageLabels[option]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={command.pending}>
        Update stage
      </button>
      <CommandFeedback error={command.error} onReload={command.reload} />
    </form>
  );
}

function CloseForm({ application, today }: Props) {
  const command = useApplicationCommand(application.id);
  const outcomes = applicationOutcomeSchema.options.filter((outcome) => canClose(application.stage, outcome).allowed);
  const [chosen, setOutcome] = useState<ApplicationOutcome>(outcomes[0]!);
  const outcome = outcomes.includes(chosen) ? chosen : outcomes[0]!;
  const [closedOn, setClosedOn] = useState(today);
  const [reason, setReason] = useState("");
  return (
    <details className="close-application">
      <summary>Close application</summary>
      <form
        aria-label="Close application"
        onSubmit={(event) => {
          event.preventDefault();
          void command.run({ command: "close", expectedVersion: application.version, outcome, closedOn, reason });
        }}
      >
        <div className="form-grid">
          <label>
            Outcome
            <select value={outcome} onChange={(event) => setOutcome(event.target.value as ApplicationOutcome)}>
              {outcomes.map((option) => (
                <option key={option} value={option}>
                  {outcomeLabels[option]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Closed on (UTC date)
            <input
              type="date"
              required
              min={application.appliedOn ?? undefined}
              max={today}
              value={closedOn}
              onChange={(event) => setClosedOn(event.target.value)}
            />
          </label>
        </div>
        <label>
          Reason or note (optional)
          <textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button type="submit" className="secondary-button" disabled={command.pending}>
          Close application
        </button>
        <p className="field-help">Closing does not change the opportunity&apos;s status in your list.</p>
        <CommandFeedback error={command.error} onReload={command.reload} />
      </form>
    </details>
  );
}

function ReopenButton({ application, reopenBlockedReason }: Props) {
  const command = useApplicationCommand(application.id);
  return (
    <div>
      <button
        type="button"
        className="secondary-button"
        disabled={command.pending || reopenBlockedReason !== null}
        onClick={() => void command.run({ command: "reopen", expectedVersion: application.version })}
      >
        Reopen application
      </button>
      {reopenBlockedReason ? <p className="field-help">{reopenBlockedReason}</p> : null}
      <CommandFeedback error={command.error} onReload={command.reload} />
    </div>
  );
}

function AppliedDateForm({ application, today }: Props) {
  const command = useApplicationCommand(application.id);
  // Shows the persisted date until the user types; their draft then wins
  // until it is saved.
  const [draft, setAppliedOn] = useState<string | null>(null);
  const appliedOn = draft ?? application.appliedOn ?? "";
  return (
    <details className="correct-applied-date">
      <summary>Correct the applied date</summary>
      <form
        className="inline-form"
        aria-label="Correct the applied date"
        onSubmit={(event) => {
          event.preventDefault();
          void command
            .run({ command: "correctAppliedOn", expectedVersion: application.version, appliedOn })
            .then((saved) => {
              if (saved) setAppliedOn(null);
            });
        }}
      >
        <label>
          Applied on (UTC date)
          <input
            type="date"
            required
            max={application.closedOn ?? today}
            value={appliedOn}
            onChange={(event) => setAppliedOn(event.target.value)}
          />
        </label>
        <button type="submit" className="secondary-button" disabled={command.pending}>
          Save date
        </button>
        <CommandFeedback error={command.error} onReload={command.reload} />
      </form>
    </details>
  );
}

export function StageControls(props: Props) {
  const { application } = props;
  if (application.stage === "CLOSED") {
    return (
      <div className="stage-controls">
        <ReopenButton {...props} />
        {isSubmitted(application.stage, application.outcome) ? (
          <AppliedDateForm {...props} />
        ) : null}
      </div>
    );
  }
  return (
    <div className="stage-controls">
      {application.stage === "PLANNED" ? <SubmitForm {...props} /> : <StageForm {...props} />}
      <CloseForm {...props} />
      {application.stage !== "PLANNED" ? <AppliedDateForm {...props} /> : null}
    </div>
  );
}
