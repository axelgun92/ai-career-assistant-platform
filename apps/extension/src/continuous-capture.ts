import type { ApiResult, CaptureSessionDetail, PageCaptureSelectionResponse } from "./api";
import type { AdvanceInput, AdvanceResult, DescribeInput, PageDescription } from "./continuation";
import type { PageCaptureResponse } from "./page-capture-view";
import type { ReadResultCard, ResultCardReaderInput, ResultCardsReading } from "./results";
import type { TabRunState } from "./tab-acquisition";
import {
  pageCaptureMaxCards,
  pageCapturePageNumber,
  pageCapturePageUrl,
  pageCaptureSchemaVersion,
  pageCaptureSearchIdentity,
  pageCaptureSiteByKey,
  type PageCaptureBatchInput,
  type PageCaptureSiteSpec,
} from "../../../packages/core/src/page-capture";

// Continuous capture (Mode B, November 15, 2026). The user starts one run on
// a LinkedIn or Welcome to the Jungle search; the extension's service worker
// then works through the search in successive batches of at most 25 jobs not
// captured before, until the search is confirmed to have ended, the user
// stops it, or a real stopping condition occurs. There is no limit on the
// run's length or on its number of jobs.
//
// Each job is in exactly one place: handled (submitted in a batch, or skipped
// because it was captured before), buffered (selected, persisted, not yet
// submitted) or not yet examined. A buffered job is never counted as captured:
// the totals come only from batches whose every job has settled.
//
// One batch at a time: a batch is submitted only after the previous one has
// settled (none of its jobs still queued, waiting to retry or being read), by
// the same intake, staging, worker or background tabs as a single save.
// Discovery continues while a batch is in flight, up to 25 buffered jobs.
//
// The run's state is stored in chrome.storage.local before every outside
// action, and each step is idempotent: a stopped service worker resumes at
// its next alarm or message. A batch's id is stored before it is sent, so a
// resend after a crash repeats the same batch (staging ignores a repeated
// batch).

export const continuousStorageKey = "continuousCapture";
export const continuousAlarm = "continuous-capture";

export type ContinuousStatus =
  | "RUNNING"
  | "STOPPING"
  | "PAUSED"
  | "STOPPED_BY_USER"
  | "STOPPED_NO_MORE_RESULTS"
  | "STOPPED_UNCONFIRMED"
  | "STOPPED_RESTRICTED"
  | "FAILED"
  | "COMPLETED";

export interface BufferedCard {
  key: string;
  card: ReadResultCard;
}

export interface ContinuousRunState {
  version: 1;
  runId: string;
  site: string;
  siteName: string;
  kind: "show-more" | "pages";
  tabId: number | null;
  searchUrl: string;
  searchIdentity: string;
  currentUrl: string;
  // The results page the run is on (numbered pages only).
  page: number | null;
  pageTitle: string | null;
  status: ContinuousStatus;
  reason: string | null;
  activity: string;
  batchNumber: number;
  handled: string[];
  buffer: BufferedCard[];
  // The batch sent and not yet settled, with its cards (kept until it has
  // settled, so it is sent again unchanged after a crash and its jobs can
  // return to the buffer on Resume).
  inFlight: { batchId: string; batchNumber: number; sessionId: string | null; cards: BufferedCard[]; submitted: boolean; submittedAt: number; tabRunId: string | null } | null;
  // Set by Resume: once this batch has settled, its jobs the interruption
  // left waiting go back to the front of the buffer.
  resumeReconcile: string | null;
  // When the batch in flight was last checked (at most once per poll
  // interval, while discovery continues).
  lastSettleCheckAt: number | null;
  expectedNavigation: { token: string; fromUrl: string; toUrl: string; page: number; issuedAt: number } | null;
  pageRetry: { url: string; attempts: number; nextAt: number; reason: string } | null;
  lastPageEvidence: { page: number; firstAt: number } | null;
  lastPageKeys: string[];
  endConfirmed: boolean;
  loadAttemptsWithoutProgress: number;
  lastLoadAt: number | null;
  lastLoadedCount: number;
  // LinkedIn's "See more jobs" progress (November 18, 2026). Progress is a
  // new distinct job on the page, readable or not yet readable; the page's
  // raw job links tell a page that still grows (repeated jobs) from one that
  // stopped. Both counters reset only on a new job.
  lastSeenJobs?: number;
  // A load whose effect has not been judged yet (each load counts once).
  loadPending?: boolean;
  lastRawLinks?: number;
  loadsWithoutNewJobs?: number;
  // The one delayed recheck before a run stops for lack of progress.
  stallRecheckAt?: number | null;
  // Jobs on the page that could not be read yet: re-read a bounded number
  // of times before the run ends (never COMPLETED while any is unread).
  unreadableCheck?: { kind: "END" | "STALL"; attempts: number; nextAt: number } | null;
  lastNavigationAt: number | null;
  pendingEnd: { status: "STOPPED_NO_MORE_RESULTS" | "STOPPED_UNCONFIRMED"; reason: string } | null;
  stoppedUntil: string | null;
  backoffMs: number;
  nextAttemptAt: number | null;
  // outsideTitles (November 22, 2026): loaded jobs whose titles are outside
  // the target job titles; never read, saved or counted in a batch.
  totals: { captured: number; skipped: number; failures: number; refreshed: number; awaiting: number; outsideTitles?: number };
  workerStarts: number;
  // Every write of the run counts one revision. The user's Stop records the
  // revision it stopped, so a step that was running then keeps its own
  // bookkeeping with the stop; any other newer write wins over the step.
  revision: number;
  stoppedFromRevision: number | null;
  lease: { owner: string; until: number } | null;
  diagnostics: Array<{ at: number; event: string; detail: string }>;
  startedAt: number;
  endedAt: number | null;
}

export interface ContinuousEnvironment {
  api: {
    selection(body: { site: string; cards: Array<{ url: string; siteJobId: string | null; title?: string | null }> }): Promise<ApiResult<PageCaptureSelectionResponse>>;
    pageCapture(batch: PageCaptureBatchInput): Promise<ApiResult<PageCaptureResponse>>;
    captureSession(id: string): Promise<ApiResult<CaptureSessionDetail>>;
  };
  tabs: {
    // The tab's address and load state, or null when the tab is gone.
    get(tabId: number): Promise<{ url: string | null; status: string | null } | null>;
    update(tabId: number, url: string): Promise<void>;
    create(url: string): Promise<number>;
  };
  page: {
    read(tabId: number, input: ResultCardReaderInput): Promise<ResultCardsReading | null>;
    advance(tabId: number, input: AdvanceInput): Promise<AdvanceResult | null>;
    describe(tabId: number, input: DescribeInput): Promise<PageDescription | null>;
  };
  // The background-tab reader (Welcome to the Jungle's job pages).
  acquisition: {
    enqueue(input: {
      site: string;
      siteName: string;
      hostPermissions: string[];
      minIntervalMs: number;
      loadTimeoutMs: number;
      rereadDelaysMs: number[];
      items: Array<{ itemId: string; url: string }>;
    }): Promise<TabRunState | null | undefined>;
    state(): Promise<TabRunState | null>;
    stop(): Promise<unknown>;
  };
  hasPermission(origins: string[]): Promise<boolean>;
  storage: { load(): Promise<ContinuousRunState | null>; save(state: ContinuousRunState | null): Promise<void> };
  now(): number;
  uuid(): string;
  sleep(ms: number): Promise<void>;
  extensionVersion: string;
  // While a step is active: a light extension call every 20 s keeps the
  // service worker from stopping mid-step. Off during long waits, where the
  // alarm (armed while a run is active) wakes a stopped worker.
  keepAlive(active: boolean): void;
  setAlarm(active: boolean): void;
}

