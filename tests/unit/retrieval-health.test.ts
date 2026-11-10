// Feature 12: source health and conservative retrieval. The pure backoff and
// health rules, Retry-After parsing, stopping a host after any server error,
// the worker handing the source's Retry-After to the store, Run now's gate
// rules through the service and API, and the doctor's read-only warning.
import { describe, expect, it, vi } from "vitest";
import {
  activeGate,
  classifyRunOutcome,
  computeNextEligibleAt,
  deriveSourceHealth,
  failureStreak,
  maxFailureBackoffMinutes,
  type HealthRun,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { RetrievalSourceError, type RetrievalRunRecord, type RetrievalSourceRecord } from "@ai-career/database";
import {
  AdapterError,
  createAdapterRegistry,
  createFetchTransport,
  createFixtureTransport,
  createPoliteTransport,
  ensureSuccess,
  isStopError,
  parseRetryAfter,
} from "@ai-career/discovery";
import { formatDoctorChecks, runDoctorChecks, type DoctorReads, type DoctorSourceHealthInputs } from "../../apps/web/src/server/doctor";
import { createRetrievalApiHandlers, createRetrievalService, type RetrievalStore } from "../../apps/web/src/server/retrieval-service";
import { createRetrievalWorker, type RetrievalRunStore } from "../../apps/web/src/server/retrieval-worker";
import { createTestAdapter, testBoardUrl } from "../support/retrieval-test-adapter";

const now = new Date("2026-10-18T12:00:00.000Z");
const minutes = (value: number) => value * 60_000;
const at = (offsetMinutes: number) => new Date(now.getTime() + minutes(offsetMinutes));
const S = 720;

function run(overrides: Partial<HealthRun> = {}): HealthRun {
  return {
    status: "COMPLETED",
    errorCode: null,
    errorMessage: null,
    createdAt: at(-10),
    finishedAt: at(-9),
    counts: { fetched: 3 },
    retryAfterUntil: null,
    ...overrides,
  };
}
const failed = (errorCode: string, overrides: Partial<HealthRun> = {}) => run({ status: "FAILED", errorCode, counts: { fetched: 0 }, ...overrides });

describe("run outcomes", () => {
  it("counts COMPLETED, and PARTIAL only because of our listing failures, as a successful retrieval", () => {
    expect(classifyRunOutcome(run())).toBe("success");
    expect(classifyRunOutcome(run({ status: "PARTIAL", errorCode: "LISTING_FAILURES" }))).toBe("success");
  });

  it("never counts a PARTIAL run stopped by the source as a success", () => {
    for (const code of ["RATE_LIMITED", "ACCESS_DENIED", "SERVER_ERROR", "NETWORK", "HTTP_STATUS", "CONTRACT_MISMATCH", "RESPONSE_TOO_LARGE"]) {
      expect(classifyRunOutcome(run({ status: "PARTIAL", errorCode: code }))).toBe("source_failure");
    }
  });

  it("treats failures on our side as neutral and queued or running runs as active", () => {
    for (const code of ["INTERNAL", "WORKER_INTERRUPTED", "SOURCE_DISABLED", "ADAPTER_UNAVAILABLE", "LISTING_FAILURES"]) {
      expect(classifyRunOutcome(failed(code))).toBe("neutral");
    }
    expect(classifyRunOutcome(run({ status: "QUEUED" }))).toBe("active");
    expect(classifyRunOutcome(run({ status: "RUNNING" }))).toBe("active");
  });

  it("counts consecutive source failures back to the last success, skipping neutral runs", () => {
    const runs = [failed("SERVER_ERROR"), failed("WORKER_INTERRUPTED"), failed("NETWORK"), run(), failed("RATE_LIMITED")];
    expect(failureStreak(runs)).toBe(2);
    expect(failureStreak([run(), failed("NETWORK")])).toBe(0);
  });
});

describe("the gate after a run", () => {
  const next = (outcome: Pick<HealthRun, "status" | "errorCode">, streak: number, extra: { retryAfterUntil?: Date | null; current?: Date | null; schedule?: number } = {}) =>
    computeNextEligibleAt({
      outcome,
      streak,
      scheduleMinutes: extra.schedule ?? S,
      finishedAt: now,
      retryAfterUntil: extra.retryAfterUntil ?? null,
      current: extra.current ?? null,
    });

  it("clears after a successful retrieval and is unchanged by a neutral run", () => {
    expect(next(run(), 0, { current: at(60) })).toBeNull();
    expect(next(run({ status: "PARTIAL", errorCode: "LISTING_FAILURES" }), 0, { current: at(60) })).toBeNull();
    expect(next(failed("INTERNAL"), 0, { current: at(60) })).toEqual(at(60));
    expect(next(failed("SOURCE_DISABLED"), 0)).toBeNull();
  });

  it("backs off a rate limit by doubling the schedule, capped at 7 days", () => {
    expect(next(failed("RATE_LIMITED"), 1)).toEqual(at(S));
    expect(next(failed("RATE_LIMITED"), 2)).toEqual(at(2 * S));
    expect(next(failed("RATE_LIMITED"), 3)).toEqual(at(4 * S));
    expect(next(failed("RATE_LIMITED"), 30)).toEqual(at(maxFailureBackoffMinutes));
    expect(next(failed("RATE_LIMITED"), 2, { schedule: 7 * 24 * 60 })).toEqual(at(maxFailureBackoffMinutes));
  });

  it("gives a first transient failure the normal schedule and escalates repeats", () => {
    for (const code of ["SERVER_ERROR", "NETWORK", "HTTP_STATUS"]) {
      expect(next(failed(code), 1)).toBeNull();
      expect(next(failed(code), 2)).toEqual(at(2 * S));
      expect(next(failed(code), 3)).toEqual(at(4 * S));
    }
  });

  it("waits at least a day after an access refusal or contract problem, up to 7 days, without disabling", () => {
    for (const code of ["ACCESS_DENIED", "CONTRACT_MISMATCH", "CONFIG", "RESPONSE_TOO_LARGE"]) {
      expect(next(failed(code), 1)).toEqual(at(24 * 60));
      expect(next(failed(code), 2)).toEqual(at(2 * 24 * 60));
      expect(next(failed(code), 4)).toEqual(at(maxFailureBackoffMinutes));
    }
    expect(next(failed("ACCESS_DENIED"), 1, { schedule: 2 * 24 * 60 })).toEqual(at(2 * 24 * 60));
  });

  it("honours a valid Retry-After in full, however long, as the later of it and the backoff", () => {
    const sixtyDays = at(60 * 24 * 60);
    expect(next(failed("RATE_LIMITED"), 1, { retryAfterUntil: sixtyDays })).toEqual(sixtyDays);
    expect(next(failed("RATE_LIMITED"), 1, { retryAfterUntil: at(5) })).toEqual(at(S));
    // A 503 with Retry-After: the first transient failure waits for the source.
    expect(next(failed("SERVER_ERROR"), 1, { retryAfterUntil: at(90) })).toEqual(at(90));
    expect(next(failed("SERVER_ERROR"), 3, { retryAfterUntil: at(90) })).toEqual(at(4 * S));
  });
});

describe("what kind of gate is in force", () => {
  it("is a rate limit for its whole length after a 429, never overridable", () => {
    const runs = [failed("RATE_LIMITED", { retryAfterUntil: at(30) })];
    expect(activeGate({ nextEligibleAt: at(S), runsNewestFirst: runs, now })).toEqual({ kind: "rate_limited", until: at(S) });
    // A neutral run since then does not change it.
    expect(activeGate({ nextEligibleAt: at(S), runsNewestFirst: [failed("WORKER_INTERRUPTED"), ...runs], now })?.kind).toBe("rate_limited");
  });

  it("is a provider wait until the source's own date, then our backoff for the rest", () => {
    const runs = [failed("SERVER_ERROR", { retryAfterUntil: at(60) })];
    const gate = at(4 * S);
    expect(activeGate({ nextEligibleAt: gate, runsNewestFirst: runs, now })).toEqual({ kind: "provider_wait", until: at(60) });
    expect(activeGate({ nextEligibleAt: gate, runsNewestFirst: runs, now: at(61) })).toEqual({ kind: "backoff", until: gate });
  });

  it("is our backoff after other failures, and nothing once it has passed", () => {
    expect(activeGate({ nextEligibleAt: at(60), runsNewestFirst: [failed("ACCESS_DENIED")], now })).toEqual({ kind: "backoff", until: at(60) });
    expect(activeGate({ nextEligibleAt: at(-1), runsNewestFirst: [failed("RATE_LIMITED")], now })).toBeNull();
    expect(activeGate({ nextEligibleAt: null, runsNewestFirst: [failed("RATE_LIMITED")], now })).toBeNull();
  });
});

describe("source health", () => {
  const health = (input: Partial<Parameters<typeof deriveSourceHealth>[0]> = {}) =>
    deriveSourceHealth({
      enabled: true,
      archivedAt: null,
      blockedReason: null,
      scheduleMinutes: S,
      lastRunAt: at(-10),
      nextEligibleAt: null,
      runsNewestFirst: [],
      lastSuccess: null,
      now,
      ...input,
    });

  it("is healthy after a completed run and degraded after one PARTIAL caused by our listing failures", () => {
    const success = run();
    expect(health({ runsNewestFirst: [success], lastSuccess: success })).toMatchObject({ status: "healthy", lastSuccessAt: success.finishedAt, streak: 0, nextRunAt: at(-10 + S) });
    const partial = run({ status: "PARTIAL", errorCode: "LISTING_FAILURES" });
    expect(health({ runsNewestFirst: [partial], lastSuccess: partial }).status).toBe("degraded");
  });

  it("is degraded after one transient failure, failing after repeats, and needs attention after an access refusal", () => {
    const success = run({ finishedAt: at(-100) });
    expect(health({ runsNewestFirst: [failed("SERVER_ERROR"), success], lastSuccess: success })).toMatchObject({ status: "degraded", streak: 1 });
    expect(health({ runsNewestFirst: [failed("NETWORK"), failed("SERVER_ERROR"), success], lastSuccess: success }).status).toBe("failing");
    expect(health({ runsNewestFirst: [failed("ACCESS_DENIED"), success], lastSuccess: success, nextEligibleAt: at(24 * 60) })).toMatchObject({
      status: "needs_attention",
      lastFailure: { code: "ACCESS_DENIED" },
      gate: { kind: "backoff", until: at(24 * 60) },
      nextRunAt: at(24 * 60),
    });
  });

  it("distinguishes a rate limit from a wait the source asked for on another response", () => {
    const limited = health({ runsNewestFirst: [failed("RATE_LIMITED")], nextEligibleAt: at(S) });
    expect(limited).toMatchObject({ status: "rate_limited", gate: { kind: "rate_limited", until: at(S) } });
    const waiting = health({ runsNewestFirst: [failed("SERVER_ERROR", { retryAfterUntil: at(120) })], nextEligibleAt: at(120) });
    expect(waiting).toMatchObject({ status: "provider_wait", gate: { kind: "provider_wait", until: at(120) } });
  });

  it("does not let a PARTIAL run stopped by a 429 refresh the last successful retrieval", () => {
    const old = run({ finishedAt: at(-3 * S) });
    const partial = run({ status: "PARTIAL", errorCode: "RATE_LIMITED", finishedAt: at(-5) });
    const result = health({ runsNewestFirst: [partial, old], lastSuccess: old });
    expect(result.lastSuccessAt).toEqual(old.finishedAt);
    expect(result.stale).toBe(true);
    expect(result.status).toBe("degraded");
  });

  it("is stale only past two schedule intervals, notes a source that never succeeded, and treats zero results as information", () => {
    const recent = run({ finishedAt: at(-2 * S + 1) });
    expect(health({ runsNewestFirst: [recent], lastSuccess: recent }).stale).toBe(false);
    expect(health({ runsNewestFirst: [failed("CONTRACT_MISMATCH")] })).toMatchObject({ neverSucceeded: true, lastSuccessAt: null });
    const empty = run({ counts: { fetched: 0 } });
    expect(health({ runsNewestFirst: [empty], lastSuccess: empty })).toMatchObject({ status: "healthy", emptyResult: true });
  });

  it("stays neutral for disabled and archived sources and has no next run while one is active", () => {
    const runs = [failed("RATE_LIMITED")];
    expect(health({ enabled: false, runsNewestFirst: runs, nextEligibleAt: at(S) })).toMatchObject({ status: "disabled", nextRunAt: null, stale: false });
    expect(health({ enabled: false, archivedAt: at(-1), runsNewestFirst: runs }).status).toBe("archived");
    expect(health({ blockedReason: "Needs a key.", runsNewestFirst: runs }).status).toBe("blocked");
    expect(health({ runsNewestFirst: [run({ status: "RUNNING", finishedAt: null }), ...runs] })).toMatchObject({ status: "running", nextRunAt: null });
    expect(health({ lastRunAt: null })).toMatchObject({ status: "not_run", nextRunAt: now });
  });
});

describe("Retry-After and server errors in the transport", () => {
  it("accepts delta-seconds or a future HTTP date, kept in full, and ignores anything else", () => {
    expect(parseRetryAfter("120", now)).toBe(120);
    expect(parseRetryAfter(String(60 * 24 * 60 * 60), now)).toBe(60 * 24 * 60 * 60);
    expect(parseRetryAfter(new Date(now.getTime() + 90_000).toUTCString(), now)).toBe(90);
    for (const value of ["0", "-5", "1.5", "soon", "", null, undefined, new Date(now.getTime() - 60_000).toUTCString()]) {
      expect(parseRetryAfter(value, now)).toBeUndefined();
    }
  });

  it("reads Retry-After from a 429 or 503 only, and carries it into the error", async () => {
    const transport = (status: number) =>
      createFetchTransport({ now: () => now, fetchImpl: (async () => new Response("{}", { status, headers: { "retry-after": "300" } })) as unknown as typeof fetch });
    for (const status of [429, 503]) {
      const response = await transport(status).get("https://api.example.com/a");
      expect(response.retryAfterSeconds).toBe(300);
      expect(() => ensureSuccess(response)).toThrow(expect.objectContaining({ details: expect.objectContaining({ retryAfterSeconds: 300 }) }));
    }
    expect((await transport(500).get("https://api.example.com/a")).retryAfterSeconds).toBeUndefined();
    expect(() => ensureSuccess({ status: 503, url: "https://api.example.com/a", contentType: null, body: "", retryAfterSeconds: 300 })).toThrow(
      expect.objectContaining({ code: "SERVER_ERROR" }),
    );
  });

  it("stops sending to a host after any server error, keeping the source's Retry-After", async () => {
    const statuses: Record<string, { status: number; retryAfterSeconds?: number }> = {
      "https://a.example.com/1": { status: 500 },
      "https://b.example.com/1": { status: 503, retryAfterSeconds: 600 },
    };
    const inner = {
      get: vi.fn(async (url: string) => ({ url, contentType: null, body: "", ...(statuses[url] ?? { status: 200 }) })),
      post: vi.fn(),
    };
    const polite = createPoliteTransport(inner, { minIntervalMs: 0 });
    expect((await polite.get("https://a.example.com/1")).status).toBe(500);
    await expect(polite.get("https://a.example.com/2")).rejects.toMatchObject({ code: "SERVER_ERROR" });
    expect((await polite.get("https://b.example.com/1")).status).toBe(503);
    await expect(polite.get("https://b.example.com/2")).rejects.toMatchObject({ code: "SERVER_ERROR", details: { retryAfterSeconds: 600 } });
    expect((await polite.get("https://c.example.com/1")).status).toBe(200);
    expect(inner.get).toHaveBeenCalledTimes(3);
  });

  it("treats a rate limit, an access refusal, a server error or any Retry-After as a reason to stop", () => {
    expect(isStopError(new AdapterError("SERVER_ERROR", "x"))).toBe(true);
    expect(isStopError(new AdapterError("RATE_LIMITED", "x"))).toBe(true);
    expect(isStopError(new AdapterError("ACCESS_DENIED", "x"))).toBe(true);
    expect(isStopError(new AdapterError("HTTP_STATUS", "x", { retryAfterSeconds: 5 }))).toBe(true);
    expect(isStopError(new AdapterError("HTTP_STATUS", "x"))).toBe(false);
    expect(isStopError(new AdapterError("NETWORK", "x"))).toBe(false);
    expect(isStopError(new Error("x"))).toBe(false);
  });
});

const sourceId = "5b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e";
const runId = "7c1d4e2f-8b3a-4d66-ae8f-2a3b4c5d6e7f";

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
    scheduleMinutes: S,
    lastRunAt: null,
    nextEligibleAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function runRecord(overrides: Partial<RetrievalRunRecord> = {}): RetrievalRunRecord {
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
    ...overrides,
  };
}

