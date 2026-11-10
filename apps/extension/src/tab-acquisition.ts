import type { ApiClient, ApiResult, TabReportResponse } from "./api";
import { buildCaptureEnvelope } from "./envelope";
import type { PageExtraction } from "./extract";
import type { PageCaptureTabResult, PageCaptureTabSignal, PageCaptureTabStop } from "../../../packages/core/src/page-capture";

// Background-tab detail reading for "Save selected jobs" (Mode B, mechanism
// P2, Welcome to the Jungle / Otta). It runs in the extension's service
// worker, started by the same Save click that staged the batch (no second
// action). For each staged job, in order and one at a time:
//
// 1. the server confirms the job is still to be read, and the extension
//    still holds the site's host permission (otherwise the run stops);
// 2. at least the site's interval after the previous job's navigation
//    started, the job's page opens in a new background tab
//    (tabs.create active:false); the user's own tabs are never touched,
//    navigated or closed;
// 3. once the tab has loaded (at most loadTimeoutMs), the page check runs
//    (probeJobPage), then the accepted single-job reader (extract.ts,
//    unchanged), and again on the same document after rereadDelaysMs while
//    no posting is found; nothing reloads the page;
// 4. the extension closes its own tab and reports the capture, or why there
//    was none, to the server, which checks the page is the staged job.
//
// An access restriction (HTTP 401/403/429/999/5xx, a sign-in redirect or
// wall, a challenge or CAPTCHA, or the tab leaving the site) ends the run;
// the server stops the site for at least a day and nothing resumes the
// batch. A page that is not the staged job ends the run. A job whose tab the
// user closed is reported interrupted and never reopened. The run state is in
// chrome.storage.session, so a browser restart ends the run; nothing reopens
// tabs on browser start. A service-worker restart resumes the run: the open
// tab is read once, or reported interrupted if it is gone.

export const tabRunStorageKey = "pageCaptureTabRun";

// The page check, injected before the reader: plain fields, no page content.
// Self-contained (serialized by chrome.scripting): no imports, no outside
// variables, no chrome.*, storage or network. It never clicks, scrolls,
// navigates or changes the page.
export interface TabProbe {
  href: string;
  status: number | null;
  // Shown by the page itself (an access restriction, whatever the reader
  // finds).
  hard: "LOGIN_REDIRECT" | "CHALLENGE" | null;
  // An element that is a restriction only when it stands in for the job
  // posting (a CAPTCHA widget, a password field).
  soft: "CAPTCHA" | "LOGIN_WALL" | null;
}

export function probeJobPage(): TabProbe {
  const entries = typeof performance.getEntriesByType === "function" ? performance.getEntriesByType("navigation") : [];
  const navigation = entries[0] as (PerformanceEntry & { responseStatus?: number }) | undefined;
  const status = typeof navigation?.responseStatus === "number" && navigation.responseStatus > 0 ? navigation.responseStatus : null;
  const path = location.pathname;
  const title = (document.title || "").replace(/\s+/g, " ").trim();
  const hasLayout = document.documentElement.getClientRects().length > 0;
  const visible = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return !hasLayout || element.getClientRects().length > 0;
  };
  let hard: TabProbe["hard"] = null;
  if (/(^|\/)(login|log-in|signin|sign-in|sign_in|signup|sign-up|authwall|checkpoint|sso|oauth|users\/sign_in|session\/new)(\/|$)/i.test(path)) {
    hard = "LOGIN_REDIRECT";
  } else if (
    /(^|\/)(challenge|captcha|cdn-cgi\/challenge-platform\/h)(\/|$)/i.test(path) ||
    /^(just a moment|attention required|access denied|checking your browser|verify you are (a )?human|are you a robot|security check)\b/i.test(title) ||
    // A challenge the page shows, not markup it keeps hidden.
    [
      ...document.querySelectorAll(
        '#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running, .cf-browser-verification, #cf-error-details, iframe[src*="challenges.cloudflare.com"], iframe[src*="captcha-delivery.com"], #px-captcha',
      ),
    ].some(visible)
  ) {
    hard = "CHALLENGE";
  }
  let soft: TabProbe["soft"] = null;
  if ([...document.querySelectorAll('iframe[src*="recaptcha/api2/anchor"], iframe[src*="hcaptcha.com"], .h-captcha, #captcha')].some(visible)) {
    soft = "CAPTCHA";
  } else if ([...document.querySelectorAll('input[type="password"]')].some(visible)) {
    soft = "LOGIN_WALL";
  }
  return { href: String(location.href).slice(0, 2048), status, hard, soft };
}

