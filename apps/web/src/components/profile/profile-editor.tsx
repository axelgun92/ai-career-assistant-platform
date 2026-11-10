"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DiscardChangesDialog } from "./discard-changes-dialog";
import { issuesByField } from "./labels";
import {
  initialDraftState,
  profileDraftReducer,
  savePayload,
  type EditorMode,
} from "./profile-draft";
import { ProfileJsonEditor, type JsonParseError } from "./profile-json-editor";
import { ProfileVersions, type ProfileVersionRow } from "./profile-versions";
import { parseProfileJson, type ProfileDocument } from "./structured-fields";
import { StructuredPreferencesForm } from "./structured-preferences-form";

interface Issue {
  path: string;
  message: string;
}

const modeLabels: Record<EditorMode, string> = {
  structured: "Form",
  json: "Advanced JSON",
};

export function profileHref(versionId: string, saved?: string): string {
  const params = new URLSearchParams({ version: versionId });
  if (saved) params.set("saved", saved);
  return `/profile?${params.toString()}`;
}

// Owns the one editing draft for the displayed version. The structured form
// and the JSON editor are controlled views of it; see profile-draft.ts for
// the rules that keep them from holding competing unsaved changes.
export function ProfileEditor({
  base,
  defaults,
  versions,
  activeId,
  effectiveId,
}: {
  base: { id: string; label: string; version: number; document: ProfileDocument };
  defaults: Record<string, unknown>;
  versions: ProfileVersionRow[];
  activeId: string | null;
  effectiveId: string | null;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    profileDraftReducer,
    { baseId: base.id, document: base.document, defaults },
    initialDraftState,
  );
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<JsonParseError | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  // Synchronous guard: a double click cannot start a second request before
  // the first render with `saving` lands.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!state.dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty]);

  function navigate(versionId: string) {
    if (versionId === base.id) return;
    if (state.dirty) dispatch({ type: "requestNavigate", versionId });
    else router.push(profileHref(versionId));
  }

  function confirmDiscard() {
    const pending = state.pendingConfirm;
    dispatch({ type: "confirmDiscard" });
    setParseError(null);
    if (pending?.kind === "navigate") router.push(profileHref(pending.versionId));
  }

  async function save(activate: boolean) {
    if (inFlight.current || !state.dirty) return;
    setError(null);
    setParseError(null);
    const payload = savePayload(state, activate, parseProfileJson);
    if (payload.endpoint === null) {
      setParseError(payload.error);
      return;
    }
    inFlight.current = true;
    dispatch({ type: "saveStarted" });
    try {
      const response = await fetch(payload.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.body),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        issues?: Issue[];
        status?: "CREATED" | "ALREADY_IMPORTED";
        id?: string;
        activated?: boolean;
      };
      if (!response.ok || !body.id) {
        setIssues(Array.isArray(body.issues) ? body.issues : []);
        setError(body.error ?? "The profile could not be saved.");
        dispatch({ type: "saveFailed" });
        return;
      }
      setIssues([]);
      dispatch({ type: "saveSucceeded" });
      const saved = `${body.status === "CREATED" ? "created" : "existing"}${body.activated ? "-active" : ""}`;
      router.push(profileHref(body.id, saved));
      router.refresh();
    } catch {
      setError("The application could not reach the server.");
      dispatch({ type: "saveFailed" });
    } finally {
      inFlight.current = false;
    }
  }

  async function activate(versionId: string) {
    setActivating(versionId);
    setActivationError(null);
    try {
      const response = await fetch("/api/profile/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userProfileId: versionId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setActivationError(body.error ?? "The version could not be made active.");
        return;
      }
      router.refresh();
    } catch {
      setActivationError("The application could not reach the server.");
    } finally {
      setActivating(null);
    }
  }

  const { fieldErrors, formErrors } = issuesByField(issues);
  const busy = state.saving || state.pendingConfirm !== null;

  return (
    <>
      <section className="profile-editor" aria-labelledby="profile-editor-title">
        <div className="profile-editor-header">
          <h2 id="profile-editor-title">Edit preferences</h2>
          <label className="inline-label">
            Displayed version
            <select value={base.id} onChange={(event) => navigate(event.target.value)} disabled={state.saving}>
              {versions.map((item) => (
                <option key={item.id} value={item.id}>
                  v{item.version}
                  {item.id === activeId ? " (active)" : item.id === effectiveId ? " (in use)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="field-help">
          Edits start from v{base.version}. Saving creates a new version and never changes v{base.version}.
        </p>

        <div className="view-tabs editor-tabs" role="tablist" aria-label="Editing mode">
          {(Object.keys(modeLabels) as EditorMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={state.mode === mode}
              aria-controls="profile-editor-panel"
              className={state.mode === mode ? "tab-button tab-button-current" : "tab-button"}
              disabled={busy}
              onClick={() => {
                setParseError(null);
                dispatch({ type: "switchMode", to: mode });
              }}
            >
              {modeLabels[mode]}
            </button>
          ))}
        </div>

        <p className="draft-status" role="status">
          {state.dirty === "structured"
            ? "Unsaved changes in the form."
            : state.dirty === "json"
              ? "Unsaved changes in the JSON editor."
              : "No unsaved changes."}
        </p>
        {state.notice ? (
          <p className="unknown-callout" role="alert">
            {state.notice}
          </p>
        ) : null}

        <div id="profile-editor-panel" role="tabpanel" aria-label={modeLabels[state.mode]}>
          {state.mode === "structured" ? (
            <StructuredPreferencesForm
              state={state}
              fieldErrors={fieldErrors}
              disabled={busy}
              onChange={(key, value) => dispatch({ type: "editField", key, value })}
            />
          ) : (
            <ProfileJsonEditor
              text={state.jsonText}
              parseError={parseError}
              issues={issues}
              disabled={busy}
              onChange={(text) => dispatch({ type: "editJson", text })}
            />
          )}
        </div>

        {error ? (
          <div className="error-message" role="alert">
            <p>{error}</p>
            {state.mode === "structured" && formErrors.length ? (
              <ul className="issue-list">
                {formErrors.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    <code>{issue.path}</code>: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="save-bar">
          <button type="button" disabled={!state.dirty || busy} onClick={() => save(false)}>
            {state.saving ? "Saving…" : "Save as new version"}
          </button>
          <button type="button" className="secondary-button" disabled={!state.dirty || busy} onClick={() => save(true)}>
            Save and make active
          </button>
        </div>
      </section>

      {activationError ? (
        <p className="error-message" role="alert">
          {activationError}
        </p>
      ) : null}
      <ProfileVersions
        versions={versions}
        activeId={activeId}
        effectiveId={effectiveId}
        displayedId={base.id}
        activating={activating}
        onView={navigate}
        onActivate={activate}
      />

      {state.pendingConfirm ? (
        <DiscardChangesDialog
          pending={state.pendingConfirm}
          onConfirm={confirmDiscard}
          onCancel={() => dispatch({ type: "cancelDiscard" })}
        />
      ) : null}
    </>
  );
}
