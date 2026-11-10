// Feature 14: the browser session (sequential, paced, bounded, stopping on
// any access friction) and the LinkedIn adapter's public-page parsers,
// search URLs, budgets and detail queue, against synthetic pages served by a
// fixture browser driver. Nothing reaches the network or launches a browser.
import { describe, expect, it } from "vitest";
import { rawOpportunitySchema } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  AdapterError,
  createBrowserSession,
  createFixtureTransport,
  createTitleMatcher,
  defaultAdapterRegistry,
  detectGenericFriction,
  detectLinkedInFriction,
  isRemovalCapable,
  linkedinAdapter,
  linkedInHardLimits,
  linkedInJobUrl,
  linkedInKeywords,
  linkedInSearchUrl,
  parseLinkedInJobPage,
  parseLinkedInSearchPage,
  type BrowserSessionOptions,
  type CollectContext,
} from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import {
  authwallPage,
  challengePage,
  createFixtureBrowser,
  interstitialPage,
  jobPage,
  noResultsPage,
  parsePage,
  searchPage,
  unrecognizedPage,
  type FixturePage,
  type SyntheticCard,
} from "../support/linkedin-fixtures";

const page = (html: string, status = 200): FixturePage => ({ status, html });
const ok = page("<html><head><title>ok</title></head><body><p>ok</p></body></html>");

