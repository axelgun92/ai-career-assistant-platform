// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fieldDisplay,
  initialDraftState,
  profileDraftReducer,
  savePayload,
  type ProfileDraftAction,
  type ProfileDraftState,
} from "../../apps/web/src/components/profile/profile-draft";
import {
  formatProfileJson,
  parseProfileJson,
  readPath,
  type ProfileDocument,
} from "../../apps/web/src/components/profile/structured-fields";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
// The web app resolves `next` from its own node_modules.
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));

const { ProfileEditor } = await import("../../apps/web/src/components/profile/profile-editor");

const baseId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
const otherId = "7a2d8b4f-2e66-4b4c-8c8f-1e3c9b2f5d22";
const cs = "domainPreferences.customerSuccess";
const passKey = `${cs}.salary.passMinimum`;
const defaults = {
  [`${cs}.salary.currency`]: "USD",
  [`${cs}.workArrangement.allowed`]: ["REMOTE"],
  [`${cs}.location.allowUnitedStatesOnlyRoles`]: true,
};

function baseDocument(): ProfileDocument {
  return {
    label: "Editor profile",
    careerGoals: [{ id: "goal-1", statement: "Grow into strategic Customer Success." }],
    experience: [{ id: "exp-1", statement: "Led onboarding.", relationship: "DIRECT" }],
    skills: [{ id: "skill-1", statement: "Customer enablement" }],
    transferableSkills: null,
    locationPreferences: { note: "generic" },
    compensationPreferences: null,
    workPreferences: null,
    companyPreferences: null,
    domainPreferences: {
      customerSuccess: {
        salary: { passMinimum: 70_000, reviewMinimum: 60_000 },
        location: {},
        travel: {},
        workArrangement: {},
        roleFamilies: { continuingClassifications: ["CORE_CS"] },
      },
    },
  };
}

const initial = () => initialDraftState({ baseId, document: baseDocument(), defaults });
const run = (state: ProfileDraftState, ...actions: ProfileDraftAction[]) => actions.reduce(profileDraftReducer, state);
const jsonWith = (mutate: (document: ProfileDocument) => void) => {
  const document = baseDocument();
  mutate(document);
  return formatProfileJson(document);
};
const salaryOf = (document: ProfileDocument) =>
  (document.domainPreferences as { customerSuccess: { salary: Record<string, unknown> } }).customerSuccess.salary;

