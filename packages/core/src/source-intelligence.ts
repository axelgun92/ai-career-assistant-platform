import { aiBudgetLimitReason, normalizeDeferralReason, usageLimitReachedReason } from "./budget";
import { isUnitedStatesGeography, readLocationGeography } from "./geography";
import { knownSiteByKey, knownSiteForUrl } from "./known-sites";
import { classifyRunOutcome } from "./retrieval-health";
import type { SourceCategory } from "./retrieval";
import type { RetrievalRunStatusValue } from "./retrieval-health";

// Source Intelligence (feature 15): measurable evidence of what each
// discovery source contributes. Pure definitions over facts the repository
// reads; nothing here queries, writes, evaluates or estimates.
//
// The rules (CS PRD v1.13 §19, approved October 31, 2026):
// - A listing is a SourceRecord chain head (its first version). Each belongs to
//   one source identity: a configured retrieval source, the browser extension
//   for one captured site, or manual entry. A configured source that saw a
//   listing already stored by another source of the same adapter writes no
//   SourceRecord (re-observation), so its feature 13 ledger row counts as its
//   listing instead. No record is ever manufactured.
// - First-discovery credit: an opportunity's discovering source is its
//   earliest listing by (createdAt, id). Its new-opportunity credit,
//   evaluation cost and outcomes go there and nowhere else, so totals never
//   double count. Every other source that listed it has presence ("also
//   listed"), shown separately and never summed into totals. A later employer
//   ATS or canonical-link change never moves credit.
// - Only completed evaluations enter quality ratios. Budget or usage-limit
//   deferral, queued or running evaluation, a failed evaluation, a user's
//   dismissal, a listing gone before evaluation, or no evaluation yet are
//   neutral states, counted and shown, never negative evidence.
// - No verdicts: every figure carries its sample size and label.

export const sourceIntelligenceVersion = "source-intelligence-v1";

export const outcomeMaturityDays = 30;
export const coDiscoveryWindowMinutes = 60;
export const insufficientSampleBelow = 5;
export const smallSampleBelow = 20;
const maxTrendWeeks = 26;
const maxDetailOpportunities = 200;

export const usefulDecisions = ["APPLY", "REVIEW"] as const;
const recommendationDecisions = new Set(["APPLY", "REVIEW", "SKIP"]);

// ---------------------------------------------------------------------------
// Input facts (read by the repository; plain values only)

export type SiDuplicateDecision = "MATCH" | "PROBABLE_MATCH" | "NO_MATCH";
export type SiLedgerState = "HISTORICAL" | "LISTED" | "MISSING" | "REMOVED" | "UNTRACKED";
export type SiEvaluationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface SiSourceDescriptor {
  id: string;
  name: string;
  adapterKey: string;
  category: SourceCategory;
  enabled: boolean;
  archived: boolean;
}

// One SourceRecord chain head (previousSourceRecordId IS NULL).
export interface SiListingFact {
  recordId: string;
  opportunityId: string | null;
  source: string;
  sourceType: string;
  sourceCategory: SourceCategory | null;
  retrievalSourceId: string | null;
  captureSite: string | null;
  externalId: string | null;
  duplicateDecision: SiDuplicateDecision | null;
  sourceUrl: string | null;
  applicationUrl: string | null;
  createdAt: Date;
}

// One feature 13 ledger row (any tracking scope).
export interface SiLedgerFact {
  retrievalSourceId: string;
  externalId: string;
  opportunityId: string | null;
  firstSeenAt: Date;
  state: SiLedgerState;
}

export interface SiEvaluationFact {
  id: string;
  status: SiEvaluationStatus;
  createdAt: Date;
  completedAt: Date | null;
  decision: string | null;
  // Spend in the report currency from attempts that recorded a cost in it;
  // attempts without one are counted, never priced at zero.
  knownCost: number;
  unknownCostAttempts: number;
}

export interface SiApplicationFact {
  stage: string;
  outcome: string | null;
  appliedOn: Date | null;
  createdAt: Date;
  events: Array<{ type: string; toStage: string | null; outcome: string | null; at: Date }>;
  interviews: Array<{ status: string; at: Date }>;
}

export interface SiOpportunityFact {
  id: string;
  title: string | null;
  company: string | null;
  status: string;
  createdAt: Date;
  canonicalUrl: string | null;
  applicationUrl: string | null;
  atsPlatform: string | null;
  location: string | null;
  remoteStatus: string | null;
  workArrangements: string[];
  residencyRegions: string[];
  workAuthorizationRegions: string[];
  evaluations: SiEvaluationFact[];
  // Normalized reason of the open (DEFERRED) deferral, if any.
  openDeferralReason: string | null;
  // Earliest lifecycle MARK_APPLIED action, if any.
  markedAppliedAt: Date | null;
  application: SiApplicationFact | null;
  // The newer side of an unresolved PROBABLE_MATCH pair (its arrival raised
  // the possible duplicate), so each pair counts once.
  probableUnresolved: boolean;
  noLongerListed: boolean;
}

export interface SiRunFact {
  retrievalSourceId: string;
  createdAt: Date;
  status: RetrievalRunStatusValue;
  errorCode: string | null;
  fetched: number | null;
  keptByTerms: number | null;
}

export interface SiFacts {
  sources: SiSourceDescriptor[];
  listings: SiListingFact[];
  ledger: SiLedgerFact[];
  opportunities: SiOpportunityFact[];
  runs: SiRunFact[];
  // Ledger rows without an opportunity: titles found but details not yet read.
  pendingDetails: Array<{ retrievalSourceId: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Windows

export type SiWindowKey = "7d" | "30d" | "90d" | "all" | "custom";

export interface SiWindow {
  key: SiWindowKey;
  // Inclusive start, exclusive end; from null means all time.
  from: Date | null;
  to: Date;
}

const dayMs = 24 * 60 * 60 * 1000;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export class SourceInsightsWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceInsightsWindowError";
  }
}

// window=7d|30d|90d|all (default 30d), or custom with from and to as UTC
// dates (YYYY-MM-DD, both inclusive).
export function parseInsightsWindow(
  input: { window?: string | null; from?: string | null; to?: string | null },
  now: Date,
): SiWindow {
  const key = (input.window ?? "30d").trim() || "30d";
  if (key === "all") return { key, from: null, to: now };
  const days = { "7d": 7, "30d": 30, "90d": 90 }[key];
  if (days) return { key: key as SiWindowKey, from: new Date(now.getTime() - days * dayMs), to: now };
  if (key !== "custom") throw new SourceInsightsWindowError("window must be one of 7d, 30d, 90d, all or custom");
  const from = input.from?.trim();
  const to = input.to?.trim();
  if (!from || !to || !isoDate.test(from) || !isoDate.test(to)) {
    throw new SourceInsightsWindowError("A custom window needs from and to dates (YYYY-MM-DD)");
  }
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + dayMs);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new SourceInsightsWindowError("A custom window's from date must be on or before its to date");
  }
  return { key: "custom", from: start, to: end };
}

