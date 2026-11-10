// The bounded P1 verification experiment (pnpm page-capture:verify), run
// against a fake browser and a fake clock: no network, browser or database.
// It opens at most 5 job pages, each once and in the canonical form
// production acquisition fetches, at least the site's interval apart, and the
// first access restriction (BLOCKED) or unreadable / wrong page (FAIL) stops
// it with no further request. LinkedIn's own friction checks (login wall,
// security check, anti-bot interstitial) apply, here and in production
// acquisition.
import { describe, expect, it } from "vitest";
import { pageCaptureSiteByKey } from "@ai-career/core";
import type { BrowserDriver, BrowserNavigation } from "@ai-career/discovery";
import { createPageCaptureAcquisition, pageCaptureFrictionDetector } from "../../apps/web/src/server/page-capture-acquisition";
import { runPageCaptureVerification } from "../../apps/web/src/server/page-capture-verify";
import { testSiteJobPage } from "../support/page-capture-pages";

const linkedin = pageCaptureSiteByKey("linkedin")!;
// The five LinkedIn F0 cards' links (slug form, as the results page shows them).
const f0Urls = [
  "https://www.linkedin.com/jobs/view/everhealth-strategic-customer-success-manager-remote-us-at-evercommerce-4484727127",
  "https://www.linkedin.com/jobs/view/customer-success-manager-at-planhat-4423511448",
  "https://www.linkedin.com/jobs/view/customer-success-manager-at-happy-returns-a-ups-company-4486498409",
  "https://www.linkedin.com/jobs/view/customer-success-manager-at-circadia-health-4444032301",
  "https://www.linkedin.com/jobs/view/customer-success-manager-at-silent-witness-4486439538",
];
const canonical = (url: string) => `https://www.linkedin.com/jobs/view/${/(\d{5,20})$/.exec(url)![1]}`;

const description =
  "<p>Own a portfolio of B2B SaaS customers from onboarding through renewal and expansion.</p>" +
  "<ul><li>Drive adoption and measurable value realization across every account</li><li>Run quarterly business reviews with executive sponsors</li>" +
  "<li>Partner with Sales, Support and Product on renewals and expansion</li></ul><p>Full-time. Remote in the United States.</p>";
const readablePage = (id: string) => testSiteJobPage({ id, title: `Customer Success Manager ${id}`, company: "Northwind", description });

type Served = Partial<BrowserNavigation> & { html?: string };

