import { z } from "zod";
import { cleanPageUrl, extensionCaptureLimits, isHttpUrl } from "./extension-capture";
import { knownSiteForUrl } from "./known-sites";

// Bounded results-page capture ("Mode B", the browser extension's second
// mode beside single-job capture). On a supported results page, and only when
// the user asks, the extension reads at most 25 job cards that are already
// loaded in the page: no scrolling, paging, clicking or navigation. The cards
// are staged, then each job's full posting is read by the site's approved
// automatic detail-acquisition mechanism and goes through the normal
// ingestion path; only then can it be triaged and evaluated. A card alone is
// never an opportunity and is never evaluated.
//
// This file is data and validation only. It imports nothing but zod and Core
// helpers the extension already bundles.

export const pageCaptureSchemaVersion = 1;
export const pageCaptureMaxCards = 25;
export const pageCaptureMaxBytes = 48 * 1024;
export const pageCaptureLimits = {
  url: extensionCaptureLimits.url,
  title: extensionCaptureLimits.title,
  shortText: extensionCaptureLimits.shortText,
  siteJobId: extensionCaptureLimits.siteJobId,
  postedText: 80,
} as const;

// How the extension reads a site's results list. Plain JSON: it is passed as
// the only argument to the injected reader, so it can hold no functions.
// Patterns are regular-expression sources, case-insensitive.
export interface PageCaptureReaderSpec {
  // Absolute job-detail URLs that identify a card's job.
  jobLink: string;
  // Optional: attributes on a card (or its ancestors up to the card) that
  // hold the job ID, and the pattern whose first group is the ID; with
  // jobUrlTemplate ("{id}"), a card with an ID but no matching link still has
  // a job URL.
  jobIdAttributes: string[];
  jobIdPattern: string | null;
  jobUrlTemplate: string | null;
  // Optional selectors inside a card; without them the generic reading
  // applies (title from the job link or a heading; other fields Unknown).
  titleSelector: string | null;
  companySelector: string | null;
  locationSelector: string | null;
  postedSelector: string | null;
  // Containers whose cards are never read (a detail pane, recommendation
  // modules, side panels), in addition to the generic exclusions.
  excludeSelector: string | null;
}

export interface PageCaptureSiteSpec {
  key: string;
  name: string;
  // The known-site keys (Core known-sites) the spec covers; or, for the
  // synthetic end-to-end test site only, exact hosts.
  knownSiteKeys: string[];
  hosts: string[];
  // Pages where "Save jobs on this page" is offered (pathname pattern), and
  // paths never read (account, feed, messaging, profile).
  resultsPath: string;
  excludedPaths: string | null;
  reader: PageCaptureReaderSpec;
  // Evidence-based flags. Card reading is offered only when cardVerified; a
  // site's jobs are fetched for details only when detailVerified, set from the
  // bounded P1 verification experiment. Both are false until that evidence
  // exists; a site that is not detailVerified has an incomplete Mode B.
  cardVerified: boolean;
  detailVerified: boolean;
  detail: {
    // Seconds between detail page loads, sequential.
    minIntervalMs: number;
    // Cookies whose appearance means an account session (stop).
    authCookieNames: string[];
  };
  // The detail mechanism. Absent: the retrieval worker reads each job's page
  // in a fresh logged-out headless browser (server-browser, P1). Present: the
  // extension reads each job's page in the user's own Chrome, one background
  // tab at a time (extension-tabs, P2), started by the same "Save selected
  // jobs" action; the server never fetches that site's pages.
  tabAcquisition?: PageCaptureTabAcquisitionSpec;
  // When a job already saved is read again in a later save (selective
  // re-observation, November 5, 2026).
  refresh: PageCaptureRefreshPolicy;
  // True only for the synthetic test site, enabled by the server's explicit
  // test setting; never matches a real host.
  testOnly: boolean;
}

// Selective re-observation (Workstream B, November 5, 2026). Mode B stays one
// action over at most 25 loaded jobs; a job already saved is read again only
// when one of these holds, never on every save:
// - its latest read is older than the site's reader revision (an extraction
//   fix shipped since: the November 4–5 records are corrected this way, once);
// - its latest read was incomplete (no page context, or no application route
//   or description) and was at least incompleteRefreshAfterHours ago, at most
//   maxIncompleteRefreshes times in a row (render and timing failures clear
//   within hours; a page that genuinely lacks a field is not re-fetched on
//   every save);
// - its latest read is at least staleAfterDays old (older than any posting
//   age the cards still show as current).
export interface PageCaptureRefreshPolicy {
  minReaderRevision: number;
  incompleteRefreshAfterHours: number;
  maxIncompleteRefreshes: number;
  staleAfterDays: number;
}
const defaultRefreshPolicy: PageCaptureRefreshPolicy = { minReaderRevision: 1, incompleteRefreshAfterHours: 24, maxIncompleteRefreshes: 3, staleAfterDays: 14 };