const inWindow = (window: SiWindow, at: Date) => (!window.from || at >= window.from) && at < window.to;

// ---------------------------------------------------------------------------
// Rates and sample labels

// none: no denominator. insufficient: n < 5 (shown, labelled, never used to
// compare). small: 5–19. normal: 20 or more.
export type SiSample = "none" | "insufficient" | "small" | "normal";

export interface SiRate {
  numerator: number;
  denominator: number;
  value: number | null;
  sample: SiSample;
}

export function sampleLabel(n: number): SiSample {
  if (n <= 0) return "none";
  if (n < insufficientSampleBelow) return "insufficient";
  if (n < smallSampleBelow) return "small";
  return "normal";
}

export function siRate(numerator: number, denominator: number): SiRate {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? numerator / denominator : null,
    sample: sampleLabel(denominator),
  };
}

// ---------------------------------------------------------------------------
// Source identity

export type SiSourceGroup = "automated" | "user-collected";
export type SiSourceKind = "configured" | "adapter" | "extension" | "manual";
export type SiGroupBy = "source" | "adapter";

export const manualIdentity = "manual";
const extensionSourceKey = "browser-extension";

export function captureSiteOf(listing: Pick<SiListingFact, "captureSite" | "externalId">): string {
  if (listing.captureSite) return listing.captureSite;
  const prefix = listing.externalId?.split(":")[0];
  return prefix || "unknown";
}

// The source identity a listing belongs to (D4): its configured retrieval
// source; the browser extension for one captured site; manual entry; or, for
// an automated record without a configured source, its adapter.
export function listingIdentity(listing: SiListingFact): string {
  if (listing.retrievalSourceId) return `source:${listing.retrievalSourceId}`;
  if (listing.source === extensionSourceKey) return `extension:${captureSiteOf(listing)}`;
  if (listing.sourceType === "MANUAL") return manualIdentity;
  return `adapter:${listing.source}`;
}

const configuredIdentity = (retrievalSourceId: string) => `source:${retrievalSourceId}`;

function groupedIdentity(identity: string, groupBy: SiGroupBy, sources: Map<string, SiSourceDescriptor>): string {
  if (groupBy !== "adapter" || !identity.startsWith("source:")) return identity;
  const source = sources.get(identity.slice("source:".length));
  return source ? `adapter:${source.adapterKey}` : identity;
}

export interface SiSourceInfo {
  key: string;
  group: SiSourceGroup;
  kind: SiSourceKind;
  name: string;
  adapterKey: string | null;
  category: SourceCategory | null;
  retrievalSourceId: string | null;
  // Configured sources grouped into an adapter row.
  memberSourceIds: string[];
  enabled: boolean | null;
  archived: boolean | null;
  captureSite: string | null;
}

const siteName = (key: string) => knownSiteByKey(key)?.name ?? key;

function describeIdentity(identity: string, sources: Map<string, SiSourceDescriptor>, all: SiSourceDescriptor[]): SiSourceInfo {
  if (identity.startsWith("source:")) {
    const id = identity.slice("source:".length);
    const source = sources.get(id);
    return {
      key: identity,
      group: "automated",
      kind: "configured",
      name: source?.name ?? "Removed source",
      adapterKey: source?.adapterKey ?? null,
      category: source?.category ?? null,
      retrievalSourceId: id,
      memberSourceIds: [id],
      enabled: source?.enabled ?? null,
      archived: source?.archived ?? null,
      captureSite: null,
    };
  }
  if (identity.startsWith("adapter:")) {
    const adapterKey = identity.slice("adapter:".length);
    const members = all.filter((source) => source.adapterKey === adapterKey);
    return {
      key: identity,
      group: "automated",
      kind: "adapter",
      name: siteName(adapterKey),
      adapterKey,
      category: members[0]?.category ?? knownSiteByKey(adapterKey)?.category ?? null,
      retrievalSourceId: null,
      memberSourceIds: members.map((source) => source.id),
      enabled: members.length ? members.some((source) => source.enabled) : null,
      archived: members.length ? members.every((source) => source.archived) : null,
      captureSite: null,
    };
  }
  if (identity.startsWith("extension:")) {
    const site = identity.slice("extension:".length);
    return {
      key: identity,
      group: "user-collected",
      kind: "extension",
      name: `Browser extension · ${siteName(site)}`,
      adapterKey: extensionSourceKey,
      category: knownSiteByKey(site)?.category ?? "AGGREGATOR",
      retrievalSourceId: null,
      memberSourceIds: [],
      enabled: null,
      archived: null,
      captureSite: site,
    };
  }
  return {
    key: manualIdentity,
    group: "user-collected",
    kind: "manual",
    name: "Manual entry",
    adapterKey: null,
    category: null,
    retrievalSourceId: null,
    memberSourceIds: [],
    enabled: null,
    archived: null,
    captureSite: null,
  };
}

// A source identity's display information (Feature 17 shows personal
// outcomes by the same first-discovery identity).
export function sourceInfoOf(identity: string, sources: readonly SiSourceDescriptor[]): SiSourceInfo {
  return describeIdentity(identity, new Map(sources.map((source) => [source.id, source])), [...sources]);
}

// ---------------------------------------------------------------------------
// Per-opportunity derivations

export type SiEvaluationState =
  | "evaluated"
  | "completed_without_recommendation"
  | "in_progress"
  | "waiting_budget"
  | "waiting_usage_limit"
  | "failed"
  | "user_dismissed"
  | "no_longer_listed"
  | "not_yet_evaluated";

export const evaluationStateOrder: readonly SiEvaluationState[] = [
  "evaluated",
  "completed_without_recommendation",
  "in_progress",
  "waiting_budget",
  "waiting_usage_limit",
  "failed",
  "user_dismissed",
  "no_longer_listed",
  "not_yet_evaluated",
];

const byTimeThenId = <T extends { createdAt: Date; id: string }>(a: T, b: T) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The opportunity's evaluation state now, in precedence order. Only
// "evaluated" (a completed evaluation with a recommendation) enters quality
// ratios; every other state is neutral.
// (Feature 16 reads the same states, so only the fields it needs are required.)
export interface SiEvaluationStateInput {
  status: string;
  evaluations: ReadonlyArray<Pick<SiEvaluationFact, "id" | "status" | "createdAt" | "completedAt" | "decision">>;
  openDeferralReason: string | null;
  noLongerListed: boolean;
}

