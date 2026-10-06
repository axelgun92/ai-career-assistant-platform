import type { EvaluationTaskProcessor } from "@ai-career/evaluation";

export interface LifecycleSync {
  syncSystemLifecycleForEvaluation(evaluationId: string): Promise<unknown>;
}

// Product-level wrapper around the evaluation processor. After a task's
// evaluation has completed (process() resolved), move the Opportunity's system
// lifecycle forward. A sync failure is logged and never fails the completed
// task; the worker's startup sweep repairs anything left behind.
export function withOpportunityLifecycleSync(
  processor: EvaluationTaskProcessor,
  lifecycle: LifecycleSync,
  log: (message: string, details: Record<string, string>) => void = console.error,
): EvaluationTaskProcessor {
  return {
    async process(task) {
      await processor.process(task);
      try {
        await lifecycle.syncSystemLifecycleForEvaluation(task.evaluationId);
      } catch (error) {
        log("Opportunity lifecycle sync failed after evaluation completed", {
          evaluationId: task.evaluationId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    },
  };
}
