import "dotenv/config";
import { createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  PrismaManualOpportunityRepository,
  PrismaPageCaptureRepository,
  PrismaRetrievalSourceRepository,
  RetrievalWorkerLock,
} from "@ai-career/database";
import { createFetchTransport, createPoliteTransport, defaultAdapterRegistry } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { readRetrievalWorkerEnvironment, readServerEnvironment } from "@ai-career/shared";
import { ZodError } from "zod";
import { getEvaluationService } from "./evaluation-service";
import { enabledSitesFromEnvironment } from "./page-capture";
import { createPageCaptureAcquisition, evaluationHandoff, type PageCaptureAcquisition } from "./page-capture-acquisition";
import { createRetrievalWorker, runRetrievalWorkerLoop, type RetrievalWorker } from "./retrieval-worker";
import { formatWorkerError } from "./worker-errors";

// pnpm worker:retrieval [--once] — runs enabled retrieval sources on their
// schedule and Run-now requests from /sources. Exactly one retrieval worker
// runs at a time. It contacts only the sources the user has enabled, and
// it never starts an evaluation for them. When no source run is due, it
// also reads the details of jobs the browser extension saved from a results
// page (Mode B), only for sites whose automatic detail acquisition is
// verified, and hands each newly ingested job to the existing evaluation
// request, whose pre-evaluator triage decides before anything is admitted.

// The page-capture pass runs only when no retrieval run was due.
function withPageCaptureAcquisition(worker: RetrievalWorker, acquisition: PageCaptureAcquisition): RetrievalWorker {
  return {
    ...worker,
    async runOnce() {
      const outcome = await worker.runOnce();
      if (outcome) return outcome;
      const pass = await acquisition.runOnce();
      if (pass) {
        log.info(
          `page capture site=${pass.site} claimed=${pass.claimed} ingested=${pass.ingested} awaitingDetails=${pass.awaitingDetails} ` +
            `unavailable=${pass.unavailable} stopped=${pass.stopped ?? "-"}`,
        );
      }
      return null;
    },
  };
}

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

// Feature 14: browser-assisted sources get a fresh logged-out Chromium per
// run. The browser package loads only when a browser is configured.
function browserLauncher(executablePath: string) {
  const loaded = import("@ai-career/browser-retrieval");
  let parse: ((html: string, url: string) => Document) | null = null;
  return {
    async launch() {
      const browser = await loaded;
      parse = browser.parseHtml;
      return browser.launchBrowserDriver({ executablePath });
    },
    parse(html: string, url: string) {
      if (!parse) throw new Error("The browser has not been launched");
      return parse(html, url);
    },
  };
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
  const captureRepository = new PrismaManualOpportunityRepository();
  const ingestion = createRetrievalIngestionService({
    repository: captureRepository,
    normalizer: createRetrievedOpportunityNormalizer(),
  });
  const browser = settings.RETRIEVAL_BROWSER_EXECUTABLE ? browserLauncher(settings.RETRIEVAL_BROWSER_EXECUTABLE) : null;
  const acquisition = createPageCaptureAcquisition({
    repository: new PrismaPageCaptureRepository(),
    ingestion,
    handoff: evaluationHandoff(getEvaluationService()),
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => enabledSitesFromEnvironment().details,
    probeCapture: () => captureRepository.probeCaptureLock(),
    ...(browser ? { browser } : {}),
    log,
  });
  const retrievalWorker = createRetrievalWorker({
    store: sources,
    ingestion,
    registry: defaultAdapterRegistry,
    transport: (options) => createPoliteTransport(createFetchTransport({ userAgent: settings.RETRIEVAL_USER_AGENT }), options),
    discovery: customerSuccessDiscoveryConfiguration,
    env: () => process.env,
    now: () => new Date(),
    log,
    lastChecked: (source, externalIds) => sources.lastCheckedListings(source, externalIds),
    pendingListings: (sourceId, trackingScopeKey, since) => sources.pendingListings(sourceId, trackingScopeKey, since),
    ...(browser ? { browser } : {}),
  });
  const worker = withPageCaptureAcquisition(retrievalWorker, acquisition);
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
