import { sourceTypeLabel } from "../opportunity-provenance";
import { formatCount, formatMoney, formatPeriodLabel, pluralize } from "./budget-format";
import type { BudgetReportView, SpendBucketView } from "./types";

// Operational AI usage, capacity and backlog reporting. Counts are facts from
// persisted rows; anything marked "Estimate" is derived from recorded costs
// of recent evaluations and is never a guarantee. Unknown stays Unknown.

const domainLabels: Record<string, string> = { "customer-success": "Customer Success" };
const domainLabel = (domain: string | null) => (domain ? domainLabels[domain] ?? domain : "No domain");

function Counts({ report }: { report: BudgetReportView }) {
  const { totals, breakdown } = report.counts;
  const tiles = [
    ["Eligible, not yet evaluated", totals.eligibleNotEvaluated],
    ["Evaluated", totals.evaluated],
    ["Queued", totals.queued],
    ["Running", totals.running],
    ["Deferred (budget or limits)", totals.deferred],
  ] as const;
  return (
    <section aria-labelledby="capacity-counts-title">
      <h3 id="capacity-counts-title">Opportunities by evaluation state</h3>
      <dl className="usage-totals-grid">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatCount(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="field-help">
        Eligible means a normalized, active opportunity in a domain the evaluator supports that has never been
        evaluated and is not queued, running or deferred. Deferral is an operational state, never a judgement on the
        opportunity or its source.
      </p>
      {breakdown.length ? (
        <table className="capacity-table">
          <caption>By domain and source</caption>
          <thead>
            <tr>
              <th scope="col">Domain</th>
              <th scope="col">Source</th>
              <th scope="col">Eligible</th>
              <th scope="col">Evaluated</th>
              <th scope="col">Queued</th>
              <th scope="col">Running</th>
              <th scope="col">Deferred</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((row) => (
              <tr key={`${row.domain}-${row.sourceType}`}>
                <th scope="row">{domainLabel(row.domain)}</th>
                <td>{sourceTypeLabel(row.sourceType)}</td>
                <td>{formatCount(row.eligibleNotEvaluated)}</td>
                <td>{formatCount(row.evaluated)}</td>
                <td>{formatCount(row.queued)}</td>
                <td>{formatCount(row.running)}</td>
                <td>{formatCount(row.deferred)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function Tokens({ report }: { report: BudgetReportView }) {
  const { tokens } = report;
  const unreported = (count: number) =>
    count > 0 ? ` (${pluralize(count, "attempt")} did not report this; not counted as zero)` : "";
  return (
    <section aria-labelledby="capacity-tokens-title">
      <h3 id="capacity-tokens-title">Provider-reported usage, {formatPeriodLabel(report.period.label)}</h3>
      <dl className="usage-totals-grid">
        <div><dt>AI attempts</dt><dd>{formatCount(tokens.attempts)}</dd></div>
        <div><dt>Input tokens</dt><dd>{formatCount(tokens.inputTokens)}{unreported(tokens.attemptsWithoutInputTokens)}</dd></div>
        <div><dt>Output tokens</dt><dd>{formatCount(tokens.outputTokens)}{unreported(tokens.attemptsWithoutOutputTokens)}</dd></div>
        <div><dt>Total tokens</dt><dd>{formatCount(tokens.totalTokens)}{unreported(tokens.attemptsWithoutTotalTokens)}</dd></div>
      </dl>
      <UsageBreakdown report={report} />
    </section>
  );
}

// Usage and spend by domain and job source (Core PRD §20). Unreported
// tokens and unknown or other-currency costs are counted, never zero.
export function UsageBreakdown({ report }: { report: BudgetReportView }) {
  const rows = report.usageBreakdown ?? [];
  if (!rows.length) return null;
  return (
    <div className="table-scroll">
      <table className="capacity-table">
        <caption>Usage and spend by domain and source, {formatPeriodLabel(report.period.label)}</caption>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">Source</th>
            <th scope="col">Evaluations</th>
            <th scope="col">AI attempts</th>
            <th scope="col">Total tokens</th>
            <th scope="col">Known spend</th>
            <th scope="col">Cost not known</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.domain}-${row.sourceType}-${row.source}`}>
              <th scope="row">{domainLabel(row.domain)}</th>
              <td>
                {sourceTypeLabel(row.sourceType)}
                {row.source ? ` (${row.source})` : ""}
              </td>
              <td>{formatCount(row.evaluations)}</td>
              <td>{formatCount(row.attempts)}</td>
              <td>
                {formatCount(row.totalTokens)}
                {row.attemptsWithoutTotalTokens > 0 ? ` (${pluralize(row.attemptsWithoutTotalTokens, "attempt")} unreported)` : ""}
              </td>
              <td>{formatMoney(row.knownCost, report.currency)}</td>
              <td>{row.unknownCostAttempts > 0 ? pluralize(row.unknownCostAttempts, "attempt") : "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Estimates({ report }: { report: BudgetReportView }) {
  const { capacity, currency } = report;
  const money = (value: number | null) => formatMoney(value, currency);
  const evaluations = (value: number | null) => (value === null ? "Unknown" : pluralize(value, "evaluation"));
  return (
    <section aria-labelledby="capacity-estimates-title">
      <h3 id="capacity-estimates-title">Capacity and backlog (estimates)</h3>
      <dl className="usage-totals-grid">
        <div><dt>Estimated remaining capacity</dt><dd>{evaluations(capacity.remaining)}</dd></div>
        <div><dt>Within the remaining budget</dt><dd>{evaluations(capacity.byBudget)}</dd></div>
        <div><dt>Within today&apos;s limit</dt><dd>{capacity.byDailyLimit === null ? "No limit" : evaluations(capacity.byDailyLimit)}</dd></div>
        <div><dt>Within this week&apos;s limit</dt><dd>{capacity.byWeeklyLimit === null ? "No limit" : evaluations(capacity.byWeeklyLimit)}</dd></div>
        <div><dt>Estimated cost of deferred backlog</dt><dd>{money(capacity.deferredBacklogCost)}</dd></div>
        <div><dt>Estimated cost of eligible backlog</dt><dd>{money(capacity.eligibleBacklogCost)}</dd></div>
      </dl>
      <p className="field-help">
        {capacity.averageEvaluationCost === null
          ? "Cost estimates are Unknown until at least one evaluation completes with every AI cost recorded."
          : `Estimates use the average recorded cost of the last ${pluralize(capacity.basisEvaluations, "completed evaluation")} ` +
            `(${money(capacity.averageEvaluationCost)} each), priced with ${report.basis.estimatePricingVersions.join(", ") || "Unknown pricing"}. ` +
            "They are estimates, not guarantees: an evaluation can cost more or less."}
        {report.budget.configured ? "" : " Set a budget to estimate capacity within it."}
      </p>
    </section>
  );
}

// Fill every day of the period up to today: a day without attempts spent
// nothing (a fact), so it shows as zero, unlike unknown costs.
export function fillDays(buckets: SpendBucketView[], periodLabel: string, todayLabel: string): SpendBucketView[] {
  const [year, month] = periodLabel.split("-").map(Number);
  const byLabel = new Map(buckets.map((bucket) => [bucket.label, bucket]));
  const days: SpendBucketView[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(Date.UTC(year!, month! - 1, day));
    if (date.getUTCMonth() !== month! - 1) break;
    const label = date.toISOString().slice(0, 10);
    if (label > todayLabel) break;
    days.push(byLabel.get(label) ?? { label, knownCost: 0, attempts: 0, unknownCostAttempts: 0 });
  }
  return days;
}

function SpendOverTime({ report, todayLabel }: { report: BudgetReportView; todayLabel: string }) {
  const money = (value: number) => formatMoney(value, report.currency);
  const days = fillDays(report.spendOverTime.daily, report.period.label, todayLabel);
  const max = Math.max(0, ...days.map((day) => day.knownCost));
  const unknown = days.reduce((total, day) => total + day.unknownCostAttempts, 0);
  return (
    <section aria-labelledby="capacity-spend-title">
      <h3 id="capacity-spend-title">Known AI spend per day, {formatPeriodLabel(report.period.label)}</h3>
      {report.currency === null ? (
        <p>Spend over time is shown once a budget is set or AI pricing is configured.</p>
      ) : max === 0 && unknown === 0 ? (
        <p>No AI spend has been recorded this month.</p>
      ) : (
        <>
          <div className="spend-chart" role="img" aria-label={`Known AI spend per day; highest ${money(max)}. A table follows.`}>
            {days.map((day) => (
              <div
                key={day.label}
                className="spend-bar"
                title={`${day.label}: ${money(day.knownCost)}${day.unknownCostAttempts ? `, ${pluralize(day.unknownCostAttempts, "attempt")} with unknown cost` : ""}`}
                style={{ height: max > 0 ? `${Math.max(day.knownCost > 0 ? 4 : 0, (day.knownCost / max) * 100)}%` : "0%" }}
              />
            ))}
          </div>
          {unknown > 0 ? (
            <p className="usage-note">
              {pluralize(unknown, "AI attempt")} this month had no recorded cost in {report.currency}; they are not
              included as zero.
            </p>
          ) : null}
          <details className="source-details">
            <summary>Spend table</summary>
            <table className="capacity-table">
              <caption>Known spend by day and month</caption>
              <thead>
                <tr><th scope="col">Day or month</th><th scope="col">Known spend</th><th scope="col">Attempts</th><th scope="col">Attempts with unknown cost</th></tr>
              </thead>
              <tbody>
                {[...days.filter((day) => day.attempts > 0), ...report.spendOverTime.monthly].map((bucket) => (
                  <tr key={bucket.label}>
                    <th scope="row">{bucket.label.length === 7 ? formatPeriodLabel(bucket.label) : bucket.label}</th>
                    <td>{money(bucket.knownCost)}</td>
                    <td>{formatCount(bucket.attempts)}</td>
                    <td>{formatCount(bucket.unknownCostAttempts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

function Basis({ report }: { report: BudgetReportView }) {
  const { basis } = report;
  return (
    <section aria-labelledby="capacity-basis-title">
      <h3 id="capacity-basis-title">Pricing and configuration basis</h3>
      <dl className="provenance-list">
        <div><dt>Evaluation policy version</dt><dd>{basis.policyVersion ?? "Unknown (AI evaluation not configured)"}</dd></div>
        <div><dt>Configured pricing versions</dt><dd>{basis.configuredPricingVersions.join(", ") || "Unknown"}</dd></div>
        <div><dt>Pricing used by the estimates</dt><dd>{basis.estimatePricingVersions.join(", ") || "None yet"}</dd></div>
        <div>
          <dt>AI calls per evaluation</dt>
          <dd>
            {basis.callLimit
              ? `${report.budget.configured && report.budget.settings.evaluationCallLimit !== null ? report.budget.settings.evaluationCallLimit : basis.callLimit.maximum} ` +
                `(system maximum ${basis.callLimit.maximum}, normal evaluation needs ${basis.callLimit.minimum})`
              : "Unknown"}
          </dd>
        </div>
        <div><dt>Budget settings last changed</dt><dd>{basis.budgetUpdatedAt ? basis.budgetUpdatedAt.slice(0, 16).replace("T", " ") + " UTC" : "No budget set"}</dd></div>
      </dl>
    </section>
  );
}

export function CapacityReport({ report, todayLabel }: { report: BudgetReportView; todayLabel: string }) {
  return (
    <section className="capacity-report" aria-labelledby="capacity-report-title">
      <h2 id="capacity-report-title">AI usage and capacity</h2>
      <Counts report={report} />
      <Tokens report={report} />
      <Estimates report={report} />
      <SpendOverTime report={report} todayLabel={todayLabel} />
      <Basis report={report} />
    </section>
  );
}
