import type { QueueSnapshot } from "@ai-career/database";
import { readEvaluationWorkerEnvironment, readServerEnvironment } from "@ai-career/shared";
import { ZodError } from "zod";
import { aiConfigurationStatus, describeConfigurationProblem } from "./ai-configuration";

// `pnpm app:doctor`: strictly read-only diagnostics. It only reads environment
// variables, files and the database (SELECT queries). It never writes,
// never runs recovery, and never prints values of variables.

export type CheckLevel = "PASS" | "WARN" | "FAIL";

export interface DoctorCheck {
  level: CheckLevel;
  label: string;
  detail: string;
}

// The only database access the doctor has: reads.
export interface DoctorReads {
  ping(): Promise<void>;
  appliedMigrations(): Promise<Array<{ name: string; finished: boolean }>>;
  hasActiveCustomerSuccessProfile(): Promise<boolean>;
  workerConnected(): Promise<boolean>;
  queueSnapshot(now: Date): Promise<QueueSnapshot>;
  openDeferrals(): Promise<number>;
}

export interface DoctorInputs {
  environment: NodeJS.ProcessEnv;
  nodeVersion: string;
  migrationFolders: string[];
  prismaClientGenerated: boolean;
  // Null when the database package could not be loaded.
  reads: DoctorReads | null;
  now: Date;
}

const variableNames = (error: unknown) =>
  error instanceof ZodError ? [...new Set(error.issues.map((issue) => String(issue.path[0])))].join(", ") : "unknown";

function nodeAtLeast(version: string, major: number, minor: number) {
  const [actualMajor = 0, actualMinor = 0] = version.split(".").map(Number);
  return actualMajor > major || (actualMajor === major && actualMinor >= minor);
}

function minutes(ms: number) {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`;
}

export async function runDoctorChecks(inputs: DoctorInputs): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (level: CheckLevel, label: string, detail: string) => checks.push({ level, label, detail });

  add(
    nodeAtLeast(inputs.nodeVersion, 20, 9) ? "PASS" : "FAIL",
    "Node.js",
    `version ${inputs.nodeVersion} (requires >= 20.9)`,
  );

  let databaseConfigured = true;
  try {
    readServerEnvironment(inputs.environment);
    add("PASS", "DATABASE_URL", "set");
  } catch (error) {
    databaseConfigured = false;
    add("FAIL", "DATABASE_URL", `missing or invalid (${variableNames(error)}); copy .env.example to .env and set it`);
  }

  add(
    inputs.prismaClientGenerated ? "PASS" : "FAIL",
    "Prisma client",
    inputs.prismaClientGenerated ? "generated" : "not generated; run pnpm prisma:generate",
  );

  const ai = aiConfigurationStatus(inputs.environment);
  add(
    ai.state === "configured" ? "PASS" : "WARN",
    "AI evaluation configuration",
    ai.state === "configured"
      ? "configured (real evaluations make paid provider calls)"
      : `${describeConfigurationProblem(ai)} The app runs, but evaluations cannot be requested.`,
  );

  try {
    readEvaluationWorkerEnvironment(inputs.environment);
    add("PASS", "Worker settings", "EVALUATION_JOB_* and EVALUATION_WORKER_POLL_MS are valid");
  } catch (error) {
    add("WARN", "Worker settings", `invalid: ${variableNames(error)}`);
  }

  const reads = inputs.reads;
  if (!databaseConfigured || !reads) return checks;

  try {
    await reads.ping();
    add("PASS", "Database", "reachable");
  } catch {
    add("FAIL", "Database", "not reachable; start PostgreSQL and check DATABASE_URL");
    return checks;
  }

  try {
    const applied = await reads.appliedMigrations();
    const finished = new Set(applied.filter((item) => item.finished).map((item) => item.name));
    const pending = inputs.migrationFolders.filter((name) => !finished.has(name));
    const unknown = [...finished].filter((name) => !inputs.migrationFolders.includes(name));
    if (pending.length) {
      add("FAIL", "Migrations", `${pending.length} not applied (${pending.join(", ")}); run pnpm db:migrate`);
    } else {
      add(unknown.length ? "WARN" : "PASS", "Migrations",
        `${finished.size} applied${unknown.length ? `; unknown to this checkout: ${unknown.join(", ")}` : ""}`);
    }
  } catch {
    add("FAIL", "Migrations", "none applied; run pnpm db:migrate");
    return checks;
  }

  const activeProfile = await reads.hasActiveCustomerSuccessProfile();
  add(
    activeProfile ? "PASS" : "WARN",
    "Active profile",
    activeProfile
      ? "an active Customer Success profile is set"
      : "none active; run pnpm profile:import:customer-success --activate or use the Profile page",
  );

  const connected = await reads.workerConnected();
  add(connected ? "PASS" : "WARN", "Evaluation worker", connected ? "connected" : "not running; start pnpm worker:evaluations");

  const queue = await reads.queueSnapshot(inputs.now);
  const oldest = queue.oldestPendingAt ? ` (oldest waiting ${minutes(inputs.now.getTime() - queue.oldestPendingAt.getTime())})` : "";
  add("PASS", "Queue", `${queue.pending} queued${oldest}, ${queue.running} running`);
  const expired = queue.expiredReclaimable + queue.expiredExhausted;
  if (expired > 0) {
    add(
      "WARN",
      "Stale evaluations",
      `${expired} evaluation(s) exceeded their worker lease (${queue.expiredReclaimable} will be retried, ` +
        `${queue.expiredExhausted} have no attempts left). This does not prove the worker stopped. ` +
        (connected
          ? "The worker is connected; they may still be running."
          : "If no worker is running, start pnpm worker:evaluations; it recovers them on startup."),
    );
  }

  const deferrals = await reads.openDeferrals();
  add("PASS", "Deferred evaluations", `${deferrals} waiting for budget`);
  return checks;
}

export function formatDoctorChecks(checks: DoctorCheck[]): string {
  return checks.map((check) => `${check.level.padEnd(4)}  ${check.label}: ${check.detail}`).join("\n");
}

// Read-only implementation over a Prisma client: SELECTs and read model
// methods only.
export function createDoctorReads(client: {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  activeUserProfile: { count(args: { where: { domain: string } }): Promise<number> };
  deferredEvaluation: { count(args: { where: { status: "DEFERRED" } }): Promise<number> };
}, helpers: {
  workerConnected(): Promise<boolean>;
  queueSnapshot(now: Date): Promise<QueueSnapshot>;
}): DoctorReads {
  return {
    async ping() {
      await client.$queryRaw`SELECT 1`;
    },
    async appliedMigrations() {
      const rows = (await client.$queryRaw`
        SELECT "migration_name" AS "name", ("finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS "finished"
        FROM "_prisma_migrations" ORDER BY "started_at"`) as Array<{ name: string; finished: boolean }>;
      return rows;
    },
    async hasActiveCustomerSuccessProfile() {
      return (await client.activeUserProfile.count({ where: { domain: "customer-success" } })) > 0;
    },
    workerConnected: () => helpers.workerConnected(),
    queueSnapshot: (now) => helpers.queueSnapshot(now),
    openDeferrals: () => client.deferredEvaluation.count({ where: { status: "DEFERRED" } }),
  };
}
