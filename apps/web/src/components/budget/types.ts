// Serializable shapes passed from server pages to budget components.

export type UsageLimitName = "BUDGET" | "DAILY_EVALUATIONS" | "WEEKLY_EVALUATIONS" | "MONTHLY_OUTPUT_TOKENS";

export interface LimitSnapshotView {
  enforced: boolean;
  reached: UsageLimitName[];
  daily: { limit: number | null; used: number; window: string; resetsAt: string };
  weekly: { limit: number | null; used: number; window: string; resetsAt: string };
  outputTokens: { limit: number | null; used: number; unreportedAttempts: number };
}

export interface WarningStateView {
  usedPercent: number | null;
  reached: number | null;
  thresholds: number[];
}

export interface BudgetSnapshotView {
  period: string;
  periodStart: string;
  periodEnd: string;
  timeZone: string;
  amount: number;
  currency: string;
  enforced: boolean;
  knownSpent: number;
  held: number;
  available: number;
  reserve: number;
  unknownAttempts: number;
  otherCurrencyAttempts: number;
  checkedAt: string;
  limits?: LimitSnapshotView;
}

export type BudgetStatusView =
  | { configured: false; openDeferrals: number }
  | {
      configured: true;
      openDeferrals: number;
      settings: {
        amount: number;
        currency: string;
        timeZone: string;
        enforced: boolean;
        reservePerEvaluation: number;
        periodType: string;
        warningThresholds: number[];
        dailyEvaluationLimit: number | null;
        weeklyEvaluationLimit: number | null;
        monthlyOutputTokenLimit: number | null;
        evaluationCallLimit: number | null;
        updatedAt: string;
      };
      period: { label: string; start: string; end: string; timeZone: string };
      knownSpent: number;
      held: number;
      heldEvaluations: number;
      remaining: number;
      unknownAttempts: number;
      otherCurrencyAttempts: number;
      warning: WarningStateView;
      limits: LimitSnapshotView;
      recentCosts: { count: number; max: number; average: number } | null;
    };

export interface DeferralView {
  id: string;
  opportunityId: string;
  opportunityTitle: string | null;
  companyName: string | null;
  opportunityStatus: string;
  status: "DEFERRED" | "RESUMED" | "CANCELLED";
  reasonCode: string;
  snapshot: BudgetSnapshotView | null;
  userProfileId: string | null;
  userProfileVersion: number | null;
  createdAt: string;
  lastCheckedAt: string;
  resumedAt: string | null;
  cancelledAt: string | null;
  resumedEvaluationId: string | null;
}

export interface CountRowView {
  domain: string | null;
  sourceType: string | null;
  eligibleNotEvaluated: number;
  evaluated: number;
  queued: number;
  running: number;
  deferred: number;
}

export interface SpendBucketView {
  label: string;
  knownCost: number;
  attempts: number;
  unknownCostAttempts: number;
}

// The operational usage, capacity and backlog report for /budget.
export interface BudgetReportView {
  generatedAt: string;
  currency: string | null;
  period: { label: string; start: string; end: string; timeZone: string };
  budget: BudgetStatusView;
  tokens: {
    attempts: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    attemptsWithoutInputTokens: number;
    attemptsWithoutOutputTokens: number;
    attemptsWithoutTotalTokens: number;
  };
  counts: { totals: Omit<CountRowView, "domain" | "sourceType">; breakdown: CountRowView[] };
  capacity: {
    averageEvaluationCost: number | null;
    basisEvaluations: number;
    byBudget: number | null;
    byDailyLimit: number | null;
    byWeeklyLimit: number | null;
    remaining: number | null;
    deferredBacklogCost: number | null;
    eligibleBacklogCost: number | null;
  };
  basis: {
    policyVersion: string | null;
    configuredPricingVersions: string[];
    estimatePricingVersions: string[];
    callLimit: { minimum: number; maximum: number } | null;
    budgetUpdatedAt: string | null;
  };
  spendOverTime: { daily: SpendBucketView[]; monthly: SpendBucketView[] };
}
