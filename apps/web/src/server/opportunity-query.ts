// Dashboard search, filter, sort and pagination state, held in the URL.
// Pure and dependency-free so both server and client code can use it:
// parsing never throws; invalid or stale values are dropped and replaced by
// defaults; serialization is canonical so URLs are stable and bookmarkable.

export type OpportunityLifecycleStatus =
  | "DISCOVERED"
  | "NORMALIZED"
  | "EVALUATED"
  | "RECOMMENDED"
  | "SAVED"
  | "APPLIED"
  | "REJECTED_BY_USER"
  | "CLOSED"
  | "ARCHIVED";

// Lifecycle views. "triage" holds opportunities the user has not acted on
// yet (system states only); dismissed and archived stay in their own views.
export const opportunityViews = {
  active: { label: "Active", statuses: ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"] },
  triage: { label: "To triage", statuses: ["NORMALIZED", "EVALUATED", "RECOMMENDED"] },
  saved: { label: "Saved", statuses: ["SAVED"] },
  applied: { label: "Applied", statuses: ["APPLIED"] },
  dismissed: { label: "Dismissed", statuses: ["REJECTED_BY_USER"] },
  archived: { label: "Archived", statuses: ["ARCHIVED", "CLOSED"] },
  all: { label: "All", statuses: undefined },
} as const satisfies Record<string, { label: string; statuses: readonly OpportunityLifecycleStatus[] | undefined }>;

export type OpportunityView = keyof typeof opportunityViews;
export const defaultView: OpportunityView = "active";

// Filter value ↔ stored value maps. The stored values are the persisted
// contract values; a unit test asserts they match the Customer Success
// schemas exactly.
export const recommendationOptions = { apply: "APPLY", review: "REVIEW", skip: "SKIP", none: "NONE" } as const;
export const evaluationStateOptions = {
  none: "NONE",
  queued: "QUEUED",
  running: "RUNNING",
  completed: "COMPLETED",
  failed: "FAILED",
  deferred: "DEFERRED",
} as const;
export const priorityOptions = {
  "very-high": "VERY_HIGH",
  high: "HIGH",
  "mixed-moderate": "MIXED_MODERATE",
  low: "LOW",
  "very-low": "VERY_LOW",
  unknown: "UNKNOWN",
} as const;
export const roleFamilyOptions = {
  "core-cs": "CORE_CS",
  "cs-adjacent": "CS_ADJACENT",
  "support-heavy": "SUPPORT_HEAVY",
  "sales-heavy": "SALES_HEAVY",
  "implementation-heavy": "IMPLEMENTATION_HEAVY",
  "technical-cs": "TECHNICAL_CS",
  unrelated: "UNRELATED",
  unknown: "UNKNOWN",
} as const;
export const segmentOptions = {
  smb: "SMB",
  "mid-market": "MID_MARKET",
  commercial: "COMMERCIAL",
  enterprise: "ENTERPRISE",
  mixed: "MIXED",
  unknown: "UNKNOWN",
  "not-evaluated": "NOT_EVALUATED",
} as const;
export const sourceTypeOptions = {
  manual: "MANUAL",
  "browser-extension": "BROWSER_EXTENSION",
  "public-search": "PUBLIC_SEARCH",
  ats: "ATS",
  api: "API",
  "company-watchlist": "COMPANY_WATCHLIST",
  other: "OTHER",
} as const;

export const sortOptions = {
  newest: "Newest discovered",
  oldest: "Oldest discovered",
  updated: "Recently updated",
  priority: "Priority (highest first)",
  company: "Company A–Z",
  title: "Title A–Z",
} as const;
export type OpportunitySort = keyof typeof sortOptions;
export const defaultSort: OpportunitySort = "newest";

export const pageSizeOptions = [10, 25, 50] as const;
export const defaultPageSize = 25;
export const maximumPageSize = 200;

export const searchLimits = { maxTerms: 8, maxTermLength: 80, maxInputLength: 400 } as const;

type Keys<T> = Array<keyof T & string>;

export interface OpportunityQuery {
  view: OpportunityView;
  q: string;
  rec: Keys<typeof recommendationOptions>;
  eval: Keys<typeof evaluationStateOptions>;
  priority: Keys<typeof priorityOptions>;
  role: Keys<typeof roleFamilyOptions>;
  segment: Keys<typeof segmentOptions>;
  sourceType: Keys<typeof sourceTypeOptions>;
  source: string | null;
  company: string | null;
  domain: string | null;
  title: string | null;
  location: string | null;
  salary: "stated" | "not-stated" | null;
  from: string | null;
  to: string | null;
  sort: OpportunitySort;
  page: number;
  pageSize: number;
}

export type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function allValues(params: SearchParamsInput, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

const firstValue = (params: SearchParamsInput, key: string) => allValues(params, key)[0];

function multi<T extends Record<string, string>>(params: SearchParamsInput, key: string, options: T): Keys<T> {
  const valid = new Set(
    allValues(params, key)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is keyof T & string => Object.hasOwn(options, value)),
  );
  // Canonical order: the order of the options map.
  return (Object.keys(options) as Keys<T>).filter((key) => valid.has(key));
}

function text(params: SearchParamsInput, key: string, maxLength = 200): string | null {
  const value = firstValue(params, key)?.replace(/\s+/g, " ").trim();
  return value ? value.slice(0, maxLength) : null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isoDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 ? parsed : null;
}

// Search text normalization: trim, collapse whitespace, lowercase, split
// into at most 8 terms of at most 80 characters. Every term must match.
export function normalizeSearch(value: string | null | undefined): { text: string; terms: string[] } {
  const normalized = (value ?? "").slice(0, searchLimits.maxInputLength).replace(/\s+/g, " ").trim().toLowerCase();
  const terms = normalized
    .split(" ")
    .filter(Boolean)
    .slice(0, searchLimits.maxTerms)
    .map((term) => term.slice(0, searchLimits.maxTermLength));
  return { text: terms.join(" "), terms };
}

export function parseOpportunityQuery(
  params: SearchParamsInput,
  options: { defaultView?: OpportunityView } = {},
): OpportunityQuery {
  const viewValue = firstValue(params, "view")?.trim().toLowerCase();
  const sortValue = firstValue(params, "sort")?.trim().toLowerCase();
  const pageSize = positiveInteger(firstValue(params, "pageSize"));
  let from = isoDate(firstValue(params, "from"));
  let to = isoDate(firstValue(params, "to"));
  if (from && to && from > to) {
    from = null;
    to = null;
  }
  const salary = firstValue(params, "salary")?.trim().toLowerCase();
  const company = firstValue(params, "company")?.trim();
  return {
    view: viewValue && Object.hasOwn(opportunityViews, viewValue)
      ? (viewValue as OpportunityView)
      : options.defaultView ?? defaultView,
    q: normalizeSearch(firstValue(params, "q")).text,
    rec: multi(params, "rec", recommendationOptions),
    eval: multi(params, "eval", evaluationStateOptions),
    priority: multi(params, "priority", priorityOptions),
    role: multi(params, "role", roleFamilyOptions),
    segment: multi(params, "segment", segmentOptions),
    sourceType: multi(params, "sourceType", sourceTypeOptions),
    source: text(params, "source"),
    company: company && uuidPattern.test(company) ? company.toLowerCase() : null,
    domain: text(params, "domain"),
    title: text(params, "title"),
    location: text(params, "location"),
    salary: salary === "stated" || salary === "not-stated" ? salary : null,
    from,
    to,
    sort: sortValue && Object.hasOwn(sortOptions, sortValue) ? (sortValue as OpportunitySort) : defaultSort,
    page: positiveInteger(firstValue(params, "page")) ?? 1,
    pageSize: pageSize && pageSize <= maximumPageSize ? pageSize : defaultPageSize,
  };
}

// Canonical query string: fixed key order, defaults omitted, page omitted
// when it is 1. Returns "" for the default view.
export function serializeOpportunityQuery(
  query: OpportunityQuery,
  options: { defaultView?: OpportunityView } = {},
): string {
  const params = new URLSearchParams();
  if (query.view !== (options.defaultView ?? defaultView)) params.set("view", query.view);
  if (query.q) params.set("q", query.q);
  for (const key of ["rec", "eval", "priority", "role", "segment", "sourceType"] as const) {
    for (const value of query[key]) params.append(key, value);
  }
  for (const key of ["source", "company", "domain", "title", "location", "salary", "from", "to"] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.sort !== defaultSort) params.set("sort", query.sort);
  if (query.pageSize !== defaultPageSize) params.set("pageSize", String(query.pageSize));
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}

export function opportunityHref(query: OpportunityQuery): string {
  const search = serializeOpportunityQuery(query);
  return search ? `/?${search}` : "/";
}

// A changed filter, search, sort or page size returns to page 1.
export function withChanges(query: OpportunityQuery, changes: Partial<OpportunityQuery>): OpportunityQuery {
  return { ...query, ...changes, page: changes.page ?? 1 };
}

export function clampPage(requestedPage: number, total: number, pageSize: number): number {
  const requested = Number.isInteger(requestedPage) && requestedPage >= 1 ? requestedPage : 1;
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
  return Math.min(requested, pageCount);
}

export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

const filterKeys = [
  "q", "rec", "eval", "priority", "role", "segment", "sourceType",
  "source", "company", "domain", "title", "location", "salary", "from", "to",
] as const;

export function hasActiveFilters(query: OpportunityQuery): boolean {
  return filterKeys.some((key) => {
    const value = query[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

export function clearFilters(query: OpportunityQuery): OpportunityQuery {
  return withChanges(query, {
    q: "", rec: [], eval: [], priority: [], role: [], segment: [], sourceType: [],
    source: null, company: null, domain: null, title: null, location: null, salary: null, from: null, to: null,
  });
}

// Repository input: stored values only.
export interface OpportunityListFilters {
  statuses?: readonly OpportunityLifecycleStatus[];
  searchTerms: string[];
  recommendations: string[];
  evaluationStates: string[];
  priorityBands: string[];
  roleFamilies: string[];
  segments: string[];
  sourceTypes: string[];
  source: string | null;
  companyId: string | null;
  domain: string | null;
  titleContains: string | null;
  locationContains: string | null;
  salaryStated: boolean | null;
  discoveredFrom: Date | null;
  discoveredBefore: Date | null;
}

export function toListFilters(query: OpportunityQuery): OpportunityListFilters {
  const stored = <T extends Record<string, string>>(keys: Keys<T>, map: T) => keys.map((key) => map[key]!);
  return {
    statuses: opportunityViews[query.view].statuses,
    searchTerms: normalizeSearch(query.q).terms,
    recommendations: stored(query.rec, recommendationOptions),
    evaluationStates: stored(query.eval, evaluationStateOptions),
    priorityBands: stored(query.priority, priorityOptions),
    roleFamilies: stored(query.role, roleFamilyOptions),
    segments: stored(query.segment, segmentOptions),
    sourceTypes: stored(query.sourceType, sourceTypeOptions),
    source: query.source,
    companyId: query.company,
    domain: query.domain,
    titleContains: query.title,
    locationContains: query.location,
    salaryStated: query.salary === null ? null : query.salary === "stated",
    discoveredFrom: query.from ? new Date(`${query.from}T00:00:00.000Z`) : null,
    // Inclusive "to" date: everything before the next UTC midnight.
    discoveredBefore: query.to ? new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) : null,
  };
}

function incomingQueryString(params: SearchParamsInput): string {
  if (params instanceof URLSearchParams) return params.toString();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, item);
  }
  return search.toString();
}

// Where the dashboard should redirect so the URL is canonical: invalid or
// empty parameters dropped, and the requested page replaced by the effective
// (clamped) page. Null when the incoming URL is already canonical.
export function canonicalRedirect(
  params: SearchParamsInput,
  query: OpportunityQuery,
  effectivePage: number,
): string | null {
  const canonical = serializeOpportunityQuery({ ...query, page: effectivePage });
  if (canonical === incomingQueryString(params)) return null;
  return canonical ? `/?${canonical}` : "/";
}
