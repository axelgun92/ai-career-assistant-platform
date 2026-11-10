// Feature 14B: the server side of the browser extension companion, with
// fakes: site classification (unrecognized hosts are aggregators), page
// identity (LinkedIn job pages only, canonical LinkedIn URLs, tracking
// parameters removed), the retrieved listing a capture becomes (nothing
// invented), the pairing credential checks, the JSON body limits, and the
// API handlers, including that the evaluation wrappers only authenticate and
// then call the existing handlers.
import { describe, expect, it, vi } from "vitest";
import { cleanCapturedText, extensionCaptureSchemaVersion, type RetrievedListingResult } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { ExtensionPairingRecord } from "@ai-career/database";
import { createExtensionApiHandlers, type ExtensionPairingManager } from "../../apps/web/src/server/extension-api";
import {
  generatePairingCredential,
  hashPairingCredential,
  readJsonBody,
  requirePairing,
  requireSameOrigin,
} from "../../apps/web/src/server/extension-auth";
import {
  capturedListing,
  capturedPageIdentity,
  classifyCaptureSite,
  createExtensionCaptureService,
  parseCapture,
} from "../../apps/web/src/server/extension-capture";

const now = new Date("2026-10-20T09:00:00.000Z");
const pairingId = "1b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e";
const opportunityId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";

const envelope = (overrides: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) => ({
  schemaVersion: extensionCaptureSchemaVersion,
  pageUrl: "https://boards.greenhouse.io/northwind/jobs/123?utm_source=feed&gh_src=abc",
  extractor: "structured-data",
  capturedAt: "2026-10-20T08:59:00.000Z",
  extensionVersion: "0.1.0",
  fields: { title: "Customer Success Manager", description: "Own onboarding and renewals.", company: "Northwind", ...fields },
  ...overrides,
});

describe("capture site classification", () => {
  it.each([
    ["https://boards.greenhouse.io/x/jobs/1", "greenhouse", "ATS"],
    ["https://job-boards.greenhouse.io/x/jobs/1", "greenhouse", "ATS"],
    ["https://jobs.lever.co/x/abc", "lever", "ATS"],
    ["https://jobs.ashbyhq.com/x/abc", "ashby", "ATS"],
    ["https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1", "workday", "ATS"],
    ["https://jobs.smartrecruiters.com/Acme/1", "smartrecruiters", "ATS"],
    ["https://apply.workable.com/acme/j/ABC/", "workable", "ATS"],
    ["https://jobs.workable.com/view/abc", "workable-jobs", "JOB_BOARD"],
    ["https://www.linkedin.com/jobs/view/4100000001", "linkedin", "JOB_BOARD"],
    ["https://www.welcometothejungle.com/fr/companies/x/jobs/y", "welcome-to-the-jungle", "JOB_BOARD"],
    ["https://app.otta.com/jobs/abc", "otta", "JOB_BOARD"],
    ["https://weworkremotely.com/remote-jobs/x", "we-work-remotely", "JOB_BOARD"],
    ["https://remoteok.com/remote-jobs/1", "remote-ok", "JOB_BOARD"],
    ["https://himalayas.app/companies/x/jobs/y", "himalayas", "JOB_BOARD"],
    ["https://www.workingnomads.com/jobs/x", "working-nomads", "JOB_BOARD"],
    ["https://wellfound.com/jobs/1-csm", "wellfound", "MARKETPLACE"],
    ["https://www.adzuna.co.uk/jobs/details/1", "adzuna", "AGGREGATOR"],
  ] as const)("%s is %s (%s)", (url, key, category) => {
    expect(classifyCaptureSite(url)).toMatchObject({ key, category, knownHost: true });
  });

  it("treats any other host as an aggregator, the lowest link precedence, and keeps the real host", () => {
    expect(classifyCaptureSite("https://www.careers.unknown-employer.example/roles/42")).toEqual({
      host: "careers.unknown-employer.example",
      key: "careers.unknown-employer.example",
      name: "careers.unknown-employer.example",
      category: "AGGREGATOR",
      knownHost: false,
    });
    // Lookalike hosts are not the known site.
    expect(classifyCaptureSite("https://linkedin.com.evil.example/jobs/view/1").knownHost).toBe(false);
    expect(classifyCaptureSite("https://notgreenhouse.io/jobs/1").knownHost).toBe(false);
  });
});

