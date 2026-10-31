import { arrangementKeys, arrangementOf, createTitleGrouper, otherTitleGroup, seniorityKeys, seniorityOf, type MarketArrangement, type MarketSeniority } from "./market-analytics";
import {
  listingIdentity,
  outcomeOf,
  parseInsightsWindow,
  siRate,
  sourceInfoOf,
  SourceInsightsWindowError,
  type SiApplicationFact,
  type SiListingFact,
  type SiOutcome,
  type SiRate,
  type SiSourceDescriptor,
  type SiSourceGroup,
  type SiWindow,
} from "./source-intelligence";

// Personal Job-Search Analytics (feature 17): what is actually working for the
// user, from their persisted evaluations and applications. Pure definitions
// over facts the repository reads; nothing here queries, writes, evaluates,
// infers or estimates. The approved contract (CS PRD v1.15 §19, October 31,
// 2026):
// - Evaluation figures: one canonical opportunity, its latest completed
//   evaluation, dated by that evaluation's completedAt.
// - Application figures: one opportunity counted as applied by Feature 15's
//   outcomeOf (a submitted tracked application or MARK_APPLIED, once), dated by
//   its appliedAt; later interviews and offers stay with that application.
// - Interview rate = interviews ÷ mature applications (Feature 15's 30-day
//   rule). Offer rates exclude processes still in progress.
// - Recommendation at application uses only the ordering the evidence shows;
//   a same-day evaluation with date-only application evidence is "Same-day
//   order unknown", never assumed to come first.
// - Fit and Genuine Gap figures are profile-relative: one profile version at a
//   time (the active one by default), and Resume Match prompt versions combine
//   only within a declared compatible group. Recommendation and outcome facts
//   may span versions, as stored.
// - No composite score, no accuracy measure, no effort claim, no learning
//   prescription, no named-company analysis. Every figure carries its count
//   and sample label.

export const personalAnalyticsVersion = "personal-analytics-v1";

export const outcomeDisclosure =
  "These tables show what happened after each stored evaluation or recommendation. They do not measure evaluator accuracy.";
export const versionDisclosure =
  "Recommendations and outcomes are shown as they were stored and may span evaluator and profile versions.";
export const gapGroupingDisclosure =
  "Requirements are grouped only by their category and exact wording; similar wording is not merged.";

const dayMs = 24 * 60 * 60 * 1000;
const rankingMinimum = 5;
export const notProgressingMinimum = 5;
const topPhraseCount = 15;
const recommendationDecisions = new Set(["APPLY", "REVIEW", "SKIP"]);

// ---------------------------------------------------------------------------
// Facts

export interface PaGapFact {
  category: string;
  strength: string;
  decisionImpact: string;
  requirementText: string;
}

export interface PaEvaluationFact {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: Date;
  completedAt: Date | null;
  decision: string | null;
  userProfileId: string | null;
  userProfileVersion: number | null;
  // Stored, job-side or profile-relative outputs, as persisted.
  roleClassification: string | null;
  customerSegment: string | null;
  customerType: string | null;
  alexFit: string | null;
  // Null when Resume Match did not evaluate.
  resumeMatch: { band: string | null; gaps: PaGapFact[] } | null;
  // Prompt version of the evaluation's successful Resume Match call.
  resumeMatchVersion: string | null;
}

export interface PaApplicationFact extends SiApplicationFact {
  interviews: Array<{ status: string; at: Date; kind: string }>;
}

export interface PaOpportunityFact {
  id: string;
  title: string | null;
  status: string;
  seniority: string | null;
  remoteStatus: string | null;
  workArrangements: string[];
  // The originating listing (earliest source record by createdAt, id).
  origin: Pick<SiListingFact, "source" | "sourceType" | "retrievalSourceId" | "captureSite" | "externalId"> | null;
  evaluations: PaEvaluationFact[];
  openDeferralReason: string | null;
  noLongerListed: boolean;
  // Earliest lifecycle MARK_APPLIED action: an exact timestamp.
  markedAppliedAt: Date | null;
  application: PaApplicationFact | null;
}

export interface PaProfileFact {
  id: string;
  label: string;
  version: number;
}

export interface PaFacts {
  opportunities: PaOpportunityFact[];
  sources: SiSourceDescriptor[];
  profiles: PaProfileFact[];
  activeProfileId: string | null;
}

// ---------------------------------------------------------------------------
// Windows and query

export type PaWindowKey = "30d" | "90d" | "180d" | "all" | "custom";
export const personalWindowKeys: readonly PaWindowKey[] = ["30d", "90d", "180d", "all", "custom"];

export interface PaWindow {
  key: PaWindowKey;
  from: Date | null;
  to: Date;
}

export class PersonalQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalQueryError";
  }
}

