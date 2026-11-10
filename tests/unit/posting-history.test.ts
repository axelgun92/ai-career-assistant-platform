// Feature 13: listing coverage independent of the title filter, exact stated
// totals, retrieval-scope fields, the removal-capability matrix, posting-
// history facts (with the evaluator's input contract), the badge rule, the
// worker's qualifying-run decision and the service's scope rotation.
import { describe, expect, it, vi } from "vitest";
import {
  derivePostingHistoryFacts,
  isNoLongerListed,
  listingStatus,
  type PostingHistoryListing,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration, sourcePostingHistoryFactSchema } from "@ai-career/customer-success";
import type { RetrievalRunRecord, RetrievalSourceRecord } from "@ai-career/database";
import {
  AdapterError,
  ashbyAdapter,
  createAdapterRegistry,
  createFixtureTransport,
  createTitleMatcher,
  defaultAdapterRegistry,
  fixtureRequestKey,
  greenhouseAdapter,
  isRemovalCapable,
  leverAdapter,
  listingCoverage,
  smartRecruitersAdapter,
  trackingScopeOf,
  workdayAdapter,
  workdayListBody,
  type AnySourceAdapter,
  type CollectContext,
  type TransportResponse,
} from "@ai-career/discovery";
import { createRetrievalService, type RetrievalStore } from "../../apps/web/src/server/retrieval-service";
import { createRetrievalWorker, type RetrievalRunStore } from "../../apps/web/src/server/retrieval-worker";
import { createTestAdapter, jsonResponse, testBoardUrl } from "../support/retrieval-test-adapter";

const now = new Date("2026-10-19T12:00:00.000Z");
const hours = (value: number) => new Date(now.getTime() + value * 60 * 60 * 1000);
const json = (body: unknown, status = 200): Omit<TransportResponse, "url"> => ({ status, contentType: "application/json", body: JSON.stringify(body) });

function context(responses: Record<string, Omit<TransportResponse, "url">>, overrides: Partial<CollectContext> = {}): CollectContext {
  return {
    transport: createFixtureTransport(responses),
    discovery: customerSuccessDiscoveryConfiguration,
    keepTitle: createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms),
    env: {},
    now: () => now,
    maxPages: 5,
    maxDetailRequests: 25,
    ...overrides,
  };
}

