// LinkedIn Option A (approved November 8, 2026): the worker reads LinkedIn
// job pages with JavaScript off and only the job page's own document
// requested. Offline, with fakes for the repository, browser and ingestion:
// - the setting: LinkedIn "skip" by default, PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS
//   =run restores script-enabled reading, an invalid value keeps the default
//   and is reported; Welcome to the Jungle (the user's own Chrome, background
//   tabs) and the test site are never affected;
// - the browser is launched with the site's mode, and every read records its
//   request counts (job.read, job.navigate.failed, page evidence, pass totals);
// - an incomplete scriptless page is never saved as a full read: a lone one
//   is that job's failed attempt (INCOMPLETE_PAGE), two in a row are the
//   site's (nothing counted, every queued job waits an hour, the operator is
//   told how to restore script-enabled reading);
// - with scripts on, the same short page is read exactly as before.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageCaptureDetailPageScripts, pageCapturePageScriptsSettingName, pageCaptureScriptlessMinDescriptionChars, pageCaptureSiteByKey, type PageCapturePageScripts } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { PageCaptureItemRecord } from "@ai-career/database";
import type { BrowserDriver, BrowserRequestCounts } from "@ai-career/discovery";
import { statusText, type PageCaptureRowView } from "../../apps/web/src/components/extension/page-capture-labels";
import { retrievalSummary } from "../../apps/web/src/server/diagnostics-package";
import { createPageCaptureAcquisition, readJobPage, scriptlessPageIncomplete } from "../../apps/web/src/server/page-capture-acquisition";
import { createPageCaptureEvidence } from "../../apps/web/src/server/page-capture-evidence";
import { createWorkerDiagnostics } from "../../apps/web/src/server/worker-diagnostics";
import { JSDOM } from "jsdom";
import { linkedInGuestJobPage } from "../support/linkedin-guest-pages";
import { testSiteJobPage } from "../support/page-capture-pages";

const now = new Date("2026-11-08T15:00:00.000Z");
const folders: string[] = [];
const temporary = () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "aija-scriptless-test-"));
  folders.push(folder);
  return folder;
};
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const longDescription =
  "<p>Customer Success Manager for a SaaS platform; own onboarding, adoption and renewals for a portfolio of mid-market customers.</p>" +
  "<p>You will run business reviews, lead adoption plans with each customer's stakeholders, partner with Sales on expansion, and turn product feedback into clear requests.</p>";
const complete = (id: string) => linkedInGuestJobPage({ id, title: "Customer Success Manager", company: `Company ${id}`, location: "United States", descriptionHtml: longDescription });
// What a page that needed its scripts looks like without them: the top card,
// but the description area holds only a teaser (or nothing).
const teaser = (id: string) => linkedInGuestJobPage({ id, title: "Customer Success Manager", company: `Company ${id}`, location: "United States", descriptionHtml: "<p>Loading…</p>" });
const shell = () => "<!doctype html><html><head><title>LinkedIn</title></head><body><noscript>Please enable JavaScript.</noscript><main></main></body></html>";
const counts = (pageScripts: PageCapturePageScripts): BrowserRequestCounts =>
  pageScripts === "skip"
    ? { pageScripts, documentRequests: 1, redirects: 0, sentRequests: 1, blockedRequests: 3, blockedByType: { stylesheet: 1, image: 2 } }
    : { pageScripts, documentRequests: 1, redirects: 0, sentRequests: 9, blockedRequests: 2, blockedByType: { image: 2 } };

