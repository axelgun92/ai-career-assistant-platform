import { ZodError, z } from "zod";
import {
  evaluationSnapshotSchema,
  stageFailureSchema,
  type CoreEvaluationContext,
  type CoreEvaluationResult,
  type CoreEvaluationStage,
  type DomainEvaluatorDefinition,
  type EvaluationRepository,
  type EvaluationSnapshot,
  type EvaluationSubject,
  type JsonValue,
  type StageFailure,
} from "./contracts";
import { parseStageOutput } from "./definition";
import {
  StageExecutionError,
  StructuredOutputValidationError,
} from "./errors";

const executionInputSchema = z
  .object({
    opportunityId: z.uuid(),
    userProfileId: z.uuid().nullable(),
    executionMetadata: z.record(z.string(), z.json()),
  })
  .strict();

function stageFailure(
  error: unknown,
  stage: CoreEvaluationStage<unknown>,
): StageFailure {
  if (error instanceof StageExecutionError) {
    return stageFailureSchema.parse({
      code: error.code,
      reason: error.message,
      retryable: error.retryable,
    });
  }

  if (
    error instanceof ZodError ||
    error instanceof SyntaxError ||
    error instanceof StructuredOutputValidationError
  ) {
    return stageFailureSchema.parse({
      code: "STRUCTURED_OUTPUT_INVALID",
      reason: error.message,
      retryable: stage.invalidOutputRetryable,
    });
  }

  return stageFailureSchema.parse({
    code: "STAGE_EXECUTION_FAILED",
    reason: error instanceof Error ? error.message : "Unknown stage failure",
    retryable: false,
  });
}

function buildContext<TDomainData>(input: {
  snapshot: EvaluationSnapshot;
  subject: EvaluationSubject;
  position: number;
  domainData: TDomainData;
}): CoreEvaluationContext<TDomainData> {
  const previousStageResults = input.snapshot.stageResults.filter(
    (result) => result.position < input.position,
  );
  const completedStageIds = new Set(
    previousStageResults
      .filter((result) => result.status === "COMPLETED")
      .map((result) => result.id),
  );
  const evidenceLedger = input.snapshot.evidenceRecords.filter((record) =>
    completedStageIds.has(record.stageResultId),
  );
  const contradictions = input.snapshot.contradictions.filter((record) =>
    completedStageIds.has(record.stageResultId),
  );

  return {
    evaluationId: input.snapshot.id,
    domain: input.snapshot.domain,
    evaluationVersion: input.snapshot.evaluationVersion,
    domainVersion: input.snapshot.domainVersion,
    ruleVersion: input.snapshot.ruleVersion,
    promptVersion: input.snapshot.promptVersion,
    opportunity: input.subject.opportunity,
    rawSources: input.subject.rawSources,
    provenance: input.subject.provenance,
    userProfile: input.subject.userProfile,
    previousStageResults,
    evidenceLedger,
    contradictions,
    unknowns: previousStageResults.flatMap(
      (result) => result.result?.unknowns ?? [],
    ),
    executionMetadata: input.snapshot.executionMetadata ?? {},
    domainData: input.domainData,
  };
}

async function runStage<TDomainData>(input: {
  repository: EvaluationRepository;
  subject: EvaluationSubject;
  domainData: TDomainData;
  stage: CoreEvaluationStage<TDomainData>;
  position: number;
  evaluationId: string;
}): Promise<"COMPLETED" | "FAILED"> {
  const started = await input.repository.beginStage({
    evaluationId: input.evaluationId,
    stageId: input.stage.id,
    maxAttempts: input.stage.maxAttempts,
  });
  const snapshot = await input.repository.getEvaluationSnapshot(
    started.evaluationId,
  );
  if (!snapshot) {
    throw new Error("Evaluation disappeared during stage execution");
  }

  try {
    const context = buildContext({
      snapshot,
      subject: input.subject,
      position: input.position,
      domainData: input.domainData,
    });
    const rawOutput = await input.stage.evaluate(context);
    const output = parseStageOutput(
      input.stage as CoreEvaluationStage<unknown>,
      rawOutput,
    );
    await input.repository.completeStage({
      evaluationId: snapshot.id,
      opportunityId: snapshot.opportunityId,
      stageResultId: started.id,
      stageId: input.stage.id,
      output,
    });
    return "COMPLETED";
  } catch (error) {
    await input.repository.failStage({
      stageResultId: started.id,
      failure: stageFailure(
        error,
        input.stage as CoreEvaluationStage<unknown>,
      ),
    });
    return "FAILED";
  }
}

