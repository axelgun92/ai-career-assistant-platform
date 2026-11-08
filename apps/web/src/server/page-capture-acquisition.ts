import {
  isPageCaptureRefresh,
  pageCaptureDetailsPerPass,
  pageCaptureFrictionBackoffMs,
  pageCaptureMaxAttempts,
  pageCaptureDetailMechanism,
  pageCaptureSiteByKey,
  RetrievedListingNormalizationError,
  type DiscoveryConfiguration,
  type ExtensionCapture,
  type RetrievalIngestionService,
  type RetrievedListingOutcome,
} from "@ai-career/core";
import { captureTransactionSettings, type PageCaptureItemRecord, type PrismaPageCaptureRepository } from "@ai-career/database";
import { AdapterError, createBrowserSession, detectLinkedInFriction, type BrowserDriver } from "@ai-career/discovery";
import { JSDOM } from "jsdom";
import { buildCaptureEnvelope } from "../../../extension/src/envelope";
import { extractJobPosting, type PageExtraction } from "../../../extension/src/extract";
import { EvaluationApiError } from "./evaluation-errors";
import { capturedListing, ExtensionCaptureError } from "./extension-capture";
import { applyEvidence, type ApplyEvidence, type PageCaptureEvidence } from "./page-capture-evidence";
import { diagnosticError, diagnosticUrl, type DiagnosticFields } from "./worker-diagnostics";
import { classifyJobDatabaseFailure, formatWorkerError } from "./worker-errors";

// Structured diagnostics sink (worker-diagnostics.ts); absent in tests that
// do not need it.
export interface DiagnosticsSink {
  event(name: string, fields?: DiagnosticFields): void;
}
const noDiagnostics: DiagnosticsSink = { event: () => undefined };

// Automatic detail acquisition for the browser extension's results-page
// capture (Mode B). For a site whose approved mechanism is verified
// (detailVerified), the retrieval worker reads each staged job's own page
// in a fresh, logged-out headless browser, the same access model as
// browser-assisted retrieval (feature 14): open-only, sequential, at least
// the site's interval apart, a per-pass cap, and a full stop with no retry on
// any refusal, sign-in wall, challenge or rate limit, after which the site is
// not contacted for at least a day. The page is read by the accepted
// single-job reader (extract.ts, unchanged), turned into the same capture a
// single-job save makes (envelope.ts, unchanged), mapped by the same
// capturedListing (unchanged) and ingested by the normal retrieval ingestion:
// normalization, deduplication and re-observation as for any capture.
//
// A newly ingested job is then handed, once, to the existing evaluation
// request, whose pre-evaluator triage decides Evaluate, Needs Review or
// Reject before any admission, budget reservation or provider call. Nothing
// here decides that outcome or calls the evaluator.

// The companion version whose capture contract the acquisition reproduces
// (the capture envelope accepts only a dotted version number). That a job was
// acquired from a results-page batch is recorded on its PageCaptureItem.
export const pageCaptureAcquisitionVersion = "0.2.0";

export interface EvaluationHandoff {
  // Whether the opportunity already has an evaluation, an open request or
  // deferral, or a triage record; then it is not submitted again.
  alreadyHandled(opportunityId: string): Promise<boolean>;
  // The existing evaluation request (triage-gated); returns its outcome.
  request(opportunityId: string): Promise<string>;
}

// The job's posting was saved (the ingestion committed), but a later step
// failed: marking its staged item ("mark") or recording its hand-off
// ("handoff"). Never a failure of the job's read (November 6, 2026): the
// saved job is never charged an attempt for it.
export class PageCaptureSavedError extends Error {
  constructor(
    readonly stage: "mark" | "handoff",
    readonly opportunityId: string,
    readonly cause: unknown,
  ) {
    super(`The job was saved; ${stage === "mark" ? "its progress could not be recorded" : "its hand-off could not be recorded"}`);
    this.name = "PageCaptureSavedError";
  }
}

