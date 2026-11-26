// Whole-batch capacity for bulk evaluation (November 26, 2026): each enabled
// limit's remaining evaluations, disabled and unenforced limits ignored,
// every shortfall reported, the monthly AI budget settled exactly on the
// single-admission rule, and output tokens counted at their worst case so a
// batch is refused when the remaining allowance cannot hold it even though
// the limit is not yet reached.
import { describe, expect, it } from "vitest";
import { batchCapacity, budgetDecision, largestCountWithin, outputTokenPotential, worstCaseOutputTokens } from "@ai-career/core";

const settings = {
  enforced: true,
  amount: 10,
  reservePerEvaluation: 1,
  dailyEvaluationLimit: null as number | null,
  weeklyEvaluationLimit: null as number | null,
  monthlyOutputTokenLimit: null as number | null,
};
const base = {
  requested: 5,
  settings,
  ledger: { knownSpent: 0, held: 0 },
  usage: { dailyEvaluations: 0, weeklyEvaluations: 0 },
  committedOutputTokens: 0,
  outputTokensPerEvaluation: 1_000,
};

describe("batch capacity", () => {
  it("fits when every enabled limit allows the whole selection", () => {
    expect(batchCapacity(base)).toEqual({ fits: true });
    expect(batchCapacity({ ...base, requested: 10 })).toEqual({ fits: true });
  });

  it("names the monthly AI budget with how many evaluations it can still reserve", () => {
    expect(batchCapacity({ ...base, requested: 8, ledger: { knownSpent: 3, held: 2 } })).toEqual({
      fits: false,
      shortfalls: [{ limit: "BUDGET", remaining: 5 }],
    });
  });

  it("names the daily and weekly limits with what remains, and reports every shortfall", () => {
    const limited = { ...settings, amount: 100, dailyEvaluationLimit: 6, weeklyEvaluationLimit: 20 };
    expect(batchCapacity({ ...base, requested: 3, settings: limited, usage: { dailyEvaluations: 4, weeklyEvaluations: 18 } })).toEqual({
      fits: false,
      shortfalls: [{ limit: "DAILY_EVALUATIONS", remaining: 2 }, { limit: "WEEKLY_EVALUATIONS", remaining: 2 }],
    });
    // Several limits at once, the budget among them.
    expect(batchCapacity({ ...base, requested: 12, settings: { ...limited, amount: 7 }, usage: { dailyEvaluations: 0, weeklyEvaluations: 13 } })).toEqual({
      fits: false,
      shortfalls: [{ limit: "BUDGET", remaining: 7 }, { limit: "DAILY_EVALUATIONS", remaining: 6 }, { limit: "WEEKLY_EVALUATIONS", remaining: 7 }],
    });
    // A limit already passed allows none.
    expect(batchCapacity({ ...base, requested: 1, settings: limited, usage: { dailyEvaluations: 9, weeklyEvaluations: 0 } })).toEqual({
      fits: false,
      shortfalls: [{ limit: "DAILY_EVALUATIONS", remaining: 0 }],
    });
  });

  it("ignores limits that are off, an unenforced budget, and no budget at all", () => {
    expect(batchCapacity({ ...base, requested: 50, settings: { ...settings, amount: 1000 } })).toEqual({ fits: true });
    const exceeded = { ...settings, amount: 1, dailyEvaluationLimit: 1, weeklyEvaluationLimit: 1, monthlyOutputTokenLimit: 1 };
    expect(batchCapacity({ ...base, requested: 50, settings: { ...exceeded, enforced: false } })).toEqual({ fits: true });
    expect(batchCapacity({ ...base, requested: 50, settings: null })).toEqual({ fits: true });
  });

  it("refuses a batch the remaining output-token allowance cannot hold, though the limit is not yet reached", () => {
    const tokens = { ...settings, amount: 1000, monthlyOutputTokenLimit: 100_000 };
    // 30,000 committed; 70,000 left; 25,000 worst case each: 2 fit.
    const input = { ...base, settings: tokens, committedOutputTokens: 30_000, outputTokensPerEvaluation: 25_000 };
    expect(batchCapacity({ ...input, requested: 3 })).toEqual({ fits: false, shortfalls: [{ limit: "MONTHLY_OUTPUT_TOKENS", remaining: 2 }] });
    expect(batchCapacity({ ...input, requested: 2 })).toEqual({ fits: true });
    // One token below the limit: no evaluation fits (the single rule would
    // still admit one; a batch never relies on that).
    expect(batchCapacity({ ...input, requested: 1, committedOutputTokens: 99_999 })).toEqual({
      fits: false,
      shortfalls: [{ limit: "MONTHLY_OUTPUT_TOKENS", remaining: 0 }],
    });
  });

  it("settles the budget count exactly on the single-admission rule", () => {
    // 0.1 + 0.2 style rounding: three reserves of 0.1 fit in 0.3.
    expect(largestCountWithin(0.3, 0.1)).toBe(3);
    for (const [available, reserve] of [[0.3, 0.1], [1, 0.3], [2.5, 0.5], [0.29, 0.1], [0, 0.1]] as const) {
      const count = largestCountWithin(available, reserve);
      // The count is the largest N with roundMoney(N × reserve) <= available,
      // which for N = 1 is exactly budgetDecision's rule.
      expect(budgetDecision({ amount: available, knownSpent: 0, held: 0, reserve, enforced: true }).allowed).toBe(count >= 1);
      expect(budgetDecision({ amount: available, knownSpent: 0, held: roundTo(reserve * count), reserve, enforced: true }).allowed).toBe(false);
    }
  });

  it("computes the worst case from the call budget and the largest per-call maximum", () => {
    expect(worstCaseOutputTokens({ callBudget: 16, maxOutputTokens: 12_000 })).toBe(192_000);
    expect(worstCaseOutputTokens({ callBudget: 8, maxOutputTokens: 4_000, operationMaximums: [2_000, 20_000] })).toBe(160_000);
  });
});

