// Welcome to the Jungle / Otta for Mode B's background-tab detail reading
// (P2): the real F0 cards placed back into a results list, synthetic job
// pages modelled on the public job-page layout the single-job reader targets
// (JSON-LD JobPosting plus the visible posting; none is a captured response),
// and a fake Chrome for the tab orchestrator that serves those pages and runs
// the extension's real page check and the unchanged single-job reader over
// them in jsdom. No network, no browser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { readJobPage } from "../../apps/web/src/server/page-capture-acquisition";
import { probeJobPage, type TabProbe, type TabRunEnvironment, type TabRunState } from "../../apps/extension/src/tab-acquisition";
import type { ApiResult, TabReportResponse, TabStartResponse } from "../../apps/extension/src/api";

export const wttjF0 = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/page-capture/wttj-f0-cards.json"), "utf8")) as {
  site: string;
  page: string;
  cards: string[];
};

export function wttjF0ResultsPage(cards: readonly string[] = wttjF0.cards): string {
  return `<!doctype html><html><head><title>Jobs | Welcome to the Jungle</title></head><body>
<header><nav><a href="https://www.welcometothejungle.com/en/jobs">Find a job</a></nav></header>
<main><div class="flex flex-col gap-xl">${cards.join("\n")}</div></main></body></html>`;
}

// The five F0 jobs' canonical URLs, in page order.
export const wttjF0Urls = [
  "https://www.welcometothejungle.com/en/companies/fourkites/jobs/customer-success-manager_chicago_u5qqn3w3",
  "https://www.welcometothejungle.com/en/companies/caddi/jobs/senior-customer-success-manager-solutions_chicago_jac2cqlp",
  "https://www.welcometothejungle.com/en/companies/culture-amp/jobs/senior-customer-success-manager-commercial_chicago_lve2yddj",
  "https://www.welcometothejungle.com/en/companies/box/jobs/senior-customer-success-manager-central_chicago_cvrvkbqh",
  "https://www.welcometothejungle.com/en/companies/mongodb/jobs/senior-customer-success-manager_chicago_y3jbm7kk",
] as const;

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function wttjJobPage(input: { title: string; company: string; city: string; descriptionHtml: string; salary?: { min: number; max: number } | null }): string {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: input.title,
    description: input.descriptionHtml,
    datePosted: "2026-10-30",
    employmentType: "FULL_TIME",
    hiringOrganization: { "@type": "Organization", name: input.company },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: input.city, addressCountry: "US" } },
    ...(input.salary
      ? { baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: input.salary.min, maxValue: input.salary.max, unitText: "YEAR" } } }
      : {}),
  };
  return `<!doctype html><html><head><title>${escape(input.title)} - ${escape(input.company)} - Welcome to the Jungle</title>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script></head><body>
<header><nav><a href="/en/jobs">Find a job</a><a href="/en/signin">Log in</a></nav></header>
<main><h1>${escape(input.title)}</h1><p>${escape(input.company)} · ${escape(input.city)}</p>
<section data-testid="job-section-description">${input.descriptionHtml}</section>
<aside><h2>Similar jobs</h2><a href="/en/companies/other/jobs/support-engineer_chicago">Support Engineer</a></aside></main>
<footer>© Welcome to the Jungle</footer></body></html>`;
}

export const csmDescription = (salary: string | null) =>
  [
    "<p>As a Customer Success Manager you own onboarding, adoption, renewals and expansion for a portfolio of mid-market SaaS customers.</p>",
    "<p>This is a fully remote role. Applicants must reside in the United States.</p>",
    salary ? `<p>Base salary ${salary}.</p>` : "<p>Compensation is not stated.</p>",
    "<ul><li>Run quarterly business reviews</li><li>Partner with Sales and Support</li></ul>",
  ].join("");

// A page the fake browser serves for a URL: the HTTP status the page's
// navigation timing reports, its final address (a redirect) and its markup.
export interface ServedPage {
  status: number | null;
  finalUrl?: string;
  html: string;
  // The tab never finishes loading (load timeout).
  hangs?: boolean;
  // The final address is on a host the extension may not see (tab.url
  // undefined).
  hiddenUrl?: boolean;
  // The posting appears only after this many re-reads (a page still
  // rendering).
  postingAfterReads?: number;
  // The page's own document before it renders its body (its structured data
  // only), served for this many reads before `html`.
  earlyHtml?: string;
  renderedAfterReads?: number;
}

export function runProbe(html: string, url: string, status: number | null): TabProbe {
  const window = new JSDOM(html, { url, runScripts: "outside-only" }).window as unknown as Window & { eval(source: string): unknown };
  if (status !== null) {
    window.eval(`performance.getEntriesByType = (type) => type === "navigation" ? [{ responseStatus: ${status} }] : [];`);
  }
  const source = probeJobPage.toString();
  return JSON.parse(
    JSON.stringify(window.eval(`(() => { const __name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true }); return (${source})(); })()`)),
  ) as TabProbe;
}

type Api = TabRunEnvironment["api"];