export interface PageCaptureAcquisitionDependencies {
  repository: Pick<
    PrismaPageCaptureRepository,
    | "sitesWithQueued"
    | "siteStoppedUntil"
    | "claimQueued"
    | "markIngested"
    | "markFailed"
    | "deferSite"
    | "markHandedOff"
    | "recoverInterrupted"
    | "releaseClaimed"
    | "finalizeProvisionalFailure"
    | "requeueUncounted"
  > &
    Partial<Pick<PrismaPageCaptureRepository, "holdForBrowser" | "releaseBrowserHold">>;
  // The capture path's health without capturing anything (a transaction that
  // takes the capture lock and commits): decides whether a lone transient
  // database failure was the job's own. Absent: such a failure stays
  // unproven and uncounted.
  probeCapture?: () => Promise<void>;
  ingestion: RetrievalIngestionService;
  handoff: EvaluationHandoff;
  discovery: DiscoveryConfiguration;
  // The site keys whose details may be fetched (verified, or the test site).
  detailSites: () => string[];
  // A fresh logged-out browser per pass; absent when none is configured.
  browser?: { launch(): Promise<BrowserDriver> };
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: { info(message: string): void; warn(message: string): void };
  // Persistent structured diagnostics and opt-in page evidence.
  diagnostics?: DiagnosticsSink;
  evidence?: PageCaptureEvidence;
}

export interface AcquisitionPassResult {
  site: string;
  claimed: number;
  ingested: number;
  awaitingDetails: number;
  unavailable: number;
  stopped: string | null;
}

// How long a counted failed attempt waits before the job is read again (the
// existing per-job retry, unchanged since November 3, 2026).
export const pageCaptureRetryAfterMs = 60 * 60 * 1000;

// The accepted single-job reader, run as Chrome runs it: its source text
// evaluated in the page's window. The page's own scripts never run here.
export function readJobPage(document: Document): PageExtraction | null {
  const window = document.defaultView as (Window & { eval(source: string): unknown }) | null;
  if (!window) return null;
  // The reader's own source text is evaluated in the page's window, as Chrome
  // runs it. Under tsx (the runtime of the retrieval worker and of
  // page-capture:verify), esbuild compiles with keepNames, which wraps the
  // reader's inner functions in `__name(fn, "name")` calls whose helper lives
  // at module scope and is not part of the serialized source. The same helper
  // is supplied around the source here (it only sets a function's name, as
  // esbuild's does), so the reader runs unchanged whichever way it was
  // compiled; the extension's own bundle has no such calls.
  const source = extractJobPosting.toString();
  const result = window.eval(
    `(() => { const __name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true }); return (${source})(); })()`,
  ) as PageExtraction;
  return JSON.parse(JSON.stringify(result)) as PageExtraction;
}

const parseRunnable = (html: string, url: string) => new JSDOM(html, { url, runScripts: "outside-only" }).window.document;

// A site's own access-friction checks beyond the generic ones: the same the
// browser-assisted adapter uses for that site (LinkedIn's login wall standing
// in for the content, its security check and its anti-bot interstitial, which
// can arrive with HTTP 200). Such a page is an access stop, never "unreadable".
export function pageCaptureFrictionDetector(siteKey: string) {
  return siteKey === "linkedin" ? detectLinkedInFriction : undefined;
}

export interface PageCaptureIngestorDependencies {
  repository: Pick<PrismaPageCaptureRepository, "markIngested" | "markHandedOff">;
  ingestion: RetrievalIngestionService;
  handoff: EvaluationHandoff;
  discovery: DiscoveryConfiguration;
  now?: () => Date;
  log?: { info(message: string): void; warn(message: string): void };
  diagnostics?: DiagnosticsSink;
}

