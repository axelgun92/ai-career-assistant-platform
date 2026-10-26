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

// Further facts a source states in its own fields, as the source words them,
// carried in RawOpportunity.sourceMetadata.sourceFacts for the shared
// normalizer to interpret: a department or team name, a seniority or
// experience-level label (or several), and a dedicated compensation text
// from a source that states no pay period (kept as salary text; amounts are
// read from it only when the text itself states an annual period).
// Adapters only copy them; every one is also one of the adapter's material
// fields, so it already takes part in change detection, and sourceFacts
// itself is not hashed (adding it changed no stored listing's hash).
//
// Also: a closing date the source states in its own field (an application
// deadline; also a material field when present), and how the source's
// application link was established (applicationUrlBasis), which is derived
// from which field the link came from and so is not hashed:
//   SOURCE_APPLY_URL         a distinct application destination the source states
//   SOURCE_POSTING_PAGE      the source's posting page is its application page
//   PAGE_APPLY_LINK          an explicit "Apply" link on the captured page
//   PAGE_APPLICATION_FORM    the captured page itself holds the application form
//   STRUCTURED_DIRECT_APPLY  the page's JobPosting data says it is applied to directly
//   SOURCE_LISTING_PAGE      the link is a job board's own listing page, which
//                            links on to the employer: not an application
//                            destination, so no application URL is stored
//                            (the listing's content hash still covers it)
//
// Also: the places a source says a remote role may be done from
// (remoteLocations): schema.org applicantLocationRequirements on a job page,
// Wellfound's accepted remote locations, Himalayas' location restrictions.
// They are the role's remote-hiring geography, not an office, and the shared
// normalizer reads them as the role's location and eligible geography; they
// are never work authorization. Adapters copy them from fields that are
// already material.
export const applicationUrlBasisValues = [
  "SOURCE_APPLY_URL",
  "SOURCE_POSTING_PAGE",
  "SOURCE_LISTING_PAGE",
  "PAGE_APPLY_LINK",
  "PAGE_APPLICATION_FORM",
  "STRUCTURED_DIRECT_APPLY",
] as const;
export type ApplicationUrlBasis = (typeof applicationUrlBasisValues)[number];

// Field provenance for an application link, by how it was established. The
// posting page counts as the application page only on explicit evidence
// (the source says so, the page holds the form, or its structured data says
// it is applied to directly). A link with no stated basis keeps the plain
// "applicationUrl" marker it always had. (A job board's own listing page is
// never stored as an application URL, so it has no marker.)
export function applicationUrlProvenance(basis: ApplicationUrlBasis | null | undefined): { sourceField: string; kind: "DIRECT" | "DETERMINISTIC" } {
  switch (basis) {
    case "SOURCE_APPLY_URL":
      return { sourceField: "source.applyUrl", kind: "DIRECT" };
    case "SOURCE_POSTING_PAGE":
      return { sourceField: "source.postingPageIsApplication", kind: "DETERMINISTIC" };
    case "PAGE_APPLY_LINK":
      return { sourceField: "page:apply-link", kind: "DIRECT" };
    case "PAGE_APPLICATION_FORM":
      return { sourceField: "page:application-form", kind: "DETERMINISTIC" };
    case "STRUCTURED_DIRECT_APPLY":
      return { sourceField: "structured.directApply", kind: "DETERMINISTIC" };
    default:
      return { sourceField: "applicationUrl", kind: "DIRECT" };
  }
}

// The basis a retrieved listing states for its application link, if any.
export function applicationUrlBasisOf(sourceMetadata: Record<string, unknown> | null | undefined): ApplicationUrlBasis | null {
  const facts = sourceMetadata?.sourceFacts;
  const basis = facts && typeof facts === "object" ? (facts as Record<string, unknown>).applicationUrlBasis : null;
  return (applicationUrlBasisValues as readonly unknown[]).includes(basis) ? (basis as ApplicationUrlBasis) : null;
}

export const retrievedSourceFactsSchema = z
  .object({
    department: z.string().trim().min(1).nullable().default(null),
    seniority: z.array(z.string().trim().min(1)).default([]),
    compensationText: z.string().trim().min(1).nullable().default(null),
    closingDate: z.string().trim().min(1).nullable().default(null),
    applicationUrlBasis: z.enum(applicationUrlBasisValues).nullable().default(null),
    remoteLocations: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  })
  .strict();
export type RetrievedSourceFacts = z.infer<typeof retrievedSourceFactsSchema>;

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
