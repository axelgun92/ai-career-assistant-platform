import {
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
} from "@ai-career/database";
import { createEvaluationWorker } from "@ai-career/evaluation";
import {
  readEvaluationWorkerEnvironment,
  readSemanticEnvironment,
  semanticPricingFromEnvironment,
} from "@ai-career/shared";
import { createCustomerSuccessEvaluationProcessor } from "./customer-success-evaluation-processor";

export function createProductionEvaluationWorker() {
  const semantic = readSemanticEnvironment();
  const worker = readEvaluationWorkerEnvironment();
  const tasks = new PrismaEvaluationTaskRepository();
  return createEvaluationWorker({
    tasks,
    leaseSeconds: worker.EVALUATION_JOB_LEASE_SECONDS,
    processor: createCustomerSuccessEvaluationProcessor({
      evaluations: new PrismaEvaluationRepository(),
      tasks,
      semanticConfig: {
        apiKey: semantic.OPENAI_API_KEY,
        model: semantic.AI_MODEL,
        maxOutputTokens: semantic.AI_MAX_OUTPUT_TOKENS,
        retryLimit: semantic.AI_RETRY_LIMIT,
        callBudget: semantic.AI_CALL_BUDGET,
        timeoutMs: semantic.AI_REQUEST_TIMEOUT_MS,
        pricing: semanticPricingFromEnvironment(semantic),
      },
    }),
  });
}
