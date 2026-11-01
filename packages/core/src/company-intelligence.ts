import {
  arrangementOf,
  arrangementKeys,
  createTitleGrouper,
  hiringRegionsOf,
  jobRegionsOf,
  latestCompletedEvaluation,
  median,
  otherTitleGroup,
  type MarketArrangement,
} from "./market-analytics";
import { dateOnlyDay, localDay, originIdentityOf, parsePersonalWindow, PersonalQueryError, personalOutcomeOf, type PaApplicationFact, type PaOpportunityFact } from "./personal-analytics";
import { derivePostingHistoryFacts, isNoLongerListed, isRecentlyListed, type PostingHistoryContentVersion, type PostingHistoryListing } from "./posting-history";
import { geographyBuckets, sampleLabel, siRate, sourceInfoOf, type SiGeographyBucket, type SiRate, type SiSample, type SiSourceDescriptor } from "./source-intelligence";

// Company Intelligence (feature 18): what the system has observed about one
// company over time, from the job listings collected and the user's own
// applications. Pure definitions over facts the repository reads; nothing here
// queries, writes, evaluates, infers or estimates. The approved contract (CS
// PRD v1.16 §19, November 1, 2026):
// - A company is a normalized-name group of Company rows (the dashboard's
//   company filter grouping); different names for one employer stay apart.
// - A role is one canonical opportunity: a job on several sources counts once.
// - Listing state, removals and reposts are Feature 13's ledger facts; a
//   "recurring role group" (≥2 roles in one title group) is not a repost.
// - Application figures reuse Feature 17's outcomes and 30-day maturity.
// - Nothing claims a hire, a hiring speed, a response time the tracker does not
//   record, or a judgement of the company. No score, rank or label.

export const companyIntelligenceVersion = "company-intelligence-v1";

export const identityDisclosure =
  "Companies are grouped by exact normalized name. Different names for the same employer (legal entities, brands) appear as separate companies.";
export const postingsDisclosure =
  "Counts what your sources collected, not the company's actual hiring. A company appears more often when more of your sources cover it.";
export const companyOutcomeDisclosure =
  "These tables show what happened after your applications to this company. They do not rate the company.";
export const progressTimingDisclosure =
  "Progress dates are when you recorded the change in your tracker, not when the company replied.";

const dayMs = 24 * 60 * 60 * 1000;
export const recurringRoleMinimum = 2;
export const companyPageSize = 50;
const listingTimingValuesBelow = 5;
const progressStages = new Set(["SCREENING", "INTERVIEWING", "FINAL_ROUND", "OFFER"]);
const offerOutcomes = new Set(["OFFER_ACCEPTED", "OFFER_DECLINED"]);

// ---------------------------------------------------------------------------
// Facts

export interface CiCompanyFact {
  id: string;
  name: string;
  normalizedName: string | null;
  createdAt: Date;
}

// One stored source record of a role (any content version).
export interface CiRecordFact {
  source: string;
  sourceName: string;
  externalId: string | null;
  createdAt: Date;
  discoveredAt: Date;
  lastObservedAt: Date;
  retrieved: boolean;
  // A later changed observation points at this record.
  superseded: boolean;
  // This record is a changed observation of an earlier one.
  changed: boolean;
  // The evidence the deduplication engine stored when this record was
  // attached to the role as an exact duplicate (MATCH); empty otherwise.
  matchedOn: string[];
}

export interface CiEvaluationFact {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: Date;
  completedAt: Date | null;
  customerSegment: string | null;
  customerType: string | null;
  businessModel: string | null;
}

export interface CiApplicationFact extends PaApplicationFact {
  closedOn: Date | null;
  events: Array<PaApplicationFact["events"][number] & { occurredOn: Date | null; recordedAt: Date }>;
  interviews: Array<PaApplicationFact["interviews"][number] & { scheduledAt: Date | null; recordedAt: Date }>;
}

export interface CiOpportunityFact {
  id: string;
  companyId: string;
  title: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  postingDate: Date | null;
  closingDate: Date | null;
  salaryText: string | null;
  location: string | null;
  remoteStatus: string | null;
  workArrangements: string[];
  residencyRequirement: string | null;
  residencyRegions: string[];
  visaSponsorship: string | null;
  relocationSupport: string | null;
  employerOfRecordRegions: string[];
  origin: PaOpportunityFact["origin"];
  listings: PostingHistoryListing[];
  records: CiRecordFact[];
  evaluations: CiEvaluationFact[];
  markedAppliedAt: Date | null;
  application: CiApplicationFact | null;
}

export interface CiFacts {
  companies: CiCompanyFact[];
  opportunities: CiOpportunityFact[];
  // Unresolved PROBABLE_MATCH pairs (either direction).
  probablePairs: Array<[string, string]>;
  sources: SiSourceDescriptor[];
  // Opportunities with no recorded company.
  withoutCompany: number;
}

// ---------------------------------------------------------------------------
// Company groups

