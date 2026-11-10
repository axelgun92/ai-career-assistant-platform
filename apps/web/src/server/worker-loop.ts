import { classifyWorkerError, formatWorkerError } from "./worker-errors";

// The evaluation worker loop, independent of Prisma and process signals so
// its error and recovery behaviour can be tested deterministically.
//
// - Evaluation failures are handled inside runOnce (persisted as FAILED).
// - Transient infrastructure errors back off (poll × 2^n, capped) and continue.
// - Any other escaping error is fatal: logged safely, exit code 1, no retry.
// - Recovery runs only while this worker holds the single-worker lock and has
//   no task in flight (startup and idle), so it never touches a live run.

export interface WorkerTaskOutcome {
  id: string;
  evaluationId: string;
  status: string;
  errorCode: string | null;
}

export interface WorkerLoopDependencies {
  runOnce(): Promise<WorkerTaskOutcome | null>;
  // Fails orphaned exhausted tasks; returns how many were recovered.
  recover(): Promise<number>;
  // Lifecycle repair; returns how many opportunities were updated.
  sweep(): Promise<number>;
  lock: {
    isHeld(): boolean;
    // Returns false when another worker holds the lock.
    acquire(): Promise<boolean>;
  };
  sleep(ms: number): Promise<void>;
  now(): number;
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  shouldStop(): boolean;
  pollMs: number;
  once?: boolean;
  maxBackoffMs?: number;
  sweepIntervalMs?: number;
}

export const defaultMaxBackoffMs = 30_000;
export const defaultSweepIntervalMs = 5 * 60_000;

export function backoffDelay(pollMs: number, consecutiveFailures: number, maxBackoffMs = defaultMaxBackoffMs) {
  return Math.min(pollMs * 2 ** consecutiveFailures, maxBackoffMs);
}

export async function runWorkerLoop(dependencies: WorkerLoopDependencies): Promise<number> {
  const maxBackoffMs = dependencies.maxBackoffMs ?? defaultMaxBackoffMs;
  const sweepIntervalMs = dependencies.sweepIntervalMs ?? defaultSweepIntervalMs;
  const { log } = dependencies;
  let failures = 0;
  let startupDone = false;
  let lastSweep = Number.NEGATIVE_INFINITY;

  async function idleMaintenance() {
    // Never without the lock, never with a task in flight (callers ensure
    // nothing is running when this is reached).
    if (!dependencies.lock.isHeld()) return;
    const recovered = await dependencies.recover();
    if (recovered > 0) log.warn(`recovered ${recovered} evaluation(s) whose worker lease expired on the final attempt`);
    if (dependencies.now() - lastSweep >= sweepIntervalMs) {
      const repaired = await dependencies.sweep();
      if (repaired > 0) log.info(`synced lifecycle for ${repaired} evaluated opportunities`);
      lastSweep = dependencies.now();
    }
  }

  while (!dependencies.shouldStop()) {
    try {
      if (!dependencies.lock.isHeld()) {
        if (!(await dependencies.lock.acquire())) {
          log.error("another evaluation worker is already running; exiting");
          return 1;
        }
        log.info("holding the single-worker lock");
      }
      if (!startupDone) {
        await idleMaintenance();
        startupDone = true;
      }
      const task = await dependencies.runOnce();
      failures = 0;
      if (task) {
        log.info(
          `task finished taskId=${task.id} evaluationId=${task.evaluationId} status=${task.status} errorCode=${task.errorCode ?? "-"}`,
        );
        if (dependencies.once) return 0;
        continue;
      }
      if (dependencies.once) return 0;
      await dependencies.sleep(dependencies.pollMs);
      if (dependencies.shouldStop()) break;
      await idleMaintenance();
    } catch (error) {
      if (classifyWorkerError(error) === "fatal") {
        log.error(`fatal error; exiting ${formatWorkerError(error)}`);
        return 1;
      }
      failures += 1;
      const delay = backoffDelay(dependencies.pollMs, failures, maxBackoffMs);
      log.warn(`transient error (attempt ${failures}); retrying in ${delay}ms ${formatWorkerError(error)}`);
      await dependencies.sleep(delay);
    }
  }
  return 0;
}
