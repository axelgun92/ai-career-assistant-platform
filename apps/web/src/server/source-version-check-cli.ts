import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createReadOnlyDatabaseClient, readStoredSourceVersion, type SourceVersionSelector } from "@ai-career/database";
import { formatSourceVersionCheck, renormalizeStoredSourceVersion } from "./source-version-check";

// pnpm acceptance:check-source-version — Feature 14B original-JD retest
// (acceptance and debugging only). Reads one stored source version, runs its
// exact stored evidence through the current normalization and prints the
// result beside the stored facts. Read-only: the session is opened
// read-only and the reads run in a READ ONLY transaction, so PostgreSQL
// refuses any write. No evaluator, provider or network call.
//
//   pnpm acceptance:check-source-version --database ai_career_assistant_acceptance \
//     --opportunity http://localhost:3000/opportunities/<id>
//   (or --opportunity <id>, or --source-record <source version id>)

const usage = [
  "Usage: pnpm acceptance:check-source-version --database <database name> --opportunity <opportunity page URL or ID>",
  "       pnpm acceptance:check-source-version --database <database name> --source-record <source version ID>",
  "--database must name the database DATABASE_URL points to (a safety check).",
].join("\n");

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type CheckArguments = { ok: true; connectionString: string; database: string; selector: SourceVersionSelector } | { ok: false; problem: string };

export function parseCheckArguments(argv: string[], environment: Record<string, string | undefined>): CheckArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (!["--database", "--opportunity", "--source-record"].includes(name)) return { ok: false, problem: `Unknown option ${name}` };
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) return { ok: false, problem: `${name} needs a value` };
    values.set(name, value);
    index += 1;
  }
  const expected = values.get("--database");
  if (!expected) return { ok: false, problem: "--database is required" };
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { ok: false, problem: "DATABASE_URL is not set" };
  let database: string;
  let host: string;
  try {
    const url = new URL(connectionString);
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    host = url.host;
  } catch {
    return { ok: false, problem: "DATABASE_URL is not a valid database URL" };
  }
  if (database !== expected) {
    return { ok: false, problem: `DATABASE_URL points to database "${database}", not "${expected}". Nothing was read.` };
  }
  const opportunity = values.get("--opportunity");
  const sourceRecord = values.get("--source-record");
  if (Boolean(opportunity) === Boolean(sourceRecord)) return { ok: false, problem: "Give exactly one of --opportunity or --source-record" };
  const id = uuid.exec((opportunity ?? sourceRecord)!)?.[0]?.toLowerCase();
  if (!id) return { ok: false, problem: `No ID found in ${opportunity ? "--opportunity" : "--source-record"}` };
  return {
    ok: true,
    connectionString,
    database: `${database} on ${host}`,
    selector: opportunity ? { opportunityId: id } : { sourceRecordId: id },
  };
}

async function main() {
  const parsed = parseCheckArguments(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(`${parsed.problem}\n\n${usage}`);
    process.exitCode = 1;
    return;
  }
  const client = createReadOnlyDatabaseClient(parsed.connectionString);
  try {
    const read = await readStoredSourceVersion(client, parsed.selector);
    if (!read) {
      console.error(`Nothing found for that ${"opportunityId" in parsed.selector ? "opportunity" : "source version"} in ${parsed.database}. Nothing was changed.`);
      process.exitCode = 1;
      return;
    }
    const result = await renormalizeStoredSourceVersion(read.version);
    console.info(formatSourceVersionCheck({ database: parsed.database, read, result }));
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(`The source-version check could not complete: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`);
    process.exitCode = 1;
  });
}
