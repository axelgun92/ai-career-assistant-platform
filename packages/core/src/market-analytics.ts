import { readLocationGeography } from "./geography";
import { seniorityValues } from "./opportunity";
import {
  evaluationStateOf,
  geographyBucketOf,
  geographyBuckets,
  parseInsightsWindow,
  sampleLabel,
  siRate,
  SourceInsightsWindowError,
  type SiEvaluationState,
  type SiGeographyBucket,
  type SiRate,
  type SiSample,
  type SiWindow,
} from "./source-intelligence";

// Job-Market Analytics (feature 16): what the collected market looks like.
// Pure definitions over facts the repository reads; nothing here queries,
// writes, evaluates, infers or estimates. The approved contract (CS PRD v1.14
// §19, October 31, 2026):
// - One observation is one canonical Opportunity, in every lifecycle status.
//   A job several sources listed counts once. Both opportunities of an
//   unresolved probable-duplicate pair count; the pairs are shown, never merged.
// - Default cohort: jobs first discovered by automated retrieval (their
//   originating listing was automated). "All collected" adds jobs the user
//   captured first (extension or manual entry), which are user-selected and
//   may introduce selection bias.
// - Amounts whose currency is not stated count toward salary coverage only and
//   never enter a median, band or breakdown.
// - Cohort date: Opportunity.firstSeenAt; trends group by first-seen week.
//   Jobs no longer listed stay in unless excluded.
// - Amounts are compared only within one currency and one basis (BASE, OTE or
//   Unknown basis); nothing is converted. Tiered pay never enters single-range
//   statistics.
// - Title groups are the Customer Success discovery terms (longest whole-phrase
//   match); the evaluator's role classification is a separate, evaluated-only
//   view. Requirements, customer segment and recommendations come from the
//   latest completed evaluation and describe evaluated jobs only.
// - Unknown is always a visible bucket inside every denominator, and every
//   figure carries its sample size and label.

export const marketAnalyticsVersion = "market-analytics-v1";

// Automated retrieval began on this date; earlier records are not a complete
// automated-market sample.
export const automatedRetrievalStartedAt = new Date("2026-10-18T00:00:00.000Z");

export const selectionBiasNote = "These are user-selected captures and may introduce selection bias.";
export const evaluationDisclosure =
  "Evaluations are jobs you chose to evaluate. These results describe evaluated opportunities, not the entire collected market.";

const maxTrendWeeks = 26;
const topListSize = 15;
const maxTierRows = 100;
const salaryBandWidth = 10_000;
const maxContiguousBands = 40;
const dayMs = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Facts

export interface MarketRequirementFact {
  requirement: string;
  category: string;
  strength: string;
  statedYears: number | null;
  statedYearsMaximum: number | null;
  statedYearsOpenEnded: boolean;
}

export interface MarketEvaluationFact {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: Date;
  completedAt: Date | null;
  decision: string | null;
  // Job-side values read from the persisted result, as stored.
  roleClassification: string | null;
  customerSegment: string | null;
  // The JD Reconstruction prompt version that produced the requirements;
  // null when no reconstruction call was recorded.
  reconstructionVersion: string | null;
  // Null when the result holds no reconstruction requirements.
  requirements: MarketRequirementFact[] | null;
}

export interface MarketTierFact {
  label: string;
  minimum: number | null;
  maximum: number | null;
  currency: string | null;
}

export interface MarketOpportunityFact {
  id: string;
  title: string | null;
  status: string;
  firstSeenAt: Date;
  // The job's originating listing (its earliest source record by createdAt,
  // id) came from automated retrieval, not the user's extension or manual
  // entry. A later automated listing of a user-captured job does not count.
  automated: boolean;
  seniority: string | null;
  seniorityLabel: string | null;
  location: string | null;
  remoteStatus: string | null;
  workArrangements: string[];
  residencyRequirement: string | null;
  residencyRegions: string[];
  workAuthorizationRequirement: string | null;
  workAuthorizationRegions: string[];
  visaSponsorship: string | null;
  relocationSupport: string | null;
  employerOfRecordRegions: string[];
  timeZoneRequirements: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  compensationBasis: string | null;
  compensationTiers: MarketTierFact[];
  evaluations: MarketEvaluationFact[];
  openDeferralReason: string | null;
  // The newer side of an unresolved PROBABLE_MATCH pair, so a pair counts once.
  probableUnresolved: boolean;
  noLongerListed: boolean;
}

// ---------------------------------------------------------------------------
// Title groups

// Same phrase normalization as discovery's title matcher
// (packages/discovery/src/discovery-terms.ts): case, punctuation and accents
// ignored, whole phrases only.
function phraseKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const otherTitleGroup = "OTHER";

// The title group of a title: the longest discovery term it contains as a
// whole phrase; equal lengths go to the earlier term in the list. No term:
// "Other title". Computed when read, never stored.
export function createTitleGrouper(terms: readonly string[]): (title: string | null) => string {
  const keyed = terms.map((term, index) => ({ term, key: phraseKey(term), index })).filter((entry) => entry.key.length > 0);
  keyed.sort((a, b) => b.key.length - a.key.length || a.index - b.index);
  return (title) => {
    if (!title) return otherTitleGroup;
    const padded = ` ${phraseKey(title)} `;
    return keyed.find((entry) => padded.includes(` ${entry.key} `))?.term ?? otherTitleGroup;
  };
}

// ---------------------------------------------------------------------------
// Per-job derivations

export const arrangementKeys = ["REMOTE", "HYBRID", "ONSITE", "SEVERAL", "UNKNOWN"] as const;
export type MarketArrangement = (typeof arrangementKeys)[number];

