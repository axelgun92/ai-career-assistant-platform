"use client";

import { useEffect, useRef } from "react";
import type { PendingConfirm } from "./profile-draft";

// Asks before any unsaved draft is discarded. "Keep editing" is the default
// focus, so pressing Enter never discards work.
export function DiscardChangesDialog({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingConfirm;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, []);
  const json = pending.kind === "discard-json";
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-title"
        aria-describedby="discard-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <h2 id="discard-title">{json ? "Discard your JSON changes?" : "Discard your unsaved changes?"}</h2>
        <p id="discard-description">
          {json
            ? `The form cannot show these JSON changes. ${pending.reason} Keep editing the JSON and save it, or discard the JSON changes to return to the form.`
            : "You have unsaved changes to this profile version. Opening another version discards them."}
        </p>
        <div className="evaluation-actions">
          <button ref={keepRef} type="button" onClick={onCancel}>
            {json ? "Keep editing JSON" : "Keep editing"}
          </button>
          <button type="button" className="secondary-button danger-button" onClick={onConfirm}>
            {json ? "Discard JSON changes" : "Discard changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
