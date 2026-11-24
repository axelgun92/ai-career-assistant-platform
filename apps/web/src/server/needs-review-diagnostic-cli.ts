import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createReadOnlyDatabaseClient } from "@ai-career/database";
import { analyzeNeedsReview, formatNeedsReviewReport, readNeedsReviewCases } from "./needs-review-diagnostic";

// pnpm triage:review-diagnostic — the NEEDS_REVIEW diagnostic (November 24,
// 2026). Read-only: the session is opened read-only and every read runs in a
// READ ONLY transaction, so PostgreSQL refuses any write. The stored evidence
// is re-normalized and re-triaged in memory only; no site, evaluator or
// provider is contacted. --database must name the database DATABASE_URL
// points to. --examples <n> (0-10, default 3) limits the examples per class;
// --json <new file> also writes the per-opportunity findings (IDs, reason
// codes, classes, short evidence snippets) to a new local file.

const usage = "Usage: pnpm triage:review-diagnostic --database <database name> [--examples <0-10>] [--json <new file outside the repository>]";

export function parseDiagnosticArguments(argv: string[], environment: Record<string, string | undefined>):
  | { ok: true; connectionString: string; database: string; examples: number; jsonFile: string | null }
  | { ok: false; problem: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (!["--database", "--examples", "--json"].includes(name)) return { ok: false, problem: `Unknown option ${name}` };
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) return { ok: false, problem: `${name} needs a value` };
    values.set(name, value);
    index += 1;
  }
  const database = values.get("--database");
  if (!database) return { ok: false, problem: "--database is required" };
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { ok: false, problem: "DATABASE_URL is not set" };
  let named: string;
  try {
    named = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  } catch {
    return { ok: false, problem: "DATABASE_URL is not a valid database URL" };
  }
  if (named !== database) return { ok: false, problem: `DATABASE_URL points to database "${named}", not "${database}". Nothing was read.` };
  const examplesText = values.get("--examples") ?? "3";
  if (!/^\d+$/.test(examplesText) || Number(examplesText) > 10) return { ok: false, problem: "--examples takes a whole number from 0 to 10" };
  return { ok: true, connectionString, database, examples: Number(examplesText), jsonFile: values.get("--json") ?? null };
}

async function main() {
  const parsed = parseDiagnosticArguments(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(`${parsed.problem}\n${usage}`);
    process.exitCode = 1;
    return;
  }
  const client = createReadOnlyDatabaseClient(parsed.connectionString);
  try {
    const { cases, context } = await readNeedsReviewCases(client);
    const findings = await analyzeNeedsReview(cases, context);
    if (parsed.jsonFile) {
      writeFileSync(parsed.jsonFile, `${JSON.stringify({ database: parsed.database, activeProfileVersion: context.activeProfile?.version ?? null, findings }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
    console.log(formatNeedsReviewReport({ database: parsed.database, context, findings, examples: parsed.examples }));
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && /needs-review-diagnostic-cli\.[cm]?[jt]s$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`NEEDS_REVIEW diagnostic failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