describe("the worker hands the source's Retry-After to the store", () => {
  async function runWith(responses: Parameters<typeof createFixtureTransport>[0]) {
    const finished: Array<Parameters<RetrievalRunStore["finishRun"]>[1]> = [];
    const store: RetrievalRunStore = {
      enqueueDueRuns: vi.fn(async () => 0),
      claimNextRun: vi.fn(async () => ({ run: runRecord(), source: sourceRecord() })),
      finishRun: vi.fn(async (_id, input) => {
        finished.push(input);
        return runRecord({ status: input.status });
      }),
      failInterruptedRuns: vi.fn(async () => 0),
    };
    const worker = createRetrievalWorker({
      store,
      ingestion: { ingest: async () => ({ outcome: "CREATED", opportunityId: "o", sourceRecordId: "s", decision: "NO_MATCH" }) },
      registry: createAdapterRegistry([createTestAdapter()]),
      transport: () => createFixtureTransport(responses),
      discovery: customerSuccessDiscoveryConfiguration,
      env: () => ({}),
      now: () => now,
      log: { info: vi.fn(), warn: vi.fn() },
    });
    await worker.runOnce();
    return finished[0]!;
  }
  const firstPage = testBoardUrl("test-board", "acme", 1);

  it("passes a 429's Retry-After and a server error's safe message", async () => {
    expect(await runWith({ [firstPage]: { status: 429, contentType: "application/json", body: "{}", retryAfterSeconds: 3600 } })).toMatchObject({
      status: "FAILED",
      errorCode: "RATE_LIMITED",
      retryAfterSeconds: 3600,
    });
    const serverError = await runWith({ [firstPage]: { status: 502, contentType: "text/html", body: "" } });
    expect(serverError).toMatchObject({ status: "FAILED", errorCode: "SERVER_ERROR", errorMessage: "The source had a server error; retrieval stopped." });
    expect(serverError.retryAfterSeconds).toBeUndefined();
  });
});

