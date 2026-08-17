import "dotenv/config";
import { readEvaluationWorkerEnvironment } from "@ai-career/shared";
import { createProductionEvaluationWorker } from "./evaluation-worker";

const settings = readEvaluationWorkerEnvironment();
const worker = createProductionEvaluationWorker();
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
