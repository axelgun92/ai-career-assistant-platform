// Processing-status visibility (November 23, 2026): the shared presentation
// read from stored records, the dashboard row's concise summary, and the
// opportunity page's breakdown. Triage outcomes are always labelled as
// triage, never as the AI evaluator's recommendation.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OpportunityListItem } from "@ai-career/database";
import { OpportunityList } from "../../apps/web/src/components/dashboard/opportunity-list";
import { duplicateStageOf, ProcessingBreakdown } from "../../apps/web/src/components/processing-breakdown";
import { evaluationStageOf, processingStatusOf, type ProcessingStatusInput } from "../../apps/web/src/components/processing-status";

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const at = new Date("2026-11-23T12:00:00.000Z");
const none: ProcessingStatusInput = { triage: null, latestEvaluationStatus: null, deferred: false, recommendation: null };

describe("processing status", () => {
  it("tells a job that passed triage but was not evaluated from one that never reached triage", () => {
    expect(processingStatusOf(none)).toMatchObject({
      triage: { stage: "NOT_ASSESSED", label: "Triage: not assessed" },
      evaluation: { stage: "NOT_REQUESTED", label: "Not evaluated" },
      recommendation: null,
      summary: "Not yet triaged",
    });
    expect(processingStatusOf({ ...none, triage: { outcome: "EVALUATE", manual: false } })).toMatchObject({
      triage: { stage: "EVALUATE", label: "Triage: Evaluate", detail: "Passed pre-evaluator triage: eligible for AI evaluation." },
      evaluation: { stage: "NOT_REQUESTED" },
      summary: "Passed triage; not yet evaluated",
    });
  });

  it("names triage holds and rejections as triage, never as evaluator recommendations", () => {
    const review = processingStatusOf({ ...none, triage: { outcome: "NEEDS_REVIEW", manual: false } });
    expect(review.triage.label).toBe("Triage: Needs review");
    expect(review.summary).toBe("Held by triage for your review");
    expect(review.recommendation).toBeNull();
    const reject = processingStatusOf({ ...none, triage: { outcome: "REJECT", manual: true } });
    expect(reject.triage.label).toBe("Triage: Reject (your decision)");
    expect(reject.triage.detail).toContain("You decided this.");
    expect(reject.summary).toBe("Rejected by triage before evaluation");
  });

  it("covers every evaluation state; an active evaluation wins over an open deferral", () => {
    expect(evaluationStageOf({ latestEvaluationStatus: "PENDING", deferred: true })).toBe("QUEUED");
    expect(evaluationStageOf({ latestEvaluationStatus: "RUNNING", deferred: false })).toBe("RUNNING");
    expect(evaluationStageOf({ latestEvaluationStatus: null, deferred: true })).toBe("DEFERRED");
    expect(evaluationStageOf({ latestEvaluationStatus: "COMPLETED", deferred: true })).toBe("DEFERRED");
    expect(evaluationStageOf({ latestEvaluationStatus: "COMPLETED", deferred: false })).toBe("COMPLETED");
    expect(evaluationStageOf({ latestEvaluationStatus: "FAILED", deferred: false })).toBe("FAILED");
    expect(evaluationStageOf({ latestEvaluationStatus: null, deferred: false })).toBe("NOT_REQUESTED");
  });

  it("shows the evaluator's recommendation only from an evaluation, marked when it is from the last completed one", () => {
    const evaluated = processingStatusOf({
      triage: { outcome: "EVALUATE", manual: false }, latestEvaluationStatus: "COMPLETED", deferred: false,
      recommendation: { decision: "APPLY", isLatest: true },
    });
    expect(evaluated.recommendation?.label).toBe("Apply");
    expect(evaluated.summary).toBe("Evaluated: Apply");
    const failed = processingStatusOf({ ...none, latestEvaluationStatus: "FAILED", recommendation: { decision: "SKIP", isLatest: false } });
    expect(failed.summary).toBe("Evaluation failed; last result Skip (last completed)");
    expect(processingStatusOf({ ...none, latestEvaluationStatus: "RUNNING" }).summary).toBe("Evaluation running");
    expect(processingStatusOf({ ...none, deferred: true }).summary).toBe("Evaluation deferred");
  });
});

function item(overrides: Partial<OpportunityListItem> = {}): OpportunityListItem {
  return {
    id: "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22", domain: "customer-success", status: "NORMALIZED", source: "greenhouse", sourceType: "OFFICIAL_PUBLIC_API_FEED",
    title: "Customer Success Manager", companyName: "Acme", location: "Remote", salaryText: null, postingDate: null,
    createdAt: at, discoveredAt: at, updatedAt: at, applicationUrl: null, deferred: false, triage: null,
    latestEvaluation: null, currentRecommendation: null, priorityBand: null, roleFamily: null, customerSegment: null, application: null,
    ...overrides,
  } as OpportunityListItem;
}