describe("Run now and the gate", () => {
  function store(overrides: Partial<RetrievalStore> = {}): RetrievalStore {
    return {
      list: vi.fn(async () => [{ ...sourceRecord(), latestRun: null }]),
      get: vi.fn(async () => sourceRecord()),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      listRuns: vi.fn(async () => []),
      enqueueRun: vi.fn(async () => ({ run: runRecord({ status: "QUEUED" }), alreadyActive: false })),
      healthInputs: vi.fn(async () => ({ runs: [], lastSuccess: null })),
      ...overrides,
    } as RetrievalStore;
  }
  const registry = createAdapterRegistry([createTestAdapter()]);

  it("refuses a rate-limited or provider-gated source with 409 and the date, whatever the override", async () => {
    for (const code of ["SOURCE_RATE_LIMITED", "SOURCE_PROVIDER_WAIT"] as const) {
      const gated = store({ enqueueRun: vi.fn(async () => Promise.reject(new RetrievalSourceError(code, "Not yet", at(90)))) });
      const service = createRetrievalService({ store: gated, registry, env: () => ({}), now: () => now });
      await expect(service.runNow(sourceId, { override: true })).rejects.toMatchObject({ code, status: 409, until: at(90) });
    }
  });

  it("passes an explicit override to the store for our own backoff, never by default", async () => {
    const plain = store();
    const service = createRetrievalService({ store: plain, registry, env: () => ({}), now: () => now });
    await service.runNow(sourceId);
    await service.runNow(sourceId, { override: true });
    expect(plain.enqueueRun).toHaveBeenNthCalledWith(1, sourceId, "MANUAL", { override: false, now });
    expect(plain.enqueueRun).toHaveBeenNthCalledWith(2, sourceId, "MANUAL", { override: true, now });
  });

  it("reads an optional override body in the API and returns the gate's date with a refusal", async () => {
    const gated = store({
      enqueueRun: vi.fn(async (_id: string, _trigger: string, options?: { override?: boolean }) =>
        options?.override ? { run: runRecord({ status: "QUEUED" }), alreadyActive: false } : Promise.reject(new RetrievalSourceError("SOURCE_BACKING_OFF", "Backing off", at(600))),
      ) as unknown as RetrievalStore["enqueueRun"],
    });
    const handlers = createRetrievalApiHandlers(createRetrievalService({ store: gated, registry, env: () => ({}), now: () => now }));
    const post = (body?: string) => new Request(`http://localhost/api/sources/${sourceId}/runs`, { method: "POST", ...(body === undefined ? {} : { body }) });
    const refused = await handlers.runNow(sourceId, post());
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "Backing off", code: "SOURCE_BACKING_OFF", until: at(600).toISOString() });
    expect((await handlers.runNow(sourceId, post(JSON.stringify({ override: true })))).status).toBe(202);
    expect((await handlers.runNow(sourceId, post("{bad"))).status).toBe(400);
    expect((await handlers.runNow(sourceId, post(JSON.stringify({ override: "yes" })))).status).toBe(400);
  });

  it("includes each source's derived health in its summary", async () => {
    const limited = runRecord({ status: "FAILED", errorCode: "RATE_LIMITED", finishedAt: at(-1) });
    const service = createRetrievalService({
      store: store({
        get: vi.fn(async () => sourceRecord({ lastRunAt: at(-2), nextEligibleAt: at(S) })),
        healthInputs: vi.fn(async () => ({ runs: [limited], lastSuccess: null })),
      }),
      registry,
      env: () => ({}),
      now: () => now,
    });
    expect((await service.get(sourceId)).health).toMatchObject({ status: "rate_limited", gate: { kind: "rate_limited", until: at(S) } });
  });
});