export type PageCaptureRefreshReason = "OUTDATED_READER" | "INCOMPLETE" | "STALE";

// Whether a saved job seen in a new save is read again, and why.
export function pageCaptureRefreshReason(input: {
  policy: PageCaptureRefreshPolicy;
  latestRead: { readerRevision: number; readQuality: "COMPLETE" | "PARTIAL" | null; lastReadAt: Date };
  hasApplicationRoute: boolean;
  hasDescription: boolean;
  incompleteRefreshes: number;
  now: Date;
}): PageCaptureRefreshReason | null {
  const { policy, latestRead } = input;
  if (latestRead.readerRevision < policy.minReaderRevision) return "OUTDATED_READER";
  const age = input.now.getTime() - latestRead.lastReadAt.getTime();
  const incomplete = latestRead.readQuality === "PARTIAL" || !input.hasApplicationRoute || !input.hasDescription;
  if (incomplete && input.incompleteRefreshes < policy.maxIncompleteRefreshes && age >= policy.incompleteRefreshAfterHours * 3_600_000) return "INCOMPLETE";
  if (age >= policy.staleAfterDays * 86_400_000) return "STALE";
  return null;
}

// A job's refresh state lives in its lastReason (no schema change):
//   REFRESH:<n>                    queued to be read again
//   REFRESHED:<CHANGED|UNCHANGED|…>:<n>   read again
//   REFRESH_<UNAVAILABLE|DEFERRED|FAILED|STOPPED>:<n>   not read again; the
//                                  saved job is untouched
// where <n> counts the incomplete refreshes in a row.
export const pageCaptureRefreshMarker = /^REFRESH:(\d+)$/;
export function pageCaptureIncompleteRefreshes(lastReason: string | null | undefined): number {
  const match = /^(?:REFRESH|REFRESHED:[A-Z_]+|REFRESH_[A-Z]+):(\d+)$/.exec(lastReason ?? "");
  return match ? Number(match[1]) : 0;
}
export function isPageCaptureRefresh(lastReason: string | null | undefined): boolean {
  return pageCaptureRefreshMarker.test(lastReason ?? "");
}

// How the extension reads a site's job pages in background tabs (P2).
export interface PageCaptureTabAcquisitionSpec {
  // The only hosts the extension may open and read for the site: its
  // optional host permissions, requested inside the Save click and equal to
  // the manifest's optional_host_permissions (checked by a unit test).
  hostPermissions: string[];
  // Longest wait for a tab to finish loading.
  loadTimeoutMs: number;
  // The single-job reader runs when the page has loaded, then again on the
  // same document after these delays (no reload) while no posting is found.
  rereadDelaysMs: number[];
}

export type PageCaptureDetailMechanism = "server-browser" | "extension-tabs";

export const pageCaptureDetailMechanism = (site: Pick<PageCaptureSiteSpec, "tabAcquisition">): PageCaptureDetailMechanism =>
  site.tabAcquisition ? "extension-tabs" : "server-browser";