// Pacing and bounds.
export const continuousTimings = {
  // A wait longer than this ends the step; the alarm (30 s) continues it.
  longWaitMs: 25_000,
  settlePollMs: 30_000,
  loadSettleMs: 3_000,
  lastPageRecheckMs: 5_000,
  navigationTimeoutMs: 30_000,
  rereadDelaysMs: [2_000, 5_000, 10_000],
  finalReloadDelayMs: 60_000,
  maxStalledLoads: 3,
  // Loads in a row that add page links but no new job (repeated jobs).
  maxLoadsWithoutNewJobs: 10,
  // The one recheck before a stop for lack of progress.
  stallRecheckMs: 60_000,
  // Jobs on the page whose cards are not readable yet: re-read at these
  // delays (about 47 s in all) before the run ends without them.
  unreadRecheckDelaysMs: [2_000, 5_000, 10_000, 30_000],
  backoffMinMs: 30_000,
  backoffMaxMs: 5 * 60_000,
  leaseMs: 60_000,
  keepDiagnostics: 20,
  keepEndedRunMs: 7 * 24 * 60 * 60_000,
} as const;

export const resumableStatuses: readonly ContinuousStatus[] = ["PAUSED", "STOPPED_BY_USER", "STOPPED_NO_MORE_RESULTS", "STOPPED_UNCONFIRMED", "STOPPED_RESTRICTED", "FAILED"];
const activeStatuses: readonly ContinuousStatus[] = ["RUNNING", "STOPPING"];

