"use client";

import { useState } from "react";
import { followUpState } from "@ai-career/core";
import { CommandFeedback, FieldError } from "./command-feedback";
import { followUpStateLabels, relativeDays } from "./labels";
import type { ApplicationView } from "./types";
import { fieldError, useApplicationCommand } from "./use-application-command";

type FollowUp = ApplicationView["followUps"][number];

function FollowUpItem({ applicationId, followUp, today, readOnly }: { applicationId: string; followUp: FollowUp; today: string; readOnly: boolean }) {
  const command = useApplicationCommand(applicationId);
  const state = followUpState(followUp.dueOn, followUp.completedAt, today);
  const done = state === "COMPLETED";
  return (
    <li className={`follow-up follow-up-${state.toLowerCase().replace("_", "-")}`}>
      <span className="follow-up-text">{followUp.description}</span>
      <span className={state === "OVERDUE" ? "status-label status-label-overdue" : "status-label"}>
        {followUpStateLabels[state]} · due {followUp.dueOn}
      </span>
      {readOnly ? null : (
        <button
          type="button"
          className="link-button"
          disabled={command.pending}
          onClick={() =>
            void command.run({
              command: done ? "reopenFollowUp" : "completeFollowUp",
              followUpId: followUp.id,
              expectedVersion: followUp.version,
            })
          }
        >
          {done ? "Reopen" : "Mark done"}
        </button>
      )}
      <CommandFeedback error={command.error} onReload={command.reload} />
      {!done && state !== "OVERDUE" ? <span className="field-help">{relativeDays(followUp.dueOn, today)}</span> : null}
    </li>
  );
}

function AddFollowUp({ applicationId, today }: { applicationId: string; today: string }) {
  const command = useApplicationCommand(applicationId);
  const [description, setDescription] = useState("");
  const [dueOn, setDueOn] = useState(today);
  const descriptionError = fieldError(command.error, "description");
  return (
    <form
      aria-label="Add follow-up"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await command.run({ command: "addFollowUp", description, dueOn })) setDescription("");
      }}
    >
      <div className="form-grid">
        <label>
          Next action
          <input
            value={description}
            maxLength={500}
            required
            placeholder="For example: Email the recruiter"
            aria-invalid={descriptionError ? true : undefined}
            onChange={(event) => setDescription(event.target.value)}
          />
          <FieldError message={descriptionError} id="follow-up-description-error" />
        </label>
        <label>
          Due (UTC date)
          <input type="date" required value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
        </label>
      </div>
      <button type="submit" disabled={command.pending}>
        Add follow-up
      </button>
      <CommandFeedback error={command.error} onReload={command.reload} />
    </form>
  );
}

export function FollowUps({ application, today, readOnly }: { application: ApplicationView; today: string; readOnly: boolean }) {
  const open = application.followUps.filter((followUp) => !followUp.completedAt);
  const next = open[0] ?? null; // ordered by due date
  const nextState = next ? followUpState(next.dueOn, null, today) : null;
  return (
    <section className="application-section" aria-labelledby="follow-ups-title">
      <h3 id="follow-ups-title">Follow-ups</h3>
      {next ? (
        <p className={nextState === "OVERDUE" ? "next-action next-action-overdue" : "next-action"}>
          <strong>Next action:</strong> {next.description} — {nextState === "OVERDUE" ? "overdue since" : "due"}{" "}
          {next.dueOn} ({relativeDays(next.dueOn, today)})
        </p>
      ) : (
        <p className="status-note">No open follow-ups.</p>
      )}
      {application.followUps.length ? (
        <ul className="follow-up-list" aria-label="Follow-ups">
          {application.followUps.map((followUp) => (
            <FollowUpItem
              key={followUp.id}
              applicationId={application.id}
              followUp={followUp}
              today={today}
              readOnly={readOnly}
            />
          ))}
        </ul>
      ) : null}
      {readOnly ? null : <AddFollowUp applicationId={application.id} today={today} />}
      <p className="field-help">Dates are calendar dates in UTC.</p>
    </section>
  );
}