// Feature 17's windows: Feature 15's parser plus 180 days; default all time.
export function parsePersonalWindow(input: { window?: string | null; from?: string | null; to?: string | null }, now: Date): PaWindow {
  const key = input.window?.trim() || "all";
  if (key === "180d") return { key, from: new Date(now.getTime() - 180 * dayMs), to: now };
  if (key === "7d" || !(personalWindowKeys as readonly string[]).includes(key)) {
    throw new PersonalQueryError("window must be one of 30d, 90d, 180d, all or custom");
  }
  try {
    const window: SiWindow = parseInsightsWindow({ window: key, from: input.from, to: input.to }, now);
    return { key: window.key as PaWindowKey, from: window.from, to: window.to };
  } catch (error) {
    if (error instanceof SourceInsightsWindowError) throw new PersonalQueryError(error.message);
    throw error;
  }
}

export const recommendationAtApplicationStates = ["APPLY", "REVIEW", "SKIP", "SAME_DAY_UNKNOWN", "EVALUATED_AFTER", "NOT_EVALUATED"] as const;
export type RecommendationAtApplication = (typeof recommendationAtApplicationStates)[number];

export interface PersonalFilters {
  titleGroup: string | null;
  recommendation: RecommendationAtApplication | null;
  arrangement: MarketArrangement | null;
  seniority: MarketSeniority | null;
  // A Feature 15 source identity ("Found first by").
  source: string | null;
  // "active" (default), a profile id, or "none" (profile not recorded).
  profile: string;
}

export interface PersonalQuery {
  window: PaWindow;
  filters: PersonalFilters;
}

const sourceKey = /^(?:source:[0-9a-f-]{36}|adapter:[a-z0-9-]+|extension:[a-z0-9.-]+|manual|none)$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parsePersonalQuery(input: Record<string, string | null | undefined>, now: Date, titleTerms: readonly string[]): PersonalQuery {
  const window = parsePersonalWindow({ window: input.window, from: input.from, to: input.to }, now);
  const value = (key: string) => input[key]?.trim() || null;
  const oneOf = <T extends string>(key: string, allowed: readonly T[]): T | null => {
    const raw = value(key);
    if (raw === null) return null;
    if (!(allowed as readonly string[]).includes(raw)) throw new PersonalQueryError(`${key} must be one of ${allowed.join(", ")}`);
    return raw as T;
  };
  const titleGroup = value("titleGroup");
  if (titleGroup !== null && titleGroup !== otherTitleGroup && !titleTerms.includes(titleGroup)) {
    throw new PersonalQueryError("titleGroup must be a discovery title term or OTHER");
  }
  const source = value("source");
  if (source !== null && !sourceKey.test(source)) throw new PersonalQueryError("source must be a source identity");
  const profile = value("profile") ?? "active";
  if (profile !== "active" && profile !== "none" && !uuid.test(profile)) throw new PersonalQueryError("profile must be active, none or a profile id");
  return {
    window,
    filters: {
      titleGroup,
      recommendation: oneOf("recommendation", recommendationAtApplicationStates),
      arrangement: oneOf("arrangement", arrangementKeys),
      seniority: oneOf("seniority", seniorityKeys),
      source,
      profile,
    },
  };
}

// ---------------------------------------------------------------------------
// Dates

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

// The calendar date of an instant in the user's time zone (UTC when none is set).
export function localDay(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  } catch {
    return isoDay(instant);
  }
}

const inWindow = (window: PaWindow, at: Date | null) => at !== null && (!window.from || at >= window.from) && at < window.to;

// ---------------------------------------------------------------------------
// Evaluations

const completedOrder = (a: PaEvaluationFact, b: PaEvaluationFact) =>
  (a.completedAt ?? a.createdAt).getTime() - (b.completedAt ?? b.createdAt).getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const completedWithRecommendation = (job: PaOpportunityFact) =>
  job.evaluations
    .filter((evaluation) => evaluation.status === "COMPLETED" && evaluation.completedAt && evaluation.decision && recommendationDecisions.has(evaluation.decision))
    .sort(completedOrder);

export function latestCompleted(job: Pick<PaOpportunityFact, "evaluations">): PaEvaluationFact | null {
  const completed = job.evaluations.filter((evaluation) => evaluation.status === "COMPLETED").sort(completedOrder);
  return completed.at(-1) ?? null;
}