// The one path from a staged job's read posting to an opportunity, shared by
// both detail mechanisms (the worker's server browser and the extension's
// background tabs): the single-job capture (envelope.ts) is mapped by the
// unchanged capturedListing, ingested by the normal retrieval ingestion
// (first sighting as its discovery time), recorded on the staged job, and
// handed once to the existing evaluation request. A capture the ingestion
// cannot read throws (RetrievedListingNormalizationError or
// ExtensionCaptureError); each mechanism decides what that means for it.
export function createPageCaptureIngestor(dependencies: PageCaptureIngestorDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? { info: () => undefined, warn: () => undefined };
  const diagnostics = dependencies.diagnostics ?? noDiagnostics;

  async function handOff(item: PageCaptureItemRecord, opportunityId: string, outcome: RetrievedListingOutcome) {
    const at = now();
    try {
      if (await dependencies.handoff.alreadyHandled(opportunityId)) {
        await dependencies.repository.markHandedOff(item.id, "ALREADY_HANDLED", at);
        diagnostics.event("job.handoff", { site: item.site, itemId: item.id, opportunityId, result: "ALREADY_HANDLED" });
        log.info(`page capture: job ${item.id} ${outcome.toLowerCase()}; already handed to the evaluation request`);
        return;
      }
      const result = await dependencies.handoff.request(opportunityId);
      await dependencies.repository.markHandedOff(item.id, result, at);
      diagnostics.event("job.handoff", { site: item.site, itemId: item.id, opportunityId, result });
      log.info(`page capture: job ${item.id} ${outcome.toLowerCase()} and handed to the evaluation request (${result})`);
    } catch (error) {
      const code = error instanceof EvaluationApiError ? error.code : "HANDOFF_FAILED";
      await dependencies.repository.markHandedOff(item.id, `FAILED:${code}`, at);
      // A refused request (no active profile, a rejected job) is a hand-off
      // outcome, not a failure of the job's capture.
      diagnostics.event("job.handoff", { site: item.site, itemId: item.id, opportunityId, result: `FAILED:${code}`, ...(code === "HANDOFF_FAILED" ? { error } : {}) });
      log.warn(`page capture: job ${item.id} ingested; the evaluation request was refused (${code})`);
    }
  }

  return {
    async ingest(item: PageCaptureItemRecord, capture: ExtensionCapture) {
      // A job's first read is discovered when its card was first seen. A
      // saved job read again (a refresh) is observed now: its new version,
      // the listing's last observation and the job's "last seen" are the
      // read's time, not the first sighting (November 7, 2026).
      const { raw } = capturedListing(capture, {
        pairingId: item.pairingId,
        domain: dependencies.discovery.domain,
        receivedAt: isPageCaptureRefresh(item.lastReason) ? now() : item.firstSeenAt,
        method: "batch",
      });
      const ingested = await dependencies.ingestion.ingest(raw);
      // A refresh (a saved job read again) records how it went; an
      // incomplete read (no page context, no application route) counts
      // towards the site's limit of incomplete refreshes in a row.
      const refresh = isPageCaptureRefresh(item.lastReason);
      const captureMetadata = (raw.sourceMetadata?.capture ?? {}) as { readQuality?: string };
      try {
        await dependencies.repository.markIngested(
          item.id,
          ingested.opportunityId,
          now(),
          refresh ? { outcome: ingested.outcome, incomplete: captureMetadata.readQuality !== "COMPLETE" || !raw.applicationUrl } : undefined,
        );
      } catch (error) {
        throw new PageCaptureSavedError("mark", ingested.opportunityId, error);
      }
      // A refresh, or a job handed off before (its read was repeated after a
      // failure), is never handed off again: no second triage, no evaluation.
      if (!refresh && (item.handoffOutcome === null || item.handoffOutcome === undefined)) {
        try {
          await handOff(item, ingested.opportunityId, ingested.outcome);
        } catch (error) {
          throw new PageCaptureSavedError("handoff", ingested.opportunityId, error);
        }
      }
      return ingested;
    },
  };
}

export type PageCaptureIngestor = ReturnType<typeof createPageCaptureIngestor>;

