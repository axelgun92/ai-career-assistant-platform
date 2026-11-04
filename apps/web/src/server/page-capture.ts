import {
  cleanCapturedText,
  cleanPageUrl,
  detailEnabledPageCaptureSiteKeys,
  enabledPageCaptureSiteKeys,
  linkedInJobIdFromUrl,
  pageCaptureBatchSchema,
  pageCaptureDetailMechanism,
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
  outcome: "QUEUED" | "SEEN_AGAIN" | "ALREADY_SAVED" | "REJECTED";
  reason: string | null;
  opportunityId: string | null;
}

export interface PageCaptureResult {
  batchId: string;
  site: { key: string; name: string; automaticDetails: boolean };
  counts: { queued: number; seenAgain: number; alreadySaved: number; rejected: number };
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

export function createPageCaptureService(dependencies: {
  repository: Pick<PrismaPageCaptureRepository, "stageBatch" | "siteStoppedUntil" | "expireTabItems">;
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
      const outcomes: PageCaptureOutcome[] = [];
      const staged: Array<StagedCardInput & { index: number }> = [];
      const seen = new Set<string>();
      batch.cards.forEach((card, index) => {
        const title = cleanCapturedText(card.title);
        const reject = (reason: string) => outcomes.push({ url: card.url, title: title || card.url, outcome: "REJECTED", reason, opportunityId: null });
        const url = cleanPageUrl(card.url);
        if (!url || !title) return reject("The job's link or title could not be read");
        if (!cardBelongsTo(site, url)) return reject(`The link is not a ${site.name} job page`);
        if (tabs && !pageCaptureTabUrlAllowed(site, url)) return reject(`The link is not on a ${site.name} address the extension may read`);
        let identity;
        try {
          identity = capturedPageIdentity(url);
        } catch {
          return reject(`The link is not a ${site.name} job page`);
        }
        if (!identity.externalId) return reject("The link does not identify one job");
        const urlJobId = site.key === "linkedin" ? linkedInJobIdFromUrl(url) : null;
        if (site.key === "linkedin" && (!urlJobId || (card.siteJobId && card.siteJobId !== urlJobId))) {
          return reject("The card's job ID does not match its link");
        }
        if (seen.has(identity.externalId)) return reject("The same job appears twice in this batch");
        seen.add(identity.externalId);
        staged.push({
          index,
          externalId: identity.externalId,
          sourceUrl: identity.sourceUrl,
          siteJobId: urlJobId ?? card.siteJobId,
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
            cards: staged.map(({ index: _index, ...card }) => card),
          })
        : [];
      results.forEach((result, position) => {
        const card = staged[position]!;
        outcomes.push({ url: card.sourceUrl, title: card.title, outcome: result.outcome, reason: null, opportunityId: result.opportunityId });
      });
      const count = (outcome: PageCaptureOutcome["outcome"]) => outcomes.filter((item) => item.outcome === outcome).length;
      return {
        batchId: batch.batchId,
        site: { key: site.key, name: site.name, automaticDetails },
        counts: { queued: count("QUEUED"), seenAgain: count("SEEN_AGAIN"), alreadySaved: count("ALREADY_SAVED"), rejected: count("REJECTED") },
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
  };
}

export type PageCaptureService = ReturnType<typeof createPageCaptureService>;
