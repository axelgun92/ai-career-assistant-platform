import Link from "next/link";
import type { OpportunityListItem } from "@ai-career/database";
import { formatDate, formatLabel, formatLifecycle, formatText } from "./format";

function LatestEvaluation({ evaluation }: { evaluation: OpportunityListItem["latestEvaluation"] }) {
  if (!evaluation) return <span className="status-label">Not evaluated</span>;
  return (
    <>
      {evaluation.decision ? (
        <span className="status-label status-label-decision">{formatLabel(evaluation.decision)}</span>
      ) : null}
      <span className="status-label">Evaluation {formatLabel(evaluation.status).toLowerCase()}</span>
    </>
  );
}

export function OpportunityList({ opportunities }: { opportunities: OpportunityListItem[] }) {
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
      {opportunities.map((opportunity) => (
        <li key={opportunity.id} className="opportunity-row">
          <div className="opportunity-row-main">
            <Link href={`/opportunities/${opportunity.id}`} className="opportunity-row-title">
              {opportunity.title ?? "Untitled opportunity"}
            </Link>
            <span>{formatText(opportunity.companyName)}</span>
          </div>
          <dl className="opportunity-row-facts">
            <div>
              <dt>Location</dt>
              <dd>{formatText(opportunity.location)}</dd>
            </div>
            <div>
              <dt>Compensation</dt>
              <dd>{formatText(opportunity.salaryText)}</dd>
            </div>
            <div>
              <dt>Domain</dt>
              <dd>{formatLabel(opportunity.domain)}</dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{formatDate(opportunity.createdAt)}</dd>
            </div>
          </dl>
          <div className="opportunity-row-status">
            <span className="status-label status-label-lifecycle">
              {formatLifecycle(opportunity.status)}
            </span>
            <LatestEvaluation evaluation={opportunity.latestEvaluation} />
          </div>
        </li>
      ))}
    </ul>
  );
}
