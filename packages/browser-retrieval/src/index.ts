import type { BrowserDriver, BrowserNavigation } from "@ai-career/discovery";
import { parseRetryAfter } from "@ai-career/discovery";
import { JSDOM } from "jsdom";
import { chromium, type Page } from "playwright-core";

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

export interface BrowserLaunchOptions {
  // The Chromium or Chrome binary (RETRIEVAL_BROWSER_EXECUTABLE).
  executablePath: string;
}

const skippedResources = new Set(["image", "font", "media"]);

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
  const browser = await chromium.launch({ executablePath: options.executablePath, headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
    if ((await context.cookies()).length) throw new Error("A new browser context unexpectedly held cookies");
    const page = await context.newPage();
    // True only while navigate() is loading the page it was asked for.
    let requested = false;
    await context.route("**/*", (route) => {
      const request = route.request();
      if (skippedResources.has(request.resourceType())) return route.abort();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !requested) return route.abort();
      return route.continue();
    });
    return {
      async navigate(url, { timeoutMs }): Promise<BrowserNavigation> {
        requested = true;
        let response;
        try {
          response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        } finally {
          requested = false;
        }
        const retryAfterSeconds = parseRetryAfter((await response?.headerValue("retry-after")) ?? null, new Date());
        return {
          status: response?.status() ?? null,
          finalUrl: page.url(),
          html: await documentHtml(page),
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
