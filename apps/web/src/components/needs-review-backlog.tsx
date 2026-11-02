"use client";

import Link from "next/link";
import { PreEvaluatorTriagePanel, type PreEvaluatorTriagePresentation } from "./pre-evaluator-triage";

export function NeedsReviewBacklog({
  items,
}: {
  items: Array<{
    opportunityId: string;
    opportunityTitle: string | null;
    companyName: string | null;
    triage: PreEvaluatorTriagePresentation;
  }>;
}) {
  return (
    <section className="needs-review-backlog" id="pre-evaluator-review" aria-labelledby="pre-evaluator-review-title">
      <h2 id="pre-evaluator-review-title">Needs Review before evaluation</h2>
      {items.length === 0 ? (
        <p className="empty-state">No jobs are waiting for a pre-evaluator decision.</p>
      ) : (
        <>
          <p className="field-help">
            These jobs are held before evaluator admission. They consume no evaluator budget until you choose Evaluate.
          </p>
          {items.map((item) => (
            <article key={item.opportunityId} className="needs-review-item">
              <h3>
                <Link href={`/opportunities/${item.opportunityId}`}>
                  {item.opportunityTitle ?? "Untitled opportunity"}
                </Link>
              </h3>
              <p>{item.companyName ?? "Unknown company"}</p>
              <PreEvaluatorTriagePanel opportunityId={item.opportunityId} triage={item.triage} />
            </article>
          ))}
        </>
      )}
    </section>
  );
}
