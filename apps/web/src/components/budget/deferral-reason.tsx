import { describeLimitsReached, formatMoney, formatPeriodLabel, formatUsage, pluralize } from "./budget-format";
import type { BudgetSnapshotView } from "./types";

// Plain-language explanation of why an evaluation was deferred, from the
// budget figures recorded when it was last checked.
export function DeferralReason({ snapshot }: { snapshot: BudgetSnapshotView | null }) {
  if (!snapshot) return <p>The AI budget did not have room for this evaluation.</p>;
  const money = (value: number) => formatMoney(value, snapshot.currency);
  const throughput = snapshot.limits?.reached.filter((limit) => limit !== "BUDGET") ?? [];
  if (snapshot.limits && throughput.length && !snapshot.limits.reached.includes("BUDGET")) {
    const { daily, weekly, outputTokens } = snapshot.limits;
    return (
      <>
        <p>
          This evaluation was not started because {describeLimitsReached(throughput)}, so no AI cost was incurred.
          It is not a judgement on the opportunity.
        </p>
        <p className="usage-note">
          When last checked: evaluations today {formatUsage(daily.used, daily.limit)}; this week{" "}
          {formatUsage(weekly.used, weekly.limit)}; output tokens this month{" "}
          {formatUsage(outputTokens.used, outputTokens.limit)}.
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        The {formatPeriodLabel(snapshot.period)} AI budget is {money(snapshot.amount)}. When last checked,{" "}
        {money(snapshot.knownSpent)} had been spent and {money(snapshot.held)} was reserved for unfinished
        evaluations, leaving {money(Math.max(0, snapshot.available))}. Each evaluation reserves{" "}
        {money(snapshot.reserve)} before it starts, so this one was not started and no AI cost was incurred.
        {throughput.length ? ` In addition, ${describeLimitsReached(throughput)}.` : ""}
      </p>
      {snapshot.unknownAttempts > 0 ? (
        <p className="usage-note">
          {pluralize(snapshot.unknownAttempts, "AI attempt")} this period had no recorded cost, so their
          reservations stayed held instead of counting as {money(0)}.
        </p>
      ) : null}
    </>
  );
}
