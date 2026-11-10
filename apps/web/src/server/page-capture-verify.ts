import type { PageCaptureSiteSpec } from "@ai-career/core";
import { AdapterError, createBrowserSession, type BrowserDriver } from "@ai-career/discovery";
import { JSDOM } from "jsdom";
import { capturedPageIdentity } from "./extension-capture";
import { pageCaptureFrictionDetector, readJobPage } from "./page-capture-acquisition";

// The bounded P1 verification experiment for Mode B: can a site's public job
// pages be read in a fresh, logged-out headless browser, so that batch-captured
// jobs get their details without anyone opening them? This module holds the
// experiment itself; page-capture-verify-cli.ts runs it with the real browser.
//
// Rules, all enforced here or by the shared browser session (feature 14A):
// - at most 5 job URLs, each opened once, in the canonical form production
//   acquisition fetches (capturedPageIdentity: LinkedIn /jobs/view/<id>);
// - one page at a time, at least the site's interval apart (5 s LinkedIn,
//   12 s Welcome to the Jungle / Otta), in a fresh context with no cookies,
//   profile or stored state;
// - the first access restriction stops it with no further request, no retry
//   and no workaround: HTTP 401, 403, 429 or 999; a sign-in, authwall,
//   checkpoint, challenge or CAPTCHA page; the site's own login wall,
//   security check or anti-bot interstitial; an account cookie;
// - the first page that is not a readable posting of the requested job also
//   stops it.
//
// Verdicts:
// - PASS: every URL loaded without restriction, stayed on the requested job
//   and gave a readable posting (a title and a description of at least 200
//   characters) through the accepted single-job reader;
// - BLOCKED: an access restriction stopped it;
// - FAIL: a page loaded but was not a readable posting of the requested job
//   (unreadable, redirected elsewhere, 404/410 or another non-2xx status), or
//   it could not be loaded (server error, timeout, network, oversized).
// BLOCKED or FAIL means P1 is not viable for the site as observed: stop and
// report; no further investigation without Alex's explicit authorization.

export const pageCaptureVerifyMaxUrls = 5;
export const pageCaptureReadableDescriptionChars = 200;

export type PageCaptureVerdict = "PASS" | "FAIL" | "BLOCKED";

export interface PageCaptureVerifyPage {
  index: number;
  requestedUrl: string;
  openedUrl: string;
  result: "READABLE" | "NOT_READABLE" | "REDIRECTED" | "HTTP_ERROR" | "BLOCKED" | "LOAD_FAILED";
  status: number | null;
  finalUrl: string | null;
  reason: string | null;
  title: string | null;
  descriptionChars: number;
  extractor: string | null;
}

export interface PageCaptureVerifyResult {
  site: string;
  verdict: PageCaptureVerdict;
  reason: string;
  readable: number;
  requested: number;
  pages: PageCaptureVerifyPage[];
}

// The URLs the experiment opens: each in the canonical form production
// acquisition fetches, each once, at most 5. Throws on a URL that is not a job
// page of the site, before anything is opened.
export function pageCaptureVerifyTargets(site: PageCaptureSiteSpec, urls: readonly string[]) {
  if (!urls.length || urls.length > pageCaptureVerifyMaxUrls) {
    throw new Error(`Give 1 to ${pageCaptureVerifyMaxUrls} job URLs from the site's results page`);
  }
  const targets: Array<{ requestedUrl: string; openedUrl: string; externalId: string }> = [];
  for (const url of urls) {
    let identity;
    try {
      identity = capturedPageIdentity(url);
    } catch {
      throw new Error(`Not a ${site.name} job page: ${url}`);
    }
    if (!site.knownSiteKeys.includes(identity.site.key) || !identity.externalId) throw new Error(`Not a ${site.name} job page: ${url}`);
    if (targets.some((target) => target.externalId === identity.externalId)) throw new Error(`The same job is given twice: ${url}`);
    targets.push({ requestedUrl: url, openedUrl: identity.sourceUrl, externalId: identity.externalId });
  }
  return targets;
}

