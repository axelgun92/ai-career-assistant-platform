// Feature 11A: the retrieval worker's run handling and the /sources service
// rules (disabled by default, unverified adapters and missing environment
// cannot be enabled, archive instead of delete), with fakes only.
import { describe, expect, it, vi } from "vitest";
import { type RawOpportunity, type RetrievedListingResult } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { RetrievalRunRecord, RetrievalSourceRecord } from "@ai-career/database";
import { RetrievalSourceError } from "@ai-career/database";
import { createAdapterRegistry, createFixtureTransport } from "@ai-career/discovery";
import { createRetrievalService, RetrievalServiceError, type RetrievalStore } from "../../apps/web/src/server/retrieval-service";
import { createRetrievalWorker, runRetrievalWorkerLoop, type RetrievalRunStore } from "../../apps/web/src/server/retrieval-worker";
import { createTestAdapter, jsonResponse, testBoardUrl } from "../support/retrieval-test-adapter";

const sourceId = "5b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e";
const runId = "7c1d4e2f-8b3a-4d66-ae8f-2a3b4c5d6e7f";
const now = new Date("2026-10-18T09:00:00.000Z");

function sourceRecord(overrides: Partial<RetrievalSourceRecord> = {}): RetrievalSourceRecord {
  return {
    id: sourceId,
    adapterKey: "test-board",
    name: "Acme board",
    domain: "customer-success",
    retrievalType: "OFFICIAL_PUBLIC_API_FEED",
    sourceCategory: "ATS",
    enabled: true,
    config: { board: "acme" },
    scheduleMinutes: 720,
    lastRunAt: null,
    nextEligibleAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function runRecord(): RetrievalRunRecord {
  return {
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
    createdAt: now,
  };
}

function fakeStore(source = sourceRecord()) {
  const finished: Array<Parameters<RetrievalRunStore["finishRun"]>[1]> = [];
  const store: RetrievalRunStore = {
    enqueueDueRuns: vi.fn(async () => 0),
    claimNextRun: vi.fn(async () => ({ run: runRecord(), source })),
    finishRun: vi.fn(async (_id, input) => {
      finished.push(input);
      return { ...runRecord(), status: input.status };
    }),
    failInterruptedRuns: vi.fn(async () => 0),
  };
  return { store, finished };
}

const job = (id: string, title = "Customer Success Manager") => ({ id, title, html: `<p>Job ${id}</p>`, url: `https://jobs.example.com/${id}` });

function worker(options: {
  responses: Parameters<typeof createFixtureTransport>[0];
  ingest?: (raw: RawOpportunity) => Promise<RetrievedListingResult>;
  adapter?: ReturnType<typeof createTestAdapter>;
  source?: RetrievalSourceRecord;
  env?: Record<string, string>;
  lastChecked?: (source: string, externalIds: readonly string[]) => Promise<ReadonlyMap<string, Date>>;
}) {
  const { store, finished } = fakeStore(options.source);
  const ingested: RawOpportunity[] = [];
  const transports: Array<{ minIntervalMs?: number }> = [];
  const instance = createRetrievalWorker({
    store,
    ingestion: {
      ingest: async (raw) => {
        ingested.push(raw);
        return (options.ingest ?? (async () => ({ outcome: "CREATED", opportunityId: "o", sourceRecordId: "s", decision: "NO_MATCH" })))(raw);
      },
    },
    registry: createAdapterRegistry([options.adapter ?? createTestAdapter()]),
    transport: (transportOptions) => {
      transports.push(transportOptions);
      return createFixtureTransport(options.responses);
    },
    discovery: customerSuccessDiscoveryConfiguration,
    env: () => options.env ?? {},
    now: () => now,
    log: { info: vi.fn(), warn: vi.fn() },
    ...(options.lastChecked ? { lastChecked: options.lastChecked } : {}),
  });
  return { instance, store, finished, ingested, transports };
}

const firstPage = testBoardUrl("test-board", "acme", 1);

describe("retrieval worker", () => {
  it("ingests kept listings with the source and run ids and records the counts", async () => {
    const outcomes: RetrievedListingResult["outcome"][] = ["CREATED", "ATTACHED", "UNCHANGED", "CHANGED"];
    const { instance, finished, ingested } = worker({
      responses: { [firstPage]: jsonResponse({ jobs: [job("1"), job("2"), job("3"), job("4"), job("5", "Data Engineer")] }) },
      ingest: async () => ({ outcome: outcomes.shift()!, opportunityId: "o", sourceRecordId: "s", decision: "PROBABLE_MATCH" }),
    });
    const outcome = await instance.runOnce();
    expect(outcome?.status).toBe("COMPLETED");
    expect(finished[0]!.counts).toEqual({ fetched: 5, keptByTerms: 4, created: 1, attached: 1, unchanged: 1, changed: 1, probable: 1, failed: 0 });
    expect(ingested.every((raw) => raw.retrieval?.retrievalSourceId === sourceId && raw.retrieval?.retrievalRunId === runId)).toBe(true);
  });

  it("gives the adapter the per-run caps and a last-checked lookup scoped to its own source key", async () => {
    const base = createTestAdapter();
    let context: Parameters<typeof base.collect>[0] | null = null;
    const adapter = { ...base, collect: async (...args: Parameters<typeof base.collect>) => ((context = args[0]), base.collect(...args)) };
    const lookups: Array<[string, readonly string[]]> = [];
    const checkedAt = new Date("2026-10-17T09:00:00.000Z");
    const { instance } = worker({
      adapter,
      responses: { [firstPage]: jsonResponse({ jobs: [job("1")] }) },
      lastChecked: async (source, ids) => {
        lookups.push([source, ids]);
        return new Map([["1", checkedAt]]);
      },
    });
    await instance.runOnce();
    expect(context).toMatchObject({ maxPages: 5, maxDetailRequests: 25 });
    expect(await context!.lastChecked!(["1", "2"])).toEqual(new Map([["1", checkedAt]]));
    expect(lookups).toEqual([["test-board", ["1", "2"]]]);
    // Without a lookup, adapters treat every listing as unseen.
    let plain: Parameters<typeof base.collect>[0] | null = null;
    const bare = worker({ adapter: { ...base, collect: async (...args: Parameters<typeof base.collect>) => ((plain = args[0]), base.collect(...args)) }, responses: { [firstPage]: jsonResponse({ jobs: [] }) } });
    await bare.instance.runOnce();
    expect(plain!.lastChecked).toBeUndefined();
  });

  it("uses an adapter's own request interval and page cap where it declares them", async () => {
    const base = createTestAdapter();
    let seen: Parameters<typeof base.collect>[0] | null = null;
    const slow = { ...base, minRequestIntervalMs: 2000, maxPagesPerRun: 11, collect: async (...args: Parameters<typeof base.collect>) => ((seen = args[0]), base.collect(...args)) };
    const declared = worker({ adapter: slow, responses: { [firstPage]: jsonResponse({ jobs: [] }) } });
    await declared.instance.runOnce();
    expect(declared.transports).toEqual([{ minIntervalMs: 2000 }]);
    expect(seen).toMatchObject({ maxPages: 11, maxDetailRequests: 25 });
    const plain = worker({ responses: { [firstPage]: jsonResponse({ jobs: [] }) } });
    await plain.instance.runOnce();
    expect(plain.transports).toEqual([{}]);
  });

  it("counts a listing that fails and continues with the rest (PARTIAL)", async () => {
    let calls = 0;
    const { instance, finished } = worker({
      responses: { [firstPage]: jsonResponse({ jobs: [job("1"), job("2")] }) },
      ingest: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return { outcome: "CREATED", opportunityId: "o", sourceRecordId: "s", decision: "NO_MATCH" };
      },
    });
    expect((await instance.runOnce())?.status).toBe("PARTIAL");
    expect(finished[0]).toMatchObject({ status: "PARTIAL", errorCode: "LISTING_FAILURES", counts: { created: 1, failed: 1 } });
  });

  it("fails the run with the adapter's code: an access failure is not a rate limit", async () => {
    const denied = worker({ responses: { [firstPage]: jsonResponse({}, 403) } });
    expect(await denied.instance.runOnce()).toMatchObject({ status: "FAILED", errorCode: "ACCESS_DENIED" });
    const unauthorized = worker({ responses: { [firstPage]: jsonResponse({}, 401) } });
    expect(await unauthorized.instance.runOnce()).toMatchObject({ status: "FAILED", errorCode: "ACCESS_DENIED" });
    const limited = worker({ responses: { [firstPage]: jsonResponse({}, 429) } });
    expect(await limited.instance.runOnce()).toMatchObject({ status: "FAILED", errorCode: "RATE_LIMITED" });
    expect(limited.finished[0]!.errorMessage).toMatch(/rate-limited/);
  });

  it("keeps what was collected when a later page is rate limited", async () => {
    const { instance } = worker({
      responses: {
        [firstPage]: jsonResponse({ jobs: [job("1")], has_more: true }),
        [testBoardUrl("test-board", "acme", 2)]: jsonResponse({}, 429),
      },
    });
    expect(await instance.runOnce()).toMatchObject({ status: "PARTIAL", errorCode: "RATE_LIMITED", counts: { created: 1 } });
  });

  it("does not run an unverified adapter, one missing environment, or an invalid configuration", async () => {
    const unverified = worker({ responses: {}, adapter: createTestAdapter({ verified: false }) });
    expect(await unverified.instance.runOnce()).toMatchObject({ status: "FAILED", errorCode: "ADAPTER_UNAVAILABLE" });
    const missing = worker({ responses: {}, adapter: createTestAdapter({ requiredEnv: ["TEST_KEY"] }) });
    expect(await missing.instance.runOnce()).toMatchObject({ status: "FAILED", errorCode: "ADAPTER_UNAVAILABLE" });
    const invalid = worker({ responses: {}, source: sourceRecord({ config: { board: "" } }) });
    expect(await invalid.instance.runOnce()).toMatchObject({ status: "FAILED", errorCode: "CONFIG" });
  });

  it("returns null when there is nothing to run, and recovers interrupted runs regardless of lease", async () => {
    const { instance, store } = worker({ responses: {} });
    vi.mocked(store.claimNextRun).mockResolvedValueOnce(null);
    expect(await instance.runOnce()).toBeNull();
    await instance.recover();
    expect(store.failInterruptedRuns).toHaveBeenCalledWith(now, { regardlessOfLease: true });
  });

  it("loop: exits when another retrieval worker holds the lock; runs once with --once", async () => {
    const { instance } = worker({ responses: { [firstPage]: jsonResponse({ jobs: [] }) } });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const base = { worker: instance, sleep: async () => undefined, shouldStop: () => false, log, pollMs: 1000 };
    expect(await runRetrievalWorkerLoop({ ...base, lock: { isHeld: () => false, acquire: async () => false } })).toBe(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("another retrieval worker"));
    let held = false;
    const lock = { isHeld: () => held, acquire: async () => (held = true) };
    expect(await runRetrievalWorkerLoop({ ...base, lock, once: true })).toBe(0);
  });
});

function fakeSourceStore(initial: RetrievalSourceRecord[] = []) {
  const sources = new Map(initial.map((source) => [source.id, source]));
  const store: RetrievalStore = {
    list: vi.fn(async () => [...sources.values()].map((source) => ({ ...source, latestRun: null }))),
    get: vi.fn(async (id: string) => sources.get(id) ?? null),
    create: vi.fn(async (input) => {
      const created = sourceRecord({ ...input, id: "9d2e5f3a-0c4b-4e77-bf90-3b4c5d6e7f80", enabled: false });
      sources.set(created.id, created);
      return created;
    }),
    update: vi.fn(async (id: string, input) => {
      const updated = { ...sources.get(id)!, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) };
      sources.set(id, updated);
      return updated;
    }),
    remove: vi.fn(async () => "ARCHIVED" as const),
    restore: vi.fn(async (id: string) => sources.get(id)!),
    listRuns: vi.fn(async () => []),
    enqueueRun: vi.fn(async () => ({ run: { ...runRecord(), status: "QUEUED" as const }, alreadyActive: false })),
    healthInputs: vi.fn(async () => ({ runs: [], lastSuccess: null })),
  };
  return store;
}

