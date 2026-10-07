// The single editing draft shared by the structured form and the JSON editor.
// Both editors work from the same base version, and at most one of them holds
// unsaved changes at any time: switching editors either carries the draft
// into the other representation or asks before discarding it.

import {
  applyStructuredChanges,
  deepEqual,
  diffToStructuredChanges,
  findField,
  formatProfileJson,
  readPath,
  StructuredChangeError,
  type ProfileDocument,
  type StructuredChanges,
} from "./structured-fields";

export type EditorMode = "structured" | "json";

export type PendingConfirm =
  | { kind: "discard-json"; reason: string }
  | { kind: "navigate"; versionId: string };

export interface ProfileDraftState {
  base: { id: string; document: ProfileDocument };
  defaults: Record<string, unknown>;
  baseJson: string;
  mode: EditorMode;
  structuredChanges: StructuredChanges;
  jsonText: string;
  dirty: EditorMode | null;
  pendingConfirm: PendingConfirm | null;
  // Why a switch was refused without changing anything (for example a
  // half-typed number that cannot be written into the JSON yet).
  notice: string | null;
  saving: boolean;
}

export type ProfileDraftAction =
  | { type: "editField"; key: string; value: unknown }
  | { type: "editJson"; text: string }
  | { type: "switchMode"; to: EditorMode }
  | { type: "requestNavigate"; versionId: string }
  | { type: "confirmDiscard" }
  | { type: "cancelDiscard" }
  | { type: "saveStarted" }
  | { type: "saveFailed" }
  | { type: "saveSucceeded" };

export function initialDraftState(input: {
  baseId: string;
  document: ProfileDocument;
  defaults: Record<string, unknown>;
  mode?: EditorMode;
}): ProfileDraftState {
  const baseJson = formatProfileJson(input.document);
  return {
    base: { id: input.baseId, document: input.document },
    defaults: input.defaults,
    baseJson,
    mode: input.mode ?? "structured",
    structuredChanges: {},
    jsonText: baseJson,
    dirty: null,
    pendingConfirm: null,
    notice: null,
    saving: false,
  };
}

function clean(state: ProfileDraftState, mode: EditorMode): ProfileDraftState {
  return {
    ...state,
    mode,
    structuredChanges: {},
    jsonText: state.baseJson,
    dirty: null,
    pendingConfirm: null,
    notice: null,
    saving: false,
  };
}

// The value the form shows for a field: the unsaved change, else the stored
// value, else the effective default. `isDefault` marks an unset field.
export function fieldDisplay(state: ProfileDraftState, key: string): { value: unknown; isDefault: boolean } {
  if (Object.hasOwn(state.structuredChanges, key)) {
    return { value: state.structuredChanges[key], isDefault: false };
  }
  const field = findField(key);
  const stored = field ? readPath(state.base.document, field.path) : undefined;
  if (stored !== undefined) return { value: stored, isDefault: false };
  return { value: state.defaults[key], isDefault: Object.hasOwn(state.defaults, key) };
}

export function profileDraftReducer(state: ProfileDraftState, action: ProfileDraftAction): ProfileDraftState {
  if (state.saving && action.type !== "saveFailed" && action.type !== "saveSucceeded") return state;
  switch (action.type) {
    case "editField": {
      if (state.mode !== "structured" || state.pendingConfirm) return state;
      const field = findField(action.key);
      if (!field) return state;
      const stored = readPath(state.base.document, field.path);
      const unchanged =
        stored !== undefined
          ? deepEqual(action.value, stored)
          : Object.hasOwn(state.defaults, action.key) && deepEqual(action.value, state.defaults[action.key]);
      const structuredChanges = { ...state.structuredChanges };
      if (unchanged) delete structuredChanges[action.key];
      else structuredChanges[action.key] = action.value;
      return {
        ...state,
        structuredChanges,
        notice: null,
        dirty: Object.keys(structuredChanges).length ? "structured" : null,
      };
    }
    case "editJson": {
      if (state.mode !== "json" || state.pendingConfirm) return state;
      return { ...state, jsonText: action.text, notice: null, dirty: action.text === state.baseJson ? null : "json" };
    }
    case "switchMode": {
      if (action.to === state.mode || state.pendingConfirm) return state;
      if (action.to === "json") {
        if (state.dirty !== "structured") return clean(state, "json");
        // Lossless carry-over: form fields are a subset of the document.
        let jsonText: string;
        try {
          jsonText = formatProfileJson(applyStructuredChanges(state.base.document, state.structuredChanges));
        } catch (error) {
          if (!(error instanceof StructuredChangeError)) throw error;
          const label = findField(error.path)?.label ?? error.path;
          return { ...state, notice: `Fix "${label}" before opening the JSON editor; your form changes are kept.` };
        }
        return {
          ...state,
          notice: null,
          mode: "json",
          structuredChanges: {},
          jsonText,
          dirty: jsonText === state.baseJson ? null : "json",
        };
      }
      if (state.dirty !== "json") return clean(state, "structured");
      const converted = diffToStructuredChanges(state.base.document, state.jsonText);
      if (!converted.ok) {
        return { ...state, pendingConfirm: { kind: "discard-json", reason: converted.reason } };
      }
      return {
        ...state,
        notice: null,
        mode: "structured",
        structuredChanges: converted.changes,
        jsonText: state.baseJson,
        dirty: Object.keys(converted.changes).length ? "structured" : null,
      };
    }
    case "requestNavigate": {
      if (!state.dirty || state.pendingConfirm) return state;
      return { ...state, pendingConfirm: { kind: "navigate", versionId: action.versionId } };
    }
    case "confirmDiscard": {
      if (!state.pendingConfirm) return state;
      return clean(state, state.pendingConfirm.kind === "discard-json" ? "structured" : state.mode);
    }
    case "cancelDiscard":
      return { ...state, pendingConfirm: null };
    case "saveStarted":
      if (!state.dirty) return state;
      return { ...state, saving: true };
    case "saveFailed":
      return { ...state, saving: false };
    case "saveSucceeded":
      return clean(state, state.mode);
  }
}

// What a save submits: only the open editor's draft. The invariant above
// guarantees the other editor is clean, so nothing unsaved is discarded.
export type ProfileSavePayload =
  | { endpoint: "/api/profile/structured"; body: { baseVersionId: string; changes: StructuredChanges; activate: boolean } }
  | { endpoint: "/api/profile"; body: { baseVersionId: string; document: unknown; activate: boolean } }
  | { endpoint: null; error: { message: string; line?: number; column?: number } };

export function savePayload(state: ProfileDraftState, activate: boolean, parse: (text: string) =>
  | { ok: true; document: ProfileDocument }
  | { ok: false; message: string; line?: number; column?: number }): ProfileSavePayload {
  if (state.mode === "structured") {
    return {
      endpoint: "/api/profile/structured",
      body: { baseVersionId: state.base.id, changes: state.structuredChanges, activate },
    };
  }
  const parsed = parse(state.jsonText);
  if (!parsed.ok) return { endpoint: null, error: parsed };
  return { endpoint: "/api/profile", body: { baseVersionId: state.base.id, document: parsed.document, activate } };
}