// The recommendation the user had when they applied, from the strongest
// temporal evidence (approved correction):
// - an exact application timestamp (the earliest MARK_APPLIED action, when it
//   is the application's earliest evidence): the latest completed evaluation
//   with completedAt ≤ that timestamp;
// - date-only evidence: an evaluation completed on an earlier calendar day is
//   eligible; a later day is "evaluated after applying"; the same day, with no
//   ordering evidence, is "same-day order unknown" — never assumed earlier.
// Only completed evaluations with a stored Apply/Review/Skip count.
export function recommendationAtApplication(
  job: PaOpportunityFact,
  outcome: Pick<SiOutcome, "applied" | "appliedAt">,
  timeZone: string,
): { state: RecommendationAtApplication; evaluation: PaEvaluationFact | null } {
  const evaluations = completedWithRecommendation(job);
  if (!outcome.applied || !outcome.appliedAt) return { state: "NOT_EVALUATED", evaluation: null };
  if (!evaluations.length) return { state: "NOT_EVALUATED", evaluation: null };
  const exact = job.markedAppliedAt && job.markedAppliedAt.getTime() <= outcome.appliedAt.getTime() ? job.markedAppliedAt : null;
  if (exact) {
    const before = evaluations.filter((evaluation) => evaluation.completedAt! <= exact).at(-1);
    return before ? { state: before.decision as RecommendationAtApplication, evaluation: before } : { state: "EVALUATED_AFTER", evaluation: null };
  }
  // Date-only evidence (appliedOn, a SUBMITTED event's date, or the
  // application's creation when nothing else exists), compared by calendar day.
  const day = dateOnlyDay(job, outcome.appliedAt, timeZone);
  const earlier = evaluations.filter((evaluation) => localDay(evaluation.completedAt!, timeZone) < day);
  const sameDay = evaluations.filter((evaluation) => localDay(evaluation.completedAt!, timeZone) === day);
  const prior = earlier.at(-1);
  if (sameDay.length) {
    // A same-day evaluation may have come before or after; it only leaves the
    // answer known when it agrees with what the user already had.
    if (prior && sameDay.every((evaluation) => evaluation.decision === prior.decision)) {
      return { state: prior.decision as RecommendationAtApplication, evaluation: prior };
    }
    return { state: "SAME_DAY_UNKNOWN", evaluation: null };
  }
  if (prior) return { state: prior.decision as RecommendationAtApplication, evaluation: prior };
  return { state: "EVALUATED_AFTER", evaluation: null };
}

// appliedOn and event dates are calendar dates (stored at UTC midnight);
// a timestamp fallback is converted to the user's calendar day.
function dateOnlyDay(job: PaOpportunityFact, appliedAt: Date, timeZone: string): string {
  const application = job.application;
  const dates = [application?.appliedOn, ...(application?.events ?? []).filter((event) => event.type === "SUBMITTED").map((event) => event.at)].filter(
    (date): date is Date => date instanceof Date,
  );
  if (dates.some((date) => date.getTime() === appliedAt.getTime())) return isoDay(appliedAt);
  return localDay(appliedAt, timeZone);
}

// ---------------------------------------------------------------------------
// Outcomes

export interface PaOutcome extends SiOutcome {
  // Not yet observable: under 30 days without progress or close.
  mature: boolean;
  // Progressed (interview stage) and still open, without an offer.
  inProcess: boolean;
  // The offer outcome is observable: offer reached, closed, or mature with
  // no progression.
  resolved: boolean;
  // An interview process that ended (offer or closed).
  interviewConcluded: boolean;
  recruiterScreen: boolean;
  beyondScreening: boolean;
  finalRound: boolean;
  closedOutcome: string | null;
}

const reached = (application: PaApplicationFact | null, stages: readonly string[]) =>
  Boolean(application && (stages.includes(application.stage) || application.events.some((event) => event.toStage && stages.includes(event.toStage))));
const interviewOf = (application: PaApplicationFact | null, kinds: readonly string[] | null) =>
  Boolean(application?.interviews.some((interview) => interview.status !== "CANCELLED" && (kinds === null || kinds.includes(interview.kind))));

export function personalOutcomeOf(job: PaOpportunityFact, now: Date): PaOutcome {
  const outcome = outcomeOf(job, now);
  const application = job.application;
  const mature = outcome.applied && !outcome.awaitingResponse;
  const inProcess = outcome.interview && !outcome.offer && !outcome.closed;
  return {
    ...outcome,
    mature,
    inProcess,
    resolved: outcome.applied && (outcome.offer || outcome.closed || (mature && !outcome.interview)),
    interviewConcluded: outcome.interview && (outcome.offer || outcome.closed),
    recruiterScreen: reached(application, ["SCREENING"]) || interviewOf(application, ["RECRUITER_SCREEN"]),
    beyondScreening:
      reached(application, ["INTERVIEWING", "FINAL_ROUND", "OFFER"]) ||
      interviewOf(application, ["HIRING_MANAGER", "TECHNICAL", "CASE_STUDY", "PANEL", "FINAL", "OTHER"]),
    finalRound: reached(application, ["FINAL_ROUND"]) || interviewOf(application, ["FINAL"]),
    closedOutcome: application?.stage === "CLOSED" || application?.outcome ? (application?.outcome ?? null) : null,
  };
}

export interface PaOutcomeRow {
  key: string;
  applied: number;
  mature: number;
  awaitingResponse: number;
  inProcess: number;
  interviews: number;
  interviewRate: SiRate;
  offers: number;
  // offers ÷ resolved applications (in-process ones excluded).
  offerRate: SiRate;
  resolved: number;
}

function outcomeRow(key: string, views: readonly ApplicationView[]): PaOutcomeRow {
  const count = (predicate: (view: ApplicationView) => boolean) => views.filter(predicate).length;
  const mature = count((view) => view.outcome.mature);
  const interviews = count((view) => view.outcome.mature && view.outcome.interview);
  const resolved = count((view) => view.outcome.resolved);
  const offers = count((view) => view.outcome.offer);
  return {
    key,
    applied: views.length,
    mature,
    awaitingResponse: count((view) => view.outcome.awaitingResponse),
    inProcess: count((view) => view.outcome.inProcess),
    interviews,
    interviewRate: siRate(interviews, mature),
    offers,
    offerRate: siRate(offers, resolved),
    resolved,
  };
}