export function evaluationStateOf(opportunity: SiEvaluationStateInput): { state: SiEvaluationState; decision: string | null } {
  const completed = opportunity.evaluations
    .filter((evaluation) => evaluation.status === "COMPLETED")
    .sort((a, b) => (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime() || byTimeThenId(b, a));
  const latest = completed[0];
  if (latest) {
    return latest.decision && recommendationDecisions.has(latest.decision)
      ? { state: "evaluated", decision: latest.decision }
      : { state: "completed_without_recommendation", decision: null };
  }
  if (opportunity.evaluations.some((evaluation) => evaluation.status === "PENDING" || evaluation.status === "RUNNING")) {
    return { state: "in_progress", decision: null };
  }
  const deferral = opportunity.openDeferralReason ? normalizeDeferralReason(opportunity.openDeferralReason) : null;
  if (deferral === aiBudgetLimitReason) return { state: "waiting_budget", decision: null };
  if (deferral === usageLimitReachedReason) return { state: "waiting_usage_limit", decision: null };
  if (deferral) return { state: "waiting_budget", decision: null };
  if (opportunity.evaluations.some((evaluation) => evaluation.status === "FAILED")) return { state: "failed", decision: null };
  if (opportunity.status === "REJECTED_BY_USER" || opportunity.status === "ARCHIVED") return { state: "user_dismissed", decision: null };
  if (opportunity.noLongerListed) return { state: "no_longer_listed", decision: null };
  return { state: "not_yet_evaluated", decision: null };
}

const interviewStages = new Set(["SCREENING", "INTERVIEWING", "FINAL_ROUND", "OFFER"]);
const offerOutcomes = new Set(["OFFER_ACCEPTED", "OFFER_DECLINED"]);

export interface SiOutcome {
  applied: boolean;
  appliedAt: Date | null;
  interview: boolean;
  interviewAt: Date | null;
  offer: boolean;
  offerAt: Date | null;
  closed: boolean;
  // Applied under 30 days ago, not progressed and not closed: not yet
  // evidence of "no interview" or "no offer".
  awaitingResponse: boolean;
}

const earliest = (dates: Array<Date | null | undefined>) =>
  dates.filter((date): date is Date => date instanceof Date).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

// Application outcomes, once per opportunity (D5). An application is the
// tracker's submitted application, or a lifecycle "Mark as applied" without
// one; both together count once. An interview is reaching SCREENING or later,
// or any interview not cancelled (recruiter screens included); an offer is
// reaching OFFER or an offer outcome.
// (Feature 17 reads the same outcomes, so only the fields it needs are required.)
export type SiOutcomeInput = Pick<SiOpportunityFact, "application" | "markedAppliedAt">;

export function outcomeOf(opportunity: SiOutcomeInput, now: Date): SiOutcome {
  const application = opportunity.application;
  const events = application?.events ?? [];
  const submittedEvent = earliest(events.filter((event) => event.type === "SUBMITTED").map((event) => event.at));
  const notSubmitted = application?.outcome === "NOT_SUBMITTED";
  const trackedApplied = Boolean(application && !notSubmitted && (application.appliedOn || application.stage !== "PLANNED" || submittedEvent));
  const marked = notSubmitted ? null : opportunity.markedAppliedAt;
  const trackedAt = trackedApplied ? earliest([application?.appliedOn, submittedEvent]) ?? application?.createdAt ?? null : null;
  const appliedAt = earliest([trackedAt, marked]);
  const applied = trackedApplied || marked !== null;
  const interviewDates = [
    ...events.filter((event) => event.toStage && interviewStages.has(event.toStage)).map((event) => event.at),
    ...(application?.interviews ?? []).filter((interview) => interview.status !== "CANCELLED").map((interview) => interview.at),
  ];
  const interview = interviewDates.length > 0 || Boolean(application && interviewStages.has(application.stage));
  const offerDates = events
    .filter((event) => event.toStage === "OFFER" || (event.outcome !== null && offerOutcomes.has(event.outcome)))
    .map((event) => event.at);
  const offer = offerDates.length > 0 || application?.stage === "OFFER" || Boolean(application?.outcome && offerOutcomes.has(application.outcome));
  const closed = Boolean(application && (application.stage === "CLOSED" || (application.outcome && !notSubmitted)));
  const progressed = interview || offer;
  const awaitingResponse =
    applied && !progressed && !closed && appliedAt !== null && now.getTime() - appliedAt.getTime() < outcomeMaturityDays * dayMs;
  return {
    // Reaching an interview or offer implies the application was submitted.
    applied: applied || progressed,
    appliedAt: appliedAt ?? (progressed ? application?.createdAt ?? null : null),
    interview: progressed,
    interviewAt: progressed ? earliest(interviewDates) ?? earliest(offerDates) ?? application?.createdAt ?? null : null,
    offer,
    offerAt: offer ? earliest(offerDates) ?? application?.createdAt ?? null : null,
    closed,
    awaitingResponse,
  };
}

export interface SiCost {
  completed: number;
  failed: number;
  other: number;
  completedUnknownAttempts: number;
  failedUnknownAttempts: number;
  otherUnknownAttempts: number;
}

export function costOf(opportunity: SiOpportunityFact): SiCost {
  const cost: SiCost = { completed: 0, failed: 0, other: 0, completedUnknownAttempts: 0, failedUnknownAttempts: 0, otherUnknownAttempts: 0 };
  for (const evaluation of opportunity.evaluations) {
    if (evaluation.status === "COMPLETED") {
      cost.completed += evaluation.knownCost;
      cost.completedUnknownAttempts += evaluation.unknownCostAttempts;
    } else if (evaluation.status === "FAILED") {
      cost.failed += evaluation.knownCost;
      cost.failedUnknownAttempts += evaluation.unknownCostAttempts;
    } else {
      cost.other += evaluation.knownCost;
      cost.otherUnknownAttempts += evaluation.unknownCostAttempts;
    }
  }
  return cost;
}

// Geographic coverage buckets (D7). Multi-valued: an opportunity open to
// several regions counts in each, so bucket shares may sum to more than 100%.
export const geographyBuckets = [
  "UNITED_STATES",
  "CANADA",
  "UNITED_KINGDOM",
  "EUROPE",
  "LATIN_AMERICA",
  "APAC",
  "GLOBAL",
  "OTHER",
  "UNKNOWN",
] as const;
export type SiGeographyBucket = (typeof geographyBuckets)[number];

const europeCountries = new Set(["IE", "ES", "PT", "FR", "DE", "NL", "BE", "IT", "PL", "SE", "NO", "DK", "FI", "CH", "AT", "GR", "RO", "CZ", "HU", "UA"]);
const latinAmericaCountries = new Set(["MX", "BR", "AR", "CO", "CL", "PE"]);
const apacCountries = new Set(["IN", "PH", "SG", "JP", "AU", "NZ"]);

// One geography code's bucket. Broad multi-continent designations (EMEA,
// North America, Americas) are not split into regions they may or may not
// include: they count as Other. "Europe", "EU" and "EEA" never imply the UK.
export function geographyBucketOf(code: string): SiGeographyBucket {
  if (isUnitedStatesGeography(code)) return "UNITED_STATES";
  if (code === "CA" || code.startsWith("CA-")) return "CANADA";
  if (code === "GB" || code.startsWith("GB-")) return "UNITED_KINGDOM";
  if (code === "WORLDWIDE") return "GLOBAL";
  if (code === "EU" || code === "EEA" || code === "EUROPE" || europeCountries.has(code)) return "EUROPE";
  if (code === "LATAM" || latinAmericaCountries.has(code)) return "LATIN_AMERICA";
  if (code === "APAC" || apacCountries.has(code)) return "APAC";
  return "OTHER";
}

const globalRemoteText = /\b(?:anywhere|worldwide|global(?:ly)?|work from anywhere)\b/i;

// The opportunity's geography buckets from stated, normalized evidence in
// precedence order: residency/eligibility regions, then work-authorization
// regions, then the location's geography (an unreadable or ambiguous location
// is not guessed), then explicit global-remote wording. Nothing stated:
// UNKNOWN, which stays in every denominator.
export function geographyOf(opportunity: SiOpportunityFact): SiGeographyBucket[] {
  const fromCodes = (codes: readonly string[]) => [...new Set(codes.map(geographyBucketOf))];
  if (opportunity.residencyRegions.length) return fromCodes(opportunity.residencyRegions);
  if (opportunity.workAuthorizationRegions.length) return fromCodes(opportunity.workAuthorizationRegions);
  const location = readLocationGeography(opportunity.location);
  if (location.codes.length && !location.ambiguous) return fromCodes(location.codes);
  const remote = opportunity.remoteStatus === "REMOTE" || opportunity.workArrangements.includes("REMOTE");
  if (remote && opportunity.location && globalRemoteText.test(opportunity.location)) return ["GLOBAL"];
  return ["UNKNOWN"];
}

const directAtsCategories = new Set<SourceCategory>(["ATS", "COMPANY_CAREERS"]);

// The employer ATS behind an opportunity (D8): direct employer-ATS
// provenance (a listing from an ATS or careers-site source, automated or
// captured), else the stored ATS platform, else the shared known-site table
// applied to its application and canonical links and its listings' links.
export function atsOf(
  opportunity: SiOpportunityFact,
  listings: readonly SiListingFact[],
  ledgerSources: readonly SiSourceDescriptor[],
): { platform: string | null; direct: string[] } {
  const direct = new Set<string>();
  for (const listing of listings) {
    if (listing.sourceCategory && directAtsCategories.has(listing.sourceCategory)) {
      direct.add(listing.source === extensionSourceKey ? captureSiteOf(listing) : listing.source);
    }
  }
  for (const source of ledgerSources) if (directAtsCategories.has(source.category)) direct.add(source.adapterKey);
  const [first] = [...direct].sort();
  if (first) return { platform: first, direct: [...direct].sort() };
  if (opportunity.atsPlatform) return { platform: opportunity.atsPlatform, direct: [] };
  const links = [
    opportunity.applicationUrl,
    opportunity.canonicalUrl,
    ...listings.flatMap((listing) => [listing.applicationUrl, listing.sourceUrl]),
  ];
  for (const link of links) {
    const site = knownSiteForUrl(link);
    if (site && site.category === "ATS") return { platform: site.key, direct: [] };
  }
  return { platform: null, direct: [] };
}

// ---------------------------------------------------------------------------
// Assembly

interface ListingUnit {
  identity: string;
  opportunityId: string | null;
  at: Date;
  via: "record" | "ledger";
  recordId: string | null;
  duplicateDecision: SiDuplicateDecision | null;
  externalId: string | null;
}

interface OpportunityView {
  fact: SiOpportunityFact;
  originIdentity: string | null;
  originAt: Date;
  // identity → earliest presence (records and ledger)
  presence: Map<string, Date>;
  heads: SiListingFact[];
  ledger: SiLedgerFact[];
  evaluation: { state: SiEvaluationState; decision: string | null };
  outcome: SiOutcome;
  cost: SiCost;
  geography: SiGeographyBucket[];
  ats: { platform: string | null; direct: string[] };
}

function buildUnits(facts: SiFacts): ListingUnit[] {
  const units: ListingUnit[] = facts.listings.map((listing) => ({
    identity: listingIdentity(listing),
    opportunityId: listing.opportunityId,
    at: listing.createdAt,
    via: "record",
    recordId: listing.recordId,
    duplicateDecision: listing.duplicateDecision,
    externalId: listing.externalId,
  }));
  // A configured source's ledger sighting with no record of its own for that
  // listing: the listing was already stored by another source of the same
  // adapter, so re-observation wrote nothing. One unit per (source, listing).
  const recorded = new Set(
    facts.listings.filter((listing) => listing.retrievalSourceId && listing.externalId).map((listing) => `${listing.retrievalSourceId}|${listing.externalId}`),
  );
  const ledgerUnits = new Map<string, ListingUnit>();
  for (const row of facts.ledger) {
    if (!row.opportunityId) continue;
    const key = `${row.retrievalSourceId}|${row.externalId}`;
    if (recorded.has(key)) continue;
    const existing = ledgerUnits.get(key);
    if (existing && existing.at <= row.firstSeenAt) continue;
    ledgerUnits.set(key, {
      identity: configuredIdentity(row.retrievalSourceId),
      opportunityId: row.opportunityId,
      at: row.firstSeenAt,
      via: "ledger",
      recordId: null,
      duplicateDecision: null,
      externalId: row.externalId,
    });
  }
  return [...units, ...ledgerUnits.values()];
}

function buildOpportunityViews(facts: SiFacts, now: Date): Map<string, OpportunityView> {
  const sourcesById = new Map(facts.sources.map((source) => [source.id, source]));
  const headsByOpportunity = new Map<string, SiListingFact[]>();
  for (const listing of facts.listings) {
    if (!listing.opportunityId) continue;
    const list = headsByOpportunity.get(listing.opportunityId) ?? [];
    list.push(listing);
    headsByOpportunity.set(listing.opportunityId, list);
  }
  const ledgerByOpportunity = new Map<string, SiLedgerFact[]>();
  for (const row of facts.ledger) {
    if (!row.opportunityId) continue;
    const list = ledgerByOpportunity.get(row.opportunityId) ?? [];
    list.push(row);
    ledgerByOpportunity.set(row.opportunityId, list);
  }
  const views = new Map<string, OpportunityView>();
  for (const fact of facts.opportunities) {
    const heads = (headsByOpportunity.get(fact.id) ?? []).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0),
    );
    const ledger = ledgerByOpportunity.get(fact.id) ?? [];
    const presence = new Map<string, Date>();
    const note = (identity: string, at: Date) => {
      const current = presence.get(identity);
      if (!current || at < current) presence.set(identity, at);
    };
    heads.forEach((head) => note(listingIdentity(head), head.createdAt));
    ledger.forEach((row) => note(configuredIdentity(row.retrievalSourceId), row.firstSeenAt));
    const origin = heads[0];
    const ledgerSources = [...new Set(ledger.map((row) => row.retrievalSourceId))]
      .map((id) => sourcesById.get(id))
      .filter((source): source is SiSourceDescriptor => Boolean(source));
    views.set(fact.id, {
      fact,
      originIdentity: origin ? listingIdentity(origin) : null,
      originAt: origin?.createdAt ?? fact.createdAt,
      presence,
      heads,
      ledger,
      evaluation: evaluationStateOf(fact),
      outcome: outcomeOf(fact, now),
      cost: costOf(fact),
      geography: geographyOf(fact),
      ats: atsOf(fact, heads, ledgerSources),
    });
  }
  return views;
}