describe("profile draft reducer", () => {
  it("form dirty → open JSON carries the form changes into the JSON draft", () => {
    const state = run(initial(), { type: "editField", key: passKey, value: 81_000 }, { type: "switchMode", to: "json" });
    expect(state.mode).toBe("json");
    expect(state.dirty).toBe("json");
    expect(state.structuredChanges).toEqual({});
    expect(state.pendingConfirm).toBeNull();
    const document = JSON.parse(state.jsonText) as ProfileDocument;
    expect(salaryOf(document)).toEqual({ passMinimum: 81_000, reviewMinimum: 60_000 });
    // Untouched unset fields stay absent.
    expect(readPath(document, ["domainPreferences", "customerSuccess", "salary", "currency"])).toBeUndefined();
    expect(readPath(document, ["domainPreferences", "customerSuccess", "fitPreferences"])).toBeUndefined();
  });

  it("JSON dirty → return to form carries a form-representable edit", () => {
    const state = run(
      initial(),
      { type: "switchMode", to: "json" },
      { type: "editJson", text: jsonWith((document) => { salaryOf(document).passMinimum = 90_000; }) },
      { type: "switchMode", to: "structured" },
    );
    expect(state.mode).toBe("structured");
    expect(state.dirty).toBe("structured");
    expect(state.structuredChanges).toEqual({ [passKey]: 90_000 });
    expect(state.jsonText).toBe(state.baseJson);
    expect(state.pendingConfirm).toBeNull();
    expect(fieldDisplay(state, passKey)).toEqual({ value: 90_000, isDefault: false });
  });

  it.each([
    ["a parse error", "{ not json"],
    ["a non-form edit", jsonWith((document) => { document.locationPreferences = { note: "changed" }; })],
    ["a removed field", jsonWith((document) => { delete salaryOf(document).reviewMinimum; })],
  ])("JSON dirty → return to form with %s asks before discarding and stays in JSON", (_name, text) => {
    const state = run(initial(), { type: "switchMode", to: "json" }, { type: "editJson", text }, { type: "switchMode", to: "structured" });
    expect(state.pendingConfirm).toMatchObject({ kind: "discard-json" });
    expect(state.mode).toBe("json");
    expect(state.dirty).toBe("json");
    expect(state.jsonText).toBe(text);
  });

  it("confirming discard returns to a clean form showing the base values", () => {
    const text = jsonWith((document) => { document.locationPreferences = { note: "changed" }; });
    const state = run(
      initial(),
      { type: "switchMode", to: "json" },
      { type: "editJson", text },
      { type: "switchMode", to: "structured" },
      { type: "confirmDiscard" },
    );
    expect(state).toMatchObject({ mode: "structured", dirty: null, pendingConfirm: null, structuredChanges: {} });
    expect(fieldDisplay(state, passKey)).toEqual({ value: 70_000, isDefault: false });
    expect(run(state, { type: "switchMode", to: "json" }).jsonText).toBe(state.baseJson);
  });

  it("cancelling discard preserves the JSON draft byte-for-byte, and saving submits that exact draft", () => {
    const text = `${jsonWith((document) => { document.locationPreferences = { note: "kept" }; })}\n  `;
    const state = run(
      initial(),
      { type: "switchMode", to: "json" },
      { type: "editJson", text },
      { type: "switchMode", to: "structured" },
      { type: "cancelDiscard" },
    );
    expect(state).toMatchObject({ mode: "json", dirty: "json", pendingConfirm: null });
    expect(state.jsonText).toBe(text);
    const payload = savePayload(state, false, parseProfileJson);
    expect(payload).toMatchObject({ endpoint: "/api/profile", body: { baseVersionId: baseId, activate: false } });
    expect(payload.endpoint === "/api/profile" && payload.body.document).toEqual(JSON.parse(text));
  });

  it("changing the displayed version while dirty asks first; confirming discards", () => {
    const dirty = run(initial(), { type: "editField", key: passKey, value: 81_000 });
    const pending = run(dirty, { type: "requestNavigate", versionId: otherId });
    expect(pending.pendingConfirm).toEqual({ kind: "navigate", versionId: otherId });
    expect(pending.structuredChanges).toEqual({ [passKey]: 81_000 });
    expect(run(pending, { type: "cancelDiscard" }).structuredChanges).toEqual({ [passKey]: 81_000 });
    expect(run(pending, { type: "confirmDiscard" })).toMatchObject({ dirty: null, structuredChanges: {} });
    expect(run(initial(), { type: "requestNavigate", versionId: otherId }).pendingConfirm).toBeNull();
  });

  it("an incomplete number blocks opening JSON without losing anything", () => {
    const state = run(initial(), { type: "editField", key: passKey, value: "8e" }, { type: "switchMode", to: "json" });
    expect(state.mode).toBe("structured");
    expect(state.structuredChanges).toEqual({ [passKey]: "8e" });
    expect(state.notice).toMatch(/Salary that passes/);
  });

  it("editing back to the saved or default value leaves the draft clean", () => {
    expect(run(initial(), { type: "editField", key: passKey, value: 1 }, { type: "editField", key: passKey, value: 70_000 }).dirty).toBeNull();
    const currency = `${cs}.salary.currency`;
    expect(fieldDisplay(initial(), currency)).toEqual({ value: "USD", isDefault: true });
    const state = run(initial(), { type: "editField", key: currency, value: "EUR" }, { type: "editField", key: currency, value: "USD" });
    expect(state.dirty).toBeNull();
  });

  it("ignores edits and switches while a save is in flight", () => {
    const saving = run(initial(), { type: "editField", key: passKey, value: 81_000 }, { type: "saveStarted" });
    expect(run(saving, { type: "editField", key: passKey, value: 5 }, { type: "switchMode", to: "json" })).toBe(saving);
    expect(run(saving, { type: "saveFailed" })).toMatchObject({ saving: false, structuredChanges: { [passKey]: 81_000 } });
  });

  it("never lets both editors hold unsaved changes, over random action sequences", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const texts = [
      jsonWith((document) => { salaryOf(document).passMinimum = 99_000; }),
      jsonWith((document) => { document.locationPreferences = { note: "x" }; }),
      "{ broken",
    ];
    const actions: Array<() => ProfileDraftAction> = [
      () => ({ type: "editField", key: passKey, value: Math.round(random() * 100_000) }),
      () => ({ type: "editField", key: `${cs}.workArrangement.allowed`, value: random() > 0.5 ? ["REMOTE", "HYBRID"] : ["REMOTE"] }),
      () => ({ type: "editJson", text: texts[Math.floor(random() * texts.length)]! }),
      () => ({ type: "switchMode", to: random() > 0.5 ? "json" : "structured" }),
      () => ({ type: "requestNavigate", versionId: otherId }),
      () => ({ type: "confirmDiscard" }),
      () => ({ type: "cancelDiscard" }),
      () => ({ type: "saveStarted" }),
      () => ({ type: "saveFailed" }),
      () => ({ type: "saveSucceeded" }),
    ];
    let state = initial();
    for (let step = 0; step < 5_000; step += 1) {
      state = profileDraftReducer(state, actions[Math.floor(random() * actions.length)]!());
      const formDirty = Object.keys(state.structuredChanges).length > 0;
      const jsonDirty = state.jsonText !== state.baseJson;
      expect(formDirty && jsonDirty).toBe(false);
      if (formDirty) expect(state.dirty).toBe("structured");
      if (jsonDirty) expect(state.dirty).toBe("json");
      if (state.dirty === "structured") expect(state.mode).toBe("structured");
      if (state.dirty === "json") expect(state.mode).toBe("json");
    }
  });
});