const identityOf = (url: string) => {
  try {
    return capturedPageIdentity(url).externalId;
  } catch {
    return null;
  }
};

export async function runPageCaptureVerification(input: {
  site: PageCaptureSiteSpec;
  urls: readonly string[];
  driver: BrowserDriver;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  // Called after each page with its raw HTML (for keeping evidence outside
  // the repository); never with cookies or headers.
  onPage?: (page: PageCaptureVerifyPage, html: string | null) => void;
}): Promise<PageCaptureVerifyResult> {
  const { site } = input;
  const targets = pageCaptureVerifyTargets(site, input.urls);
  let lastHtml: string | null = null;
  const session = createBrowserSession(
    {
      async navigate(url, options) {
        lastHtml = null;
        const result = await input.driver.navigate(url, options);
        lastHtml = result.html;
        return result;
      },
      close: () => input.driver.close(),
    },
    {
      minIntervalMs: site.detail.minIntervalMs,
      maxNavigations: targets.length,
      authCookieNames: site.detail.authCookieNames,
      detectFriction: pageCaptureFrictionDetector(site.key),
      parse: (html, url) => new JSDOM(html, { url, runScripts: "outside-only" }).window.document,
      ...(input.sleep ? { sleep: input.sleep } : {}),
      ...(input.now ? { now: input.now } : {}),
    },
  );

  const pages: PageCaptureVerifyPage[] = [];
  const finish = (verdict: PageCaptureVerdict, reason: string): PageCaptureVerifyResult => ({
    site: site.key,
    verdict,
    reason,
    readable: pages.filter((page) => page.result === "READABLE").length,
    requested: targets.length,
    pages,
  });
  const record = (page: PageCaptureVerifyPage) => {
    pages.push(page);
    input.onPage?.(page, lastHtml);
  };

  for (const [position, target] of targets.entries()) {
    const base = { index: position + 1, requestedUrl: target.requestedUrl, openedUrl: target.openedUrl, title: null, descriptionChars: 0, extractor: null };
    let page;
    try {
      page = await session.open(target.openedUrl);
    } catch (error) {
      const blocked = error instanceof AdapterError && (error.code === "RATE_LIMITED" || error.code === "ACCESS_DENIED");
      const reason = error instanceof AdapterError ? `${error.code}: ${error.message}` : "the page could not be loaded";
      const status = error instanceof AdapterError && typeof error.details?.status === "number" ? error.details.status : null;
      record({ ...base, result: blocked ? "BLOCKED" : "LOAD_FAILED", status, finalUrl: null, reason });
      return finish(blocked ? "BLOCKED" : "FAIL", `page ${position + 1}: ${reason}; no further request`);
    }
    if (page.status < 200 || page.status >= 300) {
      record({ ...base, result: "HTTP_ERROR", status: page.status, finalUrl: page.finalUrl, reason: `HTTP ${page.status}` });
      return finish("FAIL", `page ${position + 1}: HTTP ${page.status}; no further request`);
    }
    if (identityOf(page.finalUrl) !== target.externalId) {
      record({ ...base, result: "REDIRECTED", status: page.status, finalUrl: page.finalUrl, reason: "the page shown is not the requested job" });
      return finish("FAIL", `page ${position + 1}: redirected away from the requested job; no further request`);
    }
    const extraction = readJobPage(page.document);
    const posting = extraction?.posting ?? null;
    const descriptionChars = posting?.description?.length ?? 0;
    const readable = Boolean(posting?.title && descriptionChars >= pageCaptureReadableDescriptionChars);
    record({
      ...base,
      result: readable ? "READABLE" : "NOT_READABLE",
      status: page.status,
      finalUrl: page.finalUrl,
      reason: readable ? null : (extraction?.problem ?? "no readable posting (a title and a description of at least 200 characters)"),
      title: posting?.title ? posting.title.slice(0, 120) : null,
      descriptionChars,
      extractor: extraction?.extractor ?? null,
    });
    if (!readable) return finish("FAIL", `page ${position + 1}: no readable posting; no further request`);
  }
  return finish("PASS", `all ${targets.length} job pages loaded without restriction and gave a readable posting`);
}