// ---------------------------------------------------------------------------
// Output

export interface SiDiscoveryMetrics {
  // Listing units in the window: records plus ledger-only sightings.
  listings: number;
  // This source's listing created the opportunity (first discovery).
  new: number;
  // Attached to an opportunity that already existed when this listing arrived.
  alreadyKnown: number;
  // Of alreadyKnown: the opportunity already had a listing from this same source.
  repostOnSameSource: number;
  // New opportunities from this source with an unresolved probable duplicate.
  possibleDuplicates: number;
  // Records whose normalization failed (kept unlinked): operational, not quality.
  notProcessed: number;
  // Already known on arrival ÷ listings.
  duplicateRate: SiRate;
  // Distinct opportunities this source listed in the window.
  discovered: number;
  // Of discovered: no other source has ever listed it (as of now).
  exclusive: number;
}

export interface SiEvaluationMetrics {
  cohort: number;
  states: Record<SiEvaluationState, number>;
  evaluated: number;
  apply: number;
  review: number;
  skip: number;
  useful: number;
  usefulRate: SiRate;
  applyRate: SiRate;
  coverage: SiRate;
}

export interface SiOutcomeMetrics {
  applications: number;
  interviews: number;
  offers: number;
  awaitingResponse: number;
  // Applications past the maturity window or already progressed/closed.
  matureApplications: number;
  interviewRate: SiRate;
  offerRate: SiRate;
  // Outcomes credited to other sources where this source had listed the job
  // before the outcome (presence, never added to this source's totals).
  alsoListedBefore: { applications: number; interviews: number; offers: number };
}

