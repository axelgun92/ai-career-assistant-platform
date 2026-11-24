import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createReadOnlyDatabaseClient } from "@ai-career/database";
import { analyzeDuplicateHistory, formatDuplicateHistoryReport, readDuplicateHistory } from "./duplicate-history-diagnostic";

// pnpm duplicates:history — the historical duplicate investigation
// (November 24, 2026). Read-only: the session is opened read-only and every
// read runs in a READ ONLY transaction, so PostgreSQL refuses any write. Each
// side's stored evidence is re-normalized in memory only; no site, evaluator
// or provider is contacted and nothing is merged. --database must name the
// database DATABASE_URL points to. --summary-only leaves out the
// pair-by-pair section; --json <new file> also writes every pair's full
// comparison to a new local file.

const usage = "Usage: pnpm duplicates:history --database <database name> [--summary-only] [--json <new file outside the repository>]";

export function parseHistoryArguments(argv: string[], environment: Record<string, string | undefined>):
  | { ok: true; connectionString: string; database: string; pairDetail: boolean; jsonFile: string | null }
  | { ok: false; problem: string } {
  const values = new Map<string, string>();
  let pairDetail = true;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--summary-only") {
      pairDetail = false;
      continue;
    }
    if (!["--database", "--json"].includes(name)) return { ok: false, problem: `Unknown option ${name}` };
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
  return { ok: true, connectionString, database, pairDetail, jsonFile: values.get("--json") ?? null };
}

async function main() {
  const parsed = parseHistoryArguments(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(`${parsed.problem}\n${usage}`);
    process.exitCode = 1;
    return;
  }
  const client = createReadOnlyDatabaseClient(parsed.connectionString);
  try {
    const read = await readDuplicateHistory(client);
    const findings = await analyzeDuplicateHistory(read);
    if (parsed.jsonFile) {
      const pairs = findings.map((finding) => ({
        ...finding,
        later: { ...finding.later, description: `${finding.later.description.length} characters`, identity: undefined, renormalizedIdentity: undefined },
        earlier: { ...finding.earlier, description: `${finding.earlier.description.length} characters`, identity: undefined, renormalizedIdentity: undefined },
      }));
      writeFileSync(parsed.jsonFile, `${JSON.stringify({ database: parsed.database, noMatchReferences: read.noMatchReferences, pairs }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
    console.log(formatDuplicateHistoryReport({ database: parsed.database, findings, noMatchReferences: read.noMatchReferences, pairDetail: parsed.pairDetail }));
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && /duplicate-history-cli\.[cm]?[jt]s$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`Duplicate history investigation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
