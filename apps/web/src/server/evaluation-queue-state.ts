// The user-visible state of an evaluation's queue task, computed with server
// time. An expired lease is reported as RUNNING_STALE: leases are not renewed
// and can be shorter than a legitimate run, so it does not prove the worker
// stopped.

export type EvaluationQueueState =
  | "QUEUED"
  | "QUEUED_LONG"
  | "RUNNING"
  | "RUNNING_STALE"
  | "FAILED"
  | "COMPLETED";

// A task the worker has not started within this window usually means no
// evaluation worker is running.
export const queuedTooLongMs = 60_000;

const time = (value: Date | string | null) => {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

export function evaluationQueueState(
  task: { status: string; leaseExpiresAt: Date | string | null; createdAt: Date | string },
  now: Date,
): EvaluationQueueState {
  switch (task.status) {
    case "PENDING": {
      const queuedAt = time(task.createdAt);
      return queuedAt !== null && now.getTime() - queuedAt > queuedTooLongMs ? "QUEUED_LONG" : "QUEUED";
    }
    case "RUNNING": {
      const lease = time(task.leaseExpiresAt);
      return lease !== null && lease < now.getTime() ? "RUNNING_STALE" : "RUNNING";
    }
    case "FAILED":
      return "FAILED";
    default:
      return "COMPLETED";
  }
}