export interface SiCostMetrics {
  currency: string | null;
  completedSpend: number;
  failedSpend: number;
  otherSpend: number;
  totalSpend: number;
  completedUnknownAttempts: number;
  unknownAttempts: number;
  // completedSpend ÷ useful; null with a note when not computable.
  costPerUseful: number | null;
  costPerUsefulNote: "no_useful_jobs" | "no_currency" | null;
  incomplete: boolean;
}

export interface SiReliability {
  runs: number;
  successfulRuns: number;
  sourceFailures: number;
  neutralRuns: number;
  successRate: SiRate;
  lastListingsScanned: number | null;
  roleFamilyYield: number | null;
  pendingDetails: number;
}

export type SiNote =
  | "no_runs_in_window"
  | "no_successful_retrieval_in_window"
  | "waiting_for_details"
  | "cost_incomplete"
  | "no_useful_jobs_yet"
  | "selection_biased"
  | "awaiting_outcomes";

export interface SiSourceMetrics extends SiSourceInfo {
  discovery: SiDiscoveryMetrics;
  evaluation: SiEvaluationMetrics;
  outcomes: SiOutcomeMetrics;
  cost: SiCostMetrics;
  reliability: SiReliability | null;
  geography: { denominator: number; buckets: Record<SiGeographyBucket, number> };
  ats: { denominator: number; known: number; platforms: Record<string, number>; directShare: SiRate };
  notes: SiNote[];
}

export interface SiPlatformSummary {
  listings: number;
  discovered: number;
  new: number;
  possibleDuplicates: number;
  duplicateRate: SiRate;
  evaluation: SiEvaluationMetrics;
  outcomes: Omit<SiOutcomeMetrics, "alsoListedBefore">;
  cost: SiCostMetrics;
  unattributed: number;
  atsCoverage: Array<{ platform: string; name: string; known: number; direct: number; directShare: SiRate }>;
}

export interface SourceInsights {
  version: string;
  window: SiWindow;
  groupBy: SiGroupBy;
  generatedAt: Date;
  currency: string | null;
  automated: SiSourceMetrics[];
  userCollected: SiSourceMetrics[];
  platform: SiPlatformSummary;
  historyStartsAt: Date | null;
}

const emptyStates = (): Record<SiEvaluationState, number> =>
  Object.fromEntries(evaluationStateOrder.map((state) => [state, 0])) as Record<SiEvaluationState, number>;
const emptyBuckets = (): Record<SiGeographyBucket, number> =>
  Object.fromEntries(geographyBuckets.map((bucket) => [bucket, 0])) as Record<SiGeographyBucket, number>;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

function evaluationMetrics(views: readonly OpportunityView[], discovered: number): SiEvaluationMetrics {
  const states = emptyStates();
  let apply = 0;
  let review = 0;
  let skip = 0;
  for (const view of views) {
    states[view.evaluation.state] += 1;
    if (view.evaluation.state !== "evaluated") continue;
    if (view.evaluation.decision === "APPLY") apply += 1;
    else if (view.evaluation.decision === "REVIEW") review += 1;
    else skip += 1;
  }
  const evaluated = apply + review + skip;
  return {
    cohort: views.length,
    states,
    evaluated,
    apply,
    review,
    skip,
    useful: apply + review,
    usefulRate: siRate(apply + review, evaluated),
    applyRate: siRate(apply, evaluated),
    coverage: siRate(evaluated, discovered),
  };
}

function outcomeCounts(views: readonly OpportunityView[]) {
  let applications = 0;
  let interviews = 0;
  let offers = 0;
  let awaitingResponse = 0;
  for (const view of views) {
    if (!view.outcome.applied) continue;
    applications += 1;
    if (view.outcome.interview) interviews += 1;
    if (view.outcome.offer) offers += 1;
    if (view.outcome.awaitingResponse) awaitingResponse += 1;
  }
  const matureApplications = applications - awaitingResponse;
  return {
    applications,
    interviews,
    offers,
    awaitingResponse,
    matureApplications,
    interviewRate: siRate(interviews, matureApplications),
    offerRate: siRate(offers, matureApplications),
  };
}

