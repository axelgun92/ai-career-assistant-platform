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

export function getDatabaseClient(): DatabaseClient {
  const client = globalDatabase.aiCareerDatabaseClient ?? createDatabaseClient();

  if (process.env.NODE_ENV !== "production") {
    globalDatabase.aiCareerDatabaseClient = client;
  }

  return client;
}