// One stated arrangement, several options, or Unknown.
export function arrangementOf(job: Pick<MarketOpportunityFact, "remoteStatus" | "workArrangements">): MarketArrangement {
  const stated = [...new Set(job.workArrangements)];
  if (stated.length > 1) return "SEVERAL";
  const single = stated[0] ?? job.remoteStatus;
  return single === "REMOTE" || single === "HYBRID" || single === "ONSITE" ? single : "UNKNOWN";
}

export const seniorityKeys = [...seniorityValues, "UNKNOWN"] as const;
export type MarketSeniority = (typeof seniorityKeys)[number];

export function seniorityOf(job: Pick<MarketOpportunityFact, "seniority">): MarketSeniority {
  return (seniorityValues as readonly string[]).includes(job.seniority ?? "") ? (job.seniority as MarketSeniority) : "UNKNOWN";
}

const globalText = /\b(?:anywhere|worldwide|global(?:ly)?|work from anywhere)\b/i;
const uniqueBuckets = (codes: readonly string[]) => [...new Set(codes.map(geographyBucketOf))];

// Where the job is: the location field only. An ambiguous or unreadable
// location is Unknown, never guessed.
export function jobRegionsOf(job: Pick<MarketOpportunityFact, "location">): SiGeographyBucket[] {
  const reading = readLocationGeography(job.location);
  if (reading.codes.length && !reading.ambiguous) return uniqueBuckets(reading.codes);
  if (job.location && globalText.test(job.location)) return ["GLOBAL"];
  return ["UNKNOWN"];
}

// Who may be hired: the stated residency geography only.
export function hiringRegionsOf(job: Pick<MarketOpportunityFact, "residencyRegions" | "residencyRequirement">): SiGeographyBucket[] {
  if (job.residencyRegions.length) return uniqueBuckets(job.residencyRegions);
  if (job.residencyRequirement === "US_REQUIRED") return ["UNITED_STATES"];
  return ["UNKNOWN"];
}

export type MarketEvaluationState = Exclude<SiEvaluationState, "user_dismissed" | "no_longer_listed">;
export const marketEvaluationStates: readonly MarketEvaluationState[] = [
  "evaluated",
  "completed_without_recommendation",
  "in_progress",
  "waiting_budget",
  "waiting_usage_limit",
  "failed",
  "not_yet_evaluated",
];

const byCompletion = (a: MarketEvaluationFact, b: MarketEvaluationFact) =>
  (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime() ||
  b.createdAt.getTime() - a.createdAt.getTime() ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

// The latest completed evaluation (the same ordering as Feature 15's
// evaluation state): its recommendation, role classification, segment and
// requirements are the job's evaluated facts.
export function latestCompletedEvaluation(job: Pick<MarketOpportunityFact, "evaluations">): MarketEvaluationFact | null {
  return job.evaluations.filter((evaluation) => evaluation.status === "COMPLETED").sort(byCompletion)[0] ?? null;
}

// Feature 15's evaluation states. A dismissed or no-longer-listed job that
// was never evaluated is "not yet evaluated" here: market analytics has no
// opinion on why.
export function marketEvaluationStateOf(job: MarketOpportunityFact): { state: MarketEvaluationState; decision: string | null } {
  const { state, decision } = evaluationStateOf(job);
  return state === "user_dismissed" || state === "no_longer_listed" ? { state: "not_yet_evaluated", decision: null } : { state, decision };
}

interface JobView {
  job: MarketOpportunityFact;
  week: string;
  titleGroup: string;
  arrangement: MarketArrangement;
  seniority: MarketSeniority;
  jobRegions: SiGeographyBucket[];
  hiringRegions: SiGeographyBucket[];
  state: MarketEvaluationState;
  decision: string | null;
  evaluated: MarketEvaluationFact | null;
}

// Monday (UTC) of the week a date falls in.
export function weekOf(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Query

export type MarketCollection = "automated" | "all";

export interface MarketFilters {
  titleGroup: string | null;
  seniority: MarketSeniority | null;
  arrangement: MarketArrangement | null;
  region: SiGeographyBucket | null;
  currency: string | null;
  collection: MarketCollection;
  excludeNoLongerListed: boolean;
}

export interface MarketQuery {
  window: SiWindow;
  filters: MarketFilters;
}

export class MarketQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketQueryError";
  }
}

const currencyCode = /^[A-Z]{3}$/;

// GET parameters: window/from/to (as Source insights), titleGroup, seniority,
// arrangement, region, currency, collected=automated|all (default automated),
// excludeRemoved=1. An empty value means "any".
export function parseMarketQuery(
  input: Record<string, string | null | undefined>,
  now: Date,
  titleTerms: readonly string[],
): MarketQuery {
  let window: SiWindow;
  try {
    window = parseInsightsWindow({ window: input.window, from: input.from, to: input.to }, now);
  } catch (error) {
    if (error instanceof SourceInsightsWindowError) throw new MarketQueryError(error.message);
    throw error;
  }
  const value = (key: string) => input[key]?.trim() || null;
  const oneOf = <T extends string>(key: string, allowed: readonly T[], label: string): T | null => {
    const raw = value(key);
    if (raw === null) return null;
    if (!(allowed as readonly string[]).includes(raw)) throw new MarketQueryError(`${label} must be one of ${allowed.join(", ")}`);
    return raw as T;
  };
  const titleGroup = value("titleGroup");
  if (titleGroup !== null && titleGroup !== otherTitleGroup && !titleTerms.includes(titleGroup)) {
    throw new MarketQueryError("titleGroup must be a discovery title term or OTHER");
  }
  const currency = value("currency")?.toUpperCase() ?? null;
  // Only a stated currency can be selected: amounts without one are never
  // aggregated.
  if (currency !== null && !currencyCode.test(currency)) throw new MarketQueryError("currency must be a three-letter code");
  const collected = value("collected") ?? "automated";
  if (collected !== "automated" && collected !== "all") throw new MarketQueryError("collected must be automated or all");
  const exclude = value("excludeRemoved");
  if (exclude !== null && exclude !== "1" && exclude !== "0" && exclude !== "true" && exclude !== "false") {
    throw new MarketQueryError("excludeRemoved must be 1 or 0");
  }
  return {
    window,
    filters: {
      titleGroup,
      seniority: oneOf("seniority", seniorityKeys, "seniority"),
      arrangement: oneOf("arrangement", arrangementKeys, "arrangement"),
      region: oneOf("region", geographyBuckets, "region"),
      currency,
      collection: collected,
      excludeNoLongerListed: exclude === "1" || exclude === "true",
    },
  };
}

