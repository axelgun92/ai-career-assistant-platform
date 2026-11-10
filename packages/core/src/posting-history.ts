// Posting history (feature 13, Core TDD §51).
//
// Objective, deterministic facts about a retrieved opportunity's listings,
// derived from the listing ledger (RetrievedListing) and the stored content
// versions (SourceRecord). Nothing here reads description text, calls a
// model or judges risk. The fact types and shape match the Customer Success
// evaluator's posting-history input, but feature 13 does not deliver them to
// the evaluator: loadSubject() is unchanged, and adopting them is left to the
// coordinated evaluator integration (HANDOFFS.md).

export type ListingTrackingState = "HISTORICAL" | "LISTED" | "MISSING" | "REMOVED" | "UNTRACKED";

export interface PostingHistoryListing {
  sourceName: string;
  sourceCategory: string;
  scheduleMinutes: number;
  removalCapable: boolean;
  // Whether the listing belongs to its source's current tracking scope.
  currentScope: boolean;
  state: ListingTrackingState;
  firstSeenAt: Date;
  lastSeenAt: Date;
  missingSince: Date | null;
  removedAt: Date | null;
  reappearedAt: Date | null;
  reappearances: number;
  sourceExpiresAt: Date | null;
}

// One stored content version of a retrieved listing (a SourceRecord with a
// content hash). superseded: a later changed observation exists.
export interface PostingHistoryContentVersion {
  sourceName: string;
  discoveredAt: Date;
  lastObservedAt: Date;
  superseded: boolean;
}

export type PostingHistoryFactType =
  | "CURRENT_POSTING"
  | "ACTIVE_ATS"
  | "UNCHANGED_OVER_TIME"
  | "REPOSTED"
  | "CLOSED_ATS_VISIBLE_ELSEWHERE"
  | "AGGREGATOR_VISIBILITY";

export interface PostingHistoryFact {
  type: PostingHistoryFactType;
  description: string;
  occurredAt: Date | null;
}

// Content unchanged for at least this long counts as UNCHANGED_OVER_TIME.
export const unchangedContentDays = 30;

const dayMs = 24 * 60 * 60 * 1000;
const employerCategories = new Set(["ATS", "COMPANY_CAREERS"]);
const elsewhereCategories = new Set(["JOB_BOARD", "AGGREGATOR", "MARKETPLACE"]);
const day = (value: Date) => value.toISOString().slice(0, 10);

// Seen listed within two schedule intervals of now: a positive sighting
// only. Absence from a bounded source never makes a listing not current.
export function isRecentlyListed(listing: Pick<PostingHistoryListing, "state" | "lastSeenAt" | "scheduleMinutes" | "currentScope">, now: Date): boolean {
  if (!listing.currentScope || listing.state !== "LISTED") return false;
  return now.getTime() - listing.lastSeenAt.getTime() <= 2 * Math.max(1, listing.scheduleMinutes) * 60 * 1000;
}

// What the opportunity page says about one tracked listing.
export type ListingStatus = "listed" | "listed_again" | "unknown" | "missing" | "removed" | "untracked";

export function listingStatus(listing: PostingHistoryListing, now: Date): ListingStatus {
  if (!listing.currentScope || listing.state === "UNTRACKED") return "untracked";
  if (listing.state === "REMOVED") return "removed";
  if (listing.state === "MISSING") return "missing";
  if (listing.state === "LISTED" && isRecentlyListed(listing, now)) return listing.reappearedAt ? "listed_again" : "listed";
  // HISTORICAL, or not seen recently (a bounded window, a paused source).
  return "unknown";
}

// "No longer listed": every current-scope listing from a source that can
// confirm removal is confirmed REMOVED (at least one), and no current-scope
// listing from any source was seen after the latest of those removals. A
// HISTORICAL removal-capable listing (status unknown) keeps the badge off.
export function isNoLongerListed(listings: readonly PostingHistoryListing[]): boolean {
  const current = listings.filter((listing) => listing.currentScope && listing.state !== "UNTRACKED");
  const capable = current.filter((listing) => listing.removalCapable);
  if (!capable.length || capable.some((listing) => listing.state !== "REMOVED" || !listing.removedAt)) return false;
  const latestRemoval = Math.max(...capable.map((listing) => listing.removedAt!.getTime()));
  return !current.some((listing) => listing.lastSeenAt.getTime() > latestRemoval);
}

export function derivePostingHistoryFacts(input: {
  listings: readonly PostingHistoryListing[];
  contentVersions: readonly PostingHistoryContentVersion[];
  now: Date;
}): PostingHistoryFact[] {
  const facts: PostingHistoryFact[] = [];
  const current = input.listings.filter((listing) => listing.currentScope && listing.state !== "UNTRACKED");
  for (const listing of current) {
    if (isRecentlyListed(listing, input.now)) {
      facts.push(
        employerCategories.has(listing.sourceCategory)
          ? { type: "ACTIVE_ATS", description: `Listed on the employer's ${listing.sourceName} board, last seen ${day(listing.lastSeenAt)}.`, occurredAt: listing.lastSeenAt }
          : { type: "CURRENT_POSTING", description: `Listed on ${listing.sourceName}, last seen ${day(listing.lastSeenAt)}.`, occurredAt: listing.lastSeenAt },
      );
    }
    if (listing.reappearedAt && listing.reappearances > 0) {
      facts.push({
        type: "REPOSTED",
        description: `Listed again on ${listing.sourceName} on ${day(listing.reappearedAt)} after it had been confirmed removed (${listing.reappearances} time${listing.reappearances === 1 ? "" : "s"}).`,
        occurredAt: listing.reappearedAt,
      });
    }
    if (listing.sourceCategory === "AGGREGATOR") {
      facts.push({ type: "AGGREGATOR_VISIBILITY", description: `Seen on the aggregator ${listing.sourceName}, last seen ${day(listing.lastSeenAt)}.`, occurredAt: listing.lastSeenAt });
    }
  }
  for (const closed of current) {
    if (closed.state !== "REMOVED" || !closed.removedAt || !employerCategories.has(closed.sourceCategory)) continue;
    const elsewhere = current.filter(
      (listing) => elsewhereCategories.has(listing.sourceCategory) && listing.lastSeenAt.getTime() > closed.removedAt!.getTime(),
    );
    for (const other of elsewhere) {
      facts.push({
        type: "CLOSED_ATS_VISIBLE_ELSEWHERE",
        description: `No longer listed on the employer's ${closed.sourceName} board (confirmed ${day(closed.removedAt)}) but seen on ${other.sourceName} afterwards (${day(other.lastSeenAt)}).`,
        occurredAt: other.lastSeenAt,
      });
    }
  }
  for (const version of input.contentVersions) {
    // Content observations only: the same content seen again through a
    // content-bearing retrieval, at least 30 days after it was first stored.
    const unchangedFor = version.lastObservedAt.getTime() - version.discoveredAt.getTime();
    if (version.superseded || unchangedFor < unchangedContentDays * dayMs) continue;
    facts.push({
      type: "UNCHANGED_OVER_TIME",
      description: `The listing's content on ${version.sourceName} was unchanged for ${Math.floor(unchangedFor / dayMs)} days (first stored ${day(version.discoveredAt)}, last observed ${day(version.lastObservedAt)}).`,
      occurredAt: version.lastObservedAt,
    });
  }
  return facts;
}
