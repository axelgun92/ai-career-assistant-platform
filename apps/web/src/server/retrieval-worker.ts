import {
  emptyRetrievalRunCounts,
  type DiscoveryConfiguration,
  type RetrievalIngestionService,
  type RetrievalRunCounts,
} from "@ai-career/core";
import type { PrismaRetrievalSourceRepository, RetrievalRunRecord, RetrievalSourceRecord } from "@ai-career/database";
import {
  AdapterError,
  createTitleMatcher,
  missingEnvironment,
  type AdapterRegistry,
  type RetrievalTransport,
} from "@ai-career/discovery";
import { classifyWorkerError, formatWorkerError } from "./worker-errors";

// The retrieval worker (feature 11). Each iteration queues scheduled runs
// that are due, claims one queued run, executes its source's adapter and
// ingests each kept listing in its own capture transaction. A listing that
// fails is counted and the run continues. Retrieval never starts an
// evaluation: retrieved opportunities arrive unevaluated, and evaluation
// stays the user's explicit action through the budget and admission path.

export type RetrievalRunStore = Pick<
  PrismaRetrievalSourceRepository,
  "enqueueDueRuns" | "claimNextRun" | "finishRun" | "failInterruptedRuns"
>;

export interface RetrievalWorkerDependencies {
  store: RetrievalRunStore;
  ingestion: RetrievalIngestionService;
  registry: AdapterRegistry;
  // A fresh (polite) transport for each run, with the adapter's minimum
  // request interval where it declares one.
  transport: (options: { minIntervalMs?: number }) => RetrievalTransport;
  discovery: DiscoveryConfiguration;
  env: () => Readonly<Record<string, string | undefined>>;
  now: () => Date;
  log: { info(message: string): void; warn(message: string): void };
  // When listings already stored from a source (by adapter key) were last
  // checked; adapters use it to send detail requests to unseen listings
  // first. See PrismaRetrievalSourceRepository.lastCheckedListings.
  lastChecked?: (source: string, externalIds: readonly string[]) => Promise<ReadonlyMap<string, Date>>;
  maxPages?: number;
  maxDetailRequests?: number;
  leaseSeconds?: number;
}

export interface RetrievalRunOutcome {
  runId: string;
  sourceId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  counts: RetrievalRunCounts;
  errorCode: string | null;
}

export const defaultMaxPagesPerRun = 5;
export const defaultMaxDetailRequestsPerRun = 25;

const safeMessages: Record<string, string> = {
  NETWORK: "The source could not be reached.",
  HTTP_STATUS: "The source returned an unexpected response.",
  SERVER_ERROR: "The source had a server error; retrieval stopped.",
  ACCESS_DENIED: "The source refused access; retrieval stopped.",
  RATE_LIMITED: "The source rate-limited retrieval; retrieval stopped.",
  RESPONSE_TOO_LARGE: "The source's response was larger than allowed.",
  CONTRACT_MISMATCH: "The source's response no longer matches the expected format.",
  CONFIG: "The source is not configured correctly.",
  LISTING_FAILURES: "Some listings could not be stored.",
  ADAPTER_UNAVAILABLE: "This source cannot run (unknown, unverified or missing settings).",
  INTERNAL: "Retrieval failed unexpectedly.",
};

