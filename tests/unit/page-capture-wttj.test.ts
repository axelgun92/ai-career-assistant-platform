// Welcome to the Jungle / Otta Mode B with background-tab detail reading
// (P2), offline: the real F0 cards read by the results reader (regression),
// the registry (mechanism, host permissions equal to the manifest's optional
// ones, not offered until verified or explicitly enabled for acceptance), the
// intake for a background-tab site (no server fetch, the jobs listed back in
// order, a stopped site staging nothing to read), the worker never claiming
// the site, the popup's Save asking for the permission inside the click and
// sending nothing when it is declined, the extension routes' pairing
// requirement, Retry refused for these jobs, and the progress page's text.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pageCaptureDetailMechanism, pageCaptureMaxCards, pageCaptureOffer, pageCaptureSiteByKey, pageCaptureSites, pageCaptureTabUrlAllowed } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { ExtensionPairingRecord, PageCaptureItemRecord } from "@ai-career/database";
import { buildPageCaptureBatch, pageCaptureMessage, type PageCaptureResponse } from "../../apps/extension/src/page-capture-view";
import { startTabSave, type TabSaveChrome } from "../../apps/extension/src/tab-messages";
import { createExtensionApiHandlers, type ExtensionPairingManager } from "../../apps/web/src/server/extension-api";
import { generatePairingCredential } from "../../apps/web/src/server/extension-auth";
import { capturedPageIdentity, createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService, enabledSitesFromEnvironment, tabAcquisitionSites } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition } from "../../apps/web/src/server/page-capture-acquisition";
import { handlePageCaptureAction, rowView } from "../../apps/web/src/server/page-capture-progress";
import { createPageCaptureTabService } from "../../apps/web/src/server/page-capture-tabs";
import { runResultsReader } from "../support/page-capture-pages";
import { wttjF0, wttjF0ResultsPage, wttjF0Urls } from "../support/wttj-tab-pages";

const acceptance = { PAGE_CAPTURE_ACCEPTANCE_SITES: "welcome-to-the-jungle" };
const pairing: ExtensionPairingRecord = { id: "1b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e", label: "Chrome", tokenHint: "abcd", createdAt: new Date(), lastUsedAt: null, revokedAt: null };
const now = new Date("2026-11-04T12:00:00.000Z");
const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../apps/extension/static/manifest.json"), "utf8")) as { optional_host_permissions: string[] };
const site = pageCaptureSiteByKey("welcome-to-the-jungle")!;

const expectedCards = [
  { url: wttjF0Urls[0], title: "Customer Success Manager", siteJobId: null, company: "FourKites", location: null, postedText: "October 30, 2026" },
  { url: wttjF0Urls[1], title: "Senior Customer Success Manager (Solutions)", siteJobId: null, company: "CADDi", location: null, postedText: "October 25, 2026" },
  { url: wttjF0Urls[2], title: "Senior Customer Success Manager (Commercial)", siteJobId: null, company: "Culture Amp", location: null, postedText: "October 27, 2026" },
  { url: wttjF0Urls[3], title: "Senior Customer Success Manager - Central", siteJobId: null, company: "Box", location: null, postedText: "November 3, 2026" },
  { url: wttjF0Urls[4], title: "Senior Customer Success Manager", siteJobId: null, company: "MongoDB", location: null, postedText: "July 14, 2026" },
];

function f0Batch(kept = [true, true, true, true, true], batchId = "0f6f1c9c-1d55-4a3b-9b9f-0d2b8a1e4c11") {
  const reading = runResultsReader(wttjF0ResultsPage(), wttjF0.page, "welcome-to-the-jungle");
  const built = buildPageCaptureBatch(reading, kept, { site: "welcome-to-the-jungle", batchId, extensionVersion: "0.2.0", capturedAt: now });
  if (!built.ok) throw new Error(built.problem);
  return built.batch;
}

const staged = (count: number, status: "QUEUED" | "AWAITING_DETAILS" | "ALREADY_SAVED" = "QUEUED") =>
  vi.fn(async (input: { cards: Array<{ externalId: string }> }) =>
    input.cards.slice(0, count).map((card, index) => ({ externalId: card.externalId, outcome: "QUEUED" as const, opportunityId: null, itemId: `item-${index}`, status })),
  );

