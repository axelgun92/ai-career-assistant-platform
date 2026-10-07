import type {
  SemanticOperationPresentation,
  SemanticUsagePresentation,
} from "./types";
import { formatCost, formatPricingVersions, formatTokens } from "../usage/usage-format";
import { evaluationFailure } from "./evaluation-failure";

// Persisted AI usage and estimated cost for one evaluation. Totals come from
// the server's summarizeSemanticUsage(); this component only displays them.
export function UsageSummary({
  usage,
  operations,
  reservation,
}: {
  usage: SemanticUsagePresentation | undefined;
  operations: SemanticOperationPresentation[] | undefined;
  reservation?: { amount: number; currency: string } | null;
}) {
  if (!usage) return null;
  const cost = formatCost(usage.estimatedCost, usage.currency);
  return (
    <details className="usage-summary">
      <summary>
        <span className="section-title">AI usage and estimated cost</span>
        <span className="section-summary">
          {usage.attemptCount} provider {usage.attemptCount === 1 ? "attempt" : "attempts"} · {cost}
        </span>
      </summary>
      <div className="section-content">
        <dl>
          <div><dt>Provider attempts</dt><dd>{usage.attemptCount}</dd></div>
          <div><dt>Input tokens</dt><dd>{formatTokens(usage.inputTokens)}</dd></div>
          <div><dt>Cached input tokens</dt><dd>{formatTokens(usage.cachedInputTokens)}</dd></div>
          <div><dt>Output tokens</dt><dd>{formatTokens(usage.outputTokens)}</dd></div>
          <div><dt>Reasoning tokens</dt><dd>{formatTokens(usage.reasoningTokens)}</dd></div>
          <div><dt>Total tokens</dt><dd>{formatTokens(usage.totalTokens)}</dd></div>
          <div><dt>Estimated cost</dt><dd>{cost}</dd></div>
          {reservation ? (
            <div><dt>Reserved before run</dt><dd>{formatCost(reservation.amount, reservation.currency)}</dd></div>
          ) : null}
          <div><dt>Pricing configuration</dt><dd>{formatPricingVersions(usage.pricingConfigurationVersions)}</dd></div>
        </dl>
        <p className="usage-note">
          Costs are estimates from the recorded pricing configuration. A total is Unknown when any
          attempt did not report it.
        </p>
        {operations && operations.length > 0 ? (
          <details className="usage-operations">
            <summary>Per-operation breakdown ({operations.length})</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Operation</th>
                    <th scope="col">Model</th>
                    <th scope="col">Attempt</th>
                    <th scope="col">Status</th>
                    <th scope="col">Input</th>
                    <th scope="col">Output</th>
                    <th scope="col">Total</th>
                    <th scope="col">Estimated cost</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((operation) => (
                    <tr key={operation.id}>
                      <td>{operation.operationId}</td>
                      <td>{operation.model}</td>
                      <td>{operation.attempt}</td>
                      <td>{operation.status}{operation.errorCode ? ` (${evaluationFailure(operation.errorCode).code})` : ""}</td>
                      <td>{formatTokens(operation.inputTokens)}</td>
                      <td>{formatTokens(operation.outputTokens)}</td>
                      <td>{formatTokens(operation.totalTokens)}</td>
                      <td>{formatCost(operation.estimatedCost, operation.pricingCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : (
          <p>No provider attempts were recorded for this evaluation.</p>
        )}
      </div>
    </details>
  );
}
