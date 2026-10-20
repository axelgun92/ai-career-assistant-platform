// Feature 14B: the extension's own code outside the page reader: the
// capture envelope (checked with the server's schema), the API client (only
// /api/extension/* on a local backend, the credential only in the
// Authorization header), the settings (chrome.storage.local only, never
// logged), the popup's messages (persisted state only), and static checks
// on the manifest and sources (exact permissions, no content scripts, no
// HTML insertion, no storage.sync, no logging).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, extensionApiPrefix, normalizeBackendUrl } from "../../apps/extension/src/api";
import { buildCaptureEnvelope, previewFields } from "../../apps/extension/src/envelope";
import type { PageExtraction } from "../../apps/extension/src/extract";
import {
  captureMessage,
  evaluationActive,
  evaluationLine,
  evaluationRequestMessage,
  siteLine,
} from "../../apps/extension/src/popup-view";
import { forgetPairing, readSettings, restrictStorage, saveSettings } from "../../apps/extension/src/settings";
import { parseCapture } from "../../apps/web/src/server/extension-capture";

const extensionRoot = path.resolve("apps/extension");
const credential = `aija_${"A".repeat(43)}`;

const extraction = (overrides: Partial<PageExtraction> = {}): PageExtraction => ({
  pageUrl: "https://careers.example.com/jobs/7?utm_source=feed",
  linkedIn: false,
  extractor: "structured-data",
  posting: {
    title: "Customer Success Manager",
    description: "Own onboarding and renewals.",
    company: "Example",
    location: "Remote",
    salaryText: null,
    salaryMin: 90000,
    salaryMax: 110000,
    salaryCurrency: "USD",
    salaryPeriod: "YEAR",
    workplaceType: "REMOTE",
    employmentType: "FULL_TIME",
    postedAt: "2026-10-15",
    applicationUrl: null,
    siteJobId: "REQ-1",
  },
  selection: { title: "Customer Success Manager", description: "Only the selected part of the description." },
  notes: [],
  problem: null,
  ...overrides,
});

const context = { extensionVersion: "0.1.0", capturedAt: new Date("2026-10-20T09:00:00.000Z") };

describe("the capture envelope", () => {
  it("is valid under the server's own schema", () => {
    const built = buildCaptureEnvelope(extraction(), "page", context);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(parseCapture(built.envelope)).toMatchObject({ extractor: "structured-data", fields: { title: "Customer Success Manager", siteJobId: "REQ-1" } });
    expect(Object.keys(built.envelope).sort()).toEqual(["capturedAt", "editedFields", "extensionVersion", "extractor", "fields", "notes", "pageUrl", "schemaVersion"]);
  });

  it("sends the user's selection as the description when chosen, with no salary or apply link from elsewhere", () => {
    const built = buildCaptureEnvelope(extraction(), "selection", context);
    expect(built.ok && built.envelope).toMatchObject({
      extractor: "selection",
      fields: { description: "Only the selected part of the description.", salaryMin: null, applicationUrl: null, company: "Example" },
    });
  });

  it("sends the user's corrections from the editable preview and names the corrected fields", () => {
    const built = buildCaptureEnvelope(extraction(), "page", context, {
      title: "  Senior Customer Success Manager ",
      company: "",
      location: "Remote",
      description: "Own onboarding and renewals.",
    });
    expect(built.ok && built.envelope).toMatchObject({
      editedFields: ["title", "company"],
      fields: { title: "Senior Customer Success Manager", company: null, location: "Remote", description: "Own onboarding and renewals.", salaryMin: 90000 },
    });
    // Leaving the preview as read changes nothing.
    const untouched = buildCaptureEnvelope(extraction(), "page", context, previewFields(extraction(), "page")!);
    expect(untouched.ok && untouched.envelope.editedFields).toEqual([]);
    expect(previewFields(extraction(), "selection")).toEqual({
      title: "Customer Success Manager",
      company: "Example",
      location: "Remote",
      description: "Only the selected part of the description.",
    });
    // Clearing the title makes the capture invalid rather than sending a guess.
    expect(buildCaptureEnvelope(extraction(), "page", context, { title: " " }).ok).toBe(false);
  });

  it("refuses an envelope without a title or description, or with nothing found", () => {
    expect(buildCaptureEnvelope(extraction({ posting: { ...extraction().posting!, title: null } }), "page", context)).toEqual({
      ok: false,
      problems: ["Missing or too long: the job title"],
    });
    expect(buildCaptureEnvelope(extraction({ posting: null, extractor: null }), "page", context).ok).toBe(false);
    expect(buildCaptureEnvelope(extraction({ selection: null }), "selection", context).ok).toBe(false);
  });

  it("is strict on the server: page HTML, cookies or unknown fields are refused", () => {
    const built = buildCaptureEnvelope(extraction(), "page", context);
    if (!built.ok) throw new Error("expected a valid envelope");
    expect(() => parseCapture({ ...built.envelope, html: "<html>" })).toThrow();
    expect(() => parseCapture({ ...built.envelope, fields: { ...built.envelope.fields, cookies: "li_at=1" } })).toThrow();
    expect(() => parseCapture({ ...built.envelope, pageUrl: "javascript:alert(1)" })).toThrow();
  });
});