describe("captured page identity", () => {
  it("uses LinkedIn's canonical job URL and job ID, from a job view or a jobs page showing one job", () => {
    for (const url of [
      "https://www.linkedin.com/jobs/view/customer-success-manager-at-acme-4100000001/?refId=a&trackingId=b",
      "https://www.linkedin.com/jobs/search/?currentJobId=4100000001&keywords=csm",
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4100000001",
    ]) {
      expect(capturedPageIdentity(url), url).toMatchObject({
        sourceUrl: "https://www.linkedin.com/jobs/view/4100000001",
        externalId: "linkedin:4100000001",
        urlJobId: "4100000001",
      });
    }
  });

  it("refuses any LinkedIn page that is not a job page", () => {
    for (const url of ["https://www.linkedin.com/feed/", "https://www.linkedin.com/in/someone/", "https://www.linkedin.com/messaging/", "https://www.linkedin.com/jobs/"]) {
      expect(() => capturedPageIdentity(url), url).toThrow(expect.objectContaining({ code: "UNSUPPORTED_PAGE" }));
    }
  });

  it("removes tracking parameters, credentials and plain anchors, and keeps identifying parameters", () => {
    expect(capturedPageIdentity("https://user:pw@boards.greenhouse.io/x/jobs/123?utm_source=a&gh_jid=123&gclid=z#apply")).toMatchObject({
      sourceUrl: "https://boards.greenhouse.io/x/jobs/123?gh_jid=123",
      externalId: "greenhouse:boards.greenhouse.io/x/jobs/123?gh_jid=123",
    });
    expect(capturedPageIdentity("https://careers.example.com/#/jobs/9").sourceUrl).toBe("https://careers.example.com/#/jobs/9");
    // A site root identifies no listing.
    expect(capturedPageIdentity("https://careers.example.com/").externalId).toBeNull();
    expect(() => capturedPageIdentity("file:///etc/passwd")).toThrow(expect.objectContaining({ code: "UNSUPPORTED_PAGE" }));
  });
});

