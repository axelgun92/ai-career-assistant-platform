import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { AdapterError, isStopError, type CollectResult, type ListingIssue, type SourceAdapter } from "../contract";
import { buildRetrievedListing } from "../listing";

// LinkedIn public job search (job board, browser-assisted; feature 14).
// Public, logged-out pages only, through the shared browser session: a fresh
// context per run with no account, cookies, profile or stored state. The
// adapter only opens public job-search and job-view pages and reads them; it
// never signs in, applies, saves, follows, messages or clicks anything.
//
// A run has two separate budgets:
// - discovery: public search pages, paged only by the URL's start offset (by
//   the number of results each page actually returned, never an assumed
//   page size), up to the page cap and the discovery cap (defaults 4 pages
//   and 100 results), ending early on an empty, repeated or short page. The
//   Customer Success title filter runs on the search results;
// - detail: at most maxDetailsPerRun public job pages (default 20). Title
//   matches never fetched before go first, oldest discovery first, including
//   matches from earlier runs that have left the search window (tracked as
//   pending, see CollectContext.pendingListings); stored jobs are refreshed
//   only with leftover budget and only when last checked over 7 days ago.
// So a large pool of matches is worked through over several runs instead of
// being dropped. Bounded: never removal-capable.
//
// Any access friction (HTTP 403, 429 or 999, a login wall or authwall, a
// checkpoint, CAPTCHA or challenge, or an account cookie) stops the run in
// the browser session, and Feature 12 backs the source off. Nothing is
// retried. The page structure is parsed conservatively: the job's schema.org
// JobPosting data first, then the public page's own fields; a page that
// matches neither is a contract mismatch for that listing, never a guess, and
// three in a row stop the run.
//
// Not yet verified against a live response. On October 19, 2026 the Claude
// cloud environment first denied www.linkedin.com by network policy; once
// reachable, the single logged-out verification request (one search page)
// was answered with HTTP 429 and LinkedIn's anti-bot interstitial (an
// obfuscated cookie script and a meta refresh to the home page), and the run
// stopped there as designed. That result is specific to the Claude cloud
// environment's automated browser: a separate logged-out check from a local
// browser loaded normal public search results (job cards with title,
// company, location and link) under a "Sign in to view more jobs" modal. The
// parsers were built against synthetic pages modelled on the public layout,
// and the adapter cannot be enabled until a live verification of the adapter
// itself succeeds, from a local runtime.

export const linkedInHardLimits = { searchPages: 8, discovered: 200, detailsPerRun: 25 } as const;
const refreshAfterDays = 7;
const pendingMaxAgeDays = 30;

const intFrom = (min: number, max: number, fallback: number) =>
  z.preprocess((value) => (value === "" || value === undefined || value === null ? undefined : value), z.coerce.number().int().min(min).max(max).default(fallback));

const configSchema = z
  .object({
    // The public search keywords, as LinkedIn's own search box takes them
    // (quoted phrases and OR are LinkedIn's search syntax). Default: the
    // domain's search query (customer success).
    keywords: z.string().trim().min(1).max(300).optional(),
    location: z.string().trim().min(1).max(120).optional(),
    // "remote" adds LinkedIn's public Remote filter.
    workplace: z.enum(["remote", "any"]).default("remote"),
    postedWithinDays: z.preprocess(
      (value) => (value === "" || value === undefined ? undefined : Number(value)),
      z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7),
    ),
    maxSearchPages: intFrom(1, linkedInHardLimits.searchPages, 4),
    maxDiscovered: intFrom(1, linkedInHardLimits.discovered, 100),
    maxDetailsPerRun: intFrom(1, linkedInHardLimits.detailsPerRun, 20),
  })
  .strict();
type LinkedInConfig = z.infer<typeof configSchema>;

export function linkedInKeywords(config: Pick<LinkedInConfig, "keywords">, searchQueries: readonly string[]): string {
  if (config.keywords) return config.keywords;
  return searchQueries.map((query) => `"${query}"`).join(" OR ") || '"customer success"';
}