describe("Welcome to the Jungle Mode B on the real F0 cards", () => {
  it("reads the five real cards exactly (title, company, posted date) without scrolling, clicking or requests", () => {
    expect(wttjF0.cards).toHaveLength(5);
    const reading = runResultsReader(wttjF0ResultsPage(), wttjF0.page, "welcome-to-the-jungle");
    expect(reading.problem).toBeNull();
    expect(reading.counts).toEqual({ loaded: 5, skippedUnloaded: 0, overCap: 0 });
    expect(reading.cards).toEqual(expectedCards);
    // The desktop and narrow-layout links collapse into one card; the
    // company tagline and tags are never taken as fields.
    expect(JSON.stringify(reading.cards)).not.toMatch(/orchestration|Permanent|employees|Remote:/);
    expect(reading.calls).toEqual([]);
    for (const card of reading.cards) expect(capturedPageIdentity(card.url).externalId).toMatch(/^welcome-to-the-jungle:welcometothejungle\.com\/en\/companies\/[^/]+\/jobs\/[^/]+$/);
  });

  it("is offered on the F0 page, the search page and a company's jobs page only when the site is enabled", () => {
    const pages = [wttjF0.page, "https://www.welcometothejungle.com/en/jobs?query=customer%20success", "https://www.welcometothejungle.com/en/companies/box/jobs"];
    for (const url of pages) expect(pageCaptureOffer(url, enabledSitesFromEnvironment({}).cards), url).toMatchObject({ offered: false, reason: "NOT_VERIFIED" });
    const enabled = enabledSitesFromEnvironment(acceptance);
    for (const url of pages) expect(pageCaptureOffer(url, enabled.cards), url).toMatchObject({ offered: true });
    expect(pageCaptureOffer(wttjF0Urls[0], enabled.cards)).toMatchObject({ offered: false, reason: "NOT_RESULTS_PAGE" });
    expect(pageCaptureOffer("https://www.welcometothejungle.com/en/me/settings", enabled.cards)).toMatchObject({ offered: false, reason: "EXCLUDED_PAGE" });
  });
});

describe("the registry for background-tab reading", () => {
  it("keeps LinkedIn on the worker's server browser, unchanged, and reads Welcome to the Jungle in background tabs", () => {
    expect(pageCaptureDetailMechanism(pageCaptureSiteByKey("linkedin")!)).toBe("server-browser");
    expect(pageCaptureSiteByKey("linkedin")!.detail).toEqual({ minIntervalMs: 5_000, authCookieNames: ["li_at"] });
    expect(pageCaptureSiteByKey("linkedin")).not.toHaveProperty("tabAcquisition");
    expect(pageCaptureDetailMechanism(pageCaptureSiteByKey("e2e-results")!)).toBe("server-browser");
    expect(pageCaptureDetailMechanism(site)).toBe("extension-tabs");
    expect(site).toMatchObject({ cardVerified: false, detailVerified: false, detail: { minIntervalMs: 12_000 } });
    expect(site.tabAcquisition).toEqual({
      hostPermissions: ["https://www.welcometothejungle.com/*", "https://app.welcometothejungle.com/*"],
      loadTimeoutMs: 30_000,
      rereadDelaysMs: [2_000, 5_000, 10_000],
    });
    expect(pageCaptureMaxCards).toBe(25);
  });

  it("asks for exactly the manifest's optional host permissions", () => {
    const requested = pageCaptureSites.flatMap((candidate) => candidate.tabAcquisition?.hostPermissions ?? []);
    expect(requested).toEqual(manifest.optional_host_permissions);
  });

  it("enables an unverified site only by the explicit acceptance setting, never the test site", () => {
    expect(enabledSitesFromEnvironment({})).toEqual({ cards: ["linkedin"], details: ["linkedin"] });
    expect(enabledSitesFromEnvironment(acceptance)).toEqual({ cards: ["linkedin", "welcome-to-the-jungle"], details: ["linkedin", "welcome-to-the-jungle"] });
    expect(enabledSitesFromEnvironment({ PAGE_CAPTURE_ACCEPTANCE_SITES: "e2e-results, unknown" })).toEqual({ cards: ["linkedin"], details: ["linkedin"] });
    expect(tabAcquisitionSites(enabledSitesFromEnvironment(acceptance).details)).toEqual(["welcome-to-the-jungle"]);
  });

  it("opens only https job pages on the permitted hosts", () => {
    expect(pageCaptureTabUrlAllowed(site, wttjF0Urls[0])).toBe(true);
    expect(pageCaptureTabUrlAllowed(site, "https://app.welcometothejungle.com/jobs/AbCdEf34")).toBe(true);
    for (const url of ["http://www.welcometothejungle.com/en/jobs", "https://app.otta.com/jobs/abc", "https://welcometothejungle.com.example/x", "https://www.welcometothejungle.com:8443/x"]) {
      expect(pageCaptureTabUrlAllowed(site, url), url).toBe(false);
    }
    expect(pageCaptureTabUrlAllowed(pageCaptureSiteByKey("linkedin")!, "https://www.linkedin.com/jobs/view/1")).toBe(false);
  });
});