function fakeBrowser(serve: (url: string, index: number) => Served) {
  let clock = 1_000_000;
  const starts: number[] = [];
  const navigated: string[] = [];
  const driver: BrowserDriver = {
    async navigate(url) {
      starts.push(clock);
      navigated.push(url);
      const served = serve(url, navigated.length - 1);
      return { status: 200, finalUrl: url, html: "", cookieNames: [], ...served } as BrowserNavigation;
    },
    close: async () => undefined,
  };
  return {
    driver,
    starts,
    navigated,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

const run = (browser: ReturnType<typeof fakeBrowser>, urls = f0Urls) =>
  runPageCaptureVerification({ site: linkedin, urls, driver: browser.driver, now: browser.now, sleep: browser.sleep });

const idOf = (url: string) => /(\d{5,20})$/.exec(url)![1]!;

describe("the P1 verification experiment", () => {
  it("passes when all five canonical job pages load without restriction and read as postings, at least 5 s apart, each opened once", async () => {
    const browser = fakeBrowser((url) => ({ html: readablePage(idOf(url)) }));
    const result = await run(browser);
    expect(result).toMatchObject({ verdict: "PASS", readable: 5, requested: 5 });
    expect(browser.navigated).toEqual(f0Urls.map(canonical));
    expect(new Set(browser.navigated).size).toBe(5);
    for (let index = 1; index < browser.starts.length; index += 1) expect(browser.starts[index]! - browser.starts[index - 1]!).toBeGreaterThanOrEqual(5_000);
    expect(result.pages.every((page) => page.result === "READABLE" && page.descriptionChars >= 200)).toBe(true);
  });

  const blockedCases: Array<[string, Served]> = [
    ["HTTP 429", { status: 429, html: "Too many requests" }],
    ["HTTP 403", { status: 403, html: "Forbidden" }],
    ["HTTP 999", { status: 999, html: "" }],
    ["an authwall", { finalUrl: "https://www.linkedin.com/authwall?trk=x", html: "<html><body>Sign in</body></html>" }],
    ["a CAPTCHA", { html: '<html><body><iframe src="https://www.linkedin.com/checkpoint/captcha"></iframe></body></html>' }],
    ["an account cookie", { cookieNames: ["JSESSIONID", "li_at"] }],
    ["LinkedIn's anti-bot interstitial served with 200", { html: '<html><head><meta http-equiv="refresh" content="0;url=/jobs"></head><body></body></html>' }],
    ["LinkedIn's security check", { html: "<html><head><title>Security Verification | LinkedIn</title></head><body></body></html>" }],
    ["LinkedIn's login wall in place of the job", { html: '<html><body><form class="join-form"></form></body></html>' }],
  ];
  for (const [label, served] of blockedCases) {
    it(`is BLOCKED by ${label} on the second page and makes no further request`, async () => {
      const browser = fakeBrowser((url, index) => (index === 1 ? { html: readablePage(idOf(url)), ...served } : { html: readablePage(idOf(url)) }));
      const result = await run(browser);
      expect(result.verdict).toBe("BLOCKED");
      expect(browser.navigated).toHaveLength(2);
      expect(result.pages.map((page) => page.result)).toEqual(["READABLE", "BLOCKED"]);
    });
  }

  it("fails on an unreadable page, a redirect to another job, a 404 or a server error, and stops there", async () => {
    const cases: Array<[Served, string]> = [
      [{ html: "<html><body><main><h1>Customer Success Manager</h1><p>Short.</p></main></body></html>" }, "NOT_READABLE"],
      [{ finalUrl: "https://www.linkedin.com/jobs/view/9999999999", html: readablePage("9999999999") }, "REDIRECTED"],
      [{ finalUrl: "https://www.linkedin.com/jobs/search?keywords=x", html: readablePage("x") }, "REDIRECTED"],
      [{ status: 404, html: "Not found" }, "HTTP_ERROR"],
      [{ status: 503, html: "Unavailable" }, "LOAD_FAILED"],
    ];
    for (const [served, result] of cases) {
      const browser = fakeBrowser((url, index) => (index === 0 ? served : { html: readablePage(idOf(url)) }));
      const outcome = await run(browser);
      expect(outcome.verdict, result).toBe("FAIL");
      expect(outcome.pages.map((page) => page.result), result).toEqual([result]);
      expect(browser.navigated, result).toHaveLength(1);
    }
  });

  it("refuses more than five URLs, another site's URL or a repeated job before opening anything", async () => {
    for (const urls of [[...f0Urls, "https://www.linkedin.com/jobs/view/4100000001"], ["https://www.welcometothejungle.com/en/companies/a/jobs/b"], [f0Urls[0]!, canonical(f0Urls[0]!)], []]) {
      const browser = fakeBrowser(() => ({}));
      await expect(run(browser, urls)).rejects.toThrow();
      expect(browser.navigated).toEqual([]);
    }
  });
});

describe("LinkedIn friction in production acquisition", () => {
  it("uses LinkedIn's own friction checks for LinkedIn only", () => {
    expect(pageCaptureFrictionDetector("linkedin")).toBeTypeOf("function");
    expect(pageCaptureFrictionDetector("welcome-to-the-jungle")).toBeUndefined();
  });

  it("stops the site for at least a day when an anti-bot interstitial arrives with HTTP 200, instead of counting the job unreadable", async () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    const deferred: Array<{ site: string; until: Date; reason: string }> = [];
    const failed: string[] = [];
    const item = {
      id: "i1",
      site: "linkedin",
      host: "www.linkedin.com",
      externalId: "linkedin:4484727127",
      sourceUrl: "https://www.linkedin.com/jobs/view/4484727127",
      siteJobId: "4484727127",
      title: "CSM",
      company: null,
      location: null,
      postedText: null,
      resultsPageUrl: "https://www.linkedin.com/jobs/search",
      firstSeenAt: now,
      lastSeenAt: now,
      sightings: 1,
      lastBatchId: "00000000-0000-4000-8000-000000000001",
      pairingId: "00000000-0000-4000-8000-000000000002",
      status: "ACQUIRING" as const,
      attempts: 0,
      lastAttemptAt: now,
      nextAttemptAt: null,
      lastReason: null,
      opportunityId: null,
      handoffOutcome: null,
      handedOffAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const navigated: string[] = [];
    const acquisition = createPageCaptureAcquisition({
      repository: {
        recoverInterrupted: async () => 0,
        sitesWithQueued: async () => ["linkedin"],
        siteStoppedUntil: async () => null,
        claimQueued: async () => [item],
        markIngested: async () => undefined,
        markFailed: async (id: string) => {
          failed.push(id);
        },
        deferSite: async (site: string, until: Date, reason: string) => {
          deferred.push({ site, until, reason });
        },
        markHandedOff: async () => undefined,
      } as never,
      ingestion: { ingest: async () => { throw new Error("must not ingest"); } } as never,
      handoff: { alreadyHandled: async () => false, request: async () => "QUEUED" },
      discovery: {} as never,
      detailSites: () => ["linkedin"],
      browser: {
        launch: async () => ({
          async navigate(url: string) {
            navigated.push(url);
            return { status: 200, finalUrl: url, html: '<html><head><meta http-equiv="refresh" content="0;url=/"></head><body></body></html>', cookieNames: [] };
          },
          close: async () => undefined,
        }),
      },
      now: () => now,
      sleep: async () => undefined,
    });
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ site: "linkedin", stopped: "ACCESS_STOPPED", ingested: 0 });
    expect(navigated).toEqual(["https://www.linkedin.com/jobs/view/4484727127"]);
    expect(failed).toEqual([]);
    expect(deferred).toHaveLength(1);
    expect(deferred[0]!.until.getTime() - now.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });
});