export function createPageCaptureAcquisition(dependencies: PageCaptureAcquisitionDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? { info: () => undefined, warn: () => undefined };
  const diagnostics = dependencies.diagnostics ?? noDiagnostics;
  const ingestor = createPageCaptureIngestor(dependencies);
  let recovered = false;
  const noBrowserWarned = new Set<string>();
  const ids = (item: PageCaptureItemRecord) => ({ site: item.site, itemId: item.id, listingId: item.siteJobId, batchId: item.lastBatchId });

  async function failOne(item: PageCaptureItemRecord, reason: "UNREADABLE" | "NOT_INGESTED") {
    const attempts = item.attempts + 1;
    const finalAttempt = attempts >= pageCaptureMaxAttempts;
    const nextAttemptAt = finalAttempt ? null : new Date(now().getTime() + pageCaptureRetryAfterMs);
    await dependencies.repository.markFailed(item.id, {
      status: finalAttempt ? "AWAITING_DETAILS" : "QUEUED",
      reason: finalAttempt && reason === "UNREADABLE" ? "UNREADABLE" : finalAttempt ? "FAILED_REPEATEDLY" : reason,
      nextAttemptAt,
      countAttempt: true,
    });
    diagnostics.event("job.decision", { ...ids(item), decision: "ATTEMPT_COUNTED", reason, attempts, finalAttempt, nextAttemptAt, refresh: isPageCaptureRefresh(item.lastReason) });
    return finalAttempt;
  }

  return {
    // One bounded pass for one site with queued jobs due. Returns null when
    // there is nothing to do.
    async runOnce(): Promise<AcquisitionPassResult | null> {
      if (!recovered) {
        const interrupted = await dependencies.repository.recoverInterrupted();
        recovered = true;
        diagnostics.event("recovery", { interruptedJobsQueuedAgain: interrupted });
      }
      const at = now();
      const enabled = new Set(dependencies.detailSites());
      const workerSites = [...enabled].filter((key) => {
        const site = pageCaptureSiteByKey(key);
        return site && pageCaptureDetailMechanism(site) === "server-browser";
      });
      // With a browser, jobs held for want of one return to the batch
      // (uncounted; November 7, 2026).
      if (dependencies.browser && dependencies.repository.releaseBrowserHold) {
        for (const siteKey of workerSites) {
          const released = await dependencies.repository.releaseBrowserHold(siteKey);
          if (released) {
            log.info(`page capture: ${released} job(s) waiting for a browser are queued again`);
            diagnostics.event("site.browser", { site: siteKey, decision: "RELEASED_BROWSER_HOLD", jobs: released });
          }
        }
      }
      for (const siteKey of await dependencies.repository.sitesWithQueued(at)) {
        const site = pageCaptureSiteByKey(siteKey);
        // A site read in the extension's background tabs is never fetched by
        // the worker, whatever its settings.
        if (!site || !enabled.has(siteKey) || pageCaptureDetailMechanism(site) !== "server-browser") continue;
        const stoppedUntil = await dependencies.repository.siteStoppedUntil(siteKey, at);
        if (stoppedUntil) continue;
        // No browser configured: a configuration problem, not the jobs'.
        // They wait in the queue, unclaimed and uncounted, with the reason
        // shown, and are read automatically once a worker has a browser; no
        // job needs a Retry of its own (November 7, 2026: a worker started
        // without RETRIEVAL_BROWSER_EXECUTABLE had moved every claimed job to
        // Awaiting details).
        if (!dependencies.browser) {
          const held = (await dependencies.repository.holdForBrowser?.(siteKey)) ?? 0;
          if (!noBrowserWarned.has(siteKey)) {
            noBrowserWarned.add(siteKey);
            log.warn(`page capture: ${site.name} jobs are waiting: no browser is configured (RETRIEVAL_BROWSER_EXECUTABLE); nothing is read`);
          }
          if (held) diagnostics.event("site.browser", { site: siteKey, decision: "HELD_NO_BROWSER", jobs: held });
          continue;
        }
        const items = await dependencies.repository.claimQueued(siteKey, at, pageCaptureDetailsPerPass);
        if (!items.length) continue;
        const result: AcquisitionPassResult = { site: siteKey, claimed: items.length, ingested: 0, awaitingDetails: 0, unavailable: 0, stopped: null };
        diagnostics.event("pass.start", {
          site: siteKey,
          claimed: items.length,
          jobs: items.map((item) => ({ itemId: item.id, listingId: item.siteJobId, batchId: item.lastBatchId, attempts: item.attempts, refresh: isPageCaptureRefresh(item.lastReason) })),
        });
        const passEnd = (reason: string | null) => diagnostics.event("pass.end", { ...result, reason });
        const browser = dependencies.browser;
        let driver: BrowserDriver | null = null;
        try {
          driver = await browser.launch();
          const session = createBrowserSession(driver, {
            minIntervalMs: site.detail.minIntervalMs,
            maxNavigations: pageCaptureDetailsPerPass,
            authCookieNames: site.detail.authCookieNames,
            detectFriction: pageCaptureFrictionDetector(siteKey),
            parse: parseRunnable,
            ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
          });
          // Database failures while ingesting a job (November 5, 2026: one
          // P2028 ended the pass and the worker with 20 jobs claimed):
          // - CONTENTION (the capture lock or a row busy): the job goes back
          //   to the queue uncounted and the pass ends; the next pass retries.
          // - PERMANENT (the job's own data refused): that job's failed
          //   attempt, counted; the pass continues.
          // - TRANSIENT (P2028, connection, pool): provisional. The job is
          //   queued as DB_PENDING, uncounted. The next ingestion (or, when
          //   none follows, a capture-lock probe) decides: success proves the
          //   failure was the job's own and it is counted once; a second
          //   transient failure means the database is unavailable, nothing is
          //   counted and the pass ends.
          // - UNKNOWN (a programming error): rethrown, as before.
          // Every status write here is best effort: when one fails, the
          // claimed jobs are left to the interrupted-job recovery
          // (ACQUIRING → QUEUED, uncounted), which the next pass re-runs.
          // Each provisional failure, and whether it is the job's own to
          // count once proven (a database signal from a job already saved
          // is never counted against it).
          const pending: Array<{ job: PageCaptureItemRecord; count: boolean }> = [];
          const finalizePending = async () => {
            for (const { job, count } of pending.splice(0)) {
              if (!count) continue;
              try {
                const counted = await dependencies.repository.finalizeProvisionalFailure(job.id, { now: now(), retryAfterMs: pageCaptureRetryAfterMs, maxAttempts: pageCaptureMaxAttempts });
                if (counted && job.attempts + 1 >= pageCaptureMaxAttempts) result.awaitingDetails += 1;
                diagnostics.event("job.decision", { ...ids(job), decision: counted ? "PROVISIONAL_FAILURE_COUNTED" : "PROVISIONAL_FAILURE_ALREADY_SETTLED", refresh: isPageCaptureRefresh(job.lastReason) });
              } catch (error) {
                // Unproven again: the job stays DB_PENDING, uncounted.
                diagnostics.event("job.decision", { ...ids(job), decision: "PROVISIONAL_FAILURE_UNPROVEN", error });
              }
            }
          };
          // Back to the queue uncounted; a refresh keeps its refresh state
          // (it is read again as a refresh, never handed off again).
          const queueUncounted = async (job: PageCaptureItemRecord, reason: "DB_PENDING" | "CAPTURE_BUSY" | "SAVED_UNMARKED") => {
            try {
              return await dependencies.repository.requeueUncounted(job.id, reason);
            } catch {
              return false;
            }
          };
          const endPass = async (reason: string) => {
            recovered = false;
            const released = await dependencies.repository.releaseClaimed(items.map((job) => job.id)).catch(() => null);
            result.stopped = reason;
            log.warn(`page capture: ${site.name} pass ended (${reason}); unread jobs are queued again, uncounted`);
            diagnostics.event("pass.decision", { site: siteKey, decision: reason, unreadJobsQueuedAgain: released, releaseFailed: released === null });
            passEnd(reason);
            return result;
          };
          try {
            for (const item of items) {
              let page;
              const navigationStarted = Date.now();
              try {
                page = await session.open(item.sourceUrl);
              } catch (error) {
                log.warn(`page capture: job ${item.id} stage=navigate ${error instanceof AdapterError ? `code=${error.code}` : "code=NETWORK"}`);
                const failure = { ...ids(item), stage: "navigate", code: error instanceof AdapterError ? error.code : "NETWORK", status: error instanceof AdapterError ? (error.details?.status ?? null) : null, elapsedMs: Date.now() - navigationStarted };
                diagnostics.event("job.navigate.failed", failure);
                dependencies.evidence?.record({ ...ids(item), url: item.sourceUrl, outcome: `NAVIGATE_${failure.code}`, elapsedMs: failure.elapsedMs, status: failure.status as number | null, error: diagnosticError(error) });
                if (error instanceof AdapterError && ["RATE_LIMITED", "ACCESS_DENIED"].includes(error.code)) {
                  const retryAfterSeconds = Number(error.details?.retryAfterSeconds ?? 0);
                  const until = new Date(Math.max(now().getTime() + pageCaptureFrictionBackoffMs, now().getTime() + retryAfterSeconds * 1000));
                  const reason = error.code === "RATE_LIMITED" ? "RATE_LIMITED" : "ACCESS_STOPPED";
                  await dependencies.repository.deferSite(siteKey, until, reason);
                  result.stopped = reason;
                  log.warn(`page capture: ${site.name} stopped detail reading (${error.code}); no further request until ${until.toISOString()}`);
                  diagnostics.event("site.stopped", { site: siteKey, reason, until });
                  passEnd(reason);
                  return result;
                }
                // A server error or failed load also ends the pass (the session
                // refuses further pages); the job is retried later.
                if ((await failOne(item, "NOT_INGESTED"))) result.awaitingDetails += 1;
                await dependencies.repository.deferSite(siteKey, new Date(now().getTime() + pageCaptureRetryAfterMs), "NOT_INGESTED");
                result.stopped = error instanceof AdapterError ? error.code : "NETWORK";
                passEnd(result.stopped);
                return result;
              }
              const navigationMs = Date.now() - navigationStarted;
              if (page.status === 404 || page.status === 410) {
                log.info(`page capture: job ${item.id} stage=navigate status=${page.status} (no longer available)`);
                diagnostics.event("job.decision", { ...ids(item), stage: "navigate", decision: "UNAVAILABLE", status: page.status, elapsedMs: navigationMs });
                dependencies.evidence?.record({ ...ids(item), url: item.sourceUrl, status: page.status, finalUrl: page.finalUrl, elapsedMs: navigationMs, html: page.html, servedHtml: page.servedHtml ?? null, outcome: "UNAVAILABLE" });
                await dependencies.repository.markFailed(item.id, { status: "UNAVAILABLE", reason: "NOT_INGESTED", nextAttemptAt: null, countAttempt: true });
                result.unavailable += 1;
                continue;
              }
              let extraction = readJobPage(page.document);
              // LinkedIn's employer apply link: from the rendered page, else
              // from the page as LinkedIn sent it (its scripts can remove the
              // element after load; approved precedence, step 2), else the
              // listing fallback set when the capture is mapped.
              let applicationRoute: "EMPLOYER_LINK_RENDERED" | "EMPLOYER_LINK_SERVED" | "LISTING_FALLBACK" | "NONE" = extraction?.posting?.applicationUrl ? "EMPLOYER_LINK_RENDERED" : "NONE";
              let servedApply: ApplyEvidence | null = null;
              const renderedApply = siteKey === "linkedin" || dependencies.evidence?.directory ? applyEvidence(page.document) : null;
              if (siteKey === "linkedin" && extraction?.posting && !extraction.posting.applicationUrl && page.servedHtml && page.servedHtml !== page.html) {
                const servedDocument = parseRunnable(page.servedHtml, page.finalUrl);
                servedApply = applyEvidence(servedDocument);
                const servedLink = readJobPage(servedDocument)?.posting?.applicationUrl ?? null;
                if (servedLink) {
                  extraction = { ...extraction, posting: { ...extraction.posting, applicationUrl: servedLink, applicationUrlBasis: "PAGE_APPLY_LINK" } };
                  applicationRoute = "EMPLOYER_LINK_SERVED";
                }
              }
              if (applicationRoute === "NONE" && siteKey === "linkedin" && extraction?.posting) applicationRoute = "LISTING_FALLBACK";
              const built = extraction?.posting
                ? buildCaptureEnvelope({ ...extraction, pageUrl: item.sourceUrl }, "page", { extensionVersion: pageCaptureAcquisitionVersion, capturedAt: now() })
                : null;
              const posting = extraction?.posting ?? null;
              const fieldNames = ["title", "company", "location", "description", "salaryText", "employmentType", "postedAt", "closingDate", "applicationUrl", "seniority"] as const;
              const fields = posting
                ? {
                    observed: fieldNames.filter((name) => Boolean((posting as unknown as Record<string, unknown>)[name])),
                    missing: fieldNames.filter((name) => !(posting as unknown as Record<string, unknown>)[name]),
                  }
                : { observed: [], missing: [...fieldNames] };
              diagnostics.event("job.read", {
                ...ids(item),
                status: page.status,
                finalUrl: diagnosticUrl(page.finalUrl),
                elapsedMs: navigationMs,
                posting: Boolean(posting),
                descriptionChars: posting?.description?.length ?? 0,
                applicationRoute,
                servedHtmlAvailable: Boolean(page.servedHtml),
                fieldsMissing: fields.missing,
              });
              dependencies.evidence?.record({
                ...ids(item),
                url: item.sourceUrl,
                status: page.status,
                finalUrl: page.finalUrl,
                elapsedMs: navigationMs,
                html: page.html,
                servedHtml: page.servedHtml ?? null,
                apply: { rendered: renderedApply, served: servedApply, route: posting ? applicationRoute : null, applicationUrl: posting?.applicationUrl ?? null },
                fields,
                outcome: built?.ok ? "READ" : "UNREADABLE",
              });
              if (!built?.ok) {
                log.warn(`page capture: job ${item.id} stage=read (no posting could be read from the page)`);
                if (await failOne(item, "UNREADABLE")) result.awaitingDetails += 1;
                continue;
              }
              const ingestStarted = Date.now();
              try {
                const ingested = await ingestor.ingest(item, built.envelope);
                result.ingested += 1;
                diagnostics.event("job.ingested", { ...ids(item), opportunityId: ingested.opportunityId, outcome: ingested.outcome, refresh: isPageCaptureRefresh(item.lastReason), elapsedMs: Date.now() - ingestStarted });
                // The capture path works: earlier provisional failures were
                // those jobs' own.
                await finalizePending();
              } catch (error) {
                const ingestMs = Date.now() - ingestStarted;
                if (error instanceof RetrievedListingNormalizationError || error instanceof ExtensionCaptureError) {
                  log.warn(`page capture: job ${item.id} stage=normalize (the posting could not be normalized)`);
                  diagnostics.event("job.failed", { ...ids(item), stage: "normalize", failure: "UNREADABLE", elapsedMs: ingestMs, error });
                  if (await failOne(item, "UNREADABLE")) result.awaitingDetails += 1;
                  continue;
                }
                // Saved, but a later step failed: never the job's failure.
                if (error instanceof PageCaptureSavedError) {
                  const failure = classifyJobDatabaseFailure(error.cause);
                  log.warn(`page capture: job ${item.id} saved as ${error.opportunityId}; stage=${error.stage} failure=${failure} ${formatWorkerError(error.cause)}`);
                  result.ingested += 1;
                  // Its item could not be marked: read it again later,
                  // uncounted (it lands on the same saved job).
                  const requeued = error.stage === "mark" ? await queueUncounted(item, "SAVED_UNMARKED") : true;
                  diagnostics.event("job.failed", {
                    ...ids(item),
                    stage: error.stage,
                    failure,
                    opportunityId: error.opportunityId,
                    elapsedMs: ingestMs,
                    error: error.cause,
                    decision: error.stage === "mark" ? (requeued ? "SAVED_UNMARKED_REQUEUED_UNCOUNTED" : "SAVED_UNMARKED_LEFT_FOR_RECOVERY") : "SAVED_HANDOFF_NOT_RECORDED",
                  });
                  if (failure === "CONTENTION" || failure === "TRANSIENT") {
                    if (pending.length > 0 || !requeued) return await endPass("DATABASE_UNAVAILABLE");
                    pending.push({ job: item, count: false });
                  }
                  continue;
                }
                const failure = classifyJobDatabaseFailure(error);
                log.warn(`page capture: job ${item.id} stage=ingest failure=${failure} ${formatWorkerError(error)}`);
                const failed = { ...ids(item), stage: "ingest", failure, elapsedMs: ingestMs, transactionSettings: captureTransactionSettings, error };
                if (failure === "UNKNOWN") {
                  diagnostics.event("job.failed", { ...failed, decision: "PASS_ENDED_UNKNOWN_ERROR" });
                  throw error;
                }
                if (failure === "PERMANENT") {
                  diagnostics.event("job.failed", { ...failed, decision: "ATTEMPT_COUNTED" });
                  if (await failOne(item, "NOT_INGESTED")) result.awaitingDetails += 1;
                  continue;
                }
                if (failure === "CONTENTION") {
                  const marked = await queueUncounted(item, "CAPTURE_BUSY");
                  diagnostics.event("job.failed", { ...failed, decision: marked ? "CAPTURE_BUSY_REQUEUED_UNCOUNTED" : "CAPTURE_BUSY_LEFT_FOR_RECOVERY" });
                  return await endPass("CAPTURE_BUSY");
                }
                // TRANSIENT: a second one in a row means the database, not
                // the job.
                const second = pending.length > 0;
                const marked = await queueUncounted(item, "DB_PENDING");
                diagnostics.event("job.failed", {
                  ...failed,
                  decision: !marked ? "DB_PENDING_NOT_WRITTEN_LEFT_FOR_RECOVERY" : second ? "DB_PENDING_SECOND_IN_A_ROW_OUTAGE" : "DB_PENDING_PROVISIONAL",
                });
                if (second || !marked) return await endPass("DATABASE_UNAVAILABLE");
                pending.push({ job: item, count: true });
              }
            }
            if (pending.length && dependencies.probeCapture) {
              try {
                await dependencies.probeCapture();
                diagnostics.event("probe", { site: siteKey, outcome: "HEALTHY" });
                await finalizePending();
              } catch (error) {
                log.warn(`page capture: capture-lock probe failed ${formatWorkerError(error)}`);
                diagnostics.event("probe", { site: siteKey, outcome: "FAILED", failure: classifyJobDatabaseFailure(error), error });
                return await endPass(classifyJobDatabaseFailure(error) === "CONTENTION" ? "CAPTURE_BUSY" : "DATABASE_UNAVAILABLE");
              }
            }
          } catch (error) {
            // Anything else ends the pass; no claimed job is left reading.
            recovered = false;
            const released = await dependencies.repository.releaseClaimed(items.map((job) => job.id)).catch(() => null);
            diagnostics.event("pass.decision", { site: siteKey, decision: "PASS_ENDED_UNKNOWN_ERROR", unreadJobsQueuedAgain: released, releaseFailed: released === null, error });
            passEnd("UNKNOWN_ERROR");
            throw error;
          }
          passEnd(null);
          return result;
        } catch (error) {
          // The browser could not start: the claimed jobs stay claimed until
          // the interrupted-job recovery returns them, uncounted.
          if (!driver) diagnostics.event("pass.decision", { site: siteKey, decision: "BROWSER_LAUNCH_FAILED", error });
          throw error;
        } finally {
          await driver?.close().catch(() => undefined);
        }
      }
      return null;
    },
  };
}

export type PageCaptureAcquisition = ReturnType<typeof createPageCaptureAcquisition>;

// The hand-off into the existing evaluation request (EvaluationService), whose
// pre-evaluator triage runs before any admission.
export function evaluationHandoff(service: {
  requestEvaluation(opportunityId: string, body: unknown): Promise<{ outcome: string }>;
  getTriage(opportunityId: string): Promise<unknown>;
  getOpenDeferral(opportunityId: string): Promise<unknown>;
  getLatestEvaluation(opportunityId: string): Promise<unknown>;
}): EvaluationHandoff {
  return {
    async alreadyHandled(opportunityId) {
      if (await service.getTriage(opportunityId)) return true;
      if (await service.getOpenDeferral(opportunityId)) return true;
      try {
        await service.getLatestEvaluation(opportunityId);
        return true;
      } catch (error) {
        if (error instanceof EvaluationApiError && error.code === "EVALUATION_NOT_FOUND") return false;
        throw error;
      }
    },
    async request(opportunityId) {
      const result = await service.requestEvaluation(opportunityId, {});
      return result.outcome;
    },
  };
}
