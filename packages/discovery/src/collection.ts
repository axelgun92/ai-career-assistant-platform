import type { RawOpportunity } from "@ai-career/core";
import { AdapterError, type AnySourceAdapter, type CollectContext, type CollectResult, type ListingIssue } from "./contract";
import { buildRetrievedListing, type RetrievedListingInput } from "./listing";

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
