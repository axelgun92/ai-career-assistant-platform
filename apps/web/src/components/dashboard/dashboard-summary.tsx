import Link from "next/link";
import type { DashboardSummary as Summary } from "@ai-career/database";
import { sourceTypeLabel } from "../opportunity-provenance";
import { priorityBandLabel } from "./labels";

// Each count links to exactly the dashboard view it counts.
export const attentionLinks = {
  notEvaluated: "/?eval=none",
  deferred: "/?view=all&eval=deferred",
  failed: "/?eval=failed",
  recommendedApply: "/?view=triage&rec=apply",
  inProgress: "/?view=all&eval=queued&eval=running",
  followUpsDue: "/applications?followUp=due",
} as const;

function Distribution({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number; href?: string }>;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return null;
  return (
    <div className="distribution">
      <h3>{title}</h3>
      <ul>
        {rows
          .filter((row) => row.count > 0)
          .map((row) => (
            <li key={row.label}>
              <span className="distribution-label">
                {row.href ? <Link href={row.href}>{row.label}</Link> : row.label}
              </span>
              <span className="distribution-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(2, Math.round((row.count / total) * 100))}%` }} />
              </span>
              <span className="distribution-count">{row.count}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function NeedsAttention({ summary }: { summary: Summary }) {
  const items = [
    { label: "Not evaluated", count: summary.activeNotEvaluated, href: attentionLinks.notEvaluated, help: "Active opportunities with no evaluation yet" },
    { label: "Recommended to apply", count: summary.triageRecommendedApply, href: attentionLinks.recommendedApply, help: "Not yet saved, applied, or dismissed" },
    { label: "Deferred for budget", count: summary.deferred, href: attentionLinks.deferred, help: "Waiting for AI budget" },
    { label: "Evaluation failed", count: summary.activeFailed, href: attentionLinks.failed, help: "Latest evaluation failed" },
    { label: "In progress", count: summary.queued + summary.running, href: attentionLinks.inProgress, help: "Queued or running" },
    { label: "Follow-ups due", count: summary.followUpsDue, href: attentionLinks.followUpsDue, help: "Applications with a follow-up overdue or due today (UTC)" },
  ];
  return (
    <section className="needs-attention" aria-labelledby="needs-attention-title">
      <h2 id="needs-attention-title">Needs attention</h2>
      <ul className="attention-grid">
        {items.map((item) => (
          <li key={item.label} className={item.count > 0 ? "attention-item attention-item-active" : "attention-item"}>
            <Link href={item.href} aria-label={`${item.label}: ${item.count}`}>
              <span className="attention-count">{item.count}</span>
              <span className="attention-label">{item.label}</span>
            </Link>
            <span className="field-help">{item.help}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PipelineOverview({ summary }: { summary: Summary }) {
  if (summary.total === 0) return null;
  return (
    <section className="pipeline-overview" aria-labelledby="pipeline-overview-title">
      <h2 id="pipeline-overview-title">Pipeline overview</h2>
      <dl className="usage-totals-grid">
        <div><dt>Active</dt><dd>{summary.active}</dd></div>
        <div><dt>Evaluated</dt><dd>{summary.evaluated}</dd></div>
        <div><dt>Not evaluated</dt><dd>{summary.notEvaluated}</dd></div>
        <div><dt>Saved</dt><dd>{summary.saved}</dd></div>
        <div><dt>Applied</dt><dd>{summary.applied}</dd></div>
        <div><dt>Dismissed</dt><dd>{summary.dismissed}</dd></div>
        <div><dt>Archived</dt><dd>{summary.archived}</dd></div>
        <div><dt>Discovered in the last 7 days</dt><dd>{summary.discoveredLast7Days}</dd></div>
      </dl>
      <div className="distribution-grid">
        <Distribution
          title="Current recommendation"
          rows={[
            { label: "Apply", count: summary.recommendations.APPLY, href: "/?view=all&rec=apply" },
            { label: "Review", count: summary.recommendations.REVIEW, href: "/?view=all&rec=review" },
            { label: "Skip", count: summary.recommendations.SKIP, href: "/?view=all&rec=skip" },
            { label: "No recommendation yet", count: summary.recommendations.NONE, href: "/?view=all&rec=none" },
          ]}
        />
        <Distribution
          title="Priority (evaluated)"
          rows={["VERY_HIGH", "HIGH", "MIXED_MODERATE", "LOW", "VERY_LOW"]
            .map((band) => ({
              label: priorityBandLabel(band)!,
              count: summary.byPriorityBand.find((row) => row.band === band)?.count ?? 0,
            }))
            .concat([{
              label: "Priority not evaluated",
              count: summary.byPriorityBand
                .filter((row) => !["VERY_HIGH", "HIGH", "MIXED_MODERATE", "LOW", "VERY_LOW"].includes(row.band ?? ""))
                .reduce((sum, row) => sum + row.count, 0),
            }])}
        />
        <Distribution
          title="Source"
          rows={summary.bySourceType.map((row) => ({ label: sourceTypeLabel(row.sourceType), count: row.count }))}
        />
      </div>
    </section>
  );
}
