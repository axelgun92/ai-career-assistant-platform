import {
  cleanCapturedText,
  cleanPageUrl,
  detailEnabledPageCaptureSiteKeys,
  enabledPageCaptureSiteKeys,
  linkedInJobIdFromUrl,
  pageCaptureBatchSchema,
  pageCaptureOffer,
  pageCaptureSiteForUrl,
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

export function enabledSitesFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const includeTestSite = pageCaptureTestSiteEnabled(environment);
  return {
    cards: enabledPageCaptureSiteKeys({ includeTestSite }),
    details: detailEnabledPageCaptureSiteKeys({ includeTestSite }),
  };
}

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
  repository: Pick<PrismaPageCaptureRepository, "stageBatch">;
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
      const outcomes: PageCaptureOutcome[] = [];
      const staged: Array<StagedCardInput & { index: number }> = [];
      const seen = new Set<string>();
      batch.cards.forEach((card, index) => {
        const title = cleanCapturedText(card.title);
        const reject = (reason: string) => outcomes.push({ url: card.url, title: title || card.url, outcome: "REJECTED", reason, opportunityId: null });
        const url = cleanPageUrl(card.url);
        if (!url || !title) return reject("The job's link or title could not be read");
        if (!cardBelongsTo(site, url)) return reject(`The link is not a ${site.name} job page`);
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
      const automaticDetails = enabled.details.includes(site.key);
      const results = staged.length
        ? await dependencies.repository.stageBatch({
            site: site.key,
            host: new URL(pageUrl).hostname.toLowerCase(),
            batchId: batch.batchId,
            pairingId: pairing.id,
            resultsPageUrl: pageUrl,
            receivedAt: now(),
            detailsAvailable: automaticDetails,
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
      };
    },
  };
}

export type PageCaptureService = ReturnType<typeof createPageCaptureService>;
