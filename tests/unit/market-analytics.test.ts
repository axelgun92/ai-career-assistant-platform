// Feature 16: Job-Market Analytics pure rules (packages/core/src/market-analytics.ts).
import { describe, expect, it } from "vitest";
import {
  arrangementOf,
  buildMarketAnalytics,
  createTitleGrouper,
  evaluationDisclosure,
  hiringRegionsOf,
  jobRegionsOf,
  MarketQueryError,
  median,
  parseMarketQuery,
  reconstructionGroupOf,
  selectionBiasNote,
  weekOf,
  type MarketEvaluationFact,
  type MarketOpportunityFact,
  type MarketRequirementFact,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { createTitleMatcher } from "@ai-career/discovery";

const terms = customerSuccessDiscoveryConfiguration.titleTerms;
const now = new Date("2026-10-31T12:00:00.000Z");
const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

let sequence = 0;
const job = (extra: Partial<MarketOpportunityFact> = {}): MarketOpportunityFact => ({
  id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  title: "Customer Success Manager",
  status: "NORMALIZED",
  firstSeenAt: ago(3),
  automated: true,
  seniority: null,
  seniorityLabel: null,
  location: null,
  remoteStatus: null,
  workArrangements: [],
  residencyRequirement: null,
  residencyRegions: [],
  workAuthorizationRequirement: null,
  workAuthorizationRegions: [],
  visaSponsorship: null,
  relocationSupport: null,
  employerOfRecordRegions: [],
  timeZoneRequirements: null,
  salaryMin: null,
  salaryMax: null,
  currency: null,
  compensationBasis: null,
  compensationTiers: [],
  evaluations: [],
  openDeferralReason: null,
  probableUnresolved: false,
  noLongerListed: false,
  ...extra,
});

const requirement = (category: string, strength = "REQUIRED", extra: Partial<MarketRequirementFact> = {}): MarketRequirementFact => ({
  requirement: `${category.toLowerCase()} requirement`,
  category,
  strength,
  statedYears: null,
  statedYearsMaximum: null,
  statedYearsOpenEnded: false,
  ...extra,
});

const evaluation = (decision: string | null, extra: Partial<MarketEvaluationFact> = {}): MarketEvaluationFact => ({
  id: `e-${++sequence}`,
  status: "COMPLETED",
  createdAt: ago(2),
  completedAt: ago(2),
  decision,
  roleClassification: "CORE_CS",
  customerSegment: "ENTERPRISE",
  reconstructionVersion: "cs-jd-reconstruction-v3",
  requirements: [],
  ...extra,
});

const build = (opportunities: MarketOpportunityFact[], params: Record<string, string> = {}) =>
  buildMarketAnalytics({ opportunities, titleTerms: terms, query: parseMarketQuery({ window: "30d", ...params }, now, terms) });

describe("cohort and query", () => {
  it("counts each canonical opportunity once and includes every lifecycle status", () => {
    const market = build([job({ status: "REJECTED_BY_USER" }), job({ status: "ARCHIVED" }), job({ status: "EVALUATED" })]);
    expect(market.overview.total).toBe(3);
  });

  it("includes by firstSeenAt, not posting date or evaluation date", () => {
    const market = build([job({ firstSeenAt: ago(29) }), job({ firstSeenAt: ago(31) }), job({ firstSeenAt: ago(1), evaluations: [evaluation("APPLY", { completedAt: ago(40) })] })]);
    expect(market.overview.total).toBe(2);
    expect(build([job({ firstSeenAt: ago(31) })], { window: "all" }).overview.total).toBe(1);
    const custom = build([job({ firstSeenAt: new Date("2026-10-20T23:59:00.000Z") }), job({ firstSeenAt: new Date("2026-10-21T00:00:00.000Z") })], {
      window: "custom",
      from: "2026-10-01",
      to: "2026-10-20",
    });
    expect(custom.overview.total).toBe(1);
  });

  it("defaults to automated only; All collected adds user captures with the selection-bias note", () => {
    const jobs = [job(), job({ automated: false }), job({ automated: false })];
    const automated = build(jobs);
    expect(automated.filters.collection).toBe("automated");
    expect(automated.overview.total).toBe(1);
    expect(automated.notes.selectionBias).toBeNull();
    const all = build(jobs, { collected: "all" });
    expect(all.overview.total).toBe(3);
    expect(all.notes.selectionBias).toBe(selectionBiasNote);
    expect(selectionBiasNote).toBe("These are user-selected captures and may introduce selection bias.");
  });

  it("keeps no-longer-listed jobs by default and excludes them on request", () => {
    const jobs = [job(), job({ noLongerListed: true })];
    expect(build(jobs).overview.total).toBe(2);
    expect(build(jobs, { excludeRemoved: "1" }).overview.total).toBe(1);
  });

  it("counts both sides of an unresolved probable duplicate and reports the pair once", () => {
    const market = build([job(), job({ probableUnresolved: true })]);
    expect(market.overview.total).toBe(2);
    expect(market.overview.coverage.probableDuplicates).toBe(1);
  });

  it("shows the historical note when the window reaches before automated retrieval began", () => {
    expect(build([], { window: "30d" }).notes.historical).toMatch(/October 18, 2026/);
    expect(build([], { window: "7d" }).notes.historical).toBeNull();
    expect(build([], { window: "all" }).notes.historical).not.toBeNull();
  });

  it("rejects invalid parameters with a query error", () => {
    expect(() => parseMarketQuery({ window: "year" }, now, terms)).toThrow(MarketQueryError);
    expect(() => parseMarketQuery({ window: "custom", from: "2026-10-10", to: "2026-10-01" }, now, terms)).toThrow(/on or before/);
    expect(() => parseMarketQuery({ seniority: "STAFF" }, now, terms)).toThrow(MarketQueryError);
    expect(() => parseMarketQuery({ titleGroup: "Sales" }, now, terms)).toThrow(MarketQueryError);
    expect(() => parseMarketQuery({ collected: "manual" }, now, terms)).toThrow(MarketQueryError);
    expect(() => parseMarketQuery({ currency: "dollars" }, now, terms)).toThrow(MarketQueryError);
    expect(parseMarketQuery({ currency: "cad", titleGroup: "OTHER", region: "UNITED_KINGDOM" }, now, terms).filters).toMatchObject({
      currency: "CAD",
      titleGroup: "OTHER",
      region: "UNITED_KINGDOM",
    });
  });

  it("groups trends by first-seen week (Monday, UTC)", () => {
    expect(weekOf(new Date("2026-10-31T12:00:00.000Z"))).toBe("2026-10-26");
    expect(weekOf(new Date("2026-10-26T00:00:00.000Z"))).toBe("2026-10-26");
    const market = build([job({ firstSeenAt: ago(1) }), job({ firstSeenAt: ago(8) })]);
    const weeks = Object.fromEntries(market.overview.trend.weeks.map((week) => [week.week, week.total]));
    expect(weeks["2026-10-26"]).toBe(1);
    expect(weeks["2026-10-19"]).toBe(1);
    expect(market.overview.trend.weeks[0]!.week).toBe(weekOf(ago(30)));
  });
});

describe("salary", () => {
  it("never combines currencies", () => {
    const market = build([
      job({ salaryMin: 100_000, salaryMax: 120_000, currency: "USD", compensationBasis: "BASE" }),
      job({ salaryMin: 80_000, salaryMax: 90_000, currency: "CAD", compensationBasis: "BASE" }),
      job({ salaryMin: 60_000, salaryMax: 70_000, currency: "EUR", compensationBasis: "BASE" }),
    ]);
    expect(market.salary.currencies.map((row) => row.currency)).toEqual(["USD", "CAD", "EUR"]);
    expect(market.salary.selectedCurrency).toBe("USD");
    expect(market.salary.stats).toHaveLength(1);
    expect(market.salary.stats[0]!.medianMidpoint).toMatchObject({ value: 110_000, n: 1, sample: "insufficient" });
    const cad = build(
      [job({ salaryMin: 100_000, salaryMax: 120_000, currency: "USD" }), job({ salaryMin: 80_000, salaryMax: 90_000, currency: "CAD" })],
      { currency: "CAD" },
    );
    expect(cad.salary.stats[0]).toMatchObject({ currency: "CAD", medianMidpoint: { value: 85_000 } });
  });

  it("keeps BASE, OTE and unknown basis apart", () => {
    const market = build([
      job({ salaryMin: 100_000, salaryMax: 100_000, currency: "USD", compensationBasis: "BASE" }),
      job({ salaryMin: 150_000, salaryMax: 170_000, currency: "USD", compensationBasis: "OTE" }),
      job({ salaryMin: 90_000, salaryMax: 110_000, currency: "USD", compensationBasis: null }),
    ]);
    expect(market.salary.stats.map((row) => [row.basis, row.medianMidpoint.value])).toEqual([
      ["BASE", 100_000],
      ["OTE", 160_000],
      ["UNKNOWN", 100_000],
    ]);
    expect(market.salary.stats.find((row) => row.basis === "OTE")!.breakdowns.titleGroup).toEqual([
      { key: "Customer Success", medianMidpoint: { value: 160_000, n: 1, sample: "insufficient" } },
    ]);
  });

  it("feeds min-only jobs to minimum statistics only and max-only to maximum only; exact is its own midpoint", () => {
    const usd = { currency: "USD", compensationBasis: "BASE" } as const;
    const market = build([
      job({ ...usd, salaryMin: 100_000, salaryMax: 100_000 }),
      job({ ...usd, salaryMin: 80_000, salaryMax: 120_000 }),
      job({ ...usd, salaryMin: 60_000, salaryMax: null }),
      job({ ...usd, salaryMin: null, salaryMax: 200_000 }),
    ]);
    const stats = market.salary.stats[0]!;
    expect(stats).toMatchObject({ jobs: 4, exact: 1, range: 1, minOnly: 1, maxOnly: 1 });
    expect(stats.medianMinimum).toMatchObject({ value: 80_000, n: 3 });
    expect(stats.medianMaximum).toMatchObject({ value: 120_000, n: 3 });
    expect(stats.medianMidpoint).toMatchObject({ value: 100_000, n: 2 });
    expect(stats.bands).toEqual([{ from: 100_000, to: 110_000, count: 2 }]);
  });

  it("keeps tiered pay out of single-range medians and lists each tier once per job", () => {
    const tiers = [
      { label: "Zone A", minimum: 120_000, maximum: 140_000, currency: "USD" },
      { label: "Zone B", minimum: 100_000, maximum: 120_000, currency: "USD" },
      { label: "Zone C", minimum: 90_000, maximum: 110_000, currency: "USD" },
    ];
    const market = build([job({ compensationTiers: tiers, compensationBasis: "BASE" }), job({ salaryMin: 50_000, salaryMax: 50_000, currency: "USD", compensationBasis: "BASE" })]);
    expect(market.salary.tiered).toBe(1);
    expect(market.salary.singleRange).toBe(1);
    expect(market.salary.stats[0]!.medianMidpoint).toMatchObject({ value: 50_000, n: 1 });
    expect(market.salary.tiers.map((row) => row.label)).toEqual(["Zone A", "Zone B", "Zone C"]);
    expect(new Set(market.salary.tiers.map((row) => row.opportunityId)).size).toBe(1);
    expect(market.overview.total).toBe(2);
    expect(market.salary.known).toMatchObject({ numerator: 2, denominator: 2 });
  });

  it("reports salary coverage with Unknown in the denominator", () => {
    const market = build([job({ salaryMin: 1, salaryMax: 2, currency: "USD" }), job(), job()]);
    expect(market.salary.known).toMatchObject({ numerator: 1, denominator: 3 });
    expect(market.salary.unknown).toBe(2);
  });

  it("counts amounts without a stated currency for coverage only, never in medians, bands or breakdowns", () => {
    const unstated = (min: number, max: number) => job({ salaryMin: min, salaryMax: max, currency: null, compensationBasis: "BASE" });
    // More unknown-currency jobs than USD ones: the default is still a stated currency.
    const market = build([unstated(80_000, 90_000), unstated(120_000, 130_000), unstated(50, 60), job({ salaryMin: 100_000, salaryMax: 100_000, currency: "USD", compensationBasis: "BASE" })]);
    expect(market.salary.currencyNotStated).toBe(3);
    expect(market.salary.known).toMatchObject({ numerator: 4, denominator: 4 });
    expect(market.salary.selectedCurrency).toBe("USD");
    expect(market.salary.stats.map((row) => row.currency)).toEqual(["USD"]);
    expect(market.salary.stats[0]!.medianMidpoint).toMatchObject({ value: 100_000, n: 1 });
    expect(market.salary.currencies.find((row) => row.currency === "UNKNOWN")).toMatchObject({ singleRange: 3 });
    // Only unknown-currency amounts: no statistics at all.
    const only = build([unstated(80_000, 90_000), unstated(120_000, 130_000)]);
    expect(only.salary.selectedCurrency).toBeNull();
    expect(only.salary.stats).toEqual([]);
    expect(only.salary.currencyNotStated).toBe(2);
    // It cannot be selected.
    expect(() => parseMarketQuery({ currency: "UNKNOWN" }, now, terms)).toThrow(MarketQueryError);
  });

  it("computes medians and bands", () => {
    expect(median([3, 1, 2])).toMatchObject({ value: 2, n: 3 });
    expect(median([1, 2, 3, 4])).toMatchObject({ value: 2.5, n: 4 });
    expect(median([])).toEqual({ value: null, n: 0, sample: "none" });
    const market = build([job({ salaryMin: 95_000, salaryMax: 105_000, currency: "USD" }), job({ salaryMin: 120_000, salaryMax: 120_000, currency: "USD" })]);
    expect(market.salary.stats[0]!.bands).toEqual([
      { from: 100_000, to: 110_000, count: 1 },
      { from: 110_000, to: 120_000, count: 0 },
      { from: 120_000, to: 130_000, count: 1 },
    ]);
  });
});

describe("roles and titles", () => {
  const group = createTitleGrouper(terms);

  it("uses the longest whole-phrase discovery term, in stable list order on ties, else Other title", () => {
    expect(group("Senior Customer Success Manager")).toBe("Customer Success");
    expect(group("Customer Success Implementation Lead")).toBe("Customer Success");
    expect(group("Implementation Consultant")).toBe("Implementation");
    expect(group("Customer Experience & Onboarding Specialist")).toBe("Customer Experience");
    expect(group("Onboarding Adoption Specialist")).toBe("Onboarding");
    expect(group("Sr. Customer-Success Manager")).toBe("Customer Success");
    expect(group("Successful Customer Outreach")).toBe("OTHER");
    expect(group("Account Executive")).toBe("OTHER");
    expect(group(null)).toBe("OTHER");
  });

  it("matches exactly the titles discovery keeps", () => {
    const keeps = createTitleMatcher(terms);
    for (const title of ["Customer Success Manager", "Head of Client Experience", "Successful Customer Outreach", "Account Manager", "Implementation", "User success lead"]) {
      expect(group(title) !== "OTHER").toBe(keeps(title));
    }
  });

  it("builds the title-group distribution, top exact titles and keeps evaluator role classification separate", () => {
    const market = build([
      job({ title: "Customer Success Manager", evaluations: [evaluation("APPLY", { roleClassification: "SALES_HEAVY" })] }),
      job({ title: "customer success manager " }),
      job({ title: "Onboarding Specialist" }),
      job({ title: "Account Executive" }),
    ]);
    const rows = Object.fromEntries(market.roles.titleGroups.rows.map((row) => [row.key, row.count]));
    expect(rows).toEqual({ "Customer Success": 2, Onboarding: 1, OTHER: 1 });
    expect(market.roles.titleGroups.rows.find((row) => row.key === "OTHER")!.ofKnown).toBeNull();
    expect(market.roles.titleGroups.rows.find((row) => row.key === "Onboarding")!.ofKnown).toMatchObject({ numerator: 1, denominator: 3 });
    expect(market.roles.topTitles[0]).toMatchObject({ title: "Customer Success Manager", count: 2 });
    expect(market.roles.roleClassification.evaluated).toBe(1);
    expect(market.roles.roleClassification.coverage).toMatchObject({ numerator: 1, denominator: 4 });
    expect(market.roles.roleClassification.distribution.rows.find((row) => row.key === "SALES_HEAVY")!.count).toBe(1);
    // The evaluator's classification never changes the title group.
    expect(rows["Customer Success"]).toBe(2);
  });

  it("shows each text in a form that never depends on row order", () => {
    const jobs = [job({ title: "customer success manager" }), job({ title: "Customer Success Manager" }), job({ title: "Customer Success Manager" })];
    expect(build(jobs).roles.topTitles[0]!.title).toBe("Customer Success Manager");
    expect(build([...jobs].reverse()).roles.topTitles[0]!.title).toBe("Customer Success Manager");
    const tie = [job({ title: "csm" }), job({ title: "CSM" })];
    expect(build(tie).roles.topTitles[0]!.title).toBe(build([...tie].reverse()).roles.topTitles[0]!.title);
  });

  it("filters by title group", () => {
    const market = build([job({ title: "Onboarding Specialist" }), job({ title: "Account Executive" })], { titleGroup: "OTHER" });
    expect(market.overview.total).toBe(1);
  });
});

describe("geography and work arrangement", () => {
  it("keeps job location apart from hiring eligibility", () => {
    const remoteCanada = job({ location: "Toronto, Ontario, Canada", residencyRegions: ["US", "CA"] });
    expect(jobRegionsOf(remoteCanada)).toEqual(["CANADA"]);
    expect(hiringRegionsOf(remoteCanada)).toEqual(["UNITED_STATES", "CANADA"]);
    expect(jobRegionsOf(job({ location: "Sunnyvale, CA" }))).toEqual(["UNKNOWN"]);
    expect(jobRegionsOf(job({ location: "Remote - Anywhere" }))).toEqual(["GLOBAL"]);
    expect(hiringRegionsOf(job({ residencyRequirement: "US_REQUIRED" }))).toEqual(["UNITED_STATES"]);
    const market = build([remoteCanada, job({ location: "London, United Kingdom" }), job()]);
    const location = Object.fromEntries(market.geography.jobLocation.rows.map((row) => [row.key, row.count]));
    const hiring = Object.fromEntries(market.geography.hiringEligibility.rows.map((row) => [row.key, row.count]));
    expect(location).toMatchObject({ CANADA: 1, UNITED_KINGDOM: 1, UNITED_STATES: 0, UNKNOWN: 1 });
    expect(hiring).toMatchObject({ CANADA: 1, UNITED_STATES: 1, UNITED_KINGDOM: 0, UNKNOWN: 2 });
    expect(market.overview.coverage.locationKnown).toMatchObject({ numerator: 2, denominator: 3 });
    expect(build([remoteCanada, job()], { region: "CANADA" }).overview.total).toBe(1);
  });

  it("separates work authorization, sponsorship, relocation, EOR and time zones", () => {
    const market = build([
      job({ workAuthorizationRequirement: "RIGHT_TO_WORK", visaSponsorship: "NOT_AVAILABLE", relocationSupport: "AVAILABLE", employerOfRecordRegions: ["GB"], timeZoneRequirements: "EST overlap" }),
      job({ timeZoneRequirements: "est overlap" }),
      job(),
    ]);
    const counts = (rows: Array<{ key: string; count: number }>) => Object.fromEntries(rows.map((row) => [row.key, row.count]));
    expect(counts(market.geography.workAuthorization.rows)).toMatchObject({ RIGHT_TO_WORK: 1, UNKNOWN: 2 });
    expect(counts(market.geography.sponsorship.rows)).toMatchObject({ NOT_AVAILABLE: 1, UNKNOWN: 2 });
    expect(counts(market.geography.relocation.rows)).toMatchObject({ AVAILABLE: 1, UNKNOWN: 2 });
    expect(market.geography.employerOfRecord.stated).toMatchObject({ numerator: 1, denominator: 3 });
    expect(market.geography.timeZone.top).toEqual([{ text: "EST overlap", count: 2 }]);
  });

  it("reads one arrangement, several options, or Unknown", () => {
    expect(arrangementOf({ remoteStatus: "REMOTE", workArrangements: ["REMOTE"] })).toBe("REMOTE");
    expect(arrangementOf({ remoteStatus: null, workArrangements: ["REMOTE", "HYBRID"] })).toBe("SEVERAL");
    expect(arrangementOf({ remoteStatus: "ONSITE", workArrangements: [] })).toBe("ONSITE");
    expect(arrangementOf({ remoteStatus: null, workArrangements: [] })).toBe("UNKNOWN");
    const market = build([job({ workArrangements: ["REMOTE", "HYBRID"] }), job({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"] }), job()]);
    expect(Object.fromEntries(market.geography.arrangement.rows.map((row) => [row.key, row.count]))).toEqual({ REMOTE: 0, HYBRID: 1, ONSITE: 0, SEVERAL: 1, UNKNOWN: 1 });
    expect(market.geography.severalOptions).toEqual([{ combination: ["REMOTE", "HYBRID"], count: 1 }]);
    expect(market.overview.coverage.arrangementKnown).toMatchObject({ numerator: 2, denominator: 3 });
  });
});

describe("seniority", () => {
  it("uses persisted values only and keeps Unknown visible", () => {
    const market = build([job({ seniority: "SENIOR", seniorityLabel: "Mid-Senior level" }), job({ seniority: null, title: "Lead Customer Success Manager" }), job({ seniority: "DIRECTOR" })]);
    const rows = Object.fromEntries(market.seniority.distribution.rows.map((row) => [row.key, row.count]));
    expect(rows).toMatchObject({ SENIOR: 1, DIRECTOR: 1, LEAD: 0, UNKNOWN: 1 });
    expect(market.seniority.distribution.rows.at(-1)!.key).toBe("UNKNOWN");
    expect(market.seniority.labels).toEqual([{ label: "Mid-Senior level", count: 1 }]);
    expect(market.overview.coverage.seniorityKnown).toMatchObject({ numerator: 2, denominator: 3 });
    expect(market.roles.seniorityByGroup[0]).toMatchObject({ key: "Customer Success", jobs: 3, counts: { SENIOR: 1, UNKNOWN: 1, DIRECTOR: 1 } });
    expect(build([job({ seniority: null }), job({ seniority: "MID" })], { seniority: "UNKNOWN" }).overview.total).toBe(1);
  });
});

describe("recommendations and evaluation coverage", () => {
  it("rates APPLY/REVIEW/SKIP over completed evaluations only, with coverage and separate states", () => {
    const market = build([
      job({ evaluations: [evaluation("APPLY")] }),
      job({ evaluations: [evaluation("REVIEW")] }),
      job({ evaluations: [evaluation("SKIP"), evaluation("APPLY", { completedAt: ago(5), createdAt: ago(5) })] }),
      job({ evaluations: [evaluation(null)] }),
      job({ openDeferralReason: "AI_BUDGET_LIMIT" }),
      job({ openDeferralReason: "USAGE_LIMIT_REACHED" }),
      job({ evaluations: [evaluation(null, { status: "RUNNING", completedAt: null })] }),
      job({ evaluations: [evaluation(null, { status: "FAILED", completedAt: null })] }),
      job(),
      job({ status: "REJECTED_BY_USER" }),
    ]);
    const recommendations = market.recommendations;
    expect(recommendations.completed).toBe(3);
    expect(recommendations.coverage).toMatchObject({ numerator: 3, denominator: 10 });
    expect(recommendations.apply).toMatchObject({ numerator: 1, denominator: 3 });
    expect(recommendations.review).toMatchObject({ numerator: 1, denominator: 3 });
    expect(recommendations.skip).toMatchObject({ numerator: 1, denominator: 3 });
    expect(recommendations.states).toEqual({
      evaluated: 3,
      completed_without_recommendation: 1,
      in_progress: 1,
      waiting_budget: 1,
      waiting_usage_limit: 1,
      failed: 1,
      not_yet_evaluated: 2,
    });
    expect(market.notes.evaluation).toBe(evaluationDisclosure);
    expect(evaluationDisclosure).toBe(
      "Evaluations are jobs you chose to evaluate. These results describe evaluated opportunities, not the entire collected market.",
    );
    expect(market.overview.coverage.evaluated).toMatchObject({ numerator: 4, denominator: 10 });
  });

  it("breaks recommendations down by title group, seniority, arrangement and job region, trended by cohort week", () => {
    const market = build([
      job({ seniority: "SENIOR", firstSeenAt: ago(1), evaluations: [evaluation("APPLY", { completedAt: ago(0) })] }),
      job({ seniority: "SENIOR", firstSeenAt: ago(8) }),
    ]);
    expect(market.recommendations.bySeniority).toEqual([
      expect.objectContaining({ key: "SENIOR", jobs: 2, completed: 1, coverage: expect.objectContaining({ value: 0.5 }), apply: expect.objectContaining({ numerator: 1, denominator: 1 }) }),
    ]);
    const week = market.recommendations.trend.find((row) => row.week === weekOf(ago(1)))!;
    expect(week).toMatchObject({ jobs: 1, completed: 1, apply: 1 });
    expect(week.applyRate).toMatchObject({ numerator: 1, denominator: 1, value: 1, sample: "insufficient" });
    expect(week.coverage).toMatchObject({ numerator: 1, denominator: 1 });
    const empty = market.recommendations.trend.find((row) => row.week === weekOf(ago(8)))!;
    expect(empty).toMatchObject({ jobs: 1, completed: 0 });
    expect(empty.applyRate).toMatchObject({ value: null, sample: "none" });
    expect(market.recommendations.byTitleGroup[0]!.key).toBe("Customer Success");
    expect(market.recommendations.byJobRegion[0]!.key).toBe("UNKNOWN");
  });
});

describe("weekly recommendation distribution", () => {
  it("rates each first-seen week over its completed evaluations with a recommendation, with coverage and sample labels", () => {
    const decided = (decision: string) => job({ firstSeenAt: ago(2), evaluations: [evaluation(decision, { completedAt: ago(40), createdAt: ago(40) })] });
    const week = (jobs: MarketOpportunityFact[]) => buildMarketAnalytics({ opportunities: jobs, titleTerms: terms, query: parseMarketQuery({ window: "7d" }, now, terms) }).recommendations.trend.find((row) => row.week === weekOf(ago(2)))!;
    const small = week([decided("APPLY"), decided("APPLY"), decided("REVIEW"), decided("SKIP"), decided("SKIP"), job({ firstSeenAt: ago(2), openDeferralReason: "AI_BUDGET_LIMIT" }), job({ firstSeenAt: ago(2), evaluations: [evaluation(null)] })]);
    expect(small).toMatchObject({ jobs: 7, completed: 5, apply: 2, review: 1, skip: 2 });
    expect(small.applyRate).toMatchObject({ numerator: 2, denominator: 5, value: 0.4, sample: "small" });
    expect(small.reviewRate).toMatchObject({ numerator: 1, denominator: 5 });
    expect(small.skipRate).toMatchObject({ numerator: 2, denominator: 5 });
    expect(small.coverage).toMatchObject({ numerator: 5, denominator: 7 });
    const few = week([decided("APPLY"), decided("SKIP")]);
    expect(few.applyRate).toMatchObject({ value: 0.5, sample: "insufficient" });
    const many = week(Array.from({ length: 20 }, (_, index) => decided(index < 5 ? "APPLY" : "REVIEW")));
    expect(many.applyRate).toMatchObject({ value: 0.25, sample: "normal" });
  });
});

describe("requirements", () => {
  it("reads job-side reconstruction requirements of evaluated jobs, excluding LOCATION and TRAVEL", () => {
    const market = build([
      job({
        evaluations: [
          evaluation("APPLY", {
            requirements: [
              requirement("EXPERIENCE", "REQUIRED", { requirement: "5+ years in Customer Success", statedYears: 5, statedYearsOpenEnded: true }),
              requirement("EXPERIENCE", "PREFERRED", { requirement: "SaaS experience", statedYears: 2 }),
              requirement("TOOL", "PREFERRED", { requirement: "Gainsight" }),
              requirement("LOCATION", "REQUIRED", { requirement: "Based in the US" }),
              requirement("TRAVEL", "REQUIRED"),
            ],
          }),
        ],
      }),
      job({ evaluations: [evaluation("SKIP", { requirements: [requirement("TOOL", "REQUIRED", { requirement: "gainsight" }), requirement("LANGUAGE", "NICE_TO_HAVE")] })] }),
      job(),
    ]);
    const requirements = market.requirements;
    expect(requirements.evaluated).toBe(2);
    expect(requirements.evaluatedCoverage).toMatchObject({ numerator: 2, denominator: 3 });
    const categories = Object.fromEntries(requirements.categories.map((row) => [row.category, row]));
    expect(Object.keys(categories)).not.toContain("LOCATION");
    expect(Object.keys(categories)).not.toContain("TRAVEL");
    expect(categories.TOOL!.jobs).toMatchObject({ numerator: 2, denominator: 2 });
    expect(categories.TOOL!.required).toMatchObject({ numerator: 1 });
    expect(categories.TOOL!.preferred).toMatchObject({ numerator: 1 });
    expect(categories.LANGUAGE!.other).toMatchObject({ numerator: 1 });
    expect(categories.EXPERIENCE!.jobs).toMatchObject({ numerator: 1 });
    expect(requirements.statedYears).toMatchObject({ jobs: 1, withYears: 1, openEnded: 1 });
    expect(requirements.statedYears.buckets.find((bucket) => bucket.key === "5")!.count).toBe(1);
    expect(requirements.topPhrases[0]).toMatchObject({ phrase: "Gainsight", category: "TOOL", jobs: 2 });
    expect(requirements.topPhrases.some((row) => row.phrase === "Based in the US")).toBe(false);
  });

  it("combines only compatible reconstruction versions and explains the cohort it selects", () => {
    expect(reconstructionGroupOf("cs-jd-reconstruction-v3")).toBe("cs-jd-reconstruction-v3");
    expect(reconstructionGroupOf("cs-jd-reconstruction-v7")).toBe("cs-jd-reconstruction-v7");
    expect(reconstructionGroupOf(null)).toBe("unrecorded");
    const withTool = (version: string | null) => job({ evaluations: [evaluation("APPLY", { reconstructionVersion: version, requirements: [requirement("TOOL")] })] });
    const market = build([withTool("cs-jd-reconstruction-v3"), withTool("cs-jd-reconstruction-v3"), withTool("cs-jd-reconstruction-v7"), withTool(null)]);
    const requirements = market.requirements;
    expect(requirements.withRequirementData).toBe(4);
    expect(requirements.versions).toEqual([
      { version: "cs-jd-reconstruction-v3", group: "cs-jd-reconstruction-v3", jobs: 2, included: true },
      { version: "cs-jd-reconstruction-v7", group: "cs-jd-reconstruction-v7", jobs: 1, included: false },
      { version: null, group: "unrecorded", jobs: 1, included: false },
    ]);
    expect(requirements.cohort).toMatchObject({ group: "cs-jd-reconstruction-v3", jobs: 2, excluded: 2 });
    expect(requirements.cohort.reason).toMatch(/combined only within one compatible JD Reconstruction version/);
    expect(requirements.categories.find((row) => row.category === "TOOL")!.jobs).toMatchObject({ numerator: 2, denominator: 2 });
    // A single compatible version needs no explanation.
    expect(build([withTool("cs-jd-reconstruction-v3")]).requirements.cohort.reason).toBeNull();
    // Ties prefer the declared version.
    expect(build([withTool("cs-jd-reconstruction-v7"), withTool("cs-jd-reconstruction-v3")]).requirements.cohort.group).toBe("cs-jd-reconstruction-v3");
  });

  it("counts an evaluation without requirement data as evaluated but not as requirement data", () => {
    const market = build([job({ evaluations: [evaluation("APPLY", { requirements: null })] })]);
    expect(market.requirements.evaluated).toBe(1);
    expect(market.requirements.withRequirementData).toBe(0);
    expect(market.overview.coverage.requirementData).toMatchObject({ numerator: 0, denominator: 1 });
  });
});

describe("customer segment", () => {
  it("is evaluated-only with coverage, Unknown visible", () => {
    const market = build([
      job({ evaluations: [evaluation("APPLY", { customerSegment: "SMB" })] }),
      job({ evaluations: [evaluation("SKIP", { customerSegment: null })] }),
      job(),
    ]);
    expect(market.segment.evaluated).toBe(2);
    expect(market.segment.coverage).toMatchObject({ numerator: 2, denominator: 3 });
    const rows = Object.fromEntries(market.segment.distribution.rows.map((row) => [row.key, row.count]));
    expect(rows).toMatchObject({ SMB: 1, UNKNOWN: 1, ENTERPRISE: 0 });
  });
});

describe("sample labels", () => {
  it("labels n < 5 insufficient, 5–19 small, 20+ normal", () => {
    const usd = (count: number) => Array.from({ length: count }, () => job({ salaryMin: 100_000, salaryMax: 100_000, currency: "USD" }));
    expect(build(usd(4)).salary.stats[0]!.medianMidpoint.sample).toBe("insufficient");
    expect(build(usd(5)).salary.stats[0]!.medianMidpoint.sample).toBe("small");
    expect(build(usd(19)).salary.stats[0]!.medianMidpoint.sample).toBe("small");
    expect(build(usd(20)).salary.stats[0]!.medianMidpoint.sample).toBe("normal");
    expect(build([]).recommendations.apply.sample).toBe("none");
  });
});