export interface TabRunItem {
  itemId: string;
  url: string;
}

export interface TabRunState {
  runId: string;
  site: string;
  siteName: string;
  hostPermissions: string[];
  minIntervalMs: number;
  loadTimeoutMs: number;
  rereadDelaysMs: number[];
  // Not started yet, in order.
  queue: TabRunItem[];
  // The job being read: its own tab, once opened.
  current: { itemId: string; url: string; tabId: number | null } | null;
  // When the previous navigation started (epoch ms), for the interval.
  lastNavigationAt: number | null;
  stopRequested: boolean;
  total: number;
  counts: { added: number; notRead: number; skipped: number };
  finished: { reason: TabRunEnd; at: number } | null;
}

export type TabRunEnd = "COMPLETED" | "BLOCKED" | "IDENTITY_MISMATCH" | "USER_STOPPED" | "PERMISSION_MISSING" | "UNREACHABLE";

// What the orchestrator needs from Chrome and the app, injected so it can be
// tested without either.
export interface TabRunEnvironment {
  api: Pick<ApiClient, "pageCaptureTabStart" | "pageCaptureTabDetails" | "pageCaptureTabResult" | "pageCaptureTabStop">;
  tabs: {
    open(url: string): Promise<number>;
    // The tab's address, or null when the extension may not see it (a host
    // outside its permissions); throws when the tab is gone.
    url(tabId: number): Promise<string | null>;
    exists(tabId: number): Promise<boolean>;
    waitForLoad(tabId: number, timeoutMs: number): Promise<"complete" | "timeout" | "removed">;
    close(tabId: number): Promise<void>;
  };
  page: {
    probe(tabId: number): Promise<TabProbe>;
    read(tabId: number): Promise<PageExtraction | null>;
  };
  hasPermission(origins: string[]): Promise<boolean>;
  storage: { load(): Promise<TabRunState | null>; save(state: TabRunState | null): Promise<void> };
  now(): number;
  sleep(ms: number): Promise<void>;
  extensionVersion: string;
  // Keeps the service worker alive while a run is active (and the alarm
  // backstop that resumes it).
  keepAlive(active: boolean): void;
}

type PageOutcome =
  | { kind: "DETAILS"; capture: Parameters<TabRunEnvironment["api"]["pageCaptureTabDetails"]>[1]["capture"] }
  | { kind: PageCaptureTabResult; signal: PageCaptureTabSignal | null; finalUrl: string | null };

const blockingStatus = (status: number | null): PageCaptureTabSignal | null => {
  if (status === null) return null;
  if (status === 401) return "HTTP_401";
  if (status === 403) return "HTTP_403";
  if (status === 429) return "HTTP_429";
  if (status === 999) return "HTTP_999";
  if (status >= 500) return "HTTP_5XX";
  return null;
};