// A fake Chrome and app for the orchestrator: records every tab opened and
// closed, every report, and the clock at each navigation.
export function fakeTabEnvironment(input: {
  serve: (url: string) => ServedPage;
  api?: Partial<Api>;
  permission?: () => boolean;
  start?: number;
}) {
  let clock = input.start ?? Date.parse("2026-11-04T12:00:00.000Z");
  let nextTab = 100;
  let stored: TabRunState | null = null;
  const tabs = new Map<number, { url: string; page: ServedPage; reads: number; userClosed: boolean }>();
  const log = {
    opened: [] as Array<{ tabId: number; url: string; at: number }>,
    closed: [] as number[],
    probes: [] as Array<{ tabId: number; at: number }>,
    reads: [] as Array<{ tabId: number; at: number }>,
    starts: [] as string[],
    details: [] as Array<{ itemId: string; pageUrl: string; title: string; remainingItemIds: string[]; capture: Parameters<Api["pageCaptureTabDetails"]>[1]["capture"] }>,
    results: [] as Array<{ itemId: string; result: string; signal: string | null; finalUrl: string | null; remainingItemIds: string[] }>,
    stops: [] as Array<{ site: string; itemIds: string[]; reason: string }>,
    keepAlive: [] as boolean[],
  };
  // Hooks the tests use to act as the user while a run is in progress.
  const hooks = { afterOpen: null as ((tabId: number) => void) | null, duringSleep: null as ((ms: number) => void) | null };
  const report = (itemId: string, outcome: TabReportResponse["outcome"], extra: Partial<TabReportResponse> = {}): ApiResult<TabReportResponse> => ({
    ok: true,
    status: 200,
    body: { itemId, outcome, status: "QUEUED", opportunityId: null, stopBatch: false, stoppedUntil: null, ...extra },
  });
  const api: Api = {
    pageCaptureTabStart: async (itemId) => {
      log.starts.push(itemId);
      const body: TabStartResponse = { proceed: true, itemId, url: urls.get(itemId) ?? "" };
      return { ok: true, status: 200, body };
    },
    pageCaptureTabDetails: async (itemId, body) => {
      log.details.push({ itemId, pageUrl: body.capture.pageUrl, title: body.capture.fields.title, remainingItemIds: body.remainingItemIds, capture: body.capture });
      return report(itemId, "INGESTED", { opportunityId: `opportunity-${itemId}` });
    },
    pageCaptureTabResult: async (itemId, body) => {
      log.results.push({ itemId, ...body });
      return report(itemId, body.result, body.result === "BLOCKED" ? { stopBatch: true, stoppedUntil: new Date(clock + 86_400_000).toISOString() } : {});
    },
    pageCaptureTabStop: async (body) => {
      log.stops.push(body);
      return { ok: true, status: 200, body: { stopped: body.itemIds.length } };
    },
    ...input.api,
  };
  const urls = new Map<string, string>();
  const environment: TabRunEnvironment = {
    api,
    tabs: {
      async open(url) {
        const tabId = nextTab++;
        tabs.set(tabId, { url, page: input.serve(url), reads: 0, userClosed: false });
        log.opened.push({ tabId, url, at: clock });
        hooks.afterOpen?.(tabId);
        return tabId;
      },
      async url(tabId) {
        const tab = tabs.get(tabId);
        if (!tab || tab.userClosed) throw new Error("No tab");
        if (tab.page.hiddenUrl) return null;
        return tab.page.hangs ? "" : (tab.page.finalUrl ?? tab.url);
      },
      async exists(tabId) {
        const tab = tabs.get(tabId);
        return Boolean(tab && !tab.userClosed);
      },
      async waitForLoad(tabId, timeoutMs) {
        const tab = tabs.get(tabId);
        if (!tab || tab.userClosed) return "removed";
        if (tab.page.hangs) {
          clock += timeoutMs;
          return "timeout";
        }
        clock += 800;
        return tabs.get(tabId)?.userClosed ? "removed" : "complete";
      },
      async close(tabId) {
        log.closed.push(tabId);
        tabs.delete(tabId);
      },
    },
    page: {
      async probe(tabId) {
        const tab = tabs.get(tabId)!;
        log.probes.push({ tabId, at: clock });
        return runProbe(tab.page.html, tab.page.finalUrl ?? tab.url, tab.page.status);
      },
      async read(tabId) {
        const tab = tabs.get(tabId)!;
        log.reads.push({ tabId, at: clock });
        tab.reads += 1;
        const html =
          tab.page.postingAfterReads && tab.reads <= tab.page.postingAfterReads
            ? "<html><body><main><p>Loading…</p></main></body></html>"
            : tab.page.earlyHtml && tab.reads <= (tab.page.renderedAfterReads ?? Infinity)
              ? tab.page.earlyHtml
              : tab.page.html;
        return readJobPage(new JSDOM(html, { url: tab.page.finalUrl ?? tab.url, runScripts: "outside-only" }).window.document);
      },
    },
    hasPermission: async () => (input.permission ? input.permission() : true),
    storage: {
      load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as TabRunState) : null),
      save: async (state) => {
        stored = state ? (JSON.parse(JSON.stringify(state)) as TabRunState) : null;
      },
    },
    now: () => clock,
    sleep: async (ms) => {
      hooks.duringSleep?.(ms);
      clock += ms;
    },
    extensionVersion: "0.2.0",
    keepAlive: (active) => log.keepAlive.push(active),
  };
  return {
    environment,
    log,
    hooks,
    // The user closes the extension's tab.
    userCloses: (tabId: number) => {
      const tab = tabs.get(tabId);
      if (tab) tab.userClosed = true;
    },
    stored: () => stored,
    setStored: (state: TabRunState | null) => {
      stored = state;
    },
    openTab: (url: string, page: ServedPage) => {
      const tabId = nextTab++;
      tabs.set(tabId, { url, page, reads: 0, userClosed: false });
      return tabId;
    },
    registerItems: (items: Array<{ itemId: string; url: string }>) => items.forEach((item) => urls.set(item.itemId, item.url)),
    now: () => clock,
  };
}

export const wttjRunSettings = {
  site: "welcome-to-the-jungle",
  siteName: "Welcome to the Jungle / Otta",
  hostPermissions: ["https://www.welcometothejungle.com/*", "https://app.welcometothejungle.com/*"],
  minIntervalMs: 12_000,
  loadTimeoutMs: 30_000,
  rereadDelaysMs: [2_000, 5_000, 10_000],
};
