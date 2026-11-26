import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summarizeSemanticUsage } from "@ai-career/evaluation";
import type { UsageTotals as UsageTotalsData } from "@ai-career/database";
import { UsageSummary } from "../../apps/web/src/components/evaluation/usage-summary";
import { UsageTotals } from "../../apps/web/src/components/dashboard/usage-totals";
import type { SemanticOperationPresentation } from "../../apps/web/src/components/evaluation/types";
import {
  formatCost,
  formatPricingVersions,
  formatTokens,
} from "../../apps/web/src/components/usage/usage-format";

function operation(overrides: Partial<SemanticOperationPresentation & { errorMessage: string; providerRequestId: string }> = {}) {
  return {
    id: "op-1",
    operationId: "customer-success.jd-reconstruction",
    attempt: 1,
    provider: "openai",
    model: "gpt-5.6-terra",
    status: "SUCCESS",
    inputTokens: 1200,
    outputTokens: 300,
    cachedInputTokens: 100,
    reasoningTokens: 50,
    totalTokens: 1500,
    estimatedCost: 0.0054,
    pricingConfigurationVersion: "pricing-v1",
    pricingCurrency: "USD",
    durationMs: 900,
    errorCode: null,
    ...overrides,
  } as SemanticOperationPresentation;
}

describe("usage formatting", () => {
  it("keeps unreported values Unknown instead of zero", () => {
    expect(formatTokens(null)).toBe("Unknown");
    expect(formatTokens(undefined)).toBe("Unknown");
    expect(formatTokens(0)).toBe("0"); // a reported zero stays zero
    expect(formatCost(null, "USD")).toBe("Unknown");
    expect(formatCost(0.12, null)).toBe("Unknown");
    expect(formatPricingVersions([])).toBe("Unknown");
  });

  it("formats reported values with their currency without rounding away small costs", () => {
    expect(formatTokens(125670)).toBe("125,670");
    expect(formatCost(0.2026282, "USD")).toBe("$0.202628");
    expect(formatCost(1.5, "USD")).toBe("$1.50");
    expect(formatCost(0.5, "NOT-A-CURRENCY")).toBe("0.5 NOT-A-CURRENCY");
    expect(formatPricingVersions(["a", "b"])).toBe("a, b");
  });
});

describe("per-evaluation usage summary", () => {
  it("shows attempts, every token category, cost, and pricing version from summarizeSemanticUsage", () => {
    const operations = [operation(), operation({ id: "op-2", attempt: 2, estimatedCost: 0.0046 })];
    const html = renderToStaticMarkup(
      <UsageSummary usage={summarizeSemanticUsage(operations)} operations={operations} />,
    );
    expect(html).toContain("AI usage and estimated cost");
    expect(html).toContain("2 provider attempts · $0.01");
    for (const label of ["Input tokens", "Cached input tokens", "Output tokens", "Reasoning tokens", "Total tokens"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("2,400"); // input tokens
    expect(html).toContain("3,000"); // total tokens
    expect(html).toContain("pricing-v1");
    expect(html).toContain("Per-operation breakdown (2)");
    expect(html).toContain("customer-success.jd-reconstruction");
    // Both collapsed by default.
    expect(html).not.toMatch(/<details[^>]*open/);
  });

  it("shows Unknown, never an invented zero, when any attempt did not report a value", () => {
    const operations = [
      operation(),
      operation({ id: "op-2", reasoningTokens: null, estimatedCost: null, pricingConfigurationVersion: null, pricingCurrency: null }),
    ];
    const usage = summarizeSemanticUsage(operations);
    expect(usage.reasoningTokens).toBeNull();
    expect(usage.estimatedCost).toBeNull();
    const html = renderToStaticMarkup(<UsageSummary usage={usage} operations={operations} />);
    expect(html).toContain("2 provider attempts · Unknown");
    expect(html).toMatch(/Reasoning tokens<\/dt><dd>Unknown/);
    expect(html).toMatch(/Estimated cost<\/dt><dd>Unknown/);
    expect(html).not.toMatch(/Reasoning tokens<\/dt><dd>0/);
  });

  it("never renders provider request IDs or raw error messages, and sanitizes error codes", () => {
    const operations = [
      operation({ status: "FAILED", errorCode: "STRUCTURED_OUTPUT_INVALID", errorMessage: "SECRET-RAW-DETAIL", providerRequestId: "req_secret_123" }),
      operation({ id: "op-2", status: "FAILED", errorCode: "<script>bad</script>" }),
    ];
    const html = renderToStaticMarkup(
      <UsageSummary usage={summarizeSemanticUsage(operations)} operations={operations} />,
    );
    expect(html).toContain("FAILED (STRUCTURED_OUTPUT_INVALID)");
    expect(html).toContain("FAILED (UNKNOWN)");
    expect(html).not.toContain("SECRET-RAW-DETAIL");
    expect(html).not.toContain("req_secret_123");
    expect(html).not.toContain("<script>");
  });

  it("renders nothing without usage and explains when no attempts were recorded", () => {
    expect(renderToStaticMarkup(<UsageSummary usage={undefined} operations={undefined} />)).toBe("");
    expect(renderToStaticMarkup(<UsageSummary usage={summarizeSemanticUsage([])} operations={[]} />))
      .toContain("No provider attempts were recorded");
  });
});

describe("dashboard usage totals", () => {
  const totals = (overrides: Partial<UsageTotalsData> = {}, attempts = [operation()]): UsageTotalsData => ({
    evaluationCount: 1,
    attemptsWithoutCost: 0,
    usage: summarizeSemanticUsage(attempts),
    ...overrides,
  });

  it("shows totals across evaluations", () => {
    const html = renderToStaticMarkup(
      <UsageTotals totals={totals({ evaluationCount: 2 }, [operation(), operation({ id: "op-2" })])} />,
    );
    expect(html).toContain("AI usage");
    expect(html).toMatch(/Evaluations with AI usage<\/dt><dd>2/);
    expect(html).toMatch(/Provider attempts<\/dt><dd>2/);
    expect(html).toContain("$0.0108");
    expect(html).toContain("pricing-v1");
  });

  it("explains an Unknown total instead of inventing one", () => {
    const missing = renderToStaticMarkup(
      <UsageTotals totals={totals({ attemptsWithoutCost: 1 }, [operation(), operation({ id: "op-2", estimatedCost: null })])} />,
    );
    expect(missing).toMatch(/Estimated cost<\/dt><dd>Unknown/);
    expect(missing).toContain("because 1 attempt has no recorded cost");
    const mixed = renderToStaticMarkup(
      <UsageTotals totals={totals({}, [operation(), operation({ id: "op-2", pricingCurrency: "EUR" })])} />,
    );
    expect(mixed).toContain("more than one currency");
  });

  it("says when nothing has been recorded", () => {
    expect(renderToStaticMarkup(<UsageTotals totals={totals({ evaluationCount: 0 }, [])} />))
      .toContain("No AI usage has been recorded yet.");
  });
});