function costMetrics(views: readonly OpportunityView[], useful: number, currency: string | null): SiCostMetrics {
  const total = { completed: 0, failed: 0, other: 0, completedUnknown: 0, unknown: 0 };
  for (const view of views) {
    total.completed += view.cost.completed;
    total.failed += view.cost.failed;
    total.other += view.cost.other;
    total.completedUnknown += view.cost.completedUnknownAttempts;
    total.unknown += view.cost.completedUnknownAttempts + view.cost.failedUnknownAttempts + view.cost.otherUnknownAttempts;
  }
  const costPerUseful = currency && useful > 0 ? round(total.completed / useful) : null;
  return {
    currency,
    completedSpend: round(total.completed),
    failedSpend: round(total.failed),
    otherSpend: round(total.other),
    totalSpend: round(total.completed + total.failed + total.other),
    completedUnknownAttempts: total.completedUnknown,
    unknownAttempts: total.unknown,
    costPerUseful,
    costPerUsefulNote: !currency ? "no_currency" : useful === 0 ? "no_useful_jobs" : null,
    incomplete: total.completedUnknown > 0,
  };
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

function reliabilityOf(runs: readonly SiRunFact[], pendingDetails: number): SiReliability {
  const newestFirst = [...runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let successfulRuns = 0;
  let sourceFailures = 0;
  let neutralRuns = 0;
  const yields: number[] = [];
  let lastListingsScanned: number | null = null;
  for (const run of newestFirst) {
    const outcome = classifyRunOutcome(run);
    if (outcome === "success") {
      successfulRuns += 1;
      if (lastListingsScanned === null && run.fetched !== null) lastListingsScanned = run.fetched;
      if (run.fetched && run.keptByTerms !== null) yields.push(run.keptByTerms / run.fetched);
    } else if (outcome === "source_failure") sourceFailures += 1;
    else if (outcome === "neutral") neutralRuns += 1;
  }
  const yieldMedian = median(yields);
  return {
    runs: runs.length,
    successfulRuns,
    sourceFailures,
    neutralRuns,
    successRate: siRate(successfulRuns, successfulRuns + sourceFailures),
    lastListingsScanned,
    roleFamilyYield: yieldMedian === null ? null : round(yieldMedian),
    pendingDetails,
  };
}

export interface SourceInsightsInput {
  facts: SiFacts;
  window: SiWindow;
  groupBy?: SiGroupBy;
  currency: string | null;
  now: Date;
  includeArchived?: boolean;
}

interface Assembled {
  views: Map<string, OpportunityView>;
  units: ListingUnit[];
  sourcesById: Map<string, SiSourceDescriptor>;
  identityOf: (identity: string) => string;
}

function assemble(input: SourceInsightsInput): Assembled {
  const sourcesById = new Map(input.facts.sources.map((source) => [source.id, source]));
  const groupBy = input.groupBy ?? "source";
  return {
    views: buildOpportunityViews(input.facts, input.now),
    units: buildUnits(input.facts),
    sourcesById,
    identityOf: (identity) => groupedIdentity(identity, groupBy, sourcesById),
  };
}

function sourceMetrics(identity: string, input: SourceInsightsInput, assembled: Assembled): SiSourceMetrics {
  const { views, units, sourcesById, identityOf } = assembled;
  const info = describeIdentity(identity, sourcesById, input.facts.sources);
  const window = input.window;
  const mine = units.filter((unit) => identityOf(unit.identity) === identity && inWindow(window, unit.at));
  let notProcessed = 0;
  let isNew = 0;
  let alreadyKnown = 0;
  let repost = 0;
  let possibleDuplicates = 0;
  const discoveredIds = new Set<string>();
  for (const unit of mine) {
    if (!unit.opportunityId) {
      notProcessed += 1;
      continue;
    }
    const view = views.get(unit.opportunityId);
    if (!view) continue;
    discoveredIds.add(unit.opportunityId);
    const isOrigin = unit.via === "record" && view.heads[0]?.recordId === unit.recordId;
    if (isOrigin) {
      isNew += 1;
      if (view.fact.probableUnresolved) possibleDuplicates += 1;
      continue;
    }
    alreadyKnown += 1;
    const earlierFromSame = view.heads.some(
      (head) => head.recordId !== unit.recordId && identityOf(listingIdentity(head)) === identity && head.createdAt <= unit.at && head.externalId !== unit.externalId,
    );
    if (earlierFromSame) repost += 1;
  }
  const listingsCount = mine.length - notProcessed;
  const discovered = [...discoveredIds].map((id) => views.get(id)!).filter(Boolean);
  const exclusive = discovered.filter((view) => [...view.presence.keys()].every((key) => identityOf(key) === identity)).length;
  // Credited cohort: opportunities this source discovered first, in the window.
  const credited = [...views.values()].filter(
    (view) => view.originIdentity !== null && identityOf(view.originIdentity) === identity && inWindow(window, view.originAt),
  );
  const evaluation = evaluationMetrics(credited, credited.length);
  const outcomes = outcomeCounts(credited);
  // Presence before outcomes credited elsewhere.
  const alsoListedBefore = { applications: 0, interviews: 0, offers: 0 };
  for (const view of views.values()) {
    if (view.originIdentity !== null && identityOf(view.originIdentity) === identity) continue;
    const seen = [...view.presence.entries()].filter(([key]) => identityOf(key) === identity).map(([, at]) => at);
    const firstSeen = earliest(seen);
    if (!firstSeen || !inWindow(window, firstSeen)) continue;
    if (view.outcome.applied && view.outcome.appliedAt && firstSeen <= view.outcome.appliedAt) alsoListedBefore.applications += 1;
    if (view.outcome.interview && view.outcome.interviewAt && firstSeen <= view.outcome.interviewAt) alsoListedBefore.interviews += 1;
    if (view.outcome.offer && view.outcome.offerAt && firstSeen <= view.outcome.offerAt) alsoListedBefore.offers += 1;
  }
  const cost = costMetrics(credited, evaluation.useful, input.currency);
  const buckets = emptyBuckets();
  discovered.forEach((view) => view.geography.forEach((bucket) => (buckets[bucket] += 1)));
  const platforms: Record<string, number> = {};
  let atsKnown = 0;
  let atsDirect = 0;
  for (const view of discovered) {
    if (!view.ats.platform) continue;
    atsKnown += 1;
    platforms[view.ats.platform] = (platforms[view.ats.platform] ?? 0) + 1;
    if (view.ats.direct.length) atsDirect += 1;
  }
  let reliability: SiReliability | null = null;
  if (info.group === "automated" && info.memberSourceIds.length) {
    const members = new Set(info.memberSourceIds);
    const runs = input.facts.runs.filter((run) => members.has(run.retrievalSourceId) && inWindow(window, run.createdAt));
    const pending = input.facts.pendingDetails.filter((row) => members.has(row.retrievalSourceId)).reduce((sum, row) => sum + row.count, 0);
    reliability = reliabilityOf(runs, pending);
  }
  const notes: SiNote[] = [];
  if (info.group === "user-collected") notes.push("selection_biased");
  if (reliability) {
    if (reliability.runs === 0) notes.push("no_runs_in_window");
    else if (reliability.successfulRuns === 0) notes.push("no_successful_retrieval_in_window");
    if (reliability.pendingDetails > 0) notes.push("waiting_for_details");
  }
  if (cost.incomplete) notes.push("cost_incomplete");
  if (evaluation.evaluated > 0 && evaluation.useful === 0) notes.push("no_useful_jobs_yet");
  if (outcomes.awaitingResponse > 0) notes.push("awaiting_outcomes");
  return {
    ...info,
    discovery: {
      listings: listingsCount,
      new: isNew,
      alreadyKnown,
      repostOnSameSource: repost,
      possibleDuplicates,
      notProcessed,
      duplicateRate: siRate(alreadyKnown, listingsCount),
      discovered: discovered.length,
      exclusive,
    },
    evaluation,
    outcomes: { ...outcomes, alsoListedBefore },
    cost,
    reliability,
    geography: { denominator: discovered.length, buckets },
    ats: { denominator: discovered.length, known: atsKnown, platforms, directShare: siRate(atsDirect, atsKnown) },
    notes,
  };
}

function platformSummary(input: SourceInsightsInput, assembled: Assembled): SiPlatformSummary {
  const { views, units } = assembled;
  const window = input.window;
  const inWindowUnits = units.filter((unit) => unit.opportunityId && views.has(unit.opportunityId) && inWindow(window, unit.at));
  const discovered = new Set(inWindowUnits.map((unit) => unit.opportunityId!));
  // Cohort: opportunities first discovered in the window, plus (for all time)
  // any opportunity without a source record, so spend totals reconcile.
  const cohort = [...views.values()].filter((view) => inWindow(window, view.originAt));
  const credited = cohort.filter((view) => view.originIdentity !== null);
  const evaluation = evaluationMetrics(cohort, cohort.length);
  const outcomes = outcomeCounts(cohort);
  const ats = new Map<string, { known: number; direct: number }>();
  for (const id of discovered) {
    const view = views.get(id)!;
    if (!view.ats.platform) continue;
    const entry = ats.get(view.ats.platform) ?? { known: 0, direct: 0 };
    entry.known += 1;
    if (view.ats.direct.includes(view.ats.platform)) entry.direct += 1;
    ats.set(view.ats.platform, entry);
  }
  return {
    listings: inWindowUnits.length,
    discovered: discovered.size,
    new: credited.length,
    possibleDuplicates: credited.filter((view) => view.fact.probableUnresolved).length,
    duplicateRate: siRate(inWindowUnits.length - discovered.size, inWindowUnits.length),
    evaluation,
    outcomes,
    cost: costMetrics(cohort, evaluation.useful, input.currency),
    unattributed: cohort.length - credited.length,
    atsCoverage: [...ats.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([platform, entry]) => ({ platform, name: siteName(platform), known: entry.known, direct: entry.direct, directShare: siRate(entry.direct, entry.known) })),
  };
}

const byName = (a: SiSourceMetrics, b: SiSourceMetrics) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : 1);

export function buildSourceInsights(input: SourceInsightsInput): SourceInsights {
  const assembled = assemble(input);
  const groupBy = input.groupBy ?? "source";
  const identities = new Set<string>();
  // Every configured source appears (even with no listings yet), archived
  // ones only when asked for or when they hold evidence.
  for (const source of input.facts.sources) {
    if (source.archived && !input.includeArchived) continue;
    identities.add(assembled.identityOf(configuredIdentity(source.id)));
  }
  for (const unit of assembled.units) {
    const identity = assembled.identityOf(unit.identity);
    if (identity.startsWith("source:")) {
      const source = assembled.sourcesById.get(identity.slice("source:".length));
      if (source?.archived && !input.includeArchived) continue;
    }
    identities.add(identity);
  }
  const rows = [...identities].map((identity) => sourceMetrics(identity, input, assembled));
  const earliestRun = earliest(input.facts.runs.map((run) => run.createdAt));
  return {
    version: sourceIntelligenceVersion,
    window: input.window,
    groupBy,
    generatedAt: input.now,
    currency: input.currency,
    automated: rows.filter((row) => row.group === "automated").sort(byName),
    userCollected: rows.filter((row) => row.group === "user-collected").sort(byName),
    platform: platformSummary(input, assembled),
    historyStartsAt: earliestRun,
  };
}

// ---------------------------------------------------------------------------
// Drill-down

export interface SiOpportunityRow {
  id: string;
  title: string | null;
  company: string | null;
  credit: "discovered" | "also_listed";
  discoveredBy: string | null;
  discoveredByName: string | null;
  discoveredAt: Date;
  firstSeenHere: Date;
  coDiscovered: boolean;
  listings: Array<{
    source: string;
    sourceName: string;
    firstSeenAt: Date;
    via: "record" | "ledger";
    duplicateDecision: SiDuplicateDecision | null;
    ledgerState: SiLedgerState | null;
  }>;
  evaluationState: SiEvaluationState;
  decision: string | null;
  outcome: SiOutcome;
  possibleDuplicate: boolean;
  geography: SiGeographyBucket[];
  atsPlatform: string | null;
}

export interface SourceInsightDetail {
  version: string;
  window: SiWindow;
  source: SiSourceMetrics;
  trend: Array<{ weekStart: Date; listings: number; new: number }>;
  opportunities: SiOpportunityRow[];
  opportunitiesTruncated: boolean;
}

const weekStart = (at: Date) => {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * dayMs);
};

