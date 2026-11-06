// The Mode B acquisition pass under database failures (Workstream B,
// November 5, 2026). The live LinkedIn round ended with the retrieval worker
// exiting on a Prisma P2028 after 5 of 25 jobs: one job's failure ended the
// pass, P2028 was classed fatal, and the log did not say which P2028 it was.
// Offline: fakes for the repository, the browser and the ingestion.
import { describe, expect, it, vi } from "vitest";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { PageCaptureItemRecord } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createPageCaptureAcquisition, pageCaptureRetryAfterMs } from "../../apps/web/src/server/page-capture-acquisition";
import { classifyJobDatabaseFailure, classifyRetrievalWorkerError, classifyWorkerError, formatWorkerError, sanitizeWorkerError } from "../../apps/web/src/server/worker-errors";
import { testSiteJobPage } from "../support/page-capture-pages";

const now = new Date("2026-11-05T15:00:00.000Z");
const prismaError = (code: string, message = "Something private: host db.internal password=hunter2", cause?: Record<string, unknown>) =>
  Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code, meta: cause ? { driverAdapterError: { cause } } : undefined });
const expired = () =>
  prismaError("P2028", "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 30000 ms, however 31234 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.");
const startTimeout = () => prismaError("P2028", "Transaction API error: Unable to start a transaction in the given time.");
const lockBusy = () => prismaError("P2010", "lock timeout", { kind: "postgres", code: "55P03" });
const connectionLost = () => prismaError("P1017", "Server has closed the connection.");
const tooLong = () => prismaError("P2000", "The provided value for the column is too long");

