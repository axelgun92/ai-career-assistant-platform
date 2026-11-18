import {
  cleanCapturedText,
  cleanPageUrl,
  detailEnabledPageCaptureSiteKeys,
  enabledPageCaptureSiteKeys,
  linkedInJobIdFromUrl,
  pageCaptureBatchSchema,
  pageCaptureDetailMechanism,
  pageCaptureSelectionSchema,
  type PageCaptureDisposition,
  pageCaptureOffer,
  pageCaptureSiteByKey,
  pageCaptureSiteForUrl,
  pageCaptureTabStaleMs,
  pageCaptureTabUrlAllowed,
  type PageCaptureSiteSpec,
} from "@ai-career/core";
import type { ExtensionPairingRecord, PrismaPageCaptureRepository, StagedCardInput } from "@ai-career/database";
import type { ZodError } from "zod";
import { capturedPageIdentity, ExtensionCaptureError } from "./extension-capture";

// Intake for the browser extension's results-page capture (Mode B). The
// server checks the batch again, decides each card's listing identity itself
// (the same identity a single-job capture of the job's page gets), and stages
// the cards. Staging creates no opportunity and starts nothing: each job's
// full posting is read later by the site's approved automatic detail
// acquisition (page-capture-acquisition.ts), then goes through the normal
// ingestion path and, from there, the existing evaluation request with its
// pre-evaluator triage. A site whose detail acquisition is not verified keeps
// its cards awaiting details.

// The synthetic end-to-end test site is enabled only by this explicit test
// setting; it never matches a real host.
export const pageCaptureTestSiteEnabled = (environment: NodeJS.ProcessEnv = process.env) =>
  environment.PAGE_CAPTURE_TEST_SITE === "1";

// A real site whose detail mechanism is built but not yet verified live is
// enabled only by this explicit setting, for its targeted live acceptance
// (comma-separated site keys, for example "welcome-to-the-jungle"). Unset in
// normal use; it never enables the synthetic test site.
export const pageCaptureAcceptanceSites = (environment: NodeJS.ProcessEnv = process.env) =>
  (environment.PAGE_CAPTURE_ACCEPTANCE_SITES ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

export function enabledSitesFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const options = { includeTestSite: pageCaptureTestSiteEnabled(environment), acceptanceSites: pageCaptureAcceptanceSites(environment) };
  return {
    cards: enabledPageCaptureSiteKeys(options),
    details: detailEnabledPageCaptureSiteKeys(options),
  };
}

// The enabled sites whose details are read in the extension's background
// tabs (they are never fetched by the worker).
export const tabAcquisitionSites = (details: readonly string[]) =>
  details.filter((key) => {
    const site = pageCaptureSiteByKey(key);
    return site !== null && pageCaptureDetailMechanism(site) === "extension-tabs";
  });

export interface PageCaptureOutcome {
  url: string;
  title: string;
  // REFRESHING: already saved, and read again by this save (selective
  // re-observation, November 5, 2026).
  outcome: "QUEUED" | "SEEN_AGAIN" | "ALREADY_SAVED" | "REFRESHING" | "REJECTED";
  reason: string | null;
  opportunityId: string | null;
}

export interface PageCaptureResult {
  batchId: string;
  // The capture-history session of this save (its batchId), or null when no
  // card could be staged.
  sessionId: string | null;
  site: { key: string; name: string; automaticDetails: boolean };
  counts: { queued: number; seenAgain: number; alreadySaved: number; refreshing: number; rejected: number };
  outcomes: PageCaptureOutcome[];
  progressUrl: string;
  // Background-tab sites only: the jobs the extension now reads, in order,
  // one tab at a time; empty while the site is stopped (stoppedUntil).
  acquisition?: {
    mechanism: "extension-tabs";
    items: Array<{ itemId: string; url: string }>;
    minIntervalMs: number;
    loadTimeoutMs: number;
    rereadDelaysMs: number[];
    stoppedUntil: string | null;
  };
}

