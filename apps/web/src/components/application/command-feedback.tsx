"use client";

import { conflictCode, reloadableErrorCodes, type CommandError } from "./use-application-command";

// Every refusal keeps the form as typed. A stale-version conflict, or a
// refusal caused by state that changed elsewhere, offers to load the latest
// data; resubmitting then uses the new version. Validation and transition
// refusals show only their message (field problems are shown next to the
// fields).
export function CommandFeedback({ error, onReload }: { error: CommandError | null; onReload: () => void }) {
  if (!error) return null;
  if (reloadableErrorCodes.has(error.code)) {
    return (
      <div className="warning-message conflict-notice" role="alert">
        <p>
          {error.code === conflictCode
            ? "This application changed elsewhere. Your changes are still here."
            : `${error.message.replace(/[.!?]?$/, ".")} Your changes are still here.`}
        </p>
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
