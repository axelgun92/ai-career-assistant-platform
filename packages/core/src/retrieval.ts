import { z } from "zod";

// Automated retrieval vocabulary (Core TDD §8, §15). How a listing was
// retrieved and what kind of source it came from are separate facts.

export const retrievalTypeValues = [
  "OFFICIAL_PUBLIC_API_FEED",
  "BROWSER_ASSISTED",
  "PUBLIC_GUEST_INTERNAL_ENDPOINT",
  "PUBLIC_HTML",
] as const;
export const retrievalTypeSchema = z.enum(retrievalTypeValues);
export type RetrievalType = z.infer<typeof retrievalTypeSchema>;

export const sourceCategoryValues = [
  "ATS",
  "COMPANY_CAREERS",
  "JOB_BOARD",
  "MARKETPLACE",
  "AGGREGATOR",
] as const;
export const sourceCategorySchema = z.enum(sourceCategoryValues);
export type SourceCategory = z.infer<typeof sourceCategorySchema>;

// Canonical application-link precedence (Core TDD §15): the employer's ATS
// or careers site, then another original source (job board, marketplace),
// then an aggregator. Higher wins.
const linkPrecedence: Record<SourceCategory, number> = {
  ATS: 3,
  COMPANY_CAREERS: 3,
  JOB_BOARD: 2,
  MARKETPLACE: 2,
  AGGREGATOR: 1,
};

export function applicationLinkPrecedence(category: SourceCategory | null | undefined): number {
  return category ? linkPrecedence[category] : 0;
}

// Whether a retrieved source's application link should replace the current
// canonical one. A link the user entered manually is never replaced, and an
// existing link is replaced only by a strictly higher-precedence source.
export function shouldReplaceApplicationLink(input: {
  currentUrl: string | null;
  currentIsManual: boolean;
  currentCategory: SourceCategory | null;
  candidateUrl: string | null;
  candidateCategory: SourceCategory;
}): boolean {
  if (!input.candidateUrl) return false;
  if (!input.currentUrl) return true;
  if (input.currentIsManual) return false;
  return applicationLinkPrecedence(input.candidateCategory) > applicationLinkPrecedence(input.currentCategory);
}

// Attached to a RawOpportunity produced by retrieval. contentHash covers
// only the listing's material fields, so volatile response metadata never
// reads as a changed listing.
export const retrievalProvenanceSchema = z.object({
  retrievalType: retrievalTypeSchema,
  sourceCategory: sourceCategorySchema,
  retrievalSourceId: z.uuid().nullable(),
  retrievalRunId: z.uuid().nullable(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type RetrievalProvenance = z.infer<typeof retrievalProvenanceSchema>;

// Facts a source states in structured fields (not parsed from text),
// carried in RawOpportunity.sourceMetadata.structured. Normalization records
// them with DIRECT provenance; anything absent stays Unknown. Salary amounts
// count only when the source states them as annual.
export const retrievedStructuredFieldsSchema = z
  .object({
    salaryMin: z.number().nonnegative().nullable().default(null),
    salaryMax: z.number().nonnegative().nullable().default(null),
    salaryCurrency: z.string().trim().min(1).nullable().default(null),
    salaryPeriod: z.enum(["YEAR", "MONTH", "WEEK", "DAY", "HOUR"]).nullable().default(null),
    workplaceType: z.enum(["REMOTE", "HYBRID", "ONSITE"]).nullable().default(null),
    employmentType: z.string().trim().min(1).nullable().default(null),
  })
  .strict();
export type RetrievedStructuredFields = z.infer<typeof retrievedStructuredFieldsSchema>;

// The domain-neutral discovery port a domain implements: the role-family
// terms a retrieved title must match to be kept, and the query used with
// sources that accept a search.
export interface DiscoveryConfiguration {
  domain: string;
  // Whole-phrase, case-insensitive matches against the listing title only.
  titleTerms: readonly string[];
  // Default search phrases for search-capable sources.
  searchQueries: readonly string[];
}

export const retrievalRunStatusValues = ["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"] as const;
export type RetrievalRunStatus = (typeof retrievalRunStatusValues)[number];

export const retrievalTriggerValues = ["MANUAL", "SCHEDULE"] as const;
export type RetrievalTrigger = (typeof retrievalTriggerValues)[number];

// Default interval between scheduled runs of an enabled source.
export const defaultRetrievalScheduleMinutes = 12 * 60;

// Per-run counts recorded on a RetrievalRun.
export interface RetrievalRunCounts {
  fetched: number;
  keptByTerms: number;
  created: number;
  attached: number;
  unchanged: number;
  changed: number;
  probable: number;
  failed: number;
  // Feature 13: tracked listings seen listed, newly missing, confirmed
  // removed and listed again after a removal in this run.
  listings?: { observed: number; missing: number; removed: number; reappeared: number };
}

export function emptyRetrievalRunCounts(): RetrievalRunCounts {
  return { fetched: 0, keptByTerms: 0, created: 0, attached: 0, unchanged: 0, changed: 0, probable: 0, failed: 0 };
}
