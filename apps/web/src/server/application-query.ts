// /applications list state, held in the URL. Same conventions as the
// dashboard (opportunity-query.ts): parsing never throws, invalid values are
// dropped, and serialization is canonical.
import {
  allValues,
  firstValue,
  incomingQueryString,
  isoDate,
  normalizeSearch,
  positiveInteger,
  type SearchParamsInput,
} from "./opportunity-query";

export const applicationViews = { active: "Active", closed: "Closed", all: "All" } as const;
export type ApplicationView = keyof typeof applicationViews;
export const defaultApplicationView: ApplicationView = "active";

export const applicationStageOptions = {
  planned: "PLANNED",
  applied: "APPLIED",
  screening: "SCREENING",
  interviewing: "INTERVIEWING",
  "final-round": "FINAL_ROUND",
  offer: "OFFER",
  closed: "CLOSED",
} as const;

export const applicationOutcomeOptions = {
  "offer-accepted": "OFFER_ACCEPTED",
  "offer-declined": "OFFER_DECLINED",
  rejected: "REJECTED",
  withdrawn: "WITHDRAWN",
  "no-response": "NO_RESPONSE",
  "not-submitted": "NOT_SUBMITTED",
} as const;

export const followUpFilterOptions = {
  overdue: "Overdue",
  due: "Due now (overdue or today)",
  today: "Due today",
  upcoming: "Due in the next 7 days",
  none: "No open follow-up",
} as const;
export type FollowUpFilter = keyof typeof followUpFilterOptions;

export const applicationSortOptions = {
  "next-action": "Next action due",
  "applied-newest": "Applied (newest first)",
  "applied-oldest": "Applied (oldest first)",
  updated: "Recent activity",
  company: "Company A–Z",
} as const;
export type ApplicationSort = keyof typeof applicationSortOptions;
export const defaultApplicationSort: ApplicationSort = "next-action";
export const applicationPageSize = 25;

type Keys<T> = Array<keyof T & string>;

export interface ApplicationQuery {
  view: ApplicationView;
  q: string;
  stage: Keys<typeof applicationStageOptions>;
  outcome: Keys<typeof applicationOutcomeOptions>;
  followUp: FollowUpFilter | null;
  from: string | null;
  to: string | null;
  sort: ApplicationSort;
  page: number;
}

function multi<T extends Record<string, string>>(params: SearchParamsInput, key: string, options: T): Keys<T> {
  const valid = new Set(
    allValues(params, key)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter((value) => Object.hasOwn(options, value)),
  );
  return (Object.keys(options) as Keys<T>).filter((key) => valid.has(key));
}

function oneOf<T extends Record<string, string>>(params: SearchParamsInput, key: string, options: T) {
  const value = firstValue(params, key)?.trim().toLowerCase();
  return value && Object.hasOwn(options, value) ? (value as keyof T & string) : null;
}

export function parseApplicationQuery(params: SearchParamsInput): ApplicationQuery {
  let from = isoDate(firstValue(params, "from"));
  let to = isoDate(firstValue(params, "to"));
  if (from && to && from > to) {
    from = null;
    to = null;
  }
  return {
    view: oneOf(params, "view", applicationViews) ?? defaultApplicationView,
    q: normalizeSearch(firstValue(params, "q")).text,
    stage: multi(params, "stage", applicationStageOptions),
    outcome: multi(params, "outcome", applicationOutcomeOptions),
    followUp: oneOf(params, "followUp", followUpFilterOptions),
    from,
    to,
    sort: oneOf(params, "sort", applicationSortOptions) ?? defaultApplicationSort,
    page: positiveInteger(firstValue(params, "page")) ?? 1,
  };
}

export function serializeApplicationQuery(query: ApplicationQuery): string {
  const params = new URLSearchParams();
  if (query.view !== defaultApplicationView) params.set("view", query.view);
  if (query.q) params.set("q", query.q);
  for (const value of query.stage) params.append("stage", value);
  for (const value of query.outcome) params.append("outcome", value);
  if (query.followUp) params.set("followUp", query.followUp);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.sort !== defaultApplicationSort) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}

export function applicationsHref(query: ApplicationQuery): string {
  const search = serializeApplicationQuery(query);
  return search ? `/applications?${search}` : "/applications";
}

export function withApplicationChanges(query: ApplicationQuery, changes: Partial<ApplicationQuery>): ApplicationQuery {
  return { ...query, ...changes, page: changes.page ?? 1 };
}

export function hasApplicationFilters(query: ApplicationQuery): boolean {
  return Boolean(query.q || query.stage.length || query.outcome.length || query.followUp || query.from || query.to);
}

export function clearApplicationFilters(query: ApplicationQuery): ApplicationQuery {
  return withApplicationChanges(query, { q: "", stage: [], outcome: [], followUp: null, from: null, to: null });
}

export function toApplicationListFilters(query: ApplicationQuery) {
  return {
    view: query.view,
    stages: query.stage.map((key) => applicationStageOptions[key]),
    outcomes: query.outcome.map((key) => applicationOutcomeOptions[key]),
    followUp: query.followUp,
    searchTerms: normalizeSearch(query.q).terms,
    appliedFrom: query.from,
    appliedTo: query.to,
  };
}

export function applicationCanonicalRedirect(
  params: SearchParamsInput,
  query: ApplicationQuery,
  effectivePage: number,
): string | null {
  const canonical = serializeApplicationQuery({ ...query, page: effectivePage });
  if (canonical === incomingQueryString(params)) return null;
  return canonical ? `/applications?${canonical}` : "/applications";
}
