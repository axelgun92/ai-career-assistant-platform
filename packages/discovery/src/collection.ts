import type { RawOpportunity } from "@ai-career/core";
import { AdapterError, type AnySourceAdapter, type CollectContext, type CollectResult, type ListingCoverage, type ListingIssue } from "./contract";
import { buildRetrievedListing, canonicalJson, type RetrievedListingInput } from "./listing";

// A run's listing coverage (feature 13) from the IDs of every item the
// source listed, before the title filter (null where an item has no usable
// ID). It is complete only when the caller read the whole listing, every
// item had an ID and, where the source states a total, the unique IDs equal
// it exactly: fewer or more means the listing changed while it was read or
// was not read in full.
export function listingCoverage(
  ids: ReadonlyArray<string | null | undefined>,
  options: { readWholeListing: boolean; statedTotal?: number | null },
): ListingCoverage {
  const unique = new Set<string>();
  let missingId = false;
  for (const id of ids) {
    if (id) unique.add(id);
    else missingId = true;
  }
  const total = options.statedTotal;
  const totalMatches = total === undefined || total === null || unique.size === total;
  return { observedListingIds: [...unique], complete: options.readWholeListing && !missingId && totalMatches };
}

// The retrieval scope of a source's configuration, comparable across
// settings changes (feature 13): the adapter's scope fields, or the whole
// configuration.
export function trackingScopeOf(adapter: AnySourceAdapter, config: unknown): string {
  return canonicalJson(adapter.trackingScope ? adapter.trackingScope(config) : config);
}

// The item's ID by a lenient read, or null when it has none.
export function itemId<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, item: unknown, id: (value: T) => string): string | null {
  const parsed = schema.safeParse(item);
  return parsed.success ? id(parsed.data) || null : null;
}

// Shared per-item handling for adapters: the title filter first (nothing
// else about a listing is looked at before it), then the mapping. A listing
// that cannot be mapped is recorded as an issue; the others continue.
export function mapKeptItems<Item>(
  adapter: AnySourceAdapter,
  context: CollectContext,
  items: readonly Item[],
  read: {
    title(item: Item): string | null;
    externalId(item: Item): string | null;
    map(item: Item): RetrievedListingInput;
  },
): { listings: RawOpportunity[]; issues: ListingIssue[] } {
  const listings: RawOpportunity[] = [];
  const issues: ListingIssue[] = [];
  const discoveredAt = context.now();
  for (const item of items) {
    let title: string | null;
    try {
      title = read.title(item);
    } catch {
      issues.push({ externalId: safeId(read, item), code: "CONTRACT_MISMATCH", message: "Listing title could not be read" });
      continue;
    }
    if (!context.keepTitle(title)) continue;
    try {
      listings.push(buildRetrievedListing(adapter, read.map(item), { domain: context.discovery.domain, discoveredAt }));
    } catch {
      issues.push({ externalId: safeId(read, item), code: "CONTRACT_MISMATCH", message: "Listing could not be mapped" });
    }
  }
  return { listings, issues };
}

function safeId<Item>(read: { externalId(item: Item): string | null }, item: Item): string | null {
  try {
    return read.externalId(item);
  } catch {
    return null;
  }
}

// Collects page by page until done, the page cap, or a stop. A failure on
// the first request fails the run; a later one stops it and keeps what was
// collected (halted).
export async function collectPages(
  context: CollectContext,
  fetchPage: (page: number) => Promise<{ listings: RawOpportunity[]; issues: ListingIssue[]; fetched: number; more: boolean }>,
): Promise<CollectResult> {
  const result: CollectResult = { listings: [], fetched: 0, issues: [], halted: null, requests: 0 };
  for (let page = 0; page < Math.max(1, context.maxPages); page += 1) {
    let pageResult: Awaited<ReturnType<typeof fetchPage>>;
    try {
      result.requests += 1;
      pageResult = await fetchPage(page);
    } catch (error) {
      if (page === 0 || !(error instanceof AdapterError)) throw error;
      result.halted = error;
      break;
    }
    result.listings.push(...pageResult.listings);
    result.issues.push(...pageResult.issues);
    result.fetched += pageResult.fetched;
    if (!pageResult.more) break;
  }
  return result;
}

// Reads a response with a lenient zod schema; a mismatch is reported as a
// contract change, never guessed around.
export function parseResponse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown, url: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AdapterError("CONTRACT_MISMATCH", "Response does not match the expected shape", { url });
  return parsed.data;
}

// Reads each listing with a lenient schema; one that does not match is an
// issue for that listing only.
export function parseItems<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  items: readonly unknown[],
): { valid: T[]; issues: ListingIssue[] } {
  const valid: T[] = [];
  const issues: ListingIssue[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
    else issues.push({ externalId: null, code: "CONTRACT_MISMATCH", message: "Listing does not match the expected shape" });
  }
  return { valid, issues };
}

// Which kept listings get one of the run's detail requests (at most
// maxDetailRequests), for sources whose list has no full description.
// Listings never stored from this source go first, oldest first: they are
// the closest to leaving the window a run can see. Stored listings get what
// is left, longest since last checked first, so a stored listing never holds
// a place ahead of an unseen one and stored listings take turns from run to
// run. "Oldest" uses the posting date when the list gives one; a listing
// without a readable date goes after the dated ones, and among those a later
// place in the list goes first. No chronological order is assumed: a later
// place is simply closer to leaving the bounded window a run reads.
export async function prioritizeDetailRequests<Item extends { id: string }>(
  context: Pick<CollectContext, "lastChecked" | "maxDetailRequests">,
  items: readonly Item[],
  postedAt: (item: Item) => string | null | undefined = () => null,
): Promise<Item[]> {
  const cap = Math.max(0, context.maxDetailRequests);
  if (!items.length || !cap) return [];
  const checked = context.lastChecked ? await context.lastChecked(items.map((item) => item.id)) : new Map<string, Date>();
  const entries = items.map((item, position) => {
    const time = Date.parse(postedAt(item) ?? "");
    return { item, position, posted: Number.isNaN(time) ? null : time, checkedAt: checked.get(item.id)?.getTime() ?? null };
  });
  type Entry = (typeof entries)[number];
  const olderFirst = (a: Entry, b: Entry) => {
    if (a.posted !== null && b.posted !== null && a.posted !== b.posted) return a.posted - b.posted;
    if ((a.posted === null) !== (b.posted === null)) return a.posted === null ? 1 : -1;
    return b.position - a.position;
  };
  const unseen = entries.filter((entry) => entry.checkedAt === null).sort(olderFirst);
  const stored = entries
    .filter((entry) => entry.checkedAt !== null)
    .sort((a, b) => (a.checkedAt! !== b.checkedAt! ? a.checkedAt! - b.checkedAt! : olderFirst(a, b)));
  return [...unseen, ...stored].slice(0, cap).map((entry) => entry.item);
}