export function buildSourceInsightDetail(input: SourceInsightsInput & { identity: string }): SourceInsightDetail | null {
  const assembled = assemble(input);
  const { views, units, sourcesById, identityOf } = assembled;
  const identity = input.identity;
  const known =
    identity === manualIdentity ||
    identity.startsWith("extension:") ||
    (identity.startsWith("source:") && sourcesById.has(identity.slice("source:".length))) ||
    (identity.startsWith("adapter:") && (input.facts.sources.some((source) => `adapter:${source.adapterKey}` === identity) || units.some((unit) => identityOf(unit.identity) === identity))) ||
    units.some((unit) => identityOf(unit.identity) === identity);
  if (!known) return null;
  const source = sourceMetrics(identity, input, assembled);
  const mine = units.filter((unit) => identityOf(unit.identity) === identity && inWindow(input.window, unit.at));
  // Weekly trend over the window (at most the latest 26 weeks).
  const weeks = new Map<number, { listings: number; new: number }>();
  for (const unit of mine) {
    if (!unit.opportunityId) continue;
    const view = views.get(unit.opportunityId);
    if (!view) continue;
    const week = weekStart(unit.at).getTime();
    const entry = weeks.get(week) ?? { listings: 0, new: 0 };
    entry.listings += 1;
    if (unit.via === "record" && view.heads[0]?.recordId === unit.recordId) entry.new += 1;
    weeks.set(week, entry);
  }
  const trend = [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-maxTrendWeeks)
    .map(([week, entry]) => ({ weekStart: new Date(week), ...entry }));
  const ledgerState = (view: OpportunityView, sourceId: string | null) => {
    if (!sourceId) return null;
    const rows = view.ledger.filter((row) => row.retrievalSourceId === sourceId && row.state !== "UNTRACKED");
    return rows.sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime())[0]?.state ?? null;
  };
  const describe = (key: string) => describeIdentity(key, sourcesById, input.facts.sources).name;
  const firstSeen = new Map<string, Date>();
  for (const unit of mine) {
    if (!unit.opportunityId || !views.has(unit.opportunityId)) continue;
    const current = firstSeen.get(unit.opportunityId);
    if (!current || unit.at < current) firstSeen.set(unit.opportunityId, unit.at);
  }
  const ordered = [...firstSeen.entries()].sort(([, a], [, b]) => b.getTime() - a.getTime());
  const rows: SiOpportunityRow[] = ordered.slice(0, maxDetailOpportunities).map(([id, seen]) => {
    const view = views.get(id)!;
    const origin = view.heads[0];
    const originKey = view.originIdentity ? identityOf(view.originIdentity) : null;
    const listingRows = [
      ...view.heads.map((head) => ({
        source: identityOf(listingIdentity(head)),
        sourceName: describe(identityOf(listingIdentity(head))),
        firstSeenAt: head.createdAt,
        via: "record" as const,
        duplicateDecision: head.duplicateDecision,
        ledgerState: ledgerState(view, head.retrievalSourceId),
      })),
      ...view.ledger
        .filter((row) => !view.heads.some((head) => head.retrievalSourceId === row.retrievalSourceId && head.externalId === row.externalId))
        .filter((row, index, all) => all.findIndex((other) => other.retrievalSourceId === row.retrievalSourceId && other.externalId === row.externalId) === index)
        .map((row) => ({
          source: identityOf(configuredIdentity(row.retrievalSourceId)),
          sourceName: describe(identityOf(configuredIdentity(row.retrievalSourceId))),
          firstSeenAt: row.firstSeenAt,
          via: "ledger" as const,
          duplicateDecision: null,
          ledgerState: ledgerState(view, row.retrievalSourceId),
        })),
    ].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
    const coDiscovered = Boolean(
      origin &&
        view.heads.some(
          (head) =>
            head.recordId !== origin.recordId &&
            identityOf(listingIdentity(head)) !== originKey &&
            head.createdAt.getTime() - origin.createdAt.getTime() < coDiscoveryWindowMinutes * 60 * 1000,
        ),
    );
    return {
      id,
      title: view.fact.title,
      company: view.fact.company,
      credit: originKey === identity ? "discovered" : "also_listed",
      discoveredBy: originKey,
      discoveredByName: originKey ? describe(originKey) : null,
      discoveredAt: view.originAt,
      firstSeenHere: seen,
      coDiscovered,
      listings: listingRows,
      evaluationState: view.evaluation.state,
      decision: view.evaluation.decision,
      outcome: view.outcome,
      possibleDuplicate: view.fact.probableUnresolved,
      geography: view.geography,
      atsPlatform: view.ats.platform,
    };
  });
  return {
    version: sourceIntelligenceVersion,
    window: input.window,
    source,
    trend,
    opportunities: rows,
    opportunitiesTruncated: ordered.length > maxDetailOpportunities,
  };
}

