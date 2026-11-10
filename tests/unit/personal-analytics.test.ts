// Feature 17: Personal Job-Search Analytics pure rules (packages/core/src/personal-analytics.ts).
import { describe, expect, it } from "vitest";
import {
  buildPersonalAnalytics,
  localDay,
  outcomeDisclosure,
  parsePersonalQuery,
  parsePersonalWindow,
  personalOutcomeOf,
  PersonalQueryError,
  recommendationAtApplication,
  resumeMatchGroupOf,
  type PaApplicationFact,
  type PaEvaluationFact,
  type PaFacts,
  type PaGapFact,
  type PaOpportunityFact,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";

const terms = customerSuccessDiscoveryConfiguration.titleTerms;
const now = new Date("2026-10-31T12:00:00.000Z");
const ago = (days: number, hour = 12) => new Date(Date.UTC(2026, 9, 31 - days, hour));
const dayOf = (days: number) => new Date(Date.UTC(2026, 9, 31 - days));
const profileA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const profileB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const boardId = "11111111-1111-4111-8111-111111111111";

let sequence = 0;
const evaluation = (decision: string | null, completedAt: Date, extra: Partial<PaEvaluationFact> = {}): PaEvaluationFact => ({
  id: `e-${String(++sequence).padStart(4, "0")}`,
  status: "COMPLETED",
  createdAt: completedAt,
  completedAt,
  decision,
  userProfileId: profileA,
  userProfileVersion: 2,
  roleClassification: "CORE_CS",
  customerSegment: "ENTERPRISE",
  customerType: "LIGHT_B2B",
  alexFit: "GOOD",
  resumeMatch: { band: "GOOD_HIGH", gaps: [] },
  resumeMatchVersion: "cs-resume-match-v2",
  ...extra,
});
const application = (stage: string, appliedOn: Date | null, extra: Partial<PaApplicationFact> = {}): PaApplicationFact => ({
  stage,
  outcome: null,
  appliedOn,
  createdAt: appliedOn ?? ago(60),
  events: [],
  interviews: [],
  ...extra,
});
const job = (extra: Partial<PaOpportunityFact> = {}): PaOpportunityFact => ({
  id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  title: "Customer Success Manager",
  status: "APPLIED",
  seniority: null,
  remoteStatus: null,
  workArrangements: [],
  origin: { source: "remote-ok", sourceType: "API", retrievalSourceId: boardId, captureSite: null, externalId: "x" },
  evaluations: [],
  openDeferralReason: null,
  noLongerListed: false,
  markedAppliedAt: null,
  application: null,
  ...extra,
});
const gap = (category: string, requirementText: string, extra: Partial<PaGapFact> = {}): PaGapFact => ({
  category,
  requirementText,
  strength: "REQUIRED",
  decisionImpact: "MATERIAL_UNCERTAINTY",
  ...extra,
});
const facts = (opportunities: PaOpportunityFact[], extra: Partial<PaFacts> = {}): PaFacts => ({
  opportunities,
  sources: [{ id: boardId, name: "Remote board", adapterKey: "remote-ok", category: "JOB_BOARD", enabled: true, archived: false }],
  profiles: [
    { id: profileA, label: "Alex", version: 2 },
    { id: profileB, label: "Alex", version: 1 },
  ],
  activeProfileId: profileA,
  ...extra,
});
const build = (opportunities: PaOpportunityFact[], params: Record<string, string> = {}, extra: Partial<PaFacts> = {}) =>
  buildPersonalAnalytics({ facts: facts(opportunities, extra), titleTerms: terms, query: parsePersonalQuery(params, now, terms), now, timeZone: "UTC" });
const recAt = (opportunity: PaOpportunityFact) => recommendationAtApplication(opportunity, personalOutcomeOf(opportunity, now), "UTC").state;

describe("windows and query", () => {
  it("defaults to all time and adds 180 days without changing Feature 15's windows", () => {
    expect(parsePersonalWindow({}, now)).toMatchObject({ key: "all", from: null });
    expect(parsePersonalWindow({ window: "180d" }, now).from).toEqual(new Date(now.getTime() - 180 * 86_400_000));
    expect(parsePersonalWindow({ window: "90d" }, now).key).toBe("90d");
    expect(() => parsePersonalWindow({ window: "7d" }, now)).toThrow(PersonalQueryError);
    expect(() => parsePersonalWindow({ window: "custom", from: "2026-10-10", to: "2026-10-01" }, now)).toThrow(/on or before/);
    expect(() => parsePersonalQuery({ recommendation: "MAYBE" }, now, terms)).toThrow(PersonalQueryError);
    expect(() => parsePersonalQuery({ profile: "latest" }, now, terms)).toThrow(PersonalQueryError);
    expect(() => parsePersonalQuery({ source: "../x" }, now, terms)).toThrow(PersonalQueryError);
    expect(parsePersonalQuery({ source: `source:${boardId}`, recommendation: "SAME_DAY_UNKNOWN" }, now, terms).filters).toMatchObject({ profile: "active" });
  });

  it("uses the user's calendar day", () => {
    expect(localDay(new Date("2026-10-31T03:00:00.000Z"), "America/Los_Angeles")).toBe("2026-10-30");
    expect(localDay(new Date("2026-10-31T03:00:00.000Z"), "UTC")).toBe("2026-10-31");
  });
});

describe("recommendation at application (approved timing rule)", () => {
  it("1. an evaluation completed on an earlier day is the recommendation at application", () => {
    expect(recAt(job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation("APPLY", ago(6))] }))).toBe("APPLY");
  });

  it("2. an evaluation completed on a later day is 'evaluated after applying'", () => {
    expect(recAt(job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation("APPLY", ago(4))] }))).toBe("EVALUATED_AFTER");
  });

  it("3. a same-day evaluation with a date-only application is 'same-day order unknown', never assumed earlier", () => {
    expect(recAt(job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation("REVIEW", ago(5, 23))] }))).toBe("SAME_DAY_UNKNOWN");
    expect(recAt(job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation("REVIEW", ago(5, 0))] }))).toBe("SAME_DAY_UNKNOWN");
    // An earlier recommendation the same-day one disagrees with stays unknown; one it agrees with stands.
    expect(recAt(job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation("SKIP", ago(7)), evaluation("APPLY", ago(5, 8))] }))).toBe("SAME_DAY_UNKNOWN");
    expect(recAt(job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation("APPLY", ago(7)), evaluation("APPLY", ago(5, 8))] }))).toBe("APPLY");
  });

  it("4. an exact MARK_APPLIED timestamp after the evaluation credits the recommendation", () => {
    expect(recAt(job({ markedAppliedAt: ago(5, 15), evaluations: [evaluation("REVIEW", ago(5, 9))] }))).toBe("REVIEW");
  });

  it("5. an exact MARK_APPLIED timestamp before the evaluation is 'evaluated after applying'", () => {
    expect(recAt(job({ markedAppliedAt: ago(5, 9), evaluations: [evaluation("APPLY", ago(5, 15))] }))).toBe("EVALUATED_AFTER");
  });

  it("6. no evaluation is 'not evaluated'; evaluations without a recommendation do not count", () => {
    expect(recAt(job({ application: application("APPLIED", dayOf(5)) }))).toBe("NOT_EVALUATED");
    expect(recAt(job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation(null, ago(9))] }))).toBe("NOT_EVALUATED");
    expect(recAt(job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation(null, ago(9), { status: "FAILED", completedAt: null })] }))).toBe("NOT_EVALUATED");
  });

  it("uses the earlier date evidence when a dated application precedes the MARK_APPLIED action", () => {
    const opportunity = job({ application: application("APPLIED", dayOf(5)), markedAppliedAt: ago(2), evaluations: [evaluation("APPLY", ago(5, 10))] });
    expect(recAt(opportunity)).toBe("SAME_DAY_UNKNOWN");
  });
});

