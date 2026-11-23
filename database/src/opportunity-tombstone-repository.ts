import { createHash } from "node:crypto";
import { getDatabaseClient } from "./client";

// Tombstones of permanently deleted opportunities (November 22, 2026):
// SHA-256 fingerprints of the listing identities only (a source's own
// listing ID, the job page's address, a results-page capture identity), with
// no title, company or content. Automatic acquisition checks them so that a
// deleted job is never captured again automatically; a deliberate manual
// capture clears the matching fingerprints.

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// A job page address in one canonical form: lower-case scheme and host, no
// fragment, no tracking (utm_*) parameters, remaining parameters sorted, no
// trailing slash. Null when it is not an http(s) URL.
export function canonicalListingUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith("utm_"))
    .sort(([left], [right]) => left.localeCompare(right));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "";
  return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${path}${query}`;
}

export interface ListingIdentity {
  source?: string | null;
  externalId?: string | null;
  sourceUrl?: string | null;
  // A results-page capture's listing identity (PageCaptureItem.externalId).
  pageCaptureExternalId?: string | null;
}

export function listingFingerprints(identity: ListingIdentity): string[] {
  const keys: string[] = [];
  if (identity.source && identity.externalId) keys.push(`listing:${identity.source.toLowerCase()}:${identity.externalId}`);
  const url = canonicalListingUrl(identity.sourceUrl);
  if (url) keys.push(`url:${url}`);
  if (identity.pageCaptureExternalId) keys.push(`page:${identity.pageCaptureExternalId}`);
  return [...new Set(keys)].map(sha256);
}

type TombstoneClient = Pick<ReturnType<typeof getDatabaseClient>, "deletedOpportunityTombstone">;

export class PrismaOpportunityTombstoneRepository {
  constructor(private readonly database: TombstoneClient = getDatabaseClient()) {}

  async isDeleted(identity: ListingIdentity): Promise<boolean> {
    const fingerprints = listingFingerprints(identity);
    if (!fingerprints.length) return false;
    return (await this.database.deletedOpportunityTombstone.count({ where: { fingerprint: { in: fingerprints } } })) > 0;
  }

  async record(identities: readonly ListingIdentity[], at: Date): Promise<number> {
    const fingerprints = [...new Set(identities.flatMap(listingFingerprints))];
    if (!fingerprints.length) return 0;
    const result = await this.database.deletedOpportunityTombstone.createMany({
      data: fingerprints.map((fingerprint) => ({ fingerprint, deletedAt: at })),
      skipDuplicates: true,
    });
    return result.count;
  }

  // A deliberate manual capture of a deleted job: automatic acquisition may
  // observe it again (it then deduplicates into the new opportunity).
  async clear(identity: ListingIdentity): Promise<number> {
    const fingerprints = listingFingerprints(identity);
    if (!fingerprints.length) return 0;
    return (await this.database.deletedOpportunityTombstone.deleteMany({ where: { fingerprint: { in: fingerprints } } })).count;
  }
}