// ---------------------------------------------------------------------------
// Output shapes

export interface MarketShare {
  key: string;
  count: number;
  // Of every job in the cohort (Unknown included).
  ofAll: SiRate;
  // Of the jobs where the value is known; null on the Unknown row.
  ofKnown: SiRate | null;
}

export interface MarketDistribution {
  total: number;
  known: number;
  // Several values can apply to one job (geography): shares may sum past 100%.
  multiValued: boolean;
  rows: MarketShare[];
}

export interface MarketMedian {
  value: number | null;
  n: number;
  sample: SiSample;
}

export interface MarketTrendWeek {
  week: string;
  total: number;
  counts: Record<string, number>;
}

export interface MarketTrend {
  keys: string[];
  weeks: MarketTrendWeek[];
  // More weeks exist than are shown (the latest 26 are shown).
  truncated: boolean;
}

export interface MarketRecommendationRow {
  key: string;
  jobs: number;
  completed: number;
  coverage: SiRate;
  apply: SiRate;
  review: SiRate;
  skip: SiRate;
}

export interface SalaryStats {
  currency: string;
  basis: "BASE" | "OTE" | "UNKNOWN";
  jobs: number;
  exact: number;
  range: number;
  minOnly: number;
  maxOnly: number;
  medianMinimum: MarketMedian;
  medianMaximum: MarketMedian;
  medianMidpoint: MarketMedian;
  bands: Array<{ from: number; to: number; count: number }>;
  // Within this currency and basis only.
  breakdowns: {
    titleGroup: SalaryBreakdownRow[];
    seniority: SalaryBreakdownRow[];
    arrangement: SalaryBreakdownRow[];
    jobRegion: SalaryBreakdownRow[];
  };
}

export interface SalaryBreakdownRow {
  key: string;
  medianMidpoint: MarketMedian;
}

export interface SalaryTierRow {
  opportunityId: string;
  title: string | null;
  label: string;
  minimum: number | null;
  maximum: number | null;
  currency: string | null;
}

export interface MarketSalary {
  // Jobs stating an annual amount (a single range or tiers).
  known: SiRate;
  singleRange: number;
  tiered: number;
  unknown: number;
  // Per currency: how many jobs state a single range or tiers in it. Amounts
  // without a stated currency appear as UNKNOWN, for coverage only.
  currencies: Array<{ currency: string; singleRange: number; tiered: number }>;
  // Jobs with an annual single-range amount but no stated currency: counted
  // in coverage, never in a median, band or breakdown.
  currencyNotStated: number;
  // Always a stated currency (never UNKNOWN), or null.
  selectedCurrency: string | null;
  // The selected currency, one entry per basis present (BASE and OTE are
  // never combined).
  stats: SalaryStats[];
  tiers: SalaryTierRow[];
  tiersTruncated: boolean;
}

export interface MarketRequirementCategory {
  category: string;
  jobs: SiRate;
  required: SiRate;
  preferred: SiRate;
  other: SiRate;
}

export interface MarketRequirementVersion {
  version: string | null;
  group: string;
  jobs: number;
  included: boolean;
}

export interface MarketRequirements {
  evaluated: number;
  evaluatedCoverage: SiRate;
  withRequirementData: number;
  versions: MarketRequirementVersion[];
  cohort: { group: string | null; versions: Array<string | null>; jobs: number; excluded: number; reason: string | null };
  categories: MarketRequirementCategory[];
  statedYears: { jobs: number; withYears: number; openEnded: number; buckets: Array<{ key: string; count: number; share: SiRate }> };
  topPhrases: Array<{ phrase: string; category: string; jobs: number; share: SiRate }>;
}

export interface MarketAnalytics {
  version: string;
  window: { key: SiWindow["key"]; from: string | null; to: string };
  filters: MarketFilters;
  titleGroups: string[];
  notes: { selectionBias: string | null; historical: string | null; evaluation: string };
  overview: {
    total: number;
    trend: MarketTrend;
    coverage: {
      salaryKnown: SiRate;
      seniorityKnown: SiRate;
      locationKnown: SiRate;
      arrangementKnown: SiRate;
      evaluated: SiRate;
      requirementData: SiRate;
      probableDuplicates: number;
    };
  };
  salary: MarketSalary;
  roles: {
    titleGroups: MarketDistribution;
    topTitles: Array<{ title: string; count: number; share: SiRate }>;
    trend: MarketTrend;
    seniorityByGroup: Array<{ key: string; jobs: number; counts: Record<string, number> }>;
    roleClassification: { evaluated: number; coverage: SiRate; distribution: MarketDistribution };
  };
  geography: {
    jobLocation: MarketDistribution;
    hiringEligibility: MarketDistribution;
    workAuthorization: MarketDistribution;
    sponsorship: MarketDistribution;
    relocation: MarketDistribution;
    employerOfRecord: { stated: SiRate; regions: MarketDistribution };
    timeZone: { stated: SiRate; top: Array<{ text: string; count: number }> };
    arrangement: MarketDistribution;
    severalOptions: Array<{ combination: string[]; count: number }>;
    arrangementTrend: MarketTrend;
    regionTrend: MarketTrend;
  };
  seniority: {
    distribution: MarketDistribution;
    trend: MarketTrend;
    labels: Array<{ label: string; count: number }>;
  };
  requirements: MarketRequirements;
  segment: { evaluated: number; coverage: SiRate; distribution: MarketDistribution };
  recommendations: {
    total: number;
    completed: number;
    coverage: SiRate;
    apply: SiRate;
    review: SiRate;
    skip: SiRate;
    states: Record<MarketEvaluationState, number>;
    // Per first-seen week: counts, and the Apply / Review / Skip shares of
    // that week's completed evaluations with a recommendation, with the
    // week's evaluation coverage.
    trend: Array<{
      week: string;
      jobs: number;
      completed: number;
      apply: number;
      review: number;
      skip: number;
      coverage: SiRate;
      applyRate: SiRate;
      reviewRate: SiRate;
      skipRate: SiRate;
    }>;
    byTitleGroup: MarketRecommendationRow[];
    bySeniority: MarketRecommendationRow[];
    byArrangement: MarketRecommendationRow[];
    byJobRegion: MarketRecommendationRow[];
  };
}

