import "dotenv/config";
import { createReadOnlyDatabaseClient, getDatabaseClient, readOnlyTransaction } from "@ai-career/database";
import { getEvaluationService } from "./evaluation-service";
import { formatTriageBackfillReport, runTriageBackfill } from "./triage-backfill";
import { readTriageCoverage } from "./triage-coverage-audit";

// pnpm triage:backfill — the one-time triage-only backfill (November 24,
// 2026). A dry run by default: it reads the database DATABASE_URL points to in
// a read-only session and lists the candidates (the audit's CANDIDATE class).
// --apply --expect <count> triages exactly those candidates with the existing
// EvaluationService.assessTriage, rechecking each one first; it writes
// PreEvaluatorTriage records only (no evaluation request, admission, budget,
// queue or provider call). --database must name that database.

const usage = "Usage: pnpm triage:backfill --database <database name> [--apply --expect <candidate count from the dry run>]";

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const known = new Set(["--database", "--apply", "--expect"]);
  const unknown = args.filter((arg, index) => arg.startsWith("--") && !known.has(arg) && !(index > 0 && ["--database", "--expect"].includes(args[index - 1]!)));
  const connectionString = process.env.DATABASE_URL;
  const database = value("--database");
  const apply = args.includes("--apply");
  const expectText = value("--expect");
  const expected = expectText !== undefined && /^\d+$/.test(expectText) ? Number(expectText) : undefined;
  if (!connectionString || !database || unknown.length || (expectText !== undefined && expected === undefined) || (expectText !== undefined && !apply)) {
    console.error(`${unknown.length ? `Unknown option ${unknown[0]}. ` : ""}DATABASE_URL and --database are required; --expect takes a whole number and goes with --apply.\n${usage}`);
    process.exitCode = 1;
    return;
  }
  const named = new URL(connectionString).pathname.replace(/^\//, "");
  if (named !== database) {
    console.error(`--database ${database} does not match the database DATABASE_URL points to (${named}).\n${usage}`);
    process.exitCode = 1;
    return;
  }
  const reader = createReadOnlyDatabaseClient(connectionString);
  try {
    const report = await runTriageBackfill(
      {
        read: (opportunityId) => readOnlyTransaction(reader, (transaction) => readTriageCoverage(transaction, { opportunityId })),
        assess: (opportunityId) => getEvaluationService().assessTriage(opportunityId),
        existing: (opportunityId) => getEvaluationService().getTriage(opportunityId),
      },
      {
        apply,
        ...(expected !== undefined ? { expectedCandidates: expected } : {}),
        onResult: (entry) => console.log(`${entry.id}  ${entry.result}  ${entry.title ?? "(no title)"}`),
      },
    );
    console.log(formatTriageBackfillReport(report));
    if (report.refused || (report.outcomes.FAILED ?? 0) > 0) process.exitCode = 1;
  } finally {
    await reader.$disconnect();
    // The evaluation service's own client (used only with --apply).
    if (apply) await getDatabaseClient().$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Triage backfill failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