async function executePendingStages<TDomainData>(input: {
  repository: EvaluationRepository;
  evaluator: DomainEvaluatorDefinition<TDomainData, unknown>;
  evaluationId: string;
  subject: EvaluationSubject;
  domainData: TDomainData;
}): Promise<void> {
  for (const [position, stage] of input.evaluator.stages.entries()) {
    const snapshot = await input.repository.getEvaluationSnapshot(
      input.evaluationId,
    );
    if (!snapshot) throw new Error("Evaluation does not exist");
    const current = snapshot.stageResults.find(
      (result) => result.stageId === stage.id,
    );
    if (!current || current.status === "COMPLETED") continue;
    if (current.status === "FAILED") continue;

    const status = await runStage({
      repository: input.repository,
      subject: input.subject,
      domainData: input.domainData,
      stage,
      position,
      evaluationId: input.evaluationId,
    });
    if (status === "FAILED" && stage.onFailure === "STOP") return;
  }
}

async function finalize<TResult, TDomainData>(input: {
  repository: EvaluationRepository;
  evaluator: DomainEvaluatorDefinition<TDomainData, TResult>;
  subject: EvaluationSubject;
  domainData: TDomainData;
  evaluationId: string;
}): Promise<CoreEvaluationResult<TResult>> {
  let snapshot = await input.repository.getEvaluationSnapshot(input.evaluationId);
  if (!snapshot) throw new Error("Evaluation does not exist");
  const failures = snapshot.stageResults.filter(
    (stage) => stage.status === "FAILED",
  );
  const pending = snapshot.stageResults.filter(
    (stage) => stage.status === "PENDING" || stage.status === "RUNNING",
  );

  if (failures.length > 0 || pending.length > 0) {
    const reason = failures.length
      ? `Failed stages: ${failures.map((stage) => stage.stageId).join(", ")}`
      : `Incomplete stages: ${pending.map((stage) => stage.stageId).join(", ")}`;
    await input.repository.finishEvaluation({
      evaluationId: snapshot.id,
      status: "FAILED",
      errorMessage: reason,
    });
    snapshot = evaluationSnapshotSchema.parse(
      await input.repository.getEvaluationSnapshot(snapshot.id),
    );
    return { evaluation: snapshot, domainResult: null };
  }

  const context = buildContext({
    snapshot,
    subject: input.subject,
    position: input.evaluator.stages.length,
    domainData: input.domainData,
  });
  let domainResult: TResult;
  try {
    domainResult = input.evaluator.resultSchema.parse(
      await input.evaluator.finalize(context),
    );
  } catch (error) {
    await input.repository.finishEvaluation({
      evaluationId: snapshot.id,
      status: "FAILED",
      errorMessage: `Final domain result validation failed: ${
        error instanceof Error ? error.message : "Unknown finalization failure"
      }`,
    });
    snapshot = evaluationSnapshotSchema.parse(
      await input.repository.getEvaluationSnapshot(snapshot.id),
    );
    return { evaluation: snapshot, domainResult: null };
  }
  await input.repository.finishEvaluation({
    evaluationId: snapshot.id,
    status: "COMPLETED",
    errorMessage: null,
  });
  snapshot = evaluationSnapshotSchema.parse(
    await input.repository.getEvaluationSnapshot(snapshot.id),
  );
  return { evaluation: snapshot, domainResult };
}