function issuesOf(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

const optional = (value: string | null) => (value === null ? null : cleanCapturedText(value) || null);

// Whether a card's link belongs to the page's own site (a link to another
// site, such as an external apply page, is not a card of this results page).
function cardBelongsTo(site: PageCaptureSiteSpec, url: string) {
  return pageCaptureSiteForUrl(url)?.key === site.key;
}

// A card's listing identity as staging decides it, or why it is not a job of
// this site (the same checks for a save and for continuous capture's
// selection).
type CardIdentity = { ok: true; externalId: string; sourceUrl: string; siteJobId: string | null } | { ok: false; reason: string };
function cardIdentity(site: PageCaptureSiteSpec, tabs: boolean, card: { url: string; siteJobId: string | null }): CardIdentity {
  const url = cleanPageUrl(card.url);
  if (!url) return { ok: false, reason: "The job's link or title could not be read" };
  if (!cardBelongsTo(site, url)) return { ok: false, reason: `The link is not a ${site.name} job page` };
  if (tabs && !pageCaptureTabUrlAllowed(site, url)) return { ok: false, reason: `The link is not on a ${site.name} address the extension may read` };
  let identity;
  try {
    identity = capturedPageIdentity(url);
  } catch {
    return { ok: false, reason: `The link is not a ${site.name} job page` };
  }
  if (!identity.externalId) return { ok: false, reason: "The link does not identify one job" };
  const urlJobId = site.key === "linkedin" ? linkedInJobIdFromUrl(url) : null;
  if (site.key === "linkedin" && (!urlJobId || (card.siteJobId && card.siteJobId !== urlJobId))) {
    return { ok: false, reason: "The card's job ID does not match its link" };
  }
  return { ok: true, externalId: identity.externalId, sourceUrl: identity.sourceUrl, siteJobId: urlJobId ?? card.siteJobId };
}

export interface PageCaptureSelectionResult {
  site: string;
  // While set, the site is stopped after an access restriction (continuous
  // capture stops; nothing is read before this time).
  stoppedUntil: string | null;
  cards: Array<{ url: string; disposition: PageCaptureDisposition; selectable: boolean; reason: string | null }>;
}

export function createPageCaptureService(dependencies: {
  repository: Pick<PrismaPageCaptureRepository, "stageBatch" | "siteStoppedUntil" | "expireTabItems"> & Partial<Pick<PrismaPageCaptureRepository, "selectionFor">>;
  enabledSites?: () => { cards: string[]; details: string[] };
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());
  const enabledSites = dependencies.enabledSites ?? (() => enabledSitesFromEnvironment());
  return {
    enabledSites,

    async capture(body: unknown, pairing: ExtensionPairingRecord): Promise<PageCaptureResult> {
      const parsed = pageCaptureBatchSchema.safeParse(body);
      if (!parsed.success) throw new ExtensionCaptureError("INVALID_CAPTURE", "The page capture is invalid", issuesOf(parsed.error));
      const batch = parsed.data;
      const enabled = enabledSites();
      const pageUrl = cleanPageUrl(batch.pageUrl);
      const offer = pageCaptureOffer(pageUrl, enabled.cards);
      if (!pageUrl || !offer.offered || !offer.site || offer.site.key !== batch.site) {
        throw new ExtensionCaptureError("UNSUPPORTED_PAGE", "Saving jobs from this page is not supported");
      }
      const site = offer.site;
      const automaticDetails = enabled.details.includes(site.key);
      // Background-tab reading (P2): the extension reads the jobs in the
      // user's Chrome, so the server only stages them and lists them back.
      const tabs = automaticDetails && pageCaptureDetailMechanism(site) === "extension-tabs" ? site.tabAcquisition! : null;
      const at = now();
      let stoppedUntil: Date | null = null;
      if (tabs) {
        await dependencies.repository.expireTabItems([site.key], new Date(at.getTime() - pageCaptureTabStaleMs));
        // After an access restriction the site is not contacted until its
        // wait ends: the jobs are kept, awaiting details, and nothing is read.
        stoppedUntil = await dependencies.repository.siteStoppedUntil(site.key, at);
      }
      // A saved job is never queued to be read again while its site is
      // stopped (either mechanism).
      const siteStopped = stoppedUntil !== null || (automaticDetails && (await dependencies.repository.siteStoppedUntil(site.key, at)) !== null);
      const outcomes: PageCaptureOutcome[] = [];
      const staged: Array<StagedCardInput & { index: number }> = [];
      const seen = new Set<string>();
      batch.cards.forEach((card, index) => {
        const title = cleanCapturedText(card.title);
        const reject = (reason: string) => outcomes.push({ url: card.url, title: title || card.url, outcome: "REJECTED", reason, opportunityId: null });
        if (!title) return reject("The job's link or title could not be read");
        const identity = cardIdentity(site, tabs !== null, card);
        if (!identity.ok) return reject(identity.reason);
        if (seen.has(identity.externalId)) return reject("The same job appears twice in this batch");
        seen.add(identity.externalId);
        staged.push({
          index,
          externalId: identity.externalId,
          sourceUrl: identity.sourceUrl,
          siteJobId: identity.siteJobId,
          title,
          company: optional(card.company),
          location: optional(card.location),
          postedText: optional(card.postedText),
        });
      });
      const results = staged.length
        ? await dependencies.repository.stageBatch({
            site: site.key,
            host: new URL(pageUrl).hostname.toLowerCase(),
            batchId: batch.batchId,
            pairingId: pairing.id,
            resultsPageUrl: pageUrl,
            receivedAt: tabs ? at : now(),
            detailsAvailable: automaticDetails && !stoppedUntil,
            ...(stoppedUntil ? { awaitingReason: "ACCESS_STOPPED" } : {}),
            ...(tabs ? { requeueAwaiting: true } : {}),
            refresh: { policy: site.refresh, siteStopped },
            cards: staged.map(({ index: _index, ...card }) => card),
            // Capture history: this save and the jobs it covered.
            session: {
              pageTitle: batch.pageTitle,
              counts: {
                ...batch.counts,
                staged: staged.length,
                rejected: outcomes.filter((item) => item.outcome === "REJECTED").length,
                // A continuous run's batch: a grouping label only.
                ...(batch.continuous ? { continuousRunId: batch.continuous.runId, continuousBatch: batch.continuous.batchNumber } : {}),
              },
            },
          })
        : [];
      results.forEach((result, position) => {
        const card = staged[position]!;
        outcomes.push({ url: card.sourceUrl, title: card.title, outcome: result.outcome, reason: null, opportunityId: result.opportunityId });
      });
      const count = (outcome: PageCaptureOutcome["outcome"]) => outcomes.filter((item) => item.outcome === outcome).length;
      return {
        batchId: batch.batchId,
        sessionId: results.length ? batch.batchId : null,
        site: { key: site.key, name: site.name, automaticDetails },
        counts: { queued: count("QUEUED"), seenAgain: count("SEEN_AGAIN"), alreadySaved: count("ALREADY_SAVED"), refreshing: count("REFRESHING"), rejected: count("REJECTED") },
        outcomes,
        progressUrl: "/extension/jobs",
        ...(tabs
          ? {
              acquisition: {
                mechanism: "extension-tabs" as const,
                items: stoppedUntil
                  ? []
                  : results.flatMap((result, position) =>
                      result.status === "QUEUED" ? [{ itemId: result.itemId, url: staged[position]!.sourceUrl }] : [],
                    ),
                minIntervalMs: site.detail.minIntervalMs,
                loadTimeoutMs: tabs.loadTimeoutMs,
                rereadDelaysMs: [...tabs.rereadDelaysMs],
                stoppedUntil: stoppedUntil?.toISOString() ?? null,
              },
            }
          : {}),
      };
    },

    // Continuous capture (November 15, 2026): which loaded cards a batch may
    // take, decided exactly as staging would decide them now. Read-only:
    // nothing is staged, queued or recorded.
    async selection(body: unknown): Promise<PageCaptureSelectionResult> {
      const parsed = pageCaptureSelectionSchema.safeParse(body);
      if (!parsed.success) throw new ExtensionCaptureError("INVALID_CAPTURE", "The selection request is invalid", issuesOf(parsed.error));
      const input = parsed.data;
      const enabled = enabledSites();
      const site = pageCaptureSiteByKey(input.site);
      if (!site || !enabled.cards.includes(site.key) || !site.continuation || !dependencies.repository.selectionFor) {
        throw new ExtensionCaptureError("UNSUPPORTED_PAGE", "Continuous capture is not available for this site");
      }
      const automaticDetails = enabled.details.includes(site.key);
      const tabs = automaticDetails && pageCaptureDetailMechanism(site) === "extension-tabs";
      const at = now();
      if (tabs) await dependencies.repository.expireTabItems([site.key], new Date(at.getTime() - pageCaptureTabStaleMs));
      const stoppedUntil = automaticDetails ? await dependencies.repository.siteStoppedUntil(site.key, at) : null;
      const identities = input.cards.map((card) => ({ card, identity: cardIdentity(site, tabs, card) }));
      const known = identities.flatMap(({ identity }) => (identity.ok ? [{ externalId: identity.externalId, siteJobId: identity.siteJobId }] : []));
      const decisions = await dependencies.repository.selectionFor({
        site: site.key,
        cards: known,
        detailsAvailable: automaticDetails && !stoppedUntil,
        requeueAwaiting: tabs,
        refresh: { policy: site.refresh, siteStopped: stoppedUntil !== null },
        now: at,
      });
      return {
        site: site.key,
        stoppedUntil: stoppedUntil?.toISOString() ?? null,
        cards: identities.map(({ card, identity }) => {
          if (!identity.ok) return { url: card.url, disposition: "REJECTED" as const, selectable: false, reason: identity.reason };
          const decision = decisions.get(identity.externalId) ?? { disposition: "NEW" as const, selectable: true };
          return { url: card.url, disposition: decision.disposition, selectable: decision.selectable && !stoppedUntil, reason: null };
        }),
      };
    },
  };
}

export type PageCaptureService = ReturnType<typeof createPageCaptureService>;
