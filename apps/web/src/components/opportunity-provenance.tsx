import type { ManualOpportunityDetail } from "@ai-career/core";
import { describeMatchedOn } from "./duplicate-labels";
import { ExternalLink } from "./external-link";
import { retrievalSummary } from "./sources/source-labels";

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

function matchedOn(evidence: unknown): string[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const value = (evidence as Record<string, unknown>).matchedOn;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function metadataText(sourceMetadata: unknown, key: string): string | null {
  if (!sourceMetadata || typeof sourceMetadata !== "object" || Array.isArray(sourceMetadata)) return null;
  const value = (sourceMetadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type SourceRecordView = ManualOpportunityDetail["sourceRecords"][number];

// "Greenhouse (employer ATS · official API or feed)" for a retrieved record.
export function retrievedVia(record: SourceRecordView): string | null {
  if (!record.retrievalType && !record.sourceCategory) return null;
  const name = metadataText(record.sourceMetadata, "sourceName") ?? record.source;
  return `${name} (${retrievalSummary(record.sourceCategory, record.retrievalType)})`;
}

// The most recent changed observation of a retrieved listing, if any.
export function latestListingChange(sourceRecords: SourceRecordView[]): Date | null {
  const changed = sourceRecords.filter((record) => record.previousSourceRecordId);
  if (!changed.length) return null;
  return changed.map((record) => new Date(record.discoveredAt)).sort((left, right) => right.getTime() - left.getTime())[0]!;
}

// Readable names for known source slugs; the slug is still shown.
const sourceNames: Record<string, string> = { "manual-input": "Manual entry" };

function sourceDisplay(source: string | null | undefined) {
  if (!source) return "Unknown";
  return sourceNames[source] ? `${sourceNames[source]} (${source})` : source;
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
  const first = sourceRecords[0];
  const firstRetrieved = first ? retrievedVia(first) : null;
  const attribution = first ? metadataText(first.sourceMetadata, "attribution") : null;
  const changedAt = latestListingChange(sourceRecords);
  return (
    <section className="provenance" aria-labelledby="provenance-title">
      <h2 id="provenance-title">Source and provenance</h2>
      {changedAt ? (
        <p className="listing-changed" role="note">
          <strong>Listing changed since first seen</strong> (latest change found {timestamp(changedAt)}). The opportunity
          shows the latest version of the listing it was found from; every earlier version is kept below. An earlier
          evaluation stays as it was and may describe an earlier version; reevaluating is up to you.
        </p>
      ) : null}
      <dl>
        <div><dt>Entry method</dt><dd>{sourceTypeLabel(opportunity.sourceType)}</dd></div>
        <div><dt>Source</dt><dd>{sourceDisplay(opportunity.source)}</dd></div>
        <div>
          <dt>Found via</dt>
          <dd>
            {firstRetrieved ?? text(reportedSource(first?.sourceMetadata))}
            {/* A source's required attribution links back to its listing (no nofollow). */}
            {attribution ? <> · {first?.sourceUrl ? <ExternalLink href={first.sourceUrl}>{attribution}</ExternalLink> : attribution}</> : null}
          </dd>
        </div>
        <div><dt>First seen</dt><dd>{timestamp(opportunity.firstSeenAt)}</dd></div>
        <div><dt>Last seen</dt><dd>{timestamp(opportunity.lastSeenAt)}</dd></div>
        <div><dt>Source last updated</dt><dd>{timestamp(opportunity.sourceUpdatedAt)}</dd></div>
      </dl>
      <h3>Source records ({sourceRecords.length})</h3>
      <ol className="source-record-list">
        {sourceRecords.map((record) => {
          const reported = reportedSource(record.sourceMetadata);
          const via = retrievedVia(record);
          return (
            <li key={record.id}>
              <p className="source-record-heading">
                <strong>{sourceTypeLabel(record.sourceType)}</strong> · {record.source}
                {reported ? <> · <span>Reported by you: found on {reported}</span></> : null}
                {via ? <> · <span>Found via {via}</span></> : null}
              </p>
              {record.retrievalSourceId ? (
                <p className="source-record-retrieval">
                  Retrieved by your source {record.retrievalSourceName ? `“${record.retrievalSourceName}”` : <code>{record.retrievalSourceId}</code>}
                  {record.retrievalRunId ? <> in run <code>{record.retrievalRunId.slice(0, 8)}</code></> : null}.
                </p>
              ) : null}
              {record.previousSourceRecordId ? (
                <p className="source-record-duplicate">
                  A changed version of this listing, found {timestamp(record.discoveredAt)}. The earlier version is kept
                  (source record <code>{record.previousSourceRecordId}</code>).
                </p>
              ) : null}
              {record.duplicateDecision === "MATCH" ? (
                <p className="source-record-duplicate">
                  Added as another source on {timestamp(record.discoveredAt)}: an exact duplicate of this opportunity
                  {matchedOn(record.duplicateEvidence).length ? ` (${describeMatchedOn(matchedOn(record.duplicateEvidence))})` : ""}.
                </p>
              ) : null}
              <dl>
                <div><dt>Source URL</dt><dd><ExternalLink href={record.sourceUrl} /></dd></div>
                <div><dt>Application URL</dt><dd><ExternalLink href={record.applicationUrl} /></dd></div>
                <div><dt>Source job ID</dt><dd>{text(record.externalId)}</dd></div>
                {/* The source's own requisition field, when it has one; the opportunity's
                    requisition ID (also read from the page or the posting) is shown with
                    the normalized facts. */}
                {record.requisitionId ? <div><dt>Requisition ID</dt><dd>{record.requisitionId}</dd></div> : null}
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
