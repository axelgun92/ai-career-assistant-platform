import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreEvaluatorTriageContent } from "../../apps/web/src/components/pre-evaluator-triage";

const base = {
  automaticOutcome: "NEEDS_REVIEW" as const,
  reasons: [{
    code: "salary-unknown-salary",
    fields: ["salaryMin", "salaryMax", "currency"],
    disposition: "NEEDS_REVIEW" as const,
    message: "Base salary is Unknown.",
  }],
  manualDecision: null,
  manuallyDecidedAt: null,
  userProfileVersion: 1,
  assessedAt: "2026-11-02T12:00:00.000Z",
};

describe("pre-evaluator triage UI", () => {
  it("shows the reasons and exactly Evaluate and Reject for NEEDS_REVIEW", () => {
    const html = renderToStaticMarkup(
      <PreEvaluatorTriageContent
        opportunityId="00000000-0000-4000-8000-000000000001"
        triage={{ ...base, outcome: "NEEDS_REVIEW" }}
        pending={null}
        message={null}
        error={null}
        onDecide={vi.fn()}
      />,
    );
    expect(html).toContain("Needs Review before evaluation");
    expect(html).toContain("Base salary is Unknown");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain(">Evaluate<");
    expect(html).toContain(">Reject<");
  });

  it("shows deterministic rejection reasons with no manual action buttons", () => {
    const html = renderToStaticMarkup(
      <PreEvaluatorTriageContent
        opportunityId="00000000-0000-4000-8000-000000000002"
        triage={{
          ...base,
          outcome: "REJECT",
          automaticOutcome: "REJECT",
          reasons: [{ ...base.reasons[0]!, disposition: "REJECT", message: "The salary ceiling is below the hard minimum." }],
        }}
        pending={null}
        message={null}
        error={null}
        onDecide={vi.fn()}
      />,
    );
    expect(html).toContain("Rejected before evaluation");
    expect(html).not.toContain("<button");
  });
});
