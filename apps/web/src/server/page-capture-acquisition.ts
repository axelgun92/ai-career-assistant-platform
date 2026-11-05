import {
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

export interface PageCaptureAcquisitionDependencies {
  repository: Pick<
    PrismaPageCaptureRepository,
    "sitesWithQueued" | "siteStoppedUntil" | "claimQueued" | "markIngested" | "markFailed" | "deferSite" | "markHandedOff" | "recoverInterrupted"
  >;
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
      await dependencies.repository.markIngested(item.id, ingested.opportunityId, now());
      await handOff(item, ingested.opportunityId, ingested.outcome);
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
      nextAttemptAt: finalAttempt ? null : new Date(now().getTime() + 60 * 60 * 1000),
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
          for (const item of items) {
            let page;
            try {
              page = await session.open(item.sourceUrl);
            } catch (error) {
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
              await dependencies.repository.deferSite(siteKey, new Date(now().getTime() + 60 * 60 * 1000), "NOT_INGESTED");
              result.stopped = error instanceof AdapterError ? error.code : "NETWORK";
              return result;
            }
            if (page.status === 404 || page.status === 410) {
              await dependencies.repository.markFailed(item.id, { status: "UNAVAILABLE", reason: "NOT_INGESTED", nextAttemptAt: null, countAttempt: true });
              result.unavailable += 1;
              continue;
            }
            const extraction = readJobPage(page.document);
            const built = extraction?.posting
              ? buildCaptureEnvelope({ ...extraction, pageUrl: item.sourceUrl }, "page", { extensionVersion: pageCaptureAcquisitionVersion, capturedAt: now() })
              : null;
            if (!built?.ok) {
              if (await failOne(item, "UNREADABLE")) result.awaitingDetails += 1;
              continue;
            }
            try {
              await ingestor.ingest(item, built.envelope);
              result.ingested += 1;
            } catch (error) {
              if (error instanceof RetrievedListingNormalizationError || error instanceof ExtensionCaptureError) {
                if (await failOne(item, "UNREADABLE")) result.awaitingDetails += 1;
                continue;
              }
              throw error;
            }
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