describe("outcomes, maturity and offer denominators (approved correction)", () => {
  const outcome = (opportunity: PaOpportunityFact) => personalOutcomeOf(opportunity, now);
  it("1. a mature application without progress is resolved and in the offer denominator", () => {
    expect(outcome(job({ application: application("APPLIED", dayOf(40)) }))).toMatchObject({ mature: true, resolved: true, inProcess: false, offer: false });
  });
  it("2. a closed rejected application is resolved", () => {
    expect(outcome(job({ application: application("CLOSED", dayOf(10), { outcome: "REJECTED" }) }))).toMatchObject({ resolved: true, closedOutcome: "REJECTED" });
  });
  it("3. an offer is resolved with an offer", () => {
    expect(outcome(job({ application: application("OFFER", dayOf(20)) }))).toMatchObject({ resolved: true, offer: true, interviewConcluded: true });
  });
  it("4–6. open SCREENING, INTERVIEWING and FINAL_ROUND applications are in process, not resolved", () => {
    for (const stage of ["SCREENING", "INTERVIEWING", "FINAL_ROUND"]) {
      expect(outcome(job({ application: application(stage, dayOf(45)) })), stage).toMatchObject({ inProcess: true, resolved: false, mature: true, interview: true });
    }
  });
  it("7. a closed interview without an offer concludes the interview process", () => {
    expect(outcome(job({ application: application("CLOSED", dayOf(20), { outcome: "REJECTED", events: [{ type: "STAGE_CHANGED", toStage: "INTERVIEWING", outcome: null, at: dayOf(15) }] }) }))).toMatchObject({
      interview: true,
      interviewConcluded: true,
      offer: false,
    });
  });
  it("8. an open interview is in process and not concluded", () => {
    expect(outcome(job({ application: application("APPLIED", dayOf(10), { interviews: [{ status: "SCHEDULED", at: ago(2), kind: "HIRING_MANAGER" }] }) }))).toMatchObject({
      interview: true,
      interviewConcluded: false,
      inProcess: true,
    });
  });
  it("keeps young applications awaiting response, out of every rate denominator", () => {
    expect(outcome(job({ application: application("APPLIED", dayOf(29)) }))).toMatchObject({ awaitingResponse: true, mature: false, resolved: false });
  });

  it("computes the rates with the approved denominators", () => {
    const market = build([
      job({ application: application("APPLIED", dayOf(40)) }),
      job({ application: application("CLOSED", dayOf(30), { outcome: "REJECTED" }) }),
      job({ application: application("OFFER", dayOf(25)) }),
      job({ application: application("INTERVIEWING", dayOf(20)) }),
      job({ application: application("CLOSED", dayOf(50), { outcome: "REJECTED", events: [{ type: "STAGE_CHANGED", toStage: "SCREENING", outcome: null, at: dayOf(45) }] }) }),
      job({ application: application("APPLIED", dayOf(3)) }),
    ]);
    expect(market.overview).toMatchObject({ applied: 6, mature: 5, awaitingResponse: 1, inProcess: 1, interviews: 3, offers: 1 });
    expect(market.overview.interviewRate).toMatchObject({ numerator: 3, denominator: 5 });
    // offers ÷ resolved (mature no-progress, rejected, offer, rejected after screen); the open interview is excluded.
    expect(market.overview.offerRate).toMatchObject({ numerator: 1, denominator: 4 });
    // offers ÷ concluded interview processes (offer, rejected after screen).
    expect(market.overview.interviewToOffer).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it("counts an Application plus MARK_APPLIED once and never counts PLANNED or NOT_SUBMITTED", () => {
    const market = build([
      job({ application: application("APPLIED", dayOf(10)), markedAppliedAt: ago(9) }),
      job({ application: application("PLANNED", null) }),
      job({ application: application("CLOSED", null, { outcome: "NOT_SUBMITTED" }), markedAppliedAt: ago(5) }),
      job({ markedAppliedAt: ago(4) }),
    ]);
    expect(market.overview.applied).toBe(2);
  });

  it("reads recruiter screens and final rounds as stored, once per application", () => {
    const market = build([
      job({ application: application("SCREENING", dayOf(10), { interviews: [{ status: "COMPLETED", at: ago(8), kind: "RECRUITER_SCREEN" }] }) }),
      job({ application: application("FINAL_ROUND", dayOf(20), { events: [{ type: "STAGE_CHANGED", toStage: "INTERVIEWING", outcome: null, at: dayOf(15) }] }) }),
      job({ application: application("APPLIED", dayOf(20), { interviews: [{ status: "CANCELLED", at: ago(8), kind: "RECRUITER_SCREEN" }] }) }),
      job({ application: application("CLOSED", dayOf(60), { outcome: "WITHDRAWN" }) }),
    ]);
    expect(market.funnels.applications).toMatchObject({ applied: 4, anyInterview: 2, recruiterScreen: 1, beyondScreening: 1, finalRound: 1, offers: 0 });
    expect(market.funnels.applications.closed).toMatchObject({ WITHDRAWN: 1 });
  });
});

describe("cohorts, funnels and dimensions", () => {
  it("dates applications by appliedAt and evaluations by completedAt", () => {
    const market = build(
      [
        job({ application: application("APPLIED", dayOf(10)), evaluations: [evaluation("APPLY", ago(200))] }),
        job({ application: application("APPLIED", dayOf(200)), evaluations: [evaluation("SKIP", ago(10))] }),
      ],
      { window: "90d" },
    );
    expect(market.overview.applied).toBe(1);
    expect(market.overview.evaluated).toBe(1);
    expect(market.funnels.evaluated.decisions.SKIP).toMatchObject({ evaluated: 1, applied: 1 });
  });

  it("keeps applications without evaluations in the application funnel and outcome tables", () => {
    const market = build([job({ application: application("APPLIED", dayOf(40)), origin: { source: "manual-input", sourceType: "MANUAL", retrievalSourceId: null, captureSite: null, externalId: null } })]);
    expect(market.overview.applied).toBe(1);
    expect(market.funnels.byRecommendationAtApplication).toEqual([expect.objectContaining({ key: "NOT_EVALUATED", applied: 1 })]);
    expect(market.overview.applicationsWithRecommendation).toMatchObject({ numerator: 0, denominator: 1 });
    expect(market.fitOutcomes.credited).toBe(0);
  });

  it("counts APPLY recommendations not applied as neutral information", () => {
    const market = build([job({ application: null, status: "RECOMMENDED", evaluations: [evaluation("APPLY", ago(3))] }), job({ application: application("APPLIED", dayOf(1)), evaluations: [evaluation("APPLY", ago(3))] })]);
    expect(market.funnels.evaluated.recommendedNotApplied).toBe(1);
    expect(market.notProgressing.recommendedNotApplied).toBe(1);
  });

  it("groups roles by title group, keeping evaluator view and outcomes apart, ranking only n ≥ 5", () => {
    const opportunities = [
      ...Array.from({ length: 5 }, (_, index) => job({ application: application("APPLIED", dayOf(40)), evaluations: [evaluation(index < 3 ? "APPLY" : "REVIEW", ago(45))] })),
      job({ title: "Onboarding Specialist", application: application("INTERVIEWING", dayOf(40)), evaluations: [evaluation("SKIP", ago(45), { resumeMatch: { band: "LOW", gaps: [] }, alexFit: "MIXED" })] }),
    ];
    const rows = build(opportunities).roles.rows;
    const cs = rows.find((row) => row.key === "Customer Success")!;
    expect(cs).toMatchObject({ evaluated: 5, fitEvaluated: 5 });
    expect(cs.apply).toMatchObject({ numerator: 3, denominator: 5 });
    expect(cs.resumeMatchGoodOrBetter).toMatchObject({ numerator: 5, denominator: 5 });
    expect(cs.outcomes.interviewRate).toMatchObject({ numerator: 0, denominator: 5 });
    expect(cs.rankable).toEqual({ fit: true, apply: true, interview: true });
    const onboarding = rows.find((row) => row.key === "Onboarding")!;
    expect(onboarding.alexFitStrongOrGood).toMatchObject({ numerator: 0, denominator: 1 });
    expect(onboarding.rankable).toEqual({ fit: false, apply: false, interview: false });
    expect(Object.keys(cs)).not.toContain("score");
  });

  it("filters by recommendation at application, arrangement, seniority, title group and first-discovering source", () => {
    const opportunities = [
      job({ application: application("APPLIED", dayOf(5)), evaluations: [evaluation("APPLY", ago(6))], seniority: "SENIOR", workArrangements: ["REMOTE"] }),
      job({ application: application("APPLIED", dayOf(5)), title: "Account Executive", origin: { source: "browser-extension", sourceType: "BROWSER_EXTENSION", retrievalSourceId: null, captureSite: "linkedin", externalId: "linkedin:1" } }),
    ];
    expect(build(opportunities, { recommendation: "APPLY" }).overview.applied).toBe(1);
    expect(build(opportunities, { recommendation: "NOT_EVALUATED" }).overview.applied).toBe(1);
    expect(build(opportunities, { seniority: "SENIOR" }).overview.applied).toBe(1);
    expect(build(opportunities, { arrangement: "REMOTE" }).overview.applied).toBe(1);
    expect(build(opportunities, { titleGroup: "OTHER" }).overview.applied).toBe(1);
    expect(build(opportunities, { source: "extension:linkedin" }).overview.applied).toBe(1);
  });
});

describe("sources (Feature 15 first-discovery identity)", () => {
  it("credits each application to its originating source and keeps user-collected rows apart", () => {
    const market = build([
      job({ application: application("INTERVIEWING", dayOf(40)) }),
      job({ application: application("APPLIED", dayOf(40)) }),
      job({ application: application("APPLIED", dayOf(40)), origin: { source: "browser-extension", sourceType: "BROWSER_EXTENSION", retrievalSourceId: null, captureSite: "linkedin", externalId: "linkedin:1" } }),
      job({ application: application("APPLIED", dayOf(40)), origin: { source: "manual-input", sourceType: "MANUAL", retrievalSourceId: null, captureSite: null, externalId: null } }),
      job({ application: application("APPLIED", dayOf(40)), origin: null }),
    ]);
    expect(market.sources.automated).toEqual([expect.objectContaining({ key: `source:${boardId}`, name: "Remote board", applied: 2, interviews: 1 })]);
    expect(market.sources.userCollected.map((row) => row.name).sort()).toEqual(["Browser extension · LinkedIn", "Manual entry"]);
    expect(market.sources.unknown).toMatchObject({ name: "No source record", applied: 1 });
  });
});

describe("recurring Genuine Gaps", () => {
  it("counts each category once per opportunity, with otherwise-good, applied and interviewed counts", () => {
    const market = build([
      job({ application: application("INTERVIEWING", dayOf(40)), evaluations: [evaluation("APPLY", ago(45), { resumeMatch: { band: "GOOD_HIGH", gaps: [gap("TOOL", "Salesforce"), gap("TOOL", "Gainsight", { strength: "PREFERRED" })] } })] }),
      job({ evaluations: [evaluation("REVIEW", ago(10), { resumeMatch: { band: "MIXED_MODERATE", gaps: [gap("TOOL", " salesforce "), gap("EXPERIENCE", "5 years SaaS", { decisionImpact: "DECISIVE_DISQUALIFIER" })] } })] }),
      job({ evaluations: [evaluation("SKIP", ago(10), { resumeMatch: { band: "LOW", gaps: [gap("TOOL", "CRM experience")] } })] }),
      job({ evaluations: [evaluation("APPLY", ago(10), { resumeMatch: null })] }),
    ]);
    const gaps = market.gaps;
    expect(gaps.evaluated).toBe(3);
    expect(gaps.otherwiseGood).toBe(2);
    const tool = gaps.categories.find((row) => row.category === "TOOL")!;
    expect(tool).toMatchObject({ opportunities: 3, otherwiseGood: 2, applied: 1, interviewed: 1, strength: { required: 3, preferred: 1, other: 0 } });
    expect(tool.share).toMatchObject({ numerator: 3, denominator: 3 });
    expect(tool.otherwiseGoodShare).toMatchObject({ numerator: 2, denominator: 2 });
    expect(gaps.categories.find((row) => row.category === "EXPERIENCE")!.decisionImpact).toEqual({ DECISIVE_DISQUALIFIER: 1 });
    // Exact wording only: "Salesforce" and " salesforce " merge (case/space), "CRM experience" does not.
    expect(gaps.phrases.find((row) => row.requirement === "Salesforce")).toMatchObject({ opportunities: 2, otherwiseGood: 2 });
    expect(gaps.phrases.find((row) => row.requirement === "CRM experience")).toMatchObject({ opportunities: 1 });
    expect(market.notes.gaps).toMatch(/similar wording is not merged/);
  });

  it("uses the active profile version by default and keeps other profile and Resume Match versions apart", () => {
    const withGap = (extra: Partial<PaEvaluationFact>) => job({ evaluations: [evaluation("APPLY", ago(10), { resumeMatch: { band: "GOOD_HIGH", gaps: [gap("TOOL", "Salesforce")] }, ...extra })] });
    const opportunities = [
      withGap({}),
      withGap({}),
      withGap({ resumeMatchVersion: "cs-resume-match-v4" }),
      withGap({ userProfileId: profileB, userProfileVersion: 1 }),
      withGap({ userProfileId: null, userProfileVersion: null }),
    ];
    const active = build(opportunities);
    expect(active.profile.selected).toMatchObject({ id: profileA, version: 2, active: true });
    expect(active.gaps.evaluated).toBe(2);
    expect(active.gaps.versions).toEqual([
      { version: "cs-resume-match-v2", group: "cs-resume-match-v2", evaluated: 2, included: true },
      { version: "cs-resume-match-v4", group: "cs-resume-match-v4", evaluated: 1, included: false },
    ]);
    expect(active.gaps.reason).toMatch(/compatible Resume Match version/);
    expect(build(opportunities, { profile: profileB }).gaps.evaluated).toBe(1);
    expect(build(opportunities, { profile: "none" }).gaps.evaluated).toBe(1);
    expect(active.profile.notRecorded).toBe(1);
    expect(resumeMatchGroupOf("cs-resume-match-v3")).toBe("cs-resume-match-v3");
    expect(resumeMatchGroupOf(null)).toBe("unrecorded");
  });
});

describe("where applications are not progressing", () => {
  it("lists groups with at least 5 mature applications and no interview; awaiting responses never count", () => {
    const mature = (title: string) => job({ title, application: application("APPLIED", dayOf(40)) });
    const market = build([
      ...Array.from({ length: 5 }, () => mature("Implementation Consultant")),
      ...Array.from({ length: 4 }, () => mature("Onboarding Specialist")),
      ...Array.from({ length: 3 }, () => job({ title: "Onboarding Specialist", application: application("APPLIED", dayOf(2)) })),
      ...Array.from({ length: 5 }, (_, index) => job({ title: "Customer Success Manager", application: application(index ? "APPLIED" : "SCREENING", dayOf(40)) })),
    ]);
    const titleGroups = market.notProgressing.groups.filter((row) => row.dimension === "titleGroup");
    expect(titleGroups).toEqual([{ dimension: "titleGroup", key: "Implementation", label: "Implementation", mature: 5 }]);
    expect(JSON.stringify(market)).not.toMatch(/wasted/i);
  });
});

describe("company type and fit versus outcome", () => {
  it("breaks evaluated applications down by customer segment and customer type only", () => {
    const market = build([
      job({ application: application("INTERVIEWING", dayOf(40)), evaluations: [evaluation("APPLY", ago(45), { customerSegment: "SMB", customerType: "B2C" })] }),
      job({ application: application("APPLIED", dayOf(40)), evaluations: [evaluation("APPLY", ago(45), { customerSegment: null, customerType: null })] }),
      job({ application: application("APPLIED", dayOf(40)) }),
    ]);
    expect(market.companyType.evaluatedApplied).toBe(2);
    expect(market.companyType.segment.map((row) => [row.key, row.applied, row.interviews])).toEqual([
      ["SMB", 1, 1],
      ["UNKNOWN", 1, 0],
    ]);
    expect(market.companyType.customerType.map((row) => row.key)).toEqual(["B2C", "UNKNOWN"]);
  });

  it("shows outcomes by the Resume Match band and Alex Fit credited at application, without any accuracy measure", () => {
    const market = build([
      job({ application: application("INTERVIEWING", dayOf(40)), evaluations: [evaluation("APPLY", ago(45), { resumeMatch: { band: "GOOD_HIGH", gaps: [] }, alexFit: "STRONG" })] }),
      job({ application: application("APPLIED", dayOf(40)), evaluations: [evaluation("APPLY", ago(30))] }),
    ]);
    expect(market.fitOutcomes.credited).toBe(1);
    expect(market.fitOutcomes.resumeMatchBand).toEqual([expect.objectContaining({ key: "GOOD_HIGH", applied: 1, interviews: 1 })]);
    expect(market.fitOutcomes.alexFit).toEqual([expect.objectContaining({ key: "STRONG" })]);
    expect(market.notes.outcomes).toBe(outcomeDisclosure);
    expect(outcomeDisclosure).toBe("These tables show what happened after each stored evaluation or recommendation. They do not measure evaluator accuracy.");
    expect(JSON.stringify(market)).not.toMatch(/accuracy"|precision|recall|calibration|falsePositive|falseNegative/i);
  });

  it("labels samples like Feature 15", () => {
    const rates = (count: number) => build(Array.from({ length: count }, () => job({ application: application("APPLIED", dayOf(40)) }))).overview.interviewRate.sample;
    expect([rates(4), rates(5), rates(19), rates(20)]).toEqual(["insufficient", "small", "small", "normal"]);
  });
});
