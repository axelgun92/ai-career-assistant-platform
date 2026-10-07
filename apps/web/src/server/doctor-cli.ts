import "dotenv/config";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createDoctorReads, formatDoctorChecks, runDoctorChecks, type DoctorReads } from "./doctor";

// pnpm app:doctor — read-only setup and operations check. Run from the repo root.

const root = process.cwd();
const migrationsDirectory = path.join(root, "database/prisma/migrations");
const prismaClientGenerated = existsSync(path.join(root, "database/generated/prisma/client.ts"));

function migrationFolders(): string[] {
  if (!existsSync(migrationsDirectory)) return [];
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  let reads: DoctorReads | null = null;
  let disconnect: () => Promise<void> = async () => undefined;
  if (prismaClientGenerated && process.env.DATABASE_URL) {
    try {
      const database = await import("@ai-career/database");
      const client = database.getDatabaseClient();
      reads = createDoctorReads(client, {
        workerConnected: () => database.isEvaluationWorkerConnected(client),
        queueSnapshot: (now) => database.readQueueSnapshot(client, now),
      });
      disconnect = () => client.$disconnect();
    } catch {
      reads = null;
    }
  }
  try {
    const checks = await runDoctorChecks({
      environment: process.env,
      nodeVersion: process.versions.node,
      migrationFolders: migrationFolders(),
      prismaClientGenerated,
      reads,
      now: new Date(),
    });
    console.info(formatDoctorChecks(checks));
    const failed = checks.some((check) => check.level === "FAIL");
    console.info(failed ? "\nSome required checks failed." : "\nNo blocking problems found.");
    process.exitCode = failed ? 1 : 0;
  } finally {
    await disconnect().catch(() => undefined);
  }
}

void main().catch(() => {
  console.error("pnpm app:doctor could not complete its checks.");
  process.exitCode = 1;
});
