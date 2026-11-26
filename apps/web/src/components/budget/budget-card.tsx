import Link from "next/link";
import {
  describeLimitsReached,
  formatMoney,
  formatPeriodLabel,
  formatResetDate,
  formatUsage,
  pluralize,
} from "./budget-format";
import type { BudgetStatusView } from "./types";

// Dashboard summary of this period's AI budget. Known spend comes from
// recorded attempt costs; unknown costs are reported, never counted as $0.
export function BudgetCard({ status }: { status: BudgetStatusView }) {
  const deferredLink =
    status.openDeferrals > 0 ? (
      <p>
        <Link href="/budget#deferred-evaluations">
          {pluralize(status.openDeferrals, "evaluation")} deferred
        </Link>{" "}
        until budget is available.
      </p>
    ) : null;

  if (!status.configured) {
    return (
      <section className="budget-card" aria-labelledby="budget-card-title">
        <h2 id="budget-card-title">AI budget</h2>
        <p>
          No budget set — evaluations are not limited. <Link href="/budget">Set a budget</Link>
        </p>
        {deferredLink}
      </section>
    );
  }

  const money = (value: number) => formatMoney(value, status.settings.currency);
  return (
    <section className="budget-card" aria-labelledby="budget-card-title">
      <div className="budget-card-header">
        <h2 id="budget-card-title">{formatPeriodLabel(status.period.label)} AI budget</h2>
        <span className={status.settings.enforced ? "status-label" : "status-label status-label-muted"}>
          {status.settings.enforced ? "Enforced" : "Not enforced"}
        </span>
      </div>
      <dl className="usage-totals-grid">
        <div><dt>Budget</dt><dd>{money(status.settings.amount)}</dd></div>
        <div><dt>Known spend</dt><dd>{money(status.knownSpent)}</dd></div>
        <div><dt>Reserved</dt><dd>{money(status.held)}</dd></div>
        <div><dt>Remaining (known)</dt><dd>{money(status.remaining)}</dd></div>
        <div><dt>Resets</dt><dd>{formatResetDate(status.period.end, status.period.timeZone)}</dd></div>
      </dl>
      {status.warning.reached !== null ? (
        <p className="warning-message" role="status">
          Budget warning: {status.warning.usedPercent}% of the {formatPeriodLabel(status.period.label)} budget is spent
          or reserved, past your {status.warning.reached}% warning threshold.
        </p>
      ) : null}
      {status.limits.reached.length ? (
        <p className="warning-message" role="status">
          New evaluations {status.settings.enforced ? "are deferred" : "would be deferred if limits were enforced"}:{" "}
          {describeLimitsReached(status.limits.reached)}.
        </p>
      ) : null}
      {status.settings.dailyEvaluationLimit !== null ||
      status.settings.weeklyEvaluationLimit !== null ||
      status.settings.monthlyOutputTokenLimit !== null ? (
        <dl className="usage-totals-grid">
          <div><dt>Evaluations today</dt><dd>{formatUsage(status.limits.daily.used, status.limits.daily.limit)}</dd></div>
          <div><dt>Evaluations this week</dt><dd>{formatUsage(status.limits.weekly.used, status.limits.weekly.limit)}</dd></div>
          <div><dt>Output tokens this month</dt><dd>{formatUsage(status.limits.outputTokens.used, status.limits.outputTokens.limit)}</dd></div>
        </dl>
      ) : null}
      {status.held > 0 ? (
        <p className="usage-note">
          {money(status.held)} is reserved for {pluralize(status.heldEvaluations, "evaluation")} whose final cost
          is not known yet.
        </p>
      ) : null}
      {status.unknownAttempts > 0 ? (
        <p className="warning-message" role="note">
          {pluralize(status.unknownAttempts, "AI attempt")} this period {status.unknownAttempts === 1 ? "has" : "have"} no
          recorded cost. They are not counted as {money(0)}; their evaluations&apos; reservations stay held.
        </p>
      ) : null}
      {status.otherCurrencyAttempts > 0 ? (
        <p className="warning-message" role="note">
          {pluralize(status.otherCurrencyAttempts, "AI attempt")} this period {status.otherCurrencyAttempts === 1 ? "was" : "were"} priced
          in another currency and {status.otherCurrencyAttempts === 1 ? "is" : "are"} not included in known spend.
        </p>
      ) : null}
      {deferredLink}
      <p>
        <Link href="/budget">Budget settings and deferred evaluations</Link>
      </p>
    </section>
  );
}