describe("the retrieved listing for a capture", () => {
  it("carries browser-extension provenance, the server's category and only the captured fields", () => {
    const { raw } = capturedListing(parseCapture(envelope({ editedFields: ["company"] }, { siteJobId: "REQ-9", salaryCurrency: "usd", salaryMin: 90000, salaryPeriod: "YEAR" })), {
      pairingId,
      domain: "customer-success",
      receivedAt: now,
    });
    expect(raw).toMatchObject({
      source: "browser-extension",
      sourceType: "BROWSER_EXTENSION",
      sourceUrl: "https://boards.greenhouse.io/northwind/jobs/123?gh_src=abc",
      // Only an ID in a known site's URL is the listing identity; the page's
      // own identifier is kept in the capture metadata.
      externalId: "greenhouse:boards.greenhouse.io/northwind/jobs/123?gh_src=abc",
      applicationUrl: null,
      title: "Customer Success Manager",
      company: "Northwind",
      location: null,
      domain: "customer-success",
      discoveredAt: now,
      retrieval: { retrievalType: "BROWSER_ASSISTED", sourceCategory: "ATS", retrievalSourceId: null, retrievalRunId: null },
      sourceMetadata: {
        sourceName: "Greenhouse (browser extension)",
        structured: { salaryCurrency: "USD", salaryMin: 90000, salaryPeriod: "YEAR", workplaceType: null },
        capture: {
          pairingId,
          extractor: "structured-data",
          capturedAt: "2026-10-20T08:59:00.000Z",
          host: "boards.greenhouse.io",
          site: "greenhouse",
          knownHost: true,
          siteJobId: "REQ-9",
          editedFields: ["company"],
          pageUrl: "https://boards.greenhouse.io/northwind/jobs/123?gh_src=abc",
        },
      },
    });
    expect(raw.retrieval?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(raw.rawPayload)).not.toContain("pairing");
  });

  it("accepts only the editable fields, each named once, as user corrections", () => {
    expect(() => parseCapture(envelope({ editedFields: ["title", "title"] }))).toThrow();
    expect(() => parseCapture(envelope({ editedFields: ["applicationUrl"] }))).toThrow();
    expect(parseCapture(envelope()).editedFields).toEqual([]);
  });

  it("gives the same content hash to a repeat capture at another time", () => {
    const first = capturedListing(parseCapture(envelope()), { pairingId, domain: "customer-success", receivedAt: now }).raw;
    const second = capturedListing(parseCapture(envelope({ capturedAt: "2026-10-21T10:00:00.000Z", extensionVersion: "0.2.0" })), {
      pairingId,
      domain: "customer-success",
      receivedAt: new Date("2026-10-21T10:00:00.000Z"),
    }).raw;
    expect(second.retrieval?.contentHash).toBe(first.retrieval?.contentHash);
    expect(second.externalId).toBe(first.externalId);
  });

  it("keeps an unrecognized site as an aggregator with its real host, and invents no application URL", () => {
    const { raw } = capturedListing(parseCapture(envelope({ pageUrl: "https://careers.unknown-employer.example/roles/42", extractor: "main-content" }, { company: null })), {
      pairingId,
      domain: "customer-success",
      receivedAt: now,
    });
    expect(raw).toMatchObject({
      externalId: "careers.unknown-employer.example:careers.unknown-employer.example/roles/42",
      applicationUrl: null,
      company: null,
      retrieval: { sourceCategory: "AGGREGATOR" },
      sourceMetadata: { sourceName: "careers.unknown-employer.example (browser extension)", capture: { knownHost: false, host: "careers.unknown-employer.example" } },
    });
  });

  it("cleans captured text into inert plain text", () => {
    expect(cleanCapturedText("Lead\u0000 renewals‮.\r\n\r\n\r\n\tDrive   adoption ")).toBe("Lead renewals.\n\nDrive adoption");
    expect(() => capturedListing(parseCapture(envelope({}, { title: "\u0000\u0001" })), { pairingId, domain: "customer-success", receivedAt: now })).toThrow(
      expect.objectContaining({ code: "INVALID_CAPTURE" }),
    );
  });
});

