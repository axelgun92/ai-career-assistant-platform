// Mode B background-tab detail reading (P2) in the extension's service
// worker, with a fake Chrome that serves synthetic Welcome to the Jungle job
// pages and runs the extension's real page check and the unchanged
// single-job reader over them (jsdom). Offline: no network, browser or
// database. Covers the full 25-job batch, the pacing, background tabs closed
// by the extension only, re-reads on the same document, access restrictions,
// identity mismatches, interruptions, the user's Stop, a removed permission
// and a service-worker restart.
import { describe, expect, it } from "vitest";
import { createTabAcquisition, tabRunLine, tabUrlAllowed, type TabRunState } from "../../apps/extension/src/tab-acquisition";
import { pageCaptureSiteByKey } from "@ai-career/core";
import { csmDescription, fakeTabEnvironment, runProbe, wttjJobPage, wttjRunSettings, type ServedPage } from "../support/wttj-tab-pages";

const urlOf = (index: number) => `https://www.welcometothejungle.com/en/companies/company-${index}/jobs/customer-success-manager_chicago_job${index}`;
const itemIdOf = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const itemsOf = (count: number) => Array.from({ length: count }, (_, index) => ({ itemId: itemIdOf(index + 1), url: urlOf(index + 1) }));
const jobPage = (url: string): ServedPage => {
  const index = Number(/job(\d+)$/.exec(url)?.[1] ?? 0);
  return { status: 200, html: wttjJobPage({ title: `Customer Success Manager ${index}`, company: `Company ${index}`, city: "Chicago", descriptionHtml: csmDescription("$90,000-$110,000") }) };
};

function setup(serve: (url: string) => ServedPage = jobPage, options: Parameters<typeof fakeTabEnvironment>[0] extends infer T ? Partial<T> : never = {}) {
  const fake = fakeTabEnvironment({ serve, ...options });
  const acquisition = createTabAcquisition(fake.environment);
  const start = async (count: number, items = itemsOf(count)) => {
    fake.registerItems(items);
    await acquisition.enqueue({ ...wttjRunSettings, items });
    await acquisition.resume();
    return fake.stored()!;
  };
  return { ...fake, acquisition, start };
}

