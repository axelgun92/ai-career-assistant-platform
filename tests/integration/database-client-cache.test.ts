// The process-wide client cache against PostgreSQL (November 25, 2026;
// review), on the isolated test database; nothing is written:
// - an interactive transaction open on a client survives another route
//   bundle replacing that client after a generated-client change, and the
//   replacement works at once;
// - the replaced client is never disconnected: its connections close on
//   their own once idle (pg's idleTimeoutMillis), so no connection outlives
//   its use;
// - why it is never disconnected: Prisma's $disconnect invalidates an
//   interactive transaction still open on the client.
import { PrismaPg } from "../../database/node_modules/@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { createClientCache, type ClientSlot } from "../../database/src/client";
import { PrismaClient } from "../../database/generated/prisma/client";

const run = `cache${Date.now().toString(36)}`;
const created: PrismaClient[] = [];
const make = (applicationName: string, idleTimeoutMillis?: number) => {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, application_name: applicationName, ...(idleTimeoutMillis ? { idleTimeoutMillis } : {}) }),
  });
  created.push(client);
  return client;
};
const observer = make(`${run}-observer`);
const connections = async (applicationName: string) =>
  Number((await observer.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_stat_activity WHERE application_name = ${applicationName}`)[0]!.count);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => {
  for (const client of created) await client.$disconnect().catch(() => undefined);
});

describe("replacing the process-wide client", () => {
  it("never invalidates an open transaction, and the replaced client's connections close on their own", async () => {
    const slot: ClientSlot<PrismaClient> = {};
    const generations = new Map<PrismaClient, string>();
    // A short idle timeout (pg's default is 10 s) keeps the test quick.
    const bundle = (generation: string) =>
      createClientCache<PrismaClient>({
        slot,
        create: () => {
          const client = make(`${run}-${generation}`, 1_000);
          generations.set(client, generation);
          return client;
        },
        fingerprint: (client) => generations.get(client)!,
      });
    const old = bundle("generation-1")();
    let replacement: PrismaClient | null = null;
    const result = await old.$transaction(async (transaction) => {
      const [first] = await transaction.$queryRaw<Array<{ value: number }>>`SELECT 1::int AS value`;
      // Another route bundle loads the regenerated client meanwhile.
      replacement = bundle("generation-2")();
      expect(replacement).not.toBe(old);
      expect(await replacement.$queryRaw<Array<{ value: number }>>`SELECT 2::int AS value`).toEqual([{ value: 2 }]);
      // Well past the idle timeout: the transaction's connection is in use,
      // so it stays open.
      await sleep(2_500);
      expect(await connections(`${run}-generation-1`)).toBe(1);
      const [second] = await transaction.$queryRaw<Array<{ value: number }>>`SELECT 3::int AS value`;
      return [first!.value, second!.value];
    }, { timeout: 15_000 });
    expect(result).toEqual([1, 3]);
    expect(slot.client).toBe(replacement);
    // Once idle, the replaced client's connection closes by itself; the
    // replacement keeps working.
    await sleep(2_500);
    expect(await connections(`${run}-generation-1`)).toBe(0);
    expect(await replacement!.opportunity.count()).toBeGreaterThanOrEqual(0);
  });

  it("why it is never disconnected: $disconnect invalidates an open transaction", async () => {
    const client = make(`${run}-disconnect`);
    await expect(
      client.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT 1`;
        await client.$disconnect();
        await transaction.$queryRaw`SELECT 2`;
      }, { timeout: 10_000 }),
    ).rejects.toThrow(/Transaction not found|closed transaction/);
  });
});