describe("intake for a background-tab site", () => {
  const service = (stageBatch: ReturnType<typeof staged>, stoppedUntil: Date | null = null) => {
    const repository = { stageBatch, siteStoppedUntil: vi.fn(async () => stoppedUntil), expireTabItems: vi.fn(async () => 0) };
    return { repository, intake: createPageCaptureService({ repository: repository as never, enabledSites: () => enabledSitesFromEnvironment(acceptance), now: () => now }) };
  };

  it("stages the batch for the extension and lists the jobs back in page order, with the site's pacing", async () => {
    const stageBatch = staged(5);
    const { repository, intake } = service(stageBatch);
    const result = await intake.capture(f0Batch(), pairing);
    expect(result).toMatchObject({ site: { key: "welcome-to-the-jungle", automaticDetails: true }, counts: { queued: 5, rejected: 0 } });
    expect(result.acquisition).toEqual({
      mechanism: "extension-tabs",
      items: wttjF0Urls.map((url, index) => ({ itemId: `item-${index}`, url })),
      minIntervalMs: 12_000,
      loadTimeoutMs: 30_000,
      rereadDelaysMs: [2_000, 5_000, 10_000],
      stoppedUntil: null,
    });
    expect(stageBatch.mock.calls[0]![0]).toMatchObject({ site: "welcome-to-the-jungle", detailsAvailable: true, requeueAwaiting: true });
    // Staging only: the card's own text is kept for display, the job's facts come from its page later.
    expect(repository.expireTabItems).toHaveBeenCalledWith(["welcome-to-the-jungle"], new Date(now.getTime() - 60 * 60 * 1000));
    expect(pageCaptureMessage(result as PageCaptureResponse)).toBe("5 queued; their details are read one at a time in background tabs, at least 12 seconds apart. You can keep browsing.");
  });

  it("lists back only the jobs left queued (not those already in AI Job Assistant)", async () => {
    const stageBatch = vi.fn(async (input: { cards: Array<{ externalId: string }> }) =>
      input.cards.map((card, index) => ({ externalId: card.externalId, outcome: index === 1 ? ("ALREADY_SAVED" as const) : ("QUEUED" as const), opportunityId: null, itemId: `item-${index}`, status: index === 1 ? ("ALREADY_SAVED" as const) : ("QUEUED" as const) })),
    );
    const result = await service(stageBatch).intake.capture(f0Batch(), pairing);
    expect(result.acquisition!.items.map((item) => item.itemId)).toEqual(["item-0", "item-2", "item-3", "item-4"]);
  });

  it("while the site is stopped, keeps the jobs awaiting details and lists nothing to read", async () => {
    const stoppedUntil = new Date(now.getTime() + 20 * 60 * 60 * 1000);
    const stageBatch = staged(5, "AWAITING_DETAILS");
    const result = await service(stageBatch, stoppedUntil).intake.capture(f0Batch(), pairing);
    expect(stageBatch.mock.calls[0]![0]).toMatchObject({ detailsAvailable: false, awaitingReason: "ACCESS_STOPPED" });
    expect(result.acquisition).toMatchObject({ items: [], stoppedUntil: stoppedUntil.toISOString() });
    expect(pageCaptureMessage(result as PageCaptureResponse)).toMatch(/restricted access earlier, so no job page is opened before/);
  });

  it("rejects a card whose link is on a host the extension may not open", async () => {
    const batch = f0Batch();
    batch.cards[0] = { ...batch.cards[0]!, url: "https://app.otta.com/jobs/AbCdEf34" };
    const stageBatch = staged(4);
    const result = await service(stageBatch).intake.capture(batch, pairing);
    expect(result.outcomes.find((outcome) => outcome.outcome === "REJECTED")).toMatchObject({ reason: "The link is not on a Welcome to the Jungle / Otta address the extension may read" });
    expect(stageBatch.mock.calls[0]![0].cards).toHaveLength(4);
  });

  it("is not offered and stages nothing by default (the site is not verified yet)", async () => {
    const stageBatch = staged(5);
    const intake = createPageCaptureService({ repository: { stageBatch } as never, enabledSites: () => enabledSitesFromEnvironment({}) });
    await expect(intake.capture(f0Batch(), pairing)).rejects.toMatchObject({ code: "UNSUPPORTED_PAGE" });
    expect(stageBatch).not.toHaveBeenCalled();
  });
});

