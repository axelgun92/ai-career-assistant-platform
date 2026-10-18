import { normalizeCompanyName } from "@ai-career/deduplication";
import { defaultAdapterRegistry, missingEnvironment } from "@ai-career/discovery";
import type { QueueSnapshot } from "@ai-career/database";
import {
  customerSuccessProductionSemanticPolicyVersion,
  readEvaluationWorkerEnvironment,
  readServerEnvironment,
} from "@ai-career/shared";
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
  activeCustomerSuccessProfile(): Promise<{ version: number; storesLimitations: boolean } | null>;
  workerConnected(): Promise<boolean>;
  queueSnapshot(now: Date): Promise<QueueSnapshot>;
  // Open deferrals; those not waiting for a usage limit wait for the AI budget
  // (including legacy BUDGET_UNAVAILABLE rows).
  openDeferrals(): Promise<{ open: number; waitingForUsageLimits: number; pinnedToOtherVersion: number }>;
  // Companies `pnpm db:backfill-dedup` would give a normalized name.
  companiesNeedingBackfill(): Promise<number>;
  // Automated retrieval (feature 11): enabled sources, failed runs in the
  // last 24 hours and whether the retrieval worker holds its lock.
  retrieval?(now: Date): Promise<{
    workerConnected: boolean;
    enabledSources: Array<{ adapterKey: string; name: string }>;
    failedRunsLastDay: number;
  }>;
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

  // The policy version is defined by the evaluator; the environment variable
  // only overrides its label. A stale override mislabels new evaluations and
  // weakens the worker's queued-policy check, so it is reported (by name).
  const policyOverride = inputs.environment.AI_EXECUTION_POLICY_VERSION?.trim();
  if (!policyOverride || policyOverride === customerSuccessProductionSemanticPolicyVersion) {
    add("PASS", "Evaluation policy version", `${customerSuccessProductionSemanticPolicyVersion} (built into the evaluator)`);
  } else {
    add(
      "WARN",
      "Evaluation policy version",
      `AI_EXECUTION_POLICY_VERSION overrides the evaluator's built-in version ${customerSuccessProductionSemanticPolicyVersion}. ` +
        "Remove it from .env unless you are deliberately pinning a different policy.",
    );
  }

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

  const activeProfile = await reads.activeCustomerSuccessProfile();
  add(
    activeProfile ? "PASS" : "WARN",
    "Active profile",
    activeProfile
      ? `version ${activeProfile.version} is active for Customer Success; ` +
          (activeProfile.storesLimitations ? "it stores structured limitations" : "it stores no structured limitations")
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
  const waitingForBudget = deferrals.open - deferrals.waitingForUsageLimits;
  add(
    deferrals.pinnedToOtherVersion > 0 ? "WARN" : "PASS",
    "Deferred evaluations",
    `${deferrals.open} waiting (${waitingForBudget} for the AI budget, ${deferrals.waitingForUsageLimits} for usage limits)` +
      (deferrals.pinnedToOtherVersion > 0
        ? `; ${deferrals.pinnedToOtherVersion} will run with a profile version other than the active one. ` +
          "Review them on /budget: resume keeps the pinned version; cancel and request again to use the active one."
        : ""),
  );

  // Reported only: the backfill changes data, so it is always run
  // deliberately, never by the doctor or setup.
  const companiesNeedingBackfill = await reads.companiesNeedingBackfill();
  add(
    companiesNeedingBackfill > 0 ? "WARN" : "PASS",
    "Company names",
    companiesNeedingBackfill > 0
      ? `${companiesNeedingBackfill} compan${companiesNeedingBackfill === 1 ? "y has" : "ies have"} no normalized name, so the ` +
          "company filter cannot group them yet. Run pnpm db:backfill-dedup --dry-run, then pnpm db:backfill-dedup, " +
          "against this database when you choose (it also records duplicates among existing opportunities)."
      : "normalized",
  );

  if (reads.retrieval) {
    const retrieval = await reads.retrieval(inputs.now);
    const enabled = retrieval.enabledSources.length;
    const blocked = retrieval.enabledSources.flatMap((source) => {
      const adapter = defaultAdapterRegistry.get(source.adapterKey);
      if (!adapter) return [`${source.name} (unknown source type)`];
      if (!adapter.verified) return [`${source.name} (awaiting verification)`];
      const missing = missingEnvironment(adapter, inputs.environment);
      return missing.length ? [`${source.name} (needs ${missing.join(" and ")})`] : [];
    });
    add(
      blocked.length ? "WARN" : "PASS",
      "Retrieval sources",
      enabled === 0
        ? "none enabled; nothing is retrieved until you enable a source on /sources"
        : `${enabled} enabled` + (blocked.length ? `; cannot run: ${blocked.join(", ")}` : ""),
    );
    add(
      enabled > 0 && !retrieval.workerConnected ? "WARN" : "PASS",
      "Retrieval worker",
      retrieval.workerConnected
        ? "connected"
        : enabled > 0
          ? "not running; start pnpm worker:retrieval to run enabled sources"
          : "not running (not needed until a source is enabled)",
    );
    add(
      retrieval.failedRunsLastDay > 0 ? "WARN" : "PASS",
      "Retrieval runs",
      retrieval.failedRunsLastDay > 0
        ? `${retrieval.failedRunsLastDay} run(s) failed in the last 24 hours; see each source's run history on /sources`
        : "no failed runs in the last 24 hours",
    );
  }
  return checks;
}