// ---------------------------------------------------------------------------
// Sorting (within one section only; automated and user-collected sources are
// never ranked against each other). A rate with an insufficient sample
// (n < 5) is never used to order sources: those rows sort after the rest, by
// name.

export const sourceSortKeys = ["name", "discovered", "new", "useful_rate", "cost_per_useful", "success_rate"] as const;
export type SourceSortKey = (typeof sourceSortKeys)[number];

export function sortSources(rows: readonly SiSourceMetrics[], sort: SourceSortKey): SiSourceMetrics[] {
  if (sort === "name") return [...rows].sort(byName);
  const comparable = (rate: SiRate | null) => (rate && rate.value !== null && rate.sample !== "insufficient" && rate.sample !== "none" ? rate.value : null);
  const value = (row: SiSourceMetrics): number | null => {
    switch (sort) {
      case "discovered":
        return row.discovery.discovered;
      case "new":
        return row.discovery.new;
      case "useful_rate":
        return comparable(row.evaluation.usefulRate);
      case "success_rate":
        return comparable(row.reliability?.successRate ?? null);
      case "cost_per_useful":
        // Lower is better; a cost from an insufficient sample is not compared.
        return row.cost.costPerUseful !== null && row.evaluation.useful >= insufficientSampleBelow ? -row.cost.costPerUseful : null;
      default:
        return null;
    }
  };
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || byName(a, b);
  });
}

export function parseSourceSort(value: string | null | undefined): SourceSortKey {
  return (sourceSortKeys as readonly string[]).includes(value ?? "") ? (value as SourceSortKey) : "name";
}

export function parseGroupBy(value: string | null | undefined): SiGroupBy {
  return value === "adapter" ? "adapter" : "source";
}

// Path segment for a source's drill-down (/sources/<segment>/insights): a
// configured source's own id; otherwise "adapter--<key>",
// "extension--<site>" or "manual".
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sourceInsightSlug(identity: string): string {
  if (identity.startsWith("source:")) return identity.slice("source:".length);
  return identity.replace(":", "--");
}

export function identityFromInsightSlug(slug: string): string | null {
  const value = slug.trim();
  if (uuidPattern.test(value)) return `source:${value.toLowerCase()}`;
  if (value === manualIdentity) return manualIdentity;
  const match = /^(adapter|extension)--(.+)$/.exec(value);
  return match ? `${match[1]}:${match[2]}` : null;
}