describe("the retrieval worker", () => {
  it("never claims or fetches a background-tab site, even when it is enabled", async () => {
    const repository = {
      recoverInterrupted: vi.fn(async () => 0),
      sitesWithQueued: vi.fn(async () => ["welcome-to-the-jungle"]),
      siteStoppedUntil: vi.fn(async () => null),
      claimQueued: vi.fn(async () => []),
      markIngested: vi.fn(),
      markFailed: vi.fn(),
      deferSite: vi.fn(),
      markHandedOff: vi.fn(),
    };
    const launch = vi.fn();
    const acquisition = createPageCaptureAcquisition({
      repository,
      ingestion: { ingest: vi.fn() },
      handoff: { alreadyHandled: vi.fn(), request: vi.fn() },
      discovery: customerSuccessDiscoveryConfiguration,
      detailSites: () => enabledSitesFromEnvironment(acceptance).details,
      browser: { launch },
    });
    expect(await acquisition.runOnce()).toBeNull();
    expect(repository.claimQueued).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("the popup's Save on a background-tab site", () => {
  const fakeChrome = (granted: boolean | "throws") => {
    const order: string[] = [];
    const chromeApi: TabSaveChrome = {
      keepPending: () => void order.push("keepPending"),
      dropPending: async () => void order.push("dropPending"),
      requestPermission: (origins) => {
        order.push(`request:${origins.join(",")}`);
        return granted === "throws" ? Promise.reject(new Error("no gesture")) : Promise.resolve(granted);
      },
      send: async (message) => {
        order.push(`send:${message.type}`);
        return { ok: true, status: 200, body: { counts: { queued: 5 } } } as never;
      },
    };
    return { order, chromeApi };
  };
  const input = () => ({ batch: f0Batch(), site: "welcome-to-the-jungle", hostPermissions: site.tabAcquisition!.hostPermissions, now: now.getTime() });

  it("asks for the site's permission synchronously, inside the click, before anything is awaited", () => {
    const { order, chromeApi } = fakeChrome(true);
    void startTabSave(input(), chromeApi);
    // Nothing awaited yet: the request has already been made.
    expect(order).toEqual(["keepPending", `request:${site.tabAcquisition!.hostPermissions.join(",")}`]);
  });

  it("sends the batch through the service worker when granted (no second action)", async () => {
    const { order, chromeApi } = fakeChrome(true);
    const outcome = await startTabSave(input(), chromeApi);
    expect(outcome).toMatchObject({ granted: true, reply: { ok: true } });
    expect(order.at(-1)).toBe("send:page-capture:save");
  });

  for (const answer of [false, "throws"] as const) {
    it(`sends nothing and drops the kept batch when the permission is ${answer === false ? "declined" : "unavailable"}`, async () => {
      const { order, chromeApi } = fakeChrome(answer);
      expect(await startTabSave(input(), chromeApi)).toEqual({ granted: false });
      expect(order).not.toContain("send:page-capture:save");
      expect(order.at(-1)).toBe("dropPending");
    });
  }
});

describe("the background-tab report routes", () => {
  it("require the pairing credential and refuse invalid reports and non-tab jobs", async () => {
    const { credential, tokenHash, tokenHint } = generatePairingCredential();
    const store: ExtensionPairingManager = {
      findByHash: async (hash) => (hash === tokenHash ? { ...pairing, tokenHint, tokenHash } : null),
      markUsed: async () => undefined,
      create: async () => pairing,
      list: async () => [pairing],
      revoke: async () => pairing,
    };
    const tabItem = { id: "00000000-0000-4000-8000-000000000001", site: "welcome-to-the-jungle", status: "QUEUED", sourceUrl: wttjF0Urls[0] } as PageCaptureItemRecord;
    const linkedInItem = { ...tabItem, id: "00000000-0000-4000-8000-000000000002", site: "linkedin" } as PageCaptureItemRecord;
    const repository = {
      findById: vi.fn(async (id: string) => [tabItem, linkedInItem].find((candidate) => candidate.id === id) ?? null),
      startTabItem: vi.fn(async () => tabItem),
      settleTabItem: vi.fn(async () => true),
      stopTabItems: vi.fn(async () => 0),
      stopTabSite: vi.fn(async () => 0),
      siteStoppedUntil: vi.fn(async () => null),
    };
    const handlers = createExtensionApiHandlers({
      pairings: store,
      captures: createExtensionCaptureService({ ingestion: { ingest: vi.fn() }, lookup: { findCapturedPage: vi.fn(async () => null) }, latestEvaluation: vi.fn(async () => null), discovery: customerSuccessDiscoveryConfiguration }),
      pageCaptureTabs: createPageCaptureTabService({ repository, ingestor: { ingest: vi.fn() }, enabledSites: () => enabledSitesFromEnvironment(acceptance) }),
      evaluation: { request: vi.fn(), status: vi.fn() },
    });
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      new Request("http://127.0.0.1:3000/api/extension/page-captures/items/x/start", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
    const auth = { authorization: `Bearer ${credential}` };
    expect((await handlers.pageCaptureTabStart(post({}), tabItem.id)).status).toBe(401);
    expect((await handlers.pageCaptureTabResult(post({ result: "BLOCKED" }), tabItem.id)).status).toBe(401);
    expect(repository.findById).not.toHaveBeenCalled();
    const started = await handlers.pageCaptureTabStart(post({}, auth), tabItem.id);
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ proceed: true, itemId: tabItem.id, url: wttjF0Urls[0] });
    expect((await handlers.pageCaptureTabStart(post({}, auth), linkedInItem.id)).status).toBe(422);
    expect((await handlers.pageCaptureTabStart(post({}, auth), "not-a-uuid")).status).toBe(404);
    expect((await handlers.pageCaptureTabResult(post({ result: "EXPLODED" }, auth), tabItem.id)).status).toBe(400);
    expect((await handlers.pageCaptureTabDetails(post({ capture: { nope: true }, remainingItemIds: [] }, auth), tabItem.id)).status).toBe(400);
    expect((await handlers.pageCaptureTabStop(post({ site: "linkedin", itemIds: [tabItem.id], reason: "USER_STOPPED" }, auth))).status).toBe(422);
    expect(repository.settleTabItem).not.toHaveBeenCalled();
  });
});

describe("the progress page for background-tab jobs", () => {
  const sameOrigin = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
  const action = (body: unknown) => new Request("http://127.0.0.1:3000/api/page-captures/x", { method: "POST", body: JSON.stringify(body), headers: sameOrigin });
  const id = "00000000-0000-4000-8000-000000000003";

  it("refuses Retry for a background-tab job (it is read again by saving the results page again) and keeps Dismiss", async () => {
    const repository = {
      findById: vi.fn(async () => ({ id, site: "welcome-to-the-jungle", status: "AWAITING_DETAILS" })),
      retry: vi.fn(),
      dismiss: vi.fn(async () => ({ id, status: "DISMISSED" })),
      restore: vi.fn(),
    };
    const refused = await handlePageCaptureAction(action({ action: "retry" }), id, repository as never);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "Save the results page that shows this job again to read its details" });
    expect(repository.retry).not.toHaveBeenCalled();
    expect((await handlePageCaptureAction(action({ action: "dismiss" }), id, repository as never)).status).toBe(200);
  });

  it("marks background-tab rows as not retryable and LinkedIn rows as retryable", () => {
    const row = (siteKey: string) => rowView({ id, site: siteKey, firstSeenAt: now, status: "AWAITING_DETAILS" } as never);
    expect(row("welcome-to-the-jungle").retryable).toBe(false);
    expect(row("linkedin").retryable).toBe(true);
  });
});
