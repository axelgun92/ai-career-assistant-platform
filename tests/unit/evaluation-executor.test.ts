import {
  createEvaluationExecutor,
  defineDomainEvaluator,
  defineEvaluationStage,
} from "@ai-career/evaluation";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createNeutralEvaluator } from "../fixtures/neutral-evaluator";
import {
  createNeutralEvaluationSubject,
  InMemoryEvaluationRepository,
} from "../support/in-memory-evaluation-repository";

describe("Core evaluation executor", () => {
  it("executes neutral stages in order and carries validated context forward", async () => {
    const subject = createNeutralEvaluationSubject();
    const repository = new InMemoryEvaluationRepository(subject);
    const executor = createEvaluationExecutor(repository);
    const domainData = { executionOrder: [] as string[], failStageThree: false };

    const result = await executor.execute({
      opportunityId: subject.opportunity.id,
      evaluator: createNeutralEvaluator(),
      domainData,
      executionMetadata: { trigger: "unit-test" },
    });

    expect(domainData.executionOrder).toEqual([
      "stage-one",
      "stage-two",
      "stage-three",
    ]);
    expect(result.evaluation.status).toBe("COMPLETED");
    expect(result.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);
    expect(result.evaluation.stageResults[1]?.result?.data).toEqual({
      sequence: ["stage-one", "stage-two"],
    });
    expect(result.evaluation.evidenceRecords).toHaveLength(3);
    expect(result.evaluation.evidenceRecords[0]).toEqual(
      expect.objectContaining({
        sourceRecordId: subject.rawSources[0]?.id,
        origin: "EXPLICIT",
      }),
    );
    expect(result.evaluation.contradictions).toHaveLength(1);
    expect(result.evaluation.contradictions[0]).toEqual(
      expect.objectContaining({
        resolutionStatus: "UNRESOLVED",
        evidenceIdsA: [result.evaluation.evidenceRecords[1]?.id],
        evidenceIdsB: [result.evaluation.evidenceRecords[2]?.id],
      }),
    );
    expect(result.domainResult).toEqual({
      completedStageIds: ["stage-one", "stage-two", "stage-three"],
      unknownCount: 1,
    });
    expect(result.evaluation).toEqual(
      expect.objectContaining({
        evaluationVersion: "test-evaluation-v1",
        domainVersion: "test-domain-v1",
        ruleVersion: "test-rules-v1",
        promptVersion: null,
        executionMetadata: { trigger: "unit-test" },
      }),
    );
    expect(subject.opportunity.status).toBe("NORMALIZED");
  });

  it("isolates a retryable failure, preserves prior stages, and resumes", async () => {
    const subject = createNeutralEvaluationSubject();
    const repository = new InMemoryEvaluationRepository(subject);
    const executor = createEvaluationExecutor(repository);
    const evaluator = createNeutralEvaluator();
    const domainData = { executionOrder: [] as string[], failStageThree: true };

    const failed = await executor.execute({
      opportunityId: subject.opportunity.id,
      evaluator,
      domainData,
    });
    const priorIds = failed.evaluation.stageResults.slice(0, 2).map(({ id }) => id);

    expect(failed.evaluation.status).toBe("FAILED");
    expect(failed.evaluation.stageResults[2]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        retryable: true,
        failureCode: "NEUTRAL_TRANSIENT_FAILURE",
        attempt: 1,
      }),
    );

    domainData.failStageThree = false;
    const recovered = await executor.retryStage({
      evaluationId: failed.evaluation.id,
      stageId: "stage-three",
      evaluator,
      domainData,
    });

    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults.slice(0, 2).map(({ id }) => id)).toEqual(
      priorIds,
    );
    expect(recovered.evaluation.stageResults[2]).toEqual(
      expect.objectContaining({
        status: "COMPLETED",
        retryable: false,
        failureCode: null,
        attempt: 2,
      }),
    );
  });

  it("continues after an isolated stage failure only when policy says CONTINUE", async () => {
    const subject = createNeutralEvaluationSubject();
    const repository = new InMemoryEvaluationRepository(subject);
    const executor = createEvaluationExecutor(repository);
    const executionOrder: string[] = [];
    const output = {
      classification: null,
      data: {},
      evidence: [],
      findings: [],
      strengths: [],
      concerns: [],
      unknowns: [],
      contradictions: [],
      confidence: null,
      completeness: "COMPLETE" as const,
    };
    const evaluator = defineDomainEvaluator({
      domain: "neutral-continue",
      evaluationVersion: "test-v1",
      domainVersion: "test-v1",
      ruleVersion: "test-v1",
      promptVersion: null,
      stages: [
        defineEvaluationStage({
          id: "failing-stage",
          version: "test-v1",
          ruleVersion: "test-v1",
          promptVersion: null,
          onFailure: "CONTINUE",
          maxAttempts: 1,
          invalidOutputRetryable: false,
          dataSchema: z.object({}).strict(),
          async evaluate() {
            executionOrder.push("failing-stage");
            throw new Error("Neutral non-retryable failure");
          },
        }),
        defineEvaluationStage({
          id: "continuing-stage",
          version: "test-v1",
          ruleVersion: "test-v1",
          promptVersion: null,
          onFailure: "STOP",
          maxAttempts: 1,
          invalidOutputRetryable: false,
          dataSchema: z.object({}).strict(),
          async evaluate() {
            executionOrder.push("continuing-stage");
            return output;
          },
        }),
      ],
      resultSchema: z.object({ done: z.boolean() }).strict(),
      async finalize() {
        return { done: true };
      },
    });

    const result = await executor.execute({
      opportunityId: subject.opportunity.id,
      evaluator,
      domainData: {},
    });

    expect(executionOrder).toEqual(["failing-stage", "continuing-stage"]);
    expect(result.evaluation.status).toBe("FAILED");
    expect(result.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "FAILED",
      "COMPLETED",
    ]);
  });

  it("rejects invalid structured output instead of persisting it as success", async () => {
    const subject = createNeutralEvaluationSubject();
    const repository = new InMemoryEvaluationRepository(subject);
    const executor = createEvaluationExecutor(repository);
    const evaluator = defineDomainEvaluator({
      domain: "neutral-invalid",
      evaluationVersion: "test-v1",
      domainVersion: "test-v1",
      ruleVersion: "test-v1",
      promptVersion: null,
      stages: [
        defineEvaluationStage({
          id: "invalid-stage",
          version: "test-v1",
          ruleVersion: "test-v1",
          promptVersion: null,
          onFailure: "STOP",
          maxAttempts: 2,
          invalidOutputRetryable: true,
          dataSchema: z.object({ valid: z.boolean() }).strict(),
          async evaluate() {
            return { data: { valid: true }, unsupported: "not allowed" };
          },
        }),
      ],
      resultSchema: z.object({ done: z.boolean() }).strict(),
      async finalize() {
        return { done: true };
      },
    });

    const result = await executor.execute({
      opportunityId: subject.opportunity.id,
      evaluator,
      domainData: {},
    });

    expect(result.domainResult).toBeNull();
    expect(result.evaluation.stageResults[0]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        retryable: true,
        failureCode: "STRUCTURED_OUTPUT_INVALID",
        result: null,
      }),
    );
  });

  it("rejects evidence references that were not declared by the stage", async () => {
    const subject = createNeutralEvaluationSubject();
    const repository = new InMemoryEvaluationRepository(subject);
    const executor = createEvaluationExecutor(repository);
    const evaluator = defineDomainEvaluator({
      domain: "neutral-invalid-evidence",
      evaluationVersion: "test-v1",
      domainVersion: "test-v1",
      ruleVersion: "test-v1",
      promptVersion: null,
      stages: [
        defineEvaluationStage({
          id: "evidence-stage",
          version: "test-v1",
          ruleVersion: "test-v1",
          promptVersion: null,
          onFailure: "STOP",
          maxAttempts: 2,
          invalidOutputRetryable: true,
          dataSchema: z.object({ valid: z.boolean() }).strict(),
          async evaluate() {
            return {
              classification: null,
              data: { valid: true },
              evidence: [],
              findings: [],
              strengths: [],
              concerns: [],
              unknowns: [],
              contradictions: [
                {
                  claimA: "Claim A",
                  claimB: "Claim B",
                  interpretation: "Claims conflict.",
                  relevantField: null,
                  significance: null,
                  evidenceReferencesA: ["missing-a"],
                  evidenceReferencesB: ["missing-b"],
                },
              ],
              confidence: null,
              completeness: "PARTIAL",
            };
          },
        }),
      ],
      resultSchema: z.object({ done: z.boolean() }).strict(),
      async finalize() {
        return { done: true };
      },
    });

    const result = await executor.execute({
      opportunityId: subject.opportunity.id,
      evaluator,
      domainData: {},
    });

    expect(result.evaluation.stageResults[0]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        retryable: true,
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
    expect(result.evaluation.evidenceRecords).toHaveLength(0);
    expect(result.evaluation.contradictions).toHaveLength(0);
  });

  it("marks the evaluation failed when the final domain result is invalid", async () => {
    const subject = createNeutralEvaluationSubject();
    const repository = new InMemoryEvaluationRepository(subject);
    const executor = createEvaluationExecutor(repository);
    const evaluator = defineDomainEvaluator({
      domain: "neutral-invalid-final",
      evaluationVersion: "test-v1",
      domainVersion: "test-v1",
      ruleVersion: "test-v1",
      promptVersion: null,
      stages: [
        defineEvaluationStage({
          id: "valid-stage",
          version: "test-v1",
          ruleVersion: "test-v1",
          promptVersion: null,
          onFailure: "STOP",
          maxAttempts: 1,
          invalidOutputRetryable: false,
          dataSchema: z.object({ valid: z.boolean() }).strict(),
          async evaluate() {
            return {
              classification: null,
              data: { valid: true },
              evidence: [],
              findings: [],
              strengths: [],
              concerns: [],
              unknowns: [],
              contradictions: [],
              confidence: null,
              completeness: "COMPLETE",
            };
          },
        }),
      ],
      resultSchema: z.object({ done: z.literal(true) }).strict(),
      async finalize() {
        return { done: false };
      },
    });

    const result = await executor.execute({
      opportunityId: subject.opportunity.id,
      evaluator,
      domainData: {},
    });

    expect(result.domainResult).toBeNull();
    expect(result.evaluation.status).toBe("FAILED");
    expect(result.evaluation.stageResults[0]?.status).toBe("COMPLETED");
    expect(result.evaluation.errorMessage).toContain(
      "Final domain result validation failed",
    );
  });

  it("rejects duplicate stage identifiers when defining an evaluator", () => {
    const repeated = defineEvaluationStage({
      id: "repeated-stage",
      version: "test-v1",
      ruleVersion: "test-v1",
      promptVersion: null,
      onFailure: "STOP",
      maxAttempts: 1,
      invalidOutputRetryable: false,
      dataSchema: z.object({}).strict(),
      async evaluate() {
        return {};
      },
    });

    expect(() =>
      defineDomainEvaluator({
        domain: "neutral-duplicate",
        evaluationVersion: "test-v1",
        domainVersion: "test-v1",
        ruleVersion: "test-v1",
        promptVersion: null,
        stages: [repeated, repeated],
        resultSchema: z.object({}).strict(),
        async finalize() {
          return {};
        },
      }),
    ).toThrow("Duplicate evaluation stage identifier");
  });

  it.each([
    "EVALUATED",
    "RECOMMENDED",
    "SAVED",
    "APPLIED",
    "REJECTED_BY_USER",
    "CLOSED",
    "ARCHIVED",
  ] as const)(
    "evaluates an opportunity that was normalized and later moved to %s without changing its status",
    async (status) => {
      const subject = createNeutralEvaluationSubject();
      subject.opportunity.status = status;
      const repository = new InMemoryEvaluationRepository(subject);
      const executor = createEvaluationExecutor(repository);

      const result = await executor.execute({
        opportunityId: subject.opportunity.id,
        evaluator: createNeutralEvaluator(),
        domainData: { executionOrder: [] as string[], failStageThree: false },
      });

      expect(result.evaluation.status).toBe("COMPLETED");
      // Core still never mutates the Opportunity lifecycle.
      expect(subject.opportunity.status).toBe(status);
    },
  );

  it("still refuses to evaluate an opportunity that has not been normalized", async () => {
    const subject = createNeutralEvaluationSubject();
    subject.opportunity.status = "DISCOVERED";
    const repository = new InMemoryEvaluationRepository(subject);
    const executor = createEvaluationExecutor(repository);

    await expect(
      executor.execute({
        opportunityId: subject.opportunity.id,
        evaluator: createNeutralEvaluator(),
        domainData: { executionOrder: [] as string[], failStageThree: false },
      }),
    ).rejects.toThrow("Only a normalized Opportunity can be evaluated");
  });

  it("lets an in-flight evaluation finish after the opportunity leaves NORMALIZED", async () => {
    const subject = createNeutralEvaluationSubject();
    const repository = new InMemoryEvaluationRepository(subject);
    const executor = createEvaluationExecutor(repository);
    const evaluator = createNeutralEvaluator();
    const domainData = { executionOrder: [] as string[], failStageThree: true };

    const failed = await executor.execute({
      opportunityId: subject.opportunity.id,
      evaluator,
      domainData,
    });
    expect(failed.evaluation.status).toBe("FAILED");

    // A user action moves the opportunity on while its evaluation is resumable.
    subject.opportunity.status = "SAVED";
    domainData.failStageThree = false;
    const resumed = await executor.retryStage({
      evaluationId: failed.evaluation.id,
      stageId: "stage-three",
      evaluator,
      domainData,
    });
    expect(resumed.evaluation.status).toBe("COMPLETED");
    const rerun = await executor.executeExisting({
      evaluationId: failed.evaluation.id,
      evaluator,
      domainData,
    });
    expect(rerun.evaluation.status).toBe("COMPLETED");
    expect(subject.opportunity.status).toBe("SAVED");
  });
});
