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
  // True only for the synthetic test site, enabled by the server's explicit
  // test setting; never matches a real host.
  testOnly: boolean;
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
    testOnly: false,
  },
  {
    key: "welcome-to-the-jungle",
    name: "Welcome to the Jungle / Otta",
    knownSiteKeys: ["welcome-to-the-jungle", "otta"],
    hosts: [],
    resultsPath: "^/([a-z]{2}/)?(jobs|companies/[^/]+/jobs)/?$",
    excludedPaths: "^/([a-z]{2}/)?(me|account|settings|profile|messages)(/|$)",
    reader: {
      jobLink: "^https://(www\\.|app\\.)?(welcometothejungle|otta)\\.com/(([a-z]{2}/)?companies/[^/]+/jobs/[^/?#]+|jobs/[A-Za-z0-9_-]+)/?(\\?|#|$)",
      jobIdAttributes: [],
      jobIdPattern: null,
      jobUrlTemplate: null,
      titleSelector: null,
      companySelector: null,
      locationSelector: null,
      postedSelector: null,
      excludeSelector: "aside",
    },
    cardVerified: false,
    detailVerified: false,
    detail: { minIntervalMs: 12_000, authCookieNames: [] },
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

// The site keys the server enables for card reading: verified real sites, and
// the synthetic test site only when the test setting asks for it.
export function enabledPageCaptureSiteKeys(options: { includeTestSite: boolean }): string[] {
  return pageCaptureSites.filter((site) => (site.testOnly ? options.includeTestSite : site.cardVerified)).map((site) => site.key);
}

// The site keys whose jobs may be fetched for details automatically.
export function detailEnabledPageCaptureSiteKeys(options: { includeTestSite: boolean }): string[] {
  return pageCaptureSites
    .filter((site) => (site.testOnly ? options.includeTestSite : site.cardVerified && site.detailVerified))
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
] as const;
export type PageCaptureReason = (typeof pageCaptureReasonValues)[number];

// How many failed automatic attempts move a job to Awaiting details.
export const pageCaptureMaxAttempts = 3;
// After the site stops an acquisition pass (a refusal, sign-in wall,
// challenge or rate limit), it is not contacted again for at least a day.
export const pageCaptureFrictionBackoffMs = 24 * 60 * 60 * 1000;
// Per worker pass, at most this many job pages are read for one site.
export const pageCaptureDetailsPerPass = 25;
