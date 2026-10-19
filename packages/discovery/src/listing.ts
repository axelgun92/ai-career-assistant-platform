import { createHash } from "node:crypto";
import {
  rawOpportunitySchema,
  retrievedStructuredFieldsSchema,
  type RawOpportunity,
  type RetrievedStructuredFields,
} from "@ai-career/core";
import { listingUrlKey } from "@ai-career/deduplication";
import type { AnySourceAdapter } from "./contract";

// Building a retrieved listing and its change-detection hash.
//
// The content hash covers only the listing's material fields: title,
// company, location, description, salary text, employment type, the
// requisition ID, the listing and application URLs (compared without
// tracking parameters), the structured facts and any extra material fields
// the adapter names. Whitespace is collapsed and object keys are sorted, so
// formatting and key order never read as a change. Fetch times, counters,
// tracking parameters, the order of listings in a response and unrelated
// response metadata are never part of it. The full response item is kept
// separately in rawPayload.source.

export interface ListingContentFields {
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  salaryText: string | null;
  employmentType: string | null;
  requisitionId: string | null;
  sourceUrl: string | null;
  applicationUrl: string | null;
  structured: RetrievedStructuredFields;
  // Adapter-specific material facts (for example a department or team).
  material: Record<string, string | number | boolean | null | readonly string[]>;
}

function collapse(value: string | null): string | null {
  const collapsed = value?.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed : null;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function listingContentHash(fields: ListingContentFields): string {
  const material = Object.fromEntries(
    Object.entries(fields.material).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value].map((item) => collapse(item)).sort() : typeof value === "string" ? collapse(value) : value,
    ]),
  );
  const canonical = canonicalJson({
    title: collapse(fields.title),
    company: collapse(fields.company),
    location: collapse(fields.location),
    description: collapse(fields.description),
    salaryText: collapse(fields.salaryText),
    employmentType: collapse(fields.employmentType),
    requisitionId: collapse(fields.requisitionId),
    sourceUrl: listingUrlKey(fields.sourceUrl) ?? collapse(fields.sourceUrl),
    applicationUrl: listingUrlKey(fields.applicationUrl) ?? collapse(fields.applicationUrl),
    structured: fields.structured,
    material,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim() ? value : null;
}

function httpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface RetrievedListingInput {
  externalId: string | null;
  requisitionId?: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  // Plain text (already converted from HTML where the source sends HTML).
  description: string | null;
  salaryText?: string | null;
  employmentType?: string | null;
  postingDate?: string | null;
  sourceUrl: string | null;
  applicationUrl: string | null;
  structured?: Partial<RetrievedStructuredFields>;
  material?: ListingContentFields["material"];
  // Source facts kept for display and later features (board, team, ...).
  metadata?: Record<string, unknown>;
  // The complete source item, kept as received.
  sourceItem: unknown;
}

// Maps an adapter's listing to a RawOpportunity with retrieval provenance.
// The worker fills in the retrieval source and run ids.
export function buildRetrievedListing(
  adapter: Pick<AnySourceAdapter, "key" | "name" | "attribution" | "sourceType" | "retrievalType" | "sourceCategory">,
  input: RetrievedListingInput,
  context: { domain: string; discoveredAt: Date },
): RawOpportunity {
  const structured = retrievedStructuredFieldsSchema.parse(input.structured ?? {});
  const fields = {
    title: text(input.title),
    company: text(input.company),
    location: text(input.location),
    description: text(input.description),
    salaryText: text(input.salaryText),
    employmentType: text(input.employmentType),
    requisitionId: text(input.requisitionId),
    sourceUrl: httpUrl(input.sourceUrl),
    applicationUrl: httpUrl(input.applicationUrl),
  };
  return rawOpportunitySchema.parse({
    source: adapter.key,
    sourceType: adapter.sourceType,
    sourceUrl: fields.sourceUrl,
    applicationUrl: fields.applicationUrl,
    domain: context.domain,
    externalId: text(input.externalId),
    requisitionId: fields.requisitionId,
    title: fields.title,
    company: fields.company,
    location: fields.location,
    description: fields.description,
    salaryText: fields.salaryText,
    employmentType: fields.employmentType,
    postingDate: text(input.postingDate),
    // The source's display name and any attribution it requires travel
    // with the record, so provenance can show them as retrieved.
    sourceMetadata: { ...(input.metadata ?? {}), structured, sourceName: adapter.name, attribution: adapter.attribution },
    // Namespaced: the source item never appears as postingHistory.
    rawPayload: { source: input.sourceItem },
    discoveredAt: context.discoveredAt,
    retrieval: {
      retrievalType: adapter.retrievalType,
      sourceCategory: adapter.sourceCategory,
      retrievalSourceId: null,
      retrievalRunId: null,
      contentHash: listingContentHash({ ...fields, structured, material: input.material ?? {} }),
    },
  });
}