// ---------------------------------------------------------------------------
// Views

interface JobDimensions {
  titleGroup: string;
  arrangement: MarketArrangement;
  seniority: MarketSeniority;
  source: string;
}

interface ApplicationView extends JobDimensions {
  job: PaOpportunityFact;
  outcome: PaOutcome;
  recommendation: RecommendationAtApplication;
  creditedEvaluation: PaEvaluationFact | null;
  latest: PaEvaluationFact | null;
}

interface EvaluationView extends JobDimensions {
  job: PaOpportunityFact;
  evaluation: PaEvaluationFact;
  outcome: PaOutcome;
}

const noSourceKey = "none";
const sourceOf = (job: PaOpportunityFact) => (job.origin ? listingIdentity({ ...job.origin, recordId: "", opportunityId: null, sourceCategory: null, duplicateDecision: null, sourceUrl: null, applicationUrl: null, createdAt: new Date(0) }) : noSourceKey);

// Resume Match prompt versions whose Genuine Gap meaning is the same. Only
// cs-resume-match-v2 (this branch) is declared; any other version (the
// evaluator branch's v3/v4, where structured profile limitations are the only
// gap proof) is its own group until final integration declares it compatible.
// See HANDOFFS.md.
export const resumeMatchCompatibilityGroups: Readonly<Record<string, string>> = {
  "cs-resume-match-v2": "cs-resume-match-v2",
};
export const unrecordedResumeMatchGroup = "unrecorded";
export function resumeMatchGroupOf(version: string | null): string {
  if (!version) return unrecordedResumeMatchGroup;
  return resumeMatchCompatibilityGroups[version] ?? version;
}

// ---------------------------------------------------------------------------
// Output

export interface PaShare {
  key: string;
  count: number;
  share: SiRate;
}

export interface PaRoleRow {
  key: string;
  // What the evaluator said (evaluation cohort).
  evaluated: number;
  apply: SiRate;
  // Fit cohort (selected profile version; compatible Resume Match versions).
  fitEvaluated: number;
  resumeMatchGoodOrBetter: SiRate;
  alexFitStrongOrGood: SiRate;
  // What actually happened (application cohort).
  outcomes: PaOutcomeRow;
  rankable: { fit: boolean; apply: boolean; interview: boolean };
}

export interface PaGapCategory {
  category: string;
  opportunities: number;
  share: SiRate;
  otherwiseGood: number;
  otherwiseGoodShare: SiRate;
  applied: number;
  interviewed: number;
  strength: { required: number; preferred: number; other: number };
  decisionImpact: Record<string, number>;
}

export interface PaSourceRow extends PaOutcomeRow {
  name: string;
  group: SiSourceGroup | "unknown";
}

export interface PersonalAnalytics {
  version: string;
  window: { key: PaWindowKey; from: string | null; to: string };
  filters: PersonalFilters;
  titleGroups: string[];
  timeZone: string;
  notes: { outcomes: string; versions: string; gaps: string };
  profile: {
    selected: { id: string | null; label: string | null; version: number | null; active: boolean; notRecorded: boolean };
    options: Array<{ id: string; label: string; version: number; active: boolean; evaluated: number }>;
    notRecorded: number;
  };
  overview: {
    applied: number;
    mature: number;
    awaitingResponse: number;
    inProcess: number;
    interviews: number;
    interviewRate: SiRate;
    offers: number;
    offerRate: SiRate;
    interviewToOffer: SiRate;
    evaluated: number;
    applicationsWithRecommendation: SiRate;
  };
  funnels: {
    applications: {
      applied: number;
      anyInterview: number;
      recruiterScreen: number;
      beyondScreening: number;
      finalRound: number;
      offers: number;
      awaitingResponse: number;
      inProcess: number;
      closed: Record<string, number>;
    };
    evaluated: {
      evaluated: number;
      decisions: Record<string, { evaluated: number; applied: number; interviews: number; offers: number }>;
      recommendedNotApplied: number;
    };
    byRecommendationAtApplication: PaOutcomeRow[];
  };
  roles: { rows: PaRoleRow[]; byRoleClassification: PaOutcomeRow[] };
  fitOutcomes: { resumeMatchBand: PaOutcomeRow[]; alexFit: PaOutcomeRow[]; credited: number; applied: number };
  gaps: {
    evaluated: number;
    otherwiseGood: number;
    versions: Array<{ version: string | null; group: string; evaluated: number; included: boolean }>;
    reason: string | null;
    categories: PaGapCategory[];
    phrases: Array<{ category: string; requirement: string; opportunities: number; otherwiseGood: number }>;
  };
  sources: { automated: PaSourceRow[]; userCollected: PaSourceRow[]; unknown: PaSourceRow | null };
  notProgressing: {
    groups: Array<{ dimension: string; key: string; label: string; mature: number }>;
    recommendedNotApplied: number;
  };
  companyType: { evaluatedApplied: number; segment: PaOutcomeRow[]; customerType: PaOutcomeRow[] };
  outcomesBy: { titleGroup: PaOutcomeRow[]; arrangement: PaOutcomeRow[]; seniority: PaOutcomeRow[] };
}

