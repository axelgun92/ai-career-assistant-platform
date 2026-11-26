import pg from "pg";
import { readServerEnvironment } from "@ai-career/shared";
import { evaluationWorkerLockKeys } from "./evaluation-worker-lock";

// Serializes the duplicate-spend check with the admission it protects: a
// paid evaluation request (or deferred resume) holds this lock from the
// check until its admission, evaluation or deferral is committed, so two
// exact duplicates requested at the same moment cannot both pass the check.
// It is a session-level advisory lock on its own short-lived connection
// (the admission gate runs its own transactions meanwhile); Postgres
// releases it if that connection drops.
export const duplicateSpendLockKey = { namespace: evaluationWorkerLockKeys.namespace, key: 3 } as const;
// A request waits at most this long for another request's check to finish.
const lockWaitMs = 30_000;

export async function withDuplicateSpendLock<T>(
  work: () => Promise<T>,
  connectionString: string = readServerEnvironment().DATABASE_URL,
): Promise<T> {
  const client = new pg.Client({ connectionString });
  client.on("error", () => undefined);
  await client.connect();
  try {
    await client.query(`SET statement_timeout = ${lockWaitMs}`);
    await client.query("SELECT pg_advisory_lock($1::int, $2::int)", [
      duplicateSpendLockKey.namespace,
      duplicateSpendLockKey.key,
    ]);
    try {
      return await work();
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1::int, $2::int)", [duplicateSpendLockKey.namespace, duplicateSpendLockKey.key])
        .catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