describe("background-tab detail reading (P2)", () => {
  it("reads a full batch of 25 jobs automatically, one background tab at a time, at least 12 s apart, closing only its own tabs", async () => {
    const run = setup();
    const state = await run.start(25);
    expect(state.finished?.reason).toBe("COMPLETED");
    expect(state.counts).toEqual({ added: 25, notRead: 0, skipped: 0 });
    expect(run.log.starts).toHaveLength(25);
    expect(run.log.opened.map((tab) => tab.url)).toEqual(itemsOf(25).map((item) => item.url));
    // Sequential: each tab is closed before the next opens; pacing between navigation starts.
    for (let index = 1; index < run.log.opened.length; index += 1) {
      expect(run.log.opened[index]!.at - run.log.opened[index - 1]!.at).toBeGreaterThanOrEqual(12_000);
    }
    expect(run.log.closed).toEqual(run.log.opened.map((tab) => tab.tabId));
    // Each job's own page, read by the unchanged single-job reader; no card text.
    expect(run.log.details.map((detail) => detail.pageUrl)).toEqual(itemsOf(25).map((item) => item.url));
    expect(run.log.details[0]).toMatchObject({ title: "Customer Success Manager 1" });
    expect(run.log.details[24]!.remainingItemIds).toEqual([]);
    expect(run.log.results).toEqual([]);
    expect(run.log.keepAlive).toEqual([true, false]);
  });

  it("re-reads the same document at +2 s, +5 s and +10 s while no posting is found, without reloading", async () => {
    const run = setup((url) => ({ ...jobPage(url), postingAfterReads: 2 }));
    await run.start(1);
    expect(run.log.opened).toHaveLength(1);
    const reads = run.log.reads.map((read) => read.at - run.log.reads[0]!.at);
    expect(reads).toEqual([0, 2_000, 5_000]);
    // A posting found at the second re-read: no further read.
    expect(run.log.details).toHaveLength(1);
  });

  it("reports an unreadable page after the re-reads and continues with the next job", async () => {
    const run = setup((url) => (url === urlOf(1) ? { status: 200, html: "<html><body><main><p>Nothing here.</p></main></body></html>" } : jobPage(url)));
    const state = await run.start(2);
    expect(run.log.results).toEqual([{ itemId: itemIdOf(1), result: "UNREADABLE", signal: "NO_POSTING", finalUrl: urlOf(1), remainingItemIds: [itemIdOf(2)] }]);
    expect(run.log.reads.filter((read) => read.tabId === run.log.opened[0]!.tabId)).toHaveLength(4);
    expect(run.log.details.map((detail) => detail.pageUrl)).toEqual([urlOf(2)]);
    expect(state.finished?.reason).toBe("COMPLETED");
  });

  it("reports 404 and 410 pages as unavailable and continues", async () => {
    const run = setup((url) => (url === urlOf(1) ? { status: 404, html: "<h1>Not found</h1>" } : url === urlOf(2) ? { status: 410, html: "<h1>Gone</h1>" } : jobPage(url)));
    await run.start(3);
    expect(run.log.results.map((result) => [result.result, result.signal])).toEqual([
      ["UNAVAILABLE", "HTTP_404"],
      ["UNAVAILABLE", "HTTP_410"],
    ]);
    expect(run.log.details).toHaveLength(1);
  });

  for (const [name, page, signal] of [
    ["HTTP 403", { status: 403, html: "<h1>Forbidden</h1>" }, "HTTP_403"],
    ["HTTP 401", { status: 401, html: "<h1>Unauthorized</h1>" }, "HTTP_401"],
    ["HTTP 429", { status: 429, html: "<h1>Too many requests</h1>" }, "HTTP_429"],
    ["HTTP 999", { status: 999, html: "<h1>Request denied</h1>" }, "HTTP_999"],
    ["HTTP 503", { status: 503, html: "<h1>Service unavailable</h1>" }, "HTTP_5XX"],
    ["a sign-in redirect", { status: 200, finalUrl: "https://www.welcometothejungle.com/en/signin?redirect=jobs", html: "<form><input type=email></form>" }, "LOGIN_REDIRECT"],
    ["a Cloudflare challenge", { status: 200, html: "<html><head><title>Just a moment...</title></head><body><div id=\"challenge-running\"></div></body></html>" }, "CHALLENGE"],
    ["a CAPTCHA in place of the posting", { status: 200, html: '<html><body><main><div class="h-captcha"></div></main></body></html>' }, "CAPTCHA"],
    ["a login wall in place of the posting", { status: 200, html: '<html><body><main><h1>Log in to see this job</h1><form><input type="email"><input type="password"></form></main></body></html>' }, "LOGIN_WALL"],
    ["a redirect off the permitted hosts", { status: 200, hiddenUrl: true, html: "<h1>Sign in</h1>" }, "LEFT_SITE"],
  ] as const) {
    it(`stops the whole batch on ${name}, opening nothing more`, async () => {
      const run = setup((url) => (url === urlOf(2) ? page : jobPage(url)));
      const state = await run.start(5);
      expect(state.finished?.reason).toBe("BLOCKED");
      expect(run.log.opened.map((tab) => tab.url)).toEqual([urlOf(1), urlOf(2)]);
      expect(run.log.starts).toEqual([itemIdOf(1), itemIdOf(2)]);
      expect(run.log.results).toEqual([{ itemId: itemIdOf(2), result: "BLOCKED", signal, finalUrl: expect.anything(), remainingItemIds: [itemIdOf(3), itemIdOf(4), itemIdOf(5)] }].map((expected) => (signal === "LEFT_SITE" ? { ...expected, finalUrl: null } : expected)));
      expect(run.log.closed).toEqual(run.log.opened.map((tab) => tab.tabId));
      expect(tabRunLine(state)).toMatch(/restricted access, so reading stopped; the site is not contacted for at least a day/);
    });
  }

  it("reads a posting even when the page also carries a sign-in form or CAPTCHA widget elsewhere", async () => {
    const run = setup((url) => ({ ...jobPage(url), html: jobPage(url).html.replace("</footer>", '<form hidden><input type="password"></form><div class="h-captcha"></div></footer>') }));
    const state = await run.start(1);
    expect(state.finished?.reason).toBe("COMPLETED");
    expect(run.log.details).toHaveLength(1);
  });

  it("stops the batch when the server finds the page is not the staged job", async () => {
    const run = setup(jobPage, {
      api: {
        pageCaptureTabDetails: async (itemId) => ({
          ok: true,
          status: 200,
          body: { itemId, outcome: "IDENTITY_MISMATCH", status: "AWAITING_DETAILS", opportunityId: null, stopBatch: true, stoppedUntil: null },
        }),
      },
    });
    const state = await run.start(3);
    expect(state.finished?.reason).toBe("IDENTITY_MISMATCH");
    expect(run.log.opened).toHaveLength(1);
  });

  it("reports a job whose tab the user closed as interrupted, never reopens it, and continues", async () => {
    const run = setup();
    run.hooks.afterOpen = (tabId) => {
      if (run.log.opened.length === 1) run.userCloses(tabId);
    };
    const state = await run.start(2);
    expect(run.log.results).toEqual([{ itemId: itemIdOf(1), result: "INTERRUPTED", signal: "TAB_CLOSED", finalUrl: null, remainingItemIds: [itemIdOf(2)] }]);
    expect(run.log.opened.map((tab) => tab.url)).toEqual([urlOf(1), urlOf(2)]);
    expect(state.finished?.reason).toBe("COMPLETED");
  });

  it("treats a page that never answers within the load timeout as unreadable", async () => {
    const run = setup((url) => (url === urlOf(1) ? { status: null, hangs: true, html: "" } : jobPage(url)));
    await run.start(2);
    expect(run.log.results[0]).toMatchObject({ result: "UNREADABLE", signal: "LOAD_FAILED" });
    expect(run.log.opened[1]!.at - run.log.opened[0]!.at).toBeGreaterThanOrEqual(30_000);
  });

  it("does not open a job the server says is no longer to be read", async () => {
    const run = setup(jobPage, {
      api: {
        pageCaptureTabStart: async (itemId) =>
          itemId === itemIdOf(1)
            ? { ok: true, status: 200, body: { proceed: false, itemId, status: "DISMISSED", reason: null, stoppedUntil: null } }
            : { ok: true, status: 200, body: { proceed: true, itemId, url: urlOf(2) } },
      },
    });
    const state = await run.start(2);
    expect(run.log.opened.map((tab) => tab.url)).toEqual([urlOf(2)]);
    expect(state.counts).toEqual({ added: 1, notRead: 0, skipped: 1 });
  });

  it("stops when the server reports the site stopped, without opening a tab", async () => {
    const run = setup(jobPage, {
      api: { pageCaptureTabStart: async (itemId) => ({ ok: true, status: 200, body: { proceed: false, itemId, status: "AWAITING_DETAILS", reason: "ACCESS_STOPPED", stoppedUntil: "2026-11-05T12:00:00.000Z" } }) },
    });
    const state = await run.start(3);
    expect(state.finished?.reason).toBe("BLOCKED");
    expect(run.log.opened).toEqual([]);
  });

  it("honours the user's Stop: the job being read finishes, nothing more opens, and the rest is reported stopped", async () => {
    const run = setup();
    run.hooks.afterOpen = () => {
      if (run.log.opened.length === 2) void run.acquisition.stop();
    };
    const state = await run.start(5);
    expect(state.finished?.reason).toBe("USER_STOPPED");
    expect(run.log.opened).toHaveLength(2);
    expect(run.log.details).toHaveLength(2);
    expect(run.log.stops).toEqual([{ site: "welcome-to-the-jungle", itemIds: [itemIdOf(3), itemIdOf(4), itemIdOf(5)], reason: "USER_STOPPED" }]);
  });

  it("does not open the next job when Stop arrives during the wait between jobs", async () => {
    const run = setup();
    run.hooks.duringSleep = (ms) => {
      if (ms > 5_000 && run.log.opened.length === 1) void run.acquisition.stop();
    };
    await run.start(3);
    expect(run.log.opened).toHaveLength(1);
    expect(run.log.stops[0]).toMatchObject({ itemIds: [itemIdOf(2), itemIdOf(3)], reason: "USER_STOPPED" });
  });

  it("stops when the site's permission is removed mid-run", async () => {
    let granted = true;
    const run = setup(jobPage, { permission: () => granted });
    run.hooks.afterOpen = () => {
      granted = false;
    };
    const state = await run.start(3);
    expect(state.finished?.reason).toBe("PERMISSION_MISSING");
    expect(run.log.opened).toHaveLength(1);
    expect(run.log.stops).toEqual([{ site: "welcome-to-the-jungle", itemIds: [itemIdOf(2), itemIdOf(3)], reason: "PERMISSION_MISSING" }]);
  });

  it("stops when AI Job Assistant cannot be reached, leaving the jobs for the server to mark interrupted", async () => {
    const run = setup(jobPage, { api: { pageCaptureTabStart: async () => ({ ok: false, status: 0, code: "UNREACHABLE", error: "down" }) } });
    const state = await run.start(3);
    expect(state.finished?.reason).toBe("UNREACHABLE");
    expect(run.log.opened).toEqual([]);
  });

  it("after a service-worker restart, reads the still-open tab once (no reload) and continues", async () => {
    const run = setup();
    const tabId = run.openTab(urlOf(1), jobPage(urlOf(1)));
    const saved: TabRunState = {
      runId: "r1",
      ...wttjRunSettings,
      queue: [{ itemId: itemIdOf(2), url: urlOf(2) }],
      current: { itemId: itemIdOf(1), url: urlOf(1), tabId },
      lastNavigationAt: run.now() - 3_000,
      stopRequested: false,
      total: 2,
      counts: { added: 0, notRead: 0, skipped: 0 },
      finished: null,
    };
    run.setStored(saved);
    run.registerItems(itemsOf(2));
    const restarted = createTabAcquisition(run.environment);
    await restarted.resume();
    expect(run.log.details.map((detail) => detail.pageUrl)).toEqual([urlOf(1), urlOf(2)]);
    expect(run.log.opened.map((tab) => tab.url)).toEqual([urlOf(2)]);
    expect(run.log.closed[0]).toBe(tabId);
    expect(run.log.opened[0]!.at - saved.lastNavigationAt!).toBeGreaterThanOrEqual(12_000);
  });

  it("after a service-worker restart, reports a job whose tab is gone as interrupted and never reopens it", async () => {
    const run = setup();
    run.setStored({
      runId: "r1",
      ...wttjRunSettings,
      queue: [],
      current: { itemId: itemIdOf(1), url: urlOf(1), tabId: 999 },
      lastNavigationAt: run.now(),
      stopRequested: false,
      total: 1,
      counts: { added: 0, notRead: 0, skipped: 0 },
      finished: null,
    });
    await createTabAcquisition(run.environment).resume();
    expect(run.log.results).toEqual([{ itemId: itemIdOf(1), result: "INTERRUPTED", signal: "TAB_CLOSED", finalUrl: null, remainingItemIds: [] }]);
    expect(run.log.opened).toEqual([]);
    expect(run.stored()?.finished?.reason).toBe("COMPLETED");
  });

  it("adds a second save's jobs to the run in progress without repeating a job", async () => {
    const run = setup();
    const first = itemsOf(3);
    run.registerItems(itemsOf(5));
    run.hooks.afterOpen = () => {
      if (run.log.opened.length === 1) void run.acquisition.enqueue({ ...wttjRunSettings, items: itemsOf(5).slice(2) });
    };
    await run.acquisition.enqueue({ ...wttjRunSettings, items: first });
    await run.acquisition.resume();
    await run.acquisition.resume();
    expect(run.log.opened.map((tab) => tab.url)).toEqual(itemsOf(5).map((item) => item.url));
    expect(run.stored()?.total).toBe(5);
  });

  it("never opens a job outside the site's permitted hosts", async () => {
    const run = setup();
    await run.start(1, [{ itemId: itemIdOf(1), url: "https://app.otta.com/jobs/abc123" }]);
    expect(run.log.opened).toEqual([]);
    expect(tabUrlAllowed(wttjRunSettings.hostPermissions, "https://app.welcometothejungle.com/jobs/AbCdEf34")).toBe(true);
    expect(tabUrlAllowed(wttjRunSettings.hostPermissions, "http://www.welcometothejungle.com/en/jobs")).toBe(false);
    expect(tabUrlAllowed(wttjRunSettings.hostPermissions, "https://www.welcometothejungle.com.evil.example/x")).toBe(false);
  });

  it("uses the registry's pacing, load timeout and re-read delays for Welcome to the Jungle", () => {
    const site = pageCaptureSiteByKey("welcome-to-the-jungle")!;
    expect({ minIntervalMs: site.detail.minIntervalMs, ...site.tabAcquisition }).toEqual({
      minIntervalMs: wttjRunSettings.minIntervalMs,
      hostPermissions: wttjRunSettings.hostPermissions,
      loadTimeoutMs: wttjRunSettings.loadTimeoutMs,
      rereadDelaysMs: wttjRunSettings.rereadDelaysMs,
    });
  });
});

