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
import { fieldError, useApplicationCommand } from "./use-application-command";

type Interview = ApplicationView["interviews"][number];

// <input type="datetime-local"> value (browser local time) → ISO instant.
function toInstant(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
  const [status, setStatus] = useState<ApplicationInterviewStatus>(interview.status);
  const contact = application.contacts.find((item) => item.id === interview.contactId);
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
          onSubmit={(event) => {
            event.preventDefault();
            void command.run({
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
          <CommandFeedback error={command.error} onReload={command.reload} />
        </form>
      )}
    </li>
  );
}

function AddInterview({ application }: { application: ApplicationView }) {
  const command = useApplicationCommand(application.id);
  const [kind, setKind] = useState<ApplicationInterviewKind>("RECRUITER_SCREEN");
  const [roundLabel, setRoundLabel] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [contactId, setContactId] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <details className="add-interview">
      <summary>Add interview</summary>
      <form
        aria-label="Add interview"
        onSubmit={async (event) => {
          event.preventDefault();
          const saved = await command.run({
            command: "addInterview",
            kind,
            roundLabel,
            scheduledAt: toInstant(scheduledAt),
            status: "SCHEDULED",
            contactId,
            notes,
          });
          if (saved) {
            setRoundLabel("");
            setScheduledAt("");
            setNotes("");
          }
        }}
      >
        <div className="form-grid">
          <label>
            Type
            <select value={kind} onChange={(event) => setKind(event.target.value as ApplicationInterviewKind)}>
              {applicationInterviewKindSchema.options.map((option) => (
                <option key={option} value={option}>
                  {interviewKindLabels[option]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Round (optional)
            <input value={roundLabel} maxLength={120} onChange={(event) => setRoundLabel(event.target.value)} />
          </label>
          <label>
            Date and time (optional, your local time)
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
            <FieldError message={fieldError(command.error, "scheduledAt")} id="interview-scheduled-error" />
          </label>
          <label>
            Interviewer (optional)
            <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
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
          <textarea rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
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
  const suggest =
    !readOnly && application.interviews.length > 0 && (application.stage === "APPLIED" || application.stage === "SCREENING");
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
