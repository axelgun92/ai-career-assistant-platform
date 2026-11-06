import {
  pageCaptureDetailMechanism,
  pageCaptureFrictionBackoffMs,
  pageCaptureSiteByKey,
  pageCaptureTabResultValues,
  pageCaptureTabSignalValues,
  pageCaptureTabStopValues,
  pageCaptureTabUrlAllowed,
  RetrievedListingNormalizationError,
  type PageCaptureSiteSpec,
} from "@ai-career/core";
import type { PageCaptureItemRecord, PrismaPageCaptureRepository } from "@ai-career/database";
import { z } from "zod";
import { capturedPageIdentity, ExtensionCaptureError, parseCapture } from "./extension-capture";
import { PageCaptureSavedError, type PageCaptureIngestor } from "./page-capture-acquisition";

// Background-tab detail reading for the browser extension's results-page
// capture (Mode B, mechanism P2, Welcome to the Jungle / Otta). After "Save
// selected jobs" stages a batch, the extension reads each staged job's own
// page in the user's Chrome, one background tab at a time, and reports here:
//
// - start: whether the job is still to be read (not dismissed, not already
//   added, its site not stopped); the extension opens no tab otherwise;
// - details: the single-job capture its unchanged reader made of the page.
//   The page must be the staged job (the same listing identity a single-job
//   save of that page gets); then it goes through the shared ingestion path
//   (page-capture-acquisition.ts createPageCaptureIngestor), the same one the
//   worker's server-browser mechanism uses, and is handed once to the
//   existing evaluation request with its pre-evaluator triage;
// - result: why a page gave no posting (unreadable, gone, its tab closed, or
//   an access restriction);
// - stop: the rest of a batch the extension stopped (the user's Stop, a
//   removed permission, a stopped batch).
//
// An access restriction (a refusal, rate limit, server error, sign-in
// redirect or wall, challenge or CAPTCHA) stops every queued job of the site
// and the site itself for at least a day. Its jobs stay Awaiting details: the
// end of the wait resumes nothing; only a new save of a results page reads
// again. A page that is not the staged job stops the batch. Every report is
// idempotent: only a job still queued changes. Facts come only from the job's
// page; the card's own text is never ingested.

export class PageCaptureTabError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID_REQUEST" | "UNSUPPORTED_PAGE",
    message: string,
  ) {
    super(message);
    this.name = "PageCaptureTabError";
  }
}

const itemIds = z.array(z.uuid()).max(100).default([]);

const detailsSchema = z.object({ capture: z.unknown(), remainingItemIds: itemIds }).strict();

const resultSchema = z
  .object({
    result: z.enum(pageCaptureTabResultValues),
    signal: z.enum(pageCaptureTabSignalValues).nullable().default(null),
    // The address the tab ended on, when the extension could read it.
    finalUrl: z.string().trim().max(2048).nullable().default(null),
    remainingItemIds: itemIds,
  })
  .strict();

const stopSchema = z
  .object({ site: z.string().trim().min(1).max(60), itemIds: z.array(z.uuid()).min(1).max(100), reason: z.enum(pageCaptureTabStopValues) })
  .strict();

export type TabStartResponse =
  | { proceed: true; itemId: string; url: string }
  | { proceed: false; itemId: string; status: string; reason: string | null; stoppedUntil: string | null };

export interface TabReportResponse {
  itemId: string;
  outcome: "INGESTED" | "ALREADY_INGESTED" | "SKIPPED" | "IDENTITY_MISMATCH" | "UNREADABLE" | "UNAVAILABLE" | "INTERRUPTED" | "BLOCKED";
  status: string;
  opportunityId: string | null;
  // The extension stops its run: the batch ends (an identity mismatch) or
  // the site is stopped (an access restriction).
  stopBatch: boolean;
  stoppedUntil: string | null;
}

