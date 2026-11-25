import { describe, expect, it, vi } from "vitest";
import {
  aiConfigurationStatus,
  describeConfigurationProblem,
} from "../../apps/web/src/server/ai-configuration";
import { customerSuccessProductionSemanticPolicyVersion } from "@ai-career/shared";
import {
  compareGeneratedClientSchema,
  formatDoctorChecks,
  generatedClientMatchesSchema,
  schemaLayoutKey,
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
    // Unchanged for the evaluation worker (November 6, 2026): only the
    // retrieval worker retries these (classifyRetrievalWorkerError).
    ["a P2028 transaction timeout", prismaError("P2028")],
    ["a lock timeout (SQLSTATE 55P03)", prismaError("P2010", { kind: "postgres", code: "55P03" })],
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
    activeCustomerSuccessProfile: async () => null,
    workerConnected: async () => false,
    queueSnapshot: async () => ({
      pending: 2,
      oldestPendingAt: new Date(now.getTime() - 5 * 60_000),
      running: 1,
      expiredReclaimable: 0,
      expiredExhausted: 1,
    }),
    openDeferrals: async () => ({ open: 1, waitingForUsageLimits: 0, pinnedToOtherVersion: 0 }),
    companiesNeedingBackfill: async () => 0,
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

  it("names the database it reached, never the user or password, and counts paired browsers (feature 14B)", async () => {
    const run = async (overrides: Partial<DoctorReads>) =>
      formatDoctorChecks(await runDoctorChecks({
        environment, nodeVersion: "22.1.0", migrationFolders: ["001_init"], prismaClientGenerated: true,
        reads: reads(overrides), now,
      }));
    const text = await run({ databaseName: async () => "ai_career_assistant_acceptance", activeExtensionPairings: async () => 0 });
    expect(text).toContain("PASS  Database: reachable: database ai_career_assistant_acceptance on localhost:5432");
    expect(text).toContain("PASS  Browser extension: no browser paired (optional; pair one on /extension)");
    expect(text).not.toContain("secret-password");
    expect(text).not.toContain("postgres:");
    expect(await run({ activeExtensionPairings: async () => 2 })).toContain("Browser extension: 2 browsers paired; manage pairings on /extension");
    expect(await run({ activeExtensionPairings: async () => Promise.reject(new Error("relation does not exist")) })).toContain(
      "WARN  Browser extension: paired browsers could not be read; run pnpm db:migrate",
    );
  });

  it("reports companies awaiting the deduplication backfill without running it", async () => {
    const run = async (count: number) =>
      formatDoctorChecks(await runDoctorChecks({
        environment, nodeVersion: "22.1.0", migrationFolders: ["001_init"], prismaClientGenerated: true,
        reads: reads({ companiesNeedingBackfill: async () => count }), now,
      }));
    expect(await run(0)).toContain("PASS  Company names: normalized");
    const pending = await run(3);
    expect(pending).toContain("WARN  Company names: 3 companies have no normalized name");
    expect(pending).toContain("Run pnpm db:backfill-dedup --dry-run, then pnpm db:backfill-dedup");
    expect(await run(1)).toContain("1 company has no normalized name");
  });

  it("reports the evaluator's built-in policy version and warns on a stale override", async () => {
    const run = (overrides: Record<string, string | undefined>) =>
      runDoctorChecks({ environment: { ...environment, ...overrides }, nodeVersion: "22.1.0", migrationFolders: [], prismaClientGenerated: true, reads: null, now });
    const policy = async (overrides: Record<string, string | undefined>) =>
      (await run(overrides)).find((check) => check.label === "Evaluation policy version");

    expect(await policy({})).toMatchObject({ level: "PASS", detail: expect.stringContaining(customerSuccessProductionSemanticPolicyVersion) });
    expect(await policy({ AI_EXECUTION_POLICY_VERSION: customerSuccessProductionSemanticPolicyVersion })).toMatchObject({ level: "PASS" });
    const stale = await policy({ AI_EXECUTION_POLICY_VERSION: "an-older-policy-label" });
    expect(stale).toMatchObject({ level: "WARN" });
    expect(stale?.detail).toContain("Remove it from .env");
  });

  it("shows the active version, whether it stores limitations, and deferrals pinned to another version", async () => {
    const checks = await runDoctorChecks({
      environment, nodeVersion: "22.1.0", migrationFolders: ["001_init"], prismaClientGenerated: true, now,
      reads: reads({
        activeCustomerSuccessProfile: async () => ({ version: 4, storesLimitations: true }),
        openDeferrals: async () => ({ open: 3, waitingForUsageLimits: 1, pinnedToOtherVersion: 2 }),
      }),
    });
    const text = formatDoctorChecks(checks);
    expect(text).toContain("PASS  Active profile: version 4 is active for Customer Success; it stores structured limitations");
    expect(text).toMatch(
      /WARN {2}Deferred evaluations: 3 waiting \(2 for the AI budget, 1 for usage limits\); 2 will run with a profile version other than the active one/,
    );
    expect(text).toContain("cancel and request again to use the active one");
  });

  it("separates deferrals waiting for the AI budget from those waiting for usage limits", async () => {
    const run = async (deferrals: { open: number; waitingForUsageLimits: number; pinnedToOtherVersion: number }) =>
      (await runDoctorChecks({
        environment, nodeVersion: "22.1.0", migrationFolders: ["001_init"], prismaClientGenerated: true, now,
        reads: reads({ openDeferrals: async () => deferrals }),
      })).find((check) => check.label === "Deferred evaluations");
    expect(await run({ open: 2, waitingForUsageLimits: 2, pinnedToOtherVersion: 0 })).toEqual({
      level: "PASS",
      label: "Deferred evaluations",
      detail: "2 waiting (0 for the AI budget, 2 for usage limits)",
    });
    expect(await run({ open: 0, waitingForUsageLimits: 0, pinnedToOtherVersion: 0 })).toMatchObject({
      level: "PASS",
      detail: "0 waiting (0 for the AI budget, 0 for usage limits)",
    });
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

  // November 25, 2026: a client generated before the checkout's latest
  // schema lacks the newer models ("Cannot read properties of undefined").
  it("fails a generated client that is out of date with schema.prisma", async () => {
    const schema = "generator client {\n  provider = \"prisma-client\"\n}\n\nmodel A {\n  id String @id\n}\n";
    const generated = (embedded: string) => `const config = {\n  "inlineSchema": ${JSON.stringify(embedded)},\n  "runtimeDataModel": {}\n}`;
    expect(generatedClientMatchesSchema(generated(schema), schema)).toBe(true);
    expect(generatedClientMatchesSchema(generated(schema), schema.replace(/\n/g, "\r\n"))).toBe(true);
    expect(generatedClientMatchesSchema(generated(schema), `${schema}\nmodel B {\n  id String @id\n}\n`)).toBe(false);
    expect(generatedClientMatchesSchema("no embedded schema", schema)).toBeNull();
    const checks = await runDoctorChecks({
      environment, nodeVersion: "22.1.0", migrationFolders: [], prismaClientGenerated: true, prismaClientCurrent: false, reads: null, now,
      prismaClientDifference: { line: 9, schema: "model B {", generated: "(end of file)" },
    });
    expect(checks.find((check) => check.label === "Prisma client")).toEqual({
      level: "FAIL", label: "Prisma client",
      detail: 'out of date with database/prisma/schema.prisma; run pnpm prisma:generate, then restart the app and workers (first difference at schema line 9: schema has "model B {", the generated client has "(end of file)")',
    });
  });

  // November 25, 2026: prisma generate embeds the schema column-aligned; a
  // source edited by hand without "prisma format" differs only in layout.
  it("accepts a client whose embedded schema differs only in Prisma's column alignment", () => {
    const source = [
      "model OpportunityUserAction {",
      "  id            String                    @id @default(uuid()) @db.Uuid",
      "  opportunityId String                    @db.Uuid",
      "  automaticReason AutomaticDismissalReason?",
      "\t// a comment   with  spacing",
      "}",
      "",
      "",
      "",
      "enum AutomaticDismissalReason {",
      "  TRIAGE_REJECT",
      "}   ",
    ].join("\n");
    const formatted = [
      "model OpportunityUserAction {",
      "  id              String                    @id @default(uuid()) @db.Uuid",
      "  opportunityId   String                    @db.Uuid",
      "  automaticReason AutomaticDismissalReason?",
      "  // a comment with spacing",
      "}",
      "",
      "enum AutomaticDismissalReason {",
      "  TRIAGE_REJECT",
      "}",
      "",
    ].join("\r\n");
    const generated = `const config = {\n  "inlineSchema": ${JSON.stringify(formatted)},\n}`;
    expect(compareGeneratedClientSchema(generated, source)).toEqual({ status: "CURRENT" });
    // Genuine differences are still found, with the line that differs.
    expect(compareGeneratedClientSchema(generated, source.replace("TRIAGE_REJECT", "TRIAGE_REJECT\n  OUTSIDE_TARGET_TITLES"))).toEqual({
      status: "STALE",
      firstDifference: { line: 12, schema: "OUTSIDE_TARGET_TITLES", generated: "}" },
    });
    expect(compareGeneratedClientSchema(generated, source.replace("String                    @db.Uuid", "String? @db.Uuid")).status).toBe("STALE");
    expect(compareGeneratedClientSchema(generated, source.replace("Uuid\n  automaticReason", "Uuid\n  automaticReasons")).status).toBe("STALE");
    expect(schemaLayoutKey("a  b\r\n\r\n\r\nc\t d  ")).toBe("a b\nc d");
  });

  // November 25, 2026 (review): the comparison is token-aware. Layout is
  // ignored; every semantic change, and any change inside a quoted value, is
  // still found.
  describe("token-aware schema comparison", () => {
    const schema = [
      "generator client {",
      '  provider = "prisma-client"',
      '  output   = "../generated/prisma"',
      "}",
      "",
      "datasource db {",
      '  provider = "postgresql"',
      "}",
      "",
      "model Company {",
      "  id            String        @id @default(uuid()) @db.Uuid",
      '  name          String        @map("company name")',
      "  opportunities Opportunity[]",
      "}",
      "",
      "model Opportunity {",
      "  id        String   @id @default(uuid()) @db.Uuid",
      "  companyId String   @db.Uuid",
      "  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)",
      "  status    Status   @default(NORMALIZED)",
      "  salaryMin Decimal? @db.Decimal(12, 2)",
      "",
      "  @@index([companyId])",
      '  @@map("opportunities")',
      "}",
      "",
      "enum Status {",
      "  NORMALIZED",
      "  SAVED",
      "}",
    ].join("\n");
    const client = (text: string) => `const config = {\n  "inlineSchema": ${JSON.stringify(text)},\n}`;
    const compare = (generatedText: string, source = schema) => compareGeneratedClientSchema(client(generatedText), source);

    it("accepts field alignment, CRLF and blank-line differences", () => {
      expect(compare(schema)).toEqual({ status: "CURRENT" });
      const realigned = schema
        .replace("id            String        @id", "id String @id")
        .replace("companyId String   @db.Uuid", "companyId\tString\t\t@db.Uuid")
        .replace('output   = "../generated/prisma"', 'output = "../generated/prisma"   ');
      expect(compare(realigned)).toEqual({ status: "CURRENT" });
      expect(compare(schema.replace(/\n/g, "\r\n"))).toEqual({ status: "CURRENT" });
      expect(compare(schema.replace(/\n\n/g, "\n").replace("enum Status {", "\n\n\nenum Status {") + "\n\n")).toEqual({ status: "CURRENT" });
    });

    it("finds every semantic change", () => {
      const changes: Array<[string, string, string]> = [
        ["model", "model Company {", "model Companies {"],
        ["field", "  salaryMin Decimal?", "  salaryMax Decimal?"],
        ["type", "salaryMin Decimal?", "salaryMin Float?"],
        ["optionality", "companyId String   @db.Uuid", "companyId String?  @db.Uuid"],
        ["attribute", "@@index([companyId])", "@@unique([companyId])"],
        ["native type", "@db.Decimal(12, 2)", "@db.Decimal(14, 2)"],
        ["relation", "onDelete: Cascade", "onDelete: Restrict"],
        ["enum value", "  SAVED", "  ARCHIVED"],
        ["default", "@default(NORMALIZED)", "@default(SAVED)"],
        ["model mapping", '@@map("opportunities")', '@@map("opportunity")'],
        ["datasource", 'provider = "postgresql"', 'provider = "mysql"'],
        ["generator", 'output   = "../generated/prisma"', 'output   = "../generated/client"'],
      ];
      for (const [label, from, to] of changes) {
        expect(schema.includes(from), label).toBe(true);
        const result = compare(schema.replace(from, to));
        expect(result.status, label).toBe("STALE");
      }
      // The message names the schema's own line.
      expect(compare(schema.replace("  SAVED", "  ARCHIVED"))).toEqual({
        status: "STALE",
        firstDifference: { line: 29, schema: "SAVED", generated: "ARCHIVED" },
      });
    });

    it("never ignores whitespace inside a quoted value", () => {
      for (const changed of ['@map("companyname")', '@map("company  name")', '@map(" company name")', '@map("company\tname")']) {
        expect(compare(schema.replace('@map("company name")', changed)).status, changed).toBe("STALE");
      }
      // An escaped quote stays inside the value.
      const escaped = schema.replace('@map("company name")', '@map("say \\"hi\\"  there")');
      expect(compare(escaped, escaped)).toEqual({ status: "CURRENT" });
      expect(compare(escaped.replace("hi\\\"  there", "hi\\\" there"), escaped).status).toBe("STALE");
      expect(schemaLayoutKey('  name   String   @map("a  b")   // note   here')).toBe('name String @map("a  b") // note here');
    });
  });
});