export function createRetrievalWorker(dependencies: RetrievalWorkerDependencies) {
  const keepTitle = createTitleMatcher(dependencies.discovery.titleTerms);

  // The run's outcome; a failure from the source carries any Retry-After it
  // sent, which sets how long the source waits (feature 12).
  async function finish(
    run: RetrievalRunRecord,
    status: RetrievalRunOutcome["status"],
    counts: RetrievalRunCounts,
    errorCode: string | null,
    failure?: AdapterError,
  ) {
    const retryAfterSeconds = failure?.details.retryAfterSeconds;
    await dependencies.store.finishRun(run.id, {
      status,
      counts,
      errorCode,
      errorMessage: errorCode ? (safeMessages[errorCode] ?? safeMessages.INTERNAL!) : null,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      now: dependencies.now(),
    });
    return { runId: run.id, sourceId: run.retrievalSourceId, status, counts, errorCode };
  }

  async function execute(run: RetrievalRunRecord, source: RetrievalSourceRecord): Promise<RetrievalRunOutcome> {
    const counts = emptyRetrievalRunCounts();
    const adapter = dependencies.registry.get(source.adapterKey);
    if (!adapter || !adapter.verified || missingEnvironment(adapter, dependencies.env()).length) {
      return finish(run, "FAILED", counts, "ADAPTER_UNAVAILABLE");
    }
    const config = adapter.configSchema.safeParse(source.config);
    if (!config.success) return finish(run, "FAILED", counts, "CONFIG");

    let result;
    try {
      result = await adapter.collect(
        {
          transport: dependencies.transport(adapter.minRequestIntervalMs ? { minIntervalMs: adapter.minRequestIntervalMs } : {}),
          discovery: dependencies.discovery,
          keepTitle,
          env: dependencies.env(),
          now: dependencies.now,
          maxPages: adapter.maxPagesPerRun ?? dependencies.maxPages ?? defaultMaxPagesPerRun,
          maxDetailRequests: dependencies.maxDetailRequests ?? defaultMaxDetailRequestsPerRun,
          ...(dependencies.lastChecked ? { lastChecked: (ids: readonly string[]) => dependencies.lastChecked!(adapter.key, ids) } : {}),
        },
        config.data,
      );
    } catch (error) {
      if (error instanceof AdapterError) return finish(run, "FAILED", counts, error.code, error);
      dependencies.log.warn(`run ${run.id} failed in the adapter ${formatWorkerError(error)}`);
      return finish(run, "FAILED", counts, "INTERNAL");
    }

    counts.fetched = result.fetched;
    counts.keptByTerms = result.listings.length + result.issues.length;
    counts.failed = result.issues.length;
    for (const listing of result.listings) {
      try {
        const ingested = await dependencies.ingestion.ingest({
          ...listing,
          retrieval: { ...listing.retrieval!, retrievalSourceId: source.id, retrievalRunId: run.id },
        });
        if (ingested.outcome === "CREATED") {
          counts.created += 1;
          if (ingested.decision === "PROBABLE_MATCH") counts.probable += 1;
        } else if (ingested.outcome === "ATTACHED") counts.attached += 1;
        else if (ingested.outcome === "UNCHANGED") counts.unchanged += 1;
        else counts.changed += 1;
      } catch (error) {
        counts.failed += 1;
        dependencies.log.warn(`run ${run.id} could not store a listing ${formatWorkerError(error)}`);
      }
    }

    const stored = counts.created + counts.attached + counts.unchanged + counts.changed;
    if (result.halted) return finish(run, stored ? "PARTIAL" : "FAILED", counts, result.halted.code, result.halted);
    if (counts.failed) return finish(run, stored ? "PARTIAL" : "FAILED", counts, "LISTING_FAILURES");
    return finish(run, "COMPLETED", counts, null);
  }

  return {
    // Startup recovery: called while holding the single-worker lock, with
    // nothing in flight, so any RUNNING run was interrupted.
    recover: () => dependencies.store.failInterruptedRuns(dependencies.now(), { regardlessOfLease: true }),

    async runOnce(): Promise<RetrievalRunOutcome | null> {
      const queued = await dependencies.store.enqueueDueRuns(dependencies.now());
      if (queued) dependencies.log.info(`queued ${queued} scheduled run(s)`);
      const claimed = await dependencies.store.claimNextRun(dependencies.now(), dependencies.leaseSeconds);
      if (!claimed) return null;
      return execute(claimed.run, claimed.source);
    },
  };
}

export type RetrievalWorker = ReturnType<typeof createRetrievalWorker>;

// The worker loop: single-worker lock, startup recovery, then claim and run
// until stopped. Database errors that look transient back off and retry;
// anything else exits.
export async function runRetrievalWorkerLoop(input: {
  worker: RetrievalWorker;
  lock: { isHeld(): boolean; acquire(): Promise<boolean> };
  sleep(ms: number): Promise<void>;
  shouldStop(): boolean;
  log: { info(message: string): void; warn(message: string): void; error(message: string): void };
  pollMs: number;
  once?: boolean;
  maxBackoffMs?: number;
}): Promise<number> {
  const maxBackoffMs = input.maxBackoffMs ?? 60_000;
  let failures = 0;
  let recovered = false;
  while (!input.shouldStop()) {
    try {
      if (!input.lock.isHeld()) {
        if (!(await input.lock.acquire())) {
          input.log.error("another retrieval worker is already running; exiting");
          return 1;
        }
        input.log.info("holding the single retrieval-worker lock");
      }
      if (!recovered) {
        const interrupted = await input.worker.recover();
        if (interrupted) input.log.warn(`closed ${interrupted} interrupted run(s) as FAILED`);
        recovered = true;
      }
      const outcome = await input.worker.runOnce();
      failures = 0;
      if (outcome) {
        input.log.info(
          `run finished runId=${outcome.runId} sourceId=${outcome.sourceId} status=${outcome.status} ` +
            `errorCode=${outcome.errorCode ?? "-"} counts=${JSON.stringify(outcome.counts)}`,
        );
        if (input.once) return 0;
        continue;
      }
      if (input.once) return 0;
      await input.sleep(input.pollMs);
    } catch (error) {
      if (classifyWorkerError(error) === "fatal") {
        input.log.error(`fatal error; exiting ${formatWorkerError(error)}`);
        return 1;
      }
      failures += 1;
      const delay = Math.min(input.pollMs * 2 ** failures, maxBackoffMs);
      input.log.warn(`transient error (attempt ${failures}); retrying in ${delay}ms ${formatWorkerError(error)}`);
      await input.sleep(delay);
    }
  }
  return 0;
}
