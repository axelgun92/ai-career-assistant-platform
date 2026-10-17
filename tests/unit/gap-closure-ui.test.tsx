// Features 1–10 Gap Closure: evaluation history versions (G4) and usage and
// spend by domain and source on /budget (G6).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BudgetReportView } from "../../apps/web/src/components/budget/types";

vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { historyVersionLabel } = await import("../../apps/web/src/components/evaluation/evaluation-experience");
const { UsageBreakdown } = await import("../../apps/web/src/components/budget/capacity-report");

describe("evaluation history versions (G4)", () => {
  it("names the profile, evaluation and prompt versions behind each history row", () => {
    expect(historyVersionLabel({ userProfileVersion: 10, evaluationVersion: "cs-evaluation-v1.1-m9", promptVersion: "cs-m9-prompts-v1" })).toBe(
      "Profile v10 · Evaluation cs-evaluation-v1.1-m9 · Prompt cs-m9-prompts-v1",
    );
    expect(historyVersionLabel({ userProfileVersion: null, evaluationVersion: "v1", promptVersion: null })).toBe("Profile unknown · Evaluation v1");
  });
});

describe("usage and spend by domain and source (G6)", () => {
  const report = (usageBreakdown: BudgetReportView["usageBreakdown"]) =>
    ({ currency: "USD", period: { label: "2026-10", start: "", end: "", timeZone: "UTC" }, usageBreakdown }) as BudgetReportView;
  const row = {
    domain: "customer-success",
    sourceType: "MANUAL",
    source: "manual-input",
    attempts: 9,
    evaluations: 1,
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
    attemptsWithoutTotalTokens: 1,
    knownCost: 0.0123,
    unknownCostAttempts: 2,
  };

  it("lists each domain and source with tokens, known spend and attempts whose cost is not known", () => {
    const html = renderToStaticMarkup(<UsageBreakdown report={report([row, { ...row, sourceType: "ATS", source: null, knownCost: null, unknownCostAttempts: 9 }])} />);
    expect(html).toContain("Usage and spend by domain and source");
    expect(html).toContain("Customer Success");
    expect(html).toContain("Manual entry (manual-input)");
    expect(html).toContain("1,200 (1 attempt unreported)");
    expect(html).toContain("2 attempts");
    expect(html).toContain("Applicant tracking system");
    expect(html).toContain("Unknown");
    expect(html).toContain('class="table-scroll"');
  });

  it("renders nothing without usage in the period, or for an older report", () => {
    expect(renderToStaticMarkup(<UsageBreakdown report={report([])} />)).toBe("");
    expect(renderToStaticMarkup(<UsageBreakdown report={report(undefined)} />)).toBe("");
  });
});
