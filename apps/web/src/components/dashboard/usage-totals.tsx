import type { UsageTotals as UsageTotalsData } from "@ai-career/database";
import { formatCost, formatPricingVersions, formatTokens } from "../usage/usage-format";

// Read-only AI usage totals across all recorded evaluations.
export function UsageTotals({ totals }: { totals: UsageTotalsData }) {
  const { usage } = totals;
  if (usage.attemptCount === 0) {
    return (
      <section className="usage-totals" aria-labelledby="usage-totals-title">
        <h2 id="usage-totals-title">AI usage</h2>
        <p>No AI usage has been recorded yet.</p>
      </section>
    );
  }
  return (
    <section className="usage-totals" aria-labelledby="usage-totals-title">
      <h2 id="usage-totals-title">AI usage</h2>
      <dl className="usage-totals-grid">
        <div><dt>Evaluations with AI usage</dt><dd>{totals.evaluationCount}</dd></div>
        <div><dt>Provider attempts</dt><dd>{usage.attemptCount}</dd></div>
        <div><dt>Total tokens</dt><dd>{formatTokens(usage.totalTokens)}</dd></div>
        <div><dt>Estimated cost</dt><dd>{formatCost(usage.estimatedCost, usage.currency)}</dd></div>
        <div><dt>Pricing configuration</dt><dd>{formatPricingVersions(usage.pricingConfigurationVersions)}</dd></div>
      </dl>
      {usage.estimatedCost === null && totals.attemptsWithoutCost > 0 ? (
        <p className="usage-note">
          The total estimated cost is Unknown because {totals.attemptsWithoutCost}{" "}
          {totals.attemptsWithoutCost === 1 ? "attempt has" : "attempts have"} no recorded cost.
        </p>
      ) : usage.estimatedCost === null ? (
        <p className="usage-note">
          The total estimated cost is Unknown because attempts were priced in more than one currency.
        </p>
      ) : null}
    </section>
  );
}
