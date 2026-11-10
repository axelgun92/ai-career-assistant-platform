import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  aiBudgetLimitReason,
  normalizeDeferralReason,
  usageLimitReachedReason,
  budgetSettingsSchema,
  capacityEstimate,
  throughputLimitsReached,
  volumeWindows,
  warningState,
} from "@ai-career/core";
import { BudgetCard } from "../../apps/web/src/components/budget/budget-card";
import { CapacityReport, fillDays } from "../../apps/web/src/components/budget/capacity-report";
import { DeferralReason } from "../../apps/web/src/components/budget/deferral-reason";
import type { BudgetReportView, BudgetSnapshotView, BudgetStatusView } from "../../apps/web/src/components/budget/types";
import { createBudgetApiHandlers, type BudgetService } from "../../apps/web/src/server/budget-service";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { parseThresholds } = await import("../../apps/web/src/components/budget/budget-settings-form");

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("volume windows", () => {
  it("are the local day and the Monday-start week, with exclusive reset times", () => {
    const utc = volumeWindows(new Date("2031-03-12T15:00:00Z"), "UTC"); // Wednesday
    expect(utc.day).toEqual({ label: "2031-03-12", start: new Date("2031-03-12T00:00:00Z"), end: new Date("2031-03-13T00:00:00Z") });
    expect(utc.week).toEqual({ label: "2031-03-10", start: new Date("2031-03-10T00:00:00Z"), end: new Date("2031-03-17T00:00:00Z") });
  });

  it("follow the budget time zone, including Sundays and DST changes", () => {
    // Sunday 23:30 in New York (EDT) is Monday in UTC; it still belongs to the local week.
    const sunday = volumeWindows(new Date("2031-03-17T03:30:00Z"), "America/New_York");
    expect(sunday.day.label).toBe("2031-03-16");
    expect(sunday.week).toMatchObject({ label: "2031-03-10", end: new Date("2031-03-17T04:00:00Z") });
    // The week containing the start of DST (9 March 2031) is 167 hours long.
    const dstWeek = volumeWindows(new Date("2031-03-09T12:00:00Z"), "America/New_York").week;
    expect(dstWeek.start).toEqual(new Date("2031-03-03T05:00:00Z"));
    expect(dstWeek.end).toEqual(new Date("2031-03-10T04:00:00Z"));
    // Across a month and year boundary.
    expect(volumeWindows(new Date("2030-12-31T12:00:00Z"), "UTC").day.end).toEqual(new Date("2031-01-01T00:00:00Z"));
  });
});

describe("warnings, limits and estimates", () => {
  it("raise the highest threshold reached by spent plus reserved, and none without thresholds", () => {
    expect(warningState({ amount: 10, knownSpent: 6, held: 2.5, thresholds: [90, 50, 80] }))
      .toEqual({ usedPercent: 85, reached: 80, thresholds: [50, 80, 90] });
    expect(warningState({ amount: 10, knownSpent: 9.9, held: 0, thresholds: [] }).reached).toBeNull();
    expect(warningState({ amount: 0, knownSpent: 1, held: 0, thresholds: [50] })).toMatchObject({ usedPercent: null, reached: null });
  });

  it("report each throughput limit at or over its value; unset limits never apply", () => {
    const limits = { dailyEvaluationLimit: 2, weeklyEvaluationLimit: 10, monthlyOutputTokenLimit: 1000 };
    expect(throughputLimitsReached(limits, { dailyEvaluations: 1, weeklyEvaluations: 9, outputTokens: 999 })).toEqual([]);
    expect(throughputLimitsReached(limits, { dailyEvaluations: 2, weeklyEvaluations: 10, outputTokens: 1000 }))
      .toEqual(["DAILY_EVALUATIONS", "WEEKLY_EVALUATIONS", "MONTHLY_OUTPUT_TOKENS"]);
    expect(throughputLimitsReached(
      { dailyEvaluationLimit: null, weeklyEvaluationLimit: null, monthlyOutputTokenLimit: null },
      { dailyEvaluations: 99, weeklyEvaluations: 99, outputTokens: 99 },
    )).toEqual([]);
  });

  it("estimate capacity and backlog from recorded costs, and stay Unknown without a basis", () => {
    const usage = { dailyEvaluations: 3, weeklyEvaluations: 4 };
    const known = capacityEstimate({
      recentEvaluationCosts: [0.2, 0.4], remainingBudget: 1.9, dailyEvaluationLimit: 10, weeklyEvaluationLimit: 6,
      usage, deferredCount: 3, eligibleCount: 5,
    });
    expect(known).toEqual({
      averageEvaluationCost: 0.3, basisEvaluations: 2, byBudget: 6, byDailyLimit: 7, byWeeklyLimit: 2, remaining: 2,
      deferredBacklogCost: 0.9, eligibleBacklogCost: 1.5,
    });
    const unknown = capacityEstimate({
      recentEvaluationCosts: [], remainingBudget: 5, dailyEvaluationLimit: null, weeklyEvaluationLimit: null,
      usage, deferredCount: 3, eligibleCount: 5,
    });
    expect(unknown).toMatchObject({ averageEvaluationCost: null, byBudget: null, remaining: null, deferredBacklogCost: null, eligibleBacklogCost: null });
    // A volume limit alone never stands in for an unknown budget capacity.
    expect(capacityEstimate({
      recentEvaluationCosts: [], remainingBudget: 5, dailyEvaluationLimit: 3, weeklyEvaluationLimit: null,
      usage: { dailyEvaluations: 0, weeklyEvaluations: 0 }, deferredCount: 0, eligibleCount: 0,
    })).toMatchObject({ byDailyLimit: 3, remaining: null });
    expect(capacityEstimate({
      recentEvaluationCosts: [], remainingBudget: null, dailyEvaluationLimit: 3, weeklyEvaluationLimit: null,
      usage: { dailyEvaluations: 1, weeklyEvaluations: 1 }, deferredCount: 0, eligibleCount: 0,
    }).remaining).toBe(2);
    expect(capacityEstimate({
      recentEvaluationCosts: [0.5], remainingBudget: -1, dailyEvaluationLimit: null, weeklyEvaluationLimit: null,
      usage, deferredCount: 0, eligibleCount: 0,
    }).byBudget).toBe(0);
  });
});

