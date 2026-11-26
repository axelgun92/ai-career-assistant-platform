"use client";

import { useState } from "react";
import { CommandFeedback, FieldError } from "./command-feedback";
import type { ApplicationView } from "./types";
import { fieldError, useApplicationCommand } from "./use-application-command";

type Note = ApplicationView["notes"][number];

function NoteItem({ applicationId, note, readOnly }: { applicationId: string; note: Note; readOnly: boolean }) {
  const command = useApplicationCommand(applicationId);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  if (editing) {
    return (
      <li>
        <form
          aria-label="Edit note"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await command.run({ command: "editNote", noteId: note.id, expectedVersion: note.version, body })) {
              setEditing(false);
            }
          }}
        >
          <label>
            Note
            <textarea rows={3} maxLength={10_000} value={body} onChange={(event) => setBody(event.target.value)} />
            <FieldError message={fieldError(command.error, "body")} id={`note-${note.id}-error`} />
          </label>
          <div className="evaluation-actions">
            <button type="submit" disabled={command.pending}>Save note</button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setBody(note.body);
                setEditing(false);
                command.clearError();
              }}
            >
              Cancel
            </button>
          </div>
          <CommandFeedback error={command.error} onReload={command.reload} />
        </form>
      </li>
    );
  }
  return (
    <li>
      <p className="note-body">{note.body}</p>
      <span className="field-help">
        {note.createdAt.slice(0, 10)}
        {note.editedAt ? ` · edited ${note.editedAt.slice(0, 10)}` : ""}
      </span>
      {readOnly ? null : (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setBody(note.body);
            setEditing(true);
          }}
        >
          Edit
        </button>
      )}
    </li>
  );
}

export function AddNote({ applicationId }: { applicationId: string }) {
  const command = useApplicationCommand(applicationId);
  const [body, setBody] = useState("");
  const error = fieldError(command.error, "body");
  return (
    <form
      aria-label="Add note"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await command.run({ command: "addNote", body })) setBody("");
      }}
    >
      <label>
        New note
        <textarea
          rows={3}
          maxLength={10_000}
          value={body}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setBody(event.target.value)}
        />
        <FieldError message={error} id="add-note-error" />
      </label>
      <button type="submit" disabled={command.pending}>
        Add note
      </button>
      <CommandFeedback error={command.error} onReload={command.reload} />
    </form>
  );
}

export function Notes({ application, readOnly }: { application: ApplicationView; readOnly: boolean }) {
  return (
    <section className="application-section" aria-labelledby="notes-title">
      <h3 id="notes-title">Notes</h3>
      {application.notes.length ? (
        <ul className="note-list" aria-label="Notes">
          {application.notes.map((note) => (
            <NoteItem key={note.id} applicationId={application.id} note={note} readOnly={readOnly} />
          ))}
        </ul>
      ) : (
        <p className="status-note">No notes yet.</p>
      )}
      {readOnly ? null : <AddNote applicationId={application.id} />}
    </section>
  );
}
