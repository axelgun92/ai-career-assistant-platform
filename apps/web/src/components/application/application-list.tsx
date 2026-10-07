import Link from "next/link";
import type { ApplicationListItem, ApplicationTrackerSummary } from "@ai-career/database";
import { applicationsHref, type ApplicationQuery } from "../../server/application-query";
import { applicationStatusLabel, followUpStateLabels, outcomeLabels } from "./labels";

// Each count links to the view it counts (interviews are informational).
export const trackerLinks = {
  active: "/applications",
  overdue: "/applications?followUp=overdue",
  today: "/applications?followUp=today",
  offers: "/applications?stage=offer",
  closed: "/applications?view=closed",
} as const;

export function TrackerSummary({ summary }: { summary: ApplicationTrackerSummary }) {
  const items = [
    { label: "Active", count: summary.active, href: trackerLinks.active },
    { label: "Follow-ups overdue", count: summary.followUpsOverdue, href: trackerLinks.overdue },
    { label: "Due today", count: summary.followUpsDueToday, href: trackerLinks.today },
    { label: "Interviews scheduled", count: summary.interviewsScheduled, href: null },
    { label: "Offers", count: summary.offers, href: trackerLinks.offers },
    { label: "Closed", count: summary.closed, href: trackerLinks.closed },
  ];
  return (
    <ul className="attention-grid" aria-label="Application summary">
      {items.map((item) => (
        <li key={item.label} className={item.count > 0 ? "attention-item attention-item-active" : "attention-item"}>
          {item.href ? (
            <Link href={item.href} aria-label={`${item.label}: ${item.count}`}>
              <span className="attention-count">{item.count}</span>
              <span className="attention-label">{item.label}</span>
            </Link>
          ) : (
            <span aria-label={`${item.label}: ${item.count}`}>
              <span className="attention-count">{item.count}</span>
              <span className="attention-label">{item.label}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ApplicationTable({ items }: { items: ApplicationListItem[] }) {
  return (
    <div className="table-scroll">
      <table className="application-table" aria-label="Applications">
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Company</th>
            <th scope="col">Stage</th>
            <th scope="col">Applied</th>
            <th scope="col">Next action</th>
            <th scope="col">Last activity</th>
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/opportunities/${item.opportunityId}`}>{item.title ?? "Untitled opportunity"}</Link>
              </td>
              <td>{item.companyName ?? "Unknown"}</td>
              <td>
                <span className="status-label status-label-application">
                  {applicationStatusLabel(item.stage, item.outcome)}
                </span>
              </td>
              <td>{item.appliedOn ?? "Not submitted"}</td>
              <td>
                {item.nextFollowUp ? (
                  <>
                    {item.nextFollowUp.description}
                    <br />
                    <span
                      className={
                        item.nextFollowUp.state === "OVERDUE" ? "status-label status-label-overdue" : "status-label"
                      }
                    >
                      {followUpStateLabels[item.nextFollowUp.state]} · {item.nextFollowUp.dueOn}
                    </span>
                  </>
                ) : (
                  "None"
                )}
              </td>
              <td>{item.lastActivityAt.toISOString().slice(0, 10)}</td>
              <td>{item.outcome ? `${outcomeLabels[item.outcome]}${item.closedOn ? ` · ${item.closedOn}` : ""}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApplicationPagination({ query, page, pageCount }: { query: ApplicationQuery; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const href = (target: number) => applicationsHref({ ...query, page: target });
  return (
    <nav className="pagination" aria-label="Application pages">
      {page > 1 ? <Link href={href(page - 1)} rel="prev">← Previous</Link> : <span aria-disabled="true">← Previous</span>}
      <span aria-current="page">Page {page} of {pageCount}</span>
      {page < pageCount ? <Link href={href(page + 1)} rel="next">Next →</Link> : <span aria-disabled="true">Next →</span>}
    </nav>
  );
}
