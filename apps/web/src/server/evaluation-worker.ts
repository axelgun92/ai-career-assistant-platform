import {
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
} from "@ai-career/database";
import { createEvaluationWorker } from "@ai-career/evaluation";
import { readEvaluationWorkerEnvironment } from "@ai-career/shared";
import { createCustomerSuccessEvaluationProcessor } from "./customer-success-evaluation-processor";
import { semanticExecutorConfigFromEnvironment } from "./semantic-execution-config";

export function createProductionEvaluationWorker() {
  const worker = readEvaluationWorkerEnvironment();
  const tasks = new PrismaEvaluationTaskRepository();
  return createEvaluationWorker({
    tasks,
    leaseSeconds: worker.EVALUATION_JOB_LEASE_SECONDS,
    processor: createCustomerSuccessEvaluationProcessor({
      evaluations: new PrismaEvaluationRepository(),
      tasks,
      semanticConfig: semanticExecutorConfigFromEnvironment(),
    }),
  });
}
