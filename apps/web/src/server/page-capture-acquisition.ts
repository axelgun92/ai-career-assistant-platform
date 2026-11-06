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
import type { PageCaptureItemRecord, PrismaPageCaptureRepository } from "@ai-career/database";
import { AdapterError, createBrowserSession, detectLinkedInFriction, type BrowserDriver } from "@ai-career/discovery";
import { JSDOM } from "jsdom";
import { buildCaptureEnvelope } from "../../../extension/src/envelope";
import { extractJobPosting, type PageExtraction } from "../../../extension/src/extract";
import { EvaluationApiError } from "./evaluation-errors";
import { capturedListing, ExtensionCaptureError } from "./extension-capture";
import { classifyJobDatabaseFailure, formatWorkerError } from "./worker-errors";

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
  >;
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

  async function handOff(item: PageCaptureItemRecord, opportunityId: string, outcome: RetrievedListingOutcome) {
    const at = now();
    try {
      if (await dependencies.handoff.alreadyHandled(opportunityId)) {
        await dependencies.repository.markHandedOff(item.id, "ALREADY_HANDLED", at);
        return;
      }
      const result = await dependencies.handoff.request(opportunityId);
      await dependencies.repository.markHandedOff(item.id, result, at);
      log.info(`page capture: job ${item.id} ${outcome.toLowerCase()} and handed to the evaluation request (${result})`);
    } catch (error) {
      const code = error instanceof EvaluationApiError ? error.code : "HANDOFF_FAILED";
      await dependencies.repository.markHandedOff(item.id, `FAILED:${code}`, at);
      log.warn(`page capture: job ${item.id} ingested; the evaluation request was refused (${code})`);
    }
  }

  return {
    async ingest(item: PageCaptureItemRecord, capture: ExtensionCapture) {
      const { raw } = capturedListing(capture, {
        pairingId: item.pairingId,
        domain: dependencies.discovery.domain,
        receivedAt: item.firstSeenAt,
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
  const ingestor = createPageCaptureIngestor(dependencies);
  let recovered = false;

  async function failOne(item: PageCaptureItemRecord, reason: "UNREADABLE" | "NOT_INGESTED") {
    const attempts = item.attempts + 1;
    const finalAttempt = attempts >= pageCaptureMaxAttempts;
    await dependencies.repository.markFailed(item.id, {
      status: finalAttempt ? "AWAITING_DETAILS" : "QUEUED",
      reason: finalAttempt && reason === "UNREADABLE" ? "UNREADABLE" : finalAttempt ? "FAILED_REPEATEDLY" : reason,
      nextAttemptAt: finalAttempt ? null : new Date(now().getTime() + pageCaptureRetryAfterMs),
      countAttempt: true,
    });
    return finalAttempt;
  }

  return {
    // One bounded pass for one site with queued jobs due. Returns null when
    // there is nothing to do.
    async runOnce(): Promise<AcquisitionPassResult | null> {
      if (!recovered) {
        await dependencies.repository.recoverInterrupted();
        recovered = true;
      }
      const at = now();
      const enabled = new Set(dependencies.detailSites());
      for (const siteKey of await dependencies.repository.sitesWithQueued(at)) {
        const site = pageCaptureSiteByKey(siteKey);
        // A site read in the extension's background tabs is never fetched by
        // the worker, whatever its settings.
        if (!site || !enabled.has(siteKey) || pageCaptureDetailMechanism(site) !== "server-browser") continue;
        const stoppedUntil = await dependencies.repository.siteStoppedUntil(siteKey, at);
        if (stoppedUntil) continue;
        const items = await dependencies.repository.claimQueued(siteKey, at, pageCaptureDetailsPerPass);
        if (!items.length) continue;
        const result: AcquisitionPassResult = { site: siteKey, claimed: items.length, ingested: 0, awaitingDetails: 0, unavailable: 0, stopped: null };
        if (!dependencies.browser) {
          for (const item of items) {
            await dependencies.repository.markFailed(item.id, { status: "AWAITING_DETAILS", reason: "NO_BROWSER", nextAttemptAt: null, countAttempt: false });
          }
          result.awaitingDetails = items.length;
          return result;
        }
        let driver: BrowserDriver | null = null;
        try {
          driver = await dependencies.browser.launch();
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
              } catch {
                // Unproven again: the job stays DB_PENDING, uncounted.
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
            await dependencies.repository.releaseClaimed(items.map((job) => job.id)).catch(() => undefined);
            result.stopped = reason;
            log.warn(`page capture: ${site.name} pass ended (${reason}); unread jobs are queued again, uncounted`);
            return result;
          };
          try {
            for (const item of items) {
              let page;
              try {
                page = await session.open(item.sourceUrl);
              } catch (error) {
                log.warn(`page capture: job ${item.id} stage=navigate ${error instanceof AdapterError ? `code=${error.code}` : "code=NETWORK"}`);
                if (error instanceof AdapterError && ["RATE_LIMITED", "ACCESS_DENIED"].includes(error.code)) {
                  const retryAfterSeconds = Number(error.details?.retryAfterSeconds ?? 0);
                  const until = new Date(Math.max(now().getTime() + pageCaptureFrictionBackoffMs, now().getTime() + retryAfterSeconds * 1000));
                  const reason = error.code === "RATE_LIMITED" ? "RATE_LIMITED" : "ACCESS_STOPPED";
                  await dependencies.repository.deferSite(siteKey, until, reason);
                  result.stopped = reason;
                  log.warn(`page capture: ${site.name} stopped detail reading (${error.code}); no further request until ${until.toISOString()}`);
                  return result;
                }
                // A server error or failed load also ends the pass (the session
                // refuses further pages); the job is retried later.
                if ((await failOne(item, "NOT_INGESTED"))) result.awaitingDetails += 1;
                await dependencies.repository.deferSite(siteKey, new Date(now().getTime() + pageCaptureRetryAfterMs), "NOT_INGESTED");
                result.stopped = error instanceof AdapterError ? error.code : "NETWORK";
                return result;
              }
              if (page.status === 404 || page.status === 410) {
                log.info(`page capture: job ${item.id} stage=navigate status=${page.status} (no longer available)`);
                await dependencies.repository.markFailed(item.id, { status: "UNAVAILABLE", reason: "NOT_INGESTED", nextAttemptAt: null, countAttempt: true });
                result.unavailable += 1;
                continue;
              }
              const extraction = readJobPage(page.document);
              const built = extraction?.posting
                ? buildCaptureEnvelope({ ...extraction, pageUrl: item.sourceUrl }, "page", { extensionVersion: pageCaptureAcquisitionVersion, capturedAt: now() })
                : null;
              if (!built?.ok) {
                log.warn(`page capture: job ${item.id} stage=read (no posting could be read from the page)`);
                if (await failOne(item, "UNREADABLE")) result.awaitingDetails += 1;
                continue;
              }
              try {
                await ingestor.ingest(item, built.envelope);
                result.ingested += 1;
                // The capture path works: earlier provisional failures were
                // those jobs' own.
                await finalizePending();
              } catch (error) {
                if (error instanceof RetrievedListingNormalizationError || error instanceof ExtensionCaptureError) {
                  log.warn(`page capture: job ${item.id} stage=normalize (the posting could not be normalized)`);
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
                  if (failure === "CONTENTION" || failure === "TRANSIENT") {
                    if (pending.length > 0 || !requeued) return await endPass("DATABASE_UNAVAILABLE");
                    pending.push({ job: item, count: false });
                  }
                  continue;
                }
                const failure = classifyJobDatabaseFailure(error);
                log.warn(`page capture: job ${item.id} stage=ingest failure=${failure} ${formatWorkerError(error)}`);
                if (failure === "UNKNOWN") throw error;
                if (failure === "PERMANENT") {
                  if (await failOne(item, "NOT_INGESTED")) result.awaitingDetails += 1;
                  continue;
                }
                if (failure === "CONTENTION") {
                  await queueUncounted(item, "CAPTURE_BUSY");
                  return await endPass("CAPTURE_BUSY");
                }
                // TRANSIENT: a second one in a row means the database, not
                // the job.
                const second = pending.length > 0;
                const marked = await queueUncounted(item, "DB_PENDING");
                if (second || !marked) return await endPass("DATABASE_UNAVAILABLE");
                pending.push({ job: item, count: true });
              }
            }
            if (pending.length && dependencies.probeCapture) {
              try {
                await dependencies.probeCapture();
                await finalizePending();
              } catch (error) {
                log.warn(`page capture: capture-lock probe failed ${formatWorkerError(error)}`);
                return await endPass(classifyJobDatabaseFailure(error) === "CONTENTION" ? "CAPTURE_BUSY" : "DATABASE_UNAVAILABLE");
              }
            }
          } catch (error) {
            // Anything else ends the pass; no claimed job is left reading.
            recovered = false;
            await dependencies.repository.releaseClaimed(items.map((job) => job.id)).catch(() => undefined);
            throw error;
          }
          return result;
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
