import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaUsageSummaryRepository,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { testSemanticPricing } from "../fixtures/semantic-pricing";

const database = getDatabaseClient();
const tasks = new PrismaEvaluationTaskRepository();
const repository = new PrismaUsageSummaryRepository();
const createdOpportunityIds: string[] = [];

beforeEach(async () => {
  // Totals are global; this suite needs an empty attempts table to be exact.
  expect(await database.semanticOperationAttempt.count()).toBe(0);
});

afterEach(async () => {
  for (const id of createdOpportunityIds.splice(0)) {
    const opportunity = await database.opportunity.findUnique({ where: { id }, select: { companyId: true } });
    await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
    await database.opportunity.deleteMany({ where: { id } }); // cascades evaluations and attempts
    if (opportunity?.companyId) await database.company.deleteMany({ where: { id: opportunity.companyId } });
  }
});

afterAll(async () => {
  await database.$disconnect();
});

async function createEvaluation() {
  const detail = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({ rawText: "Usage summary integration JD", domain: "customer-success" });
  createdOpportunityIds.push(detail.opportunity.id);
  const evaluation = await database.evaluation.create({
    data: {
      opportunityId: detail.opportunity.id,
      domain: "customer-success",
      status: "COMPLETED",
      evaluationVersion: "usage-test",
      domainVersion: "usage-test",
      ruleVersion: "usage-test",
    },
  });
  return evaluation.id;
}

// Recorded through the existing production recorder, unchanged.
async function recordAttempt(
  evaluationId: string,
  attempt: number,
  usage: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null },
  estimatedCost: number | null,
) {
  await tasks.recordSemanticOperation(evaluationId, {
    operationId: "customer-success.job-evaluation",
    promptVersion: "usage-test",
    attempt,
    provider: "openai",
    model: testSemanticPricing.model,
    status: "SUCCESS",
    usage: {
      ...usage,
      cachedInputTokens: 0,
      totalTokens: usage.inputTokens !== null && usage.outputTokens !== null ? usage.inputTokens + usage.outputTokens : null,
    },
    estimatedCost,
    // As in production: pricing is always attached; cost is null when usage was not reported.
    pricingConfiguration: testSemanticPricing,
    durationMs: 10,
    providerRequestId: `req-usage-${evaluationId}-${attempt}`,
    errorCode: null,
    errorMessage: null,
  });
}

describe("usage totals across evaluations", () => {
  it("reports no usage when nothing has been recorded", async () => {
    const totals = await repository.summarizeAllUsage();
    expect(totals).toMatchObject({ evaluationCount: 0, attemptsWithoutCost: 0 });
    expect(totals.usage).toMatchObject({ attemptCount: 0, totalTokens: null, estimatedCost: null });
  });

  it("sums recorded attempts across evaluations with summarizeSemanticUsage", async () => {
    const first = await createEvaluation();
    const second = await createEvaluation();
    await recordAttempt(first, 1, { inputTokens: 1000, outputTokens: 200, reasoningTokens: 20 }, 0.0044);
    await recordAttempt(first, 2, { inputTokens: 500, outputTokens: 100, reasoningTokens: 10 }, 0.0022);
    await recordAttempt(second, 1, { inputTokens: 2000, outputTokens: 400, reasoningTokens: 40 }, 0.0088);

    const totals = await repository.summarizeAllUsage();

    expect(totals.evaluationCount).toBe(2);
    expect(totals.attemptsWithoutCost).toBe(0);
    expect(totals.usage).toEqual({
      attemptCount: 3,
      inputTokens: 3500,
      outputTokens: 700,
      cachedInputTokens: 0,
      reasoningTokens: 70,
      totalTokens: 4200,
      estimatedCost: 0.0154,
      currency: "USD",
      pricingConfigurationVersions: [testSemanticPricing.version],
    });
  });

  it("keeps totals Unknown when any attempt did not report a value", async () => {
    const evaluationId = await createEvaluation();
    await recordAttempt(evaluationId, 1, { inputTokens: 1000, outputTokens: 200, reasoningTokens: 20 }, 0.0044);
    await recordAttempt(evaluationId, 2, { inputTokens: null, outputTokens: null, reasoningTokens: null }, null);

    const totals = await repository.summarizeAllUsage();

    expect(totals.attemptsWithoutCost).toBe(1);
    expect(totals.usage).toMatchObject({
      attemptCount: 2,
      inputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      estimatedCost: null,
      currency: null,
    });
  });
});
