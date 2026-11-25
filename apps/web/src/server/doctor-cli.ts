import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { compareGeneratedClientSchema, createDoctorReads, formatDoctorChecks, runDoctorChecks, type DoctorReads, type GeneratedClientComparison } from "./doctor";

// pnpm app:doctor — read-only setup and operations check. Run from the repo root.

const root = process.cwd();
const migrationsDirectory = path.join(root, "database/prisma/migrations");
const prismaClientGenerated = existsSync(path.join(root, "database/generated/prisma/client.ts"));

function generatedClientComparison(): GeneratedClientComparison {
  try {
    const generated = readFileSync(path.join(root, "database/generated/prisma/internal/class.ts"), "utf8");
    const schema = readFileSync(path.join(root, "database/prisma/schema.prisma"), "utf8");
    return compareGeneratedClientSchema(generated, schema);
  } catch {
    return { status: "UNREADABLE" };
  }
}

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
  const comparison = prismaClientGenerated ? generatedClientComparison() : null;
  const clientCurrent = comparison === null || comparison.status === "UNREADABLE" ? undefined : comparison.status === "CURRENT";
  if (prismaClientGenerated && clientCurrent !== false && process.env.DATABASE_URL) {
    try {
      const database = await import("@ai-career/database");
      const client = database.getDatabaseClient();
      reads = createDoctorReads(client, {
        workerConnected: () => database.isEvaluationWorkerConnected(client),
        queueSnapshot: (now) => database.readQueueSnapshot(client, now),
        retrievalWorkerConnected: () => database.isRetrievalWorkerConnected(client),
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
      prismaClientCurrent: clientCurrent,
      ...(comparison?.status === "STALE" ? { prismaClientDifference: comparison.firstDifference } : {}),
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
