import {
  derivePostingHistoryFacts,
  isNoLongerListed,
  listingStatus,
  type PostingHistoryContentVersion,
  type PostingHistoryFact,
  type PostingHistoryListing,
} from "@ai-career/core";
import type { ManualOpportunityDetail } from "@ai-career/core";
import type { RetrievedListingRecord } from "@ai-career/database";

// Feature 13: where and when a retrieved opportunity's listings have been
// seen, from the listing ledger and the stored content versions. Objective
// facts only: no risk label (Ghost Job Risk stays the evaluator's), and
// nothing here changes the opportunity's lifecycle.

const when = (value: Date) => `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const day = (value: Date) => value.toISOString().slice(0, 10);

export const factLabels: Record<PostingHistoryFact["type"], string> = {
  ACTIVE_ATS: "Listed on the employer's board",
  CURRENT_POSTING: "Currently listed",
  UNCHANGED_OVER_TIME: "Unchanged for a long time",
  REPOSTED: "Listed again after removal",
  CLOSED_ATS_VISIBLE_ELSEWHERE: "Removed by the employer, still visible elsewhere",
  AGGREGATOR_VISIBILITY: "Seen on an aggregator",
};

export function toPostingHistoryListing(record: RetrievedListingRecord): PostingHistoryListing {
  return {
    sourceName: record.retrievalSource.name,
    sourceCategory: record.retrievalSource.sourceCategory,
    scheduleMinutes: record.retrievalSource.scheduleMinutes,
    removalCapable: record.removalCapable,
    currentScope: record.currentScope,
    state: record.state,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    missingSince: record.missingSince,
    removedAt: record.removedAt,
    reappearedAt: record.reappearedAt,
    reappearances: record.reappearances,
    sourceExpiresAt: record.sourceExpiresAt,
  };
}

type SourceRecordView = ManualOpportunityDetail["sourceRecords"][number];

// Retrieved content versions: each retrieved SourceRecord, superseded when a
// later changed observation points at it.
export function contentVersions(sourceRecords: readonly SourceRecordView[]): PostingHistoryContentVersion[] {
  const superseded = new Set(sourceRecords.map((record) => record.previousSourceRecordId).filter(Boolean));
  return sourceRecords
    .filter((record) => record.retrievalType)
    .map((record) => ({
      sourceName: record.retrievalSourceName ?? record.source,
      discoveredAt: new Date(record.discoveredAt),
      lastObservedAt: new Date(record.lastObservedAt),
      superseded: superseded.has(record.id),
    }));
}

function statusText(listing: PostingHistoryListing, now: Date): string {
  switch (listingStatus(listing, now)) {
    case "listed":
      return `Still listed (seen ${when(listing.lastSeenAt)})`;
    case "listed_again":
      return `Listed again on ${when(listing.reappearedAt!)} (seen ${when(listing.lastSeenAt)})`;
    case "missing":
      return `Not found in the latest complete check (since ${when(listing.missingSince!)})`;
    case "removed":
      return `No longer listed (not found since ${when(listing.missingSince ?? listing.removedAt!)}; confirmed ${when(listing.removedAt!)})`;
    case "untracked":
      return `No longer tracked: the source's settings changed (last observed ${when(listing.lastSeenAt)})`;
    default:
      return `Last observed ${when(listing.lastSeenAt)}; current status unknown`;
  }
}

export function PostingHistory({
  listings,
  sourceRecords,
  now,
}: {
  listings: readonly RetrievedListingRecord[];
  sourceRecords: readonly SourceRecordView[];
  now: Date;
}) {
  if (!listings.length) return null;
  const history = listings.map(toPostingHistoryListing);
  const facts = derivePostingHistoryFacts({ listings: history, contentVersions: contentVersions(sourceRecords), now });
  return (
    <section className="posting-history" aria-labelledby="posting-history-heading">
      <h2 id="posting-history-heading">Posting history</h2>
      {isNoLongerListed(history) ? (
        <p className="listing-changed" role="status">
          <strong>No longer listed</strong>: every source that can confirm it has removed this listing. The opportunity is
          kept; archive it yourself if you no longer need it.
        </p>
      ) : null}
      <ul className="provenance-list">
        {history.map((listing, index) => (
          <li key={listings[index]!.id}>
            <strong>{listing.sourceName}</strong>: {statusText(listing, now)}
            <br />
            <span className="field-help">
              First seen {when(listing.firstSeenAt)}
              {listing.sourceExpiresAt ? ` · The source states it expires ${day(listing.sourceExpiresAt)}` : ""}
              {listing.removalCapable
                ? ""
                : " · This source shows a limited window, so it cannot confirm that a listing was removed."}
            </span>
          </li>
        ))}
      </ul>
      {facts.length ? (
        <>
          <h3>Observed facts</h3>
          <ul className="provenance-list">
            {facts.map((fact, index) => (
              <li key={`${fact.type}-${index}`}>
                <strong>{factLabels[fact.type]}</strong>: {fact.description}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