describe("listing coverage", () => {
  it("is complete only when the whole listing was read, every item has an ID and unique IDs equal a stated total exactly", () => {
    expect(listingCoverage(["1", "2"], { readWholeListing: true, statedTotal: 2 })).toEqual({ observedListingIds: ["1", "2"], complete: true });
    // Below the stated total: incomplete.
    expect(listingCoverage(["1", "2"], { readWholeListing: true, statedTotal: 3 }).complete).toBe(false);
    // Above the stated total: incomplete (the listing changed while read).
    expect(listingCoverage(["1", "2", "3"], { readWholeListing: true, statedTotal: 2 }).complete).toBe(false);
    // Duplicates count once.
    expect(listingCoverage(["1", "1", "2"], { readWholeListing: true, statedTotal: 2 }).complete).toBe(true);
    expect(listingCoverage(["1", null], { readWholeListing: true }).complete).toBe(false);
    expect(listingCoverage(["1"], { readWholeListing: false }).complete).toBe(false);
    expect(listingCoverage([], { readWholeListing: true, statedTotal: 0 }).complete).toBe(true);
  });

  it("Greenhouse covers every board ID before the title filter, against meta.total", async () => {
    const config = { board: "acme" };
    const url = greenhouseAdapter.verificationUrl(config);
    const jobs = [
      { id: 1, title: "Customer Success Manager", content: "<p>Own renewals.</p>", absolute_url: "https://boards.greenhouse.io/acme/jobs/1" },
      { id: 2, title: "Data Engineer", content: "<p>Pipelines.</p>" },
    ];
    const result = await greenhouseAdapter.collect(context({ [url]: json({ jobs, meta: { total: 2 } }) }), config);
    expect(result.listings.map((listing) => listing.externalId)).toEqual(["1"]);
    expect(result.coverage).toEqual({ observedListingIds: ["1", "2"], complete: true });
    for (const total of [1, 3]) {
      const mismatch = await greenhouseAdapter.collect(context({ [url]: json({ jobs, meta: { total } }) }), config);
      expect(mismatch.coverage?.complete).toBe(false);
    }
    const missingId = await greenhouseAdapter.collect(context({ [url]: json({ jobs: [...jobs, { title: "No id" }], meta: { total: 3 } }) }), config);
    expect(missingId.coverage?.complete).toBe(false);
  });

  it("Lever covers the whole site and Ashby only its listed postings", async () => {
    const lever = { site: "acme", company: "Acme" };
    const leverResult = await leverAdapter.collect(
      context({ [leverAdapter.verificationUrl(lever)]: json([{ id: "a", text: "Data Engineer" }, { id: "b", text: "Account Executive" }]) }),
      lever,
    );
    expect(leverResult.coverage).toEqual({ observedListingIds: ["a", "b"], complete: true });
    const ashby = { board: "acme", company: "Acme" };
    const ashbyResult = await ashbyAdapter.collect(
      context({ [ashbyAdapter.verificationUrl(ashby)]: json({ jobs: [{ id: "x", title: "Data Engineer" }, { id: "y", title: "Recruiter", isListed: false }] }) }),
      ashby,
    );
    expect(ashbyResult.coverage).toEqual({ observedListingIds: ["x"], complete: true });
  });

  describe("SmartRecruiters (complete only when totalFound is read in full)", () => {
    const config = smartRecruitersAdapter.configSchema.parse({ company: "acme", pageSize: 2 });
    const page = (offset: number) => `https://api.smartrecruiters.com/v1/companies/acme/postings?limit=2${offset ? `&offset=${offset}` : ""}`;
    const posting = (id: string) => ({ id, name: "Data Engineer" });
    const run = (responses: Record<string, Omit<TransportResponse, "url">>, maxPages = 5) =>
      smartRecruitersAdapter.collect(context(responses, { maxPages, maxDetailRequests: 0 }), config);

    it("records every list-level ID and is complete when unique IDs equal totalFound", async () => {
      const result = await run({ [page(0)]: json({ content: [posting("1"), posting("2")], totalFound: 3 }), [page(2)]: json({ content: [posting("3")], totalFound: 3 }) });
      expect(result.coverage).toEqual({ observedListingIds: ["1", "2", "3"], complete: true });
    });

    it("is incomplete below, above or beyond the cap, or after a halt", async () => {
      // A posting shifted onto page 2: three unique IDs read where four are stated.
      const below = await run({ [page(0)]: json({ content: [posting("1"), posting("2")], totalFound: 4 }), [page(2)]: json({ content: [posting("2"), posting("3")], totalFound: 4 }), [page(4)]: json({ content: [], totalFound: 4 }) });
      expect(below.coverage?.complete).toBe(false);
      const above = await run({ [page(0)]: json({ content: [posting("1"), posting("2")], totalFound: 3 }), [page(2)]: json({ content: [posting("3"), posting("4")], totalFound: 3 }) });
      expect(above.coverage?.complete).toBe(false);
      const capped = await run({ [page(0)]: json({ content: [posting("1"), posting("2")], totalFound: 4 }) }, 1);
      expect(capped.coverage).toEqual({ observedListingIds: ["1", "2"], complete: false });
      const halted = await run({ [page(0)]: json({ content: [posting("1"), posting("2")], totalFound: 4 }), [page(2)]: json({}, 429) });
      expect(halted.halted?.code).toBe("RATE_LIMITED");
      expect(halted.coverage?.complete).toBe(false);
    });
  });

  describe("Workday (complete only when the first page's total is read in full)", () => {
    const config = { careerSite: "https://acme.wd5.myworkdayjobs.com/External" };
    const listUrl = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs";
    const key = (offset: number) => fixtureRequestKey(listUrl, workdayListBody(offset));
    const posting = (n: number) => ({ title: "Data Engineer", externalPath: `/job/x/Data-Engineer_JR-${n}` });
    const id = (n: number) => `acme/External:/job/x/Data-Engineer_JR-${n}`;

    it("is complete with exactly total unique IDs, and incomplete otherwise", async () => {
      const exact = await workdayAdapter.collect(context({ [key(0)]: json({ total: 2, jobPostings: [posting(1), posting(2)] }) }, { maxDetailRequests: 0 }), config);
      expect(exact.coverage).toEqual({ observedListingIds: [id(1), id(2)], complete: true });
      const below = await workdayAdapter.collect(context({ [key(0)]: json({ total: 3, jobPostings: [posting(1), posting(2)] }) }, { maxDetailRequests: 0 }), config);
      expect(below.coverage?.complete).toBe(false);
      const unsafe = await workdayAdapter.collect(context({ [key(0)]: json({ total: 2, jobPostings: [posting(1), { title: "x", externalPath: "https://evil" }] }) }, { maxDetailRequests: 0 }), config);
      expect(unsafe.coverage?.complete).toBe(false);
    });
  });

  it("declares removal capability only for Greenhouse, Lever, Ashby, Workday and SmartRecruiters", () => {
    const capable = defaultAdapterRegistry.list().filter(isRemovalCapable).map((adapter) => adapter.key).sort();
    expect(capable).toEqual(["ashby", "greenhouse", "lever", "smartrecruiters", "workday"]);
    for (const key of ["wellfound", "himalayas", "remote-ok", "working-nomads", "workable", "we-work-remotely", "adzuna", "welcome-to-the-jungle"]) {
      expect(isRemovalCapable(defaultAdapterRegistry.get(key)!)).toBe(false);
    }
  });

  it("compares retrieval scope by the adapter's scope fields only", () => {
    const scope = (adapter: AnySourceAdapter, config: unknown) => trackingScopeOf(adapter, adapter.configSchema.parse(config));
    expect(scope(leverAdapter, { site: "acme", company: "Acme" })).toBe(scope(leverAdapter, { site: "acme", company: "Acme Inc." }));
    expect(scope(leverAdapter, { site: "acme", company: "Acme" })).not.toBe(scope(leverAdapter, { site: "beta", company: "Acme" }));
    expect(scope(smartRecruitersAdapter, { company: "acme", pageSize: 100 })).toBe(scope(smartRecruitersAdapter, { company: "acme", pageSize: 20 }));
    expect(scope(workdayAdapter, { careerSite: "https://acme.wd5.myworkdayjobs.com/External" })).toBe(
      scope(workdayAdapter, { careerSite: "https://acme.wd5.myworkdayjobs.com/en-US/External", company: "Acme" }),
    );
    expect(scope(greenhouseAdapter, { board: "acme" })).not.toBe(scope(greenhouseAdapter, { board: "beta" }));
  });
});