describe("the API client", () => {
  it("accepts only a local http backend", () => {
    expect(normalizeBackendUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBackendUrl("http://127.0.0.1:4100/")).toBe("http://127.0.0.1:4100");
    for (const value of ["https://localhost:3000", "http://example.com:3000", "http://user:pw@localhost:3000", "http://localhost:3000/app", "ftp://localhost", "not a url"]) {
      expect(normalizeBackendUrl(value), value).toBeNull();
    }
  });

  it("calls only /api/extension/* on the backend, with the credential only in the Authorization header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const api = createApiClient({ backendUrl: "http://localhost:3000", credential }, fetcher);
    const envelope = buildCaptureEnvelope(extraction(), "page", context);
    if (!envelope.ok) throw new Error("expected a valid envelope");
    await api.status();
    await api.lookup("https://careers.example.com/jobs/7");
    // A page URL with ".." is still only a query value.
    await api.lookup("https://careers.example.com/a/../jobs/8");
    await api.capture(envelope.envelope);
    await api.requestEvaluation("6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11");
    await api.evaluationStatus("6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11");
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "GET http://localhost:3000/api/extension/status",
      "GET http://localhost:3000/api/extension/lookup?url=https%3A%2F%2Fcareers.example.com%2Fjobs%2F7",
      "GET http://localhost:3000/api/extension/lookup?url=https%3A%2F%2Fcareers.example.com%2Fa%2F..%2Fjobs%2F8",
      "POST http://localhost:3000/api/extension/captures",
      "POST http://localhost:3000/api/extension/opportunities/6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11/evaluation-requests",
      "GET http://localhost:3000/api/extension/opportunities/6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11/evaluation",
    ]);
    for (const call of calls) {
      expect(new URL(call.url).pathname.startsWith(extensionApiPrefix)).toBe(true);
      expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${credential}`);
      expect(call.url).not.toContain(credential);
      expect(String(call.init.body ?? "")).not.toContain(credential);
      expect(call.init).toMatchObject({ credentials: "omit", redirect: "error" });
    }
  });

  it("reports server errors and an unreachable app as messages", async () => {
    const unauthorized = createApiClient({ backendUrl: "http://localhost:3000", credential }, (async () =>
      Response.json({ error: "The pairing is not valid. Pair this browser again.", code: "PAIRING_INVALID" }, { status: 401 })) as unknown as typeof fetch);
    expect(await unauthorized.status()).toMatchObject({ ok: false, status: 401, code: "PAIRING_INVALID" });
    const down = createApiClient({ backendUrl: "http://localhost:3000", credential }, (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    expect(await down.status()).toMatchObject({ ok: false, code: "UNREACHABLE" });
    expect(await createApiClient({ backendUrl: "https://evil.example", credential }).status()).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
  });
});

describe("the extension's settings", () => {
  afterEach(() => vi.restoreAllMocks());

  function fakeArea() {
    const data = new Map<string, unknown>();
    const area = {
      get: vi.fn(async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((key) => data.has(key)).map((key) => [key, data.get(key)]))),
      set: vi.fn(async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, value))),
      remove: vi.fn(async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key))),
      setAccessLevel: vi.fn(async () => undefined),
    };
    return { area, data };
  }

  it("keeps the backend address and credential in the given local area, and never logs the credential", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const { area, data } = fakeArea();
    await restrictStorage(area);
    expect(area.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    expect(await readSettings(area)).toEqual({ backendUrl: "http://localhost:3000", credential: null });
    await saveSettings({ backendUrl: "http://127.0.0.1:3000", credential }, area);
    expect(await readSettings(area)).toEqual({ backendUrl: "http://127.0.0.1:3000", credential });
    await forgetPairing(area);
    expect(data.has("pairingCredential")).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("the popup's messages", () => {
  const capture = {
    outcome: "CREATED" as const,
    decision: "NO_MATCH",
    opportunityId: "o",
    opportunityUrl: "/opportunities/o",
    site: { host: "careers.example.com", name: "careers.example.com", knownHost: false },
    sourceCategory: "AGGREGATOR",
    probableDuplicate: true,
    outsideRoleFamilies: true,
    evaluation: null,
  };

  it("describe the saved outcome, a possible duplicate, the role families and an unrecognised site", () => {
    expect(captureMessage(capture)).toBe(
      "Saved as a new opportunity. It may duplicate an opportunity you already have; review it in AI Job Assistant. " +
        "Its title is outside your Customer Success role families. It came from an unrecognised site, so it is kept as a lower-priority source.",
    );
    expect(captureMessage({ ...capture, outcome: "UNCHANGED", probableDuplicate: false, outsideRoleFamilies: false, site: { ...capture.site, knownHost: true } })).toBe("Already saved. Nothing changed.");
    expect(siteLine({ name: "LinkedIn", knownHost: true })).toBe("LinkedIn");
  });

  it("only reflect the persisted evaluation state and recommendation", () => {
    expect(evaluationLine(null)).toBe("Not evaluated yet.");
    expect(evaluationLine({ queueState: "QUEUED", recommendation: null })).toBe("Evaluation queued.");
    expect(evaluationLine({ queueState: "RUNNING", recommendation: null })).toBe("Evaluation running.");
    expect(evaluationLine({ queueState: "FAILED", recommendation: null })).toBe("The last evaluation failed.");
    expect(evaluationLine({ queueState: "COMPLETED", recommendation: { decision: "STRONG_APPLY" } })).toBe("Evaluation completed. Recommendation: Strong apply.");
    expect(evaluationActive({ queueState: "QUEUED_LONG" })).toBe(true);
    expect(evaluationActive({ queueState: "COMPLETED" })).toBe(false);
  });

  it("word the server's answers to Request evaluation", () => {
    expect(evaluationRequestMessage({ ok: true, status: 202, body: { outcome: "QUEUED" } })).toBe("Evaluation requested and queued.");
    expect(evaluationRequestMessage({ ok: true, status: 200, body: { outcome: "DEFERRED", reason: "BUDGET_EXHAUSTED" } })).toMatch(/budget does not have room.*Nothing was spent/);
    expect(evaluationRequestMessage({ ok: false, status: 409, code: "DUPLICATE_LISTING_ALREADY_EVALUATED", error: "x" })).toMatch(/^Already evaluated/);
    expect(evaluationRequestMessage({ ok: false, status: 503, code: "AI_NOT_CONFIGURED", error: "AI evaluation is not configured" })).toBe("AI evaluation is not configured");
  });
});

describe("the extension package", () => {
  const sources = readdirSync(path.join(extensionRoot, "src")).filter((name) => name.endsWith(".ts"));
  const read = (relative: string) => readFileSync(path.join(extensionRoot, relative), "utf8");

  it("requests exactly the planned permissions and nothing broader", () => {
    const manifest = JSON.parse(read("static/manifest.json"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*", "http://localhost/*"]);
    // Only the minimal service worker that restricts storage (no content
    // scripts, nothing a web page can reach).
    expect(manifest.background).toEqual({ service_worker: "service-worker.js" });
    for (const key of ["content_scripts", "web_accessible_resources", "externally_connectable", "optional_permissions", "optional_host_permissions", "content_security_policy", "key"]) {
      expect(manifest, key).not.toHaveProperty(key);
    }
  });

  it("never inserts HTML, logs, uses storage.sync or embeds a credential", () => {
    for (const name of sources) {
      const source = read(`src/${name}`);
      for (const forbidden of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "storage.sync", "console.", "eval(", "new Function"]) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
      expect(source, name).not.toMatch(/aija_[A-Za-z0-9_-]{43}/);
      expect(source, name).not.toMatch(/sk-[A-Za-z0-9]{10,}|OPENAI_API_KEY/);
    }
  });

  it("has a service worker that only restricts storage to the extension's own pages", () => {
    const source = read("src/service-worker.ts");
    expect(source).toContain("restrictStorage");
    for (const forbidden of ["fetch(", "chrome.scripting", "chrome.tabs", "onMessage", "onConnect", "webRequest", "cookies"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("calls fetch only from its API client and loads no inline or remote scripts", () => {
    for (const name of sources.filter((name) => name !== "api.ts")) expect(read(`src/${name}`), name).not.toMatch(/\bfetch\(/);
    for (const page of ["static/popup.html", "static/options.html"]) {
      const html = read(page);
      expect([...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]), page).toEqual([`<script src="${path.basename(page, ".html")}.js">`]);
      expect(html, page).not.toMatch(/(src|href)="https?:/);
    }
  });
});