describe("the job-page check", () => {
  const job = wttjJobPage({ title: "Customer Success Manager", company: "Box", city: "Chicago", descriptionHtml: csmDescription(null) });
  const url = "https://www.welcometothejungle.com/en/companies/box/jobs/senior-customer-success-manager-central_chicago_cvrvkbqh";

  it("finds nothing on a normal job page, which links to sign-in in its header", () => {
    expect(runProbe(job, url, 200)).toEqual({ href: url, status: 200, hard: null, soft: null });
  });

  it("reports the navigation status, sign-in redirects, challenges and stand-in forms", () => {
    expect(runProbe(job, url, 403).status).toBe(403);
    expect(runProbe(job, url, null).status).toBeNull();
    expect(runProbe("<h1>Log in</h1>", "https://www.welcometothejungle.com/en/signin", 200).hard).toBe("LOGIN_REDIRECT");
    expect(runProbe("<title>Attention Required! | Cloudflare</title>", url, 200).hard).toBe("CHALLENGE");
    expect(runProbe('<iframe src="https://challenges.cloudflare.com/turnstile"></iframe>', url, 200).hard).toBe("CHALLENGE");
    expect(runProbe('<iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>', url, 200).hard).toBe("CHALLENGE");
    expect(runProbe('<div class="h-captcha"></div>', url, 200).soft).toBe("CAPTCHA");
    expect(runProbe('<input type="password">', url, 200).soft).toBe("LOGIN_WALL");
    expect(runProbe('<input type="password" style="display:none">', url, 200).soft).toBeNull();
  });
});

describe("the popup's run line", () => {
  it("states progress, Stop and each ending in plain words", () => {
    const base: TabRunState = {
      runId: "r",
      ...wttjRunSettings,
      queue: [],
      current: null,
      lastNavigationAt: null,
      stopRequested: false,
      total: 4,
      counts: { added: 2, notRead: 1, skipped: 0 },
      finished: null,
    };
    expect(tabRunLine(null)).toBeNull();
    expect(tabRunLine(base)).toBe("Reading job details from Welcome to the Jungle / Otta in background tabs, one at a time: 3 of 4 done (2 added, 1 not read).");
    expect(tabRunLine({ ...base, stopRequested: true })).toMatch(/^Stopping after the current job/);
    expect(tabRunLine({ ...base, finished: { reason: "COMPLETED", at: 0 } })).toBe("Finished reading job details (2 added, 1 not read).");
    expect(tabRunLine({ ...base, finished: { reason: "IDENTITY_MISMATCH", at: 0 } })).toMatch(/was not the saved job/);
    expect(tabRunLine({ ...base, finished: { reason: "PERMISSION_MISSING", at: 0 } })).toMatch(/permission/);
  });
});