// ---------------------------------------------------------------------------
// Helpers

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string, order: readonly string[] = []): Array<[string, T[]]> {
  const groups = new Map<string, T[]>(order.map((key) => [key, []]));
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].filter(([, list]) => list.length > 0);
}

const codePointOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cleanText = (value: string) => value.replace(/\s+/g, " ").trim();
const foldText = (value: string) => cleanText(value).toLocaleLowerCase("en-US");
const unknownKey = "UNKNOWN";
const goodResumeMatch = new Set(["GOOD_HIGH", "VERY_STRONG_VERY_HIGH"]);
const goodAlexFit = new Set(["STRONG", "GOOD"]);
const resumeMatchBands = ["VERY_STRONG_VERY_HIGH", "GOOD_HIGH", "MIXED_MODERATE", "LOW", "VERY_LOW"];
const alexFitClasses = ["STRONG", "GOOD", "MIXED", "LOW"];
const segmentOrder = ["SMB", "MID_MARKET", "COMMERCIAL", "ENTERPRISE", "MIXED", "UNKNOWN"];
const customerTypeOrder = ["B2C", "B2B2C", "LIGHT_B2B", "ENTERPRISE_HEAVY_B2B", "MIXED", "UNKNOWN"];
const roleClassOrder = ["CORE_CS", "CS_ADJACENT", "SUPPORT_HEAVY", "SALES_HEAVY", "IMPLEMENTATION_HEAVY", "TECHNICAL_CS", "UNRELATED", "UNKNOWN"];
const closedOutcomeOrder = ["OFFER_ACCEPTED", "OFFER_DECLINED", "REJECTED", "WITHDRAWN", "NO_RESPONSE"];

// ---------------------------------------------------------------------------
// Build

export interface BuildPersonalAnalyticsInput {
  facts: PaFacts;
  titleTerms: readonly string[];
  query: PersonalQuery;
  now: Date;
  timeZone: string;
}

