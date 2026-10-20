import { AdapterError } from "./contract";

// Browser-assisted retrieval (feature 14, Core TDD §51): the shared layer a
// browser-assisted adapter uses instead of the HTTP transport. It is
// deliberately small and conservative:
// - one page at a time, at least minIntervalMs between navigation starts;
// - a hard cap on navigations per run and on page size;
// - after every navigation, a stop check: 429 (RATE_LIMITED), 403 or 999,
//   a login wall, authwall, checkpoint, CAPTCHA or challenge, an
//   authentication cookie, or a server error stops the run, and every later
//   open() in the run is refused without navigating (no retry);
// - adapters only open pages and read the returned document: there is no
//   way to click, type, submit, scroll or use an account.
// The browser itself (packages/browser-retrieval) runs in a fresh, logged-out
// context per run with no cookies, profile or stored state; nothing here
// rotates, disguises or works around an access control.

export interface BrowserNavigation {
  // The main document's HTTP status (null when the browser reports none).
  status: number | null;
  // Where the browser ended up after any redirects.
  finalUrl: string;
  html: string;
  // The names of the cookies the browser holds after the navigation.
  cookieNames: readonly string[];
  // A valid Retry-After the response carried, in seconds.
  retryAfterSeconds?: number;
  // The main document's response headers, for diagnosis; Set-Cookie keeps
  // only the cookie names, never their values.
  headers?: Readonly<Record<string, string>>;
}

// What drives the browser. The production driver is Playwright with
// Chromium; tests use a fixture driver that serves recorded pages.
export interface BrowserDriver {
  navigate(url: string, options: { timeoutMs: number }): Promise<BrowserNavigation>;
  close(): Promise<void>;
}

export interface BrowserPage {
  status: number;
  finalUrl: string;
  document: Document;
}

export interface BrowserSession {
  open(url: string): Promise<BrowserPage>;
  // Navigations made so far in this run.
  readonly navigations: number;
}

export interface BrowserSessionOptions {
  minIntervalMs: number;
  maxNavigations: number;
  timeoutMs?: number;
  maxPageBytes?: number;
  // Cookies whose presence means an account session (for LinkedIn, li_at):
  // nothing logs in, so one appearing stops the run.
  authCookieNames?: readonly string[];
  // Source-specific access friction read from the page, in addition to the
  // generic checks; returns a short reason, or null.
  detectFriction?: (page: { finalUrl: string; document: Document }) => string | null;
  parse: (html: string, url: string) => Document;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const defaultBrowserTimeoutMs = 30_000;
export const defaultMaxBrowserPageBytes = 5 * 1024 * 1024;

// URL paths that mean the page was replaced by a sign-in or a challenge.
const blockedPath = /\/(authwall|login|signup|checkpoint|challenge|uas\/login|captcha)(\/|\?|$)/i;

// Generic access friction visible in a page: a CAPTCHA widget or challenge
// form, or a sign-in wall in place of the content.
export function detectGenericFriction(page: { finalUrl: string; document: Document }): string | null {
  let path = "";
  try {
    path = new URL(page.finalUrl).pathname;
  } catch {
    return "unreadable page address";
  }
  if (blockedPath.test(path)) return "sign-in or challenge page";
  const document = page.document;
  if (document.querySelector('iframe[src*="captcha" i], iframe[src*="challenge" i], [id*="captcha" i], [class*="captcha" i], form[action*="checkpoint" i]')) {
    return "CAPTCHA or challenge";
  }
  return null;
}

export function createBrowserSession(driver: BrowserDriver, options: BrowserSessionOptions): BrowserSession {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? defaultBrowserTimeoutMs;
  const maxPageBytes = options.maxPageBytes ?? defaultMaxBrowserPageBytes;
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart: number | null = null;
  let navigations = 0;
  let stopped: AdapterError | null = null;

  const stop = (error: AdapterError): never => {
    stopped = error;
    throw error;
  };

  async function navigate(url: string): Promise<BrowserPage> {
    if (stopped) throw new AdapterError(stopped.code, "Browser retrieval stopped earlier in the run", { ...stopped.details, url });
    if (navigations >= options.maxNavigations) throw new AdapterError("CONFIG", "The run's page budget is used up", { url });
    if (lastStart !== null) {
      const wait = lastStart + options.minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = now();
    navigations += 1;
    let result: BrowserNavigation;
    try {
      result = await driver.navigate(url, { timeoutMs });
    } catch (error) {
      if (error instanceof AdapterError) return stop(error);
      // A timeout or a failed load stops the run like an HTTP network error.
      return stop(new AdapterError("NETWORK", "The page could not be loaded", { url }));
    }
    const status = result.status ?? 0;
    const retryAfter = result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds };
    if (status === 429) stop(new AdapterError("RATE_LIMITED", "The source rate-limited the request (HTTP 429)", { status, url, ...retryAfter }));
    if (status === 401 || status === 403 || status === 999) {
      stop(new AdapterError("ACCESS_DENIED", `The source refused access (HTTP ${status})`, { status, url }));
    }
    if (status >= 500) stop(new AdapterError("SERVER_ERROR", `The source had a server error (HTTP ${status})`, { status, url, ...retryAfter }));
    if (options.authCookieNames?.some((name) => result.cookieNames.includes(name))) {
      stop(new AdapterError("ACCESS_DENIED", "An account session cookie appeared; browser retrieval is logged-out only", { url }));
    }
    if (result.html.length > maxPageBytes) stop(new AdapterError("RESPONSE_TOO_LARGE", "The page was larger than allowed", { url }));
    const document = options.parse(result.html, result.finalUrl);
    const page = { finalUrl: result.finalUrl, document };
    const friction = detectGenericFriction(page) ?? options.detectFriction?.(page) ?? null;
    if (friction) stop(new AdapterError("ACCESS_DENIED", `The source presented ${friction}; retrieval stopped`, { status, url }));
    return { status, finalUrl: result.finalUrl, document };
  }

  return {
    open(url) {
      const run = queue.catch(() => undefined).then(() => navigate(url));
      queue = run;
      return run;
    },
    get navigations() {
      return navigations;
    },
  };
}
