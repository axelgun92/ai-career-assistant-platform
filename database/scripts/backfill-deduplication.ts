import "dotenv/config";
import { backfillDeduplication } from "../src/deduplication-backfill";
import { getDatabaseClient } from "../src/client";

// pnpm db:backfill-dedup [--dry-run]
// Changes data: run it deliberately, against the database you intend.
// Idempotent and additive; see database/src/deduplication-backfill.ts.

function describeTarget(connectionString: string | undefined) {
  if (!connectionString) return "DATABASE_URL is not set";
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "an unparseable DATABASE_URL";
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.info(`Deduplication backfill${dryRun ? " (dry run: nothing is written)" : ""}`);
  console.info(`Database: ${describeTarget(process.env.DATABASE_URL)}`);
  const report = await backfillDeduplication({ dryRun });
  console.info(`Companies without a normalized name: ${report.companiesMissingNormalizedName}`);
  console.info(`  ${dryRun ? "would be filled" : "filled"}: ${dryRun ? report.companiesMissingNormalizedName - report.companiesWithoutKey : report.companiesNormalized}`);
  console.info(`  without letters or digits (left empty): ${report.companiesWithoutKey}`);
  console.info(`Opportunities scanned: ${report.opportunitiesScanned}`);
  console.info(`Duplicate references missing: ${report.duplicateReferencesMissing}`);
  console.info(`  ${dryRun ? "would be recorded" : "recorded"}: ${dryRun ? report.duplicateReferencesMissing : report.duplicateReferencesCreated}`);
}

main()
  .catch((error: unknown) => {
    console.error("Deduplication backfill failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    process.exitCode = 1;
  })
  .finally(() => getDatabaseClient().$disconnect());