export function buildPersonalAnalytics(input: BuildPersonalAnalyticsInput): PersonalAnalytics {
  const { facts, query, now, timeZone } = input;
  const { window, filters } = query;
  const grouper = createTitleGrouper(input.titleTerms);
  const titleOrder = [...input.titleTerms, otherTitleGroup];
  const dimensionsOf = (job: PaOpportunityFact): JobDimensions => ({
    titleGroup: grouper(job.title),
    arrangement: arrangementOf(job),
    seniority: seniorityOf(job),
    source: sourceOf(job),
  });
  const matchesJob = (dims: JobDimensions) =>
    (!filters.titleGroup || dims.titleGroup === filters.titleGroup) &&
    (!filters.arrangement || dims.arrangement === filters.arrangement) &&
    (!filters.seniority || dims.seniority === filters.seniority) &&
    (!filters.source || dims.source === filters.source);

  // Application cohort: applied opportunities whose application date is in the window.
  const applications: ApplicationView[] = [];
  for (const job of facts.opportunities) {
    const outcome = personalOutcomeOf(job, now);
    if (!outcome.applied || !inWindow(window, outcome.appliedAt)) continue;
    const dims = dimensionsOf(job);
    if (!matchesJob(dims)) continue;
    const credited = recommendationAtApplication(job, outcome, timeZone);
    if (filters.recommendation && credited.state !== filters.recommendation) continue;
    applications.push({ ...dims, job, outcome, recommendation: credited.state, creditedEvaluation: credited.evaluation, latest: latestCompleted(job) });
  }

  // Evaluation cohort: opportunities whose latest completed evaluation completed in the window.
  const evaluations: EvaluationView[] = [];
  for (const job of facts.opportunities) {
    const evaluation = latestCompleted(job);
    if (!evaluation || !inWindow(window, evaluation.completedAt)) continue;
    const dims = dimensionsOf(job);
    if (!matchesJob(dims)) continue;
    evaluations.push({ ...dims, job, evaluation, outcome: personalOutcomeOf(job, now) });
  }

  // Profile selection for fit and gap figures (default: the active profile).
  const profiles = new Map(facts.profiles.map((profile) => [profile.id, profile]));
  const selectedId = filters.profile === "active" ? facts.activeProfileId : filters.profile === "none" ? null : filters.profile;
  const notRecordedSelected = filters.profile === "none";
  const inProfile = (evaluation: PaEvaluationFact) => (notRecordedSelected ? evaluation.userProfileId === null : selectedId !== null && evaluation.userProfileId === selectedId);
  const profileEvaluations = evaluations.filter((view) => inProfile(view.evaluation));

  // Resume Match version cohort inside the profile cohort.
  const withResumeMatch = profileEvaluations.filter((view) => view.evaluation.resumeMatch !== null);
  const versionCounts = new Map<string, { version: string | null; group: string; evaluated: number }>();
  for (const view of withResumeMatch) {
    const version = view.evaluation.resumeMatchVersion;
    const entry = versionCounts.get(version ?? "") ?? { version, group: resumeMatchGroupOf(version), evaluated: 0 };
    entry.evaluated += 1;
    versionCounts.set(version ?? "", entry);
  }
  const groupTotals = new Map<string, number>();
  for (const entry of versionCounts.values()) groupTotals.set(entry.group, (groupTotals.get(entry.group) ?? 0) + entry.evaluated);
  const declared = Object.values(resumeMatchCompatibilityGroups);
  const rank = (group: string) => (declared.includes(group) ? -1 : group === unrecordedResumeMatchGroup ? 1 : 0);
  const selectedGroup = [...groupTotals.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || codePointOrder(a[0], b[0]))[0]?.[0] ?? null;
  const fitCohort = withResumeMatch.filter((view) => resumeMatchGroupOf(view.evaluation.resumeMatchVersion) === selectedGroup);
  const excluded = withResumeMatch.length - fitCohort.length;
  const gapReason =
    excluded > 0
      ? `Genuine Gaps are combined only within one compatible Resume Match version. Showing ${selectedGroup === unrecordedResumeMatchGroup ? "evaluations without a recorded Resume Match version" : selectedGroup} (${fitCohort.length}); ${excluded} other evaluated ${excluded === 1 ? "job is" : "jobs are"} left out.`
      : null;
  const inFitCohort = (evaluation: PaEvaluationFact | null) =>
    Boolean(evaluation && inProfile(evaluation) && evaluation.resumeMatch && resumeMatchGroupOf(evaluation.resumeMatchVersion) === selectedGroup);

  // Overview.
  const total = outcomeRow("all", applications);
  const concluded = applications.filter((view) => view.outcome.interviewConcluded);
  const withRecommendation = applications.filter((view) => ["APPLY", "REVIEW", "SKIP"].includes(view.recommendation)).length;

  // Funnels.
  const closed: Record<string, number> = Object.fromEntries(closedOutcomeOrder.map((key) => [key, 0]));
  for (const view of applications) if (view.outcome.closedOutcome && view.outcome.closedOutcome in closed) closed[view.outcome.closedOutcome]! += 1;
  const decisions: Record<string, { evaluated: number; applied: number; interviews: number; offers: number }> = {};
  for (const key of ["APPLY", "REVIEW", "SKIP", "NONE"]) decisions[key] = { evaluated: 0, applied: 0, interviews: 0, offers: 0 };
  for (const view of evaluations) {
    const key = view.evaluation.decision && recommendationDecisions.has(view.evaluation.decision) ? view.evaluation.decision : "NONE";
    const entry = decisions[key]!;
    entry.evaluated += 1;
    if (view.outcome.applied) entry.applied += 1;
    if (view.outcome.interview) entry.interviews += 1;
    if (view.outcome.offer) entry.offers += 1;
  }
  const recommendedNotApplied = evaluations.filter((view) => view.evaluation.decision === "APPLY" && !view.outcome.applied).length;

  // Roles.
  const roleRows: PaRoleRow[] = [];
  const keys = new Set([...applications.map((view) => view.titleGroup), ...evaluations.map((view) => view.titleGroup)]);
  for (const key of titleOrder.filter((group) => keys.has(group))) {
    const evaluated = evaluations.filter((view) => view.titleGroup === key);
    const fit = fitCohort.filter((view) => view.titleGroup === key);
    const alexEvaluated = profileEvaluations.filter((view) => view.titleGroup === key && view.evaluation.alexFit);
    const outcomes = outcomeRow(key, applications.filter((view) => view.titleGroup === key));
    const decided = evaluated.filter((view) => view.evaluation.decision && recommendationDecisions.has(view.evaluation.decision));
    const apply = siRate(decided.filter((view) => view.evaluation.decision === "APPLY").length, decided.length);
    const resumeMatchGoodOrBetter = siRate(fit.filter((view) => goodResumeMatch.has(view.evaluation.resumeMatch?.band ?? "")).length, fit.length);
    roleRows.push({
      key,
      evaluated: evaluated.length,
      apply,
      fitEvaluated: fit.length,
      resumeMatchGoodOrBetter,
      alexFitStrongOrGood: siRate(alexEvaluated.filter((view) => goodAlexFit.has(view.evaluation.alexFit!)).length, alexEvaluated.length),
      outcomes,
      rankable: {
        fit: resumeMatchGoodOrBetter.denominator >= rankingMinimum,
        apply: apply.denominator >= rankingMinimum,
        interview: outcomes.interviewRate.denominator >= rankingMinimum,
      },
    });
  }
  const roleClassOf = (view: ApplicationView) => view.latest?.roleClassification ?? unknownKey;
  const evaluatedApplications = applications.filter((view) => view.latest);

  // Fit versus outcome: the evaluation credited at application, in the fit cohort.
  const creditedInFit = applications.filter((view) => inFitCohort(view.creditedEvaluation));
  const creditedWithAlexFit = applications.filter((view) => view.creditedEvaluation && inProfile(view.creditedEvaluation) && view.creditedEvaluation.alexFit);

  // Gaps.
  const otherwiseGood = (view: EvaluationView) => view.evaluation.decision === "APPLY" || view.evaluation.decision === "REVIEW";
  const categoryMap = new Map<string, PaGapCategory>();
  const phraseMap = new Map<string, { category: string; forms: Map<string, number>; jobs: Set<string>; good: Set<string> }>();
  const goodCount = fitCohort.filter(otherwiseGood).length;
  for (const view of fitCohort) {
    const gaps = view.evaluation.resumeMatch?.gaps ?? [];
    for (const [category, items] of groupBy(gaps, (gap) => gap.category)) {
      const entry =
        categoryMap.get(category) ??
        ({ category, opportunities: 0, share: siRate(0, 0), otherwiseGood: 0, otherwiseGoodShare: siRate(0, 0), applied: 0, interviewed: 0, strength: { required: 0, preferred: 0, other: 0 }, decisionImpact: {} } as PaGapCategory);
      entry.opportunities += 1;
      if (otherwiseGood(view)) entry.otherwiseGood += 1;
      if (view.outcome.applied) entry.applied += 1;
      if (view.outcome.interview) entry.interviewed += 1;
      if (items.some((gap) => gap.strength === "REQUIRED")) entry.strength.required += 1;
      if (items.some((gap) => gap.strength === "PREFERRED")) entry.strength.preferred += 1;
      if (items.some((gap) => gap.strength !== "REQUIRED" && gap.strength !== "PREFERRED")) entry.strength.other += 1;
      for (const impact of new Set(items.map((gap) => gap.decisionImpact))) entry.decisionImpact[impact] = (entry.decisionImpact[impact] ?? 0) + 1;
      categoryMap.set(category, entry);
      for (const gap of items) {
        const text = cleanText(gap.requirementText);
        if (!text) continue;
        const key = `${category}\u0000${foldText(text)}`;
        const phrase = phraseMap.get(key) ?? { category, forms: new Map<string, number>(), jobs: new Set<string>(), good: new Set<string>() };
        phrase.forms.set(text, (phrase.forms.get(text) ?? 0) + 1);
        phrase.jobs.add(view.job.id);
        if (otherwiseGood(view)) phrase.good.add(view.job.id);
        phraseMap.set(key, phrase);
      }
    }
  }
  const categories = [...categoryMap.values()]
    .map((entry) => ({ ...entry, share: siRate(entry.opportunities, fitCohort.length), otherwiseGoodShare: siRate(entry.otherwiseGood, goodCount) }))
    .sort((a, b) => b.opportunities - a.opportunities || codePointOrder(a.category, b.category));
  const displayForm = (forms: Map<string, number>) => [...forms.entries()].sort((a, b) => b[1] - a[1] || codePointOrder(a[0], b[0]))[0]![0];
  const phrases = [...phraseMap.values()]
    .map((entry) => ({ category: entry.category, requirement: displayForm(entry.forms), opportunities: entry.jobs.size, otherwiseGood: entry.good.size }))
    .sort((a, b) => b.opportunities - a.opportunities || codePointOrder(foldText(a.requirement), foldText(b.requirement)) || codePointOrder(a.category, b.category))
    .slice(0, topPhraseCount);

  // Sources (first-discovery identity, Feature 15).
  const sourceRows = groupBy(applications, (view) => view.source).map(([key, list]): PaSourceRow => {
    if (key === noSourceKey) return { ...outcomeRow(key, list), name: "No source record", group: "unknown" };
    const info = sourceInfoOf(key, facts.sources);
    return { ...outcomeRow(key, list), name: info.name, group: info.group };
  });
  const bySize = (a: PaSourceRow, b: PaSourceRow) => b.applied - a.applied || codePointOrder(a.name, b.name);

  // Where applications are not progressing.
  const notProgressing: Array<{ dimension: string; key: string; label: string; mature: number }> = [];
  const check = (
    dimension: string,
    keyOf: (view: ApplicationView) => string,
    labelOf: (key: string) => string = (key) => key,
    population: readonly ApplicationView[] = applications,
  ) => {
    for (const [key, list] of groupBy(population, keyOf)) {
      const row = outcomeRow(key, list);
      if (row.mature >= notProgressingMinimum && row.interviews === 0) notProgressing.push({ dimension, key, label: labelOf(key), mature: row.mature });
    }
  };
  check("titleGroup", (view) => view.titleGroup);
  check("source", (view) => view.source, (key) => sourceRows.find((row) => row.key === key)?.name ?? key);
  check("arrangement", (view) => view.arrangement);
  check("seniority", (view) => view.seniority);
  // Customer segment is evaluated-only.
  check("customerSegment", (view) => view.latest!.customerSegment ?? unknownKey, undefined, evaluatedApplications);

  // Profile options.
  const evaluatedByProfile = new Map<string, number>();
  let notRecorded = 0;
  for (const view of evaluations) {
    if (view.evaluation.userProfileId) evaluatedByProfile.set(view.evaluation.userProfileId, (evaluatedByProfile.get(view.evaluation.userProfileId) ?? 0) + 1);
    else notRecorded += 1;
  }
  const selected = selectedId ? profiles.get(selectedId) ?? null : null;
  const dimensionRows = (keyOf: (view: ApplicationView) => string, order: readonly string[]) =>
    groupBy(applications, keyOf, order).map(([key, list]) => outcomeRow(key, list));
  const evaluatedRows = (keyOf: (evaluation: PaEvaluationFact) => string | null, order: readonly string[]) =>
    groupBy(evaluatedApplications, (view) => keyOf(view.latest!) ?? unknownKey, order).map(([key, list]) => outcomeRow(key, list));

  return {
    version: personalAnalyticsVersion,
    window: { key: window.key, from: window.from?.toISOString() ?? null, to: window.to.toISOString() },
    filters,
    titleGroups: titleOrder,
    timeZone,
    notes: { outcomes: outcomeDisclosure, versions: versionDisclosure, gaps: gapGroupingDisclosure },
    profile: {
      selected: {
        id: selected?.id ?? null,
        label: selected?.label ?? null,
        version: selected?.version ?? null,
        active: Boolean(selected && selected.id === facts.activeProfileId),
        notRecorded: notRecordedSelected,
      },
      options: facts.profiles
        .map((profile) => ({ id: profile.id, label: profile.label, version: profile.version, active: profile.id === facts.activeProfileId, evaluated: evaluatedByProfile.get(profile.id) ?? 0 }))
        .sort((a, b) => codePointOrder(a.label, b.label) || b.version - a.version),
      notRecorded,
    },
    overview: {
      applied: total.applied,
      mature: total.mature,
      awaitingResponse: total.awaitingResponse,
      inProcess: total.inProcess,
      interviews: total.interviews,
      interviewRate: total.interviewRate,
      offers: total.offers,
      offerRate: total.offerRate,
      interviewToOffer: siRate(concluded.filter((view) => view.outcome.offer).length, concluded.length),
      evaluated: evaluations.length,
      applicationsWithRecommendation: siRate(withRecommendation, applications.length),
    },
    funnels: {
      applications: {
        applied: applications.length,
        anyInterview: applications.filter((view) => view.outcome.interview).length,
        recruiterScreen: applications.filter((view) => view.outcome.recruiterScreen).length,
        beyondScreening: applications.filter((view) => view.outcome.beyondScreening).length,
        finalRound: applications.filter((view) => view.outcome.finalRound).length,
        offers: applications.filter((view) => view.outcome.offer).length,
        awaitingResponse: total.awaitingResponse,
        inProcess: total.inProcess,
        closed,
      },
      evaluated: { evaluated: evaluations.length, decisions, recommendedNotApplied },
      byRecommendationAtApplication: dimensionRows((view) => view.recommendation, recommendationAtApplicationStates),
    },
    roles: { rows: roleRows, byRoleClassification: evaluatedRows((evaluation) => evaluation.roleClassification, roleClassOrder) },
    fitOutcomes: {
      resumeMatchBand: groupBy(creditedInFit, (view) => view.creditedEvaluation!.resumeMatch?.band ?? unknownKey, resumeMatchBands).map(([key, list]) => outcomeRow(key, list)),
      alexFit: groupBy(creditedWithAlexFit, (view) => view.creditedEvaluation!.alexFit!, alexFitClasses).map(([key, list]) => outcomeRow(key, list)),
      credited: creditedInFit.length,
      applied: applications.length,
    },
    gaps: {
      evaluated: fitCohort.length,
      otherwiseGood: goodCount,
      versions: [...versionCounts.values()]
        .sort((a, b) => b.evaluated - a.evaluated || Number(a.version === null) - Number(b.version === null) || codePointOrder(a.version ?? "", b.version ?? ""))
        .map((entry) => ({ ...entry, included: entry.group === selectedGroup })),
      reason: gapReason,
      categories,
      phrases,
    },
    sources: {
      automated: sourceRows.filter((row) => row.group === "automated").sort(bySize),
      userCollected: sourceRows.filter((row) => row.group === "user-collected").sort(bySize),
      unknown: sourceRows.find((row) => row.group === "unknown") ?? null,
    },
    notProgressing: { groups: notProgressing, recommendedNotApplied },
    companyType: {
      evaluatedApplied: evaluatedApplications.length,
      segment: evaluatedRows((evaluation) => evaluation.customerSegment, segmentOrder),
      customerType: evaluatedRows((evaluation) => evaluation.customerType, customerTypeOrder),
    },
    outcomesBy: {
      titleGroup: dimensionRows((view) => view.titleGroup, titleOrder),
      arrangement: dimensionRows((view) => view.arrangement, arrangementKeys),
      seniority: dimensionRows((view) => view.seniority, seniorityKeys),
    },
  };
}
