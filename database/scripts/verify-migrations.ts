import "dotenv/config";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

// pnpm db:verify-migrations — applies every migration to a fresh temporary
// database on the configured server, then checks that the result matches
// schema.prisma except for the one known, documented drift line, and that
// every migration is recorded in order. The temporary database is always
// dropped. Nothing in the configured database is changed.

const knownDrift = 'ALTER TABLE "Recommendation" ALTER COLUMN "evidenceReferences" DROP DEFAULT;';
const root = process.cwd();
const config = "database/prisma.config.ts";

function fail(message: string): never {
  throw new Error(message);
}

function prisma(args: string[], databaseUrl: string) {
  const result = spawnSync("pnpm", ["exec", "prisma", ...args, "--config", config], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`prisma ${args[0]} ${args[1] ?? ""} failed:\n${result.stderr}`);
  return result.stdout;
}

async function main() {
  const configured = process.env.DATABASE_URL ?? fail("DATABASE_URL is not set");
  const name = `ai_career_migration_check_${process.pid}`;
  const temporary = new URL(configured);
  temporary.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: configured });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    console.info(`Created temporary database ${name}`);
    prisma(["migrate", "deploy"], temporary.toString());

    const folders = readdirSync(path.join(root, "database/prisma/migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const check = new pg.Client({ connectionString: temporary.toString() });
    await check.connect();
    try {
      const { rows } = await check.query<{ name: string; finished: boolean }>(
        `SELECT "migration_name" AS "name", "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL AS "finished"
         FROM "_prisma_migrations" ORDER BY "migration_name"`,
      );
      const applied = rows.filter((row) => row.finished).map((row) => row.name);
      if (JSON.stringify(applied) !== JSON.stringify(folders)) {
        fail(`Applied migrations do not match the folders.\napplied: ${applied.join(", ")}\nfolders: ${folders.join(", ")}`);
      }
      console.info(`All ${folders.length} migrations applied in order.`);
    } finally {
      await check.end();
    }

    const diff = prisma(
      ["migrate", "diff", "--from-config-datasource", "--to-schema", "database/prisma/schema.prisma", "--script"],
      temporary.toString(),
    );
    const statements = diff
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));
    const unexpected = statements.filter((line) => line !== knownDrift);
    if (unexpected.length) fail(`Schema drift beyond the known Recommendation line:\n${unexpected.join("\n")}`);
    console.info(
      statements.length
        ? "Schema matches migrations except the known Recommendation.evidenceReferences default (documented)."
        : "Schema matches migrations exactly.",
    );
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
    await admin.end();
    console.info(`Dropped temporary database ${name}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration verification failed");
  process.exitCode = 1;
});
