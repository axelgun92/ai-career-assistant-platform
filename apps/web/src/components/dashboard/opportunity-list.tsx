import Link from "next/link";
import type { OpportunityListItem } from "@ai-career/database";
import { formatDate, formatLabel, formatLifecycle, formatText } from "./format";
import { evaluationStatusLabel, priorityBandLabel } from "./labels";
import { sourceTypeLabel } from "../opportunity-provenance";
import { ExternalLink, safeExternalUrl } from "../external-link";
import { applicationStatusLabel } from "../application/labels";

type Optional = "discoveredAt" | "updatedAt" | "applicationUrl" | "currentRecommendation" | "priorityBand" | "roleFamily" | "customerSegment" | "application";
type Row = Omit<OpportunityListItem, Optional> & Partial<Pick<OpportunityListItem, Optional>>;

// The application tracker's state, kept to one badge plus the next follow-up.
function ApplicationBadges({ opportunity }: { opportunity: Row }) {
  const application = opportunity.application ?? null;
  if (!application) {
    return opportunity.status === "APPLIED" ? (
      <span className="status-label status-label-muted">Not tracked yet</span>
    ) : null;
  }
  const overdue = application.nextFollowUpState === "OVERDUE";
  return (
    <>
      <span className="status-label status-label-application">
        Application: {applicationStatusLabel(application.stage, application.outcome)}
      </span>
      {application.nextFollowUpOn ? (
        <span className={overdue ? "status-label status-label-overdue" : "status-label"}>
          {overdue
            ? `Follow-up overdue · ${application.nextFollowUpOn}`
            : `Next follow-up ${application.nextFollowUpOn}`}
        </span>
      ) : null}
    </>
  );
}

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
              <ApplicationBadges opportunity={opportunity} />
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
