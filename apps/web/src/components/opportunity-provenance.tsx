import type { ManualOpportunityDetail } from "@ai-career/core";
import { ExternalLink } from "./external-link";

// Domain-neutral display of where an opportunity came from. Every preserved
// SourceRecord is listed, so the section already works for opportunities with
// several sources. Values are shown as recorded; missing ones stay "Unknown".

const sourceTypeLabels: Record<string, string> = {
  MANUAL: "Manual entry",
  BROWSER_EXTENSION: "Browser extension",
  PUBLIC_SEARCH: "Public search",
  ATS: "Applicant tracking system",
  API: "API",
  COMPANY_WATCHLIST: "Company watchlist",
  OTHER: "Other source",
};

export function sourceTypeLabel(sourceType: string | null | undefined): string {
  return (sourceType ? sourceTypeLabels[sourceType] : undefined) ?? "Unknown";
}

function timestamp(value: Date | string | null | undefined): string {
  if (!value) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function text(value: string | null | undefined): string {
  return value && value.trim() ? value : "Unknown";
}

// Informational "where the user found it" note recorded for manual entries.
export function reportedSource(sourceMetadata: unknown): string | null {
  if (!sourceMetadata || typeof sourceMetadata !== "object" || Array.isArray(sourceMetadata)) {
    return null;
  }
  const value = (sourceMetadata as Record<string, unknown>).reportedSource;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function OpportunityProvenance({
  opportunity,
  sourceRecords,
}: {
  opportunity: Pick<
    ManualOpportunityDetail["opportunity"],
    "source" | "sourceType" | "firstSeenAt" | "lastSeenAt" | "sourceUpdatedAt"
  >;
  sourceRecords: ManualOpportunityDetail["sourceRecords"];
}) {
  return (
    <section className="provenance" aria-labelledby="provenance-title">
      <h2 id="provenance-title">Source and provenance</h2>
      <dl>
        <div><dt>Entry method</dt><dd>{sourceTypeLabel(opportunity.sourceType)}</dd></div>
        <div><dt>Source</dt><dd>{text(opportunity.source)}</dd></div>
        <div><dt>First seen</dt><dd>{timestamp(opportunity.firstSeenAt)}</dd></div>
        <div><dt>Last seen</dt><dd>{timestamp(opportunity.lastSeenAt)}</dd></div>
        <div><dt>Source last updated</dt><dd>{timestamp(opportunity.sourceUpdatedAt)}</dd></div>
      </dl>
      <h3>Source records ({sourceRecords.length})</h3>
      <ol className="source-record-list">
        {sourceRecords.map((record) => {
          const reported = reportedSource(record.sourceMetadata);
          return (
            <li key={record.id}>
              <p className="source-record-heading">
                <strong>{sourceTypeLabel(record.sourceType)}</strong> · {record.source}
                {reported ? <> · <span>Reported by you: found on {reported}</span></> : null}
              </p>
              <dl>
                <div><dt>Source URL</dt><dd><ExternalLink href={record.sourceUrl} /></dd></div>
                <div><dt>Application URL</dt><dd><ExternalLink href={record.applicationUrl} /></dd></div>
                <div><dt>Source job ID</dt><dd>{text(record.externalId)}</dd></div>
                <div><dt>Requisition ID</dt><dd>{text(record.requisitionId)}</dd></div>
                <div><dt>Discovered</dt><dd>{timestamp(record.discoveredAt)}</dd></div>
                <div><dt>Last observed</dt><dd>{timestamp(record.lastObservedAt)}</dd></div>
                <div><dt>Normalized</dt><dd>{timestamp(record.normalizedAt)}</dd></div>
                <div><dt>Source record ID</dt><dd><code>{record.id}</code></dd></div>
              </dl>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