export interface PageCaptureTabDependencies {
  repository: Pick<
    PrismaPageCaptureRepository,
    "findById" | "startTabItem" | "settleTabItem" | "stopTabItems" | "stopTabSite" | "siteStoppedUntil"
  >;
  ingestor: Pick<PageCaptureIngestor, "ingest">;
  // The enabled sites (details); a tab site that is no longer enabled is not
  // read further.
  enabledSites: () => { cards: string[]; details: string[] };
  now?: () => Date;
}

function issuesMessage(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PageCaptureTabError("INVALID_REQUEST", `The report is invalid (${issuesMessage(parsed.error)})`);
  return parsed.data;
}

// Whether an address is the staged job's own page: the identity a
// single-job save of that address gets equals the staged one.
function sameJob(item: PageCaptureItemRecord, url: string | null): boolean {
  if (!url) return false;
  try {
    return capturedPageIdentity(url).externalId === item.externalId;
  } catch {
    return false;
  }
}

export function createPageCaptureTabService(dependencies: PageCaptureTabDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const repository = dependencies.repository;

  async function tabItem(id: string): Promise<{ item: PageCaptureItemRecord; site: PageCaptureSiteSpec }> {
    if (!z.uuid().safeParse(id).success) throw new PageCaptureTabError("NOT_FOUND", "Job not found");
    const item = await repository.findById(id);
    const site = item ? pageCaptureSiteByKey(item.site) : null;
    if (!item || !site) throw new PageCaptureTabError("NOT_FOUND", "Job not found");
    if (pageCaptureDetailMechanism(site) !== "extension-tabs") {
      throw new PageCaptureTabError("UNSUPPORTED_PAGE", "This job's details are not read by the extension");
    }
    return { item, site };
  }

  const view = (item: PageCaptureItemRecord, outcome: TabReportResponse["outcome"], extra: Partial<TabReportResponse> = {}): TabReportResponse => ({
    itemId: item.id,
    outcome,
    status: item.status,
    opportunityId: item.opportunityId,
    stopBatch: false,
    stoppedUntil: null,
    ...extra,
  });

  async function current(item: PageCaptureItemRecord) {
    return (await repository.findById(item.id)) ?? item;
  }

  // An access restriction: the job and every other queued job of the site
  // wait, and the site is not contacted before the wait ends (an existing
  // stop is kept, never shortened or extended by a repeated report).
  async function stopSite(item: PageCaptureItemRecord, site: PageCaptureSiteSpec, signal: string | null): Promise<TabReportResponse> {
    const at = now();
    const until = (await repository.siteStoppedUntil(site.key, at)) ?? new Date(at.getTime() + pageCaptureFrictionBackoffMs);
    const reason = signal === "HTTP_429" ? "RATE_LIMITED" : "ACCESS_STOPPED";
    await repository.settleTabItem(item.id, { status: "AWAITING_DETAILS", reason, nextAttemptAt: until });
    await repository.stopTabSite(site.key, until, reason);
    return view(await current(item), "BLOCKED", { stopBatch: true, stoppedUntil: until.toISOString() });
  }

  async function mismatch(item: PageCaptureItemRecord, site: PageCaptureSiteSpec, remaining: string[]): Promise<TabReportResponse> {
    await repository.settleTabItem(item.id, { status: "AWAITING_DETAILS", reason: "IDENTITY_MISMATCH", nextAttemptAt: null });
    await repository.stopTabItems(site.key, remaining, "BATCH_STOPPED");
    return view(await current(item), "IDENTITY_MISMATCH", { stopBatch: true });
  }

  return {
    async start(id: string): Promise<TabStartResponse> {
      const { item, site } = await tabItem(id);
      const refused = (status: string, reason: string | null, stoppedUntil: Date | null = null): TabStartResponse => ({
        proceed: false,
        itemId: item.id,
        status,
        reason,
        stoppedUntil: stoppedUntil?.toISOString() ?? null,
      });
      if (item.status !== "QUEUED") return refused(item.status, item.lastReason);
      const at = now();
      const stoppedUntil = await repository.siteStoppedUntil(site.key, at);
      if (stoppedUntil) {
        await repository.stopTabSite(site.key, stoppedUntil, "ACCESS_STOPPED");
        return refused("AWAITING_DETAILS", "ACCESS_STOPPED", stoppedUntil);
      }
      if (!dependencies.enabledSites().details.includes(site.key) || !pageCaptureTabUrlAllowed(site, item.sourceUrl)) {
        await repository.settleTabItem(item.id, { status: "AWAITING_DETAILS", reason: "NOT_SUPPORTED", nextAttemptAt: null });
        return refused("AWAITING_DETAILS", "NOT_SUPPORTED");
      }
      const started = await repository.startTabItem(item.id, site.key, at);
      if (!started) {
        const latest = await current(item);
        return refused(latest.status, latest.lastReason);
      }
      return { proceed: true, itemId: item.id, url: started.sourceUrl };
    },

    async details(id: string, body: unknown): Promise<TabReportResponse> {
      const { item, site } = await tabItem(id);
      const input = parse(detailsSchema, body);
      if (item.status === "INGESTED") return view(item, "ALREADY_INGESTED");
      if (item.status !== "QUEUED") return view(item, "SKIPPED");
      const capture = parseCapture(input.capture);
      if (!sameJob(item, capture.pageUrl)) return mismatch(item, site, input.remainingItemIds);
      try {
        const ingested = await dependencies.ingestor.ingest(item, capture);
        return view(await current(item), "INGESTED", { opportunityId: ingested.opportunityId });
      } catch (error) {
        if (error instanceof RetrievedListingNormalizationError || error instanceof ExtensionCaptureError) {
          await repository.settleTabItem(item.id, { status: "AWAITING_DETAILS", reason: "UNREADABLE", nextAttemptAt: null });
          return view(await current(item), "UNREADABLE");
        }
        // Saved and marked; only recording the hand-off failed: the job is in.
        if (error instanceof PageCaptureSavedError && error.stage === "handoff") {
          return view(await current(item), "INGESTED", { opportunityId: error.opportunityId });
        }
        // Saved, but its item could not be marked (the database is failing):
        // the item stays queued, uncounted, and a later read lands on the
        // same saved job.
        throw error instanceof PageCaptureSavedError ? error.cause : error;
      }
    },

    async result(id: string, body: unknown): Promise<TabReportResponse> {
      const { item, site } = await tabItem(id);
      const input = parse(resultSchema, body);
      // An access restriction always stops the site, even when repeated.
      if (input.result === "BLOCKED") return stopSite(item, site, input.signal);
      if (item.status === "INGESTED") return view(item, "ALREADY_INGESTED");
      if (item.status !== "QUEUED") return view(item, "SKIPPED");
      if (input.result === "INTERRUPTED") {
        await repository.settleTabItem(item.id, { status: "AWAITING_DETAILS", reason: "INTERRUPTED", nextAttemptAt: null });
        return view(await current(item), "INTERRUPTED");
      }
      // The page that loaded must still be the staged job: a redirect to
      // another job, a search page or another site stops the batch.
      if (!sameJob(item, input.finalUrl)) return mismatch(item, site, input.remainingItemIds);
      if (input.result === "UNAVAILABLE") {
        await repository.settleTabItem(item.id, { status: "UNAVAILABLE", reason: "NOT_INGESTED", nextAttemptAt: null });
        return view(await current(item), "UNAVAILABLE");
      }
      await repository.settleTabItem(item.id, { status: "AWAITING_DETAILS", reason: "UNREADABLE", nextAttemptAt: null });
      return view(await current(item), "UNREADABLE");
    },

    async stop(body: unknown): Promise<{ stopped: number }> {
      const input = parse(stopSchema, body);
      const site = pageCaptureSiteByKey(input.site);
      if (!site || pageCaptureDetailMechanism(site) !== "extension-tabs") {
        throw new PageCaptureTabError("UNSUPPORTED_PAGE", "This site's details are not read by the extension");
      }
      return { stopped: await repository.stopTabItems(site.key, input.itemIds, input.reason) };
    },
  };
}

export type PageCaptureTabService = ReturnType<typeof createPageCaptureTabService>;