export function tabUrlAllowed(hostPermissions: readonly string[], value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return hostPermissions.some((pattern) => {
    const match = /^https:\/\/([^/*]+)\/\*$/.exec(pattern);
    return match !== null && match[1]!.toLowerCase() === url.hostname.toLowerCase();
  });
}

export function createTabAcquisition(environment: TabRunEnvironment) {
  let running: Promise<void> | null = null;
  // One state object, shared by the running loop, a new save's jobs and the
  // user's Stop (the service worker is single-threaded); persisted on every
  // change so a restarted service worker continues from it.
  let cache: TabRunState | null = null;

  async function load() {
    cache ??= await environment.storage.load();
    return cache;
  }

  // Reads the open tab: the page check, then the reader, on load and after
  // each re-read delay, on the same document.
  async function readTab(state: TabRunState, tabId: number, waitForLoad: boolean): Promise<PageOutcome> {
    if (waitForLoad) {
      const loaded = await environment.tabs.waitForLoad(tabId, state.loadTimeoutMs);
      if (loaded === "removed") return { kind: "INTERRUPTED", signal: "TAB_CLOSED", finalUrl: null };
    }
    const offsets = [0, ...state.rereadDelaysMs];
    const startedAt = environment.now();
    let finalUrl: string | null = null;
    let soft: TabProbe["soft"] = null;
    // A posting read only from the page's structured data, before the page
    // has rendered its body (no page context, so no Apply link, metadata
    // tags or the posting's other sections yet): kept, and the same
    // document read again at the next re-read; taken as it is only when the
    // page never renders (November 5, 2026: 16 of 20 WTTJ jobs were read
    // this way, the moment the tab loaded).
    let early: Extract<PageOutcome, { kind: "DETAILS" }>["capture"] | null = null;
    for (const [index, offset] of offsets.entries()) {
      const wait = startedAt + offset - environment.now();
      if (wait > 0) await environment.sleep(wait);
      if (!(await environment.tabs.exists(tabId))) return { kind: "INTERRUPTED", signal: "TAB_CLOSED", finalUrl };
      let address: string | null;
      try {
        address = await environment.tabs.url(tabId);
      } catch {
        return { kind: "INTERRUPTED", signal: "TAB_CLOSED", finalUrl };
      }
      // Not committed yet (a load that timed out without an answer).
      if (address === "") return { kind: "UNREADABLE", signal: "LOAD_FAILED", finalUrl: null };
      // The tab left the site's permitted hosts (a sign-in or other site):
      // an access restriction.
      if (!address || !tabUrlAllowed(state.hostPermissions, address)) return { kind: "BLOCKED", signal: "LEFT_SITE", finalUrl: null };
      finalUrl = address;
      let probe: TabProbe;
      try {
        probe = await environment.page.probe(tabId);
      } catch {
        if (!(await environment.tabs.exists(tabId))) return { kind: "INTERRUPTED", signal: "TAB_CLOSED", finalUrl };
        // A browser error page (the load failed); it will not change.
        return { kind: "UNREADABLE", signal: "LOAD_FAILED", finalUrl };
      }
      finalUrl = probe.href || finalUrl;
      if (!tabUrlAllowed(state.hostPermissions, finalUrl)) return { kind: "BLOCKED", signal: "LEFT_SITE", finalUrl: null };
      if (probe.hard) return { kind: "BLOCKED", signal: probe.hard, finalUrl };
      const blocked = blockingStatus(probe.status);
      if (blocked) return { kind: "BLOCKED", signal: blocked, finalUrl };
      if (probe.status === 404 || probe.status === 410) return { kind: "UNAVAILABLE", signal: probe.status === 404 ? "HTTP_404" : "HTTP_410", finalUrl };
      soft = probe.soft;
      let extraction: PageExtraction | null = null;
      try {
        extraction = await environment.page.read(tabId);
      } catch {
        extraction = null;
      }
      if (extraction?.posting) {
        const built = buildCaptureEnvelope(extraction, "page", { extensionVersion: environment.extensionVersion, capturedAt: new Date(environment.now()) });
        if (built.ok) {
          const rendered = extraction.pageText !== null || extraction.linkedIn;
          if (rendered || index === offsets.length - 1) return { kind: "DETAILS", capture: built.envelope };
          early = built.envelope;
        }
      }
    }
    if (early) return { kind: "DETAILS", capture: early };
    // No posting: a CAPTCHA or sign-in form in its place is a restriction.
    if (soft) return { kind: "BLOCKED", signal: soft === "CAPTCHA" ? "CAPTCHA" : "LOGIN_WALL", finalUrl };
    return { kind: "UNREADABLE", signal: "NO_POSTING", finalUrl };
  }

  async function report(state: TabRunState, itemId: string, outcome: PageOutcome): Promise<ApiResult<TabReportResponse>> {
    const remainingItemIds = state.queue.map((item) => item.itemId);
    if (outcome.kind === "DETAILS") return environment.api.pageCaptureTabDetails(itemId, { capture: outcome.capture, remainingItemIds });
    return environment.api.pageCaptureTabResult(itemId, { result: outcome.kind, signal: outcome.signal, finalUrl: outcome.finalUrl, remainingItemIds });
  }

  async function finish(state: TabRunState, reason: TabRunEnd) {
    state.queue = [];
    state.current = null;
    state.finished = { reason, at: environment.now() };
    await environment.storage.save(state);
  }

  // The rest of the run, after the user's Stop or a removed permission: the
  // server keeps those jobs awaiting details.
  async function stopRemaining(state: TabRunState, reason: PageCaptureTabStop & TabRunEnd) {
    const itemIds = state.queue.map((item) => item.itemId);
    for (let index = 0; index < itemIds.length; index += 100) {
      await environment.api.pageCaptureTabStop({ site: state.site, itemIds: itemIds.slice(index, index + 100), reason });
    }
    await finish(state, reason);
  }

  // One job, from the server's go-ahead to its report. Returns how the run
  // continues.
  async function processOne(state: TabRunState, item: TabRunItem): Promise<"next" | TabRunEnd> {
    const start = await environment.api.pageCaptureTabStart(item.itemId);
    if (!start.ok) return start.status === 0 || start.status === 401 ? "UNREACHABLE" : "next";
    if (!start.body.proceed) {
      state.counts.skipped += 1;
      // The site was stopped meanwhile: nothing more is read.
      return start.body.reason === "ACCESS_STOPPED" ? "BLOCKED" : "next";
    }
    if (state.lastNavigationAt !== null) {
      const wait = state.lastNavigationAt + state.minIntervalMs - environment.now();
      if (wait > 0) await environment.sleep(wait);
    }
    // The user's Stop during the wait: this job is not opened.
    if (state.stopRequested) {
      state.queue.unshift(item);
      return "USER_STOPPED";
    }
    state.current = { itemId: item.itemId, url: start.body.url, tabId: null };
    state.lastNavigationAt = environment.now();
    await environment.storage.save(state);
    const tabId = await environment.tabs.open(start.body.url);
    state.current.tabId = tabId;
    await environment.storage.save(state);
    return settle(state, item.itemId, tabId, true);
  }

  async function settle(state: TabRunState, itemId: string, tabId: number, waitForLoad: boolean): Promise<"next" | TabRunEnd> {
    let outcome: PageOutcome;
    try {
      outcome = await readTab(state, tabId, waitForLoad);
    } finally {
      // Only the extension's own tab is ever closed.
      await environment.tabs.close(tabId).catch(() => undefined);
    }
    state.current = null;
    await environment.storage.save(state);
    const reported = await report(state, itemId, outcome);
    if (!reported.ok) return reported.status === 0 || reported.status === 401 ? "UNREACHABLE" : "next";
    if (reported.body.outcome === "INGESTED" || reported.body.outcome === "ALREADY_INGESTED") state.counts.added += 1;
    else state.counts.notRead += 1;
    if (reported.body.stopBatch) return reported.body.outcome === "IDENTITY_MISMATCH" ? "IDENTITY_MISMATCH" : "BLOCKED";
    return "next";
  }

  async function loop() {
    const state = await load();
    if (!state || state.finished) return;
    environment.keepAlive(true);
    try {
      // Resumed after the service worker stopped mid-job: its tab is read
      // once if it is still open, otherwise the job was interrupted. A tab
      // that was never opened is not opened now.
      if (state.current) {
        const { itemId, tabId } = state.current;
        if (tabId !== null && (await environment.tabs.exists(tabId))) {
          const next = await settle(state, itemId, tabId, false);
          if (next !== "next") return void (await finish(state, next));
        } else {
          state.current = null;
          await environment.storage.save(state);
          const reported = await environment.api.pageCaptureTabResult(itemId, {
            result: "INTERRUPTED",
            signal: "TAB_CLOSED",
            finalUrl: null,
            remainingItemIds: state.queue.map((item) => item.itemId),
          });
          if (!reported.ok && (reported.status === 0 || reported.status === 401)) return void (await finish(state, "UNREACHABLE"));
          state.counts.notRead += 1;
        }
      }
      while (state.queue.length) {
        if (state.stopRequested) return void (await stopRemaining(state, "USER_STOPPED"));
        if (!(await environment.hasPermission(state.hostPermissions))) return void (await stopRemaining(state, "PERMISSION_MISSING"));
        const item = state.queue.shift()!;
        await environment.storage.save(state);
        const next = await processOne(state, item);
        if (next === "USER_STOPPED") return void (await stopRemaining(state, "USER_STOPPED"));
        if (next !== "next") return void (await finish(state, next));
      }
      await finish(state, "COMPLETED");
    } finally {
      environment.keepAlive(false);
    }
  }

  function run(): Promise<void> {
    // An unexpected failure leaves the run as stored; the alarm backstop
    // continues it (a job whose tab was never opened is then interrupted).
    running ??= loop()
      .catch(() => undefined)
      .finally(() => {
        running = null;
      });
    return running;
  }

  return {
    // Adds a saved batch's jobs to the run (a new run, or the end of the one
    // in progress, without repeating a job already in it) and starts it.
    async enqueue(input: Omit<TabRunState, "runId" | "queue" | "current" | "lastNavigationAt" | "stopRequested" | "total" | "counts" | "finished"> & { items: TabRunItem[] }) {
      const existing = await load();
      // One run at a time; only one site is read this way today.
      if (existing && !existing.finished && existing.site !== input.site) return existing;
      const active = existing && !existing.finished ? existing : null;
      const state: TabRunState = active ?? {
        runId: `${environment.now()}`,
        site: input.site,
        siteName: input.siteName,
        hostPermissions: [...input.hostPermissions],
        minIntervalMs: input.minIntervalMs,
        loadTimeoutMs: input.loadTimeoutMs,
        rereadDelaysMs: [...input.rereadDelaysMs],
        queue: [],
        current: null,
        // The interval also holds across runs.
        lastNavigationAt: existing?.lastNavigationAt ?? null,
        stopRequested: false,
        total: 0,
        counts: { added: 0, notRead: 0, skipped: 0 },
        finished: null,
      };
      const known = new Set([...state.queue.map((item) => item.itemId), ...(state.current ? [state.current.itemId] : [])]);
      const added = input.items.filter((item) => !known.has(item.itemId) && tabUrlAllowed(state.hostPermissions, item.url));
      state.queue.push(...added);
      state.total += added.length;
      cache = state;
      await environment.storage.save(state);
      // The running loop reads the same state object and takes the new jobs.
      if (!running) void run();
      return state;
    },

    // The user's Stop: the job being read finishes; nothing more opens.
    async stop() {
      const state = await load();
      if (!state || state.finished) return state;
      state.stopRequested = true;
      await environment.storage.save(state);
      if (!running) void run();
      return state;
    },

    // Continues a run the service worker was stopped in (the alarm backstop).
    resume: run,
    state: load,
    isRunning: () => running !== null,
  };
}

export type TabAcquisition = ReturnType<typeof createTabAcquisition>;

// The popup's line for a run.
export function tabRunLine(state: TabRunState | null): string | null {
  if (!state) return null;
  const done = state.counts.added + state.counts.notRead + state.counts.skipped;
  const progress = `${state.counts.added} added, ${state.counts.notRead} not read${state.counts.skipped ? `, ${state.counts.skipped} skipped` : ""}`;
  if (!state.finished) {
    if (state.stopRequested) return `Stopping after the current job (${progress}).`;
    return `Reading job details from ${state.siteName} in background tabs, one at a time: ${done} of ${state.total} done (${progress}).`;
  }
  const ends: Record<TabRunEnd, string> = {
    COMPLETED: "Finished reading job details",
    BLOCKED: `${state.siteName} restricted access, so reading stopped; the site is not contacted for at least a day, and the remaining jobs wait until you save a results page again after that`,
    IDENTITY_MISMATCH: "A page that opened was not the saved job, so reading stopped for this batch",
    USER_STOPPED: "You stopped reading job details",
    PERMISSION_MISSING: `The permission to read ${state.siteName} job pages was removed, so reading stopped`,
    UNREACHABLE: "AI Job Assistant could not be reached, so reading stopped",
  };
  return `${ends[state.finished.reason]} (${progress}).`;
}