// ---------------------------------------------------------------------------
// Helpers

const unknownKey = "UNKNOWN";

function distribution(
  views: readonly JobView[],
  keysOf: (view: JobView) => readonly string[],
  order: readonly string[],
  options: { multiValued?: boolean; unknown?: string; hideEmpty?: boolean } = {},
): MarketDistribution {
  const unknown = options.unknown ?? unknownKey;
  const counts = new Map<string, number>(order.map((key) => [key, 0]));
  let known = 0;
  for (const view of views) {
    const keys = [...new Set(keysOf(view))];
    if (keys.some((key) => key !== unknown)) known += 1;
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.has(unknown)) counts.set(unknown, 0);
  const total = views.length;
  const rows = [...counts.entries()]
    .filter(([key, count]) => count > 0 || (!options.hideEmpty && order.includes(key)) || key === unknown)
    .map(([key, count]) => ({
      key,
      count,
      ofAll: siRate(count, total),
      ofKnown: key === unknown ? null : siRate(count, known),
    }));
  // Listed order first, then any value outside it by count; Unknown last.
  const position = (key: string) => (key === unknown ? Number.MAX_SAFE_INTEGER : order.indexOf(key) === -1 ? order.length : order.indexOf(key));
  rows.sort((a, b) => position(a.key) - position(b.key) || b.count - a.count || a.key.localeCompare(b.key));
  return { total, known, multiValued: Boolean(options.multiValued), rows };
}

export function median(values: readonly number[]): MarketMedian {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return { value: null, n: 0, sample: "none" };
  const middle = Math.floor(n / 2);
  const value = n % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { value, n, sample: sampleLabel(n) };
}

function weeksFor(views: readonly JobView[], window: SiWindow): { weeks: string[]; truncated: boolean } {
  if (!views.length && !window.from) return { weeks: [], truncated: false };
  const firstWeek = weekOf(window.from ?? views.reduce((min, view) => (view.job.firstSeenAt < min ? view.job.firstSeenAt : min), views[0]!.job.firstSeenAt));
  const lastWeek = weekOf(new Date(window.to.getTime() - 1));
  const weeks: string[] = [];
  for (let at = new Date(`${firstWeek}T00:00:00.000Z`); at.toISOString().slice(0, 10) <= lastWeek; at = new Date(at.getTime() + 7 * dayMs)) {
    weeks.push(at.toISOString().slice(0, 10));
  }
  return weeks.length > maxTrendWeeks ? { weeks: weeks.slice(-maxTrendWeeks), truncated: true } : { weeks, truncated: false };
}

function trend(views: readonly JobView[], window: SiWindow, keysOf: (view: JobView) => readonly string[], order: readonly string[]): MarketTrend {
  const { weeks, truncated } = weeksFor(views, window);
  const byWeek = new Map(weeks.map((week) => [week, { week, total: 0, counts: Object.fromEntries(order.map((key) => [key, 0])) as Record<string, number> }]));
  const seen = new Set(order);
  for (const view of views) {
    const entry = byWeek.get(view.week);
    if (!entry) continue;
    entry.total += 1;
    for (const key of new Set(keysOf(view))) {
      entry.counts[key] = (entry.counts[key] ?? 0) + 1;
      seen.add(key);
    }
  }
  const keys = [...order, ...[...seen].filter((key) => !order.includes(key)).sort()];
  return { keys, weeks: [...byWeek.values()], truncated };
}

// Texts compared case-folded with whitespace collapsed. Each is shown in its
// most frequent written form (ties: code-point order), so the result never
// depends on row order.
const codePointOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cleanText = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
const foldText = (text: string) => text.toLocaleLowerCase("en-US");

function displayForm(forms: Map<string, number>): string {
  return [...forms.entries()].sort((a, b) => b[1] - a[1] || codePointOrder(a[0], b[0]))[0]![0];
}

function topTexts(values: Array<string | null>, limit: number): Array<{ text: string; count: number }> {
  const counts = new Map<string, { forms: Map<string, number>; count: number }>();
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const entry = counts.get(foldText(text)) ?? { forms: new Map<string, number>(), count: 0 };
    entry.count += 1;
    entry.forms.set(text, (entry.forms.get(text) ?? 0) + 1);
    counts.set(foldText(text), entry);
  }
  return [...counts.values()]
    .map((entry) => ({ text: displayForm(entry.forms), count: entry.count }))
    .sort((a, b) => b.count - a.count || codePointOrder(foldText(a.text), foldText(b.text)))
    .slice(0, limit);
}

