import { JSDOM } from "jsdom";
import type { BrowserDriver, BrowserNavigation } from "@ai-career/discovery";

// Feature 14: synthetic LinkedIn public pages and a fixture browser driver.
// The pages are modelled on LinkedIn's public, logged-out job search and job
// view layouts (the class names and the schema.org JobPosting script the
// adapter reads); they are not captured responses, because the Claude cloud
// environment's network policy denied www.linkedin.com when feature 14 was
// built. Nothing here reaches the network.

export interface SyntheticCard {
  id: string;
  title: string;
  company?: string;
  location?: string;
  listedAt?: string;
  // How the card carries its ID: the entity URN (default), only the job
  // link, or neither.
  idIn?: "urn" | "link" | "none";
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function searchPage(cards: readonly SyntheticCard[]): string {
  const items = cards
    .map((card) => {
      const href = card.idIn === "none" ? "https://www.linkedin.com/jobs/search" : `https://www.linkedin.com/jobs/view/${slug(card.title)}-${card.id}?refId=abc&trackingId=xyz`;
      const urn = card.idIn === "urn" || card.idIn === undefined ? ` data-entity-urn="urn:li:jobPosting:${card.id}"` : "";
      return `<li>
  <div class="base-card base-search-card job-search-card"${urn}>
    <a class="base-card__full-link" href="${escapeHtml(href)}"><span class="sr-only">${escapeHtml(card.title)}</span></a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">${escapeHtml(card.title)}</h3>
      <h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/x">${escapeHtml(card.company ?? "Acme")}</a></h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">${escapeHtml(card.location ?? "United States")}</span>
        <time class="job-search-card__listdate" datetime="${card.listedAt ?? "2026-10-17"}">2 days ago</time>
      </div>
    </div>
  </div>
</li>`;
    })
    .join("\n");
  return `<!doctype html><html><head><title>Customer Success jobs</title></head><body>
<main><section class="two-pane-serp-page__results-list"><ul class="jobs-search__results-list">
${items}
</ul></section></main></body></html>`;
}

export const noResultsPage = () =>
  `<!doctype html><html><head><title>Jobs</title></head><body><main><section class="no-results"><h1>We couldn't find a match</h1></section></main></body></html>`;

export const unrecognizedPage = () => `<!doctype html><html><head><title>LinkedIn</title></head><body><main><p>Something else</p></main></body></html>`;

export interface SyntheticJob {
  id: string;
  title: string;
  company?: string;
  descriptionHtml?: string;
  structured?: boolean;
  applyUrl?: string;
  salary?: string;
  remote?: boolean;
}

export function jobPage(job: SyntheticJob): string {
  const description = job.descriptionHtml ?? "<p>Own onboarding, adoption and renewals for a book of customers.</p>";
  const company = job.company ?? "Acme";
  const jsonLd =
    job.structured === false
      ? ""
      : `<script type="application/ld+json">${JSON.stringify({
          "@context": "http://schema.org",
          "@type": "JobPosting",
          title: job.title,
          description,
          datePosted: "2026-10-17T12:00:00.000Z",
          employmentType: "FULL_TIME",
          hiringOrganization: { "@type": "Organization", name: company },
          jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Denver", addressRegion: "CO", addressCountry: "US" } },
          ...(job.remote ? { jobLocationType: "TELECOMMUTE" } : {}),
        })}</script>`;
  const apply = job.applyUrl
    ? `<code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/${job.id}?url=${encodeURIComponent(job.applyUrl)}&urlHash=abcd"--></code>`
    : "";
  return `<!doctype html><html><head><title>${escapeHtml(job.title)} | ${escapeHtml(company)} | LinkedIn</title>${jsonLd}</head><body>
<main>
  <section class="top-card-layout">
    <h1 class="top-card-layout__title topcard__title">${escapeHtml(job.title)}</h1>
    <h4 class="top-card-layout__second-subline"><a class="topcard__org-name-link" href="https://www.linkedin.com/company/x">${escapeHtml(company)}</a>
      <span class="topcard__flavor topcard__flavor--bullet">Denver, CO</span></h4>
    ${job.salary ? `<div class="compensation__salary">${escapeHtml(job.salary)}</div>` : ""}
  </section>
  ${apply}
  <section class="description">
    <div class="description__text description__text--rich"><div class="show-more-less-html__markup">${description}</div></div>
    <ul class="description__job-criteria-list">
      <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">Mid-Senior level</span></li>
      <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">Full-time</span></li>
      <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Job function</h3><span class="description__job-criteria-text">Customer Service</span></li>
      <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Industries</h3><span class="description__job-criteria-text">Software Development</span></li>
    </ul>
  </section>
</main></body></html>`;
}

// LinkedIn's sign-in wall standing in for public content.
export const authwallPage = () =>
  `<!doctype html><html><head><title>Sign Up | LinkedIn</title></head><body><main><form class="join-form" action="/signup/cold-join"><input name="email"></form></main></body></html>`;

// Modelled on LinkedIn's anti-bot interstitial (seen live with HTTP 429):
// an obfuscated cookie script and a meta refresh, no job content.
export const interstitialPage = () =>
  `<html><head><meta http-equiv="refresh" content="1;url=https://www.linkedin.com"><script type="text/javascript">var _0x1=['cookie','location'];</script></head><body></body></html>`;

export const challengePage = () =>
  `<!doctype html><html><head><title>Security Verification | LinkedIn</title></head><body><main><div id="captcha-internal"></div></main></body></html>`;

export const parsePage = (html: string, url = "https://www.linkedin.com/jobs/search") => new JSDOM(html, { url }).window.document;

export interface FixturePage {
  status?: number | null;
  html?: string;
  // Where the browser ends up (a redirect), if not the requested URL.
  finalUrl?: string;
  cookieNames?: string[];
  retryAfterSeconds?: number;
  // The navigation fails (a timeout or a refused connection).
  fail?: boolean;
}

// A browser driver that serves fixture pages by exact URL (or by a function),
// records every navigation and whether it was closed. An unknown URL answers
// 404, like a missing page.
export function createFixtureBrowser(pages: Record<string, FixturePage> | ((url: string) => FixturePage | undefined)) {
  const navigations: string[] = [];
  const state = { closed: false, active: 0, maxActive: 0 };
  const lookup = typeof pages === "function" ? pages : (url: string) => pages[url];
  const driver: BrowserDriver = {
    async navigate(url): Promise<BrowserNavigation> {
      if (state.closed) throw new Error("The fixture browser is closed");
      navigations.push(url);
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        await Promise.resolve();
        const page = lookup(url) ?? { status: 404, html: "<html><body>Not found</body></html>" };
        if (page.fail) throw new Error("net::ERR_TIMED_OUT");
        return {
          status: page.status === undefined ? 200 : page.status,
          finalUrl: page.finalUrl ?? url,
          html: page.html ?? "",
          cookieNames: page.cookieNames ?? ["bcookie", "lang"],
          ...(page.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: page.retryAfterSeconds }),
        };
      } finally {
        state.active -= 1;
      }
    },
    async close() {
      state.closed = true;
    },
  };
  return { driver, navigations, state };
}
