import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerSuccessResults } from "../../apps/web/src/components/customer-success/customer-success-results";
import {
  createUiEvaluation,
  uiOpportunity,
} from "../fixtures/customer-success-ui";

describe("Customer Success results presentation", () => {
  it.each(["APPLY", "REVIEW", "SKIP"] as const)(
    "renders the persisted %s recommendation without recalculating it",
    (decision) => {
      const evaluation = createUiEvaluation(decision);
      const html = renderToStaticMarkup(
        <CustomerSuccessResults opportunity={uiOpportunity} evaluation={evaluation} />,
      );
      expect(html).toContain(`classification-${decision.toLowerCase()}`);
      expect(html).toContain(`${decision === "APPLY" ? "Apply" : decision[0] + decision.slice(1).toLowerCase()} based on the persisted evaluation evidence.`);
    },
  );

  it("presents the complete decision hierarchy without an Overall Match field", () => {
    const html = renderToStaticMarkup(
      <CustomerSuccessResults
        opportunity={uiOpportunity}
        evaluation={createUiEvaluation()}
      />,
    );
    for (const heading of [
      "Hard Filters",
      "Job Evaluation",
      "Company Alignment",
      "Organizational Maturity",
      "Alex Fit",
      "Burnout Risk",
      "Resume Match",
      "Effective Level",
      "Opportunity Priority",
      "Ghost Job Risk",
    ]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("Higher means greater burnout risk.");
    expect(html).toContain("Higher means stronger evidence-backed Resume Match.");
    expect(html).toContain("Higher means greater application priority, not overall job quality.");
    expect(html).toContain("Target Level");
    expect(html).toContain("Unknown does not mean Low Risk");
    expect(html).not.toMatch(/overallScore|Overall Match/);
    expect((html.match(/<details/g) ?? [])).toHaveLength(12);
  });

  it("distinguishes requirement impact, transferable evidence, Unknowns, and contradictions", () => {
    const html = renderToStaticMarkup(
      <CustomerSuccessResults opportunity={uiOpportunity} evaluation={createUiEvaluation("REVIEW")} />,
    );
    expect(html).toContain("Transferable Match");
    expect(html).toContain("Preferred");
    expect(html).toContain("Non Decisive");
    expect(html).toContain("Genuine Gap");
    expect(html).toContain("Portfolio size is not stated");
    expect(html).toContain("Unresolved contradiction");
    expect(html).toContain("This affects Effective Level confidence");
  });

  it("renders untrusted JD markup only as text and distinguishes evidence sources", () => {
    const html = renderToStaticMarkup(
      <CustomerSuccessResults opportunity={uiOpportunity} evaluation={createUiEvaluation()} />,
    );
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Job-description evidence");
    expect(html).toContain("Candidate profile evidence");
    expect(html).toContain("Explicit");
    expect(html).toContain("Confirmed");
  });

  it("fails safely when an evidence reference cannot be resolved", () => {
    const evaluation = createUiEvaluation();
    evaluation.evidence = [];
    const html = renderToStaticMarkup(
      <CustomerSuccessResults opportunity={uiOpportunity} evaluation={evaluation} />,
    );
    expect(html).toContain("Supporting evidence is unavailable.");
    expect(html).not.toContain("jd-work");
    expect(html).not.toContain("profile-work");
  });
});