describe("pnpm app:doctor source health", () => {
  const environment = { DATABASE_URL: "postgresql://postgres:secret@localhost:5432/db", OPENAI_API_KEY: "sk-test" };
  const sourceHealth = (overrides: Partial<DoctorSourceHealthInputs> = {}): DoctorSourceHealthInputs => ({
    scheduleMinutes: S,
    lastRunAt: at(-10),
    nextEligibleAt: null,
    runs: [run()],
    lastSuccess: run(),
    ...overrides,
  });
  const reads = (enabledSources: Array<{ adapterKey: string; name: string; health?: DoctorSourceHealthInputs }>): DoctorReads => ({
    ping: async () => undefined,
    appliedMigrations: async () => [],
    activeCustomerSuccessProfile: async () => null,
    workerConnected: async () => false,
    queueSnapshot: async () => ({ pending: 0, oldestPendingAt: null, running: 0, expiredReclaimable: 0, expiredExhausted: 0 }),
    openDeferrals: async () => ({ open: 0, waitingForUsageLimits: 0, pinnedToOtherVersion: 0 }),
    companiesNeedingBackfill: async () => 0,
    retrieval: async () => ({ workerConnected: true, enabledSources, failedRunsLastDay: 0 }),
  });
  const doctor = async (enabledSources: Parameters<typeof reads>[0]) =>
    formatDoctorChecks(await runDoctorChecks({ environment, nodeVersion: "22.1.0", migrationFolders: [], prismaClientGenerated: true, reads: reads(enabledSources), now }));

  it("warns, read-only, about sources rate limited, waiting, failing, needing attention or stale", async () => {
    const text = await doctor([
      { adapterKey: "greenhouse", name: "Healthy board", health: sourceHealth() },
      { adapterKey: "greenhouse", name: "Limited", health: sourceHealth({ runs: [failed("RATE_LIMITED")], lastSuccess: null, nextEligibleAt: at(S) }) },
      { adapterKey: "greenhouse", name: "Waiting", health: sourceHealth({ runs: [failed("SERVER_ERROR", { retryAfterUntil: at(60) })], lastSuccess: null, nextEligibleAt: at(60) }) },
      { adapterKey: "greenhouse", name: "Refused", health: sourceHealth({ runs: [failed("ACCESS_DENIED")], lastSuccess: null, nextEligibleAt: at(24 * 60) }) },
      { adapterKey: "greenhouse", name: "Broken", health: sourceHealth({ runs: [failed("NETWORK"), failed("SERVER_ERROR")], lastSuccess: null }) },
      { adapterKey: "greenhouse", name: "Old", health: sourceHealth({ runs: [run({ finishedAt: at(-3 * S) })], lastSuccess: run({ finishedAt: at(-3 * S) }) }) },
    ]);
    expect(text).toContain("WARN  Retrieval source health: ");
    expect(text).toContain(`Limited (rate limited until ${at(S).toISOString().slice(0, 16).replace("T", " ")} UTC)`);
    expect(text).toContain("Waiting (the source asked to wait until 2026-10-18 13:00 UTC)");
    expect(text).toContain("Refused (needs attention (ACCESS_DENIED))");
    expect(text).toContain("Broken (failing (2 source failures in a row))");
    expect(text).toContain("Old (no successful retrieval for more than two schedule intervals)");
    expect(text).not.toContain("Healthy board (");
  });

  it("passes when every enabled source is healthy", async () => {
    expect(await doctor([{ adapterKey: "greenhouse", name: "Healthy board", health: sourceHealth() }])).toContain(
      "PASS  Retrieval source health: no enabled source needs attention",
    );
  });
});