describe("deferral reasons", () => {
  it("use the TDD name for the dollar budget and read the legacy name as it", () => {
    expect(aiBudgetLimitReason).toBe("AI_BUDGET_LIMIT");
    expect(usageLimitReachedReason).toBe("USAGE_LIMIT_REACHED");
    expect(normalizeDeferralReason("BUDGET_UNAVAILABLE")).toBe("AI_BUDGET_LIMIT");
    expect(normalizeDeferralReason("AI_BUDGET_LIMIT")).toBe("AI_BUDGET_LIMIT");
    expect(normalizeDeferralReason("USAGE_LIMIT_REACHED")).toBe("USAGE_LIMIT_REACHED");
  });
});

describe("limit settings validation", () => {
  const valid = { amount: 5, currency: "USD", timeZone: "UTC", reservePerEvaluation: 0.5, enforced: true };

  it("sorts thresholds and accepts whole-number limits or null", () => {
    expect(budgetSettingsSchema.parse({ ...valid, warningThresholds: [80, 50], dailyEvaluationLimit: 3, monthlyOutputTokenLimit: null }))
      .toMatchObject({ warningThresholds: [50, 80], dailyEvaluationLimit: 3, weeklyEvaluationLimit: null, monthlyOutputTokenLimit: null });
  });

  it.each([
    [{ warningThresholds: [0] }, "warningThresholds.0"],
    [{ warningThresholds: [101] }, "warningThresholds.0"],
    [{ warningThresholds: [50, 50] }, "warningThresholds"],
    [{ warningThresholds: [10, 20, 30, 40, 50, 60] }, "warningThresholds"],
    [{ dailyEvaluationLimit: 0 }, "dailyEvaluationLimit"],
    [{ dailyEvaluationLimit: 1.5 }, "dailyEvaluationLimit"],
    [{ monthlyOutputTokenLimit: -1 }, "monthlyOutputTokenLimit"],
    [{ evaluationCallLimit: 0 }, "evaluationCallLimit"],
    [{ dailyEvaluationLimit: 5, weeklyEvaluationLimit: 4 }, "weeklyEvaluationLimit"],
  ])("rejects %o at %s", (patch, path) => {
    const result = budgetSettingsSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(path);
  });

  it("parses the threshold field leniently and leaves bad entries for the server to reject", () => {
    expect(parseThresholds("50, 80%")).toEqual([50, 80]);
    expect(parseThresholds("")).toEqual([]);
    expect(parseThresholds("50, lots")).toEqual([50, "lots"]);
  });
});

