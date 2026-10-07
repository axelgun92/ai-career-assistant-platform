"use client";

import { conflictCode, type CommandError } from "./use-application-command";

// A stale-version conflict keeps the form as typed and offers to load the
// latest data; resubmitting then uses the new version. Other errors show
// their message (field problems are shown next to the fields).
export function CommandFeedback({ error, onReload }: { error: CommandError | null; onReload: () => void }) {
  if (!error) return null;
  if (error.code === conflictCode) {
    return (
      <div className="warning-message conflict-notice" role="alert">
        <p>This application changed elsewhere. Your changes are still here.</p>
        <button type="button" className="secondary-button" onClick={onReload}>
          Load latest
        </button>
      </div>
    );
  }
  return (
    <p className="error-message" role="alert">
      {error.message}
    </p>
  );
}

export function FieldError({ message, id }: { message: string | null; id: string }) {
  return message ? (
    <span className="field-error" id={id}>
      {message}
    </span>
  ) : null;
}
