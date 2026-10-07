import { describe, expect, it, vi } from "vitest";
import {
  aiConfigurationStatus,
  describeConfigurationProblem,
} from "../../apps/web/src/server/ai-configuration";
import {
  formatDoctorChecks,
  runDoctorChecks,
  type DoctorReads,
} from "../../apps/web/src/server/doctor";
import {
  classifyWorkerError,
  formatWorkerError,
  sanitizeWorkerError,
} from "../../apps/web/src/server/worker-errors";
import {
  backoffDelay,
  runWorkerLoop,
  type WorkerLoopDependencies,
  type WorkerTaskOutcome,
} from "../../apps/web/src/server/worker-loop";

const prismaError = (code: string, cause?: Record<string, unknown>) =>
  Object.assign(new Error("Can't reach database server at db.internal:5432 password=hunter2"), {
    name: "PrismaClientKnownRequestError",
    code,
    meta: cause ? { driverAdapterError: { cause } } : undefined,
  });
const errnoError = (code: string) => Object.assign(new Error(`connect ${code} 10.0.0.5:5432`), { code });

describe("worker error classification", () => {
  it.each([
    ["Prisma P1001 (database not reachable)", prismaError("P1001", { kind: "DatabaseNotReachable", host: "db.internal", port: 5432 })],
    ["Prisma P1017 (connection closed)", prismaError("P1017")],
    ["Prisma P2024 (pool timeout)", prismaError("P2024")],
    ["Prisma P2034 (write conflict)", prismaError("P2034")],
    ["driver kind ConnectionClosed", prismaError("P2010", { kind: "ConnectionClosed" })],
    ["SQLSTATE 57P01 (admin shutdown)", prismaError("P2010", { kind: "postgres", code: "57P01" })],
    ["SQLSTATE class 08 (connection exception)", prismaError("P2010", { kind: "postgres", code: "08006" })],
    ["SQLSTATE 40P01 (deadlock)", prismaError("P2010", { kind: "postgres", code: "40P01" })],
    ["ECONNREFUSED", errnoError("ECONNREFUSED")],
    ["ECONNRESET", errnoError("ECONNRESET")],
    ["ETIMEDOUT", errnoError("ETIMEDOUT")],
    ["initialization error", Object.assign(new Error("init"), { name: "PrismaClientInitializationError" })],
  ])("%s is transient", (_name, error) => {
    expect(classifyWorkerError(error)).toBe("transient");
  });

  it.each([
    ["a plain Error (programming error)", new Error("Cannot read properties of undefined")],
    ["an invariant violation", Object.assign(new Error("Stage completion rejected"), { name: "InvariantError" })],
    ["an unknown Prisma request error", prismaError("P2025")],
    ["a constraint violation", prismaError("P2010", { kind: "postgres", code: "23514" })],
    ["a non-Error value", "boom"],
    ["undefined", undefined],
  ])("%s is fatal", (_name, error) => {
    expect(classifyWorkerError(error)).toBe("fatal");
  });

  it("logs only whitelisted fields, never messages, hosts or secrets", () => {
    const error = prismaError("P1001", { kind: "DatabaseNotReachable", host: "db.internal", port: 5432 });
    expect(sanitizeWorkerError(error)).toEqual({ name: "PrismaClientKnownRequestError", prismaCode: "P1001", kind: "DatabaseNotReachable" });
    const text = formatWorkerError(error);
    for (const secret of ["db.internal", "5432", "hunter2", "Can't reach"]) expect(text).not.toContain(secret);
    expect(formatWorkerError(Object.assign(new Error("sk-live-secret"), { name: "sk-live secret!" }))).toBe("name=Error");
    expect(formatWorkerError(errnoError("ECONNREFUSED"))).toBe("name=Error errno=ECONNREFUSED");
  });
});

function harness(steps: Array<WorkerTaskOutcome | null | Error>, options: Partial<WorkerLoopDependencies> = {}) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  let held = false;
  let index = 0;
  let inFlight = false;
  const dependencies: WorkerLoopDependencies = {
    async runOnce() {
      calls.push("runOnce");
      const step = steps[index++];
      if (step === undefined) {
        stop = true;
        return null;
      }
      if (step instanceof Error) throw step;
      inFlight = true;
      await Promise.resolve();
      inFlight = false;
      return step;
    },
    async recover() {
      calls.push(inFlight ? "recover-while-busy" : "recover");
      return 0;
    },
    async sweep() {
      calls.push("sweep");
      return 0;
    },
    lock: {
      isHeld: () => held,
      async acquire() {
        calls.push("acquire");
        held = true;
        return true;
      },
    },
    async sleep(ms) {
      sleeps.push(ms);
    },
    now: () => 0,
    log: {
      info: (message) => logs.push(`info ${message}`),
      warn: (message) => logs.push(`warn ${message}`),
      error: (message) => logs.push(`error ${message}`),
    },
    shouldStop: () => stop,
    pollMs: 1000,
    ...options,
  };
  let stop = false;
  return { dependencies, calls, sleeps, logs, setHeld: (value: boolean) => { held = value; } };
}