const limits = {
  enforced: true,
  reached: [] as Array<"BUDGET" | "DAILY_EVALUATIONS" | "WEEKLY_EVALUATIONS" | "MONTHLY_OUTPUT_TOKENS">,
  daily: { limit: 2, used: 2, window: "2026-10-14", resetsAt: "2026-10-15T00:00:00.000Z" },
  weekly: { limit: null, used: 3, window: "2026-10-12", resetsAt: "2026-10-19T00:00:00.000Z" },
  outputTokens: { limit: 5000, used: 1200, unreportedAttempts: 1 },
};

const status: Extract<BudgetStatusView, { configured: true }> = {
  configured: true,
  openDeferrals: 1,
  settings: {
    amount: 10, currency: "USD", timeZone: "UTC", enforced: true, reservePerEvaluation: 0.5, periodType: "CALENDAR_MONTH",
    warningThresholds: [50, 80], dailyEvaluationLimit: 2, weeklyEvaluationLimit: null, monthlyOutputTokenLimit: 5000,
    evaluationCallLimit: 12, updatedAt: "2026-10-01T09:30:00.000Z",
  },
  period: { label: "2026-10", start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", timeZone: "UTC" },
  knownSpent: 7.5,
  held: 1,
  heldEvaluations: 2,
  remaining: 1.5,
  unknownAttempts: 0,
  otherCurrencyAttempts: 0,
  warning: { usedPercent: 85, reached: 80, thresholds: [50, 80] },
  limits: { ...limits, reached: ["DAILY_EVALUATIONS"] },
  recentCosts: null,
};

describe("budget card", () => {
  it("shows the warning state, limits reached and limit usage", () => {
    const visible = text(renderToStaticMarkup(<BudgetCard status={status} />));
    expect(visible).toContain("Budget warning: 85% of the October 2026 budget is spent or reserved, past your 80% warning threshold.");
    expect(visible).toContain("New evaluations are deferred: today's evaluation limit is reached.");
    expect(visible).toContain("Evaluations today 2 of 2");
    expect(visible).toContain("Evaluations this week 3 (no limit)");
    expect(visible).toContain("Output tokens this month 1,200 of 5,000");
  });

  it("says limits would apply when they are not enforced", () => {
    const visible = text(renderToStaticMarkup(
      <BudgetCard status={{ ...status, settings: { ...status.settings, enforced: false } }} />,
    ));
    expect(visible).toContain("would be deferred if limits were enforced");
  });
});

describe("deferral reason", () => {
  const snapshot: BudgetSnapshotView = {
    period: "2026-10", periodStart: "", periodEnd: "", timeZone: "UTC", amount: 10, currency: "USD", enforced: true,
    knownSpent: 1, held: 0, available: 9, reserve: 0.5, unknownAttempts: 0, otherCurrencyAttempts: 0,
    checkedAt: "2026-10-14T10:00:00.000Z",
  };

  it("explains a throughput-limit deferral without blaming the budget or the opportunity", () => {
    const visible = text(renderToStaticMarkup(
      <DeferralReason snapshot={{ ...snapshot, limits: { ...limits, reached: ["MONTHLY_OUTPUT_TOKENS"] } }} />,
    ));
    expect(visible).toContain("not started because this month's output-token limit is reached");
    expect(visible).toContain("not a judgement on the opportunity");
    expect(visible).toContain("output tokens this month 1,200 of 5,000");
    expect(visible).not.toContain("reserves");
  });

  it("keeps the budget explanation, adding any limit also reached, and old snapshots still render", () => {
    const both = text(renderToStaticMarkup(
      <DeferralReason snapshot={{ ...snapshot, available: 0.2, limits: { ...limits, reached: ["BUDGET", "DAILY_EVALUATIONS"] } }} />,
    ));
    expect(both).toContain("Each evaluation reserves");
    expect(both).toContain("In addition, today's evaluation limit is reached.");
    expect(text(renderToStaticMarkup(<DeferralReason snapshot={snapshot} />))).toContain("Each evaluation reserves");
  });
});

const report: BudgetReportView = {
  generatedAt: "2026-10-14T10:00:00.000Z",
  currency: "USD",
  period: { label: "2026-10", start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", timeZone: "UTC" },
  budget: status,
  tokens: {
    attempts: 12, inputTokens: 40000, outputTokens: 1200, totalTokens: 41200,
    attemptsWithoutInputTokens: 0, attemptsWithoutOutputTokens: 1, attemptsWithoutTotalTokens: 0,
  },
  counts: {
    totals: { eligibleNotEvaluated: 4, evaluated: 7, queued: 1, running: 0, deferred: 2 },
    breakdown: [{ domain: "customer-success", sourceType: "MANUAL", eligibleNotEvaluated: 4, evaluated: 7, queued: 1, running: 0, deferred: 2 }],
  },
  capacity: {
    averageEvaluationCost: 0.25, basisEvaluations: 7, byBudget: 6, byDailyLimit: 0, byWeeklyLimit: null, remaining: 0,
    deferredBacklogCost: 0.5, eligibleBacklogCost: 1,
  },
  basis: {
    policyVersion: "policy-x", configuredPricingVersions: ["pricing-a", "pricing-b"], estimatePricingVersions: ["pricing-a"],
    callLimit: { minimum: 9, maximum: 16 }, budgetUpdatedAt: "2026-10-01T09:30:00.000Z",
  },
  spendOverTime: {
    daily: [
      { label: "2026-10-02", knownCost: 0.5, attempts: 8, unknownCostAttempts: 0 },
      { label: "2026-10-14", knownCost: 1, attempts: 4, unknownCostAttempts: 1 },
    ],
    monthly: [
      { label: "2026-09", knownCost: 3, attempts: 30, unknownCostAttempts: 0 },
      { label: "2026-10", knownCost: 1.5, attempts: 12, unknownCostAttempts: 1 },
    ],
  },
};

describe("capacity report", () => {
  it("shows counts by state and source, provider-reported usage, labelled estimates and their basis", () => {
    const visible = text(renderToStaticMarkup(<CapacityReport report={report} todayLabel="2026-10-14" />));
    for (const expected of [
      "Eligible, not yet evaluated 4", "Evaluated 7", "Queued 1", "Running 0", "Deferred (budget or limits) 2",
      "Customer Success Manual entry 4 7 1 0 2",
      "Output tokens 1,200 (1 attempt did not report this; not counted as zero)",
      "Capacity and backlog (estimates)", "Estimated remaining capacity 0 evaluations", "Within the remaining budget 6 evaluations",
      "Within this week's limit No limit", "Estimated cost of deferred backlog $0.50",
      "average recorded cost of the last 7 completed evaluations ($0.25 each), priced with pricing-a",
      "Evaluation policy version policy-x", "AI calls per evaluation 12 (system maximum 16, normal evaluation needs 9)",
      "1 AI attempt this month had no recorded cost in USD",
    ]) {
      expect(visible).toContain(expected);
    }
  });

  it("says when no spend has been recorded instead of drawing an empty chart", () => {
    const visible = text(renderToStaticMarkup(
      <CapacityReport report={{ ...report, spendOverTime: { daily: [], monthly: [] } }} todayLabel="2026-10-03" />,
    ));
    expect(visible).toContain("No AI spend has been recorded this month.");
  });

  it("keeps estimates Unknown without a basis and never invents spend", () => {
    const visible = text(renderToStaticMarkup(
      <CapacityReport
        report={{
          ...report,
          capacity: { ...report.capacity, averageEvaluationCost: null, byBudget: null, remaining: null, deferredBacklogCost: null, eligibleBacklogCost: null, basisEvaluations: 0 },
          spendOverTime: { daily: [], monthly: [] },
        }}
        todayLabel="2026-10-03"
      />,
    ));
    expect(visible).toContain("Estimated remaining capacity Unknown");
    expect(visible).toContain("Estimated cost of eligible backlog Unknown");
    expect(visible).toContain("Cost estimates are Unknown until at least one evaluation completes");
  });

  it("fills elapsed days of the period with zero spend, and nothing after today", () => {
    const days = fillDays(report.spendOverTime.daily, "2026-10", "2026-10-03");
    expect(days.map((day) => day.label)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days[1]).toMatchObject({ knownCost: 0.5, attempts: 8 });
    expect(days[0]).toEqual({ label: "2026-10-01", knownCost: 0, attempts: 0, unknownCostAttempts: 0 });
    expect(fillDays([], "2026-02", "2026-03-05")).toHaveLength(28);
  });
});

describe("report API", () => {
  it("returns the report, and a generic error without internal detail when it fails", async () => {
    const ok = createBudgetApiHandlers({ report: vi.fn().mockResolvedValue(report) } as unknown as BudgetService);
    const response = await ok.report();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ counts: { totals: { deferred: 2 } } });

    const failing = createBudgetApiHandlers({
      report: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2")),
    } as unknown as BudgetService);
    const error = await failing.report();
    expect(error.status).toBe(500);
    const body = await error.text();
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("10.0.0.5");
  });
});
