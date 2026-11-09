// P2028 fix F4 (approved November 9, 2026): every page window the Mode B
// worker parses is closed once it has been read — the rendered page, the page
// as LinkedIn sent it, a page that is no longer available, a sign-in wall,
// and a page whose reading throws — and closing them changes nothing that is
// saved. Offline: jsdom's JSDOM class is wrapped to record each window it
// creates and whether it was closed; the repository, browser and ingestion are
// in-memory fakes; the pages are real reduced LinkedIn pages (November 7) and
// the TENEX guest page with its employer apply code only in the page as sent.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { PageCaptureItemRecord } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createPageCaptureAcquisition } from "../../apps/web/src/server/page-capture-acquisition";
import fixture from "../fixtures/real-captures/linkedin-nov7-job-pages.json";
import { linkedInGuestJobPage } from "../support/linkedin-guest-pages";

const tracked = vi.hoisted(() => ({
  windows: [] as Array<{ html: string; closed: boolean }>,
  // When false, window.close() is recorded but does nothing (the behaviour
  // before F4), so the two runs can be compared.
  closeForReal: true,
}));

vi.mock("jsdom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jsdom")>();
  class TrackedJSDOM extends actual.JSDOM {
    constructor(html?: string, options?: import("jsdom").ConstructorOptions) {
      super(html, options);
      const entry = { html: html ?? "", closed: false };
      tracked.windows.push(entry);
      const window = this.window as unknown as { close(): void; eval(source: string): unknown };
      const close = window.close.bind(window);
      window.close = () => {
        entry.closed = true;
        if (tracked.closeForReal) close();
      };
      // A page marked to fail: the reader throws while reading it.
      if (entry.html.includes("EXTRACTION-FAILS")) {
        window.eval = () => {
          throw new Error("the reader failed on this page");
        };
      }
    }
  }
  return { ...actual, JSDOM: TrackedJSDOM };
});

beforeEach(() => {
  tracked.windows.length = 0;
  tracked.closeForReal = true;
});

const now = new Date("2026-11-09T15:00:00.000Z");
const pages = (fixture as { pages: Record<string, { listingId: string; sourceUrl: string; html: string }> }).pages;
const tenex = "4372638963";
const employerApply = "https://jobs.tenex.ai/careers/42?source=linkedin";
const applyCode = `<code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/${tenex}?url=${encodeURIComponent(employerApply)}&urlHash=Ab1c"--></code>`;
const tenexPage = (withApplyCode: boolean, marker = "") =>
  linkedInGuestJobPage({
    id: tenex,
    title: "Customer Success Manager",
    company: "TENEX.AI",
    location: "United States",
    descriptionHtml: `<p>Customer Success Manager for a security operations platform.${marker}</p><p>Own onboarding, adoption and renewals for enterprise customers.</p><p>You will run business reviews, lead adoption plans with each customer's stakeholders, partner with Sales on expansion, and turn product feedback into clear requests for the product team.</p>`,
  }).replace("</main>", `${withApplyCode ? applyCode : ""}</main>`);

const item = (id: string): PageCaptureItemRecord => ({
  id,
  site: "linkedin",
  host: "www.linkedin.com",
  externalId: `linkedin:${id}`,
  sourceUrl: `https://www.linkedin.com/jobs/view/${id}`,
  siteJobId: id,
  title: `Customer Success Manager ${id}`,
  company: null,
  location: null,
  postedText: null,
  resultsPageUrl: "https://www.linkedin.com/jobs/search",
  firstSeenAt: now,
  lastSeenAt: now,
  sightings: 1,
  lastBatchId: "33333333-3333-4333-8333-333333333333",
  pairingId: "p",
  status: "QUEUED",
  attempts: 0,
  lastAttemptAt: null,
  nextAttemptAt: null,
  lastReason: null,
  opportunityId: null,
  handoffOutcome: null,
  handedOffAt: null,
  createdAt: now,
  updatedAt: now,
});

type Served = { status: number; html: string; servedHtml?: string };

