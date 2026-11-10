import type { BrowserDriver, BrowserNavigation, BrowserRequestCounts } from "@ai-career/discovery";
import { parseRetryAfter } from "@ai-career/discovery";
import { JSDOM } from "jsdom";
import { chromium, type Page, type Request } from "playwright-core";

// The production browser for browser-assisted retrieval (feature 14): headless
// Chromium driven by Playwright, launched for one run and closed after it.
// Each run gets a fresh, non-persistent context: no profile directory, no
// stored state, no cookies, no extensions and no service workers, so nothing
// from any account can reach it. The browser keeps its own default identity
// (no user-agent or fingerprint changes), and no proxy rotation, stealth
// plugin or CAPTCHA handling exists. Images, fonts and media are not
// downloaded, which only saves bandwidth. The page can never navigate by
// itself: a main-frame navigation the driver did not ask for (a page
// script's reload or a meta refresh, as an anti-bot interstitial does) is
// refused, so nothing reaches the source after a stop. Only retrieval-worker
// code imports this package; the web app never loads a browser.
//
// pageScripts "skip" (LinkedIn Option A, November 8, 2026): JavaScript is
// off in the context, and the only request allowed to leave the browser is
// the main-frame document navigate() asked for. The browser follows that
// document's own HTTP redirects (each hop is a document request and is
// counted). Every other request (scripts, stylesheets, images, fonts, media,
// frames, prefetches) is refused before it is sent. Each navigation reports
// what it sent and refused (BrowserRequestCounts).

export interface BrowserLaunchOptions {
  // The Chromium or Chrome binary (RETRIEVAL_BROWSER_EXECUTABLE).
  executablePath: string;
  // Whether the page's own scripts run. Default "run" (feature 14's
  // browser-assisted sources, unchanged).
  pageScripts?: "run" | "skip";
}

const skippedResources = new Set(["image", "font", "media"]);

class RequestCounter {
  private documents = 0;
  private sent = 0;
  private blocked = 0;
  private byType: Record<string, number> = {};
  constructor(private readonly pageScripts: "run" | "skip") {}
  reset() {
    this.documents = 0;
    this.sent = 0;
    this.blocked = 0;
    this.byType = {};
  }
  // A request the browser sent (redirect hops included: each is its own request).
  sentRequest(isMainDocument: boolean) {
    this.sent += 1;
    if (isMainDocument) this.documents += 1;
  }
  blockedRequest(type: string) {
    this.blocked += 1;
    this.byType[type] = (this.byType[type] ?? 0) + 1;
  }
  snapshot(redirects: number): BrowserRequestCounts {
    return { pageScripts: this.pageScripts, documentRequests: this.documents, redirects, sentRequests: this.sent, blockedRequests: this.blocked, blockedByType: { ...this.byType } };
  }
}

// The page as rendered. While the page is trying to navigate away by itself
// (an attempt the route guard refuses), the content cannot be read; it is
// read again once that refused navigation has settled, a bounded few times.
async function documentHtml(page: Page): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await page.content();
    } catch (error) {
      if (attempt >= 5) throw error;
      await page.waitForTimeout(100 * attempt);
    }
  }
}

// Response headers for diagnosis, with Set-Cookie reduced to cookie names.
function diagnosticHeaders(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    kept[name] = name.toLowerCase() === "set-cookie"
      ? value.split("\n").map((cookie) => cookie.split("=")[0]!.trim()).filter(Boolean).join(", ")
      : value;
  }
  return kept;
}

export async function launchBrowserDriver(options: BrowserLaunchOptions): Promise<BrowserDriver> {
  const pageScripts = options.pageScripts ?? "run";
  const browser = await chromium.launch({ executablePath: options.executablePath, headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: pageScripts === "run" });
    if ((await context.cookies()).length) throw new Error("A new browser context unexpectedly held cookies");
    const page = await context.newPage();
    // True only while navigate() is loading the page it was asked for.
    let requested = false;
    const counter = new RequestCounter(pageScripts);
    const isMainDocument = (request: Request) => request.isNavigationRequest() && request.frame() === page.mainFrame() && request.resourceType() === "document";
    // Routed requests only: a redirect hop is not routed again; the browser
    // sends it as part of the allowed document request (counted below).
    const blocked = new WeakSet<Request>();
    await context.route("**/*", (route) => {
      const request = route.request();
      const refuse = () => {
        blocked.add(request);
        counter.blockedRequest(request.resourceType());
        return route.abort("blockedbyclient");
      };
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !requested) return refuse();
      if (pageScripts === "skip" && !(requested && isMainDocument(request))) return refuse();
      if (skippedResources.has(request.resourceType())) return refuse();
      return route.continue();
    });
    // Every request the page issues, redirect hops included, is announced
    // here; the ones refused above never left the browser.
    const sent = new Set<Request>();
    context.on("request", (request) => {
      sent.add(request);
    });
    const settleCounts = () => {
      for (const request of sent) if (!blocked.has(request)) counter.sentRequest(isMainDocument(request));
      sent.clear();
    };
    const redirectsOf = (request: Request | undefined) => {
      let hops = 0;
      for (let current = request?.redirectedFrom() ?? null; current; current = current.redirectedFrom()) hops += 1;
      return hops;
    };
    return {
      async navigate(url, { timeoutMs }): Promise<BrowserNavigation> {
        counter.reset();
        sent.clear();
        requested = true;
        let response;
        try {
          response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        } catch (error) {
          settleCounts();
          // The requests a failed load made, for the caller's diagnostics.
          if (error && typeof error === "object") Object.assign(error, { requests: counter.snapshot(0) });
          throw error;
        } finally {
          requested = false;
        }
        const retryAfterSeconds = parseRetryAfter((await response?.headerValue("retry-after")) ?? null, new Date());
        // The document as sent, before page scripts changed it (best effort).
        const servedHtml = response ? await response.text().catch(() => undefined) : undefined;
        const html = await documentHtml(page);
        settleCounts();
        const requests = counter.snapshot(redirectsOf(response?.request()));
        return {
          status: response?.status() ?? null,
          finalUrl: page.url(),
          html,
          requests,
          ...(servedHtml === undefined ? {} : { servedHtml }),
          cookieNames: (await context.cookies()).map((cookie) => cookie.name),
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          ...(response ? { headers: diagnosticHeaders(await response.allHeaders()) } : {}),
        };
      },
      async close() {
        await context.close();
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// The returned page as a document for the adapter's parser. Page scripts are
// not run: the HTML is only read.
export function parseHtml(html: string, url: string): Document {
  return new JSDOM(html, { url }).window.document;
}
