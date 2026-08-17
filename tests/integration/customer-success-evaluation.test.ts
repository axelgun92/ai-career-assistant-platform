import {
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
} from "@ai-career/customer-success";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
} from "@ai-career/database";
import { createEvaluationExecutor } from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
} from "../fixtures/customer-success";

const database = getDatabaseClient();
const opportunityIds: string[] = [];

afterEach(async () => {
  for (const id of opportunityIds.splice(0)) {
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

describe("Customer Success evaluation PostgreSQL integration", () => {
  it("runs a normalized manual JD through reconstruction and both CS stages", async () => {
    const manualService = createManualOpportunityService({
      repository: new PrismaManualOpportunityRepository(),
      normalizer: createManualOpportunityNormalizer(),
      clock: () => new Date("2026-08-17T12:00:00.000Z"),
    });
    const detail = await manualService.submit({
      domain: "customer-success",
      title: "Customer Support Manager",
      company: "Example Technology",
      location: "United States",
      compensationText: "$70,000-$90,000",
      sourceUrl: "https://example.test/customer-success-integration",
      rawText: [
        "This is a remote United States-only role working PST hours.",
        "Own customer adoption, success plans, retention, and business reviews.",
        "Collaborate with Product to share customer feedback.",
        "Use product analytics and collaborate with engineering on API integrations.",
        "3+ years of Customer Success experience required.",
        "Salesforce experience preferred.",
      ].join("\n"),
    });
    opportunityIds.push(detail.opportunity.id);

    const fixture = createCustomerSuccessFixtureOperations({
      scenario: "misleading-title",
    });
    const result = await createEvaluationExecutor(
      new PrismaEvaluationRepository(),
    ).execute({
      opportunityId: detail.opportunity.id,
      evaluator: createCustomerSuccessEvaluator(),
      domainData: createCustomerSuccessDomainData({
        preferences: customerSuccessTestPreferences,
        semanticOperations: fixture.semanticOperations,
      }),
      executionMetadata: { trigger: "milestone-four-integration-test" },
    });

    const persisted = await database.evaluation.findUniqueOrThrow({
      where: { id: result.evaluation.id },
      include: {
        opportunity: { select: { status: true } },
        stageResults: { orderBy: { position: "asc" } },
        evidenceRecords: true,
        contradictions: true,
      },
    });

    expect(persisted).toEqual(
      expect.objectContaining({
        domain: "customer-success",
        status: "COMPLETED",
        evaluationVersion: "cs-evaluation-v1.1-m4",
        domainVersion: "customer-success-v1.1",
        ruleVersion: "cs-rules-v1.1",
        promptVersion: "cs-m4-prompts-v1",
        executionMetadata: { trigger: "milestone-four-integration-test" },
      }),
    );
    expect(persisted.opportunity.status).toBe("NORMALIZED");
    expect(persisted.stageResults.map((stage) => stage.stageId)).toEqual([
      "hard-filters",
      "job-evaluation",
    ]);
    expect(persisted.stageResults.every((stage) => stage.status === "COMPLETED"))
      .toBe(true);
    expect(persisted.stageResults[0]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          role: expect.objectContaining({ classification: "CORE_CS" }),
          reconstruction: expect.objectContaining({
            responsibilityMap: expect.any(Object),
            requirements: expect.arrayContaining([
              expect.objectContaining({ strength: "REQUIRED" }),
              expect.objectContaining({ strength: "PREFERRED" }),
            ]),
            ownershipMap: expect.any(Object),
          }),
        }),
      }),
    );
    expect(persisted.stageResults[1]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluated: true,
          roleClassification: "CORE_CS",
        }),
      }),
    );
    expect(persisted.evidenceRecords.length).toBeGreaterThan(0);
    expect(
      persisted.evidenceRecords.every(
        (record) =>
          record.sourceRecordId === detail.sourceRecords[0]?.id &&
          record.stageId !== null,
      ),
    ).toBe(true);
    expect(result.domainResult?.jobEvaluation.evaluated).toBe(true);
    expect(fixture.stats.reconstructionCalls).toBe(1);
    expect(fixture.stats.jobEvaluationCalls).toBe(1);
  });
});
