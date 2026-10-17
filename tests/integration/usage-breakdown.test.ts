import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { budgetPeriod } from "@ai-career/core";
import { PrismaBudgetRepository } from "@ai-career/database";
import {
  captureOpportunity,
  createCleanup,
  createHarness,
  createProfile,
  database,
  recordAttempt,
} from "../support/budget-integration";

// G6: provider-reported usage and known spend by domain and job source.
// This suite's attempts are moved to their own domain/source labels (seed
// data on the isolated test database), so other rows never affect it.

const clock = { now: new Date() };
const cleanup = createCleanup();
const harness = createHarness(clock);

beforeEach(async () => {
  clock.now = new Date();
  await cleanup.before();
});
afterEach(() => cleanup.after());
afterAll(() => database.$disconnect());

describe("usage and spend by domain and source", () => {
  it("groups attempts by domain and source, never counting unknown or other-currency cost as zero", async () => {
    const profile = await createProfile(cleanup);
    const token = randomUUID().slice(0, 8);
    const queued = async () => {
      const opportunityId = await captureOpportunity(cleanup);
      const result = await harness.service.requestEvaluation(opportunityId, { userProfileId: profile.id });
      return (result as { evaluationId: string }).evaluationId;
    };
    const first = await queued();
    const second = await queued();
    await recordAttempt(first, 1, 0.01, clock.now);
    await recordAttempt(first, 2, null, clock.now); // neither tokens nor cost reported
    await recordAttempt(second, 1, 0.02, clock.now);
    await database.semanticOperationAttempt.updateMany({ where: { evaluationId: first }, data: { domain: `usage-${token}`, jobSource: `alpha-${token}` } });
    await database.semanticOperationAttempt.updateMany({ where: { evaluationId: second }, data: { domain: `usage-${token}`, jobSource: `beta-${token}` } });

    const repository = new PrismaBudgetRepository();
    const period = budgetPeriod(clock.now, "UTC");
    const rows = (await repository.periodUsageBreakdown({ period, currency: "USD" })).filter((row) => row.domain === `usage-${token}`);
    expect(rows).toEqual([
      expect.objectContaining({ source: `alpha-${token}`, sourceType: "MANUAL", attempts: 2, evaluations: 1, totalTokens: 1200, attemptsWithoutTotalTokens: 1, knownCost: 0.01, unknownCostAttempts: 1 }),
      expect.objectContaining({ source: `beta-${token}`, sourceType: "MANUAL", attempts: 1, evaluations: 1, totalTokens: 1200, attemptsWithoutTotalTokens: 0, knownCost: 0.02, unknownCostAttempts: 0 }),
    ]);

    // Another currency: nothing is known, every attempt is reported as unknown.
    const eur = (await repository.periodUsageBreakdown({ period, currency: "EUR" })).filter((row) => row.domain === `usage-${token}`);
    expect(eur.map((row) => [row.knownCost, row.unknownCostAttempts])).toEqual([[0, 2], [0, 1]]);
    // Without a reporting currency, spend is Unknown rather than zero.
    const none = (await repository.periodUsageBreakdown({ period, currency: null })).filter((row) => row.domain === `usage-${token}`);
    expect(none.map((row) => [row.knownCost, row.unknownCostAttempts])).toEqual([[null, 2], [null, 1]]);

    // Outside the period nothing is counted.
    const earlier = budgetPeriod(new Date(clock.now.getTime() - 62 * 24 * 3600 * 1000), "UTC");
    expect((await repository.periodUsageBreakdown({ period: earlier, currency: "USD" })).filter((row) => row.domain === `usage-${token}`)).toEqual([]);

    // The report carries it, with no credentials or provider detail.
    const report = await harness.budget.report();
    expect(report.usageBreakdown.filter((row) => row.domain === `usage-${token}`)).toHaveLength(2);
    expect(JSON.stringify(report)).not.toMatch(/req-budget|deterministic-integration-key/);
  });
});
