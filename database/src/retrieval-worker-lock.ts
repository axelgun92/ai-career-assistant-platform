import pg from "pg";
import { readServerEnvironment } from "@ai-career/shared";
import { getDatabaseClient } from "./client";

// Enforces a single retrieval worker, the same way as the evaluation worker
// lock: a session-level advisory lock held on a dedicated connection for
// the worker's lifetime, released by Postgres if that connection drops.
export const retrievalWorkerLockKeys = { namespace: 41_220, worker: 4 } as const;

export class RetrievalWorkerLock {
  private client: pg.Client | null = null;
  private lost = false;

  constructor(private readonly connectionString: string = readServerEnvironment().DATABASE_URL) {}

  isHeld(): boolean {
    return this.client !== null && !this.lost;
  }

  // Returns false when another retrieval worker holds the lock.
  async acquire(): Promise<boolean> {
    await this.release();
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on("error", () => {
      this.lost = true;
    });
    client.on("end", () => {
      this.lost = true;
    });
    await client.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1::int, $2::int) AS locked",
        [retrievalWorkerLockKeys.namespace, retrievalWorkerLockKeys.worker],
      );
      if (!result.rows[0]?.locked) {
        await client.end().catch(() => undefined);
        return false;
      }
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
    this.client = client;
    this.lost = false;
    return true;
  }

  async release(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    if (!this.lost) {
      await client
        .query("SELECT pg_advisory_unlock($1::int, $2::int)", [retrievalWorkerLockKeys.namespace, retrievalWorkerLockKeys.worker])
        .catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

// Read-only: whether any process currently holds the retrieval worker lock.
export async function isRetrievalWorkerConnected(
  client: { $queryRaw: ReturnType<typeof getDatabaseClient>["$queryRaw"] } = getDatabaseClient(),
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ held: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted
        AND classid = ${retrievalWorkerLockKeys.namespace}::oid
        AND objid = ${retrievalWorkerLockKeys.worker}::oid
        AND objsubid = 2
    ) AS "held"`;
  return rows[0]?.held ?? false;
}