async function runPass(batch: Array<[string, Served]>) {
  const served = new Map(batch);
  const rows = new Map(batch.map(([id]) => [id, item(id)]));
  const due = (row: PageCaptureItemRecord) => row.status === "QUEUED" && (!row.nextAttemptAt || row.nextAttemptAt <= now);
  const raws: Array<Record<string, unknown>> = [];
  const repository = {
    recoverInterrupted: async () => 0,
    sitesWithQueued: async () => ([...rows.values()].some(due) ? ["linkedin"] : []),
    siteStoppedUntil: async () => null,
    claimQueued: async () => {
      const claimed = [...rows.values()].filter(due);
      for (const row of claimed) row.status = "ACQUIRING";
      return claimed.map((row) => ({ ...row }));
    },
    markIngested: async (id: string, opportunityId: string) => {
      Object.assign(rows.get(id)!, { status: "INGESTED", opportunityId, lastReason: null });
    },
    markFailed: async (id: string, change: { status: PageCaptureItemRecord["status"]; reason: string; nextAttemptAt: Date | null; countAttempt: boolean }) => {
      const row = rows.get(id)!;
      Object.assign(row, { status: change.status, lastReason: change.reason, nextAttemptAt: change.nextAttemptAt, attempts: row.attempts + (change.countAttempt ? 1 : 0) });
    },
    deferSite: async () => undefined,
    markHandedOff: async () => undefined,
    requeueUncounted: async (id: string, reason: string) => {
      Object.assign(rows.get(id)!, { status: "QUEUED", nextAttemptAt: null, lastReason: reason });
      return true;
    },
    releaseClaimed: async (ids: string[]) => {
      let count = 0;
      for (const id of ids) if (rows.get(id)?.status === "ACQUIRING") (rows.get(id)!.status = "QUEUED"), (count += 1);
      return count;
    },
    finalizeProvisionalFailure: async () => false,
  };
  const ingest = vi.fn(async (raw: Record<string, unknown>) => {
    raws.push(raw);
    return { outcome: "CREATED" as const, opportunityId: `00000000-0000-4000-8000-${String(raws.length).padStart(12, "0")}`, sourceRecordId: "s", decision: "NO_MATCH" as const };
  });
  const driver: BrowserDriver = {
    async navigate(url) {
      const page = served.get(url.split("/").pop()!)!;
      return { status: page.status, finalUrl: url, html: page.html, cookieNames: [], ...(page.servedHtml ? { servedHtml: page.servedHtml } : {}) };
    },
    close: async () => undefined,
  };
  const acquisition = createPageCaptureAcquisition({
    repository,
    ingestion: { ingest } as never,
    handoff: { alreadyHandled: async () => false, request: async () => "NO_ACTIVE_PROFILE" },
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => ["linkedin"],
    browser: { launch: async () => driver },
    probeCapture: async () => undefined,
    now: () => now,
    sleep: async () => undefined,
    log: { info: () => undefined, warn: () => undefined },
  });
  const result = await acquisition.runOnce();
  return { result, rows, raws };
}

const realPages = (["tenex", "nearmap", "thomson-reuters"] as const).map((name) => [pages[name]!.listingId, { status: 200, html: pages[name]!.html }] as [string, Served]);
// Job ids distinct from the real pages' (the TENEX guest page uses its own).
const guestTenex: [string, Served] = ["4400000001", { status: 200, html: tenexPage(false).replaceAll(tenex, "4400000001"), servedHtml: tenexPage(true).replaceAll(tenex, "4400000001") }];
const failing: [string, Served] = ["4400000002", { status: 200, html: tenexPage(false, " EXTRACTION-FAILS").replaceAll(tenex, "4400000002") }];
const gone: [string, Served] = ["4400000003", { status: 404, html: "<html><body>Not found</body></html>" }];
const authwall: [string, Served] = ["4400000004", { status: 200, html: '<html><head><title>Sign Up | LinkedIn</title></head><body><main><form class="join-form"><input name="email"></form></main></body></html>' }];

describe("every page window the worker parses is closed (P2028 fix F4)", () => {
  it("closes the rendered pages, the page as sent, an unavailable page and a sign-in wall", async () => {
    const { result, raws } = await runPass([...realPages, guestTenex, gone, authwall]);
    expect(result).toMatchObject({ ingested: 4, unavailable: 1, stopped: "ACCESS_STOPPED" });
    // The served TENEX page was parsed as its own window (its apply link came from it).
    expect(raws.find((raw) => String(raw.externalId).endsWith("4400000001"))!.applicationUrl).toBe(employerApply.replaceAll(tenex, "4400000001"));
    // 3 real pages + the TENEX page rendered and as sent + the 404 page + the wall.
    expect(tracked.windows).toHaveLength(7);
    expect(tracked.windows.filter((window) => !window.closed)).toEqual([]);
  });

  it("closes a page whose reading throws (the error still ends the pass, as before F4)", async () => {
    await expect(runPass([failing, realPages[1]!])).rejects.toThrow("the reader failed on this page");
    expect(tracked.windows).toHaveLength(1);
    expect(tracked.windows[0]!.html).toContain("EXTRACTION-FAILS");
    expect(tracked.windows[0]!.closed).toBe(true);
  });

  it("saves exactly what was saved before windows were closed", async () => {
    const batch = [...realPages, guestTenex];
    tracked.closeForReal = false;
    const before = await runPass(batch);
    tracked.closeForReal = true;
    const after = await runPass(batch);
    expect(after.raws).toHaveLength(4);
    expect(after.raws).toEqual(before.raws);
  });
});
