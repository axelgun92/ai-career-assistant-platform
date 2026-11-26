import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { readServerEnvironment } from "@ai-career/shared";
import { Prisma, PrismaClient } from "../generated/prisma/client";

type DatabaseClient = PrismaClient;

function createDatabaseClient(): DatabaseClient {
  const { DATABASE_URL } = readServerEnvironment();
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  return new PrismaClient({ adapter });
}

// One client (and connection pool) per process, in every environment.
// Repositories call this in their constructors, so creating a client per
// call would open a pool per repository under `next start`.
//
// November 25, 2026: a running development server that reloads this module
// after `pnpm prisma:generate` (a pull that changes the schema) gets the new
// generated client, but a client kept on globalThis was made from the old
// one: reads of a new model failed with a TypeError ("Cannot read properties
// of undefined (reading 'findMany')") and the dashboard showed
// "Opportunities could not be loaded" until the server restarted.
//
// Identity of a generated client: a SHA-256 of its complete generated
// metadata, read from a client instance (the generated module exports none
// of it): the embedded schema exactly as generated (every model, field, type,
// enum, relation, default, attribute, mapping, datasource and generator
// setting), the runtime data model, the parameterization schema, the client
// version, provider and preview features. A development server may load the
// generated module once per route bundle; every copy of one generation has
// the same fingerprint, so they share one client. The class object is no
// identity (each copy has its own).
//
// Retirement: a client of an earlier generation is replaced and never
// disconnected. Prisma's $disconnect invalidates interactive transactions
// still open on the client ("Transaction not found"; shown by
// tests/integration/database-client-cache.test.ts), and a request or
// transaction may still be using it. Instead the cache drops its reference:
// the client's pg pool closes each connection once it has been idle for
// idleTimeoutMillis (pg's default, 10 s, with no minimum kept), so an open
// transaction or running query keeps its connection until it finishes, and
// afterwards the old client holds no connection and is garbage-collected
// once nothing references it. Nothing retired is kept, so repeated
// regeneration never accumulates clients or connections. Under `next start`
// the generated client is part of the build, so the fingerprint never
// changes and the single client is kept.

// The generated metadata a client carries (Prisma 7: `_engineConfig`).
export function generatedClientFingerprint(client: unknown): string {
  const config = (client as { _engineConfig?: Record<string, unknown> } | null)?._engineConfig;
  const identity = config && typeof config.inlineSchema === "string"
    ? {
        inlineSchema: config.inlineSchema,
        runtimeDataModel: config.runtimeDataModel ?? null,
        parameterizationSchema: config.parameterizationSchema ?? null,
        clientVersion: config.clientVersion ?? null,
        activeProvider: config.activeProvider ?? null,
        previewFeatures: config.previewFeatures ?? null,
      }
    // A Prisma version without that metadata: the generated names (models,
    // fields and enums) and the client version.
    : {
        fallback: Object.entries(Prisma as unknown as Record<string, unknown>)
          .filter(([name, value]) => (name === "ModelName" || name.endsWith("ScalarFieldEnum")) && value !== null && typeof value === "object")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, value]) => `${name}:${Object.keys(value as object).sort().join(",")}`),
        version: Prisma.prismaVersion,
      };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

// The process-wide slot every copy of this module shares.
export interface ClientSlot<Client> {
  client?: Client;
  fingerprint?: string;
  // Generations already replaced: a module copy of one of them (an older
  // bundle not yet re-evaluated) gets the current client and never takes
  // the slot back, so two copies can never keep replacing each other.
  retiredFingerprints?: Set<string>;
}

export interface ClientCacheOptions<Client> {
  slot: ClientSlot<Client>;
  create: () => Client;
  fingerprint: (client: Client) => string;
}

// The client of this module copy's generation: the cached one when it is of
// the same generation (or of a newer one), otherwise a new one; the replaced
// client is only dropped (see Retirement above).
export function createClientCache<Client>(options: ClientCacheOptions<Client>) {
  let generation: { fingerprint: string; probe: Client | null } | null = null;

  function current() {
    // Read once per module copy, from a client that is never connected
    // unless it becomes the replacement.
    if (!generation) {
      const probe = options.create();
      generation = { fingerprint: options.fingerprint(probe), probe };
    }
    return generation;
  }

  return function getClient(): Client {
    const own = current();
    const cached = options.slot.client;
    if (cached) {
      const cachedFingerprint = options.slot.fingerprint ?? options.fingerprint(cached);
      if (cachedFingerprint === own.fingerprint || options.slot.retiredFingerprints?.has(own.fingerprint)) {
        own.probe = null;
        return cached;
      }
      (options.slot.retiredFingerprints ??= new Set()).add(cachedFingerprint);
    }
    const client = own.probe ?? options.create();
    own.probe = null;
    options.slot.client = client;
    options.slot.fingerprint = own.fingerprint;
    return client;
  };
}

const globalDatabase = globalThis as typeof globalThis & {
  aiCareerDatabaseClientSlot?: ClientSlot<DatabaseClient>;
  // Where earlier versions of this module kept their client.
  aiCareerDatabaseClient?: DatabaseClient;
};

function processSlot(): ClientSlot<DatabaseClient> {
  if (!globalDatabase.aiCareerDatabaseClientSlot) {
    // A development server that ran an earlier version of this module keeps
    // that client as the cached one; its fingerprint is read from it, so it
    // is reused when current and replaced (as above) when not.
    const legacy = globalDatabase.aiCareerDatabaseClient;
    globalDatabase.aiCareerDatabaseClientSlot = legacy ? { client: legacy } : {};
    delete globalDatabase.aiCareerDatabaseClient;
  }
  return globalDatabase.aiCareerDatabaseClientSlot;
}

export const getDatabaseClient: () => DatabaseClient = createClientCache<DatabaseClient>({
  slot: processSlot(),
  create: createDatabaseClient,
  fingerprint: generatedClientFingerprint,
});
