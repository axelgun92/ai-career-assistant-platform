// Serializable shapes passed from server pages to budget components.

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
      };
      period: { label: string; start: string; end: string; timeZone: string };
      knownSpent: number;
      held: number;
      heldEvaluations: number;
      remaining: number;
      unknownAttempts: number;
      otherCurrencyAttempts: number;
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