describe("dashboard rows", () => {
  it("summarise processing in one group: triage, evaluation and the AI recommendation, each labelled", () => {
    const markup = renderToStaticMarkup(
      <OpportunityList
        opportunities={[
          item({ id: "00000000-0000-4000-8000-000000000001", title: "Never triaged" }),
          item({ id: "00000000-0000-4000-8000-000000000002", title: "Cleared", triage: { outcome: "EVALUATE", manual: false } }),
          item({ id: "00000000-0000-4000-8000-000000000003", title: "Held", triage: { outcome: "NEEDS_REVIEW", manual: false } }),
          item({
            id: "00000000-0000-4000-8000-000000000004", title: "Evaluated", status: "RECOMMENDED", triage: { outcome: "EVALUATE", manual: false },
            latestEvaluation: { id: "e", status: "COMPLETED", decision: "REVIEW", createdAt: at, completedAt: at },
            currentRecommendation: { decision: "REVIEW", evaluationId: "e", isLatest: true },
          }),
        ]}
      />,
    );
    const rows = markup.split('<li class="opportunity-row').slice(1).map(text);
    expect(rows[0]).toContain("Triage: not assessed");
    expect(rows[0]).toContain("Not evaluated");
    expect(rows[1]).toContain("Triage: Evaluate");
    expect(rows[1]).toContain("Not evaluated");
    expect(rows[2]).toContain("Triage: Needs review");
    expect(rows[2]).not.toContain("AI recommendation");
    expect(rows[3]).toContain("Triage: Evaluate");
    expect(rows[3]).toContain("AI recommendation: Review");
    expect(rows[3]).toContain("Evaluation completed");
    expect(markup).toContain('aria-label="Processing status: Not yet triaged"');
    expect(markup).toContain('aria-label="Processing status: Passed triage; not yet evaluated"');
    expect(markup).toContain('aria-label="Processing status: Held by triage for your review"');
    expect(markup).toContain('aria-label="Processing status: Evaluated: Review"');
    expect(markup.match(/status-label-triage/g)).toHaveLength(4);
  });
});

describe("opportunity page breakdown", () => {
  const status = processingStatusOf({ triage: { outcome: "EVALUATE", manual: false }, latestEvaluationStatus: null, deferred: false, recommendation: null });

  it("lists capture, the duplicate check, triage, the evaluation and the recommendation", () => {
    const visible = text(renderToStaticMarkup(
      <ProcessingBreakdown
        opportunityId="o"
        capture={{ normalized: true, observations: 2, firstFoundAt: at.toISOString() }}
        duplicate="PROBABLE_MATCH"
        status={status}
      />,
    ));
    expect(visible).toContain("Processing status Passed triage; not yet evaluated");
    expect(visible).toContain("Capture Captured and normalized (2 source observations; first found");
    expect(visible).toContain("Duplicate check Possible duplicate of another saved job: your decision is needed");
    expect(visible).toContain("Pre-evaluator triage Triage: Evaluate. Passed pre-evaluator triage: eligible for AI evaluation.");
    expect(visible).toContain("AI evaluation Not evaluated");
    expect(visible).toContain("AI recommendation None yet: a recommendation needs a completed AI evaluation.");
  });

  it("renders the first-found date the same on the server and in any browser time zone (no hydration mismatch)", () => {
    // 23:30 UTC is already the next day in Pacific/Kiritimati (UTC+14), where
    // a locale date would differ from the server's.
    const late = new Date("2026-11-26T23:30:00.000Z");
    const visible = text(renderToStaticMarkup(
      <ProcessingBreakdown opportunityId="o" capture={{ normalized: true, observations: 1, firstFoundAt: late.toISOString() }} duplicate="NONE" status={status} />,
    ));
    expect(visible).toContain("(1 source observation; first found 2026-11-26).");
  });

  it("says it is checking while the live evaluation status loads", () => {
    const visible = text(renderToStaticMarkup(
      <ProcessingBreakdown opportunityId="o" capture={{ normalized: true, observations: 1, firstFoundAt: at.toISOString() }} duplicate="NONE" status={status} checkingEvaluation />,
    ));
    expect(visible).toContain("AI evaluation Checking…");
    expect(visible).toContain("1 source observation;");
    expect(visible).toContain("No duplicate of another saved job found.");
  });

  it("reads the duplicate check from the stored relationships", () => {
    expect(duplicateStageOf([])).toBe("NONE");
    expect(duplicateStageOf([{ decision: "PROBABLE_MATCH", resolution: null }])).toBe("PROBABLE_MATCH");
    expect(duplicateStageOf([{ decision: "PROBABLE_MATCH", resolution: null }, { decision: "MATCH", resolution: null }])).toBe("MATCH");
    expect(duplicateStageOf([{ decision: "PROBABLE_MATCH", resolution: "DISTINCT" }])).toBe("RESOLVED_DISTINCT");
    expect(duplicateStageOf([{ decision: "NO_MATCH", resolution: null }])).toBe("NONE");
  });
});