describe("retrieval sources service", () => {
  const registry = createAdapterRegistry([
    createTestAdapter(),
    createTestAdapter({ key: "unverified-board", name: "Unverified", verified: false }),
    createTestAdapter({ key: "keyed-board", name: "Keyed", requiredEnv: ["KEYED_BOARD_KEY"] }),
  ]);

  it("creates sources disabled, with the adapter's configuration validated and a 12-hour default schedule", async () => {
    const store = fakeSourceStore();
    const service = createRetrievalService({ store, registry, env: () => ({}) });
    const created = await service.create({ adapterKey: "test-board", config: { board: "acme" } });
    expect(created.enabled).toBe(false);
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ scheduleMinutes: 720, sourceCategory: "ATS", config: { board: "acme" } }));
    await expect(service.create({ adapterKey: "test-board", config: {} })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await expect(service.create({ adapterKey: "nope", config: {} })).rejects.toMatchObject({ code: "ADAPTER_UNKNOWN" });
    await expect(service.create({ adapterKey: "test-board", config: { board: "a" }, scheduleMinutes: 5 })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });

  it("refuses to enable an unverified adapter or one missing its environment", async () => {
    const unverified = sourceRecord({ id: "1a2b3c4d-0000-4000-8000-000000000001", adapterKey: "unverified-board", enabled: false });
    const keyed = sourceRecord({ id: "1a2b3c4d-0000-4000-8000-000000000002", adapterKey: "keyed-board", enabled: false });
    const store = fakeSourceStore([unverified, keyed]);
    const service = createRetrievalService({ store, registry, env: () => ({}) });
    await expect(service.update(unverified.id, { enabled: true })).rejects.toMatchObject({ code: "ADAPTER_UNVERIFIED" });
    await expect(service.update(keyed.id, { enabled: true })).rejects.toMatchObject({ code: "ENVIRONMENT_MISSING" });
    expect((await service.get(keyed.id)).enableBlockedReason).toBe("Needs KEYED_BOARD_KEY.");
    expect((await service.get(unverified.id)).enableBlockedReason).toMatch(/Awaiting verification/);
    const withKey = createRetrievalService({ store, registry, env: () => ({ KEYED_BOARD_KEY: "k" }) });
    expect((await withKey.update(keyed.id, { enabled: true })).enabled).toBe(true);
  });

  it("refuses Run now for a source that cannot run, and passes store refusals through", async () => {
    const disabled = sourceRecord({ enabled: false });
    const store = fakeSourceStore([disabled]);
    vi.mocked(store.enqueueRun).mockRejectedValueOnce(new RetrievalSourceError("SOURCE_DISABLED", "Enable the source before running it"));
    const service = createRetrievalService({ store, registry, env: () => ({}) });
    await expect(service.runNow(disabled.id)).rejects.toMatchObject({ code: "SOURCE_DISABLED", status: 409 });
    await expect(service.runNow("not-a-uuid")).rejects.toBeInstanceOf(RetrievalServiceError);
  });

  it("removes through the store, which archives a source with history", async () => {
    const store = fakeSourceStore([sourceRecord()]);
    const service = createRetrievalService({ store, registry, env: () => ({}) });
    expect(await service.remove(sourceId)).toEqual({ result: "ARCHIVED" });
    await expect(service.update(sourceId, { unexpected: true })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });
});
