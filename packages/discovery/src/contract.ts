import type {
  DiscoveryConfiguration,
  OpportunitySourceType,
  RawOpportunity,
  RetrievalType,
  SourceCategory,
} from "@ai-career/core";
import type { z } from "zod";
import type { RetrievalTransport } from "./transport";

// The Core collection contract (Core TDD §8): a source adapter turns one
// source's public interface into RawOpportunity listings. Collectors only
// collect: they keep listings whose title matches the domain's role-family
// terms and never score or evaluate anything.

// Why a retrieval stopped or failed. RATE_LIMITED (HTTP 429) and
// ACCESS_DENIED (HTTP 401/403) stop all further requests to that source for
// the run; ACCESS_DENIED is an access failure, not a rate limit.
export const adapterErrorCodes = [
  "NETWORK",
  "HTTP_STATUS",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "RESPONSE_TOO_LARGE",
  "CONTRACT_MISMATCH",
  "CONFIG",
] as const;
export type AdapterErrorCode = (typeof adapterErrorCodes)[number];

// Query parameters that carry credentials; they never appear in an error,
// a log line, run history or fixture metadata.
const credentialParameter = /^(app_id|app_key|api_key|apikey|key|token|access_token|client_secret)$/i;

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const name of [...parsed.searchParams.keys()]) {
      if (credentialParameter.test(name)) parsed.searchParams.set(name, "REDACTED");
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "(invalid URL)";
  }
}

export class AdapterError extends Error {
  readonly details: { status?: number; url?: string };

  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    details: { status?: number; url?: string } = {},
  ) {
    super(message);
    this.name = "AdapterError";
    this.details = { ...details, ...(details.url ? { url: redactUrl(details.url) } : {}) };
  }
}

// A listing the adapter could not map; the rest of the run continues.
export interface ListingIssue {
  externalId: string | null;
  code: "CONTRACT_MISMATCH";
  message: string;
}

export interface CollectContext {
  transport: RetrievalTransport;
  discovery: DiscoveryConfiguration;
  // Whether a listing title is kept. Retrieval uses the domain's title
  // terms (see discovery-terms.ts); the description is never consulted.
  keepTitle: (title: string | null) => boolean;
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  // Upper bounds per run (pagination and per-listing detail requests).
  maxPages: number;
  maxDetailRequests: number;
  // When each of these source listing IDs, already stored from this
  // source, was last checked by a run; an ID not in the map has never been
  // stored. Adapters that ration per-listing detail requests use it so that
  // unseen listings go first and stored ones take turns. Without it every
  // listing counts as unseen.
  lastChecked?: (externalIds: readonly string[]) => Promise<ReadonlyMap<string, Date>>;
}

export interface CollectResult {
  // Listings kept by the title terms, mapped to RawOpportunity with
  // retrieval provenance (without the source and run ids, which the worker
  // sets).
  listings: RawOpportunity[];
  // Listings the source returned before the title filter.
  fetched: number;
  issues: ListingIssue[];
  // Set when retrieval stopped early (for example a 429 on a later page);
  // the listings collected before it are still returned.
  halted: AdapterError | null;
  requests: number;
}

// A configuration field shown on /sources for this adapter.
export interface AdapterConfigField {
  name: string;
  label: string;
  help: string;
  required: boolean;
}

export interface SourceAdapter<Config = unknown> {
  key: string;
  name: string;
  retrievalType: RetrievalType;
  sourceCategory: SourceCategory;
  sourceType: OpportunitySourceType;
  configSchema: z.ZodType<Config>;
  configFields: readonly AdapterConfigField[];
  // Environment variables that must be set before the source can run.
  requiredEnv: readonly string[];
  // False until the adapter's mapping has been checked against a real
  // response; an unverified adapter cannot be enabled.
  verified: boolean;
  // Attribution the source requires next to its listings, if any.
  attribution: string | null;
  // The single low-volume request used to verify the adapter's response
  // contract, and, where the list has no full description, the one detail
  // request derived from that response.
  verificationUrl(config: Config): string;
  verificationFollowUpUrl?(firstResponse: unknown, config: Config): string | null;
  collect(context: CollectContext, config: Config): Promise<CollectResult>;
}

export type AnySourceAdapter = SourceAdapter<any>;
