import Link from "next/link";
import type { OpportunityListItem } from "@ai-career/database";
import { formatDate, formatLabel, formatLifecycle, formatText } from "./format";
import { evaluationStatusLabel, priorityBandLabel } from "./labels";
import { sourceTypeLabel } from "../opportunity-provenance";
import { ExternalLink, safeExternalUrl } from "../external-link";

type Row = Omit<OpportunityListItem, "discoveredAt" | "updatedAt" | "applicationUrl" | "currentRecommendation" | "priorityBand" | "roleFamily" | "customerSegment"> &
  Partial<Pick<OpportunityListItem, "discoveredAt" | "updatedAt" | "applicationUrl" | "currentRecommendation" | "priorityBand" | "roleFamily" | "customerSegment">>;

function EvaluationBadges({ opportunity }: { opportunity: Row }) {
  const evaluation = opportunity.latestEvaluation;
  const recommendation = opportunity.currentRecommendation ??
    (evaluation?.decision ? { decision: evaluation.decision, isLatest: true } : null);
  const priority = priorityBandLabel(opportunity.priorityBand);
  return (
    <>
      {recommendation ? (
        <span
          className="status-label status-label-decision"
          title={recommendation.isLatest ? undefined : "From the last completed evaluation"}
        >
          {formatLabel(recommendation.decision)}
          {recommendation.isLatest ? "" : " (last completed)"}
        </span>
      ) : null}
      {priority ? <span className="status-label status-label-priority">{priority}</span> : null}
      {evaluation ? (
        <span className="status-label">{evaluationStatusLabel(evaluation.status)}</span>
      ) : opportunity.deferred ? null : (
        <span className="status-label">Not evaluated</span>
      )}
      {opportunity.deferred ? (
        <span className="status-label status-label-deferred">Evaluation deferred</span>
      ) : null}
    </>
  );
}

export function OpportunityList({ opportunities }: { opportunities: Row[] }) {
  if (opportunities.length === 0) {
    return (
      <p className="empty-state">
        No opportunities yet. <Link href="/opportunities/new">Add your first opportunity</Link> to
        start an evaluation.
      </p>
    );
  }

  return (
    <ul className="opportunity-list" aria-label="Opportunities">
      {opportunities.map((opportunity) => {
        const applicationUrl = safeExternalUrl(opportunity.applicationUrl ?? null);
        return (
          <li key={opportunity.id} className="opportunity-row">
            <div className="opportunity-row-main">
              <Link href={`/opportunities/${opportunity.id}`} className="opportunity-row-title">
                {opportunity.title ?? "Untitled opportunity"}
              </Link>
              <span>
                {formatText(opportunity.companyName)}
                {opportunity.location ? ` · ${opportunity.location}` : ""}
              </span>
            </div>
            <dl className="opportunity-row-facts">
              <div>
                <dt>Compensation</dt>
                <dd>{opportunity.salaryText?.trim() ? opportunity.salaryText : "Salary not stated"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{sourceTypeLabel(opportunity.sourceType)}</dd>
              </div>
              <div>
                <dt>Discovered</dt>
                <dd>{formatDate(opportunity.discoveredAt ?? opportunity.createdAt)}</dd>
              </div>
              <div>
                <dt>Domain</dt>
                <dd>{formatLabel(opportunity.domain)}</dd>
              </div>
            </dl>
            <div className="opportunity-row-status">
              <span className="status-label status-label-lifecycle">
                {formatLifecycle(opportunity.status)}
              </span>
              <EvaluationBadges opportunity={opportunity} />
              {applicationUrl ? (
                <ExternalLink href={applicationUrl}>Application page</ExternalLink>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
