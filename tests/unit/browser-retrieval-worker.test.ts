// Feature 14: how the retrieval worker runs a browser-assisted adapter: a
// fresh browser per run, closed whatever happens; the adapter's interval,
// page budget and friction checks on the session; stops reaching Feature 12
// as failures; and the discovered pool reaching the listing ledger. Fakes
// and synthetic pages only.
import { describe, expect, it, vi } from "vitest";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { RetrievalRunRecord, RetrievalSourceRecord } from "@ai-career/database";
import { createAdapterRegistry, createFixtureTransport, linkedinAdapter, linkedInJobUrl, linkedInKeywords, linkedInSearchUrl } from "@ai-career/discovery";
import { createRetrievalWorker, type RetrievalRunStore } from "../../apps/web/src/server/retrieval-worker";
import { authwallPage, createFixtureBrowser, jobPage, noResultsPage, parsePage, searchPage, type FixturePage } from "../support/linkedin-fixtures";

const sourceId = "5b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e";
const runId = "7c1d4e2f-8b3a-4d66-ae8f-2a3b4c5d6e7f";
const now = new Date("2026-10-19T09:00:00.000Z");
const verified = { ...linkedinAdapter, verified: true };
const env = { RETRIEVAL_BROWSER_EXECUTABLE: "/opt/fixture/chromium" };
const config = linkedinAdapter.configSchema.parse({ maxDetailsPerRun: 2 });
const searchAt = (start: number) => linkedInSearchUrl(config, linkedInKeywords(config, customerSuccessDiscoveryConfiguration.searchQueries), start);
const searchUrl = searchAt(0);

const source: RetrievalSourceRecord = {
  id: sourceId,
  adapterKey: "linkedin",
  name: "LinkedIn",
  domain: "customer-success",
  retrievalType: "BROWSER_ASSISTED",
  sourceCategory: "JOB_BOARD",
  enabled: true,
  config: { maxDetailsPerRun: 2 },
  scheduleMinutes: 1440,
  lastRunAt: null,
  nextEligibleAt: null,
  trackingScopeKey: "scope-1",
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};

const run: RetrievalRunRecord = {
  id: runId,
  retrievalSourceId: sourceId,
  trigger: "MANUAL",
  status: "RUNNING",
  leaseExpiresAt: null,
  startedAt: now,
  finishedAt: null,
  counts: null,
  errorCode: null,
  errorMessage: null,
  retryAfterUntil: null,
  listingCoverageComplete: null,
  createdAt: now,
};

function setup(options: { pages?: Record<string, FixturePage>; browser?: boolean; env?: Record<string, string>; launchFails?: boolean } = {}) {
  const finished: Array<Parameters<RetrievalRunStore["finishRun"]>[1]> = [];
  const observations: Array<Parameters<RetrievalRunStore["recordListingObservations"]>[0]> = [];
  const store: RetrievalRunStore = {
    enqueueDueRuns: vi.fn(async () => 0),
    claimNextRun: vi.fn(async () => ({ run, source })),
    finishRun: vi.fn(async (_id, input) => (finished.push(input), { ...run, status: input.status })),
    failInterruptedRuns: vi.fn(async () => 0),
    recordListingObservations: vi.fn(async (input) => (observations.push(input), { applied: true, observed: 0, missing: 0, removed: 0, reappeared: 0 })),
  };
  const fixture = createFixtureBrowser(options.pages ?? {});
  const launches = { count: 0 };
  const waits: number[] = [];
  const pendingCalls: Array<[string, string, Date]> = [];
  const worker = createRetrievalWorker({
    store,
    ingestion: { ingest: async (raw) => ({ outcome: "CREATED", opportunityId: `o-${raw.externalId}`, sourceRecordId: "s", decision: "NO_MATCH" }) },
    registry: createAdapterRegistry([verified]),
    transport: () => createFixtureTransport({}),
    discovery: customerSuccessDiscoveryConfiguration,
    env: () => options.env ?? env,
    now: () => now,
    log: { info: vi.fn(), warn: vi.fn() },
    pendingListings: async (id, scope, since) => (pendingCalls.push([id, scope, since]), [{ externalId: "4300000009", firstSeenAt: new Date(now.getTime() - 86_400_000) }]),
    ...(options.browser === false
      ? {}
      : {
          browser: {
            launch: async () => {
              launches.count += 1;
              if (options.launchFails) throw new Error("Executable doesn't exist");
              return fixture.driver;
            },
            parse: (html: string, url: string) => parsePage(html, url),
            sleep: async (ms: number) => void waits.push(ms),
          },
        }),
  });
  return { worker, finished, observations, fixture, launches, waits, pendingCalls };
}

const searchWith = (ids: string[]) => ({ status: 200, html: searchPage(ids.map((id) => ({ id, title: "Customer Success Manager" }))) });