// A deterministic public search URL: fixed parameter order, paged by start
// (the /jobs/search/ form a local logged-out check loaded successfully).
export function linkedInSearchUrl(config: LinkedInConfig, keywords: string, start: number): string {
  const params = new URLSearchParams();
  params.set("keywords", keywords);
  if (config.location) params.set("location", config.location);
  params.set("f_TPR", `r${config.postedWithinDays * 86_400}`);
  if (config.workplace === "remote") params.set("f_WT", "2");
  params.set("start", String(Math.max(0, Math.trunc(start))));
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

export const linkedInJobUrl = (id: string) => `https://www.linkedin.com/jobs/view/${encodeURIComponent(id)}`;

export interface LinkedInSearchCard {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  listedAt: string | null;
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, " ").trim() || null;
const jobIdFrom = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const urn = /urn:li:jobPosting:(\d+)/.exec(value);
  if (urn) return urn[1]!;
  const view = /\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/.exec(value);
  return view ? view[1]! : null;
};

// Public search results. recognized is false when the page has no results
// list at all (a changed layout); a list with no cards is the end.
export function parseLinkedInSearchPage(document: Document): { recognized: boolean; cards: LinkedInSearchCard[]; unidentified: number } {
  const list = document.querySelector(".jobs-search__results-list, ul.jobs-search-results__list");
  const noResults = document.querySelector(".no-results, .jobs-search-no-results, [class*='no-results']");
  if (!list) return { recognized: Boolean(noResults), cards: [], unidentified: 0 };
  const cards: LinkedInSearchCard[] = [];
  let unidentified = 0;
  for (const item of list.querySelectorAll(":scope > li")) {
    const card = item.querySelector("[data-entity-urn]") ?? item;
    const link = item.querySelector<HTMLAnchorElement>("a.base-card__full-link, a[href*='/jobs/view/']");
    const id = jobIdFrom(card.getAttribute("data-entity-urn")) ?? jobIdFrom(link?.getAttribute("href"));
    if (!id) {
      unidentified += 1;
      continue;
    }
    cards.push({
      id,
      title: text(item.querySelector(".base-search-card__title, h3")),
      company: text(item.querySelector(".base-search-card__subtitle, h4")),
      location: text(item.querySelector(".job-search-card__location")),
      listedAt: item.querySelector("time[datetime]")?.getAttribute("datetime") ?? null,
    });
  }
  return { recognized: true, cards, unidentified };
}

export interface LinkedInJob {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  descriptionHtml: string;
  postedAt: string | null;
  employmentType: string | null;
  seniority: string | null;
  jobFunction: string | null;
  industries: string | null;
  salaryText: string | null;
  remote: boolean;
  applicationUrl: string | null;
  structuredData: boolean;
}

const jobPostingSchema = z
  .object({
    "@type": z.union([z.string(), z.array(z.string())]),
    title: z.string().nullish(),
    description: z.string().nullish(),
    datePosted: z.string().nullish(),
    employmentType: z.union([z.string(), z.array(z.string())]).nullish(),
    jobLocationType: z.string().nullish(),
    hiringOrganization: z.object({ name: z.string().nullish() }).passthrough().nullish(),
    jobLocation: z
      .union([z.array(z.unknown()), z.unknown()])
      .nullish(),
  })
  .passthrough();

function structuredJob(document: Document): z.infer<typeof jobPostingSchema> | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(script.textContent ?? "");
      const candidates = Array.isArray(value) ? value : [value, ...(Array.isArray(value?.["@graph"]) ? value["@graph"] : [])];
      for (const candidate of candidates) {
        const parsed = jobPostingSchema.safeParse(candidate);
        if (parsed.success && [parsed.data["@type"]].flat().includes("JobPosting")) return parsed.data;
      }
    } catch {
      // Not JSON: ignored.
    }
  }
  return null;
}

