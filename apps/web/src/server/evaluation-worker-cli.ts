import "dotenv/config";
import { PrismaOpportunityLifecycleRepository } from "@ai-career/database";
import { readEvaluationWorkerEnvironment } from "@ai-career/shared";
import { createProductionEvaluationWorker } from "./evaluation-worker";

async function main() {
  const settings = readEvaluationWorkerEnvironment();
  const worker = createProductionEvaluationWorker();
  // Repair any Opportunity whose evaluation completed without a lifecycle sync.
  const repaired = await new PrismaOpportunityLifecycleRepository().sweepSystemLifecycle();
  if (repaired > 0) console.info(`Synced lifecycle for ${repaired} evaluated opportunities.`);
  let stopping = false;
  const runOnce = process.argv.includes("--once");

  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  do {
    const task = await worker.runOnce();
    if (!runOnce && !task) {
      await new Promise((resolve) =>
        setTimeout(resolve, settings.EVALUATION_WORKER_POLL_MS),
      );
    }
  } while (!runOnce && !stopping);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
