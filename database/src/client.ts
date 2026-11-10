import { PrismaPg } from "@prisma/adapter-pg";
import { readServerEnvironment } from "@ai-career/shared";
import { PrismaClient } from "../generated/prisma/client";

type DatabaseClient = PrismaClient;

const globalDatabase = globalThis as typeof globalThis & {
  aiCareerDatabaseClient?: DatabaseClient;
};

function createDatabaseClient(): DatabaseClient {
  const { DATABASE_URL } = readServerEnvironment();
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  return new PrismaClient({ adapter });
}

// One client (and connection pool) per process, in every environment.
// Repositories call this in their constructors, so creating a client per
// call would open a pool per repository under `next start`.
export function getDatabaseClient(): DatabaseClient {
  globalDatabase.aiCareerDatabaseClient ??= createDatabaseClient();
  return globalDatabase.aiCareerDatabaseClient;
}