const item = (id: string, site: "linkedin" | "e2e-results", overrides: Partial<PageCaptureItemRecord> = {}): PageCaptureItemRecord => ({
  id,
  site,
  host: site === "linkedin" ? "www.linkedin.com" : "jobs.e2e.invalid",
  externalId: `${site}:${id}`,
  sourceUrl: site === "linkedin" ? `https://www.linkedin.com/jobs/view/${id}` : `https://jobs.e2e.invalid/jobs/${id}`,
  siteJobId: id,
  title: `Customer Success Manager ${id}`,
  company: null,
  location: null,
  postedText: null,
  resultsPageUrl: "https://www.linkedin.com/jobs/search",
  firstSeenAt: now,
  lastSeenAt: now,
  sightings: 1,
  lastBatchId: "33333333-3333-4333-8333-333333333333",
  pairingId: "p",
  status: "QUEUED",
  attempts: 0,
  lastAttemptAt: null,
  nextAttemptAt: null,
  lastReason: null,
  opportunityId: null,
  handoffOutcome: null,
  handedOffAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

function setup(input: {
  site: "linkedin" | "e2e-results";
  ids: string[];
  serve: (id: string) => { status: number; html: string };
  pageScripts?: (siteKey: string) => { mode: PageCapturePageScripts; source: "registry" | "setting" | "invalid-setting" };
  rows?: Map<string, PageCaptureItemRecord>;
  evidence?: boolean;
}) {
  const rows = input.rows ?? new Map(input.ids.map((id) => [id, item(id, input.site)]));
  const due = (row: PageCaptureItemRecord) => row.status === "QUEUED" && (!row.nextAttemptAt || row.nextAttemptAt <= now);
  const deferred: Array<{ site: string; until: Date; reason: string }> = [];
  const repository = {
    recoverInterrupted: vi.fn(async () => 0),
    sitesWithQueued: vi.fn(async () => ([...rows.values()].some(due) ? [input.site] : [])),
    siteStoppedUntil: vi.fn(async () => null),
    claimQueued: vi.fn(async () => {
      const claimed = [...rows.values()].filter(due);
      for (const row of claimed) row.status = "ACQUIRING";
      return claimed.map((row) => ({ ...row }));
    }),
    markIngested: vi.fn(async (id: string, opportunityId: string) => {
      Object.assign(rows.get(id)!, { status: "INGESTED", opportunityId, lastReason: null, nextAttemptAt: null });
    }),
    markFailed: vi.fn(async (id: string, change: { status: PageCaptureItemRecord["status"]; reason: string; nextAttemptAt: Date | null; countAttempt: boolean }) => {
      const row = rows.get(id)!;
      Object.assign(row, { status: change.status, lastReason: change.reason, nextAttemptAt: change.nextAttemptAt, attempts: row.attempts + (change.countAttempt ? 1 : 0) });
    }),
    // As the repository does for a deferral that is no restriction: every
    // queued or claimed job of the site waits, uncounted, with the reason.
    deferSite: vi.fn(async (site: string, until: Date, reason: string) => {
      deferred.push({ site, until, reason });
      for (const row of rows.values()) if (row.status === "QUEUED" || row.status === "ACQUIRING") Object.assign(row, { status: "QUEUED", nextAttemptAt: until, lastReason: reason });
    }),
    markHandedOff: vi.fn(async (id: string, outcome: string) => {
      rows.get(id)!.handoffOutcome = outcome;
    }),
    requeueUncounted: vi.fn(async () => true),
    releaseClaimed: vi.fn(async (ids: string[]) => {
      let count = 0;
      for (const id of ids) if (rows.get(id)?.status === "ACQUIRING") (rows.get(id)!.status = "QUEUED"), (count += 1);
      return count;
    }),
    finalizeProvisionalFailure: vi.fn(async () => false),
  };
  let opportunities = 0;
  const ingest = vi.fn(async () => {
    opportunities += 1;
    return { outcome: "CREATED" as const, opportunityId: `0000${String(opportunities).padStart(4, "0")}-0000-4000-8000-000000000000`, sourceRecordId: "s", decision: "NO_MATCH" as const };
  });
  const navigated: string[] = [];
  const launches: Array<{ pageScripts?: PageCapturePageScripts } | undefined> = [];
  let mode: PageCapturePageScripts = "run";
  const driver: BrowserDriver = {
    async navigate(url) {
      navigated.push(url);
      const id = url.split("/").pop()!;
      const served = input.serve(id);
      return { status: served.status, finalUrl: url, html: served.html, cookieNames: [], requests: counts(mode) };
    },
    close: vi.fn(async () => undefined),
  };
  const diagnostics = createWorkerDiagnostics({ directory: temporary(), sessionId: "44444444-4444-4444-8444-444444444444", now: () => now });
  const evidence = input.evidence ? createPageCaptureEvidence({ directory: temporary(), sessionId: diagnostics.sessionId, now: () => now }) : undefined;
  const log = { info: vi.fn(), warn: vi.fn() };
  const acquisition = createPageCaptureAcquisition({
    repository,
    ingestion: { ingest } as never,
    handoff: { alreadyHandled: vi.fn(async () => false), request: vi.fn(async () => "NO_ACTIVE_PROFILE") },
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => [input.site],
    browser: {
      launch: async (options) => {
        launches.push(options);
        mode = options?.pageScripts ?? "run";
        return driver;
      },
    },
    ...(input.pageScripts ? { pageScripts: input.pageScripts } : {}),
    probeCapture: async () => undefined,
    now: () => now,
    sleep: async () => undefined,
    log,
    diagnostics,
    ...(evidence ? { evidence } : {}),
  });
  const events = () =>
    readFileSync(diagnostics.file!, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown> & { event: string });
  return { acquisition, rows, ingest, navigated, launches, deferred, repository, events, log, evidence };
}

describe("the page-scripts setting", () => {
  const linkedin = pageCaptureSiteByKey("linkedin")!;
  const wttj = pageCaptureSiteByKey("welcome-to-the-jungle")!;
  const testSite = pageCaptureSiteByKey("e2e-results")!;

  it("LinkedIn skips page scripts by default; the server setting restores them, or keeps them off; anything else keeps the default and is reported", () => {
    expect(pageCapturePageScriptsSettingName("linkedin")).toBe("PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS");
    expect(pageCaptureDetailPageScripts(linkedin)).toEqual({ mode: "skip", source: "registry" });
    expect(pageCaptureDetailPageScripts(linkedin, { PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS: "run" })).toEqual({ mode: "run", source: "setting" });
    expect(pageCaptureDetailPageScripts(linkedin, { PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS: " SKIP " })).toEqual({ mode: "skip", source: "setting" });
    expect(pageCaptureDetailPageScripts(linkedin, { PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS: "off" })).toEqual({ mode: "skip", source: "invalid-setting" });
    expect(pageCaptureDetailPageScripts(linkedin, { PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS: "" })).toEqual({ mode: "skip", source: "registry" });
  });

  it("Welcome to the Jungle (read in the user's own Chrome) and the test site are never affected", () => {
    expect(pageCaptureDetailPageScripts(wttj, { PAGE_CAPTURE_WELCOME_TO_THE_JUNGLE_PAGE_SCRIPTS: "skip" })).toEqual({ mode: "run", source: "registry" });
    expect(wttj.detail).toEqual({ minIntervalMs: 12_000, authCookieNames: [], pageScripts: "run" });
    expect(pageCaptureDetailPageScripts(testSite)).toEqual({ mode: "run", source: "registry" });
  });
});

describe("the LinkedIn pass without page scripts", () => {
  it("launches the browser with scripts off, and records each read's requests and the pass totals", async () => {
    const run = setup({ site: "linkedin", ids: ["4400000001", "4400000002"], serve: (id) => ({ status: 200, html: complete(id) }), evidence: true });
    const result = await run.acquisition.runOnce();
    expect(run.launches).toEqual([{ pageScripts: "skip" }]);
    expect(result).toMatchObject({
      ingested: 2,
      incomplete: 0,
      stopped: null,
      pageScripts: "skip",
      requests: { pages: 2, documentRequests: 2, sentRequests: 2, blockedRequests: 6 },
    });
    const events = run.events();
    expect(events.find((event) => event.event === "pass.start")).toMatchObject({ pageScripts: "skip", pageScriptsSource: "registry" });
    expect(events.filter((event) => event.event === "job.read")).toEqual([
      expect.objectContaining({ pageScripts: "skip", incomplete: null, requests: counts("skip") }),
      expect.objectContaining({ pageScripts: "skip", incomplete: null, requests: counts("skip") }),
    ]);
    expect(events.at(-1)).toMatchObject({ event: "pass.end", requests: { pages: 2, documentRequests: 2, sentRequests: 2 } });
    const summary = JSON.parse(readFileSync(path.join(run.evidence!.directory!, "4400000001.json"), "utf8"));
    expect(summary).toMatchObject({ outcome: "READ", pageScripts: "skip", requests: { sentRequests: 1 } });
  });

  it("the restored setting launches with scripts on and reads as before", async () => {
    const run = setup({ site: "linkedin", ids: ["4400000003"], serve: (id) => ({ status: 200, html: teaser(id) }), pageScripts: () => ({ mode: "run", source: "setting" }) });
    const result = await run.acquisition.runOnce();
    expect(run.launches).toEqual([{ pageScripts: "run" }]);
    // No completeness check with scripts on: the short page is read as today.
    expect(result).toMatchObject({ ingested: 1, incomplete: 0, pageScripts: "run", requests: { sentRequests: 9 } });
  });

  it("an invalid setting keeps scripts off and warns once", async () => {
    const run = setup({ site: "linkedin", ids: ["4400000004"], serve: (id) => ({ status: 200, html: complete(id) }), pageScripts: () => ({ mode: "skip", source: "invalid-setting" }) });
    await run.acquisition.runOnce();
    expect(run.launches).toEqual([{ pageScripts: "skip" }]);
    expect(run.log.warn).toHaveBeenCalledWith(expect.stringContaining('page-scripts setting is not "run" or "skip"'));
  });

  it("the test site's pass is unchanged (scripts on)", async () => {
    const run = setup({ site: "e2e-results", ids: ["evaluate"], serve: (id) => ({ status: 200, html: testSiteJobPage({ id }) }) });
    expect(await run.acquisition.runOnce()).toMatchObject({ ingested: 1, pageScripts: "run" });
    expect(run.launches).toEqual([{ pageScripts: "run" }]);
  });

  it("a stop records the requests it made (HTTP 429)", async () => {
    const run = setup({ site: "linkedin", ids: ["4400000005", "4400000006"], serve: (id) => (id === "4400000005" ? { status: 429, html: "<html><body>slow down</body></html>" } : { status: 200, html: complete(id) }) });
    const result = await run.acquisition.runOnce();
    expect(result).toMatchObject({ stopped: "RATE_LIMITED", ingested: 0, requests: { pages: 1, documentRequests: 1, sentRequests: 1 } });
    expect(run.navigated).toHaveLength(1);
    expect(run.events().find((event) => event.event === "job.navigate.failed")).toMatchObject({ code: "RATE_LIMITED", status: 429, pageScripts: "skip", requests: counts("skip") });
  });
});

describe("an incomplete scriptless page is never saved as a full read", () => {
  it("the check: a posting with a title and a description of at least the minimum", () => {
    const read = (html: string) => readJobPage(new JSDOM(html, { url: "https://www.linkedin.com/jobs/view/4400000010", runScripts: "outside-only" }).window.document);
    expect(pageCaptureScriptlessMinDescriptionChars).toBe(200);
    expect(scriptlessPageIncomplete(read(complete("4400000010")))).toBeNull();
    expect(scriptlessPageIncomplete(read(teaser("4400000010")))).toBe("SHORT_DESCRIPTION");
    expect(scriptlessPageIncomplete(read(shell()))).toBe("NO_POSTING");
    expect(scriptlessPageIncomplete(null)).toBe("NO_POSTING");
  });

  it("a lone incomplete page followed by a complete one is that job's failed attempt; the rest are saved", async () => {
    const ids = ["4400000011", "4400000012", "4400000013"];
    const run = setup({ site: "linkedin", ids, serve: (id) => ({ status: 200, html: id === ids[0] ? teaser(id) : complete(id) }) });
    const result = await run.acquisition.runOnce();
    expect(result).toMatchObject({ ingested: 2, incomplete: 1, awaitingDetails: 0, stopped: null });
    expect(run.ingest).toHaveBeenCalledTimes(2);
    expect(run.rows.get(ids[0]!)).toMatchObject({ status: "QUEUED", attempts: 1, lastReason: "INCOMPLETE_PAGE", nextAttemptAt: new Date(now.getTime() + 3_600_000) });
    const decisions = run.events().filter((event) => event.event === "job.decision").map((event) => [event.listingId, event.decision, event.reason]);
    expect(decisions).toEqual([
      [ids[0], "INCOMPLETE_PAGE_HELD", "SHORT_DESCRIPTION"],
      [ids[0], "ATTEMPT_COUNTED", "INCOMPLETE_PAGE"],
    ]);
    const read = run.events().find((event) => event.event === "job.read" && event.listingId === ids[0]);
    expect(read).toMatchObject({ incomplete: "SHORT_DESCRIPTION", pageScripts: "skip" });
  });

  it("a lone incomplete page at the end of the pass is that job's failed attempt too", async () => {
    const ids = ["4400000014", "4400000015"];
    const run = setup({ site: "linkedin", ids, serve: (id) => ({ status: 200, html: id === ids[1] ? shell() : complete(id) }) });
    const result = await run.acquisition.runOnce();
    expect(result).toMatchObject({ ingested: 1, incomplete: 1, stopped: null });
    expect(run.rows.get(ids[1]!)).toMatchObject({ status: "QUEUED", attempts: 1, lastReason: "INCOMPLETE_PAGE" });
  });

  it("two in a row are the site's, not the jobs': nothing saved or counted, no further page read, every queued job waits an hour, the operator is told", async () => {
    const ids = ["4400000016", "4400000017", "4400000018", "4400000019"];
    const run = setup({ site: "linkedin", ids, serve: (id) => ({ status: 200, html: id === ids[0] || id === ids[1] ? teaser(id) : complete(id) }) });
    const result = await run.acquisition.runOnce();
    expect(result).toMatchObject({ ingested: 0, incomplete: 2, stopped: "INCOMPLETE_PAGE", requests: { pages: 2 } });
    expect(run.navigated).toEqual(ids.slice(0, 2).map((id) => `https://www.linkedin.com/jobs/view/${id}`));
    expect(run.ingest).not.toHaveBeenCalled();
    expect(run.repository.markFailed).not.toHaveBeenCalled();
    expect(run.deferred).toEqual([{ site: "linkedin", until: new Date(now.getTime() + 3_600_000), reason: "INCOMPLETE_PAGE" }]);
    for (const id of ids) expect(run.rows.get(id), id).toMatchObject({ status: "QUEUED", attempts: 0, lastReason: "INCOMPLETE_PAGE" });
    expect(run.log.warn).toHaveBeenCalledWith(expect.stringContaining("PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS=run"));
    const events = run.events();
    expect(events.filter((event) => event.event === "job.decision").map((event) => event.decision)).toEqual(["INCOMPLETE_PAGE_HELD", "INCOMPLETE_PAGE_SECOND_IN_A_ROW", "INCOMPLETE_PAGE_NOT_COUNTED"]);
    expect(events.find((event) => event.event === "site.deferred")).toMatchObject({ reason: "INCOMPLETE_PAGE", pageScripts: "skip" });
    expect(events.at(-1)).toMatchObject({ event: "pass.end", reason: "INCOMPLETE_PAGE", incomplete: 2 });
    // The next pass, an hour later, is the same one-action batch: nothing to
    // do before then.
    expect(await run.acquisition.runOnce()).toBeNull();
  });

  it("a page that keeps arriving incomplete ends automatic work after its third attempt, with the reason shown and Retry offered", async () => {
    const rows = new Map([["4400000020", item("4400000020", "linkedin", { attempts: 2 })]]);
    const run = setup({ site: "linkedin", ids: ["4400000020"], rows, serve: (id) => ({ status: 200, html: teaser(id) }) });
    expect(await run.acquisition.runOnce()).toMatchObject({ awaitingDetails: 1, incomplete: 1 });
    expect(rows.get("4400000020")).toMatchObject({ status: "AWAITING_DETAILS", attempts: 3, lastReason: "INCOMPLETE_PAGE", nextAttemptAt: null });
  });

  it("the job's row says why it waits, or why it needs attention", () => {
    const row = (overrides: Partial<PageCaptureRowView>): PageCaptureRowView => ({
      id: "i", site: "linkedin", siteName: "LinkedIn", title: "CSM", company: null, location: null, postedText: null, sourceUrl: "https://www.linkedin.com/jobs/view/1",
      firstSeenAt: now.toISOString(), status: "QUEUED", lastReason: null, resolvedOpportunityId: null, opportunityTitle: null, triageOutcome: null,
      triageManualDecision: null, evaluationStatus: null, recommendation: null, handoffOutcome: null, ...overrides,
    });
    expect(statusText(row({ lastReason: "INCOMPLETE_PAGE" }))).toBe("Waiting: The job's page arrived without its full posting, so nothing was saved from it");
    expect(statusText(row({ status: "AWAITING_DETAILS", lastReason: "INCOMPLETE_PAGE" }))).toBe("Awaiting details: The job's page arrived without its full posting, so nothing was saved from it");
  });
});

describe("the evidence package's retrieval summary (what the controlled live test records)", () => {
  it("jobs saved before the first restriction, page and request totals, failed attempts, restrictions and elapsed time", async () => {
    const ids = ["4400000031", "4400000032", "4400000033", "4400000034", "4400000035"];
    const run = setup({
      site: "linkedin",
      ids,
      serve: (id) => (id === ids[3] ? { status: 429, html: "<html><body>slow down</body></html>" } : { status: 200, html: id === ids[1] ? teaser(id) : complete(id) }),
    });
    await run.acquisition.runOnce();
    const summary = retrievalSummary(run.events());
    expect(summary.passes).toHaveLength(1);
    expect(summary.passes[0]).toMatchObject({ site: "linkedin", pageScripts: "skip", claimed: 5, ingested: 2, incomplete: 1, stopped: "RATE_LIMITED", elapsedMs: 0 });
    expect(summary.totals).toMatchObject({
      passes: 1,
      jobsIngested: 2,
      pagesOpened: 4,
      documentRequests: 4,
      sentRequests: 4,
      blockedRequests: 12,
      failedAttemptsCounted: 1,
      incompletePages: 1,
      jobsIngestedBeforeFirstRestriction: 2,
      passesStartedAfterFirstRestriction: 0,
      restrictions: [{ site: "linkedin", reason: "RATE_LIMITED" }],
      elapsedMs: 0,
    });
  });
});