describe("the pairing credential", () => {
  it("is random, prefixed and stored only as its SHA-256 hash with a short hint", () => {
    const first = generatePairingCredential();
    const second = generatePairingCredential();
    expect(first.credential).toMatch(/^aija_[A-Za-z0-9_-]{43}$/);
    expect(first.credential).not.toBe(second.credential);
    expect(first.tokenHash).toBe(hashPairingCredential(first.credential));
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHint).toBe(first.credential.slice(-4));
  });

  function storeWith(pairing: Partial<ExtensionPairingRecord> & { credential: string }) {
    const record = {
      id: pairingId,
      label: "Chrome",
      tokenHint: pairing.credential.slice(-4),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      ...pairing,
      tokenHash: hashPairingCredential(pairing.credential),
    };
    return {
      findByHash: vi.fn(async (hash: string) => (hash === record.tokenHash ? record : null)),
      markUsed: vi.fn(async () => undefined),
    };
  }

  const request = (headers: Record<string, string>) => new Request("http://127.0.0.1:3000/api/extension/status", { headers });

  it("authenticates the extension's routes, and records the use", async () => {
    const { credential } = generatePairingCredential();
    const store = storeWith({ credential });
    const result = await requirePairing(request({ authorization: `Bearer ${credential}`, origin: "chrome-extension://abcdefghijklmnop" }), store, () => now);
    expect(result).toMatchObject({ ok: true, pairing: { id: pairingId, label: "Chrome" } });
    expect(result.ok && "tokenHash" in result.pairing).toBe(false);
    expect(store.markUsed).toHaveBeenCalledWith(pairingId, now);
  });

  it.each([
    ["no credential", {}, 401, "PAIRING_REQUIRED"],
    ["a malformed credential", { authorization: "Bearer nope" }, 401, "PAIRING_INVALID"],
    ["a wrong scheme", { authorization: "Basic abc" }, 401, "PAIRING_INVALID"],
    ["an unknown credential", { authorization: `Bearer aija_${"B".repeat(43)}` }, 401, "PAIRING_INVALID"],
  ] as const)("refuses %s", async (_label, headers, status, code) => {
    const store = storeWith({ credential: generatePairingCredential().credential });
    const result = await requirePairing(request(headers), store, () => now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(status);
    expect(await result.response.json()).toMatchObject({ code });
    expect(store.markUsed).not.toHaveBeenCalled();
  });

  it("refuses a revoked pairing like an unknown one, and a web page's request even with a valid credential", async () => {
    const { credential } = generatePairingCredential();
    const revoked = await requirePairing(request({ authorization: `Bearer ${credential}` }), storeWith({ credential, revokedAt: now }), () => now);
    expect(!revoked.ok && revoked.response.status).toBe(401);
    const web = await requirePairing(request({ authorization: `Bearer ${credential}`, origin: "https://evil.example" }), storeWith({ credential }), () => now);
    expect(!web.ok && web.response.status).toBe(403);
    if (!web.ok) expect(await web.response.json()).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
  });

  it("allows pairing management only from the app's own pages, never with a credential", () => {
    const managed = (headers: Record<string, string>) => requireSameOrigin(new Request("http://127.0.0.1:3000/api/extension/pairings", { method: "POST", headers }));
    expect(managed({ "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" })).toBeNull();
    expect(managed({ "sec-fetch-site": "same-origin", host: "127.0.0.1:3000" })).toBeNull();
    for (const headers of [
      {},
      { "sec-fetch-site": "cross-site", origin: "https://evil.example", host: "127.0.0.1:3000" },
      { "sec-fetch-site": "same-origin", origin: "https://evil.example", host: "127.0.0.1:3000" },
      { "sec-fetch-site": "none", origin: "chrome-extension://abc", host: "127.0.0.1:3000" },
      { "sec-fetch-site": "same-origin", host: "127.0.0.1:3000", authorization: `Bearer aija_${"A".repeat(43)}` },
    ]) {
      expect(managed(headers)?.status, JSON.stringify(headers)).toBe(403);
    }
  });
});

describe("JSON request bodies", () => {
  const post = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
    new Request("http://127.0.0.1:3000/api/extension/captures", { method: "POST", body, headers });

  it("are refused when not JSON, malformed or larger than the limit", async () => {
    expect((await readJsonBody(post("{}", { "content-type": "text/plain" }), 100)).ok).toBe(false);
    const wrongType = await readJsonBody(post("{}", { "content-type": "text/plain" }), 100);
    expect(!wrongType.ok && wrongType.response.status).toBe(415);
    const malformed = await readJsonBody(post("{"), 100);
    expect(!malformed.ok && malformed.response.status).toBe(400);
    const declared = await readJsonBody(post("{}", { "content-type": "application/json", "content-length": "5000" }), 100);
    expect(!declared.ok && declared.response.status).toBe(413);
    const streamed = await readJsonBody(post(JSON.stringify({ text: "x".repeat(500) })), 100);
    expect(!streamed.ok && streamed.response.status).toBe(413);
    expect(await readJsonBody(post('{"a":1}', { "content-type": "application/json; charset=utf-8" }), 100)).toEqual({ ok: true, body: { a: 1 } });
  });
});