const task = (id: string): WorkerTaskOutcome => ({ id, evaluationId: `e-${id}`, status: "COMPLETED", errorCode: null });

describe("worker loop", () => {
  it("recovers from transient errors with doubling, capped backoff that resets after success", async () => {
    const transient = prismaError("P1001", { kind: "DatabaseNotReachable" });
    const { dependencies, sleeps, logs } = harness([transient, transient, task("a"), transient]);
    expect(await runWorkerLoop({ ...dependencies, maxBackoffMs: 3000 })).toBe(0);
    // 1000×2, then 1000×4 capped at 3000; success resets; next failure is 2000 again.
    expect(sleeps).toEqual([2000, 3000, 2000, 1000]);
    expect(logs.filter((line) => line.startsWith("warn transient"))).toHaveLength(3);
    expect(logs.join("\n")).toContain("task finished taskId=a");
    expect(backoffDelay(1000, 10)).toBe(30_000);
  });

  it("exits non-zero on a fatal error after exactly one attempt, without retrying", async () => {
    const { dependencies, calls, sleeps, logs } = harness([new Error("invariant broken"), task("never")]);
    expect(await runWorkerLoop(dependencies)).toBe(1);
    expect(calls.filter((call) => call === "runOnce")).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(logs.at(-1)).toMatch(/^error fatal error; exiting name=Error$/);
  });

  it("continues after evaluation failures, which runOnce persists as failed tasks", async () => {
    const failed = { id: "f", evaluationId: "e-f", status: "FAILED", errorCode: "PROVIDER_TIMEOUT" };
    const { dependencies, logs } = harness([failed, task("b")]);
    expect(await runWorkerLoop(dependencies)).toBe(0);
    expect(logs.join("\n")).toContain("status=FAILED errorCode=PROVIDER_TIMEOUT");
    expect(logs.join("\n")).toContain("taskId=b");
  });

  it("runs recovery at startup and when idle, never while a task is in flight", async () => {
    const { dependencies, calls } = harness([task("a"), null, task("b"), null]);
    await runWorkerLoop(dependencies);
    expect(calls).not.toContain("recover-while-busy");
    expect(calls.slice(0, 3)).toEqual(["acquire", "recover", "sweep"]);
    // Idle polls are followed by recovery; busy iterations are not.
    expect(calls.filter((call) => call === "recover").length).toBe(3);
  });

  it("never recovers without the lock", async () => {
    const { dependencies, calls, setHeld } = harness([null, null]);
    let first = true;
    const lock = {
      isHeld: () => !first,
      async acquire() {
        first = false;
        calls.push("acquire");
        return true;
      },
    };
    setHeld(false);
    await runWorkerLoop({ ...dependencies, lock: { ...lock, isHeld: () => false, acquire: lock.acquire } , shouldStop: (() => { let n = 0; return () => n++ > 3; })() });
    expect(calls).not.toContain("recover");
  });

  it("exits non-zero when another worker holds the lock", async () => {
    const { dependencies, calls } = harness([task("a")]);
    const code = await runWorkerLoop({ ...dependencies, lock: { isHeld: () => false, acquire: async () => false } });
    expect(code).toBe(1);
    expect(calls).not.toContain("runOnce");
  });

  it("re-acquires a lost lock as a transient condition, then continues", async () => {
    const { dependencies, calls, setHeld } = harness([null, task("a")]);
    const acquire = vi.fn(async () => {
      setHeld(true);
      return true;
    });
    let lostOnce = false;
    const recover = vi.fn(async () => {
      if (!lostOnce) {
        lostOnce = true;
        setHeld(false); // the lock connection dropped while idle
      }
      return 0;
    });
    await runWorkerLoop({ ...dependencies, lock: { ...dependencies.lock, acquire }, recover });
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(calls.filter((call) => call === "runOnce").length).toBeGreaterThanOrEqual(2);
  });

  it("--once processes at most one task after startup recovery", async () => {
    const { dependencies, calls } = harness([task("a"), task("b")]);
    expect(await runWorkerLoop({ ...dependencies, once: true })).toBe(0);
    expect(calls).toEqual(["acquire", "recover", "sweep", "runOnce"]);
  });

  it("stops gracefully when asked", async () => {
    const { dependencies } = harness([task("a")]);
    expect(await runWorkerLoop({ ...dependencies, shouldStop: () => true })).toBe(0);
  });
});

