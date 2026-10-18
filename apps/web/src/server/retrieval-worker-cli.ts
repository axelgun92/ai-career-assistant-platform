import "dotenv/config";
import { createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  PrismaManualOpportunityRepository,
  PrismaRetrievalSourceRepository,
  RetrievalWorkerLock,
} from "@ai-career/database";
import { createFetchTransport, createPoliteTransport, defaultAdapterRegistry } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { readRetrievalWorkerEnvironment, readServerEnvironment } from "@ai-career/shared";
import { ZodError } from "zod";
import { createRetrievalWorker, runRetrievalWorkerLoop } from "./retrieval-worker";
import { formatWorkerError } from "./worker-errors";

// pnpm worker:retrieval [--once] — runs enabled retrieval sources on their
// schedule and Run-now requests from /sources. Exactly one retrieval worker
// runs at a time. It contacts only the sources the user has enabled, and
// it never starts an evaluation.

const log = {
  info: (message: string) => console.info(`[retrieval] ${message}`),
  warn: (message: string) => console.warn(`[retrieval] ${message}`),
  error: (message: string) => console.error(`[retrieval] ${message}`),
};

function readConfiguration() {
  try {
    readServerEnvironment();
    return readRetrievalWorkerEnvironment();
  } catch (error) {
    const names =
      error instanceof ZodError
        ? [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "configuration")))].join(", ")
        : "configuration";
    log.error(`configuration error: ${names}. Run pnpm app:doctor for details.`);
    return null;
  }
}

async function main(): Promise<number> {
  const settings = readConfiguration();
  if (!settings) return 1;
  const once = process.argv.includes("--once");

  let stopping = false;
  let wake: (() => void) | null = null;
  const onSignal = () => {
    if (stopping) {
      log.warn("second stop signal; exiting immediately");
      process.exit(130);
    }
    stopping = true;
    log.info("stopping after the current run (press Ctrl-C again to exit immediately)");
    wake?.();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  log.info(`starting pollMs=${settings.RETRIEVAL_WORKER_POLL_MS}${once ? " once" : ""}`);
  const lock = new RetrievalWorkerLock();
  const sources = new PrismaRetrievalSourceRepository();
  const worker = createRetrievalWorker({
    store: sources,
    ingestion: createRetrievalIngestionService({
      repository: new PrismaManualOpportunityRepository(),
      normalizer: createRetrievedOpportunityNormalizer(),
    }),
    registry: defaultAdapterRegistry,
    transport: () => createPoliteTransport(createFetchTransport({ userAgent: settings.RETRIEVAL_USER_AGENT })),
    discovery: customerSuccessDiscoveryConfiguration,
    env: () => process.env,
    now: () => new Date(),
    log,
    lastChecked: (source, externalIds) => sources.lastCheckedListings(source, externalIds),
  });
  try {
    return await runRetrievalWorkerLoop({
      worker,
      lock,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        }),
      shouldStop: () => stopping,
      log,
      pollMs: settings.RETRIEVAL_WORKER_POLL_MS,
      once,
    });
  } finally {
    await lock.release();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log.error(`fatal error; exiting ${formatWorkerError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => getDatabaseClient().$disconnect().catch(() => undefined));