describe("the extension API handlers", () => {
  function setup() {
    const { credential, tokenHash, tokenHint } = generatePairingCredential();
    const pairings: Array<ExtensionPairingRecord & { tokenHash: string }> = [
      { id: pairingId, label: "Chrome", tokenHash, tokenHint, createdAt: now, lastUsedAt: null, revokedAt: null },
    ];
    const store: ExtensionPairingManager = {
      findByHash: async (hash) => pairings.find((pairing) => pairing.tokenHash === hash) ?? null,
      markUsed: async () => undefined,
      create: async (input) => {
        const record = { id: crypto.randomUUID(), createdAt: now, lastUsedAt: null, revokedAt: null, ...input };
        pairings.push(record);
        return { id: record.id, label: record.label, tokenHint: record.tokenHint, createdAt: now, lastUsedAt: null, revokedAt: null };
      },
      list: async () => pairings.map(({ tokenHash: _hash, ...pairing }) => pairing),
      revoke: async (id, at) => {
        const pairing = pairings.find((item) => item.id === id);
        if (!pairing) return null;
        pairing.revokedAt ??= at;
        return pairing;
      },
    };
    const ingested: RetrievedListingResult = { outcome: "CREATED", opportunityId, sourceRecordId: "s", decision: "NO_MATCH" };
    const ingestion = { ingest: vi.fn(async () => ingested) };
    const latestEvaluation = vi.fn(async () => null);
    const captures = createExtensionCaptureService({
      ingestion,
      lookup: { findCapturedPage: vi.fn(async () => null) },
      latestEvaluation,
      discovery: customerSuccessDiscoveryConfiguration,
      now: () => now,
    });
    const existing = {
      request: vi.fn(async () => Response.json({ outcome: "QUEUED", evaluationId: "e" }, { status: 202, headers: { Location: "/api/opportunities/x/evaluation" } })),
      status: vi.fn(async () => Response.json({ evaluationId: "e", status: "PENDING", queueState: "QUEUED", recommendation: null })),
    };
    const handlers = createExtensionApiHandlers({ pairings: store, captures, evaluation: existing, now: () => now });
    const authorized = (url: string, init: RequestInit = {}) =>
      new Request(`http://127.0.0.1:3000${url}`, { ...init, headers: { authorization: `Bearer ${credential}`, ...(init.headers as Record<string, string>) } });
    const sameOrigin = (url: string, init: RequestInit = {}) =>
      new Request(`http://127.0.0.1:3000${url}`, {
        ...init,
        headers: { "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "content-type": "application/json", ...(init.headers as Record<string, string>) },
      });
    return { handlers, credential, pairings, ingestion, existing, latestEvaluation, authorized, sameOrigin };
  }

  it("saves a capture through retrieval ingestion and never starts an evaluation", async () => {
    const { handlers, authorized, ingestion, existing } = setup();
    const response = await handlers.capture(
      authorized("/api/extension/captures", { method: "POST", body: JSON.stringify(envelope()), headers: { "content-type": "application/json" } }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      outcome: "CREATED",
      opportunityId,
      opportunityUrl: `/opportunities/${opportunityId}`,
      sourceCategory: "ATS",
      site: { name: "Greenhouse", knownHost: true },
      probableDuplicate: false,
      outsideRoleFamilies: false,
      evaluation: null,
    });
    expect(ingestion.ingest).toHaveBeenCalledTimes(1);
    expect(existing.request).not.toHaveBeenCalled();
  });

  it("reports an invalid capture with its issues, and an unsupported LinkedIn page", async () => {
    const { handlers, authorized, ingestion } = setup();
    const invalid = await handlers.capture(
      authorized("/api/extension/captures", { method: "POST", body: JSON.stringify(envelope({ html: "<p>" })), headers: { "content-type": "application/json" } }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_CAPTURE", issues: expect.any(Array) });
    const feed = await handlers.capture(
      authorized("/api/extension/captures", { method: "POST", body: JSON.stringify(envelope({ pageUrl: "https://www.linkedin.com/feed/" })), headers: { "content-type": "application/json" } }),
    );
    expect(feed.status).toBe(422);
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it("evaluation wrappers authenticate and then call only the existing handlers, passing their answer through unchanged", async () => {
    const { handlers, authorized, existing } = setup();
    const requested = await handlers.requestEvaluation(
      authorized(`/api/extension/opportunities/${opportunityId}/evaluation-requests`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
      opportunityId,
    );
    expect(requested.status).toBe(202);
    expect(await requested.json()).toEqual({ outcome: "QUEUED", evaluationId: "e" });
    expect(existing.request).toHaveBeenCalledTimes(1);
    expect(existing.request.mock.calls[0]![1]).toBe(opportunityId);
    const status = await handlers.evaluationStatus(authorized(`/api/extension/opportunities/${opportunityId}/evaluation`), opportunityId);
    expect(await status.json()).toEqual({ evaluationId: "e", status: "PENDING", queueState: "QUEUED", recommendation: null });
    expect(existing.status).toHaveBeenCalledTimes(1);
  });

  it("evaluation wrappers call nothing without a valid pairing, from a web page, or without JSON", async () => {
    const { handlers, existing, authorized } = setup();
    const anonymous = new Request(`http://127.0.0.1:3000/api/extension/opportunities/${opportunityId}/evaluation-requests`, { method: "POST", body: "{}" });
    expect((await handlers.requestEvaluation(anonymous, opportunityId)).status).toBe(401);
    expect((await handlers.evaluationStatus(new Request("http://127.0.0.1:3000/x"), opportunityId)).status).toBe(401);
    const web = authorized(`/api/extension/opportunities/${opportunityId}/evaluation-requests`, { method: "POST", body: "{}", headers: { origin: "https://evil.example", "content-type": "application/json" } });
    expect((await handlers.requestEvaluation(web, opportunityId)).status).toBe(403);
    const notJson = authorized(`/api/extension/opportunities/${opportunityId}/evaluation-requests`, { method: "POST", body: "{}" });
    expect((await handlers.requestEvaluation(notJson, opportunityId)).status).toBe(415);
    expect(existing.request).not.toHaveBeenCalled();
    expect(existing.status).not.toHaveBeenCalled();
  });

  it("creates a pairing whose credential appears only in the creation response, lists and revokes without secrets", async () => {
    const { handlers, sameOrigin, pairings } = setup();
    const created = await handlers.createPairing(sameOrigin("/api/extension/pairings", { method: "POST", body: JSON.stringify({ label: "Work laptop" }) }));
    expect(created.status).toBe(201);
    const body = (await created.json()) as { credential: string; pairing: { id: string; label: string } };
    expect(body.credential).toMatch(/^aija_/);
    expect(pairings.at(-1)!.tokenHash).toBe(hashPairingCredential(body.credential));
    expect(JSON.stringify(pairings)).not.toContain(body.credential);

    const listed = await (await handlers.listPairings(sameOrigin("/api/extension/pairings"))).text();
    expect(listed).not.toContain(body.credential);
    expect(listed).not.toContain("tokenHash");
    expect(listed).toContain("Work laptop");

    const revoked = await handlers.revokePairing(sameOrigin(`/api/extension/pairings/${body.pairing.id}/revoke`, { method: "POST", body: "{}" }), body.pairing.id);
    expect(await revoked.json()).toMatchObject({ pairing: { id: body.pairing.id, revokedAt: now.toISOString() } });
    expect((await handlers.revokePairing(sameOrigin("/api/extension/pairings/x/revoke", { method: "POST" }), "not-a-uuid")).status).toBe(404);
  });

  it("refuses pairing management from the extension and status reports no secret", async () => {
    const { handlers, authorized, credential } = setup();
    const fromExtension = authorized("/api/extension/pairings", { method: "POST", body: "{}", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" } });
    expect((await handlers.createPairing(fromExtension)).status).toBe(403);
    const status = await handlers.status(authorized("/api/extension/status"));
    const text = await status.text();
    expect(JSON.parse(text)).toEqual({ paired: true, pairing: { label: "Chrome", tokenHint: credential.slice(-4) }, captureSchemaVersion: 1 });
    expect(text).not.toContain(credential);
  });
});
