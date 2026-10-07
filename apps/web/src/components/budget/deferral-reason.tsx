import { formatMoney, formatPeriodLabel, pluralize } from "./budget-format";
import type { BudgetSnapshotView } from "./types";

// Plain-language explanation of why an evaluation was deferred, from the
// budget figures recorded when it was last checked.
export function DeferralReason({ snapshot }: { snapshot: BudgetSnapshotView | null }) {
  if (!snapshot) return <p>The AI budget did not have room for this evaluation.</p>;
  const money = (value: number) => formatMoney(value, snapshot.currency);
  return (
    <>
      <p>
        The {formatPeriodLabel(snapshot.period)} AI budget is {money(snapshot.amount)}. When last checked,{" "}
        {money(snapshot.knownSpent)} had been spent and {money(snapshot.held)} was reserved for unfinished
        evaluations, leaving {money(Math.max(0, snapshot.available))}. Each evaluation reserves{" "}
        {money(snapshot.reserve)} before it starts, so this one was not started and no AI cost was incurred.
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