function listing(overrides: Partial<PostingHistoryListing> = {}): PostingHistoryListing {
  return {
    sourceName: "Acme Greenhouse",
    sourceCategory: "ATS",
    scheduleMinutes: 720,
    removalCapable: true,
    currentScope: true,
    state: "LISTED",
    firstSeenAt: hours(-48),
    lastSeenAt: hours(-1),
    missingSince: null,
    removedAt: null,
    reappearedAt: null,
    reappearances: 0,
    sourceExpiresAt: null,
    ...overrides,
  };
}

describe("posting-history facts", () => {
  const facts = (listings: PostingHistoryListing[], contentVersions: Parameters<typeof derivePostingHistoryFacts>[0]["contentVersions"] = []) =>
    derivePostingHistoryFacts({ listings, contentVersions, now });

  it("derive ACTIVE_ATS and CURRENT_POSTING from recent positive sightings only", () => {
    expect(facts([listing()]).map((fact) => fact.type)).toEqual(["ACTIVE_ATS"]);
    expect(facts([listing({ sourceCategory: "JOB_BOARD", removalCapable: false })]).map((fact) => fact.type)).toEqual(["CURRENT_POSTING"]);
    // Not seen within two schedule intervals, missing, historical or untracked: no current fact.
    expect(facts([listing({ lastSeenAt: hours(-25) })])).toEqual([]);
    expect(facts([listing({ state: "MISSING", missingSince: hours(-2) })])).toEqual([]);
    expect(facts([listing({ state: "HISTORICAL" })])).toEqual([]);
    expect(facts([listing({ currentScope: false, state: "UNTRACKED" })])).toEqual([]);
  });

  it("derive REPOSTED only from a reappearance after a confirmed removal", () => {
    const relisted = facts([listing({ reappearedAt: hours(-1), reappearances: 1, removedAt: hours(-30) })]);
    expect(relisted.map((fact) => fact.type)).toEqual(["ACTIVE_ATS", "REPOSTED"]);
    // A cleared MISSING state is not a reappearance.
    expect(facts([listing({ missingSince: null })]).some((fact) => fact.type === "REPOSTED")).toBe(false);
  });

  it("derive CLOSED_ATS_VISIBLE_ELSEWHERE when a board sees the listing after the employer's removal", () => {
    const ats = listing({ state: "REMOVED", missingSince: hours(-30), removedAt: hours(-5), lastSeenAt: hours(-31) });
    const board = listing({ sourceName: "Remote OK", sourceCategory: "JOB_BOARD", removalCapable: false, lastSeenAt: hours(-1) });
    expect(facts([ats, board]).map((fact) => fact.type)).toEqual(["CURRENT_POSTING", "CLOSED_ATS_VISIBLE_ELSEWHERE"]);
    expect(facts([ats, { ...board, lastSeenAt: hours(-6) }]).some((fact) => fact.type === "CLOSED_ATS_VISIBLE_ELSEWHERE")).toBe(false);
    expect(facts([listing({ sourceName: "Agg", sourceCategory: "AGGREGATOR", removalCapable: false })]).map((fact) => fact.type)).toEqual([
      "CURRENT_POSTING",
      "AGGREGATOR_VISIBILITY",
    ]);
  });

  it("derive UNCHANGED_OVER_TIME from content observations only: the latest version, re-observed 30 days or more after it was stored", () => {
    const version = { sourceName: "Acme Greenhouse", discoveredAt: hours(-31 * 24), lastObservedAt: hours(-1), superseded: false };
    expect(facts([], [version]).map((fact) => fact.type)).toEqual(["UNCHANGED_OVER_TIME"]);
    expect(facts([], [{ ...version, superseded: true }])).toEqual([]);
    // Seen listed for 31 days, but its content observed only 29 days apart.
    expect(facts([listing({ firstSeenAt: hours(-31 * 24) })], [{ ...version, lastObservedAt: hours(-31 * 24 + 29 * 24) }]).some((fact) => fact.type === "UNCHANGED_OVER_TIME")).toBe(false);
  });

  it("match the evaluator's posting-history input contract exactly (never delivered to it in feature 13)", () => {
    const all = facts(
      [
        listing({ reappearedAt: hours(-1), reappearances: 2 }),
        listing({ state: "REMOVED", missingSince: hours(-30), removedAt: hours(-5), lastSeenAt: hours(-31) }),
        listing({ sourceName: "Agg", sourceCategory: "AGGREGATOR", removalCapable: false }),
      ],
      [{ sourceName: "Acme", discoveredAt: hours(-40 * 24), lastObservedAt: hours(-1), superseded: false }],
    );
    expect(new Set(all.map((fact) => fact.type))).toEqual(
      new Set(["ACTIVE_ATS", "REPOSTED", "CURRENT_POSTING", "AGGREGATOR_VISIBILITY", "CLOSED_ATS_VISIBLE_ELSEWHERE", "UNCHANGED_OVER_TIME"]),
    );
    for (const fact of all) expect(sourcePostingHistoryFactSchema.safeParse(fact).success).toBe(true);
  });
});