function fakeClock() {
  let time = 1_000_000;
  const waits: number[] = [];
  return {
    waits,
    now: () => time,
    sleep: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function session(pages: Parameters<typeof createFixtureBrowser>[0], options: Partial<BrowserSessionOptions> = {}) {
  const browser = createFixtureBrowser(pages);
  const clock = fakeClock();
  const created = createBrowserSession(browser.driver, {
    minIntervalMs: 5_000,
    maxNavigations: 10,
    parse: (html, url) => parsePage(html, url),
    now: clock.now,
    sleep: clock.sleep,
    ...options,
  });
  return { session: created, browser, clock };
}

describe("the browser session", () => {
  it("navigates one page at a time, at least the minimum interval apart", async () => {
    const { session: s, browser, clock } = session({ "https://a.test/1": ok, "https://a.test/2": ok, "https://a.test/3": ok });
    // Opened together, the pages still load strictly one after another.
    const pages = await Promise.all(["https://a.test/1", "https://a.test/2", "https://a.test/3"].map((url) => s.open(url)));
    expect(pages.map((p) => p.status)).toEqual([200, 200, 200]);
    expect(browser.navigations).toEqual(["https://a.test/1", "https://a.test/2", "https://a.test/3"]);
    expect(browser.state.maxActive).toBe(1);
    expect(clock.waits).toEqual([5_000, 5_000]);
    expect(s.navigations).toBe(3);
  });

  it("waits only for what is left of the interval", async () => {
    const { session: s, clock } = session({ "https://a.test/1": ok, "https://a.test/2": ok });
    await s.open("https://a.test/1");
    clock.advance(3_000);
    await s.open("https://a.test/2");
    expect(clock.waits).toEqual([2_000]);
  });

  it("refuses navigations past the run's page budget", async () => {
    const { session: s, browser } = session({ "https://a.test/1": ok, "https://a.test/2": ok }, { maxNavigations: 1 });
    await s.open("https://a.test/1");
    await expect(s.open("https://a.test/2")).rejects.toMatchObject({ code: "CONFIG" });
    expect(browser.navigations).toHaveLength(1);
  });

  it.each([
    ["HTTP 429", { status: 429, html: "", retryAfterSeconds: 7200 }, "RATE_LIMITED"],
    ["HTTP 403", { status: 403, html: "" }, "ACCESS_DENIED"],
    ["HTTP 999", { status: 999, html: "" }, "ACCESS_DENIED"],
    ["HTTP 401", { status: 401, html: "" }, "ACCESS_DENIED"],
    ["HTTP 503", { status: 503, html: "" }, "SERVER_ERROR"],
    ["an authwall redirect", { status: 200, html: authwallPage(), finalUrl: "https://www.linkedin.com/authwall?trk=x" }, "ACCESS_DENIED"],
    ["a login redirect", { status: 200, html: "<html><body>Sign in</body></html>", finalUrl: "https://www.linkedin.com/login?session_redirect=x" }, "ACCESS_DENIED"],
    ["a checkpoint", { status: 200, html: "<html><body></body></html>", finalUrl: "https://www.linkedin.com/checkpoint/challenge/abc" }, "ACCESS_DENIED"],
    ["a CAPTCHA", { status: 200, html: challengePage() }, "ACCESS_DENIED"],
    ["LinkedIn's anti-bot interstitial", { status: 200, html: interstitialPage() }, "ACCESS_DENIED"],
    ["LinkedIn's anti-bot interstitial with HTTP 429", { status: 429, html: interstitialPage() }, "RATE_LIMITED"],
    ["a challenge iframe", { status: 200, html: '<html><body><iframe src="https://challenges.example/challenge-platform"></iframe></body></html>' }, "ACCESS_DENIED"],
    ["an account cookie", { status: 200, html: "<html><body>ok</body></html>", cookieNames: ["bcookie", "li_at"] }, "ACCESS_DENIED"],
    ["an oversized page", { status: 200, html: "x".repeat(2_000) }, "RESPONSE_TOO_LARGE"],
    ["a failed load", { fail: true }, "NETWORK"],
  ] as const)("stops the run on %s and never navigates again", async (_label, fixture, code) => {
    const { session: s, browser } = session(
      { "https://www.linkedin.com/jobs/1": fixture as FixturePage, "https://www.linkedin.com/jobs/2": ok },
      { authCookieNames: ["li_at"], maxPageBytes: 1_000, detectFriction: detectLinkedInFriction },
    );
    const error = await s.open("https://www.linkedin.com/jobs/1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code });
    expect((error as AdapterError).details.retryAfterSeconds).toBe((fixture as FixturePage).retryAfterSeconds);
    await expect(s.open("https://www.linkedin.com/jobs/2")).rejects.toMatchObject({ code });
    expect(browser.navigations).toEqual(["https://www.linkedin.com/jobs/1"]);
  });

  it("applies the adapter's own friction check, and returns other statuses to the adapter", async () => {
    const { session: s } = session(
      { "https://www.linkedin.com/jobs/view/1": page(authwallPage()), "https://www.linkedin.com/jobs/view/2": page("<html><body>gone</body></html>", 404) },
      { detectFriction: detectLinkedInFriction },
    );
    await expect(s.open("https://www.linkedin.com/jobs/view/2")).resolves.toMatchObject({ status: 404 });
    await expect(s.open("https://www.linkedin.com/jobs/view/1")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("exposes only open: a session cannot click, type, submit or sign in", () => {
    const { session: s } = session({});
    expect(Object.keys(s).sort()).toEqual(["navigations", "open"]);
  });

  it("reads friction from the page address and structure only", () => {
    const doc = parsePage("<html><body><p>Customer Success Manager</p></body></html>");
    expect(detectGenericFriction({ finalUrl: "https://www.linkedin.com/jobs/view/1", document: doc })).toBeNull();
    expect(detectGenericFriction({ finalUrl: "https://www.linkedin.com/uas/login?x", document: doc })).not.toBeNull();
    expect(detectLinkedInFriction({ finalUrl: "https://www.linkedin.com/jobs/view/1", document: parsePage(challengePage()) })).toBe("security check");
    // A sign-in modal over public results (as seen in a local check) is not
    // friction; the same modal with no job content is a login wall.
    const modalOverResults = searchPage([{ id: "4011111111", title: "Customer Success Manager" }]).replace(
      "</main>",
      '<div class="modal"><h2>Sign in to view more jobs</h2><form class="join-form" action="/signup/cold-join"><input name="email"></form></div></main>',
    );
    expect(detectLinkedInFriction({ finalUrl: "https://www.linkedin.com/jobs/search/", document: parsePage(modalOverResults) })).toBeNull();
    expect(parseLinkedInSearchPage(parsePage(modalOverResults)).cards.map((card) => card.id)).toEqual(["4011111111"]);
    expect(detectLinkedInFriction({ finalUrl: "https://www.linkedin.com/jobs/search/", document: parsePage(authwallPage()) })).toBe("login wall");
    // The anti-bot interstitial is friction whatever its status; real pages are not.
    expect(detectLinkedInFriction({ finalUrl: "https://www.linkedin.com/jobs/search", document: parsePage(interstitialPage()) })).toBe("an anti-bot interstitial");
    for (const html of [searchPage([{ id: "1", title: "Customer Success Manager" }]), noResultsPage(), jobPage({ id: "1", title: "Customer Success Manager" })]) {
      expect(detectLinkedInFriction({ finalUrl: "https://www.linkedin.com/jobs/search", document: parsePage(html) })).toBeNull();
    }
  });
});

describe("LinkedIn parsing", () => {
  it("reads search cards, taking the job ID from the entity URN or the job link", () => {
    const result = parseLinkedInSearchPage(
      parsePage(
        searchPage([
          { id: "4011111111", title: "Customer Success Manager", company: "Acme", location: "Remote", listedAt: "2026-10-18" },
          { id: "4022222222", title: "Senior Data Engineer", idIn: "link" },
          { id: "0", title: "No ID here", idIn: "none" },
        ]),
      ),
    );
    expect(result.recognized).toBe(true);
    expect(result.unidentified).toBe(1);
    expect(result.cards).toEqual([
      { id: "4011111111", title: "Customer Success Manager", company: "Acme", location: "Remote", listedAt: "2026-10-18" },
      { id: "4022222222", title: "Senior Data Engineer", company: "Acme", location: "United States", listedAt: "2026-10-17" },
    ]);
  });

  it("tells an empty result from an unrecognized page", () => {
    expect(parseLinkedInSearchPage(parsePage(noResultsPage()))).toEqual({ recognized: true, cards: [], unidentified: 0 });
    expect(parseLinkedInSearchPage(parsePage(unrecognizedPage()))).toEqual({ recognized: false, cards: [], unidentified: 0 });
  });

  it("reads a job page's schema.org JobPosting data first", () => {
    const job = parseLinkedInJobPage(
      parsePage(jobPage({ id: "4011111111", title: "Customer Success Manager", company: "Acme", remote: true, salary: "$90,000.00/yr - $110,000.00/yr", applyUrl: "https://boards.greenhouse.io/acme/jobs/123" })),
      "4011111111",
    );
    expect(job).toMatchObject({
      id: "4011111111",
      title: "Customer Success Manager",
      company: "Acme",
      location: "Denver, CO, US",
      postedAt: "2026-10-17T12:00:00.000Z",
      employmentType: "Full-time",
      seniority: "Mid-Senior level",
      jobFunction: "Customer Service",
      industries: "Software Development",
      salaryText: "$90,000.00/yr - $110,000.00/yr",
      remote: true,
      applicationUrl: "https://boards.greenhouse.io/acme/jobs/123",
      structuredData: true,
    });
    expect(job!.descriptionHtml).toContain("renewals");
  });

  it("falls back to the public page's own fields, and states no application address it does not show", () => {
    const job = parseLinkedInJobPage(parsePage(jobPage({ id: "1", title: "Client Success Lead", company: "Beta", structured: false })), "1");
    expect(job).toMatchObject({ title: "Client Success Lead", company: "Beta", location: "Denver, CO", postedAt: null, remote: false, applicationUrl: null, structuredData: false });
  });

  it("returns null for a page that is neither", () => {
    expect(parseLinkedInJobPage(parsePage(unrecognizedPage()), "1")).toBeNull();
  });

  it("builds deterministic public search URLs, paged only by start", () => {
    const config = linkedinAdapter.configSchema.parse({});
    expect(config).toEqual({ workplace: "remote", postedWithinDays: 7, maxSearchPages: 4, maxDiscovered: 100, maxDetailsPerRun: 20 });
    const keywords = linkedInKeywords(config, ["customer success", "client success"]);
    expect(keywords).toBe('"customer success" OR "client success"');
    expect(linkedInSearchUrl(config, keywords, 0)).toBe(
      "https://www.linkedin.com/jobs/search/?keywords=%22customer+success%22+OR+%22client+success%22&f_TPR=r604800&f_WT=2&start=0",
    );
    const located = linkedinAdapter.configSchema.parse({ keywords: "customer success", location: "United States", workplace: "any", postedWithinDays: "1" });
    expect(linkedInSearchUrl(located, linkedInKeywords(located, []), 25)).toBe(
      "https://www.linkedin.com/jobs/search/?keywords=customer+success&location=United+States&f_TPR=r86400&start=25",
    );
    expect(linkedInJobUrl("4011111111")).toBe("https://www.linkedin.com/jobs/view/4011111111");
  });

  it("verifies with one search page and the first job page it lists", () => {
    const config = linkedinAdapter.configSchema.parse({ maxSearchPages: 1, maxDetailsPerRun: 1 });
    expect(linkedinAdapter.verificationUrl(config)).toBe(linkedInSearchUrl(config, '"customer success"', 0));
    const listed = parsePage(searchPage([{ id: "4011111111", title: "Data Engineer" }, { id: "4022222222", title: "Customer Success Manager" }]));
    expect(linkedinAdapter.verificationFollowUpUrl!(listed, config)).toBe(linkedInJobUrl("4011111111"));
    expect(linkedinAdapter.verificationFollowUpUrl!(parsePage(noResultsPage()), config)).toBeNull();
  });

  it("accepts no credentials, cookies, profile or unbounded budgets", () => {
    for (const extra of [{ cookie: "li_at=x" }, { password: "x" }, { username: "x" }, { storageState: "/tmp/x" }, { profileDir: "/tmp/x" }, { proxy: "http://x" }]) {
      expect(linkedinAdapter.configSchema.safeParse(extra).success).toBe(false);
    }
    expect(linkedinAdapter.configSchema.safeParse({ maxSearchPages: linkedInHardLimits.searchPages + 1 }).success).toBe(false);
    expect(linkedinAdapter.configSchema.safeParse({ maxDiscovered: linkedInHardLimits.discovered + 1 }).success).toBe(false);
    expect(linkedinAdapter.configSchema.safeParse({ maxDetailsPerRun: linkedInHardLimits.detailsPerRun + 1 }).success).toBe(false);
    expect(linkedinAdapter.configSchema.safeParse({ postedWithinDays: 14 }).success).toBe(false);
  });

  it("is registered as browser-assisted, bounded, unverified and logged-out", () => {
    expect(defaultAdapterRegistry.get("linkedin")).toBe(linkedinAdapter);
    expect(linkedinAdapter).toMatchObject({
      retrievalType: "BROWSER_ASSISTED",
      sourceCategory: "JOB_BOARD",
      sourceType: "PUBLIC_SEARCH",
      verified: false,
      requiresBrowser: true,
      requiredEnv: ["RETRIEVAL_BROWSER_EXECUTABLE"],
      minRequestIntervalMs: 5_000,
      browser: { authCookieNames: ["li_at"], maxNavigations: linkedInHardLimits.searchPages + linkedInHardLimits.detailsPerRun },
    });
    expect(isRemovalCapable(linkedinAdapter)).toBe(false);
    // The run budgets are not part of the tracking scope.
    const base = linkedinAdapter.configSchema.parse({});
    expect(linkedinAdapter.trackingScope!(base)).toEqual(linkedinAdapter.trackingScope!({ ...base, maxDetailsPerRun: 5, maxSearchPages: 1 }));
    expect(linkedinAdapter.trackingScope!(base)).not.toEqual(linkedinAdapter.trackingScope!({ ...base, keywords: "client success" }));
  });
});

describe("LinkedIn collection", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");
  const keepCs = createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms);
  const defaults = linkedinAdapter.configSchema.parse({});
  const searchUrl = (start: number, config = defaults) =>
    linkedInSearchUrl(config, linkedInKeywords(config, customerSuccessDiscoveryConfiguration.searchQueries), start);
  const cs = (n: number): SyntheticCard => ({ id: String(4_100_000_000 + n), title: n % 2 ? "Customer Success Manager" : "Senior Customer Success Manager" });
  const other = (n: number): SyntheticCard => ({ id: String(4_200_000_000 + n), title: "Backend Engineer" });

  function run(
    pages: Record<string, FixturePage>,
    options: { config?: Record<string, unknown>; checked?: Map<string, Date>; pending?: Array<{ externalId: string; firstSeenAt: Date }> } = {},
  ) {
    const browser = createFixtureBrowser((url) => pages[url] ?? (url.includes("/jobs/view/") ? page(jobPage({ id: url.split("/").pop()!, title: "Customer Success Manager" })) : undefined));
    const config = linkedinAdapter.configSchema.parse(options.config ?? {});
    const pendingSince: Date[] = [];
    const context: CollectContext = {
      transport: createFixtureTransport({}),
      discovery: customerSuccessDiscoveryConfiguration,
      keepTitle: keepCs,
      env: {},
      now: () => now,
      maxPages: 5,
      maxDetailRequests: 25,
      lastChecked: async (ids) => new Map([...(options.checked ?? new Map<string, Date>())].filter(([id]) => ids.includes(id))),
      pendingListings: async (since) => {
        pendingSince.push(since);
        return options.pending ?? [];
      },
      browser: createBrowserSession(browser.driver, {
        minIntervalMs: 5_000,
        maxNavigations: linkedinAdapter.browser!.maxNavigations,
        authCookieNames: linkedinAdapter.browser!.authCookieNames!,
        detectFriction: linkedinAdapter.browser!.detectFriction!,
        parse: (html, url) => parsePage(html, url),
        sleep: async () => undefined,
      }),
    };
    return linkedinAdapter.collect(context, config).then((result) => ({ result, navigations: browser.navigations, pendingSince, config }));
  }

  it("discovers a bounded pool across search pages, filters titles, and fetches details within the detail budget", async () => {
    // 4 pages of 25 cards (half Customer Success), then a page past the cap.
    const pages: Record<string, FixturePage> = {};
    for (let p = 0; p < 5; p += 1) {
      const cards = Array.from({ length: 25 }, (_, i) => (i % 2 ? other(p * 25 + i) : cs(p * 25 + i)));
      pages[searchUrl(p * 25)] = page(searchPage(cards));
    }
    const { result, navigations, pendingSince } = await run(pages);
    const searches = navigations.filter((url) => url.includes("/jobs/search"));
    expect(searches).toEqual([0, 25, 50, 75].map((start) => searchUrl(start)));
    expect(result.fetched).toBe(100);
    expect(result.coverage).toEqual({ observedListingIds: expect.any(Array), complete: false });
    expect(result.coverage!.observedListingIds).toHaveLength(100);
    expect(result.discovered).toHaveLength(52);
    expect(result.discovered!.every((id) => id.startsWith("41"))).toBe(true);
    // 20 details by default: matches only, in discovery order.
    const details = navigations.filter((url) => url.includes("/jobs/view/"));
    expect(details).toEqual(result.discovered!.slice(0, 20).map(linkedInJobUrl));
    expect(result.listings).toHaveLength(20);
    expect(result.requests).toBe(24);
    expect(result.halted).toBeNull();
    expect(pendingSince).toEqual([new Date(now.getTime() - 30 * 86_400_000)]);
  });

  it("stops discovery at the configured discovery cap and page cap", async () => {
    const pages: Record<string, FixturePage> = {};
    for (let p = 0; p < 3; p += 1) pages[searchUrl(p * 25)] = page(searchPage(Array.from({ length: 25 }, (_, i) => cs(p * 25 + i))));
    const capped = await run(pages, { config: { maxDiscovered: "30", maxDetailsPerRun: "1" } });
    expect(capped.result.fetched).toBe(30);
    expect(capped.navigations.filter((url) => url.includes("/jobs/search"))).toHaveLength(2);
    const onePage = await run(pages, { config: { maxSearchPages: "1", maxDetailsPerRun: "1" } });
    expect(onePage.navigations.filter((url) => url.includes("/jobs/search"))).toHaveLength(1);
    expect(onePage.result.fetched).toBe(25);
  });

  it("pages by the number of results each page actually returned, and ends on a short, empty or repeated page", async () => {
    const searches = (navigations: string[]) => navigations.filter((url) => url.includes("/jobs/search"));
    const first = Array.from({ length: 10 }, (_, i) => cs(i));
    const second = Array.from({ length: 10 }, (_, i) => cs(10 + i));
    const short = Array.from({ length: 7 }, (_, i) => cs(20 + i));
    const shortEnd = await run(
      { [searchUrl(0)]: page(searchPage(first)), [searchUrl(10)]: page(searchPage(second)), [searchUrl(20)]: page(searchPage(short)) },
      { config: { maxDetailsPerRun: "1" } },
    );
    expect(searches(shortEnd.navigations)).toEqual([searchUrl(0), searchUrl(10), searchUrl(20)]);
    expect(shortEnd.result.fetched).toBe(27);
    const emptyEnd = await run({ [searchUrl(0)]: page(searchPage(first)), [searchUrl(10)]: page(noResultsPage()) }, { config: { maxDetailsPerRun: "1" } });
    expect(searches(emptyEnd.navigations)).toEqual([searchUrl(0), searchUrl(10)]);
    expect(emptyEnd.result).toMatchObject({ fetched: 10, halted: null });
    const repeated = await run({ [searchUrl(0)]: page(searchPage(first)), [searchUrl(10)]: page(searchPage(first)) }, { config: { maxDetailsPerRun: "1" } });
    expect(searches(repeated.navigations)).toEqual([searchUrl(0), searchUrl(10)]);
    expect(repeated.result.fetched).toBe(10);
  });

  it("fetches earlier runs' pending matches first, skips stored jobs, and refreshes only those last checked over 7 days ago", async () => {
    const day = 86_400_000;
    const cards = [cs(1), cs(2), cs(3), cs(4)];
    const pending = [
      { externalId: "4300000001", firstSeenAt: new Date(now.getTime() - 3 * day) },
      { externalId: cards[0]!.id, firstSeenAt: new Date(now.getTime() - 2 * day) },
    ];
    const checked = new Map([
      [cards[1]!.id, new Date(now.getTime() - 1 * day)],
      [cards[2]!.id, new Date(now.getTime() - 9 * day)],
    ]);
    const { navigations } = await run({ [searchUrl(0)]: page(searchPage(cards)) }, { pending, checked });
    expect(navigations.filter((url) => url.includes("/jobs/view/"))).toEqual(
      ["4300000001", cards[0]!.id, cards[3]!.id, cards[2]!.id].map(linkedInJobUrl),
    );
  });

  it("maps a job to a retrieved listing with the public job URL and only a stated application address", async () => {
    const card = cs(1);
    const { result } = await run({
      [searchUrl(0)]: page(searchPage([card])),
      [linkedInJobUrl(card.id)]: page(jobPage({ id: card.id, title: "Customer Success Manager", company: "Acme", remote: true })),
    });
    const [listing] = result.listings;
    expect(rawOpportunitySchema.parse(listing)).toEqual(listing);
    expect(listing).toMatchObject({
      source: "linkedin",
      sourceType: "PUBLIC_SEARCH",
      externalId: card.id,
      title: "Customer Success Manager",
      company: "Acme",
      sourceUrl: linkedInJobUrl(card.id),
      applicationUrl: null,
      retrieval: { retrievalType: "BROWSER_ASSISTED", sourceCategory: "JOB_BOARD" },
      sourceMetadata: { sourceName: "LinkedIn", attribution: "via LinkedIn", structured: { workplaceType: "REMOTE" }, structuredData: true },
    });
    expect(listing!.description).toContain("renewals");
    const normalized = await createRetrievedOpportunityNormalizer().normalize(listing!);
    expect(normalized.opportunity).toMatchObject({
      companyName: "Acme",
      canonicalUrl: linkedInJobUrl(card.id),
      applicationUrl: null,
      remoteStatus: "REMOTE",
      employmentType: "FULL_TIME",
      externalListingId: card.id,
    });
  });

  it("records an unavailable job page and halts after three unreadable pages in a row", async () => {
    const cards = [cs(1), cs(2), cs(3), cs(4), cs(5)];
    const pages: Record<string, FixturePage> = { [searchUrl(0)]: page(searchPage(cards)), [linkedInJobUrl(cards[0]!.id)]: page("<html><body>gone</body></html>", 404) };
    for (const card of cards.slice(1)) pages[linkedInJobUrl(card.id)] = page(unrecognizedPage());
    const { result, navigations } = await run(pages);
    expect(result.unavailable).toEqual([cards[0]!.id]);
    expect(result.halted).toMatchObject({ code: "CONTRACT_MISMATCH" });
    expect(navigations.filter((url) => url.includes("/jobs/view/"))).toHaveLength(4);
    expect(result.issues).toHaveLength(4);
  });

  it("fails the run when the first search page is blocked, and makes no further request", async () => {
    for (const blocked of [page("", 999), page("", 403), { status: 429, html: "" }, { status: 200, html: authwallPage(), finalUrl: "https://www.linkedin.com/authwall?trk=x" }]) {
      const outcome = await run({ [searchUrl(0)]: blocked as FixturePage }).catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(AdapterError);
      expect((outcome as AdapterError).code).toMatch(/ACCESS_DENIED|RATE_LIMITED/);
    }
    await expect(run({ [searchUrl(0)]: page(unrecognizedPage()) })).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });

  it("keeps what it found and stops when a later page is blocked", async () => {
    const pages: Record<string, FixturePage> = {
      [searchUrl(0)]: page(searchPage(Array.from({ length: 25 }, (_, i) => cs(i)))),
      [searchUrl(25)]: page("", 999),
    };
    const discoveryStop = await run(pages);
    expect(discoveryStop.result.halted).toMatchObject({ code: "ACCESS_DENIED" });
    expect(discoveryStop.result.discovered).toHaveLength(25);
    expect(discoveryStop.navigations).toEqual([searchUrl(0), searchUrl(25)]);

    const cards = [cs(1), cs(2), cs(3)];
    const detailStop = await run({ [searchUrl(0)]: page(searchPage(cards)), [linkedInJobUrl(cards[1]!.id)]: { status: 429, html: "", retryAfterSeconds: 3600 } });
    expect(detailStop.result.halted).toMatchObject({ code: "RATE_LIMITED", details: { retryAfterSeconds: 3600 } });
    expect(detailStop.result.listings.map((listing) => listing.externalId)).toEqual([cards[0]!.id]);
    expect(detailStop.navigations.filter((url) => url.includes("/jobs/view/"))).toEqual([cards[0]!.id, cards[1]!.id].map(linkedInJobUrl));
  });

  it("never needs more navigations than the session allows", () => {
    expect(linkedinAdapter.browser!.maxNavigations).toBeGreaterThanOrEqual(linkedInHardLimits.searchPages + linkedInHardLimits.detailsPerRun);
  });

  it("refuses to run without a browser session", async () => {
    await expect(
      linkedinAdapter.collect(
        { transport: createFixtureTransport({}), discovery: customerSuccessDiscoveryConfiguration, keepTitle: keepCs, env: {}, now: () => now, maxPages: 5, maxDetailRequests: 25 },
        defaults,
      ),
    ).rejects.toMatchObject({ code: "CONFIG" });
  });
});