function structuredLocation(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const address = (first as { address?: Record<string, unknown> } | null)?.address;
  if (!address || typeof address !== "object") return null;
  const parts = ["addressLocality", "addressRegion", "addressCountry"]
    .map((key) => address[key])
    .map((part) => (typeof part === "string" ? part.trim() : typeof part === "object" && part ? String((part as { name?: unknown }).name ?? "").trim() : ""))
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

// The external apply address the public page states, if it states one
// (LinkedIn's externalApply link carries it in its url parameter).
function applicationUrl(document: Document): string | null {
  const candidates = [
    document.querySelector("code#applyUrl")?.innerHTML.replace(/<!--|-->/g, "").replace(/^"|"$/g, "").trim(),
    document.querySelector<HTMLAnchorElement>("a[href*='externalApply']")?.getAttribute("href"),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const target = new URL(candidate, "https://www.linkedin.com").searchParams.get("url");
      if (target && /^https?:\/\//i.test(target)) return target;
    } catch {
      // Unreadable: no application address.
    }
  }
  return null;
}

function criteria(document: Document): Map<string, string> {
  const values = new Map<string, string>();
  for (const item of document.querySelectorAll(".description__job-criteria-item")) {
    const label = text(item.querySelector(".description__job-criteria-subheader, h3"));
    const value = text(item.querySelector(".description__job-criteria-text, span"));
    if (label && value) values.set(label.toLowerCase(), value);
  }
  return values;
}

// A public job page, or null when it carries neither structured job data nor
// the public page's title and description (a changed layout).
export function parseLinkedInJobPage(document: Document, id: string): LinkedInJob | null {
  const structured = structuredJob(document);
  const pageTitle = text(document.querySelector(".top-card-layout__title, .topcard__title"));
  const pageDescription = document.querySelector(".show-more-less-html__markup, .description__text")?.innerHTML.trim() || null;
  const title = structured?.title?.trim() || pageTitle;
  const descriptionHtml = structured?.description?.trim() || pageDescription;
  if (!title || !descriptionHtml) return null;
  const facts = criteria(document);
  const employment = structured?.employmentType ? [structured.employmentType].flat().join(", ") : null;
  return {
    id,
    title,
    company: structured?.hiringOrganization?.name?.trim() || text(document.querySelector(".topcard__org-name-link, .top-card-layout__second-subline a")),
    location: structuredLocation(structured?.jobLocation) ?? text(document.querySelector(".topcard__flavor--bullet")),
    descriptionHtml,
    postedAt: structured?.datePosted ?? null,
    employmentType: facts.get("employment type") ?? employment,
    seniority: facts.get("seniority level") ?? null,
    jobFunction: facts.get("job function") ?? null,
    industries: facts.get("industries") ?? null,
    salaryText: text(document.querySelector(".compensation__salary, .salary")),
    remote: structured?.jobLocationType === "TELECOMMUTE",
    applicationUrl: applicationUrl(document),
    structuredData: Boolean(structured),
  };
}

// LinkedIn-specific friction beyond the generic checks: its sign-in wall
// standing in for the public content, its own block page, or its anti-bot
// interstitial (a page that only refreshes to another address, with no job
// content; seen live with HTTP 429, and treated the same with any status).
// A "Sign in to view more jobs" modal over public results that are still
// present is not friction: a local logged-out check saw exactly that, with
// the job cards readable underneath. It counts only when no job content is
// on the page.
export function detectLinkedInFriction(page: { finalUrl: string; document: Document }): string | null {
  const document = page.document;
  const content = document.querySelector('.jobs-search__results-list, .top-card-layout__title, .no-results, script[type="application/ld+json"]');
  if (!content && document.querySelector("form.join-form, .authwall-join-form, [data-tracking-control-name*='authwall']")) return "login wall";
  const title = document.title?.toLowerCase() ?? "";
  if (title.includes("security verification") || title.includes("let's do a quick security check")) return "security check";
  const refresh = document.querySelector('meta[http-equiv="refresh" i]');
  if (refresh && !content) return "an anti-bot interstitial";
  return null;
}

export const linkedinAdapter: SourceAdapter<LinkedInConfig> = {
  key: "linkedin",
  name: "LinkedIn",
  retrievalType: "BROWSER_ASSISTED",
  sourceCategory: "JOB_BOARD",
  sourceType: "PUBLIC_SEARCH",
  configSchema,
  configFields: [
    { name: "keywords", label: "Search keywords", help: 'LinkedIn search syntax, for example "customer success" OR "client success". Defaults to "customer success".', required: false },
    { name: "location", label: "Location", help: "For example United States. Leave empty for LinkedIn's default.", required: false },
    { name: "workplace", label: "Workplace", help: "remote (default) or any.", required: false },
    { name: "postedWithinDays", label: "Posted within (days)", help: "1, 7 (default) or 30.", required: false },
    { name: "maxSearchPages", label: "Search pages per run", help: `1–${linkedInHardLimits.searchPages}, default 4.`, required: false },
    { name: "maxDiscovered", label: "Results discovered per run", help: `1–${linkedInHardLimits.discovered}, default 100.`, required: false },
    { name: "maxDetailsPerRun", label: "Job pages per run", help: `1–${linkedInHardLimits.detailsPerRun}, default 20.`, required: false },
  ],
  requiredEnv: ["RETRIEVAL_BROWSER_EXECUTABLE"],
  verified: false,
  attribution: "via LinkedIn",
  // At least 5 seconds between page loads; no concurrency.
  minRequestIntervalMs: 5_000,
  requiresBrowser: true,
  browser: {
    authCookieNames: ["li_at"],
    detectFriction: detectLinkedInFriction,
    maxNavigations: linkedInHardLimits.searchPages + linkedInHardLimits.detailsPerRun,
  },
  // Which listings the source retrieves: the search, not the run budgets.
  trackingScope: (config) => ({ keywords: config.keywords ?? null, location: config.location ?? null, workplace: config.workplace, postedWithinDays: config.postedWithinDays }),
  verificationUrl: (config) => linkedInSearchUrl(config, linkedInKeywords(config, ["customer success"]), 0),
  // Verification opens one search page and the first job page it lists.
  verificationFollowUpUrl: (page) => {
    const [first] = parseLinkedInSearchPage(page as Document).cards;
    return first ? linkedInJobUrl(first.id) : null;
  },
  async collect(context, config): Promise<CollectResult> {
    const browser = context.browser;
    if (!browser) throw new AdapterError("CONFIG", "LinkedIn retrieval needs a browser session");
    const result: CollectResult = { listings: [], fetched: 0, issues: [], halted: null, requests: 0 };
    const keywords = linkedInKeywords(config, context.discovery.searchQueries);

    // Discovery: public search pages, paged by start offset.
    const cards: LinkedInSearchCard[] = [];
    const seen = new Set<string>();
    let start = 0;
    let firstPageSize = 0;
    for (let page = 0; page < config.maxSearchPages && cards.length < config.maxDiscovered; page += 1) {
      const url = linkedInSearchUrl(config, keywords, start);
      let parsed: ReturnType<typeof parseLinkedInSearchPage>;
      try {
        result.requests += 1;
        const opened = await browser.open(url);
        if (opened.status !== 200) throw new AdapterError("HTTP_STATUS", `The search page answered HTTP ${opened.status}`, { status: opened.status, url });
        parsed = parseLinkedInSearchPage(opened.document);
        if (!parsed.recognized) throw new AdapterError("CONTRACT_MISMATCH", "The search page has no recognizable results list", { url });
      } catch (error) {
        if (page === 0 || !(error instanceof AdapterError)) throw error;
        result.halted = error;
        break;
      }
      const fresh = parsed.cards.filter((card) => !seen.has(card.id));
      if (!fresh.length) break;
      for (const card of fresh.slice(0, config.maxDiscovered - cards.length)) {
        seen.add(card.id);
        cards.push(card);
      }
      const pageSize = parsed.cards.length + parsed.unidentified;
      start += pageSize;
      // A page shorter than the first is the last one.
      if (page === 0) firstPageSize = pageSize;
      else if (pageSize < firstPageSize) break;
    }
    result.fetched = cards.length;
    result.coverage = { observedListingIds: cards.map((card) => card.id), complete: false };
    const matches = cards.filter((card) => context.keepTitle(card.title));
    result.discovered = matches.map((card) => card.id);
    if (result.halted && isStopError(result.halted)) return result;

    // Detail: pending first (oldest discovery first), then new matches, then
    // stored matches due a refresh.
    const pendingSince = new Date(context.now().getTime() - pendingMaxAgeDays * 86_400_000);
    const pending = (await context.pendingListings?.(pendingSince)) ?? [];
    const candidateIds = [...new Set([...pending.map((item) => item.externalId), ...matches.map((card) => card.id)])];
    const checked = context.lastChecked ? await context.lastChecked(candidateIds) : new Map<string, Date>();
    const refreshBefore = context.now().getTime() - refreshAfterDays * 86_400_000;
    const queue = [
      ...pending.filter((item) => !checked.has(item.externalId) && item.firstSeenAt >= pendingSince).map((item) => item.externalId),
      ...matches.filter((card) => !checked.has(card.id)).map((card) => card.id),
      ...matches
        .filter((card) => (checked.get(card.id)?.getTime() ?? Infinity) < refreshBefore)
        .sort((a, b) => checked.get(a.id)!.getTime() - checked.get(b.id)!.getTime())
        .map((card) => card.id),
    ];
    const toFetch = [...new Set(queue)].slice(0, config.maxDetailsPerRun);
    const cardById = new Map(cards.map((card) => [card.id, card]));
    const discoveredAt = context.now();
    let unreadableInARow = 0;
    for (const id of toFetch) {
      const url = linkedInJobUrl(id);
      result.requests += 1;
      let job: LinkedInJob | null = null;
      try {
        const opened = await browser.open(url);
        if (opened.status === 404 || opened.status === 410) {
          (result.unavailable ??= []).push(id);
          result.issues.push({ externalId: id, code: "CONTRACT_MISMATCH", message: "The job page is no longer available" } satisfies ListingIssue);
          continue;
        }
        if (opened.status === 200) job = parseLinkedInJobPage(opened.document, id);
      } catch (error) {
        if (isStopError(error)) {
          result.halted = error;
          break;
        }
        result.issues.push({ externalId: id, code: "CONTRACT_MISMATCH", message: "The job page could not be read" });
        continue;
      }
      if (!job) {
        unreadableInARow += 1;
        result.issues.push({ externalId: id, code: "CONTRACT_MISMATCH", message: "The job page does not match the expected structure" });
        if (unreadableInARow >= 3) {
          result.halted = new AdapterError("CONTRACT_MISMATCH", "Three job pages in a row did not match the expected structure", { url });
          break;
        }
        continue;
      }
      unreadableInARow = 0;
      const card = cardById.get(id);
      const sourceUrl = linkedInJobUrl(id);
      try {
        result.listings.push(
          buildRetrievedListing(
            linkedinAdapter,
            {
              externalId: id,
              title: job.title,
              company: job.company ?? card?.company ?? null,
              location: job.location ?? card?.location ?? null,
              description: htmlToText(job.descriptionHtml),
              salaryText: job.salaryText,
              employmentType: job.employmentType,
              postingDate: job.postedAt ?? card?.listedAt ?? null,
              sourceUrl,
              // Only an external apply address the page itself states.
              applicationUrl: job.applicationUrl,
              structured: { workplaceType: job.remote ? "REMOTE" : null },
              material: { seniority: job.seniority, jobFunction: job.jobFunction, industries: job.industries },
              metadata: {
                seniority: job.seniority,
                jobFunction: job.jobFunction,
                industries: job.industries,
                listedAt: card?.listedAt ?? null,
                structuredData: job.structuredData,
                searchKeywords: keywords,
                searchWorkplace: config.workplace,
              },
              // The fields read from the page, never the page itself.
              sourceItem: { ...job, card: card ?? null },
            },
            { domain: context.discovery.domain, discoveredAt },
          ),
        );
      } catch {
        result.issues.push({ externalId: id, code: "CONTRACT_MISMATCH", message: "Listing could not be mapped" });
      }
    }
    return result;
  },
};