export interface CompanyGroup {
  key: string;
  // The oldest member row: the group's stable id and display name.
  id: string;
  name: string;
  names: string[];
  memberIds: string[];
}

const byAge = (a: CiCompanyFact, b: CiCompanyFact) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Companies sharing a normalized name are one company; a row without one
// (not backfilled, or a name without letters or digits) stands alone. The
// same grouping as the dashboard's company filter.
export function companyGroups(companies: readonly CiCompanyFact[]): CompanyGroup[] {
  const groups = new Map<string, CiCompanyFact[]>();
  for (const company of [...companies].sort(byAge)) {
    const key = company.normalizedName ?? company.id;
    groups.set(key, [...(groups.get(key) ?? []), company]);
  }
  return [...groups].map(([key, members]) => ({
    key,
    id: members[0]!.id,
    name: members[0]!.name,
    names: [...new Set(members.map((member) => member.name))],
    memberIds: members.map((member) => member.id),
  }));
}

// ---------------------------------------------------------------------------
// Query

export type CiWindowKey = "30d" | "90d" | "180d" | "365d" | "all" | "custom";
export const companyWindowKeys: readonly CiWindowKey[] = ["30d", "90d", "180d", "365d", "all", "custom"];

export interface CiWindow {
  key: CiWindowKey;
  from: Date | null;
  to: Date;
}

export class CompanyQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyQueryError";
  }
}

// Feature 17's windows plus one year; default all time.
export function parseCompanyWindow(input: { window?: string | null; from?: string | null; to?: string | null }, now: Date): CiWindow {
  const key = input.window?.trim() || "all";
  if (key === "365d") return { key, from: new Date(now.getTime() - 365 * dayMs), to: now };
  if (!(companyWindowKeys as readonly string[]).includes(key)) {
    throw new CompanyQueryError("window must be one of 30d, 90d, 180d, 365d, all or custom");
  }
  try {
    const window = parsePersonalWindow({ window: key, from: input.from, to: input.to }, now);
    return { key: window.key, from: window.from, to: window.to };
  } catch (error) {
    if (error instanceof PersonalQueryError) throw new CompanyQueryError(error.message);
    throw error;
  }
}

export const companySortKeys = ["roles", "recent", "relisted", "applications", "name"] as const;
export type CompanySort = (typeof companySortKeys)[number];

export interface CompanyFilters {
  q: string | null;
  listed: boolean;
  applied: boolean;
  signals: boolean;
  titleGroup: string | null;
  arrangement: MarketArrangement | null;
}

export interface CompanyIndexQuery {
  window: CiWindow;
  filters: CompanyFilters;
  sort: CompanySort;
  page: number;
}

const flag = (input: Record<string, string | null | undefined>, key: string): boolean => {
  const raw = input[key]?.trim();
  if (!raw) return false;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new CompanyQueryError(`${key} must be 1 or 0`);
};