describe("AI configuration status", () => {
  const complete = {
    OPENAI_API_KEY: "sk-test-not-real-1234567890",
    AI_MODEL: "gpt-5.6-terra",
    AI_MAX_OUTPUT_TOKENS: "12000",
    AI_RETRY_LIMIT: "1",
    AI_CALL_BUDGET: "16",
    AI_REQUEST_TIMEOUT_MS: "120000",
    EVALUATION_JOB_MAX_ATTEMPTS: "3",
    EVALUATION_JOB_LEASE_SECONDS: "300",
    EVALUATION_WORKER_POLL_MS: "1000",
  };

  it("reports missing, placeholder, invalid and configured states by variable name only", () => {
    expect(aiConfigurationStatus({ ...complete, OPENAI_API_KEY: "" })).toEqual({ state: "missing", variables: ["OPENAI_API_KEY"] });
    expect(aiConfigurationStatus({ ...complete, OPENAI_API_KEY: "YOUR_OPENAI_API_KEY" })).toEqual({ state: "placeholder", variables: ["OPENAI_API_KEY"] });
    const invalid = aiConfigurationStatus({ ...complete, AI_CALL_BUDGET: "lots" });
    expect(invalid).toEqual({ state: "invalid", variables: ["AI_CALL_BUDGET"] });
    expect(aiConfigurationStatus(complete)).toEqual({ state: "configured", variables: [] });
  });

  it("never echoes values", () => {
    for (const status of [
      aiConfigurationStatus({ ...complete, OPENAI_API_KEY: "" }),
      aiConfigurationStatus({ ...complete, OPENAI_API_KEY: "YOUR_OPENAI_API_KEY" }),
      aiConfigurationStatus({ ...complete, AI_CALL_BUDGET: "lots" }),
      aiConfigurationStatus(complete),
    ]) {
      const text = `${JSON.stringify(status)} ${describeConfigurationProblem(status)}`;
      expect(text).not.toContain("sk-test-not-real");
      expect(text).not.toContain("lots");
    }
  });
});

describe("pnpm app:doctor checks", () => {
  const environment = {
    DATABASE_URL: "postgresql://postgres:secret-password@localhost:5432/db",
    OPENAI_API_KEY: "YOUR_OPENAI_API_KEY",
    EVALUATION_JOB_MAX_ATTEMPTS: "3",
    EVALUATION_JOB_LEASE_SECONDS: "300",
    EVALUATION_WORKER_POLL_MS: "1000",
  };
  const now = new Date("2026-10-07T12:00:00.000Z");
  const reads = (overrides: Partial<DoctorReads> = {}): DoctorReads => ({
    ping: async () => undefined,
    appliedMigrations: async () => [{ name: "001_init", finished: true }],
    hasActiveCustomerSuccessProfile: async () => false,
    workerConnected: async () => false,
    queueSnapshot: async () => ({
      pending: 2,
      oldestPendingAt: new Date(now.getTime() - 5 * 60_000),
      running: 1,
      expiredReclaimable: 0,
      expiredExhausted: 1,
    }),
    openDeferrals: async () => 1,
    ...overrides,
  });

  it("reports problems by name, advises without acting, and never prints values", async () => {
    const checks = await runDoctorChecks({
      environment,
      nodeVersion: "22.1.0",
      migrationFolders: ["001_init", "002_next"],
      prismaClientGenerated: true,
      reads: reads(),
      now,
    });
    const text = formatDoctorChecks(checks);
    expect(text).toContain("FAIL  Migrations: 1 not applied (002_next); run pnpm db:migrate");
    expect(text).toContain("WARN  AI evaluation configuration: OPENAI_API_KEY still has the example placeholder value");
    expect(text).toContain("WARN  Active profile");
    expect(text).toContain("Queue: 2 queued (oldest waiting 5 min), 1 running");
    expect(text).toMatch(/Stale evaluations: 1 evaluation\(s\) exceeded their worker lease .* does not prove the worker stopped/);
    expect(text).toContain("it recovers them on startup");
    for (const secret of ["secret-password", "YOUR_OPENAI_API_KEY", "localhost:5432"]) expect(text).not.toContain(secret);
  });

  it("stops at an unreachable database and fails missing basics", async () => {
    const checks = await runDoctorChecks({
      environment: { ...environment, DATABASE_URL: undefined },
      nodeVersion: "18.20.0",
      migrationFolders: [],
      prismaClientGenerated: false,
      reads: reads(),
      now,
    });
    expect(checks.filter((check) => check.level === "FAIL").map((check) => check.label)).toEqual(["Node.js", "DATABASE_URL", "Prisma client"]);
    const unreachable = await runDoctorChecks({
      environment, nodeVersion: "22.1.0", migrationFolders: [], prismaClientGenerated: true, now,
      reads: reads({ ping: async () => { throw new Error("down"); } }),
    });
    expect(unreachable.at(-1)).toMatchObject({ level: "FAIL", label: "Database" });
  });
});