describe("browser-assisted runs in the retrieval worker", () => {
  it("cannot run without a configured browser or its executable", async () => {
    const noBrowser = setup({ browser: false });
    expect(await noBrowser.worker.runOnce()).toMatchObject({ status: "FAILED", errorCode: "ADAPTER_UNAVAILABLE" });
    const noExecutable = setup({ env: {} });
    expect(await noExecutable.worker.runOnce()).toMatchObject({ status: "FAILED", errorCode: "ADAPTER_UNAVAILABLE" });
    expect(noExecutable.launches.count).toBe(0);
  });

  it("treats a browser that will not start as our failure, not the source's", async () => {
    const { worker, launches } = setup({ launchFails: true });
    expect(await worker.runOnce()).toMatchObject({ status: "FAILED", errorCode: "INTERNAL" });
    expect(launches.count).toBe(1);
  });

  it("launches one fresh browser per run, paces it at the adapter's interval, closes it, and records the discovered pool", async () => {
    const ids = ["4100000001", "4100000002", "4100000003"];
    const { worker, fixture, launches, waits, observations, pendingCalls } = setup({
      pages: {
        [searchUrl]: searchWith(ids),
        [searchAt(3)]: { status: 200, html: noResultsPage() },
        [linkedInJobUrl("4300000009")]: { status: 404, html: "<html><body>gone</body></html>" },
        [linkedInJobUrl(ids[0]!)]: { status: 200, html: jobPage({ id: ids[0]!, title: "Customer Success Manager" }) },
      },
    });
    const outcome = await worker.runOnce();
    expect(outcome).toMatchObject({ status: "PARTIAL", errorCode: "LISTING_FAILURES" });
    expect(launches.count).toBe(1);
    expect(fixture.state.closed).toBe(true);
    // Search, the pending job (gone), then one new match: the budget of 2.
    expect(fixture.navigations).toEqual([searchUrl, searchAt(3), linkedInJobUrl("4300000009"), linkedInJobUrl(ids[0]!)]);
    // At least 5 seconds between page loads (measured on the real clock).
    expect(waits).toHaveLength(3);
    for (const wait of waits) {
      expect(wait).toBeGreaterThan(4_000);
      expect(wait).toBeLessThanOrEqual(5_000);
    }
    expect(pendingCalls).toEqual([[sourceId, "scope-1", new Date(now.getTime() - 30 * 86_400_000)]]);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      removalCapable: false,
      qualifying: false,
      coverageComplete: false,
      observedListingIds: ids,
      discovered: ids,
      unavailable: ["4300000009"],
      stored: [{ externalId: ids[0], opportunityId: `o-${ids[0]}`, sourceExpiresAt: null }],
    });
  });

  it.each([
    ["HTTP 999", { status: 999, html: "" }, "ACCESS_DENIED"],
    ["HTTP 429", { status: 429, html: "", retryAfterSeconds: 7200 }, "RATE_LIMITED"],
    ["an authwall", { status: 200, html: authwallPage(), finalUrl: "https://www.linkedin.com/authwall?trk=x" }, "ACCESS_DENIED"],
  ] as const)("fails the run on %s, closes the browser and hands the stop to Feature 12", async (_label, blocked, code) => {
    const { worker, fixture, finished, observations } = setup({ pages: { [searchUrl]: blocked as FixturePage } });
    expect(await worker.runOnce()).toMatchObject({ status: "FAILED", errorCode: code });
    expect(fixture.navigations).toEqual([searchUrl]);
    expect(fixture.state.closed).toBe(true);
    expect(finished[0]).toMatchObject({ status: "FAILED", errorCode: code, ...(code === "RATE_LIMITED" ? { retryAfterSeconds: 7200 } : {}) });
    expect(observations).toEqual([]);
  });

  it("keeps what a run stored when the source stops it during details", async () => {
    const ids = ["4100000011", "4100000012"];
    const { worker, fixture, finished, observations } = setup({
      pages: {
        [searchUrl]: searchWith(ids),
        [searchAt(2)]: { status: 200, html: noResultsPage() },
        [linkedInJobUrl("4300000009")]: { status: 200, html: jobPage({ id: "4300000009", title: "Customer Success Manager" }) },
        [linkedInJobUrl(ids[0]!)]: { status: 999, html: "" },
      },
    });
    expect(await worker.runOnce()).toMatchObject({ status: "PARTIAL", errorCode: "ACCESS_DENIED" });
    expect(fixture.state.closed).toBe(true);
    expect(fixture.navigations).toEqual([searchUrl, searchAt(2), linkedInJobUrl("4300000009"), linkedInJobUrl(ids[0]!)]);
    expect(finished[0]!.counts).toMatchObject({ created: 1 });
    expect(observations[0]).toMatchObject({ discovered: ids, stored: [{ externalId: "4300000009" }] });
  });
});