export function parseCompanyIndexQuery(input: Record<string, string | null | undefined>, now: Date, titleTerms: readonly string[]): CompanyIndexQuery {
  const window = parseCompanyWindow({ window: input.window, from: input.from, to: input.to }, now);
  const value = (key: string) => input[key]?.trim() || null;
  const titleGroup = value("titleGroup");
  if (titleGroup !== null && titleGroup !== otherTitleGroup && !titleTerms.includes(titleGroup)) {
    throw new CompanyQueryError("titleGroup must be a discovery title term or OTHER");
  }
  const arrangement = value("arrangement");
  if (arrangement !== null && !(arrangementKeys as readonly string[]).includes(arrangement)) {
    throw new CompanyQueryError(`arrangement must be one of ${arrangementKeys.join(", ")}`);
  }
  const sort = value("sort") ?? "roles";
  if (!(companySortKeys as readonly string[]).includes(sort)) throw new CompanyQueryError(`sort must be one of ${companySortKeys.join(", ")}`);
  const pageText = value("page") ?? "1";
  if (!/^[1-9][0-9]{0,4}$/.test(pageText)) throw new CompanyQueryError("page must be a positive whole number");
  const q = value("q");
  if (q !== null && q.length > 200) throw new CompanyQueryError("q must be at most 200 characters");
  return {
    window,
    filters: {
      q,
      listed: flag(input, "listed"),
      applied: flag(input, "applied"),
      signals: flag(input, "signals"),
      titleGroup,
      arrangement: arrangement as MarketArrangement | null,
    },
    sort: sort as CompanySort,
    page: Number(pageText),
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCompanyId = (value: string) => uuid.test(value);

// ---------------------------------------------------------------------------
// Per-role facts

export type RoleListingState = "listed" | "no_longer_listed" | "unknown";

const inWindow = (window: CiWindow, at: Date | null) => at !== null && (!window.from || at >= window.from) && at < window.to;
const current = (role: CiOpportunityFact) => role.listings.filter((listing) => listing.currentScope && listing.state !== "UNTRACKED");
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / dayMs;
const wholeDays = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / dayMs);
const earliestDate = (dates: ReadonlyArray<Date | null | undefined>) =>
  dates.filter((date): date is Date => date instanceof Date).reduce<Date | null>((min, date) => (min === null || date < min ? date : min), null);

// Feature 13: listed when a current-scope listing was seen recently; no longer
// listed when every removal-capable source confirmed removal and nothing saw
// it since; anything else (bounded sources, manual and extension captures) is
// unknown, never assumed listed.
export function roleListingState(role: Pick<CiOpportunityFact, "listings">, now: Date): RoleListingState {
  if (role.listings.some((listing) => isRecentlyListed(listing, now))) return "listed";
  if (isNoLongerListed(role.listings)) return "no_longer_listed";
  return "unknown";
}

function contentVersions(role: CiOpportunityFact): PostingHistoryContentVersion[] {
  return role.records
    .filter((record) => record.retrieved)
    .map((record) => ({ sourceName: record.sourceName, discoveredAt: record.discoveredAt, lastObservedAt: record.lastObservedAt, superseded: record.superseded }));
}

// Approved D4-B: the role was listed again under a new listing ID with the
// same requisition — a record attached as an exact duplicate on the shared
// requisition ID, from a source that had already listed the role under a
// different listing ID. Read from stored deduplication evidence only.
export function requisitionRelisted(role: Pick<CiOpportunityFact, "records">): boolean {
  const ordered = [...role.records].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return ordered.some(
    (record, index) =>
      record.matchedOn.includes("requisitionId") &&
      record.externalId !== null &&
      ordered.slice(0, index).some((earlier) => earlier.source === record.source && earlier.externalId !== null && earlier.externalId !== record.externalId),
  );
}

export interface RoleSignals {
  // Has a current-scope listing from a source that can confirm removal: only
  // such a role could show a repost.
  removalTracked: boolean;
  listedAgain: boolean;
  reappearances: number;
  closedElsewhere: boolean;
  unchanged: boolean;
  requisitionRelisted: boolean;
}

export function roleSignals(role: CiOpportunityFact, now: Date): RoleSignals {
  const listings = current(role);
  const facts = derivePostingHistoryFacts({ listings: role.listings, contentVersions: contentVersions(role), now });
  const has = (type: string) => facts.some((fact) => fact.type === type);
  return {
    removalTracked: listings.some((listing) => listing.removalCapable),
    listedAgain: has("REPOSTED"),
    reappearances: listings.reduce((sum, listing) => sum + (listing.reappearedAt ? listing.reappearances : 0), 0),
    closedElsewhere: has("CLOSED_ATS_VISIBLE_ELSEWHERE"),
    unchanged: has("UNCHANGED_OVER_TIME"),
    requisitionRelisted: requisitionRelisted(role),
  };
}

const anySignal = (signals: RoleSignals) => signals.listedAgain || signals.closedElsewhere || signals.unchanged || signals.requisitionRelisted;

// ---------------------------------------------------------------------------
// Distributions and timings

export interface CiShareRow {
  key: string;
  count: number;
  share: SiRate;
}

export interface CiDistribution {
  total: number;
  // Several values can apply to one role (regions): shares may exceed 100%.
  multiValued: boolean;
  rows: CiShareRow[];
}

function distribution(values: ReadonlyArray<readonly string[]>, order: readonly string[], multiValued: boolean): CiDistribution {
  const counts = new Map<string, number>();
  for (const keys of values) for (const key of new Set(keys)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const known = order.filter((key) => counts.has(key));
  const extra = [...counts.keys()].filter((key) => !order.includes(key)).sort();
  return {
    total: values.length,
    multiValued,
    rows: [...known, ...extra].map((key) => ({ key, count: counts.get(key)!, share: siRate(counts.get(key)!, values.length) })),
  };
}

export interface CiTiming {
  n: number;
  // The individual values (ascending) while n is below 5; empty otherwise.
  values: number[];
  median: number | null;
  sample: SiSample;
  // Pairs whose later date came first (not counted).
  inconsistent: number;
}

function timing(values: ReadonlyArray<number | null>): CiTiming {
  const valid = values.filter((value): value is number => value !== null && value >= 0).sort((a, b) => a - b);
  const inconsistent = values.filter((value) => value !== null && value < 0).length;
  const middle = median(valid);
  return {
    n: valid.length,
    values: valid.length < listingTimingValuesBelow ? valid : [],
    median: valid.length >= listingTimingValuesBelow ? middle.value : null,
    sample: sampleLabel(valid.length),
    inconsistent,
  };
}

// A calendar day from a stored DATE (as stored) or from a timestamp (in the
// user's time zone).
const dateDay = (date: Date) => isoDay(date);
const stampDay = (instant: Date, timeZone: string) => localDay(instant, timeZone);

export interface ApplicationTimings {
  progress: number | null;
  interview: number | null;
  closed: number | null;
  offer: number | null;
}

// Whole days from the application to: the first progress recorded (a stage
// change to screening or later, or an interview logged, by when it was
// recorded), the first interview's scheduled date, the close date, and the
// first offer recorded. Null when the tracker holds no such date.
export function applicationTimings(role: Pick<CiOpportunityFact, "application" | "markedAppliedAt">, appliedAt: Date | null, timeZone: string): ApplicationTimings {
  const application = role.application;
  if (!application || !appliedAt) return { progress: null, interview: null, closed: null, offer: null };
  const applied = dayNumber(dateOnlyDay(role, appliedAt, timeZone));
  const since = (day: string | null) => (day === null ? null : dayNumber(day) - applied);
  const eventDay = (event: CiApplicationFact["events"][number]) => (event.occurredOn ? dateDay(event.occurredOn) : stampDay(event.recordedAt, timeZone));
  const earliestDay = (days: string[]) => (days.length ? days.sort()[0]! : null);
  const live = application.interviews.filter((interview) => interview.status !== "CANCELLED");
  const progress = earliestDay([
    ...application.events.filter((event) => event.type === "STAGE_CHANGED" && event.toStage && progressStages.has(event.toStage)).map(eventDay),
    ...live.map((interview) => stampDay(interview.recordedAt, timeZone)),
  ]);
  const interview = earliestDay(live.flatMap((item) => (item.scheduledAt ? [stampDay(item.scheduledAt, timeZone)] : [])));
  const closedEvent = application.events.filter((event) => event.type === "CLOSED").map(eventDay);
  const closed = application.stage === "CLOSED" ? (application.closedOn ? dateDay(application.closedOn) : earliestDay(closedEvent)) : null;
  const offer = earliestDay(
    application.events.filter((event) => event.toStage === "OFFER" || (event.outcome !== null && offerOutcomes.has(event.outcome))).map(eventDay),
  );
  return { progress: since(progress), interview: since(interview), closed: since(closed), offer: since(offer) };
}

// ---------------------------------------------------------------------------
// Views

interface RoleView {
  role: CiOpportunityFact;
  titleGroup: string;
  arrangement: MarketArrangement;
  state: RoleListingState;
  signals: RoleSignals;
  observedInWindow: boolean;
  outcome: ReturnType<typeof personalOutcomeOf>;
  appliedInWindow: boolean;
}

function roleViews(roles: readonly CiOpportunityFact[], window: CiWindow, titleGroupOf: (title: string | null) => string, now: Date): RoleView[] {
  return roles.map((role) => {
    const outcome = personalOutcomeOf(role, now);
    return {
      role,
      titleGroup: titleGroupOf(role.title),
      arrangement: arrangementOf(role),
      state: roleListingState(role, now),
      signals: roleSignals(role, now),
      observedInWindow: inWindow(window, role.firstSeenAt),
      outcome,
      appliedInWindow: outcome.applied && inWindow(window, outcome.appliedAt),
    };
  });
}

const latestOf = (dates: ReadonlyArray<Date | null>) =>
  dates.filter((date): date is Date => date instanceof Date).reduce<Date | null>((max, date) => (max === null || date > max ? date : max), null);

function recurringGroupKeys(views: readonly RoleView[]): string[] {
  const counts = new Map<string, number>();
  for (const view of views) counts.set(view.titleGroup, (counts.get(view.titleGroup) ?? 0) + 1);
  return [...counts].filter(([key, count]) => key !== otherTitleGroup && count >= recurringRoleMinimum).map(([key]) => key);
}

const serialWindow = (window: CiWindow) => ({ key: window.key, from: window.from?.toISOString() ?? null, to: window.to.toISOString() });

// ---------------------------------------------------------------------------
// Index

export interface CompanyIndexRow {
  id: string;
  key: string;
  name: string;
  otherNames: string[];
  observedRoles: number;
  currentlyListed: number;
  listedAgain: number;
  recurringGroups: number;
  remote: number;
  // Roles whose arrangement is known (the remote share's denominator).
  arrangementKnown: number;
  arrangementUnknown: number;
  applications: number;
  interviews: number;
  offers: number;
  lastObservedAt: string | null;
  lastActivityAt: string | null;
}

export interface CompanyIndex {
  version: string;
  generatedAt: string;
  window: { key: CiWindowKey; from: string | null; to: string };
  filters: CompanyFilters;
  sort: CompanySort;
  page: number;
  pageCount: number;
  total: number;
  rows: CompanyIndexRow[];
  titleGroups: string[];
  withoutCompany: number;
  notes: { identity: string; postings: string };
}

export interface BuildCompanyInput {
  facts: CiFacts;
  titleTerms: readonly string[];
  now: Date;
  timeZone: string;
}

function rolesByGroup(facts: CiFacts, groups: readonly CompanyGroup[]): Map<string, CiOpportunityFact[]> {
  const groupOf = new Map<string, string>();
  for (const group of groups) for (const id of group.memberIds) groupOf.set(id, group.key);
  const roles = new Map<string, CiOpportunityFact[]>();
  for (const role of facts.opportunities) {
    const key = groupOf.get(role.companyId);
    if (key) roles.set(key, [...(roles.get(key) ?? []), role]);
  }
  return roles;
}

const folded = (value: string) => value.normalize("NFKC").toLocaleLowerCase();

export function buildCompanyIndex(input: BuildCompanyInput & { query: CompanyIndexQuery }): CompanyIndex {
  const { facts, query, now } = input;
  const titleGroupOf = createTitleGrouper(input.titleTerms);
  const groups = companyGroups(facts.companies);
  const roles = rolesByGroup(facts, groups);
  const filters = query.filters;
  const needle = filters.q ? folded(filters.q) : null;
  const all: CompanyIndexRow[] = [];
  for (const group of groups) {
    if (needle && !group.names.some((name) => folded(name).includes(needle))) continue;
    const views = roleViews(roles.get(group.key) ?? [], query.window, titleGroupOf, now).filter(
      (view) => (!filters.titleGroup || view.titleGroup === filters.titleGroup) && (!filters.arrangement || view.arrangement === filters.arrangement),
    );
    const observed = views.filter((view) => view.observedInWindow);
    const applied = views.filter((view) => view.appliedInWindow);
    // The index cohort is the company's posting history: at least one role
    // first observed in the window. Applications are counted for those
    // companies by their own date; they never add a company on their own.
    if (!observed.length) continue;
    const row: CompanyIndexRow = {
      id: group.id,
      key: group.key,
      name: group.name,
      otherNames: group.names.filter((name) => name !== group.name),
      observedRoles: observed.length,
      currentlyListed: observed.filter((view) => view.state === "listed").length,
      // Feature 13 only: the same listing seen again after a confirmed
      // removal. Same-requisition relisting is a separate detail signal.
      listedAgain: observed.filter((view) => view.signals.listedAgain).length,
      recurringGroups: recurringGroupKeys(observed).length,
      remote: observed.filter((view) => view.arrangement === "REMOTE").length,
      arrangementKnown: observed.filter((view) => view.arrangement !== "UNKNOWN").length,
      arrangementUnknown: observed.filter((view) => view.arrangement === "UNKNOWN").length,
      applications: applied.length,
      interviews: applied.filter((view) => view.outcome.interview).length,
      offers: applied.filter((view) => view.outcome.offer).length,
      lastObservedAt: latestOf(observed.map((view) => view.role.lastSeenAt))?.toISOString() ?? null,
      lastActivityAt: latestOf([...views.map((view) => view.role.lastSeenAt), ...applied.map((view) => view.outcome.appliedAt)])?.toISOString() ?? null,
    };
    if (filters.listed && !row.currentlyListed) continue;
    if (filters.applied && !row.applications) continue;
    if (filters.signals && !observed.some((view) => anySignal(view.signals))) continue;
    all.push(row);
  }
  const byName = (a: CompanyIndexRow, b: CompanyIndexRow) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.key < b.key ? -1 : 1);
  const desc = (pick: (row: CompanyIndexRow) => number) => (a: CompanyIndexRow, b: CompanyIndexRow) => pick(b) - pick(a) || byName(a, b);
  const sorters: Record<CompanySort, (a: CompanyIndexRow, b: CompanyIndexRow) => number> = {
    roles: desc((row) => row.observedRoles),
    recent: desc((row) => (row.lastActivityAt ? Date.parse(row.lastActivityAt) : 0)),
    relisted: desc((row) => row.listedAgain),
    applications: desc((row) => row.applications),
    name: byName,
  };
  all.sort(sorters[query.sort]);
  const pageCount = Math.max(1, Math.ceil(all.length / companyPageSize));
  const page = Math.min(query.page, pageCount);
  return {
    version: companyIntelligenceVersion,
    generatedAt: now.toISOString(),
    window: serialWindow(query.window),
    filters,
    sort: query.sort,
    page,
    pageCount,
    total: all.length,
    rows: all.slice((page - 1) * companyPageSize, page * companyPageSize),
    titleGroups: [...input.titleTerms, otherTitleGroup],
    withoutCompany: facts.withoutCompany,
    notes: { identity: identityDisclosure, postings: postingsDisclosure },
  };
}

// ---------------------------------------------------------------------------
// Detail

export interface CompanyRoleRow {
  opportunityId: string;
  title: string | null;
  titleGroup: string;
  firstSeenAt: string;
  lastSeenAt: string;
  state: RoleListingState;
  arrangement: MarketArrangement;
  foundFirstBy: string | null;
  postingDate: string | null;
  closingDate: string | null;
  salaryText: string | null;
  applied: boolean;
}

export interface CompanyRecurringGroup {
  key: string;
  roles: number;
  recurring: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  currentlyListed: number;
  noLongerListed: number;
  applied: number;
  // Exact titles (case and spacing ignored), most frequent written form shown.
  titles: Array<{ title: string; count: number }>;
}

export interface CompanyApplicationRow {
  opportunityId: string;
  title: string | null;
  appliedAt: string | null;
  stage: string | null;
  outcome: string | null;
}

export interface CompanyRelisting {
  opportunityId: string;
  title: string | null;
  sourceName: string;
  removedAt: string | null;
  reappearedAt: string;
  // Whole days from the confirmed removal to the listing's latest reappearance.
  days: number | null;
  reappearances: number;
}

export interface CompanyDetail {
  version: string;
  generatedAt: string;
  window: { key: CiWindowKey; from: string | null; to: string };
  company: { id: string; key: string; name: string; names: string[]; memberIds: string[] };
  overview: {
    observedRoles: number;
    firstObservedAt: string | null;
    lastObservedAt: string | null;
    currentlyListed: number;
    noLongerListed: number;
    statusUnknown: number;
    applications: number;
    companyType: {
      evaluatedRoles: number;
      roles: number;
      customerSegment: CiDistribution;
      customerType: CiDistribution;
      businessModel: CiDistribution;
    };
  };
  postings: {
    months: Array<{ month: string; roles: number }>;
    changedRoles: number;
    probableDuplicatePairs: number;
    duration: {
      confirmed: CiTiming;
      // Listings recently seen, each from its own first sighting to now.
      stillListed: Array<{ opportunityId: string; title: string | null; sourceName: string; atLeastDays: number }>;
    };
  };
  recurring: { groups: CompanyRecurringGroup[]; recurringGroups: number };
  arrangement: {
    arrangement: CiDistribution;
    remote: number;
    arrangementKnown: number;
    hiringRegions: CiDistribution;
    jobRegions: CiDistribution;
    visaSponsorship: Record<"AVAILABLE" | "NOT_AVAILABLE" | "UNKNOWN", number>;
    relocationSupport: Record<"AVAILABLE" | "NOT_AVAILABLE" | "UNKNOWN", number>;
    employerOfRecordRegions: Array<{ code: string; roles: number }>;
  };
  history: {
    applications: number;
    firstAppliedAt: string | null;
    lastAppliedAt: string | null;
    awaitingResponse: number;
    mature: number;
    inProcess: number;
    matureNothingRecorded: number;
    recruiterScreens: number;
    interviews: number;
    finalRounds: number;
    offers: number;
    closed: Record<string, number>;
    interviewRate: SiRate;
    offerRate: SiRate;
    timings: { progress: CiTiming; interview: CiTiming; closed: CiTiming; offer: CiTiming };
    roles: CompanyApplicationRow[];
  };
  signals: {
    removalTracked: number;
    listedAgain: number;
    reappearances: number;
    requisitionRelisted: number;
    closedElsewhere: number;
    unchanged: number;
    relistings: CompanyRelisting[];
  };
  roles: CompanyRoleRow[];
  notes: { identity: string; postings: string; outcomes: string; progress: string };
}

const availability = (values: ReadonlyArray<string | null>) => {
  const counts = { AVAILABLE: 0, NOT_AVAILABLE: 0, UNKNOWN: 0 };
  for (const value of values) counts[value === "AVAILABLE" || value === "NOT_AVAILABLE" ? value : "UNKNOWN"] += 1;
  return counts;
};

const titleKey = (title: string) => title.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();

function exactTitles(views: readonly RoleView[]): Array<{ title: string; count: number }> {
  const groups = new Map<string, Map<string, number>>();
  for (const view of views) {
    if (!view.role.title?.trim()) continue;
    const forms = groups.get(titleKey(view.role.title)) ?? new Map<string, number>();
    const form = view.role.title.trim().replace(/\s+/g, " ");
    forms.set(form, (forms.get(form) ?? 0) + 1);
    groups.set(titleKey(view.role.title), forms);
  }
  return [...groups.values()]
    .map((forms) => {
      const [title] = [...forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
      return { title, count: [...forms.values()].reduce((sum, count) => sum + count, 0) };
    })
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

// The detail of one company group, or null when the id is not a company with
// roles or applications.
export function buildCompanyDetail(input: BuildCompanyInput & { companyId: string; window: CiWindow }): CompanyDetail | null {
  const { facts, now, window, timeZone } = input;
  const group = companyGroups(facts.companies).find((candidate) => candidate.memberIds.includes(input.companyId));
  if (!group) return null;
  const titleGroupOf = createTitleGrouper(input.titleTerms);
  const views = roleViews(rolesByGroup(facts, [group]).get(group.key) ?? [], window, titleGroupOf, now);
  const observed = views.filter((view) => view.observedInWindow);
  const applied = views.filter((view) => view.appliedInWindow).sort((a, b) => (a.outcome.appliedAt?.getTime() ?? 0) - (b.outcome.appliedAt?.getTime() ?? 0));
  const ids = new Set(observed.map((view) => view.role.id));

  // Overview and company type (each role's latest completed evaluation).
  const evaluated = observed.map((view) => latestCompletedEvaluation(view.role)).filter((evaluation): evaluation is CiEvaluationFact => evaluation !== null);
  const classification = (pick: (evaluation: CiEvaluationFact) => string | null) =>
    distribution(
      evaluated.map((evaluation) => [pick(evaluation) ?? "UNKNOWN"]),
      [],
      false,
    );

  // Postings by calendar month in the user's time zone.
  const months = new Map<string, number>();
  for (const view of observed) {
    const month = localDay(view.role.firstSeenAt, timeZone).slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + 1);
  }

  // Observed listing duration, per listing and never across listings: a
  // listing confirmed removed counts from its own first sighting to its own
  // removal; a listing seen recently is a lower bound (its first sighting to
  // now), kept out of the confirmed figures.
  const durations = observed.flatMap((view) =>
    current(view.role)
      .filter((listing) => listing.state === "REMOVED" && listing.removalCapable && listing.removedAt)
      .map((listing) => wholeDays(listing.firstSeenAt, listing.removedAt!)),
  );
  const stillListed = observed
    .flatMap((view) =>
      view.role.listings
        .filter((listing) => isRecentlyListed(listing, now))
        .map((listing) => ({
          opportunityId: view.role.id,
          title: view.role.title,
          sourceName: listing.sourceName,
          atLeastDays: Math.max(0, wholeDays(listing.firstSeenAt, now)),
        })),
    )
    .sort((a, b) => b.atLeastDays - a.atLeastDays || a.opportunityId.localeCompare(b.opportunityId));

  // Recurring role groups.
  const byTitleGroup = new Map<string, RoleView[]>();
  for (const view of observed) byTitleGroup.set(view.titleGroup, [...(byTitleGroup.get(view.titleGroup) ?? []), view]);
  const titleOrder = [...input.titleTerms, otherTitleGroup];
  const recurringGroups: CompanyRecurringGroup[] = [...byTitleGroup]
    .map(([key, members]) => ({
      key,
      roles: members.length,
      recurring: key !== otherTitleGroup && members.length >= recurringRoleMinimum,
      firstSeenAt: earliestDate(members.map((view) => view.role.firstSeenAt))!.toISOString(),
      lastSeenAt: latestOf(members.map((view) => view.role.lastSeenAt))!.toISOString(),
      currentlyListed: members.filter((view) => view.state === "listed").length,
      noLongerListed: members.filter((view) => view.state === "no_longer_listed").length,
      applied: members.filter((view) => view.outcome.applied).length,
      titles: exactTitles(members),
    }))
    .sort((a, b) => b.roles - a.roles || titleOrder.indexOf(a.key) - titleOrder.indexOf(b.key));

  // Your applications (Feature 17 outcomes).
  const count = (predicate: (view: RoleView) => boolean) => applied.filter(predicate).length;
  const closed: Record<string, number> = {};
  for (const view of applied) {
    const outcome = view.outcome.closedOutcome;
    if (view.outcome.closed && outcome) closed[outcome] = (closed[outcome] ?? 0) + 1;
    else if (view.outcome.closed) closed.CLOSED_WITHOUT_OUTCOME = (closed.CLOSED_WITHOUT_OUTCOME ?? 0) + 1;
  }
  const timings = applied.map((view) => applicationTimings(view.role, view.outcome.appliedAt, timeZone));
  const mature = count((view) => view.outcome.mature);

  // Posting-history signals (Feature 13 facts) and relistings.
  const relistings: CompanyRelisting[] = observed
    .flatMap((view) =>
      current(view.role)
        .filter((listing) => listing.reappearedAt && listing.reappearances > 0)
        .map((listing) => ({
          opportunityId: view.role.id,
          title: view.role.title,
          sourceName: listing.sourceName,
          removedAt: iso(listing.removedAt),
          reappearedAt: listing.reappearedAt!.toISOString(),
          days: listing.removedAt && listing.removedAt <= listing.reappearedAt! ? wholeDays(listing.removedAt, listing.reappearedAt!) : null,
          reappearances: listing.reappearances,
        })),
    )
    .sort((a, b) => b.reappearedAt.localeCompare(a.reappearedAt));

  // Unresolved probable-duplicate pairs with both roles in this company.
  const pairs = new Set(
    facts.probablePairs.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)),
  );

  const sources = facts.sources;
  const foundFirstBy = (role: CiOpportunityFact) => (role.origin ? sourceInfoOf(originIdentityOf(role), sources).name : null);
  const arrangement = distribution(
    observed.map((view) => [view.arrangement]),
    arrangementKeys,
    false,
  );
  const regionOrder: readonly SiGeographyBucket[] = geographyBuckets;
  const eor = new Map<string, number>();
  for (const view of observed) for (const code of new Set(view.role.employerOfRecordRegions)) eor.set(code, (eor.get(code) ?? 0) + 1);

  return {
    version: companyIntelligenceVersion,
    generatedAt: now.toISOString(),
    window: serialWindow(window),
    company: { id: group.id, key: group.key, name: group.name, names: group.names, memberIds: group.memberIds },
    overview: {
      observedRoles: observed.length,
      firstObservedAt: iso(earliestDate(observed.map((view) => view.role.firstSeenAt))),
      lastObservedAt: iso(latestOf(observed.map((view) => view.role.lastSeenAt))),
      currentlyListed: observed.filter((view) => view.state === "listed").length,
      noLongerListed: observed.filter((view) => view.state === "no_longer_listed").length,
      statusUnknown: observed.filter((view) => view.state === "unknown").length,
      applications: applied.length,
      companyType: {
        evaluatedRoles: evaluated.length,
        roles: observed.length,
        customerSegment: classification((evaluation) => evaluation.customerSegment),
        customerType: classification((evaluation) => evaluation.customerType),
        businessModel: classification((evaluation) => evaluation.businessModel),
      },
    },
    postings: {
      months: [...months].sort((a, b) => a[0].localeCompare(b[0])).map(([month, roles]) => ({ month, roles })),
      changedRoles: observed.filter((view) => view.role.records.some((record) => record.changed)).length,
      probableDuplicatePairs: pairs.size,
      duration: { confirmed: timing(durations), stillListed },
    },
    recurring: { groups: recurringGroups, recurringGroups: recurringGroups.filter((row) => row.recurring).length },
    arrangement: {
      arrangement,
      remote: observed.filter((view) => view.arrangement === "REMOTE").length,
      arrangementKnown: observed.filter((view) => view.arrangement !== "UNKNOWN").length,
      hiringRegions: distribution(
        observed.map((view) => hiringRegionsOf(view.role)),
        regionOrder,
        true,
      ),
      jobRegions: distribution(
        observed.map((view) => jobRegionsOf(view.role)),
        regionOrder,
        true,
      ),
      visaSponsorship: availability(observed.map((view) => view.role.visaSponsorship)),
      relocationSupport: availability(observed.map((view) => view.role.relocationSupport)),
      employerOfRecordRegions: [...eor].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, roles]) => ({ code, roles })),
    },
    history: {
      applications: applied.length,
      firstAppliedAt: iso(applied[0]?.outcome.appliedAt ?? null),
      lastAppliedAt: iso(applied.at(-1)?.outcome.appliedAt ?? null),
      awaitingResponse: count((view) => view.outcome.awaitingResponse),
      mature,
      inProcess: count((view) => view.outcome.inProcess),
      matureNothingRecorded: count((view) => view.outcome.mature && !view.outcome.interview && !view.outcome.offer && !view.outcome.closed),
      recruiterScreens: count((view) => view.outcome.recruiterScreen),
      interviews: count((view) => view.outcome.interview),
      finalRounds: count((view) => view.outcome.finalRound),
      offers: count((view) => view.outcome.offer),
      closed,
      interviewRate: siRate(count((view) => view.outcome.mature && view.outcome.interview), mature),
      offerRate: siRate(count((view) => view.outcome.offer), count((view) => view.outcome.resolved)),
      timings: {
        progress: timing(timings.map((value) => value.progress)),
        interview: timing(timings.map((value) => value.interview)),
        closed: timing(timings.map((value) => value.closed)),
        offer: timing(timings.map((value) => value.offer)),
      },
      roles: [...applied].reverse().map((view) => ({
        opportunityId: view.role.id,
        title: view.role.title,
        appliedAt: iso(view.outcome.appliedAt),
        stage: view.role.application?.stage ?? null,
        outcome: view.role.application?.outcome ?? null,
      })),
    },
    signals: {
      removalTracked: observed.filter((view) => view.signals.removalTracked).length,
      listedAgain: observed.filter((view) => view.signals.listedAgain).length,
      reappearances: observed.reduce((sum, view) => sum + view.signals.reappearances, 0),
      requisitionRelisted: observed.filter((view) => view.signals.requisitionRelisted).length,
      closedElsewhere: observed.filter((view) => view.signals.closedElsewhere).length,
      unchanged: observed.filter((view) => view.signals.unchanged).length,
      relistings,
    },
    roles: [...observed]
      .sort((a, b) => b.role.firstSeenAt.getTime() - a.role.firstSeenAt.getTime() || (a.role.id < b.role.id ? -1 : 1))
      .map((view) => ({
        opportunityId: view.role.id,
        title: view.role.title,
        titleGroup: view.titleGroup,
        firstSeenAt: view.role.firstSeenAt.toISOString(),
        lastSeenAt: view.role.lastSeenAt.toISOString(),
        state: view.state,
        arrangement: view.arrangement,
        foundFirstBy: foundFirstBy(view.role),
        postingDate: iso(view.role.postingDate),
        closingDate: iso(view.role.closingDate),
        salaryText: view.role.salaryText,
        applied: view.outcome.applied,
      })),
    notes: { identity: identityDisclosure, postings: postingsDisclosure, outcomes: companyOutcomeDisclosure, progress: progressTimingDisclosure },
  };
}
