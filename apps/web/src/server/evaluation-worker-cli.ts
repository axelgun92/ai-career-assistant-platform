import "dotenv/config";
import {
  EvaluationWorkerLock,
  getDatabaseClient,
  PrismaEvaluationTaskRepository,
  PrismaOpportunityLifecycleRepository,
} from "@ai-career/database";
import { readEvaluationWorkerEnvironment, readSemanticEnvironment, readServerEnvironment } from "@ai-career/shared";
import { ZodError } from "zod";
import { aiConfigurationStatus, describeConfigurationProblem } from "./ai-configuration";
import { createProductionEvaluationWorker } from "./evaluation-worker";
import { semanticExecutorConfigFromEnvironment } from "./semantic-execution-config";
import { runWorkerLoop } from "./worker-loop";
import { formatWorkerError } from "./worker-errors";

const log = {
  info: (message: string) => console.info(`[worker] ${message}`),
  warn: (message: string) => console.warn(`[worker] ${message}`),
  error: (message: string) => console.error(`[worker] ${message}`),
};

function variableNames(error: unknown) {
  return error instanceof ZodError
    ? [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "configuration")))].join(", ")
    : "configuration";
}

// Configuration problems are reported by variable name and exit non-zero;
// they are never retried.
function readConfiguration() {
  try {
    readServerEnvironment();
  } catch (error) {
    log.error(`configuration error: ${variableNames(error)}. Run pnpm app:doctor for details.`);
    return null;
  }
  const ai = aiConfigurationStatus();
  if (ai.state !== "configured") {
    log.error(`configuration error: ${describeConfigurationProblem(ai)} Run pnpm app:doctor for details.`);
    return null;
  }
  try {
    return { worker: readEvaluationWorkerEnvironment(), semantic: semanticExecutorConfigFromEnvironment(readSemanticEnvironment()) };
  } catch (error) {
    log.error(`configuration error: ${variableNames(error)}. Run pnpm app:doctor for details.`);
    return null;
  }
}

async function main(): Promise<number> {
  const configuration = readConfiguration();
  if (!configuration) return 1;
  const { worker: settings, semantic } = configuration;
  const once = process.argv.includes("--once");

  let stopping = false;
  let wake: (() => void) | null = null;
  const onSignal = () => {
    if (stopping) {
      log.warn("second stop signal; exiting immediately");
      process.exit(130);
    }
    stopping = true;
    log.info("stopping after the current task (press Ctrl-C again to exit immediately)");
    wake?.();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  log.info(
    `starting policy=${semantic.executionPolicy?.version ?? "default"} model=${semantic.model} ` +
      `leaseSeconds=${settings.EVALUATION_JOB_LEASE_SECONDS} pollMs=${settings.EVALUATION_WORKER_POLL_MS}${once ? " once" : ""}`,
  );
  const worstCaseSeconds = (semantic.callBudget * semantic.timeoutMs) / 1000;
  if (settings.EVALUATION_JOB_LEASE_SECONDS < worstCaseSeconds) {
    log.warn(
      `the lease (${settings.EVALUATION_JOB_LEASE_SECONDS}s) is shorter than the worst-case run (${worstCaseSeconds}s); ` +
        "a long run may show as stale. Run exactly one worker.",
    );
  }

  const lock = new EvaluationWorkerLock();
  const tasks = new PrismaEvaluationTaskRepository();
  const lifecycle = new PrismaOpportunityLifecycleRepository();
  const worker = createProductionEvaluationWorker();
  try {
    return await runWorkerLoop({
      runOnce: () => worker.runOnce(),
      recover: async () => (await tasks.failExpiredExhaustedTasks()).length,
      sweep: () => lifecycle.sweepSystemLifecycle(),
      lock,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        }),
      now: () => Date.now(),
      log,
      shouldStop: () => stopping,
      pollMs: settings.EVALUATION_WORKER_POLL_MS,
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
