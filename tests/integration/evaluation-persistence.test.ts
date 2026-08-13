import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
} from "@ai-career/database";
import { createEvaluationExecutor } from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createNeutralEvaluator } from "../fixtures/neutral-evaluator";

const database = getDatabaseClient();
const createdOpportunityIds: string[] = [];

afterEach(async () => {
  for (const id of createdOpportunityIds.splice(0)) {
    const opportunity = await database.opportunity.findUnique({
      where: { id },
      select: { companyId: true },
    });
    await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
    await database.opportunity.deleteMany({ where: { id } });
    if (opportunity?.companyId) {
      await database.company.deleteMany({ where: { id: opportunity.companyId } });
    }
  }
});

afterAll(async () => {
  await database.$disconnect();
});

describe("Core evaluation PostgreSQL persistence", () => {
  it("persists ordered results, evidence, unknowns, contradictions, and versions", async () => {
    const manualService = createManualOpportunityService({
      repository: new PrismaManualOpportunityRepository(),
      normalizer: createManualOpportunityNormalizer(),
      clock: () => new Date("2026-08-13T20:00:00.000Z"),
    });
    const detail = await manualService.submit({
      rawText: "Neutral integration source text",
      title: "Neutral Integration Opportunity",
      sourceUrl: "https://example.test/integration",
    });
    createdOpportunityIds.push(detail.opportunity.id);

    const executor = createEvaluationExecutor(new PrismaEvaluationRepository());
    const result = await executor.execute({
      opportunityId: detail.opportunity.id,
      evaluator: createNeutralEvaluator(),
      domainData: { executionOrder: [], failStageThree: false },
      executionMetadata: { trigger: "postgres-integration-test" },
    });

    const persisted = await database.evaluation.findUniqueOrThrow({
      where: { id: result.evaluation.id },
      include: {
        stageResults: { orderBy: { position: "asc" } },
        evidenceRecords: { orderBy: { createdAt: "asc" } },
        contradictions: true,
        opportunity: { select: { status: true } },
      },
    });

    expect(persisted.status).toBe("COMPLETED");
    expect(persisted.opportunity.status).toBe("NORMALIZED");
    expect(persisted).toEqual(
      expect.objectContaining({
        domain: "neutral-test",
        evaluationVersion: "test-evaluation-v1",
        domainVersion: "test-domain-v1",
        ruleVersion: "test-rules-v1",
        promptVersion: null,
        userProfileVersion: null,
        executionMetadata: { trigger: "postgres-integration-test" },
      }),
    );
    expect(persisted.stageResults.map((stage) => stage.stageId)).toEqual([
      "stage-one",
      "stage-two",
      "stage-three",
    ]);
    expect(persisted.stageResults.every((stage) => stage.status === "COMPLETED"))
      .toBe(true);
    expect(persisted.stageResults[0]?.result).toEqual(
      expect.objectContaining({
        unknowns: [
          expect.objectContaining({ code: "missing-neutral-detail" }),
        ],
      }),
    );
    expect(persisted.evidenceRecords).toHaveLength(3);
    expect(persisted.evidenceRecords[0]).toEqual(
      expect.objectContaining({
        sourceRecordId: detail.sourceRecords[0]?.id,
        sourceField: "rawDescription",
        evidenceType: "SOURCE_FACT",
        origin: "EXPLICIT",
      }),
    );
    expect(persisted.contradictions).toHaveLength(1);
    expect(persisted.contradictions[0]).toEqual(
      expect.objectContaining({
        stageId: "stage-two",
        relevantField: "neutralField",
        resolutionStatus: "UNRESOLVED",
        evidenceIdsA: [persisted.evidenceRecords[1]?.id],
        evidenceIdsB: [persisted.evidenceRecords[2]?.id],
      }),
    );
  });

  it("retries an eligible persisted failure without replacing prior results", async () => {
    const manualService = createManualOpportunityService({
      repository: new PrismaManualOpportunityRepository(),
      normalizer: createManualOpportunityNormalizer(),
    });
    const detail = await manualService.submit({
      rawText: "Neutral retry integration source text",
      sourceUrl: "https://example.test/retry",
    });
    createdOpportunityIds.push(detail.opportunity.id);

    const executor = createEvaluationExecutor(new PrismaEvaluationRepository());
    const evaluator = createNeutralEvaluator();
    const domainData = { executionOrder: [] as string[], failStageThree: true };
    const failed = await executor.execute({
      opportunityId: detail.opportunity.id,
      evaluator,
      domainData,
    });
    const priorResultIds = failed.evaluation.stageResults
      .slice(0, 2)
      .map((stage) => stage.id);
    const originalStartedAt = failed.evaluation.startedAt;

    domainData.failStageThree = false;
    const recovered = await executor.retryStage({
      evaluationId: failed.evaluation.id,
      stageId: "stage-three",
      evaluator,
      domainData,
    });

    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.startedAt).toEqual(originalStartedAt);
    expect(recovered.evaluation.stageResults.slice(0, 2).map((stage) => stage.id))
      .toEqual(priorResultIds);
    expect(recovered.evaluation.stageResults[2]).toEqual(
      expect.objectContaining({
        status: "COMPLETED",
        attempt: 2,
        retryable: false,
      }),
    );
  });
});