// Each provider call counted once (approved clarification, November 26,
// 2026): a reported call counts its actual tokens instead of its estimate,
// an unreported call counts its maximum once, a call not yet made counts its
// maximum, and a finished evaluation or abandoned admission releases what it
// did not use.
describe("output-token potential", () => {
  const maximum = 1_000;
  const window = (input: Partial<Parameters<typeof outputTokenPotential>[0]>) =>
    outputTokenPotential({ reportedOutputTokens: 0, unreportedCalls: [], activeEvaluations: [], liveAdmissions: 0, worstCasePerEvaluation: 4 * maximum, ...input });

  it("counts a queued evaluation's calls at their maximum before any is made", () => {
    expect(window({ activeEvaluations: [{ callBudget: 4, callsMade: 0, maximumOutputTokens: maximum }] }).total).toBe(4_000);
  });

  it("replaces a call's estimate with its reported tokens, never adding both", () => {
    // One call made, reporting 150 output tokens: 150 + 3 calls still to come.
    const reported = window({ reportedOutputTokens: 150, activeEvaluations: [{ callBudget: 4, callsMade: 1, maximumOutputTokens: maximum }] });
    expect(reported).toEqual({ reported: 150, unreported: 0, notYetMade: 3_000, admitted: 0, total: 3_150 });
    // The same call reporting nothing counts at its maximum, once.
    const unreported = window({ unreportedCalls: [{ maximumOutputTokens: maximum }], activeEvaluations: [{ callBudget: 4, callsMade: 1, maximumOutputTokens: maximum }] });
    expect(unreported.total).toBe(4_000);
  });

  it("releases unused potential when the evaluation finishes, keeping only the calls it made", () => {
    const running = window({ reportedOutputTokens: 300, activeEvaluations: [{ callBudget: 4, callsMade: 2, maximumOutputTokens: maximum }] });
    expect(running.total).toBe(2_300);
    // Completed, permanently failed or deleted: no longer active.
    expect(window({ reportedOutputTokens: 300 }).total).toBe(300);
    // An admission counts at the worst case until abandoned.
    expect(window({ liveAdmissions: 2 }).total).toBe(8_000);
    expect(window({ liveAdmissions: 0 }).total).toBe(0);
  });

  it("never counts more calls than the evaluation's budget, or negative remaining calls", () => {
    expect(window({ reportedOutputTokens: 500, activeEvaluations: [{ callBudget: 2, callsMade: 3, maximumOutputTokens: maximum }] }).total).toBe(500);
  });
});

function roundTo(value: number) {
  return Number(value.toFixed(12));
}