describe("database failure classification", () => {
  it("treats a P2028 or a capture-lock timeout as transient for the retrieval worker only, and logs only which fixed P2028 form it was", () => {
    expect(classifyRetrievalWorkerError(expired())).toBe("transient");
    expect(classifyRetrievalWorkerError(startTimeout())).toBe("transient");
    expect(classifyRetrievalWorkerError(lockBusy())).toBe("transient");
    // The evaluation worker's classification is unchanged from 144fa6c: a
    // P2028 or a 55P03 still stops it, as before.
    expect(classifyWorkerError(expired())).toBe("fatal");
    expect(classifyWorkerError(startTimeout())).toBe("fatal");
    expect(classifyWorkerError(lockBusy())).toBe("fatal");
    // Both still agree on everything else.
    expect(classifyWorkerError(connectionLost())).toBe("transient");
    expect(classifyRetrievalWorkerError(connectionLost())).toBe("transient");
    expect(classifyRetrievalWorkerError(tooLong())).toBe("fatal");
    expect(sanitizeWorkerError(Object.assign(expired(), { captureTransaction: "ingestRetrievedListing" }))).toEqual({
      name: "PrismaClientKnownRequestError",
      prismaCode: "P2028",
      transactionError: "expired",
      timeoutMs: "30000",
      elapsedMs: "31234",
      transaction: "ingestRetrievedListing",
    });
    expect(sanitizeWorkerError(startTimeout())).toMatchObject({ prismaCode: "P2028", transactionError: "start-timeout" });
    const text = formatWorkerError(Object.assign(prismaError("P2028", "expired transaction. The timeout for this transaction was 5000 ms, however 7000 ms passed password=hunter2"), {}));
    expect(text).not.toContain("hunter2");
    expect(text).toContain("transactionError=expired timeoutMs=5000 elapsedMs=7000");
    // No other message text is ever read.
    expect(formatWorkerError(prismaError("P1001"))).not.toContain("db.internal");
  });

  it("separates lock contention, a transient database failure, the job's own refused data and a programming error", () => {
    expect(classifyJobDatabaseFailure(lockBusy())).toBe("CONTENTION");
    expect(classifyJobDatabaseFailure(prismaError("P2034"))).toBe("CONTENTION");
    expect(classifyJobDatabaseFailure(prismaError("P2010", "deadlock", { kind: "postgres", code: "40P01" }))).toBe("CONTENTION");
    expect(classifyJobDatabaseFailure(expired())).toBe("TRANSIENT");
    expect(classifyJobDatabaseFailure(startTimeout())).toBe("TRANSIENT");
    expect(classifyJobDatabaseFailure(connectionLost())).toBe("TRANSIENT");
    expect(classifyJobDatabaseFailure(tooLong())).toBe("PERMANENT");
    expect(classifyJobDatabaseFailure(Object.assign(new Error("x"), { name: "PrismaClientValidationError" }))).toBe("PERMANENT");
    expect(classifyJobDatabaseFailure(new TypeError("Cannot read properties of undefined"))).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------- the pass

const item = (id: string, overrides: Partial<PageCaptureItemRecord> = {}): PageCaptureItemRecord => ({
  id,
  site: "e2e-results",
  host: "jobs.e2e.invalid",
  externalId: `e2e:${id}`,
  sourceUrl: `https://jobs.e2e.invalid/jobs/${id}`,
  siteJobId: id,
  title: `Customer Success Manager ${id}`,
  company: null,
  location: null,
  postedText: null,
  resultsPageUrl: "https://jobs.e2e.invalid/search",
  firstSeenAt: now,
  lastSeenAt: now,
  sightings: 1,
  lastBatchId: "b",
  pairingId: "p",
  status: "ACQUIRING",
  attempts: 0,
  lastAttemptAt: now,
  nextAttemptAt: null,
  lastReason: null,
  opportunityId: null,
  handoffOutcome: null,
  handedOffAt: null,
  createdAt: now,
  updatedAt: now,
});

// A small in-memory queue that applies the repository's real state rules, so
// the tests read final states, not calls.
const refreshMarker = /^REFRESH:(\d+)$/;
function setup(input: { ids: string[]; ingest: (id: string) => Error | null; probe?: () => Error | null; failWrites?: (method: string, id: string) => boolean }) {
  const rows = new Map(input.ids.map((id) => [id, item(id)]));
  const write = (method: string, id: string) => {
    if (input.failWrites?.(method, id)) throw connectionLost();
  };
  const repository = {
    recoverInterrupted: vi.fn(async () => {
      let count = 0;
      for (const row of rows.values()) if (row.status === "ACQUIRING") (row.status = "QUEUED"), (count += 1);
      return count;
    }),
    sitesWithQueued: vi.fn(async () => ([...rows.values()].some((row) => row.status === "QUEUED" && (!row.nextAttemptAt || row.nextAttemptAt <= now)) ? ["e2e-results"] : [])),
    siteStoppedUntil: vi.fn(async () => null),
    claimQueued: vi.fn(async () => {
      const due = [...rows.values()].filter((row) => row.status === "QUEUED" && (!row.nextAttemptAt || row.nextAttemptAt <= now));
      for (const row of due) row.status = "ACQUIRING";
      return due.map((row) => ({ ...row }));
    }),
    markIngested: vi.fn(async (id: string, opportunityId: string, _at: Date, refresh?: { outcome: string }) => {
      write("markIngested", id);
      const row = rows.get(id)!;
      if (refreshMarker.test(row.lastReason ?? "")) {
        Object.assign(row, { status: "INGESTED", opportunityId, lastReason: `REFRESHED:${refresh?.outcome ?? "READ"}:0`, nextAttemptAt: null });
        return;
      }
      Object.assign(row, { status: "INGESTED", opportunityId, lastReason: null, nextAttemptAt: null, attempts: row.attempts + 1 });
    }),
    markFailed: vi.fn(async (id: string, change: { status: PageCaptureItemRecord["status"]; reason: string; nextAttemptAt: Date | null; countAttempt: boolean }) => {
      write("markFailed", id);
      const row = rows.get(id)!;
      Object.assign(row, { status: change.status, lastReason: change.reason, nextAttemptAt: change.nextAttemptAt, attempts: row.attempts + (change.countAttempt ? 1 : 0) });
    }),
    deferSite: vi.fn(async () => undefined),
    markHandedOff: vi.fn(async (id: string, outcome: string) => {
      write("markHandedOff", id);
      rows.get(id)!.handoffOutcome = outcome;
    }),
    requeueUncounted: vi.fn(async (id: string, reason: string) => {
      write("requeueUncounted", id);
      const row = rows.get(id)!;
      if (row.status !== "ACQUIRING" && row.status !== "QUEUED") return false;
      Object.assign(row, { status: "QUEUED", nextAttemptAt: null, lastReason: refreshMarker.test(row.lastReason ?? "") ? row.lastReason : reason });
      return true;
    }),
    releaseClaimed: vi.fn(async (ids: string[]) => {
      write("releaseClaimed", ids[0] ?? "");
      let count = 0;
      for (const id of ids) if (rows.get(id)?.status === "ACQUIRING") (rows.get(id)!.status = "QUEUED"), (count += 1);
      return count;
    }),
    finalizeProvisionalFailure: vi.fn(async (id: string, options: { now: Date; retryAfterMs: number; maxAttempts: number }) => {
      write("finalizeProvisionalFailure", id);
      const row = rows.get(id)!;
      const refresh = refreshMarker.exec(row.lastReason ?? "");
      if (row.status === "QUEUED" && refresh) {
        Object.assign(row, { status: "INGESTED", lastReason: `REFRESH_FAILED:${refresh[1]}`, nextAttemptAt: null });
        return true;
      }
      if (row.status !== "QUEUED" || row.lastReason !== "DB_PENDING") return false;
      const attempts = row.attempts + 1;
      const final = attempts >= options.maxAttempts;
      Object.assign(row, { attempts, status: final ? "AWAITING_DETAILS" : "QUEUED", lastReason: final ? "FAILED_REPEATEDLY" : "INGEST_DB_ERROR", nextAttemptAt: final ? null : new Date(options.now.getTime() + options.retryAfterMs) });
      return true;
    }),
  };
  let opportunities = 0;
  const ingested: string[] = [];
  const ingest = vi.fn(async (raw: { externalId: string | null }) => {
    const id = raw.externalId!.split("/").pop()!;
    const error = input.ingest(id);
    if (error) throw error;
    ingested.push(id);
    opportunities += 1;
    return { outcome: "CREATED" as const, opportunityId: `0000000${opportunities}-0000-4000-8000-000000000000`, sourceRecordId: "s", decision: "NO_MATCH" as const };
  });
  const driver: BrowserDriver = {
    async navigate(url) {
      const id = url.split("/").pop()!;
      return { status: 200, finalUrl: url, html: testSiteJobPage({ id }), cookieNames: [] };
    },
    close: vi.fn(async () => undefined),
  };
  const probe = vi.fn(async () => {
    const error = input.probe?.() ?? null;
    if (error) throw error;
  });
  const handoff = { alreadyHandled: vi.fn(async () => false), request: vi.fn(async (_opportunityId: string) => "NEEDS_REVIEW") };
  const logged: string[] = [];
  const acquisition = createPageCaptureAcquisition({
    repository,
    ingestion: { ingest } as never,
    handoff,
    log: { info: (message) => logged.push(message), warn: (message) => logged.push(message) },
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => ["e2e-results"],
    browser: { launch: async () => driver },
    probeCapture: probe,
    now: () => now,
    sleep: async () => undefined,
  });
  return { acquisition, rows, repository, ingested, probe, handoff, logged };
}

const state = (rows: Map<string, PageCaptureItemRecord>, id: string) => {
  const row = rows.get(id)!;
  return { status: row.status, attempts: row.attempts, lastReason: row.lastReason };
};

describe("one job's database failure in a pass", () => {
  it("localized: a transient failure followed by a successful ingestion is that job's own, counted once; the pass continues", async () => {
    const ids = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];
    const { acquisition, rows, repository, ingested } = setup({ ids, ingest: (id) => (id === "a6" ? expired() : null) });
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ claimed: 7, ingested: 6, stopped: null });
    expect(ingested).toEqual(["a1", "a2", "a3", "a4", "a5", "a7"]);
    expect(state(rows, "a6")).toEqual({ status: "QUEUED", attempts: 1, lastReason: "INGEST_DB_ERROR" });
    expect(rows.get("a6")!.nextAttemptAt).toEqual(new Date(now.getTime() + pageCaptureRetryAfterMs));
    // Finalization is conditional: a second call changes nothing.
    expect(await repository.finalizeProvisionalFailure("a6", { now, retryAfterMs: pageCaptureRetryAfterMs, maxAttempts: 3 })).toBe(false);
    expect(rows.get("a6")!.attempts).toBe(1);
  });

  it("broader: two transient failures in a row mean the database, not the jobs; nothing is counted and the pass ends", async () => {
    const ids = ["b1", "b2", "b3", "b4", "b5"];
    let down = false;
    let outageOver = false;
    const { acquisition, rows } = setup({
      ids,
      ingest: (id) => {
        if (id === "b2" && !outageOver) down = true;
        return down ? connectionLost() : null;
      },
    });
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ ingested: 1, stopped: "DATABASE_UNAVAILABLE" });
    for (const id of ["b2", "b3"]) expect(state(rows, id)).toEqual({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
    for (const id of ["b4", "b5"]) expect(state(rows, id)).toEqual({ status: "QUEUED", attempts: 0, lastReason: null });
    // When the database is back, the next pass reads them all; no attempt was spent.
    down = false;
    outageOver = true;
    const next = await acquisition.runOnce();
    expect(next).toMatchObject({ claimed: 4, ingested: 4, stopped: null });
    for (const id of ["b2", "b3", "b4", "b5"]) expect(state(rows, id)).toEqual({ status: "INGESTED", attempts: 1, lastReason: null });
  });

  it("the last job: a lock probe decides — healthy counts it, unhealthy leaves it uncounted", async () => {
    const healthy = setup({ ids: ["c1", "c2"], ingest: (id) => (id === "c2" ? startTimeout() : null) });
    await healthy.acquisition.runOnce();
    expect(healthy.probe).toHaveBeenCalledTimes(1);
    expect(state(healthy.rows, "c2")).toEqual({ status: "QUEUED", attempts: 1, lastReason: "INGEST_DB_ERROR" });

    const unhealthy = setup({ ids: ["d1", "d2"], ingest: (id) => (id === "d2" ? startTimeout() : null), probe: () => connectionLost() });
    const pass = await unhealthy.acquisition.runOnce();
    expect(pass?.stopped).toBe("DATABASE_UNAVAILABLE");
    expect(state(unhealthy.rows, "d2")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
  });

  it("a busy capture lock is contention, not a failure: the job is queued uncounted and the pass ends", async () => {
    const { acquisition, rows } = setup({ ids: ["e1", "e2", "e3"], ingest: (id) => (id === "e2" ? lockBusy() : null) });
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ ingested: 1, stopped: "CAPTURE_BUSY" });
    expect(state(rows, "e2")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "CAPTURE_BUSY" });
    expect(state(rows, "e3")).toEqual({ status: "QUEUED", attempts: 0, lastReason: null });
    // A probe that finds the lock busy is contention too.
    const busy = setup({ ids: ["f1"], ingest: () => startTimeout(), probe: () => lockBusy() });
    expect((await busy.acquisition.runOnce())?.stopped).toBe("CAPTURE_BUSY");
    expect(state(busy.rows, "f1")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
  });

  it("a job whose own data is refused is counted, and the pass continues; three such passes end automatic work", async () => {
    const { acquisition, rows } = setup({ ids: ["g1", "g2"], ingest: (id) => (id === "g1" ? tooLong() : null) });
    expect(await acquisition.runOnce()).toMatchObject({ ingested: 1, stopped: null });
    expect(state(rows, "g1")).toEqual({ status: "QUEUED", attempts: 1, lastReason: "NOT_INGESTED" });
    const repeated = setup({ ids: ["h1"], ingest: () => tooLong() });
    repeated.rows.get("h1")!.attempts = 2;
    await repeated.acquisition.runOnce();
    expect(state(repeated.rows, "h1")).toEqual({ status: "AWAITING_DETAILS", attempts: 3, lastReason: "FAILED_REPEATEDLY" });
  });

  it("when even marking the job fails (database down), the claimed jobs are left to interrupted-job recovery: none lost, none charged", async () => {
    let databaseDown = false;
    let outageOver = false;
    const { acquisition, rows, repository } = setup({
      ids: ["k1", "k2", "k3"],
      ingest: (id) => {
        if (id === "k2" && !outageOver) databaseDown = true;
        return databaseDown ? connectionLost() : null;
      },
      failWrites: () => databaseDown,
    });
    const pass = await acquisition.runOnce();
    expect(pass?.stopped).toBe("DATABASE_UNAVAILABLE");
    // Neither the mark nor the release could be written: still ACQUIRING.
    expect(state(rows, "k2")).toEqual({ status: "ACQUIRING", attempts: 0, lastReason: null });
    expect(state(rows, "k3")).toEqual({ status: "ACQUIRING", attempts: 0, lastReason: null });
    // The next pass re-runs the recovery (ACQUIRING → QUEUED, uncounted) before claiming.
    databaseDown = false;
    outageOver = true;
    const recoveriesBefore = repository.recoverInterrupted.mock.calls.length;
    const next = await acquisition.runOnce();
    expect(repository.recoverInterrupted.mock.calls.length).toBe(recoveriesBefore + 1);
    expect(next).toMatchObject({ claimed: 2, ingested: 2 });
    expect(state(rows, "k2")).toEqual({ status: "INGESTED", attempts: 1, lastReason: null });
    expect(state(rows, "k3")).toEqual({ status: "INGESTED", attempts: 1, lastReason: null });
  });

  it("a crash between a provisional failure and its decision leaves the job uncounted; a restart reads every job once", async () => {
    // Simulates the process dying right after k2 was marked DB_PENDING: the
    // pass throws an unknown error on the next job.
    const first = setup({ ids: ["m1", "m2", "m3"], ingest: (id) => (id === "m2" ? expired() : id === "m3" ? new TypeError("process died") : null) });
    await expect(first.acquisition.runOnce()).rejects.toThrow("process died");
    expect(state(first.rows, "m2")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
    expect(state(first.rows, "m3")).toEqual({ status: "QUEUED", attempts: 0, lastReason: null });
    // A new worker over the same rows: recovery, then every remaining job once.
    const restarted = setup({ ids: [], ingest: () => null });
    for (const [id, row] of first.rows) restarted.rows.set(id, row);
    const pass = await restarted.acquisition.runOnce();
    expect(pass).toMatchObject({ claimed: 2, ingested: 2 });
    expect(restarted.ingested).toEqual(["m2", "m3"]);
    expect(state(restarted.rows, "m2")).toEqual({ status: "INGESTED", attempts: 1, lastReason: null });
  });

  it("an unknown error still ends the pass, but never leaves a claimed job reading", async () => {
    const { acquisition, rows } = setup({ ids: ["n1", "n2"], ingest: (id) => (id === "n1" ? new TypeError("bug") : null) });
    await expect(acquisition.runOnce()).rejects.toThrow("bug");
    expect(rows.get("n1")!.status).toBe("QUEUED");
    expect(rows.get("n2")!.status).toBe("QUEUED");
  });
});

describe("a saved job read again, and a job saved before a later step failed", () => {
  const asRefresh = (rows: Map<string, PageCaptureItemRecord>, id: string) =>
    Object.assign(rows.get(id)!, { lastReason: "REFRESH:0", opportunityId: "11111111-0000-4000-8000-000000000000", handoffOutcome: "NEEDS_REVIEW" });

  it("a refresh's transient failure proven its own ends that refresh, the saved job untouched; nothing is counted, nothing handed off", async () => {
    const { acquisition, rows, handoff } = setup({ ids: ["r1", "r2"], ingest: (id) => (id === "r1" ? expired() : null) });
    asRefresh(rows, "r1");
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ ingested: 1, stopped: null });
    expect(state(rows, "r1")).toEqual({ status: "INGESTED", attempts: 0, lastReason: "REFRESH_FAILED:0" });
    expect(rows.get("r1")!.opportunityId).toBe("11111111-0000-4000-8000-000000000000");
    expect(handoff.request).toHaveBeenCalledTimes(1); // r2 only
  });

  it("a refresh caught in a database outage stays a refresh, uncounted, and is read again (as a refresh) once the database is back", async () => {
    let down = true;
    const { acquisition, rows, handoff } = setup({ ids: ["s1", "s2", "s3"], ingest: (id) => (down && (id === "s1" || id === "s2") ? connectionLost() : null) });
    asRefresh(rows, "s1");
    const pass = await acquisition.runOnce();
    expect(pass?.stopped).toBe("DATABASE_UNAVAILABLE");
    expect(state(rows, "s1")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "REFRESH:0" });
    expect(state(rows, "s2")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
    down = false;
    await acquisition.runOnce();
    expect(state(rows, "s1")).toEqual({ status: "INGESTED", attempts: 0, lastReason: "REFRESHED:CREATED:0" });
    // The refresh is never handed off; s2 and s3 once each.
    expect(handoff.request.mock.calls.map(([id]) => id)).not.toContain("11111111-0000-4000-8000-000000000000");
    expect(handoff.request).toHaveBeenCalledTimes(2);
  });

  it("a busy capture lock during a refresh keeps it a refresh, uncounted", async () => {
    const { acquisition, rows } = setup({ ids: ["t1"], ingest: () => lockBusy() });
    asRefresh(rows, "t1");
    expect((await acquisition.runOnce())?.stopped).toBe("CAPTURE_BUSY");
    expect(state(rows, "t1")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "REFRESH:0" });
  });

  it("a job saved whose item could not be marked is never charged: requeued uncounted, read again onto the saved job, handed off once", async () => {
    let failedOnce = false;
    const { acquisition, rows, ingested, handoff, logged } = setup({
      ids: ["u1", "u2"],
      ingest: () => null,
      failWrites: (method, id) => {
        if (method === "markIngested" && id === "u1" && !failedOnce) return (failedOnce = true);
        return false;
      },
    });
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ ingested: 2, stopped: null });
    expect(state(rows, "u1")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "SAVED_UNMARKED" });
    expect(handoff.request).toHaveBeenCalledTimes(1); // u2; u1 was not handed off yet
    expect(logged.some((line) => /job u1 saved as .*stage=mark failure=TRANSIENT/.test(line))).toBe(true);
    await acquisition.runOnce();
    expect(ingested.filter((id) => id === "u1")).toHaveLength(2);
    expect(state(rows, "u1")).toEqual({ status: "INGESTED", attempts: 1, lastReason: null });
    expect(handoff.request).toHaveBeenCalledTimes(2);
  });

  it("a job saved and marked whose hand-off could not be recorded stays added; it is neither re-read nor counted", async () => {
    const { acquisition, rows, ingested, logged } = setup({
      ids: ["v1", "v2"],
      ingest: () => null,
      failWrites: (method, id) => method === "markHandedOff" && id === "v1",
    });
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ ingested: 2, stopped: null });
    expect(state(rows, "v1")).toEqual({ status: "INGESTED", attempts: 1, lastReason: null });
    expect(logged.some((line) => /job v1 saved as .*stage=handoff/.test(line))).toBe(true);
    expect(await acquisition.runOnce()).toBeNull();
    expect(ingested.filter((id) => id === "v1")).toHaveLength(1);
  });

  it("a saved job's failed mark followed by a second database failure ends the pass with nothing counted", async () => {
    let down = false;
    const { acquisition, rows } = setup({
      ids: ["w1", "w2", "w3"],
      ingest: (id) => (id === "w2" && down ? connectionLost() : null),
      failWrites: (method, id) => {
        if (method === "markIngested" && id === "w1") return (down = true);
        return false;
      },
    });
    expect((await acquisition.runOnce())?.stopped).toBe("DATABASE_UNAVAILABLE");
    expect(state(rows, "w1")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "SAVED_UNMARKED" });
    expect(state(rows, "w2")).toEqual({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
    expect(state(rows, "w3")).toEqual({ status: "QUEUED", attempts: 0, lastReason: null });
  });

  it("names the stage of each failure in the log", async () => {
    const { acquisition, logged } = setup({ ids: ["x1", "x2"], ingest: (id) => (id === "x1" ? tooLong() : null) });
    await acquisition.runOnce();
    expect(logged.some((line) => /job x1 stage=ingest failure=PERMANENT/.test(line))).toBe(true);
  });
});

