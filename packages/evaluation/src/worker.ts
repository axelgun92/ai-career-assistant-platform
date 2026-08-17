import type { EvaluationTask, EvaluationTaskRepository } from "./workflow-contracts";

export class EvaluationWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EvaluationWorkerError";
  }
}

export interface EvaluationTaskProcessor {
  process(task: EvaluationTask): Promise<void>;
}

export function createEvaluationWorker(input: {
  tasks: EvaluationTaskRepository;
  processor: EvaluationTaskProcessor;
  leaseSeconds: number;
}) {
  return {
    async runOnce(): Promise<EvaluationTask | null> {
      const task = await input.tasks.claimNext({
        leaseSeconds: input.leaseSeconds,
      });
      if (!task) return null;

      try {
        await input.processor.process(task);
        return input.tasks.complete(task.id);
      } catch (error) {
        const failure =
          error instanceof EvaluationWorkerError
            ? error
            : new EvaluationWorkerError(
                "EVALUATION_WORKER_FAILED",
                "Evaluation worker execution failed",
                false,
              );
        return input.tasks.fail({
          taskId: task.id,
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        });
      }
    },
  };
}