describe("listing status and the No longer listed badge", () => {
  it("words each state conservatively", () => {
    expect(listingStatus(listing(), now)).toBe("listed");
    expect(listingStatus(listing({ reappearedAt: hours(-1), reappearances: 1 }), now)).toBe("listed_again");
    expect(listingStatus(listing({ state: "HISTORICAL" }), now)).toBe("unknown");
    expect(listingStatus(listing({ lastSeenAt: hours(-30) }), now)).toBe("unknown");
    expect(listingStatus(listing({ state: "MISSING", missingSince: hours(-2) }), now)).toBe("missing");
    expect(listingStatus(listing({ state: "REMOVED", removedAt: hours(-2) }), now)).toBe("removed");
    expect(listingStatus(listing({ state: "UNTRACKED", currentScope: false }), now)).toBe("untracked");
  });

  it("shows only when every current-scope removal-capable listing is removed and nothing saw it afterwards", () => {
    const removed = listing({ state: "REMOVED", missingSince: hours(-30), removedAt: hours(-5), lastSeenAt: hours(-31) });
    expect(isNoLongerListed([removed])).toBe(true);
    // A bounded source that cannot confirm removal does not suppress it…
    expect(isNoLongerListed([removed, listing({ sourceCategory: "JOB_BOARD", removalCapable: false, lastSeenAt: hours(-40) })])).toBe(true);
    // …unless it saw the listing after the removal.
    expect(isNoLongerListed([removed, listing({ sourceCategory: "JOB_BOARD", removalCapable: false, lastSeenAt: hours(-1) })])).toBe(false);
    // Another capable source still listing it, or with unknown status, keeps it off.
    expect(isNoLongerListed([removed, listing()])).toBe(false);
    expect(isNoLongerListed([removed, listing({ state: "HISTORICAL", lastSeenAt: hours(-200) })])).toBe(false);
    expect(isNoLongerListed([removed, listing({ state: "MISSING", missingSince: hours(-2), lastSeenAt: hours(-40) })])).toBe(false);
    // Only bounded sources, or only an old scope: never.
    expect(isNoLongerListed([listing({ removalCapable: false })])).toBe(false);
    expect(isNoLongerListed([{ ...removed, currentScope: false, state: "UNTRACKED" }])).toBe(false);
  });
});