export function createEvaluationExecutor(repository: EvaluationRepository) {
  return {
    async execute<TDomainData, TResult>(input: {
      opportunityId: string;
      userProfileId?: string | null;
      executionMetadata?: Record<string, JsonValue>;
      evaluator: DomainEvaluatorDefinition<TDomainData, TResult>;
      domainData: TDomainData;
    }): Promise<CoreEvaluationResult<TResult>> {
      const request = executionInputSchema.parse({
        opportunityId: input.opportunityId,
        userProfileId: input.userProfileId ?? null,
        executionMetadata: input.executionMetadata ?? {},
      });
      const subject = await repository.loadSubject(request);
      if (!subject) throw new Error("Opportunity or user profile does not exist");
      if (subject.opportunity.status !== "NORMALIZED") {
        throw new Error("Only a NORMALIZED Opportunity can be evaluated");
      }

      const evaluationId = await repository.createEvaluation({
        opportunityId: request.opportunityId,
        userProfileId: request.userProfileId,
        userProfileVersion: subject.userProfile?.version ?? null,
        evaluator: input.evaluator as DomainEvaluatorDefinition<unknown, unknown>,
        executionMetadata: request.executionMetadata,
      });
      await repository.markEvaluationRunning(evaluationId);
      await executePendingStages({
        repository,
        evaluator: input.evaluator,
        evaluationId,
        subject,
        domainData: input.domainData,
      });
      return finalize({
        repository,
        evaluator: input.evaluator,
        subject,
        domainData: input.domainData,
        evaluationId,
      });
    },

    async retryStage<TDomainData, TResult>(input: {
      evaluationId: string;
      stageId: string;
      evaluator: DomainEvaluatorDefinition<TDomainData, TResult>;
      domainData: TDomainData;
    }): Promise<CoreEvaluationResult<TResult>> {
      const evaluationId = z.uuid().parse(input.evaluationId);
      const stageId = z.string().trim().min(1).parse(input.stageId);
      const snapshot = await repository.getEvaluationSnapshot(evaluationId);
      if (!snapshot) throw new Error("Evaluation does not exist");
      if (
        snapshot.domain !== input.evaluator.domain ||
        snapshot.evaluationVersion !== input.evaluator.evaluationVersion ||
        snapshot.domainVersion !== input.evaluator.domainVersion ||
        snapshot.ruleVersion !== input.evaluator.ruleVersion
      ) {
        throw new Error("Retry evaluator versions do not match the evaluation");
      }

      const stage = input.evaluator.stages.find((item) => item.id === stageId);
      const persisted = snapshot.stageResults.find(
        (item) => item.stageId === stageId,
      );
      if (!stage || !persisted) throw new Error("Evaluation stage does not exist");
      if (persisted.status !== "FAILED" || !persisted.retryable) {
        throw new Error("Evaluation stage is not eligible for retry");
      }
      if (persisted.attempt >= stage.maxAttempts) {
        throw new Error("Evaluation stage has exhausted its retry attempts");
      }

      const subject = await repository.loadSubject({
        opportunityId: snapshot.opportunityId,
        userProfileId: snapshot.userProfileId,
      });
      if (!subject) throw new Error("Evaluation subject no longer exists");
      await repository.markEvaluationRunning(snapshot.id);
      const position = input.evaluator.stages.findIndex(
        (item) => item.id === stage.id,
      );
      const status = await runStage({
        repository,
        subject,
        domainData: input.domainData,
        stage,
        position,
        evaluationId: snapshot.id,
      });

      if (status === "COMPLETED") {
        await executePendingStages({
          repository,
          evaluator: input.evaluator,
          evaluationId: snapshot.id,
          subject,
          domainData: input.domainData,
        });
      }
      return finalize({
        repository,
        evaluator: input.evaluator,
        subject,
        domainData: input.domainData,
        evaluationId: snapshot.id,
      });
    },
  };
}