function recommendationRow(key: string, views: readonly JobView[]): MarketRecommendationRow {
  const completed = views.filter((view) => view.state === "evaluated");
  const count = (decision: string) => completed.filter((view) => view.decision === decision).length;
  return {
    key,
    jobs: views.length,
    completed: completed.length,
    coverage: siRate(completed.length, views.length),
    apply: siRate(count("APPLY"), completed.length),
    review: siRate(count("REVIEW"), completed.length),
    skip: siRate(count("SKIP"), completed.length),
  };
}

function groupRows(views: readonly JobView[], keysOf: (view: JobView) => readonly string[], order: readonly string[]): Array<[string, JobView[]]> {
  const groups = new Map<string, JobView[]>(order.map((key) => [key, []]));
  for (const view of views) {
    for (const key of new Set(keysOf(view))) {
      const list = groups.get(key) ?? [];
      list.push(view);
      groups.set(key, list);
    }
  }
  return [...groups.entries()].filter(([, list]) => list.length > 0);
}

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

// ---------------------------------------------------------------------------
// Salary

type SalaryBasis = SalaryStats["basis"];
const basisOrder: readonly SalaryBasis[] = ["BASE", "OTE", "UNKNOWN"];
const basisOf = (job: MarketOpportunityFact): SalaryBasis => (job.compensationBasis === "BASE" || job.compensationBasis === "OTE" ? job.compensationBasis : "UNKNOWN");
const singleRangeOf = (job: MarketOpportunityFact) =>
  job.compensationTiers.length === 0 && (finite(job.salaryMin) || finite(job.salaryMax));
const currencyOf = (job: MarketOpportunityFact) => job.currency ?? unknownKey;

// A single range's midpoint, only when both bounds exist (an exact amount is
// its own midpoint).
export function midpointOf(job: Pick<MarketOpportunityFact, "salaryMin" | "salaryMax">): number | null {
  return finite(job.salaryMin) && finite(job.salaryMax) ? (job.salaryMin + job.salaryMax) / 2 : null;
}

function salaryStats(currency: string, basis: SalaryBasis, views: readonly JobView[], titleOrder: readonly string[]): SalaryStats {
  const jobs = views.map((view) => view.job);
  const breakdown = (keysOf: (view: JobView) => readonly string[], order: readonly string[]) =>
    groupRows(views, keysOf, order).map(([key, list]) => ({ key, medianMidpoint: median(list.map((view) => midpointOf(view.job)).filter(finite)) }));
  const minimums = jobs.map((job) => job.salaryMin).filter(finite);
  const maximums = jobs.map((job) => job.salaryMax).filter(finite);
  const midpoints = jobs.map(midpointOf).filter(finite);
  const both = jobs.filter((job) => finite(job.salaryMin) && finite(job.salaryMax));
  const counts = new Map<number, number>();
  for (const midpoint of midpoints) {
    const from = Math.floor(midpoint / salaryBandWidth) * salaryBandWidth;
    counts.set(from, (counts.get(from) ?? 0) + 1);
  }
  const present = [...counts.keys()].sort((a, b) => a - b);
  let starts = present;
  if (present.length && (present.at(-1)! - present[0]!) / salaryBandWidth + 1 <= maxContiguousBands) {
    starts = [];
    for (let from = present[0]!; from <= present.at(-1)!; from += salaryBandWidth) starts.push(from);
  }
  return {
    currency,
    basis,
    jobs: jobs.length,
    exact: both.filter((job) => job.salaryMin === job.salaryMax).length,
    range: both.filter((job) => job.salaryMin !== job.salaryMax).length,
    minOnly: jobs.filter((job) => finite(job.salaryMin) && !finite(job.salaryMax)).length,
    maxOnly: jobs.filter((job) => !finite(job.salaryMin) && finite(job.salaryMax)).length,
    medianMinimum: median(minimums),
    medianMaximum: median(maximums),
    medianMidpoint: median(midpoints),
    bands: starts.map((from) => ({ from, to: from + salaryBandWidth, count: counts.get(from) ?? 0 })),
    breakdowns: {
      titleGroup: breakdown((view) => [view.titleGroup], titleOrder),
      seniority: breakdown((view) => [view.seniority], seniorityKeys),
      arrangement: breakdown((view) => [view.arrangement], arrangementKeys),
      jobRegion: breakdown((view) => view.jobRegions, geographyBuckets),
    },
  };
}

function buildSalary(views: readonly JobView[], requestedCurrency: string | null, titleOrder: readonly string[]): MarketSalary {
  const total = views.length;
  const single = views.filter((view) => singleRangeOf(view.job));
  const tiered = views.filter((view) => view.job.compensationTiers.length > 0);
  const perCurrency = new Map<string, { currency: string; singleRange: number; tiered: number }>();
  const entry = (currency: string) => {
    const existing = perCurrency.get(currency) ?? { currency, singleRange: 0, tiered: 0 };
    perCurrency.set(currency, existing);
    return existing;
  };
  for (const view of single) entry(currencyOf(view.job)).singleRange += 1;
  for (const view of tiered) {
    for (const currency of new Set(view.job.compensationTiers.map((tier) => tier.currency ?? unknownKey))) entry(currency).tiered += 1;
  }
  // USD first, then by how many jobs state a single range in it; Unknown last.
  const currencies = [...perCurrency.values()].sort(
    (a, b) =>
      Number(a.currency === unknownKey) - Number(b.currency === unknownKey) ||
      Number(b.currency === "USD") - Number(a.currency === "USD") ||
      b.singleRange - a.singleRange ||
      b.tiered - a.tiered ||
      a.currency.localeCompare(b.currency),
  );
  // Numerical statistics only ever use one stated currency.
  const selectedCurrency = requestedCurrency ?? currencies.find((row) => row.currency !== unknownKey && row.singleRange > 0)?.currency ?? null;
  const inCurrency = selectedCurrency === null ? [] : single.filter((view) => view.job.currency === selectedCurrency);
  const stats = basisOrder
    .map((basis) => {
      const list = inCurrency.filter((view) => basisOf(view.job) === basis);
      return list.length ? salaryStats(selectedCurrency!, basis, list, titleOrder) : null;
    })
    .filter((row): row is SalaryStats => row !== null);
  const tierRows = tiered.flatMap((view) =>
    view.job.compensationTiers.map((tier) => ({
      opportunityId: view.job.id,
      title: view.job.title,
      label: tier.label,
      minimum: tier.minimum,
      maximum: tier.maximum,
      currency: tier.currency,
    })),
  );
  const known = single.length + tiered.length;
  return {
    known: siRate(known, total),
    singleRange: single.length,
    tiered: tiered.length,
    unknown: total - known,
    currencies,
    currencyNotStated: single.filter((view) => !view.job.currency).length,
    selectedCurrency,
    stats,
    tiers: tierRows.slice(0, maxTierRows),
    tiersTruncated: tierRows.length > maxTierRows,
  };
}