// Whether a job URL is on a host the site's background-tab reading may open:
// https only, and only the hosts of its host permissions.
export function pageCaptureTabUrlAllowed(site: Pick<PageCaptureSiteSpec, "tabAcquisition">, value: string): boolean {
  if (!site.tabAcquisition || !isHttpUrl(value)) return false;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return site.tabAcquisition.hostPermissions.some((pattern) => {
    const match = /^https:\/\/([^/*]+)\/\*$/.exec(pattern);
    return match !== null && match[1]!.toLowerCase() === url.hostname.toLowerCase();
  });
}

export const pageCaptureSites: readonly PageCaptureSiteSpec[] = [
  {
    key: "linkedin",
    name: "LinkedIn",
    knownSiteKeys: ["linkedin"],
    hosts: [],
    resultsPath: "^/jobs/(search|collections)(/|$)",
    excludedPaths: "^/(feed|in|messaging|mynetwork|notifications|company)(/|$)",
    reader: {
      jobLink: "^https://(www\\.)?linkedin\\.com/jobs/view/(?:[^/?#]*-)?(\\d{5,20})/?",
      jobIdAttributes: ["data-job-id", "data-occludable-job-id", "data-entity-urn"],
      jobIdPattern: "(?:^|:)(\\d{5,20})$",
      jobUrlTemplate: "https://www.linkedin.com/jobs/view/{id}",
      titleSelector: ".job-card-list__title, .job-card-list__title--link, .base-search-card__title, .artdeco-entity-lockup__title",
      companySelector: ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .base-search-card__subtitle",
      locationSelector: ".job-card-container__metadata-item, .artdeco-entity-lockup__caption, .job-search-card__location",
      postedSelector: "time, .job-search-card__listdate",
      excludeSelector: ".jobs-search__job-details--container, .jobs-details, .job-view-layout, .scaffold-layout__detail, .jobs-home-recommendations, aside",
    },
    // Verified November 3, 2026. F0: 5 real logged-out public result cards,
    // read exactly by this reader (tests/unit/page-capture-linkedin.test.ts).
    // P1 at c946e1b: PASS, 5/5 job pages read in a fresh logged-out browser
    // (1,731–7,253 description characters), with no access restriction.
    // Approved for Mode B by Alex (D-A, November 4, 2026). Mode B for
    // LinkedIn stays incomplete until its targeted end-to-end acceptance.
    cardVerified: true,
    detailVerified: true,
    detail: { minIntervalMs: 5_000, authCookieNames: ["li_at"] },
    refresh: defaultRefreshPolicy,
    testOnly: false,
  },
  {
    key: "welcome-to-the-jungle",
    name: "Welcome to the Jungle / Otta",
    knownSiteKeys: ["welcome-to-the-jungle", "otta"],
    hosts: [],
    // The search page, a company's jobs page, and the signed-in job feed
    // (/en/get-started/jobs-preview, where F0 was collected).
    resultsPath: "^/([a-z]{2}/)?(jobs|companies/[^/]+/jobs|get-started/jobs-preview)/?$",
    excludedPaths: "^/([a-z]{2}/)?(me|account|settings|profile|messages)(/|$)",
    reader: {
      jobLink: "^https://(www\\.|app\\.)?(welcometothejungle|otta)\\.com/(([a-z]{2}/)?companies/[^/]+/jobs/[^/?#]+|jobs/[A-Za-z0-9_-]+)/?(\\?|#|$)",
      jobIdAttributes: [],
      jobIdPattern: null,
      jobUrlTemplate: null,
      titleSelector: null,
      // Structural, from the real F0 cards (generated class names change):
      // the company name is the paragraph right after the job link (desktop
      // layout) or inside the block right after it (narrow layout). The
      // card's tags (contract, remote, salary, city, headcount) have no
      // stable structure for the location, which is read from the job page.
      companySelector: 'a[href*="/jobs/"] + p, a[href*="/jobs/"] + div > p',
      locationSelector: null,
      postedSelector: ".text-neutral-70",
      excludeSelector: "aside",
    },
    // F0 (November 4, 2026): 5 real cards from /en/get-started/jobs-preview,
    // read by this reader (tests/unit/page-capture-wttj.test.ts). P1 BLOCKED
    // (HTTP 403 on the first logged-out job page), and P3 is not viable (the
    // cards carry no job description), so the approved mechanism is P2:
    // background tabs in the user's Chrome. Both flags stay false until P2's
    // live acceptance; until then the site is enabled only by the server's
    // explicit acceptance setting (PAGE_CAPTURE_ACCEPTANCE_SITES).
    cardVerified: false,
    detailVerified: false,
    detail: { minIntervalMs: 12_000, authCookieNames: [] },
    refresh: defaultRefreshPolicy,
    tabAcquisition: {
      hostPermissions: ["https://www.welcometothejungle.com/*", "https://app.welcometothejungle.com/*"],
      loadTimeoutMs: 30_000,
      // Re-reads of the same document while the page has not rendered its
      // body yet (November 5, 2026: a background tab may render after its
      // load completes); the last one is still inside the 12 s spacing.
      rereadDelaysMs: [2_000, 5_000, 10_000],
    },
    testOnly: false,
  },
  {
    // Synthetic site for the automated end-to-end tests only. Its host is in
    // the reserved .invalid domain, so it can never match a real site.
    key: "e2e-results",
    name: "Test results site",
    knownSiteKeys: [],
    hosts: ["jobs.e2e.invalid"],
    resultsPath: "^/search/?$",
    excludedPaths: null,
    reader: {
      jobLink: "^https://jobs\\.e2e\\.invalid/jobs/[a-z0-9-]+/?$",
      jobIdAttributes: ["data-job-id"],
      jobIdPattern: "^([a-z0-9-]+)$",
      jobUrlTemplate: "https://jobs.e2e.invalid/jobs/{id}",
      titleSelector: ".card-title",
      companySelector: ".card-company",
      locationSelector: ".card-location",
      postedSelector: ".card-posted",
      excludeSelector: ".detail-pane",
    },
    cardVerified: true,
    detailVerified: true,
    detail: { minIntervalMs: 0, authCookieNames: [] },
    refresh: defaultRefreshPolicy,
    testOnly: true,
  },
];

export function pageCaptureSiteByKey(key: string | null | undefined): PageCaptureSiteSpec | null {
  return key ? (pageCaptureSites.find((site) => site.key === key) ?? null) : null;
}

// The spec a page belongs to (by known site, or exact host for the test
// site), whether or not it is enabled.
export function pageCaptureSiteForUrl(value: string | null | undefined): PageCaptureSiteSpec | null {
  if (!value || !isHttpUrl(value)) return null;
  const host = new URL(value).hostname.toLowerCase();
  const known = knownSiteForUrl(value);
  return (
    pageCaptureSites.find((site) => (known && site.knownSiteKeys.includes(known.key)) || site.hosts.includes(host)) ?? null
  );
}

export type PageCaptureOfferReason = "OFFERED" | "UNSUPPORTED_SITE" | "NOT_VERIFIED" | "NOT_RESULTS_PAGE" | "EXCLUDED_PAGE";

// Whether "Save jobs on this page" is offered for a page, given the site keys
// the server enables (only verified sites, and the test site only under its
// test setting).
export function pageCaptureOffer(
  pageUrl: string | null | undefined,
  enabledSiteKeys: readonly string[],
): { offered: boolean; reason: PageCaptureOfferReason; site: PageCaptureSiteSpec | null } {
  const site = pageCaptureSiteForUrl(pageUrl);
  if (!site) return { offered: false, reason: "UNSUPPORTED_SITE", site: null };
  if (!enabledSiteKeys.includes(site.key)) return { offered: false, reason: "NOT_VERIFIED", site };
  const path = new URL(pageUrl!).pathname;
  if (site.excludedPaths && new RegExp(site.excludedPaths, "i").test(path)) return { offered: false, reason: "EXCLUDED_PAGE", site };
  if (!new RegExp(site.resultsPath, "i").test(path)) return { offered: false, reason: "NOT_RESULTS_PAGE", site };
  return { offered: true, reason: "OFFERED", site };
}

export interface PageCaptureEnableOptions {
  includeTestSite: boolean;
  // Real sites enabled for their targeted live acceptance before they are
  // verified, by the server's explicit acceptance setting only. Never the
  // test site; unknown keys are ignored.
  acceptanceSites?: readonly string[];
}

const acceptedForAcceptance = (site: PageCaptureSiteSpec, options: PageCaptureEnableOptions) =>
  !site.testOnly && (options.acceptanceSites ?? []).includes(site.key);

// The site keys the server enables for card reading: verified real sites, and
// the synthetic test site only when the test setting asks for it.
export function enabledPageCaptureSiteKeys(options: PageCaptureEnableOptions): string[] {
  return pageCaptureSites
    .filter((site) => (site.testOnly ? options.includeTestSite : site.cardVerified || acceptedForAcceptance(site, options)))
    .map((site) => site.key);
}

// The site keys whose jobs may be read for details automatically (by the
// site's mechanism: the retrieval worker, or the extension's background tabs).
export function detailEnabledPageCaptureSiteKeys(options: PageCaptureEnableOptions): string[] {
  return pageCaptureSites
    .filter((site) =>
      site.testOnly ? options.includeTestSite : (site.cardVerified && site.detailVerified) || acceptedForAcceptance(site, options),
    )
    .map((site) => site.key);
}

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);
const httpUrl = z.string().trim().max(pageCaptureLimits.url).refine(isHttpUrl, "Must be an http(s) URL");

export const pageCaptureCardSchema = z
  .object({
    url: httpUrl,
    title: text(pageCaptureLimits.title),
    siteJobId: z.string().trim().min(1).max(pageCaptureLimits.siteJobId).regex(/^\S+$/).nullable().default(null),
    company: optionalText(pageCaptureLimits.shortText),
    location: optionalText(pageCaptureLimits.shortText),
    postedText: optionalText(pageCaptureLimits.postedText),
  })
  .strict();

export const pageCaptureBatchSchema = z
  .object({
    schemaVersion: z.literal(pageCaptureSchemaVersion),
    kind: z.literal("page-capture"),
    batchId: z.uuid(),
    site: z.string().trim().min(1).max(60),
    pageUrl: httpUrl,
    pageTitle: optionalText(pageCaptureLimits.title),
    capturedAt: z.iso.datetime(),
    extensionVersion: z.string().trim().min(1).max(40),
    counts: z
      .object({
        loaded: z.number().int().min(0).max(10_000),
        skippedUnloaded: z.number().int().min(0).max(10_000),
        overCap: z.number().int().min(0).max(10_000),
      })
      .strict(),
    cards: z.array(pageCaptureCardSchema).min(1).max(pageCaptureMaxCards),
  })
  .strict()
  .superRefine((batch, context) => {
    const seen = new Set<string>();
    batch.cards.forEach((card, index) => {
      const key = cleanPageUrl(card.url) ?? card.url;
      if (seen.has(key)) context.addIssue({ code: "custom", path: ["cards", index, "url"], message: "Duplicate card" });
      seen.add(key);
    });
  });

export type PageCaptureCard = z.infer<typeof pageCaptureCardSchema>;
export type PageCaptureBatch = z.infer<typeof pageCaptureBatchSchema>;
export type PageCaptureBatchInput = z.input<typeof pageCaptureBatchSchema>;

// Staging states of a captured card (PageCaptureItem.status).
export const pageCaptureItemStatusValues = [
  "QUEUED",
  "ACQUIRING",
  "INGESTED",
  "AWAITING_DETAILS",
  "UNAVAILABLE",
  "ALREADY_SAVED",
  "DISMISSED",
] as const;
export type PageCaptureItemStatus = (typeof pageCaptureItemStatusValues)[number];

// Why a job is awaiting details (safe codes only, never page content).
export const pageCaptureReasonValues = [
  "NOT_SUPPORTED",
  "NO_BROWSER",
  "UNREADABLE",
  "ACCESS_STOPPED",
  "RATE_LIMITED",
  "FAILED_REPEATEDLY",
  "NOT_INGESTED",
  // Background-tab reading (extension-tabs) only.
  "INTERRUPTED",
  "IDENTITY_MISMATCH",
  "BATCH_STOPPED",
  "USER_STOPPED",
  "PERMISSION_MISSING",
] as const;
export type PageCaptureReason = (typeof pageCaptureReasonValues)[number];

// How many failed automatic attempts move a job to Awaiting details.
export const pageCaptureMaxAttempts = 3;
// After the site stops an acquisition pass (a refusal, sign-in wall,
// challenge or rate limit), it is not contacted again for at least a day.
export const pageCaptureFrictionBackoffMs = 24 * 60 * 60 * 1000;
// Per worker pass, at most this many job pages are read for one site.
export const pageCaptureDetailsPerPass = 25;

// Background-tab reading (extension-tabs): a job still queued this long after
// its save (or its last start) is no longer being read, because the browser
// or the extension stopped; it becomes Awaiting details (Interrupted) and is
// never reopened automatically.
export const pageCaptureTabStaleMs = 60 * 60 * 1000;

// What the extension reports for a job page it could not turn into a
// posting. BLOCKED (an access restriction) stops the batch and the site for
// at least a day; the others concern the one job. The server itself decides
// an identity mismatch (the page that opened is not the staged job), which
// stops the batch.
export const pageCaptureTabResultValues = ["UNREADABLE", "UNAVAILABLE", "INTERRUPTED", "BLOCKED"] as const;
export type PageCaptureTabResult = (typeof pageCaptureTabResultValues)[number];

// The access-restriction signals the extension's page check reports (safe
// codes only, never page content).
export const pageCaptureTabSignalValues = [
  "HTTP_401",
  "HTTP_403",
  "HTTP_429",
  "HTTP_999",
  "HTTP_5XX",
  "LOGIN_REDIRECT",
  "CHALLENGE",
  "CAPTCHA",
  "LOGIN_WALL",
  "LEFT_SITE",
  "HTTP_404",
  "HTTP_410",
  "LOAD_FAILED",
  "NO_POSTING",
  "TAB_CLOSED",
] as const;
export type PageCaptureTabSignal = (typeof pageCaptureTabSignalValues)[number];

// Why the extension stopped a run without a job-specific result.
export const pageCaptureTabStopValues = ["USER_STOPPED", "PERMISSION_MISSING", "BATCH_STOPPED"] as const;
export type PageCaptureTabStop = (typeof pageCaptureTabStopValues)[number];
