import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createReadOnlyDatabaseClient, readOnlyTransaction } from "@ai-career/database";
import { buildTriageCoverageReport, formatTriageCoverageReport, readTriageCoverage } from "./triage-coverage-audit";

// pnpm triage:audit — the triage coverage audit (November 22, 2026). Reads
// the database DATABASE_URL points to in a read-only session and transaction:
// nothing is assessed, requested, queued or changed, and no provider is
// called. --database must name that database, so the audit never reads one
// by accident. --json prints the report as JSON; --candidates <file> writes
// the triage-only backfill candidates' IDs (one per line) to a new file.

const usage = "Usage: pnpm triage:audit --database <database name> [--json] [--candidates <new file outside the repository>]";

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const connectionString = process.env.DATABASE_URL;
  const database = value("--database");
  if (!connectionString || !database) {
    console.error(`DATABASE_URL and --database are required.\n${usage}`);
    process.exitCode = 1;
    return;
  }
  const named = new URL(connectionString).pathname.replace(/^\//, "");
  if (named !== database) {
    console.error(`--database ${database} does not match the database DATABASE_URL points to (${named}).\n${usage}`);
    process.exitCode = 1;
    return;
  }
  const client = createReadOnlyDatabaseClient(connectionString);
  try {
    const read = await readOnlyTransaction(client, (transaction) => readTriageCoverage(transaction));
    const report = buildTriageCoverageReport(read);
    const candidates = value("--candidates");
    if (candidates) writeFileSync(candidates, `${report.backfillCandidateIds.join("\n")}\n`, { flag: "wx", mode: 0o600 });
    const { backfillCandidateIds: _ids, ...printable } = report;
    console.log(args.includes("--json") ? JSON.stringify(printable, null, 2) : formatTriageCoverageReport(report));
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Triage audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