// Component tests: the real ProfileEditor in jsdom with a mocked fetch.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  router.push.mockReset();
  router.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderEditor() {
  act(() => {
    root.render(
      <ProfileEditor
        base={{ id: baseId, label: "Editor profile", version: 1, document: baseDocument() }}
        defaults={defaults}
        versions={[
          { id: baseId, label: "Editor profile", version: 1, createdAt: "2026-10-01T00:00:00.000Z", evaluationCount: 1 },
          { id: otherId, label: "Editor profile", version: 2, createdAt: "2026-10-02T00:00:00.000Z", evaluationCount: 0 },
        ]}
        activeId={baseId}
        effectiveId={baseId}
      />,
    );
  });
}

const byId = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
const passInput = () => byId<HTMLInputElement>("field-domainPreferences-customerSuccess-salary-passMinimum");
const jsonArea = () => byId<HTMLTextAreaElement>("profile-json");
const button = (name: string | RegExp) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    typeof name === "string" ? candidate.textContent?.trim() === name : name.test(candidate.textContent ?? ""));
  if (!found) throw new Error(`No button ${String(name)}`);
  return found;
};
const dialog = () => document.querySelector('[role="alertdialog"]');
const status = () => container.querySelector('[role="status"]')?.textContent;

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (element: HTMLElement) => act(() => element.click());
async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
}
const ok = (body: unknown, statusCode = 201) => new Response(JSON.stringify(body), { status: statusCode });