// ---------------------------------------------------------------------------
// Requirements

export const marketRequirementCategories = [
  "EXPERIENCE",
  "CAPABILITY",
  "TOOL",
  "INDUSTRY",
  "EDUCATION",
  "CERTIFICATION",
  "TECHNICAL_KNOWLEDGE",
  "LANGUAGE",
] as const;
const headlineCategories = new Set<string>(marketRequirementCategories);

// JD Reconstruction versions whose requirement categories mean the same
// thing, by compatibility group. Requirement figures combine versions only
// within one group. A version not listed here is its own group, so a future
// reconstruction version (the evaluator branch's v7 rebinds specialization
// categories and makes INDUSTRY requirement-relative) is never combined with
// v3 until it is declared compatible. See HANDOFFS.md.
export const reconstructionCompatibilityGroups: Readonly<Record<string, string>> = {
  "cs-jd-reconstruction-v3": "cs-jd-reconstruction-v3",
};
export const unrecordedReconstructionGroup = "unrecorded";

export function reconstructionGroupOf(version: string | null): string {
  if (!version) return unrecordedReconstructionGroup;
  return reconstructionCompatibilityGroups[version] ?? version;
}

const groupPreference = Object.values(reconstructionCompatibilityGroups);

function buildRequirements(views: readonly JobView[]): MarketRequirements {
  const total = views.length;
  const evaluated = views.filter((view) => view.evaluated);
  const withData = evaluated.filter((view) => view.evaluated!.requirements !== null);
  const versionCounts = new Map<string, { version: string | null; group: string; jobs: number }>();
  for (const view of withData) {
    const version = view.evaluated!.reconstructionVersion;
    const key = version ?? "";
    const entry = versionCounts.get(key) ?? { version, group: reconstructionGroupOf(version), jobs: 0 };
    entry.jobs += 1;
    versionCounts.set(key, entry);
  }
  const groupJobs = new Map<string, number>();
  for (const entry of versionCounts.values()) groupJobs.set(entry.group, (groupJobs.get(entry.group) ?? 0) + entry.jobs);
  // The largest compatible group; ties go to a declared group (newest
  // declaration first), then a recorded version, then by name.
  const rank = (group: string) => {
    const declared = groupPreference.lastIndexOf(group);
    return declared >= 0 ? -1000 + -declared : group === unrecordedReconstructionGroup ? 1 : 0;
  };
  const selectedGroup =
    [...groupJobs.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const cohort = withData.filter((view) => reconstructionGroupOf(view.evaluated!.reconstructionVersion) === selectedGroup);
  const excluded = withData.length - cohort.length;
  const versions = [...versionCounts.values()]
    .sort((a, b) => b.jobs - a.jobs || Number(a.version === null) - Number(b.version === null) || (a.version ?? "").localeCompare(b.version ?? ""))
    .map((entry) => ({ ...entry, included: entry.group === selectedGroup }));
  const label = (group: string | null) => (group === unrecordedReconstructionGroup ? "evaluations without a recorded JD Reconstruction version" : `JD Reconstruction ${group}`);
  const reason =
    excluded > 0
      ? `Requirement categories are combined only within one compatible JD Reconstruction version. Showing ${label(selectedGroup)} (${cohort.length} ${cohort.length === 1 ? "job" : "jobs"}); ${excluded} evaluated ${excluded === 1 ? "job" : "jobs"} from other versions ${excluded === 1 ? "is" : "are"} counted in coverage only.`
      : selectedGroup === unrecordedReconstructionGroup
        ? "These evaluations did not record their JD Reconstruction version."
        : null;
  const headline = (view: JobView) => (view.evaluated!.requirements ?? []).filter((item) => headlineCategories.has(item.category));
  const n = cohort.length;
  const categories = marketRequirementCategories.map((category) => {
    const jobsWith = (predicate: (item: MarketRequirementFact) => boolean) =>
      cohort.filter((view) => headline(view).some((item) => item.category === category && predicate(item))).length;
    return {
      category,
      jobs: siRate(jobsWith(() => true), n),
      required: siRate(jobsWith((item) => item.strength === "REQUIRED"), n),
      preferred: siRate(jobsWith((item) => item.strength === "PREFERRED"), n),
      other: siRate(jobsWith((item) => item.strength !== "REQUIRED" && item.strength !== "PREFERRED"), n),
    };
  });
  // Stated years: the highest stated minimum among a job's EXPERIENCE
  // requirements, once per job.
  const experienceJobs = cohort.filter((view) => headline(view).some((item) => item.category === "EXPERIENCE"));
  const yearBuckets = ["0-1", "2", "3", "4", "5", "6-7", "8-9", "10+"];
  const bucketOf = (years: number) =>
    years < 2 ? "0-1" : years < 3 ? "2" : years < 4 ? "3" : years < 5 ? "4" : years < 6 ? "5" : years < 8 ? "6-7" : years < 10 ? "8-9" : "10+";
  const yearCounts = new Map(yearBuckets.map((key) => [key, 0]));
  let withYears = 0;
  let openEnded = 0;
  for (const view of experienceJobs) {
    const stated = headline(view).filter((item) => item.category === "EXPERIENCE" && finite(item.statedYears));
    if (!stated.length) continue;
    withYears += 1;
    const highest = stated.reduce((max, item) => (item.statedYears! > max.statedYears! ? item : max));
    if (highest.statedYearsOpenEnded) openEnded += 1;
    const key = bucketOf(highest.statedYears!);
    yearCounts.set(key, (yearCounts.get(key) ?? 0) + 1);
  }
  const phrases = new Map<string, { forms: Map<string, number>; category: string; jobs: Set<string> }>();
  for (const view of cohort) {
    for (const item of headline(view)) {
      const phrase = cleanText(item.requirement);
      if (!phrase) continue;
      const key = `${item.category}\u0000${foldText(phrase)}`;
      const entry = phrases.get(key) ?? { forms: new Map<string, number>(), category: item.category, jobs: new Set<string>() };
      entry.jobs.add(view.job.id);
      entry.forms.set(phrase, (entry.forms.get(phrase) ?? 0) + 1);
      phrases.set(key, entry);
    }
  }
  return {
    evaluated: evaluated.length,
    evaluatedCoverage: siRate(evaluated.length, total),
    withRequirementData: withData.length,
    versions,
    cohort: { group: selectedGroup, versions: versions.filter((entry) => entry.included).map((entry) => entry.version), jobs: n, excluded, reason },
    categories,
    statedYears: {
      jobs: experienceJobs.length,
      withYears,
      openEnded,
      buckets: yearBuckets.map((key) => ({ key, count: yearCounts.get(key) ?? 0, share: siRate(yearCounts.get(key) ?? 0, withYears) })),
    },
    topPhrases: [...phrases.values()]
      .map((entry) => ({ phrase: displayForm(entry.forms), category: entry.category, jobs: entry.jobs.size, share: siRate(entry.jobs.size, n) }))
      .sort((a, b) => b.jobs - a.jobs || codePointOrder(foldText(a.phrase), foldText(b.phrase)) || codePointOrder(a.category, b.category))
      .slice(0, topListSize),
  };
}

// ---------------------------------------------------------------------------
// Build

export const roleClassificationKeys = ["CORE_CS", "CS_ADJACENT", "SUPPORT_HEAVY", "SALES_HEAVY", "IMPLEMENTATION_HEAVY", "TECHNICAL_CS", "UNRELATED"] as const;
export const customerSegmentKeys = ["SMB", "MID_MARKET", "COMMERCIAL", "ENTERPRISE", "MIXED", "UNKNOWN"] as const;
const workAuthorizationKeys = ["RIGHT_TO_WORK", "CITIZENSHIP"];
const availabilityKeys = ["AVAILABLE", "NOT_AVAILABLE"];

export interface BuildMarketAnalyticsInput {
  opportunities: readonly MarketOpportunityFact[];
  titleTerms: readonly string[];
  query: MarketQuery;
}

export function buildMarketAnalytics(input: BuildMarketAnalyticsInput): MarketAnalytics {
  const { window, filters } = input.query;
  const grouper = createTitleGrouper(input.titleTerms);
  const titleOrder = [...input.titleTerms, otherTitleGroup];
  const views: JobView[] = input.opportunities
    .filter((job) => (!window.from || job.firstSeenAt >= window.from) && job.firstSeenAt < window.to)
    .filter((job) => filters.collection === "all" || job.automated)
    .filter((job) => !filters.excludeNoLongerListed || !job.noLongerListed)
    .map((job) => {
      const { state, decision } = marketEvaluationStateOf(job);
      return {
        job,
        week: weekOf(job.firstSeenAt),
        titleGroup: grouper(job.title),
        arrangement: arrangementOf(job),
        seniority: seniorityOf(job),
        jobRegions: jobRegionsOf(job),
        hiringRegions: hiringRegionsOf(job),
        state,
        decision,
        evaluated: latestCompletedEvaluation(job),
      };
    })
    .filter((view) => !filters.titleGroup || view.titleGroup === filters.titleGroup)
    .filter((view) => !filters.seniority || view.seniority === filters.seniority)
    .filter((view) => !filters.arrangement || view.arrangement === filters.arrangement)
    .filter((view) => !filters.region || view.jobRegions.includes(filters.region));

  const total = views.length;
  const count = (predicate: (view: JobView) => boolean) => views.filter(predicate).length;
  const evaluatedViews = views.filter((view) => view.evaluated);
  const salary = buildSalary(views, filters.currency, titleOrder);
  const requirements = buildRequirements(views);
  const decision = (value: string) => views.filter((view) => view.state === "evaluated" && view.decision === value).length;
  const completed = count((view) => view.state === "evaluated");
  const states = Object.fromEntries(marketEvaluationStates.map((state) => [state, count((view) => view.state === state)])) as Record<MarketEvaluationState, number>;
  const { weeks } = weeksFor(views, window);
  const recommendationRows = (keysOf: (view: JobView) => readonly string[], order: readonly string[]) =>
    groupRows(views, keysOf, order).map(([key, list]) => recommendationRow(key, list));
  const evaluatedDistribution = (valueOf: (evaluation: MarketEvaluationFact) => string | null, order: readonly string[]) =>
    distribution(evaluatedViews, (view) => [valueOf(view.evaluated!) ?? unknownKey], order);
  const historical =
    !window.from || window.from < automatedRetrievalStartedAt
      ? "Automated retrieval began on October 18, 2026; earlier records are not a complete automated-market sample."
      : null;

  return {
    version: marketAnalyticsVersion,
    window: { key: window.key, from: window.from?.toISOString() ?? null, to: window.to.toISOString() },
    filters,
    titleGroups: titleOrder,
    notes: {
      selectionBias: filters.collection === "all" ? selectionBiasNote : null,
      historical,
      evaluation: evaluationDisclosure,
    },
    overview: {
      total,
      trend: trend(views, window, () => [], []),
      coverage: {
        salaryKnown: salary.known,
        seniorityKnown: siRate(count((view) => view.seniority !== "UNKNOWN"), total),
        locationKnown: siRate(count((view) => !view.jobRegions.includes("UNKNOWN")), total),
        arrangementKnown: siRate(count((view) => view.arrangement !== "UNKNOWN"), total),
        evaluated: siRate(evaluatedViews.length, total),
        requirementData: siRate(requirements.withRequirementData, total),
        probableDuplicates: count((view) => view.job.probableUnresolved),
      },
    },
    salary,
    roles: {
      titleGroups: distribution(views, (view) => [view.titleGroup], titleOrder, { unknown: otherTitleGroup, hideEmpty: true }),
      topTitles: topTexts(views.map((view) => view.job.title), topListSize).map((entry) => ({ title: entry.text, count: entry.count, share: siRate(entry.count, total) })),
      trend: trend(views, window, (view) => [view.titleGroup], titleOrder),
      seniorityByGroup: groupRows(views, (view) => [view.titleGroup], titleOrder).map(([key, list]) => ({
        key,
        jobs: list.length,
        counts: Object.fromEntries(seniorityKeys.map((level) => [level, list.filter((view) => view.seniority === level).length])),
      })),
      roleClassification: {
        evaluated: evaluatedViews.length,
        coverage: siRate(evaluatedViews.length, total),
        distribution: evaluatedDistribution((evaluation) => evaluation.roleClassification, roleClassificationKeys),
      },
    },
    geography: {
      jobLocation: distribution(views, (view) => view.jobRegions, geographyBuckets, { multiValued: true }),
      hiringEligibility: distribution(views, (view) => view.hiringRegions, geographyBuckets, { multiValued: true }),
      workAuthorization: distribution(views, (view) => [view.job.workAuthorizationRequirement ?? unknownKey], workAuthorizationKeys),
      sponsorship: distribution(views, (view) => [view.job.visaSponsorship ?? unknownKey], availabilityKeys),
      relocation: distribution(views, (view) => [view.job.relocationSupport ?? unknownKey], availabilityKeys),
      employerOfRecord: {
        stated: siRate(count((view) => view.job.employerOfRecordRegions.length > 0), total),
        regions: distribution(
          views,
          (view) => (view.job.employerOfRecordRegions.length ? uniqueBuckets(view.job.employerOfRecordRegions) : [unknownKey]),
          geographyBuckets,
          { multiValued: true },
        ),
      },
      timeZone: {
        stated: siRate(count((view) => Boolean(view.job.timeZoneRequirements?.trim())), total),
        top: topTexts(views.map((view) => view.job.timeZoneRequirements), 10),
      },
      arrangement: distribution(views, (view) => [view.arrangement], arrangementKeys),
      severalOptions: topTexts(
        views.filter((view) => view.arrangement === "SEVERAL").map((view) => [...new Set(view.job.workArrangements)].join("+")),
        10,
      ).map((entry) => ({ combination: entry.text.toUpperCase().split("+"), count: entry.count })),
      arrangementTrend: trend(views, window, (view) => [view.arrangement], arrangementKeys),
      regionTrend: trend(views, window, (view) => view.jobRegions, geographyBuckets),
    },
    seniority: {
      distribution: distribution(views, (view) => [view.seniority], seniorityKeys),
      trend: trend(views, window, (view) => [view.seniority], seniorityKeys),
      labels: topTexts(views.map((view) => view.job.seniorityLabel), 10).map((entry) => ({ label: entry.text, count: entry.count })),
    },
    requirements,
    segment: {
      evaluated: evaluatedViews.length,
      coverage: siRate(evaluatedViews.length, total),
      distribution: evaluatedDistribution((evaluation) => evaluation.customerSegment, customerSegmentKeys),
    },
    recommendations: {
      total,
      completed,
      coverage: siRate(completed, total),
      apply: siRate(decision("APPLY"), completed),
      review: siRate(decision("REVIEW"), completed),
      skip: siRate(decision("SKIP"), completed),
      states,
      trend: weeks.map((week) => {
        const list = views.filter((view) => view.week === week);
        const done = list.filter((view) => view.state === "evaluated");
        const apply = done.filter((view) => view.decision === "APPLY").length;
        const review = done.filter((view) => view.decision === "REVIEW").length;
        const skip = done.filter((view) => view.decision === "SKIP").length;
        return {
          week,
          jobs: list.length,
          completed: done.length,
          apply,
          review,
          skip,
          coverage: siRate(done.length, list.length),
          applyRate: siRate(apply, done.length),
          reviewRate: siRate(review, done.length),
          skipRate: siRate(skip, done.length),
        };
      }),
      byTitleGroup: recommendationRows((view) => [view.titleGroup], titleOrder),
      bySeniority: recommendationRows((view) => [view.seniority], seniorityKeys),
      byArrangement: recommendationRows((view) => [view.arrangement], arrangementKeys),
      byJobRegion: recommendationRows((view) => view.jobRegions, geographyBuckets),
    },
  };
}