export function formatDoctorChecks(checks: DoctorCheck[]): string {
  return checks.map((check) => `${check.level.padEnd(4)}  ${check.label}: ${check.detail}`).join("\n");
}

// Read-only implementation over a Prisma client: SELECTs and read model
// methods only.
export function createDoctorReads(client: {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}, helpers: {
  workerConnected(): Promise<boolean>;
  queueSnapshot(now: Date): Promise<QueueSnapshot>;
  retrievalWorkerConnected?(): Promise<boolean>;
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
    async activeCustomerSuccessProfile() {
      const rows = (await client.$queryRaw`
        SELECT p."version", (p."limitations" IS NOT NULL) AS "storesLimitations"
        FROM "ActiveUserProfile" a JOIN "UserProfile" p ON p."id" = a."userProfileId"
        WHERE a."domain" = 'customer-success'`) as Array<{ version: number; storesLimitations: boolean }>;
      return rows[0] ?? null;
    },
    workerConnected: () => helpers.workerConnected(),
    async companiesNeedingBackfill() {
      const rows = (await client.$queryRaw`
        SELECT "name" FROM "Company" WHERE "normalizedName" IS NULL`) as Array<{ name: string }>;
      return rows.filter((row) => normalizeCompanyName(row.name) !== null).length;
    },
    queueSnapshot: (now) => helpers.queueSnapshot(now),
    async retrieval(now) {
      const enabledSources = (await client.$queryRaw`
        SELECT "adapterKey", "name" FROM "RetrievalSource"
        WHERE "enabled" AND "archivedAt" IS NULL ORDER BY "createdAt" ASC, "id" ASC`) as Array<{ adapterKey: string; name: string }>;
      const failed = (await client.$queryRaw`
        SELECT COUNT(*)::int AS "count" FROM "RetrievalRun"
        WHERE "status" = 'FAILED' AND "finishedAt" >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}`) as Array<{ count: number }>;
      return {
        workerConnected: helpers.retrievalWorkerConnected ? await helpers.retrievalWorkerConnected() : false,
        enabledSources,
        failedRunsLastDay: failed[0]?.count ?? 0,
      };
    },
    async openDeferrals() {
      // A deferral resumes with the version it was requested with; count the
      // open ones whose version is not the active one (or no longer exists).
      const rows = (await client.$queryRaw`
        SELECT COUNT(*)::int AS "open",
          COUNT(*) FILTER (WHERE d."reasonCode" = 'USAGE_LIMIT_REACHED')::int AS "waitingForUsageLimits",
          COUNT(*) FILTER (WHERE d."userProfileId" IS DISTINCT FROM a."userProfileId")::int AS "pinnedToOtherVersion"
        FROM "DeferredEvaluation" d
        LEFT JOIN "ActiveUserProfile" a ON a."domain" = d."domain"
        WHERE d."status" = 'DEFERRED'`) as Array<{ open: number; waitingForUsageLimits: number; pinnedToOtherVersion: number }>;
      return rows[0] ?? { open: 0, waitingForUsageLimits: 0, pinnedToOtherVersion: 0 };
    },
  };
}