// A job's key: its canonical address, as the results reader keys it.
export const cardKey = (url: string) => url.split(/[?#]/)[0]!.replace(/\/+$/, "").toLowerCase();

// The permission a site's continuous run needs: to read its search tab and
// (Welcome to the Jungle) to open its job pages.
export function continuousHostPermissions(site: PageCaptureSiteSpec): string[] {
  if (site.tabAcquisition) return site.tabAcquisition.hostPermissions;
  if (site.key === "linkedin") return ["https://www.linkedin.com/*"];
  return site.hosts.map((host) => `https://${host}/*`);
}

export function isResumable(state: ContinuousRunState | null, now: number): boolean {
  if (!state || !resumableStatuses.includes(state.status)) return false;
  if (state.status === "STOPPED_RESTRICTED" && state.stoppedUntil && Date.parse(state.stoppedUntil) > now) return false;
  return true;
}

// The stored run is no longer this step's to write (see hold()).
class RunTakenOver extends Error {}

// waiting: the batch in flight has not settled yet (discovery may continue).
type StepResult = { delayMs: number; waiting?: boolean };

export function createContinuousCapture(environment: ContinuousEnvironment) {
  const owner = environment.uuid();
  let running: Promise<void> | null = null;
  // The run this instance has counted itself in (workerStarts counts, per
  // run, the service-worker instances that worked on it).
  let countedRun: string | null = null;

  const load = () => environment.storage.load();
  const save = (state: ContinuousRunState) => {
    state.revision = (state.revision ?? 0) + 1;
    return environment.storage.save(state);
  };
  // A step works on its own copy of the run. Before each of its writes and
  // external actions the stored run is read again. Unchanged since the
  // step's last write: the step goes on. Only the user's Stop since then:
  // the step's bookkeeping is kept (Resume needs it) with the stop, and the
  // step ends. Anything else (Discard, a new run, or another service-worker
  // instance that took the run over while this one was stopped): the step
  // ends without writing.
  const hold = async (state: ContinuousRunState) => {
    const stored = await load();
    const now = environment.now();
    if (!stored || stored.runId !== state.runId) throw new RunTakenOver();
    if (stored.revision !== state.revision) {
      const userStop = stored.status === "STOPPED_BY_USER" && stored.stoppedFromRevision === state.revision;
      if (!userStop) throw new RunTakenOver();
      state.status = stored.status;
      state.reason = stored.reason;
      state.activity = stored.activity;
      state.endedAt = stored.endedAt;
      state.lease = null;
      state.stoppedFromRevision = stored.stoppedFromRevision;
      state.revision = stored.revision;
      const last = stored.diagnostics.at(-1);
      if (last && !state.diagnostics.some((entry) => entry.at === last.at && entry.event === last.event)) state.diagnostics.push(last);
      await save(state);
      throw new RunTakenOver();
    }
    if (stored.lease && stored.lease.owner !== owner && stored.lease.until > now) throw new RunTakenOver();
    state.lease = { owner, until: now + continuousTimings.leaseMs };
  };
  const persist = async (state: ContinuousRunState) => {
    await hold(state);
    await save(state);
  };
  const siteOf = (state: ContinuousRunState) => pageCaptureSiteByKey(state.site)!;
  // How often a batch in flight is checked: the alarm period, or a synthetic
  // test site's own shorter interval.
  const pollMs = (state: ContinuousRunState) => siteOf(state).continuation?.pollMs ?? continuousTimings.settlePollMs;
  const note = (state: ContinuousRunState, event: string, detail = "") => {
    state.diagnostics.push({ at: environment.now(), event, detail: detail.slice(0, 600) });
    if (state.diagnostics.length > continuousTimings.keepDiagnostics) state.diagnostics.splice(0, state.diagnostics.length - continuousTimings.keepDiagnostics);
  };
  const end = (state: ContinuousRunState, status: ContinuousStatus, reason: string | null) => {
    state.status = status;
    state.reason = reason;
    state.activity = "";
    state.endedAt = environment.now();
    state.lease = null;
    note(state, status, reason ?? "");
  };
  const unreachable = (result: ApiResult<unknown>) => !result.ok && (result.status === 0 || result.status >= 500);

  function readerInput(site: PageCaptureSiteSpec, excludeKeys: string[]): ResultCardReaderInput {
    return { ...site.reader, maxCards: 200, continuous: true, excludeKeys };
  }

  // ------------------------------------------------------------ phase 1
  // The search tab: still there, and still on this run's search. The
  // extension's own page changes are expected; anything else is the user's.
  async function checkTab(state: ContinuousRunState): Promise<"ok" | "arriving" | "uncertain" | "stopped"> {
    const site = siteOf(state);
    const continuation = site.continuation!;
    const tab = state.tabId === null ? null : await environment.tabs.get(state.tabId);
    if (!tab) {
      end(state, "PAUSED", "TAB_CLOSED");
      return "stopped";
    }
    const url = tab.url ?? "";
    const identity = url ? pageCaptureSearchIdentity(url, continuation) : null;
    const sameSearch = identity === state.searchIdentity;
    const pageOfUrl = continuation.kind === "pages" && url ? pageCapturePageNumber(url, continuation.pageParam) : null;
    const expected = state.expectedNavigation;
    if (expected) {
      if (sameSearch && (continuation.kind === "show-more" || pageOfUrl === expected.page) && tab.status === "complete") return "ok";
      const waiting = environment.now() - expected.issuedAt < continuousTimings.navigationTimeoutMs;
      if ((url === expected.fromUrl || tab.status !== "complete" || !url) && waiting) return "arriving";
      if (sameSearch || url === expected.fromUrl || !url) return "uncertain";
      end(state, "PAUSED", "TAB_NAVIGATED");
      return "stopped";
    }
    if (!url || !sameSearch || (continuation.kind === "pages" && pageOfUrl !== state.page)) {
      end(state, "PAUSED", "TAB_NAVIGATED");
      return "stopped";
    }
    return tab.status === "complete" ? "ok" : "arriving";
  }

  // ------------------------------------------------------------ phase 2
  // The batch in flight: sent (again, if a crash came before the reply),
  // then waited on until every job has settled.
  async function settleInFlight(state: ContinuousRunState): Promise<StepResult | null> {
    const inFlight = state.inFlight;
    if (!inFlight) return null;
    if (!inFlight.submitted) return submit(state);
    if (!inFlight.sessionId) {
      // Nothing was staged (every card rejected): the batch is settled.
      state.inFlight = null;
      return null;
    }
    const sinceCheck = state.lastSettleCheckAt === null ? Infinity : environment.now() - state.lastSettleCheckAt;
    if (sinceCheck < pollMs(state)) return { delayMs: pollMs(state) - sinceCheck, waiting: true };
    state.lastSettleCheckAt = environment.now();
    const detail = await environment.api.captureSession(inFlight.sessionId);
    if (!detail.ok) {
      if (unreachable(detail)) return backoff(state, "Backend unreachable, retrying");
      state.inFlight = null;
      note(state, "SESSION_MISSING", inFlight.sessionId);
      return null;
    }
    const body = detail.body;
    const items = body.items ?? [];
    const pending = items.filter((item) => item.status === "QUEUED" || item.status === "ACQUIRING").length;
    state.totals.awaiting = pending;
    const site = siteOf(state);
    if (site.tabAcquisition && (body.queuedTabItems ?? []).length) {
      // Background-tab jobs of this batch that the tab reader does not hold
      // (it was cleared or finished): handed to it again. It skips the jobs
      // it holds, and the server opens only a job still queued.
      const run = await environment.acquisition.state();
      const held = new Set([...(run && !run.finished ? run.queue.map((item) => item.itemId) : []), ...(run?.current ? [run.current.itemId] : [])]);
      const missing = (body.queuedTabItems ?? []).filter((item) => !held.has(item.itemId));
      if (missing.length && !body.stoppedUntil) {
        await hold(state);
        const enqueued = await environment.acquisition.enqueue(tabPlan(site, missing));
        inFlight.tabRunId = enqueued?.runId ?? inFlight.tabRunId;
        note(state, "REENQUEUED", `${missing.length} job(s)`);
      }
    }
    if (body.settled !== true || pending) {
      if (body.stoppedUntil) {
        state.stoppedUntil = body.stoppedUntil;
        end(state, "STOPPED_RESTRICTED", `${state.siteName} restricted access; nothing is read before ${body.stoppedUntil}`);
        return { delayMs: Infinity };
      }
      state.activity = site.tabAcquisition ? `Reading batch ${inFlight.batchNumber} in background tabs` : `Waiting for the retrieval worker to read batch ${inFlight.batchNumber}`;
      return { delayMs: pollMs(state), waiting: true };
    }
    if (site.tabAcquisition) {
      const run = await environment.acquisition.state();
      if (run && !run.finished && (run.current || run.queue.some((item) => items.some((own) => own.itemId === item.itemId)))) {
        state.activity = `Reading batch ${inFlight.batchNumber} in background tabs`;
        return { delayMs: pollMs(state), waiting: true };
      }
      if (run && run.runId === inFlight.tabRunId && run.finished?.reason === "BLOCKED") {
        countOutcomes(state, items);
        state.inFlight = null;
        end(state, "STOPPED_RESTRICTED", `${state.siteName} restricted access while reading job pages`);
        return { delayMs: Infinity };
      }
      if (run && run.runId === inFlight.tabRunId && run.finished?.reason === "PERMISSION_MISSING") {
        end(state, "PAUSED", "PERMISSION_MISSING");
        return { delayMs: Infinity };
      }
    }
    let counted = items;
    if (state.resumeReconcile === inFlight.batchId) {
      // Resume: the batch's jobs left waiting by the interruption (stopped
      // with the run, or expired while the browser was closed) that a new
      // save would read again go back to the front of the buffer; the rest
      // keep their outcome.
      state.resumeReconcile = null;
      const waiting = items.filter((item) => item.status === "AWAITING_DETAILS");
      const cards = inFlight.cards.filter((item) => waiting.some((own) => cardKey(own.url) === item.key));
      const checked = await recheckBuffer(state, cards);
      if (checked === "unreachable") return backoff(state, "Backend unreachable, retrying");
      if (checked === "restricted") {
        end(state, "STOPPED_RESTRICTED", `${state.siteName} restricted access; nothing is read before ${state.stoppedUntil}`);
        return { delayMs: Infinity };
      }
      const returned = new Set(checked.keep.map((item) => item.key));
      state.buffer = [...checked.keep, ...state.buffer.filter((item) => !returned.has(item.key))];
      state.handled = state.handled.filter((key) => !returned.has(key));
      counted = items.filter((item) => !returned.has(cardKey(item.url)));
      if (returned.size) note(state, "RETURNED_TO_BUFFER", `${returned.size} job(s) of batch ${inFlight.batchNumber}`);
    }
    countOutcomes(state, counted);
    note(state, "BATCH_SETTLED", `batch ${inFlight.batchNumber}: ${items.length} job(s)`);
    state.inFlight = null;
    state.totals.awaiting = 0;
    return null;
  }

  function countOutcomes(state: ContinuousRunState, items: NonNullable<CaptureSessionDetail["items"]>) {
    for (const item of items) {
      if (item.status === "INGESTED" && /^REFRESHED:/.test(item.lastReason ?? "")) state.totals.refreshed += 1;
      else if (item.status === "INGESTED") state.totals.captured += 1;
      else if (item.status === "ALREADY_SAVED" || item.status === "DISMISSED") state.totals.skipped += 1;
      else if (item.status === "AWAITING_DETAILS" || item.status === "UNAVAILABLE") state.totals.failures += 1;
    }
  }

  function tabPlan(site: PageCaptureSiteSpec, items: Array<{ itemId: string; url: string }>) {
    return {
      site: site.key,
      siteName: site.name,
      hostPermissions: site.tabAcquisition!.hostPermissions,
      minIntervalMs: site.detail.minIntervalMs,
      loadTimeoutMs: site.tabAcquisition!.loadTimeoutMs,
      rereadDelaysMs: [...site.tabAcquisition!.rereadDelaysMs],
      items,
    };
  }

  function backoff(state: ContinuousRunState, activity: string): StepResult {
    state.backoffMs = Math.min(continuousTimings.backoffMaxMs, Math.max(continuousTimings.backoffMinMs, state.backoffMs * 2));
    state.nextAttemptAt = environment.now() + state.backoffMs;
    state.activity = activity;
    note(state, "BACKEND_UNREACHABLE", `retry in ${Math.round(state.backoffMs / 1000)} s`);
    return { delayMs: state.backoffMs };
  }

  // ------------------------------------------------------------ phase 3
  async function recheckBuffer(state: ContinuousRunState, cards: BufferedCard[]): Promise<{ keep: BufferedCard[]; skipped: BufferedCard[] } | "unreachable" | "restricted"> {
    if (!cards.length) return { keep: [], skipped: [] };
    const reply = await environment.api.selection({
      site: state.site,
      cards: cards.map((item) => ({ url: item.card.url, siteJobId: item.card.siteJobId, title: item.card.title })),
    });
    if (!reply.ok) return unreachable(reply) ? "unreachable" : { keep: cards, skipped: [] };
    if (reply.body.stoppedUntil) {
      state.stoppedUntil = reply.body.stoppedUntil;
      return "restricted";
    }
    const selectable = new Set(reply.body.cards.filter((card) => card.selectable).map((card) => cardKey(card.url)));
    return { keep: cards.filter((item) => selectable.has(item.key)), skipped: cards.filter((item) => !selectable.has(item.key)) };
  }

  // Sends the next batch (the first 25 buffered jobs, checked again), or
  // sends again the batch stored before a crash.
  async function submit(state: ContinuousRunState): Promise<StepResult | null> {
    const site = siteOf(state);
    if (!state.inFlight) {
      const candidates = state.buffer.slice(0, pageCaptureMaxCards);
      const checked = await recheckBuffer(state, candidates);
      if (checked === "unreachable") return backoff(state, "Backend unreachable, retrying");
      if (checked === "restricted") {
        end(state, "STOPPED_RESTRICTED", `${state.siteName} restricted access; nothing is read before ${state.stoppedUntil}`);
        return { delayMs: Infinity };
      }
      const leaving = new Set([...checked.skipped, ...checked.keep].map((item) => item.key));
      state.totals.skipped += checked.skipped.length;
      state.buffer = state.buffer.filter((item) => !leaving.has(item.key));
      state.handled.push(...leaving);
      if (!checked.keep.length) return null;
      state.batchNumber += 1;
      // Stored, with its cards, before it is sent: after a crash the same
      // batch is sent again, and staging ignores a repeated batch.
      state.inFlight = {
        batchId: environment.uuid(),
        batchNumber: state.batchNumber,
        sessionId: null,
        cards: checked.keep,
        submitted: false,
        submittedAt: environment.now(),
        tabRunId: null,
      };
      await persist(state);
    }
    const inFlight = state.inFlight!;
    const cards = inFlight.cards.map((item) => item.card);
    const batch: PageCaptureBatchInput = {
      schemaVersion: pageCaptureSchemaVersion,
      kind: "page-capture",
      batchId: inFlight.batchId,
      site: state.site,
      pageUrl: state.currentUrl,
      pageTitle: state.pageTitle,
      capturedAt: new Date(inFlight.submittedAt).toISOString(),
      extensionVersion: environment.extensionVersion,
      counts: { loaded: cards.length, skippedUnloaded: 0, overCap: 0 },
      cards: cards.map((card) => ({ url: card.url, title: card.title, siteJobId: card.siteJobId, company: card.company, location: card.location, postedText: card.postedText })),
      continuous: { runId: state.runId, batchNumber: inFlight.batchNumber },
    };
    const reply = await environment.api.pageCapture(batch);
    if (!reply.ok) {
      if (unreachable(reply)) return backoff(state, "Backend unreachable, retrying");
      return failed(state, reply.error);
    }
    state.backoffMs = 0;
    state.nextAttemptAt = null;
    inFlight.submitted = true;
    inFlight.sessionId = reply.body.sessionId ?? null;
    note(state, "BATCH_SUBMITTED", `batch ${inFlight.batchNumber}: ${cards.length} job(s); queued ${reply.body.counts.queued}, refreshing ${reply.body.counts.refreshing ?? 0}, already saved ${reply.body.counts.alreadySaved}`);
    const plan = reply.body.acquisition;
    if (plan?.stoppedUntil) {
      state.stoppedUntil = plan.stoppedUntil;
      end(state, "STOPPED_RESTRICTED", `${state.siteName} restricted access; nothing is read before ${plan.stoppedUntil}`);
      return { delayMs: Infinity };
    }
    if (site.tabAcquisition && plan?.items.length) {
      await hold(state);
      const run = await environment.acquisition.enqueue(tabPlan(site, plan.items));
      inFlight.tabRunId = run?.runId ?? null;
    }
    state.lastSettleCheckAt = environment.now();
    await persist(state);
    return { delayMs: 0, waiting: true };
  }

  // ------------------------------------------------------------ phase 4
  async function discover(state: ContinuousRunState, tabCheck: "ok" | "uncertain"): Promise<StepResult | null> {
    const site = siteOf(state);
    const continuation = site.continuation!;
    const tabId = state.tabId!;
    const known = [...state.handled, ...state.buffer.map((item) => item.key)];
    const reading = tabCheck === "uncertain" ? null : await environment.page.read(tabId, readerInput(site, known));
    if (reading?.problem === "FRICTION") {
      end(state, "STOPPED_RESTRICTED", `${state.siteName} showed a sign-in wall or challenge in place of the results`);
      return { delayMs: Infinity };
    }
    if (continuation.kind === "pages") {
      const verdict = await pageVerdict(state, reading, tabCheck);
      if (verdict) return verdict;
    } else if (state.expectedNavigation && reading) {
      // A reopened search (Resume) has arrived.
      state.currentUrl = state.expectedNavigation.toUrl;
      state.expectedNavigation = null;
    }
    if (reading) {
      state.pageTitle = reading.pageTitle ?? state.pageTitle;
      const open = reading.cards;
      if (open.length) {
        // Titles go with the cards: the server checks them against the target
        // job titles exactly as staging would (November 22, 2026).
        const selection = await environment.api.selection({
          site: state.site,
          cards: open.map((card) => ({ url: card.url, siteJobId: card.siteJobId, title: card.title })),
        });
        if (!selection.ok) return unreachable(selection) ? backoff(state, "Backend unreachable, retrying") : failed(state, selection.error);
        state.backoffMs = 0;
        state.nextAttemptAt = null;
        if (selection.body.stoppedUntil) {
          state.stoppedUntil = selection.body.stoppedUntil;
          end(state, "STOPPED_RESTRICTED", `${state.siteName} restricted access; nothing is read before ${selection.body.stoppedUntil}`);
          return { delayMs: Infinity };
        }
        const selectable = new Set(selection.body.cards.filter((card) => card.selectable).map((card) => cardKey(card.url)));
        // A title outside the target job titles is handled (seen, so it counts
        // for progress and the last-page check) but never buffered: it takes
        // no room in the batch of 25 and is never read or saved.
        const outsideTitles = new Set(
          selection.body.cards.filter((card) => card.disposition === "OUTSIDE_TARGET_TITLES").map((card) => cardKey(card.url)),
        );
        const room = Math.max(0, pageCaptureMaxCards - state.buffer.length);
        let taken = 0;
        let skipped = 0;
        let outside = 0;
        for (const card of open) {
          const key = cardKey(card.url);
          if (outsideTitles.has(key)) {
            state.handled.push(key);
            outside += 1;
          } else if (!selectable.has(key)) {
            state.handled.push(key);
            skipped += 1;
          } else if (taken < room) {
            state.buffer.push({ key, card });
            taken += 1;
          }
        }
        state.totals.skipped += skipped;
        if (outside) state.totals.outsideTitles = (state.totals.outsideTitles ?? 0) + outside;
        state.activity = `Reading results (${state.buffer.length} of ${pageCaptureMaxCards} for batch ${state.batchNumber + (state.inFlight ? 2 : 1)})`;
        if (taken || skipped || outside) note(state, "COLLECTED", `${taken} selected, ${skipped} captured before, ${outside} outside the target job titles`);
        // Selectable cards left unexamined on this page wait for room.
        if (open.some((card) => selectable.has(cardKey(card.url)) && !state.buffer.some((item) => item.key === cardKey(card.url)))) return { delayMs: 0 };
        if (taken || skipped || outside) return { delayMs: 0 };
      }
    }
    // Every loaded job is handled or buffered: more results.
    if (continuation.kind === "show-more") return loadMore(state, reading);
    return nextPage(state);
  }

  function failed(state: ContinuousRunState, message: string): StepResult {
    end(state, "FAILED", message);
    return { delayMs: Infinity };
  }

  // LinkedIn: the site's own "See more jobs" (and the scroll that loads more
  // as a person scrolls). Only the site's visible end marker confirms the
  // end. What the page holds is classified on every read (results.ts
  // pageJobs): distinct jobs readable or not yet readable count as progress;
  // links that bring no new job (repeated jobs, excluded areas, non-result
  // links) never do, and never block the end. Every wait is bounded:
  // - 3 loads in a row that add no link and no job, or 10 that add links but
  //   no job, then one recheck after a minute, then a stop with the end not
  //   confirmed;
  // - at the end (or a stop), jobs on the page still unread are re-read at
  //   2, 5, 10 and 30 s; any still unread end the run STOPPED_UNCONFIRMED,
  //   never COMPLETED.
  async function loadMore(state: ContinuousRunState, reading: ResultCardsReading | null): Promise<StepResult | null> {
    const site = siteOf(state);
    const continuation = site.continuation as Extract<NonNullable<PageCaptureSiteSpec["continuation"]>, { kind: "show-more" }>;
    const spacing = Math.max(site.detail.minIntervalMs, continuousTimings.loadSettleMs);
    const loaded = reading?.counts.loaded ?? 0;
    const input = { buttonSelector: continuation.buttonSelector, endSelector: continuation.endSelector, jobLink: site.reader.jobLink };
    const pageJobs = reading?.pageJobs ?? { rawLinks: 0, unreadableKeys: [], excludedJobs: 0 };
    const known = new Set([...state.handled, ...state.buffer.map((item) => item.key)]);
    const unread = pageJobs.unreadableKeys.filter((key) => !known.has(key));
    const uniqueJobs = new Set([...(reading?.keys ?? []), ...pageJobs.unreadableKeys]).size;
    // Every distinct job this run has seen: handled, buffered, or on the
    // page and not readable yet. It only grows when the site shows a new job
    // (a page that drops older cards as it loads more still counts).
    const seenJobs = known.size + unread.length;
    const counts = { readable: loaded, unread: unread.length, uniqueJobs, seenJobs, rawLinks: pageJobs.rawLinks, excludedJobs: pageJobs.excludedJobs };
    const detail = (diagnostics: object | undefined) => JSON.stringify({ ...(diagnostics ?? {}), ...counts });

    // Ending: unread jobs first get their bounded re-reads (no loads).
    const finish = (kind: "END" | "STALL", diagnostics: object | undefined): StepResult => {
      if (unread.length) {
        const check = state.unreadableCheck ?? { kind, attempts: 0, nextAt: environment.now() };
        const delays = continuousTimings.unreadRecheckDelaysMs;
        if (check.attempts < delays.length) {
          check.nextAt = environment.now() + delays[check.attempts]!;
          check.attempts += 1;
          state.unreadableCheck = check;
          state.activity = "Waiting for loaded results to finish rendering";
          note(state, "UNREAD_RECHECK", `attempt ${check.attempts}: ${detail(diagnostics)}`);
          return { delayMs: delays[check.attempts - 1]! };
        }
        state.unreadableCheck = null;
        state.pendingEnd = {
          status: "STOPPED_UNCONFIRMED",
          reason: `${unread.length} loaded job(s) on the ${state.siteName} results could not be read; the end of the search was not confirmed`,
        };
        state.status = "STOPPING";
        note(state, "UNREAD_JOBS", `${unread.slice(0, 20).join(" ")}${unread.length > 20 ? ` (+${unread.length - 20})` : ""}`);
        return { delayMs: 0 };
      }
      state.unreadableCheck = null;
      if (kind === "END") {
        state.endConfirmed = true;
        note(state, "END_MARKER", detail(diagnostics));
        return { delayMs: 0 };
      }
      state.pendingEnd = { status: "STOPPED_NO_MORE_RESULTS", reason: `${state.siteName} stopped loading more results; the end of the search was not confirmed` };
      state.status = "STOPPING";
      note(state, "NO_MORE_RESULTS", detail(diagnostics));
      return { delayMs: 0 };
    };

    // A re-read of unread jobs in progress: wait for it, then decide again.
    if (state.unreadableCheck) {
      if (environment.now() < state.unreadableCheck.nextAt) return { delayMs: state.unreadableCheck.nextAt - environment.now() };
      if (!unread.length || state.unreadableCheck.attempts >= continuousTimings.unreadRecheckDelaysMs.length) {
        const kind = state.unreadableCheck.kind;
        if (unread.length) return finish(kind, undefined);
        state.unreadableCheck = null;
        if (kind === "END") return finish("END", undefined);
      } else {
        return finish(state.unreadableCheck.kind, undefined);
      }
    }

    // Loads stay at least the site's interval apart.
    if (state.lastLoadAt !== null && environment.now() < state.lastLoadAt + spacing) return { delayMs: state.lastLoadAt + spacing - environment.now() };
    // The previous load's effect, judged once.
    if (state.loadPending) {
      state.loadPending = false;
      const newJobs = seenJobs > (state.lastSeenJobs ?? 0);
      const newLinks = pageJobs.rawLinks > (state.lastRawLinks ?? 0);
      if (newJobs) {
        state.loadAttemptsWithoutProgress = 0;
        state.loadsWithoutNewJobs = 0;
        state.stallRecheckAt = null;
      } else {
        state.loadsWithoutNewJobs = (state.loadsWithoutNewJobs ?? 0) + 1;
        state.loadAttemptsWithoutProgress = newLinks ? 0 : state.loadAttemptsWithoutProgress + 1;
      }
      state.lastSeenJobs = Math.max(state.lastSeenJobs ?? 0, seenJobs);
      state.lastRawLinks = Math.max(state.lastRawLinks ?? 0, pageJobs.rawLinks);
    }

    const stalled =
      state.loadAttemptsWithoutProgress >= continuousTimings.maxStalledLoads || (state.loadsWithoutNewJobs ?? 0) >= continuousTimings.maxLoadsWithoutNewJobs;
    if (stalled) {
      const check = await environment.page.advance(state.tabId!, { ...input, checkOnly: true });
      if (check?.action === "END") return finish("END", check.diagnostics);
      if (state.stallRecheckAt === null || state.stallRecheckAt === undefined) {
        // One recheck after a minute: one more read and one more load.
        state.stallRecheckAt = environment.now() + continuousTimings.stallRecheckMs;
        state.activity = "Waiting before one more attempt to load results";
        note(state, "STALL_RECHECK", detail(check?.diagnostics));
        return { delayMs: continuousTimings.stallRecheckMs };
      }
      if (environment.now() < state.stallRecheckAt) return { delayMs: state.stallRecheckAt - environment.now() };
      if (state.stallRecheckAt > 0) {
        // The recheck's one load (marked done with 0).
        state.stallRecheckAt = 0;
      } else {
        return finish("STALL", check?.diagnostics);
      }
    }

    const result = await environment.page.advance(state.tabId!, input);
    if (!result) return failed(state, "The search page could not be read");
    if (result.action === "END") return finish("END", result.diagnostics);
    state.lastLoadAt = environment.now();
    state.loadPending = true;
    state.lastLoadedCount = loaded;
    state.lastSeenJobs = Math.max(state.lastSeenJobs ?? 0, seenJobs);
    state.lastRawLinks = Math.max(state.lastRawLinks ?? 0, pageJobs.rawLinks);
    state.activity = "Loading more results";
    note(state, result.action, detail(result.diagnostics));
    return { delayMs: spacing };
  }

  // Numbered pages: what the page shows decides whether the run continues
  // on it, waits for it, retries it, or has reached the confirmed end.
  async function pageVerdict(state: ContinuousRunState, reading: ResultCardsReading | null, tabCheck: "ok" | "uncertain"): Promise<StepResult | null> {
    const site = siteOf(state);
    const continuation = site.continuation as Extract<NonNullable<PageCaptureSiteSpec["continuation"]>, { kind: "pages" }>;
    const expected = state.expectedNavigation;
    const page = expected?.page ?? state.page ?? 1;
    const description = tabCheck === "uncertain" ? null : await environment.page.describe(state.tabId!, continuation);
    const verdict = classifyResultsPage({ reading, description, page, previousPageKeys: expected ? state.lastPageKeys : [], seen: state.handled.length + state.buffer.length });
    if (description) note(state, `PAGE_${page}_${verdict}`, description.summary);
    if (verdict === "RESTRICTED") {
      end(state, "STOPPED_RESTRICTED", `${state.siteName} showed a sign-in wall or challenge in place of the results`);
      return { delayMs: Infinity };
    }
    if (verdict === "UNCERTAIN") return retryPage(state, expected?.toUrl ?? state.currentUrl, "UNCERTAIN");
    // The page is read: the expected arrival is complete.
    if (expected) {
      state.expectedNavigation = null;
      state.currentUrl = expected.toUrl;
      state.page = expected.page;
      state.lastPageEvidence = null;
    }
    state.pageRetry = null;
    state.lastPageKeys = (reading?.keys ?? []).slice(0, 200);
    if (verdict === "LAST_PAGE_EVIDENCE") {
      const known = new Set([...state.handled, ...state.buffer.map((item) => item.key)]);
      const examined = (reading?.keys ?? []).every((key) => known.has(key));
      if (!examined) return null;
      if (state.lastPageEvidence?.page === state.page) {
        if (environment.now() - state.lastPageEvidence.firstAt >= continuousTimings.lastPageRecheckMs) {
          state.endConfirmed = true;
          note(state, "LAST_PAGE_CONFIRMED", `page ${state.page}`);
          return { delayMs: 0 };
        }
        return { delayMs: state.lastPageEvidence.firstAt + continuousTimings.lastPageRecheckMs - environment.now() };
      }
      state.lastPageEvidence = { page: state.page!, firstAt: environment.now() };
      return { delayMs: continuousTimings.lastPageRecheckMs };
    }
    state.lastPageEvidence = null;
    // A next-page control that names another page than the next one: the
    // page is not understood; never skipped.
    if (description?.nextPage !== null && description?.nextPage !== undefined && description.nextPage !== state.page! + 1) {
      return retryPage(state, state.currentUrl, "NEXT_PAGE_MISMATCH");
    }
    return null;
  }

  // Bounded retries for a page that could not be read with certainty: the
  // same document read again at 2, 5 and 10 s, then the page reloaded once
  // (at least the site's interval after the last navigation), then once more
  // after a minute; still uncertain, the run stops, the end not confirmed.
  async function retryPage(state: ContinuousRunState, url: string, reason: string): Promise<StepResult> {
    const site = siteOf(state);
    const retry = state.pageRetry && state.pageRetry.url === url ? state.pageRetry : { url, attempts: 0, nextAt: environment.now(), reason };
    state.pageRetry = retry;
    if (retry.nextAt > environment.now()) return { delayMs: retry.nextAt - environment.now() };
    retry.attempts += 1;
    retry.reason = reason;
    note(state, "PAGE_RETRY", `${reason}, attempt ${retry.attempts}: ${url}`);
    const rereads = continuousTimings.rereadDelaysMs;
    if (retry.attempts <= rereads.length) {
      retry.nextAt = environment.now() + rereads[retry.attempts - 1]!;
      state.activity = "Waiting for the results page to finish loading";
      return { delayMs: rereads[retry.attempts - 1]! };
    }
    const reloads = retry.attempts - rereads.length;
    if (reloads <= 2) {
      const spacing = reloads === 1 ? site.detail.minIntervalMs : continuousTimings.finalReloadDelayMs;
      const due = Math.max((state.lastNavigationAt ?? 0) + spacing, environment.now());
      if (due > environment.now()) {
        retry.attempts -= 1;
        retry.nextAt = due;
        return { delayMs: due - environment.now() };
      }
      await navigate(state, url, state.expectedNavigation?.page ?? state.page ?? 1);
      retry.nextAt = environment.now() + continuousTimings.rereadDelaysMs[0]!;
      state.activity = "Reloading the results page";
      return { delayMs: continuousTimings.loadSettleMs };
    }
    state.pageRetry = null;
    state.pendingEnd = {
      status: "STOPPED_UNCONFIRMED",
      reason: `Could not confirm results beyond page ${state.page ?? 1}; the end of the search was not confirmed`,
    };
    state.status = "STOPPING";
    return { delayMs: 0 };
  }

  async function navigate(state: ContinuousRunState, url: string, page: number) {
    // Stored before the tab moves: the guard accepts this arrival.
    state.expectedNavigation = { token: environment.uuid(), fromUrl: state.currentUrl, toUrl: url, page, issuedAt: environment.now() };
    state.lastNavigationAt = environment.now();
    await persist(state);
    await environment.tabs.update(state.tabId!, url);
  }

  async function nextPage(state: ContinuousRunState): Promise<StepResult | null> {
    if (state.endConfirmed || state.pendingEnd) return null;
    const site = siteOf(state);
    const continuation = site.continuation as Extract<NonNullable<PageCaptureSiteSpec["continuation"]>, { kind: "pages" }>;
    const run = site.tabAcquisition ? await environment.acquisition.state() : null;
    const last = Math.max(state.lastNavigationAt ?? 0, run?.lastNavigationAt ?? 0);
    const due = last + site.detail.minIntervalMs;
    if (due > environment.now()) return { delayMs: due - environment.now() };
    const page = (state.page ?? 1) + 1;
    await navigate(state, pageCapturePageUrl(state.currentUrl, continuation.pageParam, page), page);
    state.activity = `Opening page ${page}`;
    return { delayMs: continuousTimings.loadSettleMs };
  }

  // ------------------------------------------------------------ one step
  async function step(state: ContinuousRunState): Promise<StepResult> {
    if (!activeStatuses.includes(state.status)) return { delayMs: Infinity };
    if (state.nextAttemptAt && state.nextAttemptAt > environment.now()) return { delayMs: state.nextAttemptAt - environment.now() };
    // Phase 1, on every step until the end is known: the search tab is still
    // there and still on this run's search (also while only waiting for a
    // batch, so a user who leaves the search is noticed at once).
    const searching = !state.endConfirmed && !state.pendingEnd;
    const tab = searching ? await checkTab(state) : "ok";
    if (tab === "stopped") return { delayMs: Infinity };
    // Phase 2: the batch in flight (sent again if a crash came before its
    // reply; otherwise checked at most once per poll interval).
    const settled = await settleInFlight(state);
    if (!activeStatuses.includes(state.status)) return { delayMs: Infinity };
    if (settled && !settled.waiting) return settled;
    const waiting = settled?.waiting === true;
    // Phase 3: the next batch, only once nothing is in flight.
    const ready = state.buffer.length >= pageCaptureMaxCards || ((state.endConfirmed || state.pendingEnd) && state.buffer.length > 0);
    if (!state.inFlight && ready) {
      const sent = await submit(state);
      return sent ?? { delayMs: 0 };
    }
    // Phase 5: the end, once the last batch has settled.
    if ((state.endConfirmed || state.pendingEnd) && !state.inFlight && !state.buffer.length) {
      if (state.endConfirmed) end(state, "COMPLETED", "All results captured");
      else end(state, state.pendingEnd!.status, state.pendingEnd!.reason);
      return { delayMs: Infinity };
    }
    const waitForBatch = { delayMs: settled?.delayMs ?? pollMs(state) };
    if (state.endConfirmed || state.pendingEnd) return waitForBatch;
    // Phase 4: discovery while the buffer has room, also while a batch is in
    // flight.
    if (state.buffer.length >= pageCaptureMaxCards) return waitForBatch;
    if (tab === "arriving") {
      state.activity = "Waiting for the results page to load";
      return { delayMs: continuousTimings.loadSettleMs };
    }
    const found = await discover(state, tab);
    if (!found) return { delayMs: 0 };
    // Nothing to discover for a while: wait for the batch in flight, if any.
    return waiting && found.delayMs > waitForBatch.delayMs ? waitForBatch : found;
  }

  async function runLoop() {
    environment.keepAlive(true);
    try {
      for (;;) {
        const state = await load();
        if (!state || !activeStatuses.includes(state.status)) return;
        const now = environment.now();
        if (state.lease && state.lease.owner !== owner && state.lease.until > now) return;
        state.lease = { owner, until: now + continuousTimings.leaseMs };
        if (countedRun !== state.runId) {
          countedRun = state.runId;
          state.workerStarts += 1;
          // Each service-worker instance that takes the run over (Chrome
          // stops an idle worker; the alarm or a message starts a new one).
          if (state.workerStarts > 1) note(state, "WORKER_RESUMED", `instance ${owner.slice(0, 8)}`);
        }
        await save(state);
        let result: StepResult;
        try {
          result = await step(state);
        } catch (error) {
          if (error instanceof RunTakenOver) return;
          end(state, "FAILED", error instanceof Error ? error.message : "Unexpected error");
          result = { delayMs: Infinity };
        }
        try {
          if (!activeStatuses.includes(state.status)) {
            const ended = { status: state.status, reason: state.reason, activity: state.activity, endedAt: state.endedAt };
            await hold(state);
            Object.assign(state, ended, { lease: null });
            await save(state);
            environment.setAlarm(false);
            return;
          }
          await persist(state);
        } catch (error) {
          if (error instanceof RunTakenOver) return;
          throw error;
        }
        if (result.delayMs > continuousTimings.longWaitMs) return;
        if (result.delayMs > 0) await environment.sleep(result.delayMs);
      }
    } finally {
      environment.keepAlive(false);
    }
  }

  function run(): Promise<void> {
    running ??= runLoop()
      .catch(() => undefined)
      .finally(() => {
        running = null;
      });
    return running;
  }

  function freshState(input: { site: PageCaptureSiteSpec; tabId: number; url: string; title: string | null }): ContinuousRunState {
    const continuation = input.site.continuation!;
    return {
      version: 1,
      runId: environment.uuid(),
      site: input.site.key,
      siteName: input.site.name,
      kind: continuation.kind,
      tabId: input.tabId,
      searchUrl: input.url,
      searchIdentity: pageCaptureSearchIdentity(input.url, continuation)!,
      currentUrl: input.url,
      page: continuation.kind === "pages" ? pageCapturePageNumber(input.url, continuation.pageParam) : null,
      pageTitle: input.title,
      status: "RUNNING",
      reason: null,
      activity: "Starting",
      batchNumber: 0,
      handled: [],
      buffer: [],
      inFlight: null,
      resumeReconcile: null,
      lastSettleCheckAt: null,
      expectedNavigation: null,
      pageRetry: null,
      lastPageEvidence: null,
      lastPageKeys: [],
      endConfirmed: false,
      loadAttemptsWithoutProgress: 0,
      lastLoadAt: null,
      lastLoadedCount: 0,
      lastSeenJobs: 0,
      loadPending: false,
      lastRawLinks: 0,
      loadsWithoutNewJobs: 0,
      stallRecheckAt: null,
      unreadableCheck: null,
      lastNavigationAt: null,
      pendingEnd: null,
      stoppedUntil: null,
      backoffMs: 0,
      nextAttemptAt: null,
      totals: { captured: 0, skipped: 0, failures: 0, refreshed: 0, awaiting: 0 },
      workerStarts: 0,
      revision: 0,
      stoppedFromRevision: null,
      lease: null,
      diagnostics: [],
      startedAt: environment.now(),
      endedAt: null,
    };
  }

  return {
    // One user start (the Start click has already obtained the site's host
    // permission). Refused while a run that can be resumed exists: the user
    // resumes it, or discards it explicitly.
    async start(input: { site: string; tabId: number; url: string; title: string | null }): Promise<{ ok: true; state: ContinuousRunState } | { ok: false; error: string; state: ContinuousRunState | null }> {
      const site = pageCaptureSiteByKey(input.site);
      if (!site?.continuation) return { ok: false, error: "Continuous capture is not available for this site.", state: null };
      if (!pageCaptureSearchIdentity(input.url, site.continuation)) return { ok: false, error: "This page is not a search.", state: null };
      const existing = await load();
      if (existing && (activeStatuses.includes(existing.status) || isResumable(existing, environment.now()))) {
        return { ok: false, error: "A continuous capture can be resumed. Resume it, or discard it to start a new one.", state: existing };
      }
      if (!(await environment.hasPermission(continuousHostPermissions(site)))) return { ok: false, error: `Continuous capture needs permission to read ${site.name} pages.`, state: null };
      const state = freshState({ site, tabId: input.tabId, url: input.url, title: input.title });
      note(state, "STARTED", input.url);
      await save(state);
      environment.setAlarm(true);
      void run();
      return { ok: true, state };
    },

    // The user's Stop: no new work; the buffer and the batch in flight are
    // kept for Resume. Background-tab reading stops (its remaining jobs wait,
    // as for a single save); LinkedIn's queued jobs are finished by the worker.
    async stop(): Promise<ContinuousRunState | null> {
      const state = await load();
      if (!state || !activeStatuses.includes(state.status)) return state;
      if (siteOf(state).tabAcquisition) await environment.acquisition.stop();
      end(state, "STOPPED_BY_USER", "You stopped the capture");
      state.stoppedFromRevision = state.revision;
      await save(state);
      environment.setAlarm(false);
      return state;
    },

    // Resume: the search tab, then the batch in flight is reconciled and
    // settled before anything else; the jobs of that batch that the
    // interruption left waiting go back to the front of the buffer; then the
    // buffer, then discovery.
    async resume(input: { tabId: number | null }): Promise<{ ok: boolean; error?: string; state: ContinuousRunState | null }> {
      const state = await load();
      if (!state || !isResumable(state, environment.now())) return { ok: false, error: "There is no capture to resume.", state };
      const site = siteOf(state);
      if (!(await environment.hasPermission(continuousHostPermissions(site)))) return { ok: false, error: `Continuous capture needs permission to read ${site.name} pages.`, state };
      // 1. The tab.
      const target = site.continuation!.kind === "pages" ? state.currentUrl : state.searchUrl;
      const tab = input.tabId !== null ? await environment.tabs.get(input.tabId) : state.tabId !== null ? await environment.tabs.get(state.tabId) : null;
      const onSearch = (url: string | null) => url !== null && pageCaptureSearchIdentity(url, site.continuation!) === state.searchIdentity;
      const pageOk = (url: string | null) => site.continuation!.kind !== "pages" || (url !== null && pageCapturePageNumber(url, site.continuation!.pageParam) === state.page);
      if (tab && onSearch(tab.url) && pageOk(tab.url)) {
        state.tabId = input.tabId ?? state.tabId;
      } else {
        state.tabId = await environment.tabs.create(target);
        state.expectedNavigation = { token: environment.uuid(), fromUrl: "", toUrl: target, page: state.page ?? 1, issuedAt: environment.now() };
        state.lastNavigationAt = environment.now();
      }
      if (site.continuation!.kind === "show-more") {
        // A reopened search starts at its first results; handled jobs are
        // skipped without asking the server again.
        state.lastLoadAt = null;
        state.lastLoadedCount = 0;
        state.loadAttemptsWithoutProgress = 0;
        state.lastSeenJobs = 0;
        state.loadPending = false;
        state.lastRawLinks = 0;
        state.loadsWithoutNewJobs = 0;
        state.stallRecheckAt = null;
        state.unreadableCheck = null;
      }
      state.pendingEnd = null;
      state.pageRetry = null;
      state.lastPageEvidence = null;
      state.status = "RUNNING";
      state.reason = null;
      state.endedAt = null;
      state.activity = state.inFlight ? `Reconciling batch ${state.inFlight.batchNumber}` : "Resuming";
      state.resumeReconcile = state.inFlight ? state.inFlight.batchId : null;
      note(state, "RESUMED", state.inFlight ? `batch ${state.inFlight.batchNumber} in flight; ${state.buffer.length} buffered` : `${state.buffer.length} buffered`);
      await save(state);
      environment.setAlarm(true);
      void run();
      return { ok: true, state };
    },

    // The user discards a run that could be resumed (the panel states how
    // many discovered jobs were not submitted).
    async discard(): Promise<void> {
      const state = await load();
      if (state && activeStatuses.includes(state.status)) return;
      await environment.storage.save(null);
      environment.setAlarm(false);
    },

    // Browser start: the background-tab reader was cleared; the run waits
    // for the user's Resume.
    async browserStarted(): Promise<void> {
      const state = await load();
      if (!state) return;
      if (activeStatuses.includes(state.status)) {
        end(state, "PAUSED", "BROWSER_RESTARTED");
        await save(state);
      } else if (state.endedAt && environment.now() - state.endedAt > continuousTimings.keepEndedRunMs && !isResumable(state, environment.now())) {
        await environment.storage.save(null);
      }
      environment.setAlarm(false);
    },

    // The alarm, or a message: continues an active run.
    tick: () => run(),
    // This service-worker instance (diagnostics: a new id after Chrome
    // stopped and restarted the worker).
    instanceId: owner,
    state: load,
    isRunning: () => running !== null,
  };
}

export type ContinuousCapture = ReturnType<typeof createContinuousCapture>;

// What a numbered results page shows (adjustment 2, November 15, 2026).
export type ResultsPageVerdict = "RENDERED" | "LAST_PAGE_EVIDENCE" | "RESTRICTED" | "UNCERTAIN";
export function classifyResultsPage(input: {
  reading: ResultCardsReading | null;
  description: PageDescription | null;
  page: number;
  previousPageKeys: string[];
  seen: number;
}): ResultsPageVerdict {
  const { reading, description } = input;
  if (reading?.problem === "FRICTION") return "RESTRICTED";
  if (!reading || !description) return "UNCERTAIN";
  const keys = reading.keys ?? [];
  // An empty page, cards still loading, or the site's own "no results": not
  // the end on their own.
  if (!keys.length || reading.counts.skippedUnloaded > 0 || description.empty) return "UNCERTAIN";
  if (description.activePage !== null && description.activePage !== input.page) return "UNCERTAIN";
  // The previous page's jobs again: the page did not change.
  if (input.previousPageKeys.length && keys.every((key) => input.previousPageKeys.includes(key))) return "UNCERTAIN";
  const noNext = !description.nextPresent || description.nextDisabled;
  if (noNext && description.highestPage !== null && description.highestPage === input.page) return "LAST_PAGE_EVIDENCE";
  if (description.total !== null && input.seen >= description.total) return "LAST_PAGE_EVIDENCE";
  return "RENDERED";
}
