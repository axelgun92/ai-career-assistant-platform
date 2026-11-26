"use client";

import { useState } from "react";
import {
  applicationInterviewKindSchema,
  applicationInterviewStatusSchema,
  type ApplicationInterviewKind,
  type ApplicationInterviewStatus,
} from "@ai-career/core";
import { CommandFeedback, FieldError } from "./command-feedback";
import { formatInstantUtc, interviewKindLabels, interviewStatusLabels } from "./labels";
import type { ApplicationView } from "./types";
import { fieldError, useApplicationCommand, type CommandError } from "./use-application-command";

type Interview = ApplicationView["interviews"][number];

// <input type="datetime-local"> value (browser local time) → ISO instant.
function toInstant(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ISO instant → <input type="datetime-local"> value in browser local time.
function toLocalInput(instant: string | null): string {
  if (!instant) return "";
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface InterviewDraft {
  kind: ApplicationInterviewKind;
  roundLabel: string;
  scheduledAt: string; // datetime-local value
  status: ApplicationInterviewStatus;
  contactId: string;
  notes: string;
}

const emptyDraft: InterviewDraft = {
  kind: "RECRUITER_SCREEN",
  roundLabel: "",
  scheduledAt: "",
  status: "SCHEDULED",
  contactId: "",
  notes: "",
};

function draftFrom(interview: Interview): InterviewDraft {
  return {
    kind: interview.kind,
    roundLabel: interview.roundLabel ?? "",
    scheduledAt: toLocalInput(interview.scheduledAt),
    status: interview.status,
    contactId: interview.contactId ?? "",
    notes: interview.notes ?? "",
  };
}

// The fields shared by the add and edit forms.
function InterviewFields({
  application,
  draft,
  onChange,
  error,
  idPrefix,
}: {
  application: ApplicationView;
  draft: InterviewDraft;
  onChange: (changes: Partial<InterviewDraft>) => void;
  error: CommandError | null;
  idPrefix: string;
}) {
  return (
    <>
      <div className="form-grid">
        <label>
          Type
          <select value={draft.kind} onChange={(event) => onChange({ kind: event.target.value as ApplicationInterviewKind })}>
            {applicationInterviewKindSchema.options.map((option) => (
              <option key={option} value={option}>
                {interviewKindLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Round (optional)
          <input value={draft.roundLabel} maxLength={120} onChange={(event) => onChange({ roundLabel: event.target.value })} />
        </label>
        <label>
          Date and time (optional, your local time)
          <input
            type="datetime-local"
            value={draft.scheduledAt}
            onChange={(event) => onChange({ scheduledAt: event.target.value })}
          />
          <FieldError message={fieldError(error, "scheduledAt")} id={`${idPrefix}-scheduled-error`} />
        </label>
        <label>
          Status
          <select
            value={draft.status}
            onChange={(event) => onChange({ status: event.target.value as ApplicationInterviewStatus })}
          >
            {applicationInterviewStatusSchema.options.map((option) => (
              <option key={option} value={option}>
                {interviewStatusLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Interviewer (optional)
          <select value={draft.contactId} onChange={(event) => onChange({ contactId: event.target.value })}>
            <option value="">None</option>
            {application.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Notes (optional)
        <textarea rows={2} maxLength={2000} value={draft.notes} onChange={(event) => onChange({ notes: event.target.value })} />
      </label>
    </>
  );
}

function EditInterview({
  application,
  interview,
  onDone,
}: {
  application: ApplicationView;
  interview: Interview;
  onDone: () => void;
}) {
  const command = useApplicationCommand(application.id);
  const [draft, setDraft] = useState<InterviewDraft>(() => draftFrom(interview));
  const original = draftFrom(interview);
  return (
    <form
      aria-label={`Edit interview ${interviewKindLabels[interview.kind]}`}
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await command.run({
          command: "updateInterview",
          interviewId: interview.id,
          expectedVersion: interview.version,
          kind: draft.kind,
          roundLabel: draft.roundLabel,
          // An untouched time keeps the stored instant exactly (the input
          // shows minutes only).
          scheduledAt: draft.scheduledAt === original.scheduledAt ? interview.scheduledAt : toInstant(draft.scheduledAt),
          status: draft.status,
          contactId: draft.contactId,
          notes: draft.notes,
        });
        if (saved) onDone();
      }}
    >
      <InterviewFields
        application={application}
        draft={draft}
        onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
        error={command.error}
        idPrefix={`interview-${interview.id}`}
      />
      <div className="evaluation-actions">
        <button type="submit" disabled={command.pending}>
          Save interview
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            command.clearError();
            onDone();
          }}
        >
          Cancel
        </button>
      </div>
      <CommandFeedback error={command.error} onReload={command.reload} />
    </form>
  );
}

function InterviewItem({
  application,
  interview,
  readOnly,
}: {
  application: ApplicationView;
  interview: Interview;
  readOnly: boolean;
}) {
  const command = useApplicationCommand(application.id);
  const [editing, setEditing] = useState(false);
  // The quick status control shows the persisted status until the user picks
  // another one, so a change saved elsewhere is reflected after a refresh.
  const [statusDraft, setStatus] = useState<ApplicationInterviewStatus | null>(null);
  const status = statusDraft ?? interview.status;
  const contact = application.contacts.find((item) => item.id === interview.contactId);
  if (editing && !readOnly) {
    return (
      <li className="interview">
        <EditInterview application={application} interview={interview} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="interview">
      <strong>{interviewKindLabels[interview.kind]}</strong>
      {interview.roundLabel ? <span> · {interview.roundLabel}</span> : null}
      <span className="status-label">{interviewStatusLabels[interview.status]}</span>
      <span className="field-help">{formatInstantUtc(interview.scheduledAt)}</span>
      {contact ? <span>With {contact.name}</span> : null}
      {interview.notes ? <p className="field-help">{interview.notes}</p> : null}
      {readOnly ? null : (
        <form
          className="inline-form"
          aria-label={`Update interview ${interviewKindLabels[interview.kind]}`}
          onSubmit={async (event) => {
            event.preventDefault();
            const saved = await command.run({
              command: "updateInterview",
              interviewId: interview.id,
              expectedVersion: interview.version,
              kind: interview.kind,
              roundLabel: interview.roundLabel,
              scheduledAt: interview.scheduledAt,
              status,
              contactId: interview.contactId,
              notes: interview.notes,
            });
            if (saved) setStatus(null);
          }}
        >
          <label>
            Interview status
            <select value={status} onChange={(event) => setStatus(event.target.value as ApplicationInterviewStatus)}>
              {applicationInterviewStatusSchema.options.map((option) => (
                <option key={option} value={option}>
                  {interviewStatusLabels[option]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary-button" disabled={command.pending || status === interview.status}>
            Save status
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              command.clearError();
              setEditing(true);
            }}
          >
            Edit details
          </button>
          <CommandFeedback error={command.error} onReload={command.reload} />
        </form>
      )}
    </li>
  );
}

function AddInterview({ application }: { application: ApplicationView }) {
  const command = useApplicationCommand(application.id);
  const [draft, setDraft] = useState<InterviewDraft>(emptyDraft);
  return (
    <details className="add-interview">
      <summary>Add interview</summary>
      <form
        aria-label="Add interview"
        onSubmit={async (event) => {
          event.preventDefault();
          const saved = await command.run({
            command: "addInterview",
            kind: draft.kind,
            roundLabel: draft.roundLabel,
            scheduledAt: toInstant(draft.scheduledAt),
            status: draft.status,
            contactId: draft.contactId,
            notes: draft.notes,
          });
          if (saved) {
            setDraft((current) => ({ ...current, roundLabel: "", scheduledAt: "", status: "SCHEDULED", notes: "" }));
          }
        }}
      >
        <InterviewFields
          application={application}
          draft={draft}
          onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
          error={command.error}
          idPrefix="interview-new"
        />
        <button type="submit" disabled={command.pending}>
          Save interview
        </button>
        <CommandFeedback error={command.error} onReload={command.reload} />
      </form>
    </details>
  );
}

// Interviews never move the stage on their own; this only suggests it.
function MoveToInterviewing({ application }: { application: ApplicationView }) {
  const command = useApplicationCommand(application.id);
  return (
    <div className="status-note">
      <span>You have interviews recorded. Move this application to Interviewing?</span>{" "}
      <button
        type="button"
        className="link-button"
        disabled={command.pending}
        onClick={() => void command.run({ command: "changeStage", expectedVersion: application.version, stage: "INTERVIEWING" })}
      >
        Move to Interviewing
      </button>
      <CommandFeedback error={command.error} onReload={command.reload} />
    </div>
  );
}

export function Interviews({ application, readOnly }: { application: ApplicationView; readOnly: boolean }) {
  // Only a scheduled or completed interview suggests the stage; cancelled
  // ones do not.
  const suggest =
    !readOnly &&
    application.interviews.some((interview) => interview.status !== "CANCELLED") &&
    (application.stage === "APPLIED" || application.stage === "SCREENING");
  return (
    <section className="application-section" aria-labelledby="interviews-title">
      <h3 id="interviews-title">Interviews</h3>
      {application.interviews.length ? (
        <ul className="interview-list" aria-label="Interviews">
          {application.interviews.map((interview) => (
            <InterviewItem
              key={interview.id}
              application={application}
              interview={interview}
              readOnly={readOnly}
            />
          ))}
        </ul>
      ) : (
        <p className="status-note">No interviews recorded.</p>
      )}
      {suggest ? <MoveToInterviewing application={application} /> : null}
      {readOnly || application.stage === "PLANNED" ? null : <AddInterview application={application} />}
    </section>
  );
}
