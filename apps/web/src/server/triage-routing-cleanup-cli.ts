import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createReadOnlyDatabaseClient,
  getDatabaseClient,
  PrismaApplicationRepository,
  PrismaTitlePolicyRepository,
  PrismaTriageRoutingRepository,
  readAutomaticDismissalRows,
  readOnlyTransaction,
} from "@ai-career/database";
import { createTitlePolicyLoader } from "./title-policy-service";
import {
  applyHistoricalRouting,
  formatHistoricalRoutingPlan,
  historicalRoutingUsage,
  parseHistoricalRoutingArguments,
  parseManifest,
  planHistoricalRouting,
  verifyManifest,
  type HistoricalRoutingManifest,
} from "./triage-routing-cleanup";

// pnpm triage:route-historical — the one-time historical cleanup (November
// 25, 2026; triage-routing-cleanup.ts). A read-only dry run by default.
// --apply --expect <count> --manifest <file> moves exactly the dry run's
// jobs to Dismissed (reversible; nothing is deleted), writes the manifest of
// what moved, then reads every moved job back. --verify <manifest> repeats
// that check; --restore <manifest> --expect <count> returns exactly those
// jobs (still in Dismissed by this routing) to where they were.

async function readRows(connectionString: string) {
  const reader = createReadOnlyDatabaseClient(connectionString);
  try {
    return await readOnlyTransaction(reader, (transaction) => readAutomaticDismissalRows(transaction));
  } finally {
    await reader.$disconnect();
  }
}

async function main() {
  const parsed = parseHistoricalRoutingArguments(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(`${parsed.problem}.\n${historicalRoutingUsage}`);
    process.exitCode = 1;
    return;
  }
  const connectionString = process.env.DATABASE_URL!;
  const policy = await createTitlePolicyLoader(new PrismaTitlePolicyRepository())();
  try {
    if (parsed.mode === "dry-run" || parsed.mode === "apply") {
      const plan = planHistoricalRouting(await readRows(connectionString), policy);
      console.log(formatHistoricalRoutingPlan(plan, { listCandidates: parsed.mode === "dry-run" && parsed.list }));
      if (parsed.mode === "dry-run") {
        console.log(`\nBefore applying, back up the database (for example: pg_dump --format=custom --file <backup file> ${parsed.database}).`);
        console.log(`To apply: add --apply --expect ${plan.candidates.length} --manifest <file to write>`);
        return;
      }
      if (parsed.expect !== plan.candidates.length) {
        console.error(`\nRefused: --expect ${parsed.expect} differs from the ${plan.candidates.length} jobs the dry run now finds. Nothing was changed.`);
        process.exitCode = 1;
        return;
      }
      if (existsSync(parsed.manifest)) {
        console.error(`\nRefused: ${parsed.manifest} already exists; name a new manifest file. Nothing was changed.`);
        process.exitCode = 1;
        return;
      }
      const repository = new PrismaTriageRoutingRepository();
      const result = await applyHistoricalRouting(plan, (input) => repository.dismissAutomatically(input), (candidate, outcome) =>
        console.log(`${candidate.id}  ${outcome.status === "DISMISSED" ? "MOVED" : `LEFT (${outcome.skip})`}  ${candidate.title ?? "(no title)"}`));
      const manifest: HistoricalRoutingManifest = { kind: "historical-triage-routing", version: 1, database: parsed.database, appliedAt: new Date().toISOString(), moved: result.moved };
      writeFileSync(parsed.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
      const check = verifyManifest(manifest, await readRows(connectionString));
      const after = planHistoricalRouting(await readRows(connectionString), policy);
      console.log(`\nMoved ${result.moved.length}; left where they are ${result.skipped.length}. Manifest: ${parsed.manifest}`);
      console.log(`Verified ${check.verified} of ${check.checked} moved jobs in Dismissed.${check.problems.length ? ` Problems: ${check.problems.map((item) => `${item.id} ${item.problem}`).join("; ")}` : ""}`);
      console.log(`Now: ${after.total} opportunities, Active ${after.activeNow}, Dismissed ${after.dismissedNow}.`);
      if (check.problems.length || result.skipped.length) process.exitCode = 1;
      return;
    }
    const manifest = parseManifest(readFileSync(parsed.manifest, "utf8"));
    if (manifest.database !== parsed.database) {
      console.error(`Refused: the manifest is for ${manifest.database}, not ${parsed.database}.`);
      process.exitCode = 1;
      return;
    }
    const check = verifyManifest(manifest, await readRows(connectionString));
    if (parsed.mode === "verify") {
      console.log(`Verified ${check.verified} of ${check.checked} moved jobs still in Dismissed by this routing.`);
      for (const problem of check.problems) console.log(`  ${problem.id}  ${problem.problem}`);
      const now = planHistoricalRouting(await readRows(connectionString), policy);
      console.log(`Now: ${now.total} opportunities, Active ${now.activeNow}, Dismissed ${now.dismissedNow}.`);
      if (check.problems.length) process.exitCode = 1;
      return;
    }
    // Restore: only the jobs still in Dismissed by this routing.
    const restorable = manifest.moved.filter((entry) => !check.problems.some((problem) => problem.id === entry.id));
    if (parsed.expect !== restorable.length) {
      console.error(`Refused: --expect ${parsed.expect} differs from the ${restorable.length} jobs still in Dismissed by this routing. Nothing was changed.`);
      process.exitCode = 1;
      return;
    }
    const lifecycle = new PrismaApplicationRepository();
    let restored = 0;
    for (const entry of restorable) {
      const result = await lifecycle.applyLifecycleActionGuarded({ opportunityId: entry.id, action: "RESTORE" });
      console.log(`${entry.id}  ${result.status === "APPLIED" ? `RESTORED to ${result.to}` : `NOT RESTORED (${result.status})`}  ${entry.title ?? "(no title)"}`);
      if (result.status === "APPLIED") restored += 1;
    }
    console.log(`\nRestored ${restored} of ${restorable.length}.`);
    if (restored !== restorable.length) process.exitCode = 1;
  } finally {
    await getDatabaseClient().$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Historical triage routing failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