const sourceId = "5b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e";
const runId = "7c1d4e2f-8b3a-4d66-ae8f-2a3b4c5d6e7f";

function sourceRecord(overrides: Partial<RetrievalSourceRecord> = {}): RetrievalSourceRecord {
  return {
    id: sourceId, adapterKey: "test-board", name: "Acme board", domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED",
    sourceCategory: "ATS", enabled: true, config: { board: "acme" }, scheduleMinutes: 720, lastRunAt: null, nextEligibleAt: null,
    trackingScopeKey: "scope-1", archivedAt: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

function runRecord(): RetrievalRunRecord {
  return {
    id: runId, retrievalSourceId: sourceId, trigger: "MANUAL", status: "RUNNING", leaseExpiresAt: null, startedAt: now, finishedAt: null,
    counts: null, errorCode: null, errorMessage: null, retryAfterUntil: null, listingCoverageComplete: null, createdAt: now,
  };
}

describe("the worker's listing observations", () => {
  // A test board that reports complete coverage of its listing.
  function completeBoard(capable = true) {
    const base = createTestAdapter();
    return {
      ...base,
      listingCoverage: capable ? ("complete-board" as const) : undefined,
      async collect(...args: Parameters<typeof base.collect>) {
        const result = await base.collect(...args);
        return { ...result, coverage: { observedListingIds: ["1", "2", "9"], complete: true } };
      },
    };
  }
  async function observe(adapter: AnySourceAdapter, response: Omit<TransportResponse, "url">, source = sourceRecord()) {
    const recorded: Array<Parameters<RetrievalRunStore["recordListingObservations"]>[0]> = [];
    const finished: Array<Parameters<RetrievalRunStore["finishRun"]>[1]> = [];
    const store: RetrievalRunStore = {
      enqueueDueRuns: vi.fn(async () => 0),
      claimNextRun: vi.fn(async () => ({ run: runRecord(), source })),
      finishRun: vi.fn(async (_id, input) => (finished.push(input), { ...runRecord(), status: input.status })),
      failInterruptedRuns: vi.fn(async () => 0),
      recordListingObservations: vi.fn(async (input) => (recorded.push(input), { applied: true, observed: 2, missing: 1, removed: 0, reappeared: 0 })),
    };
    const worker = createRetrievalWorker({
      store,
      ingestion: { ingest: async () => ({ outcome: "CREATED", opportunityId: "opp-1", sourceRecordId: "s", decision: "NO_MATCH" }) },
      registry: createAdapterRegistry([adapter]),
      transport: () => createFixtureTransport({ [testBoardUrl("test-board", "acme", 1)]: response }),
      discovery: customerSuccessDiscoveryConfiguration,
      env: () => ({}),
      now: () => now,
      log: { info: vi.fn(), warn: vi.fn() },
    });
    await worker.runOnce();
    return { recorded, finished, store };
  }
  const page = jsonResponse({ jobs: [{ id: "1", title: "Customer Success Manager", html: "<p>Renewals.</p>", url: "https://jobs.example.com/1" }] });

  it("qualifies a complete, successful run of a removal-capable adapter, with the run's scope and stored listings", async () => {
    const { recorded, finished } = await observe(completeBoard(), page);
    expect(recorded[0]).toMatchObject({
      sourceId,
      runId,
      trackingScopeKey: "scope-1",
      removalCapable: true,
      qualifying: true,
      coverageComplete: true,
      observedListingIds: ["1", "2", "9"],
      stored: [{ externalId: "1", opportunityId: "opp-1", sourceExpiresAt: null }],
    });
    expect(finished[0]!.counts.listings).toEqual({ observed: 2, missing: 1, removed: 0, reappeared: 0 });
  });

  it("never qualifies a bounded adapter or a run stopped by the source, and records nothing without a scope", async () => {
    expect((await observe(completeBoard(false), page)).recorded[0]).toMatchObject({ removalCapable: false, qualifying: false });
    const base = createTestAdapter();
    // Stopped by a 429 after storing a listing: PARTIAL, never qualifying.
    const partial = {
      ...completeBoard(),
      async collect(...args: Parameters<typeof base.collect>) {
        const result = await base.collect(...args);
        return { ...result, halted: new AdapterError("RATE_LIMITED", "Rate limited"), coverage: { observedListingIds: ["1"], complete: true } };
      },
    };
    expect((await observe(partial, page)).recorded[0]).toMatchObject({ qualifying: false, coverageComplete: false });
    expect((await observe(completeBoard(), page, sourceRecord({ trackingScopeKey: null }))).recorded).toEqual([]);
  });
});

describe("the service's tracking-scope rotation", () => {
  function store(existing: RetrievalSourceRecord) {
    return {
      list: vi.fn(),
      get: vi.fn(async () => existing),
      create: vi.fn(),
      update: vi.fn(async () => existing),
      remove: vi.fn(),
      restore: vi.fn(),
      listRuns: vi.fn(async () => []),
      enqueueRun: vi.fn(),
      healthInputs: vi.fn(async () => ({ runs: [], lastSuccess: null })),
    } as unknown as RetrievalStore;
  }

  it("rotates on a retrieval-scope change and not on a display-only change", async () => {
    const source = sourceRecord({ adapterKey: "lever", config: { site: "acme", company: "Acme" } });
    const fake = store(source);
    const service = createRetrievalService({ store: fake, registry: createAdapterRegistry([leverAdapter]), env: () => ({}), now: () => now });
    await service.update(sourceId, { config: { site: "acme", company: "Acme Inc." } });
    await service.update(sourceId, { config: { site: "beta", company: "Acme" } });
    await service.update(sourceId, { name: "Renamed" });
    expect(vi.mocked(fake.update).mock.calls.map((call) => call[3])).toEqual([
      { rotateTrackingScope: false },
      { rotateTrackingScope: true },
      { rotateTrackingScope: false },
    ]);
  });
});
