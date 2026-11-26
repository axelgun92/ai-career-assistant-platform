import pg from "pg";
import { readServerEnvironment } from "@ai-career/shared";
import { getDatabaseClient } from "./client";

// Enforces a single evaluation worker. The worker holds a session-level
// advisory lock on its own dedicated connection for its lifetime; Postgres
// releases it automatically if that connection drops. This is what makes
// worker-owned recovery safe: while the lock holder is idle, no supported
// worker can be executing any task. It is not a heartbeat.
export const evaluationWorkerLockKeys = { namespace: 41_220, worker: 1 } as const;

export class EvaluationWorkerLock {
  private client: pg.Client | null = null;
  private lost = false;

  constructor(private readonly connectionString: string = readServerEnvironment().DATABASE_URL) {}

  // True when this process holds the lock on a live connection.
  isHeld(): boolean {
    return this.client !== null && !this.lost;
  }

  // Takes the lock. Returns false when another worker holds it. Connection
  // failures propagate (callers treat them as transient).
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
        [evaluationWorkerLockKeys.namespace, evaluationWorkerLockKeys.worker],
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
        .query("SELECT pg_advisory_unlock($1::int, $2::int)", [
          evaluationWorkerLockKeys.namespace,
          evaluationWorkerLockKeys.worker,
        ])
        .catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

// Read-only: whether any process currently holds the worker lock.
export async function isEvaluationWorkerConnected(
  client: { $queryRaw: ReturnType<typeof getDatabaseClient>["$queryRaw"] } = getDatabaseClient(),
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ held: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted
        AND classid = ${evaluationWorkerLockKeys.namespace}::oid
        AND objid = ${evaluationWorkerLockKeys.worker}::oid
        AND objsubid = 2
    ) AS "held"`;
  return rows[0]?.held ?? false;
}
