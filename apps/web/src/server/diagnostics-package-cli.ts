import "dotenv/config";
import { pathToFileURL } from "node:url";
import { pageReaderRevision } from "@ai-career/core";
import { createReadOnlyDatabaseClient, readOnlyTransaction } from "@ai-career/database";
import { assembleDiagnosticsPackage, parsePackageArguments } from "./diagnostics-package";
import { defaultDiagnosticsDirectory, gitHead } from "./worker-diagnostics";

// pnpm diagnostics:package — assembles the failure evidence package for one
// Mode B capture session into a new local folder (see diagnostics-package.ts).
// Read-only: nothing is rerun, no site is contacted, no evaluation or paid
// call is made, and the database session and transaction are read-only.

const usage = [
  "Usage: pnpm diagnostics:package --database <test or acceptance database name> (--capture-session <id> | --latest [--site linkedin]) --out <new folder>",
  "  --database must name the database DATABASE_URL points to, and must be a test or acceptance database.",
  "  --out must be a new or empty folder outside the repository; it is created with owner-only access.",
  "  --logs-dir <dir>      diagnostics root (default RETRIEVAL_WORKER_LOG_DIR, else ~/.ai-job-assistant/diagnostics)",
  "  --evidence-dir <dir>  page evidence root (default PAGE_CAPTURE_EVIDENCE_DIR)",
  "  --window-minutes <n>  margin around the session's steps for worker events (default 120)",
].join("\n");

const variableNames = /^(DATABASE_URL|TEST_DATABASE_URL|RETRIEVAL_.*|PAGE_CAPTURE_.*|PLAYWRIGHT_.*|NODE_ENV)$/;

async function main() {
  const parsed = parsePackageArguments(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(`${parsed.problem}\n\n${usage}`);
    process.exitCode = 1;
    return;
  }
  const input = { ...parsed.value, logsDirectory: parsed.value.logsDirectory ?? defaultDiagnosticsDirectory };
  const client = createReadOnlyDatabaseClient(input.connectionString);
  try {
    const head = gitHead();
    const result = await assembleDiagnosticsPackage(
      input,
      { read: (reads) => readOnlyTransaction(client, reads) },
      {
        gitSha: head.sha,
        gitBranch: head.branch,
        pageReaderRevision,
        // Names only, never values.
        environmentNames: Object.keys(process.env).filter((name) => variableNames.test(name)).sort(),
      },
    );
    const files = result.manifest.files as Record<string, { present: boolean; count?: number; note?: string }>;
    console.info(`Evidence package written to ${result.out} (owner-only access). The database was not changed.`);
    for (const [name, file] of Object.entries(files)) {
      console.info(`  ${file.present ? "present" : "absent "} ${name}${file.count !== undefined ? ` (${file.count})` : ""}${file.note ? ` — ${file.note}` : ""}`);
    }
    console.info("It may contain job and page data: keep it local, never commit or upload it, and delete it after review.");
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(`The evidence package could not be assembled: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`);
    process.exitCode = 1;
  });
}