describe("ProfileEditor interaction", () => {
  it("structured form dirty → open JSON editor shows the form change, with no dialog", () => {
    renderEditor();
    type(passInput(), "81000");
    expect(status()).toBe("Unsaved changes in the form.");
    click(button("Advanced JSON"));
    expect(dialog()).toBeNull();
    expect(salaryOf(JSON.parse(jsonArea().value) as ProfileDocument).passMinimum).toBe(81_000);
    expect(status()).toBe("Unsaved changes in the JSON editor.");
  });

  it("JSON editor dirty → return to the form: cancel keeps the draft, confirm discards it", () => {
    renderEditor();
    click(button("Advanced JSON"));
    const edited = jsonWith((document) => { document.locationPreferences = { note: "only in JSON" }; });
    type(jsonArea(), edited);

    click(button("Form"));
    expect(dialog()?.textContent).toMatch(/locationPreferences\.note/);
    click(button("Keep editing JSON"));
    expect(dialog()).toBeNull();
    expect(jsonArea().value).toBe(edited);
    expect(status()).toBe("Unsaved changes in the JSON editor.");

    click(button("Form"));
    click(button("Discard JSON changes"));
    expect(dialog()).toBeNull();
    expect(passInput().value).toBe("70000");
    expect(status()).toBe("No unsaved changes.");
    click(button("Advanced JSON"));
    expect(jsonArea().value).toBe(formatProfileJson(baseDocument()));
  });

  it("JSON editor dirty with a form-representable edit returns to the form without asking", () => {
    renderEditor();
    click(button("Advanced JSON"));
    type(jsonArea(), jsonWith((document) => { salaryOf(document).passMinimum = 95_000; }));
    click(button("Form"));
    expect(dialog()).toBeNull();
    expect(passInput().value).toBe("95000");
    expect(status()).toBe("Unsaved changes in the form.");
  });

  it("asks before opening another version while there are unsaved changes", () => {
    renderEditor();
    type(passInput(), "81000");
    click(button("View v2"));
    expect(dialog()?.textContent).toMatch(/unsaved changes/);
    expect(router.push).not.toHaveBeenCalled();
    click(button("Keep editing"));
    expect(passInput().value).toBe("81000");
    click(button("View v2"));
    click(button("Discard changes"));
    expect(router.push).toHaveBeenCalledWith(`/profile?version=${otherId}`);
  });

  it("saving from the form sends exactly one request with only the changed paths, even on a double click", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    renderEditor();
    type(passInput(), "81000");
    const save = button("Save as new version");
    act(() => { save.click(); save.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/profile/structured");
    expect(JSON.parse(init.body)).toEqual({ baseVersionId: baseId, changes: { [passKey]: 81_000 }, activate: false });
    resolve(ok({ status: "CREATED", id: otherId, version: 2, activated: false }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(`/profile?version=${otherId}&saved=created`);
  });

  it("saving from JSON after a form carry-over sends one request with the form change in the document", async () => {
    fetchMock.mockResolvedValue(ok({ status: "CREATED", id: otherId, version: 2, activated: true }));
    renderEditor();
    type(passInput(), "81000");
    click(button("Advanced JSON"));
    click(button("Save and make active"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/profile");
    const body = JSON.parse(init.body) as { baseVersionId: string; activate: boolean; document: ProfileDocument };
    expect(body.baseVersionId).toBe(baseId);
    expect(body.activate).toBe(true);
    expect(salaryOf(body.document).passMinimum).toBe(81_000);
    expect(router.push).toHaveBeenCalledWith(`/profile?version=${otherId}&saved=created-active`);
  });

  it("keeps the draft and shows field errors when the server rejects a save", async () => {
    fetchMock.mockResolvedValue(ok({
      error: "The profile could not be saved",
      code: "PROFILE_INVALID",
      issues: [{ path: `${cs}.salary`, message: "The salary pass threshold must exceed the review threshold" }],
    }, 400));
    renderEditor();
    type(passInput(), "50000");
    click(button("Save as new version"));
    await settle();
    expect(passInput().value).toBe("50000");
    expect(passInput().getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("The salary pass threshold must exceed the review threshold");
    expect(button("Save as new version").disabled).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not send a JSON save that does not parse", () => {
    renderEditor();
    click(button("Advanced JSON"));
    type(jsonArea(), "{\n  \"label\": \"x\",\n  oops\n}");
    click(button("Save as new version"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/Line 3, column 3/);
    expect(jsonArea().getAttribute("aria-invalid")).toBe("true");
  });

  it("disables saving when nothing has changed and marks unset fields as Default", () => {
    renderEditor();
    expect(button("Save as new version").disabled).toBe(true);
    expect(button("Save and make active").disabled).toBe(true);
    expect(byId("field-domainPreferences-customerSuccess-salary-currency").closest(".profile-field")?.textContent).toContain("Default");
    expect(passInput().closest(".profile-field")?.textContent).not.toContain("Default");
  });
});
