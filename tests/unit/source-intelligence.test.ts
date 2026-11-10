import { describe, expect, it } from "vitest";
import {
  buildSourceInsightDetail,
  buildSourceInsights,
  evaluationStateOf,
  geographyBucketOf,
  geographyOf,
  outcomeOf,
  parseInsightsWindow,
  sampleLabel,
  siRate,
  sortSources,
  SourceInsightsWindowError,
  type SiEvaluationFact,
  type SiFacts,
  type SiListingFact,
  type SiOpportunityFact,
  type SiSourceDescriptor,
  type SiWindow,
} from "@ai-career/core";

const now = new Date("2026-10-31T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(now.getTime() - days * day);
const allTime: SiWindow = { key: "all", from: null, to: now };
const last30: SiWindow = { key: "30d", from: ago(30), to: now };

const source = (id: string, adapterKey: string, category: SiSourceDescriptor["category"], extra: Partial<SiSourceDescriptor> = {}): SiSourceDescriptor => ({
  id,
  name: `${adapterKey} (${id})`,
  adapterKey,
  category,
  enabled: true,
  archived: false,
  ...extra,
});

let recordSeq = 0;
const listing = (opportunityId: string | null, sourceFact: SiSourceDescriptor | "manual" | { site: string }, at: Date, extra: Partial<SiListingFact> = {}): SiListingFact => {
  recordSeq += 1;
  const recordId = `r${String(recordSeq).padStart(4, "0")}`;
  if (sourceFact === "manual") {
    return { recordId, opportunityId, source: "manual-input", sourceType: "MANUAL", sourceCategory: null, retrievalSourceId: null, captureSite: null, externalId: null, duplicateDecision: null, sourceUrl: null, applicationUrl: null, createdAt: at, ...extra };
  }
  if ("site" in sourceFact) {
    return { recordId, opportunityId, source: "browser-extension", sourceType: "BROWSER_EXTENSION", sourceCategory: sourceFact.site === "greenhouse" ? "ATS" : "JOB_BOARD", retrievalSourceId: null, captureSite: sourceFact.site, externalId: `${sourceFact.site}:${recordId}`, duplicateDecision: null, sourceUrl: null, applicationUrl: null, createdAt: at, ...extra };
  }
  return {
    recordId,
    opportunityId,
    source: sourceFact.adapterKey,
    sourceType: sourceFact.category === "ATS" ? "ATS" : "API",
    sourceCategory: sourceFact.category,
    retrievalSourceId: sourceFact.id,
    captureSite: null,
    externalId: `${sourceFact.adapterKey}-${recordId}`,
    duplicateDecision: null,
    sourceUrl: null,
    applicationUrl: null,
    createdAt: at,
    ...extra,
  };
};

const evaluation = (status: SiEvaluationFact["status"], decision: string | null, at: Date, cost = 0.1, unknown = 0): SiEvaluationFact => ({
  id: `e-${status}-${decision}-${at.getTime()}-${Math.random()}`,
  status,
  createdAt: at,
  completedAt: status === "COMPLETED" ? at : null,
  decision,
  knownCost: cost,
  unknownCostAttempts: unknown,
});

const opportunity = (id: string, extra: Partial<SiOpportunityFact> = {}): SiOpportunityFact => ({
  id,
  title: `Role ${id}`,
  company: "Acme",
  status: "NORMALIZED",
  createdAt: ago(10),
  canonicalUrl: null,
  applicationUrl: null,
  atsPlatform: null,
  location: null,
  remoteStatus: null,
  workArrangements: [],
  residencyRegions: [],
  workAuthorizationRegions: [],
  evaluations: [],
  openDeferralReason: null,
  markedAppliedAt: null,
  application: null,
  probableUnresolved: false,
  noLongerListed: false,
  ...extra,
});

const facts = (input: Partial<SiFacts>): SiFacts => ({ sources: [], listings: [], ledger: [], opportunities: [], runs: [], pendingDetails: [], ...input });
const insights = (input: Partial<SiFacts>, window: SiWindow = allTime, extra: { groupBy?: "source" | "adapter"; includeArchived?: boolean; currency?: string | null } = {}) =>
  buildSourceInsights({ facts: facts(input), window, now, currency: extra.currency === undefined ? "USD" : extra.currency, groupBy: extra.groupBy, includeArchived: extra.includeArchived });
const row = (result: ReturnType<typeof insights>, key: string) => {
  const found = [...result.automated, ...result.userCollected].find((item) => item.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found;
};

const remoteOk = source("s-rok", "remote-ok", "JOB_BOARD");
const greenhouse = source("s-gh", "greenhouse", "ATS");
const greenhouse2 = source("s-gh2", "greenhouse", "ATS");
const wwr = source("s-wwr", "we-work-remotely", "JOB_BOARD");

describe("Source Intelligence: rates and windows", () => {
  it("labels samples: under 5 insufficient, 5–19 small, 20+ normal", () => {
    expect([0, 1, 4, 5, 19, 20, 100].map(sampleLabel)).toEqual(["none", "insufficient", "insufficient", "small", "small", "normal", "normal"]);
    expect(siRate(1, 3)).toEqual({ numerator: 1, denominator: 3, value: 1 / 3, sample: "insufficient" });
    expect(siRate(0, 0).value).toBeNull();
  });

  it("parses rolling, all-time and custom windows", () => {
    expect(parseInsightsWindow({}, now)).toEqual({ key: "30d", from: ago(30), to: now });
    expect(parseInsightsWindow({ window: "7d" }, now).from).toEqual(ago(7));
    expect(parseInsightsWindow({ window: "all" }, now).from).toBeNull();
    const custom = parseInsightsWindow({ window: "custom", from: "2026-10-01", to: "2026-10-01" }, now);
    expect(custom.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(custom.to.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(() => parseInsightsWindow({ window: "custom", from: "2026-10-05", to: "2026-10-01" }, now)).toThrow(SourceInsightsWindowError);
    expect(() => parseInsightsWindow({ window: "custom" }, now)).toThrow(SourceInsightsWindowError);
    expect(() => parseInsightsWindow({ window: "year" }, now)).toThrow(SourceInsightsWindowError);
  });
});

describe("Source Intelligence: first-discovery credit and presence", () => {
  it("Remote OK first, Greenhouse later: Remote OK keeps credit; Greenhouse has presence and confirms the employer ATS", () => {
    const result = insights({
      sources: [remoteOk, greenhouse],
      listings: [
        listing("o1", remoteOk, ago(20)),
        listing("o1", greenhouse, ago(18), { duplicateDecision: "MATCH" }),
      ],
      opportunities: [
        opportunity("o1", {
          canonicalUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
          evaluations: [evaluation("COMPLETED", "APPLY", ago(17), 0.5)],
          markedAppliedAt: ago(15),
        }),
      ],
    });
    const rok = row(result, "source:s-rok");
    const gh = row(result, "source:s-gh");
    expect(rok.discovery).toMatchObject({ listings: 1, new: 1, alreadyKnown: 0, discovered: 1, exclusive: 0 });
    expect(gh.discovery).toMatchObject({ listings: 1, new: 0, alreadyKnown: 1, discovered: 1, exclusive: 0 });
    expect(gh.discovery.duplicateRate.value).toBe(1);
    // Credit: evaluation, cost and outcome go to Remote OK only.
    expect(rok.evaluation).toMatchObject({ evaluated: 1, apply: 1, useful: 1 });
    expect(rok.cost).toMatchObject({ completedSpend: 0.5, costPerUseful: 0.5 });
    expect(rok.outcomes.applications).toBe(1);
    expect(gh.evaluation.evaluated).toBe(0);
    expect(gh.cost.totalSpend).toBe(0);
    expect(gh.outcomes.applications).toBe(0);
    expect(gh.outcomes.alsoListedBefore).toEqual({ applications: 1, interviews: 0, offers: 0 });
    // ATS: the Greenhouse listing gives direct employer-ATS provenance.
    expect(rok.ats).toMatchObject({ known: 1, platforms: { greenhouse: 1 } });
    expect(rok.ats.directShare.value).toBe(1);
    // Platform totals never double count.
    expect(result.platform).toMatchObject({ listings: 2, discovered: 1, new: 1 });
    expect(result.platform.duplicateRate.value).toBe(0.5);
    expect(result.platform.outcomes.applications).toBe(1);
  });

  it("a job board that discovered a job keeps credit when the employer ATS appears later, even though the ATS link becomes canonical", () => {
    const result = insights({
      sources: [wwr, greenhouse],
      listings: [listing("o1", wwr, ago(9)), listing("o1", greenhouse, ago(2), { duplicateDecision: "MATCH" })],
      opportunities: [opportunity("o1", { canonicalUrl: "https://job-boards.greenhouse.io/x/jobs/9", applicationUrl: "https://job-boards.greenhouse.io/x/jobs/9" })],
    });
    expect(row(result, "source:s-wwr").discovery.new).toBe(1);
    expect(row(result, "source:s-gh").discovery.new).toBe(0);
  });

  it("several boards in the same cycle: the earliest record (then id) gets credit, and the drill-down tags co-discovery", () => {
    const at = ago(5);
    const first = listing("o1", remoteOk, at);
    const second = listing("o1", wwr, new Date(at.getTime() + 10 * 60 * 1000), { duplicateDecision: "MATCH" });
    const input = facts({ sources: [remoteOk, wwr], listings: [second, first], opportunities: [opportunity("o1")] });
    const result = buildSourceInsights({ facts: input, window: allTime, now, currency: "USD" });
    expect(row(result, "source:s-rok").discovery.new).toBe(1);
    expect(row(result, "source:s-wwr").discovery.alreadyKnown).toBe(1);
    const detail = buildSourceInsightDetail({ facts: input, window: allTime, now, currency: "USD", identity: "source:s-wwr" })!;
    expect(detail.opportunities[0]).toMatchObject({ credit: "also_listed", discoveredBy: "source:s-rok", coDiscovered: true });
    // Identical timestamps: the lower record id wins, deterministically.
    const tieA = listing("o2", wwr, at);
    const tieB = listing("o2", remoteOk, at, { duplicateDecision: "MATCH" });
    const tie = insights({ sources: [remoteOk, wwr], listings: [tieB, tieA], opportunities: [opportunity("o2")] });
    expect(row(tie, "source:s-wwr").discovery.new).toBe(1);
  });

  it("an extension capture of an existing job is presence in the user-collected section, never discovery credit", () => {
    const result = insights({
      sources: [remoteOk],
      listings: [listing("o1", remoteOk, ago(8)), listing("o1", { site: "linkedin" }, ago(3), { duplicateDecision: "MATCH" })],
      opportunities: [opportunity("o1")],
    });
    const extension = row(result, "extension:linkedin");
    expect(extension).toMatchObject({ group: "user-collected", name: "Browser extension · LinkedIn" });
    expect(extension.discovery).toMatchObject({ new: 0, alreadyKnown: 1 });
    expect(extension.notes).toContain("selection_biased");
    expect(result.automated.map((item) => item.key)).toEqual(["source:s-rok"]);
  });

  it("manual entry first, a source later: manual entry keeps credit", () => {
    const result = insights({
      sources: [greenhouse],
      listings: [listing("o1", "manual", ago(12)), listing("o1", greenhouse, ago(4), { duplicateDecision: "MATCH" })],
      opportunities: [opportunity("o1", { evaluations: [evaluation("COMPLETED", "REVIEW", ago(11))] })],
    });
    expect(row(result, "manual")).toMatchObject({ group: "user-collected", name: "Manual entry" });
    expect(row(result, "manual").evaluation.useful).toBe(1);
    expect(row(result, "source:s-gh").discovery.alreadyKnown).toBe(1);
  });

  it("a configured source that saw an already-stored listing without writing a record is still counted, from its ledger row", () => {
    const head = listing("o1", greenhouse, ago(6));
    const result = insights({
      sources: [greenhouse, greenhouse2],
      listings: [head],
      ledger: [
        { retrievalSourceId: "s-gh", externalId: head.externalId!, opportunityId: "o1", firstSeenAt: ago(6), state: "LISTED" },
        { retrievalSourceId: "s-gh2", externalId: head.externalId!, opportunityId: "o1", firstSeenAt: ago(5), state: "LISTED" },
        { retrievalSourceId: "s-gh2", externalId: head.externalId!, opportunityId: "o1", firstSeenAt: ago(4), state: "UNTRACKED" },
      ],
      opportunities: [opportunity("o1")],
    });
    expect(row(result, "source:s-gh").discovery).toMatchObject({ listings: 1, new: 1, alreadyKnown: 0 });
    expect(row(result, "source:s-gh2").discovery).toMatchObject({ listings: 1, new: 0, alreadyKnown: 1, discovered: 1 });
    expect(result.platform.listings).toBe(2);
  });

  it("keeps already-known, repost-on-same-source, possible-duplicate and not-processed apart", () => {
    const result = insights({
      sources: [remoteOk, wwr],
      listings: [
        listing("o1", remoteOk, ago(10)),
        listing("o1", remoteOk, ago(5), { duplicateDecision: "MATCH" }),
        listing("o1", wwr, ago(4), { duplicateDecision: "MATCH" }),
        listing("o2", remoteOk, ago(3), { duplicateDecision: "PROBABLE_MATCH" }),
        listing(null, remoteOk, ago(2)),
      ],
      opportunities: [opportunity("o1"), opportunity("o2", { probableUnresolved: true })],
    });
    expect(row(result, "source:s-rok").discovery).toMatchObject({ listings: 3, new: 2, alreadyKnown: 1, repostOnSameSource: 1, possibleDuplicates: 1, notProcessed: 1 });
    expect(row(result, "source:s-wwr").discovery).toMatchObject({ alreadyKnown: 1, repostOnSameSource: 0 });
  });

  it("a listing that disappears after application keeps its credit and outcome", () => {
    const head = listing("o1", greenhouse, ago(40));
    const result = insights({
      sources: [greenhouse],
      listings: [head],
      ledger: [{ retrievalSourceId: "s-gh", externalId: head.externalId!, opportunityId: "o1", firstSeenAt: ago(40), state: "REMOVED" }],
      opportunities: [opportunity("o1", { noLongerListed: true, markedAppliedAt: ago(38) })],
    });
    expect(row(result, "source:s-gh").discovery.new).toBe(1);
    expect(row(result, "source:s-gh").outcomes.applications).toBe(1);
  });

  it("windows: credit follows the discovery cohort; a later sighting inside the window is presence", () => {
    const result = insights(
      {
        sources: [remoteOk, wwr],
        listings: [listing("o1", remoteOk, ago(60)), listing("o1", wwr, ago(10), { duplicateDecision: "MATCH" })],
        opportunities: [opportunity("o1", { createdAt: ago(60), evaluations: [evaluation("COMPLETED", "APPLY", ago(59))] })],
      },
      last30,
    );
    expect(row(result, "source:s-rok").discovery.listings).toBe(0);
    expect(row(result, "source:s-rok").evaluation.cohort).toBe(0);
    expect(row(result, "source:s-wwr").discovery).toMatchObject({ discovered: 1, alreadyKnown: 1 });
    expect(result.platform.new).toBe(0);
  });

  it("groups configured sources by adapter as a secondary view, and hides archived sources unless asked", () => {
    const archived = source("s-old", "lever", "ATS", { archived: true });
    const input = { sources: [greenhouse, greenhouse2, archived], listings: [listing("o1", greenhouse, ago(3)), listing("o2", greenhouse2, ago(2))], opportunities: [opportunity("o1"), opportunity("o2")] };
    const grouped = insights(input, allTime, { groupBy: "adapter" });
    expect(grouped.automated.map((item) => item.key)).toEqual(["adapter:greenhouse"]);
    expect(row(grouped, "adapter:greenhouse").discovery.new).toBe(2);
    expect(insights(input).automated.map((item) => item.key).sort()).toEqual(["source:s-gh", "source:s-gh2"]);
    expect(insights(input, allTime, { includeArchived: true }).automated.map((item) => item.key)).toContain("source:s-old");
  });
});

describe("Source Intelligence: evaluation states are neutral unless completed", () => {
  it("orders states and maps legacy budget deferral", () => {
    const state = (extra: Partial<SiOpportunityFact>) => evaluationStateOf(opportunity("x", extra)).state;
    expect(state({ evaluations: [evaluation("COMPLETED", "SKIP", ago(2)), evaluation("RUNNING", null, ago(1))] })).toBe("evaluated");
    expect(state({ evaluations: [evaluation("COMPLETED", null, ago(2))] })).toBe("completed_without_recommendation");
    expect(state({ evaluations: [evaluation("PENDING", null, ago(1))], openDeferralReason: "AI_BUDGET_LIMIT" })).toBe("in_progress");
    expect(state({ openDeferralReason: "AI_BUDGET_LIMIT" })).toBe("waiting_budget");
    expect(state({ openDeferralReason: "BUDGET_UNAVAILABLE" })).toBe("waiting_budget");
    expect(state({ openDeferralReason: "USAGE_LIMIT_REACHED" })).toBe("waiting_usage_limit");
    expect(state({ evaluations: [evaluation("FAILED", null, ago(1))] })).toBe("failed");
    expect(state({ status: "REJECTED_BY_USER" })).toBe("user_dismissed");
    expect(state({ status: "ARCHIVED" })).toBe("user_dismissed");
    expect(state({ noLongerListed: true })).toBe("no_longer_listed");
    expect(state({})).toBe("not_yet_evaluated");
  });

  it("uses the latest completed evaluation's decision", () => {
    expect(evaluationStateOf(opportunity("x", { evaluations: [evaluation("COMPLETED", "SKIP", ago(5)), evaluation("COMPLETED", "APPLY", ago(1))] }))).toEqual({ state: "evaluated", decision: "APPLY" });
  });

  it("budget and usage-limit deferrals never lower a source's useful rate (Core TDD §42)", () => {
    const deferred = Array.from({ length: 6 }, (_, index) => opportunity(`d${index}`, { openDeferralReason: index % 2 ? "AI_BUDGET_LIMIT" : "USAGE_LIMIT_REACHED" }));
    const evaluated = [opportunity("e1", { evaluations: [evaluation("COMPLETED", "APPLY", ago(1))] }), opportunity("e2", { evaluations: [evaluation("COMPLETED", "SKIP", ago(1))] })];
    const all = [...deferred, ...evaluated];
    const result = insights({ sources: [remoteOk], listings: all.map((item) => listing(item.id, remoteOk, ago(3))), opportunities: all });
    const metrics = row(result, "source:s-rok").evaluation;
    expect(metrics).toMatchObject({ cohort: 8, evaluated: 2, useful: 1, apply: 1, skip: 1 });
    expect(metrics.usefulRate.value).toBe(0.5);
    expect(metrics.states).toMatchObject({ waiting_budget: 3, waiting_usage_limit: 3 });
    expect(metrics.coverage).toMatchObject({ numerator: 2, denominator: 8 });
    const withoutDeferred = insights({ sources: [remoteOk], listings: evaluated.map((item) => listing(item.id, remoteOk, ago(3))), opportunities: evaluated });
    expect(row(withoutDeferred, "source:s-rok").evaluation.usefulRate.value).toBe(metrics.usefulRate.value);
  });

  it("useful = APPLY + REVIEW; Apply shown separately", () => {
    const items = [
      opportunity("a", { evaluations: [evaluation("COMPLETED", "APPLY", ago(1))] }),
      opportunity("b", { evaluations: [evaluation("COMPLETED", "REVIEW", ago(1))] }),
      opportunity("c", { evaluations: [evaluation("COMPLETED", "SKIP", ago(1))] }),
      opportunity("d", { evaluations: [evaluation("FAILED", null, ago(1))] }),
    ];
    const metrics = row(insights({ sources: [remoteOk], listings: items.map((item) => listing(item.id, remoteOk, ago(2))), opportunities: items }), "source:s-rok").evaluation;
    expect(metrics).toMatchObject({ evaluated: 3, useful: 2, apply: 1, review: 1, skip: 1 });
    expect(metrics.usefulRate.value).toBeCloseTo(2 / 3);
    expect(metrics.applyRate.value).toBeCloseTo(1 / 3);
    expect(metrics.usefulRate.sample).toBe("insufficient");
  });
});

describe("Source Intelligence: outcomes", () => {
  const application = (extra: Partial<NonNullable<SiOpportunityFact["application"]>>) => ({ stage: "APPLIED", outcome: null, appliedOn: ago(40), createdAt: ago(40), events: [], interviews: [], ...extra });

  it("counts a lifecycle 'Mark as applied' without an application row, and both together once", () => {
    expect(outcomeOf(opportunity("x", { markedAppliedAt: ago(40) }), now)).toMatchObject({ applied: true, awaitingResponse: false });
    const both = outcomeOf(opportunity("x", { markedAppliedAt: ago(41), application: application({}) }), now);
    expect(both.applied).toBe(true);
    expect(both.appliedAt).toEqual(ago(41));
    expect(outcomeOf(opportunity("x", { markedAppliedAt: ago(40), application: application({ stage: "CLOSED", outcome: "NOT_SUBMITTED", appliedOn: null }) }), now).applied).toBe(false);
    expect(outcomeOf(opportunity("x", { application: application({ stage: "PLANNED", appliedOn: null }) }), now).applied).toBe(false);
    const items = [opportunity("m1", { markedAppliedAt: ago(40) }), opportunity("m2", { markedAppliedAt: ago(40), application: application({}) })];
    const metrics = row(insights({ sources: [remoteOk], listings: items.map((item) => listing(item.id, remoteOk, ago(45))), opportunities: items }), "source:s-rok").outcomes;
    expect(metrics.applications).toBe(2);
  });

  it("an interview is SCREENING or later, or a non-cancelled interview record, counted once per opportunity", () => {
    const screen = outcomeOf(opportunity("x", { application: application({ stage: "SCREENING", events: [{ type: "STAGE_CHANGED", toStage: "SCREENING", outcome: null, at: ago(30) }], interviews: [{ status: "SCHEDULED", at: ago(29) }] }) }), now);
    expect(screen).toMatchObject({ interview: true, offer: false });
    expect(screen.interviewAt).toEqual(ago(30));
    expect(outcomeOf(opportunity("x", { application: application({ interviews: [{ status: "COMPLETED", at: ago(20) }] }) }), now).interview).toBe(true);
    expect(outcomeOf(opportunity("x", { application: application({ interviews: [{ status: "CANCELLED", at: ago(20) }] }) }), now).interview).toBe(false);
    // Moved on afterwards: the history still shows the interview.
    expect(outcomeOf(opportunity("x", { application: application({ stage: "CLOSED", outcome: "REJECTED", events: [{ type: "STAGE_CHANGED", toStage: "INTERVIEWING", outcome: null, at: ago(25) }] }) }), now).interview).toBe(true);
  });

  it("an offer is reaching OFFER or an offer outcome", () => {
    expect(outcomeOf(opportunity("x", { application: application({ stage: "CLOSED", outcome: "OFFER_DECLINED" }) }), now)).toMatchObject({ offer: true, interview: true });
    expect(outcomeOf(opportunity("x", { application: application({ events: [{ type: "STAGE_CHANGED", toStage: "OFFER", outcome: null, at: ago(5) }] }) }), now).offer).toBe(true);
  });

  it("applications under 30 days old without progress are awaiting response, not 'no interview'", () => {
    const items = [
      opportunity("new", { application: application({ appliedOn: ago(5), createdAt: ago(5) }) }),
      opportunity("old", { application: application({ appliedOn: ago(45) }) }),
      opportunity("rejected", { application: application({ appliedOn: ago(6), stage: "CLOSED", outcome: "REJECTED" }) }),
      opportunity("offer", { application: application({ stage: "OFFER", events: [{ type: "STAGE_CHANGED", toStage: "OFFER", outcome: null, at: ago(10) }] }) }),
    ];
    const metrics = row(insights({ sources: [remoteOk], listings: items.map((item) => listing(item.id, remoteOk, ago(50))), opportunities: items }), "source:s-rok");
    expect(metrics.outcomes).toMatchObject({ applications: 4, awaitingResponse: 1, matureApplications: 3, interviews: 1, offers: 1 });
    expect(metrics.outcomes.interviewRate).toMatchObject({ numerator: 1, denominator: 3, sample: "insufficient" });
    expect(metrics.notes).toContain("awaiting_outcomes");
  });
});

describe("Source Intelligence: cost", () => {
  it("cost per useful uses completed-evaluation spend; failed, in-progress and unknown cost are reported separately", () => {
    const items = [
      opportunity("a", { evaluations: [evaluation("COMPLETED", "SKIP", ago(4), 0.2), evaluation("COMPLETED", "APPLY", ago(2), 0.3)] }),
      opportunity("b", { evaluations: [evaluation("FAILED", null, ago(2), 0.05, 1)] }),
      opportunity("c", { evaluations: [evaluation("RUNNING", null, ago(1), 0.01)] }),
    ];
    const cost = row(insights({ sources: [remoteOk], listings: items.map((item) => listing(item.id, remoteOk, ago(5))), opportunities: items }), "source:s-rok").cost;
    expect(cost).toMatchObject({ completedSpend: 0.5, failedSpend: 0.05, otherSpend: 0.01, totalSpend: 0.56, unknownAttempts: 1, completedUnknownAttempts: 0, costPerUseful: 0.5, incomplete: false });
  });

  it("no useful jobs yet is a note, never $0 or infinity; unknown cost marks the figure incomplete; no currency gives no figure", () => {
    const items = [opportunity("a", { evaluations: [evaluation("COMPLETED", "SKIP", ago(2), 0.4, 2)] })];
    const input = { sources: [remoteOk], listings: items.map((item) => listing(item.id, remoteOk, ago(3))), opportunities: items };
    const metrics = row(insights(input), "source:s-rok");
    expect(metrics.cost).toMatchObject({ costPerUseful: null, costPerUsefulNote: "no_useful_jobs", incomplete: true, completedUnknownAttempts: 2 });
    expect(metrics.notes).toEqual(expect.arrayContaining(["no_useful_jobs_yet", "cost_incomplete"]));
    expect(row(insights(input, allTime, { currency: null }), "source:s-rok").cost.costPerUsefulNote).toBe("no_currency");
  });

  it("platform spend over all time includes every opportunity, unattributed ones too", () => {
    const items = [opportunity("a", { evaluations: [evaluation("COMPLETED", "APPLY", ago(2), 0.4)] }), opportunity("orphan", { evaluations: [evaluation("FAILED", null, ago(2), 0.1)] })];
    const result = insights({ sources: [remoteOk], listings: [listing("a", remoteOk, ago(3))], opportunities: items });
    expect(result.platform.cost).toMatchObject({ completedSpend: 0.4, failedSpend: 0.1, totalSpend: 0.5 });
    expect(result.platform.unattributed).toBe(1);
  });
});

describe("Source Intelligence: geography and ATS coverage", () => {
  it("maps codes to buckets, keeping the UK apart from Europe and broad regions as Other", () => {
    expect(["US", "US-TX", "CA-ON", "GB", "GB-SCT", "DE", "EU", "EUROPE", "MX", "LATAM", "IN", "APAC", "WORLDWIDE", "EMEA", "NORTH_AMERICA", "IL"].map(geographyBucketOf)).toEqual([
      "UNITED_STATES", "UNITED_STATES", "CANADA", "UNITED_KINGDOM", "UNITED_KINGDOM", "EUROPE", "EUROPE", "EUROPE", "LATIN_AMERICA", "LATIN_AMERICA", "APAC", "APAC", "GLOBAL", "OTHER", "OTHER", "OTHER",
    ]);
  });

  it("reads geography in precedence order and never guesses", () => {
    expect(geographyOf(opportunity("x", { residencyRegions: ["US", "CA"], location: "London, United Kingdom" }))).toEqual(["UNITED_STATES", "CANADA"]);
    expect(geographyOf(opportunity("x", { workAuthorizationRegions: ["GB"], location: "Berlin, Germany" }))).toEqual(["UNITED_KINGDOM"]);
    expect(geographyOf(opportunity("x", { location: "Berlin, Germany" }))).toEqual(["EUROPE"]);
    expect(geographyOf(opportunity("x", { location: "Sunnyvale, CA" }))).toEqual(["UNKNOWN"]);
    expect(geographyOf(opportunity("x", { location: "Remote" , remoteStatus: "REMOTE" }))).toEqual(["UNKNOWN"]);
    expect(geographyOf(opportunity("x", { location: "Remote - Anywhere", remoteStatus: "REMOTE" }))).toEqual(["GLOBAL"]);
    expect(geographyOf(opportunity("x"))).toEqual(["UNKNOWN"]);
  });

  it("geography buckets are multi-valued with Unknown in the denominator", () => {
    const items = [opportunity("a", { residencyRegions: ["US", "CA"] }), opportunity("b")];
    const geography = row(insights({ sources: [remoteOk], listings: items.map((item) => listing(item.id, remoteOk, ago(2))), opportunities: items }), "source:s-rok").geography;
    expect(geography.denominator).toBe(2);
    expect(geography.buckets).toMatchObject({ UNITED_STATES: 1, CANADA: 1, UNKNOWN: 1 });
  });

  it("ATS mix from links via the shared known-site table, and direct coverage from employer-ATS provenance", () => {
    const items = [
      opportunity("a", { applicationUrl: "https://jobs.lever.co/acme/1" }),
      opportunity("b", { applicationUrl: "https://job-boards.greenhouse.io/b/jobs/2" }),
      opportunity("c", { applicationUrl: "https://example.com/careers" }),
    ];
    const result = insights({
      sources: [remoteOk, greenhouse],
      listings: [...items.map((item) => listing(item.id, remoteOk, ago(3))), listing("b", greenhouse, ago(2), { duplicateDecision: "MATCH" })],
      opportunities: items,
    });
    const ats = row(result, "source:s-rok").ats;
    expect(ats).toMatchObject({ denominator: 3, known: 2, platforms: { lever: 1, greenhouse: 1 } });
    expect(ats.directShare).toMatchObject({ numerator: 1, denominator: 2 });
    expect(result.platform.atsCoverage).toEqual([
      expect.objectContaining({ platform: "greenhouse", name: "Greenhouse", known: 1, direct: 1 }),
      expect.objectContaining({ platform: "lever", name: "Lever", known: 1, direct: 0 }),
    ]);
  });
});

describe("Source Intelligence: reliability and too little data", () => {
  it("success rate excludes neutral runs; notes when nothing ran or nothing succeeded", () => {
    const run = (status: string, errorCode: string | null, fetched: number | null = 10, kept: number | null = 2) => ({ retrievalSourceId: "s-rok", createdAt: ago(1), status, errorCode, fetched, keptByTerms: kept });
    const result = insights({
      sources: [remoteOk, wwr, greenhouse],
      runs: [
        run("COMPLETED", null, 10, 2),
        run("PARTIAL", "LISTING_FAILURES", 20, 8),
        run("FAILED", "RATE_LIMITED", null, null),
        run("FAILED", "INTERNAL", null, null),
        { retrievalSourceId: "s-wwr", createdAt: ago(1), status: "FAILED", errorCode: "SERVER_ERROR", fetched: null, keptByTerms: null },
      ],
      pendingDetails: [{ retrievalSourceId: "s-rok", count: 4 }],
    });
    const rok = row(result, "source:s-rok");
    expect(rok.reliability).toMatchObject({ runs: 4, successfulRuns: 2, sourceFailures: 1, neutralRuns: 1, pendingDetails: 4 });
    expect(rok.reliability?.successRate).toMatchObject({ numerator: 2, denominator: 3 });
    expect(rok.reliability?.roleFamilyYield).toBeCloseTo(0.3);
    expect(rok.notes).toContain("waiting_for_details");
    expect(row(result, "source:s-wwr").notes).toContain("no_successful_retrieval_in_window");
    expect(row(result, "source:s-gh").notes).toContain("no_runs_in_window");
    expect(row(result, "source:s-gh").discovery.listings).toBe(0);
  });

  it("sorting never ranks a source on an insufficient sample", () => {
    const strong = Array.from({ length: 6 }, (_, index) => opportunity(`s${index}`, { evaluations: [evaluation("COMPLETED", index < 3 ? "APPLY" : "SKIP", ago(1))] }));
    const tiny = [opportunity("t1", { evaluations: [evaluation("COMPLETED", "APPLY", ago(1))] })];
    const result = insights({
      sources: [remoteOk, wwr],
      listings: [...strong.map((item) => listing(item.id, remoteOk, ago(2))), ...tiny.map((item) => listing(item.id, wwr, ago(2)))],
      opportunities: [...strong, ...tiny],
    });
    // We Work Remotely's 100% comes from one evaluation: it is not ranked above Remote OK's 50% of six.
    expect(sortSources(result.automated, "useful_rate").map((item) => item.key)).toEqual(["source:s-rok", "source:s-wwr"]);
    expect(row(result, "source:s-wwr").evaluation.usefulRate.sample).toBe("insufficient");
  });
});

describe("Source Intelligence: a configured source is never counted twice", () => {
  it("a source's own record and its ledger rows (listed, baseline, old scope) are one listing", () => {
    const head = listing("o1", greenhouse, ago(20));
    const ledger = (state: "LISTED" | "HISTORICAL" | "UNTRACKED", firstSeenAt: Date) => ({ retrievalSourceId: "s-gh", externalId: head.externalId!, opportunityId: "o1", firstSeenAt, state });
    const result = insights({
      sources: [greenhouse],
      listings: [head],
      ledger: [ledger("HISTORICAL", ago(21)), ledger("UNTRACKED", ago(20)), ledger("LISTED", ago(19))],
      opportunities: [opportunity("o1")],
    });
    expect(row(result, "source:s-gh").discovery).toMatchObject({ listings: 1, new: 1, alreadyKnown: 0, discovered: 1, exclusive: 1 });
    expect(result.platform.listings).toBe(1);
  });

  it("cross-source MATCH and a later employer ATS: the ATS record and its ledger row are one listing; the board keeps credit", () => {
    const board = listing("o1", remoteOk, ago(30));
    const ats = listing("o1", greenhouse, ago(5), { duplicateDecision: "MATCH" });
    const result = insights({
      sources: [remoteOk, greenhouse],
      listings: [board, ats],
      ledger: [
        { retrievalSourceId: "s-rok", externalId: board.externalId!, opportunityId: "o1", firstSeenAt: ago(30), state: "LISTED" },
        { retrievalSourceId: "s-gh", externalId: ats.externalId!, opportunityId: "o1", firstSeenAt: ago(5), state: "LISTED" },
        { retrievalSourceId: "s-gh", externalId: ats.externalId!, opportunityId: "o1", firstSeenAt: ago(4), state: "UNTRACKED" },
      ],
      opportunities: [opportunity("o1", { markedAppliedAt: ago(2) })],
    });
    expect(row(result, "source:s-rok").discovery).toMatchObject({ listings: 1, new: 1, alreadyKnown: 0 });
    expect(row(result, "source:s-gh").discovery).toMatchObject({ listings: 1, new: 0, alreadyKnown: 1 });
    expect(row(result, "source:s-rok").outcomes.applications).toBe(1);
    expect(row(result, "source:s-gh").outcomes).toMatchObject({ applications: 0, alsoListedBefore: { applications: 1, interviews: 0, offers: 0 } });
    expect(result.platform).toMatchObject({ listings: 2, discovered: 1, new: 1 });
    const detail = buildSourceInsightDetail({ facts: facts({ sources: [remoteOk, greenhouse], listings: [board, ats], ledger: [], opportunities: [opportunity("o1")] }), window: allTime, now, currency: "USD", identity: "source:s-gh" })!;
    expect(detail.opportunities[0]!.listings.map((item) => item.source)).toEqual(["source:s-rok", "source:s-gh"]);
  });
});

describe("Source Intelligence: insufficient samples never set the order", () => {
  const ranked = (useful: number, evaluated: number, id: string) =>
    Array.from({ length: evaluated }, (_, index) => opportunity(`${id}-${index}`, { evaluations: [evaluation("COMPLETED", index < useful ? "APPLY" : "SKIP", ago(1), 0.1)] }));
  const build = (values: { a: [number, number]; b: [number, number] }) => {
    const named = (id: string, name: string, adapter = id) => source(id, adapter, "JOB_BOARD", { name });
    const sources = [named("s-a", "A insufficient"), named("s-b", "B insufficient"), named("s-c", "C small"), named("s-d", "D small"), named("s-e", "E normal")];
    const groups: Record<string, SiOpportunityFact[]> = {
      "s-a": ranked(values.a[0], values.a[1], "a"),
      "s-b": ranked(values.b[0], values.b[1], "b"),
      "s-c": ranked(3, 5, "c"),
      "s-d": ranked(2, 5, "d"),
      "s-e": ranked(6, 20, "e"),
    };
    const all = Object.values(groups).flat();
    const listings = Object.entries(groups).flatMap(([id, items]) => items.map((item) => listing(item.id, sources.find((entry) => entry.id === id)!, ago(2))));
    return insights({ sources, listings, opportunities: all });
  };
  const order = (result: ReturnType<typeof insights>, sort: "useful_rate" | "cost_per_useful") => sortSources(result.automated, sort).map((item) => item.name);

  it("ranks small and normal samples by value and puts insufficient ones after them by name, whatever their value", () => {
    const first = build({ a: [0, 3], b: [3, 3] });
    const swapped = build({ a: [3, 3], b: [0, 3] });
    expect(order(first, "useful_rate")).toEqual(["C small", "D small", "E normal", "A insufficient", "B insufficient"]);
    expect(order(swapped, "useful_rate")).toEqual(order(first, "useful_rate"));
    // The insufficient rows still carry their real values and label.
    expect(row(first, "source:s-b").evaluation.usefulRate).toMatchObject({ value: 1, sample: "insufficient" });
    expect(row(first, "source:s-c").evaluation.usefulRate).toMatchObject({ value: 0.6, sample: "small" });
    expect(row(first, "source:s-e").evaluation.usefulRate.sample).toBe("normal");
  });

  it("cost per useful job and retrieval success rate are not compared on insufficient samples either", () => {
    const result = build({ a: [1, 3], b: [3, 3] });
    // Fewer than 5 useful jobs: no cost comparison. Only E (6 useful) is compared.
    expect(order(result, "cost_per_useful")[0]).toBe("E normal");
    expect(order(result, "cost_per_useful").slice(1)).toEqual(["A insufficient", "B insufficient", "C small", "D small"]);
    const runs = (id: string, ok: number, failed: number) => [
      ...Array.from({ length: ok }, () => ({ retrievalSourceId: id, createdAt: ago(1), status: "COMPLETED" as const, errorCode: null, fetched: 10, keptByTerms: 1 })),
      ...Array.from({ length: failed }, () => ({ retrievalSourceId: id, createdAt: ago(1), status: "FAILED" as const, errorCode: "SERVER_ERROR", fetched: null, keptByTerms: null })),
    ];
    const reliability = insights({ sources: [remoteOk, wwr], runs: [...runs("s-rok", 3, 3), ...runs("s-wwr", 2, 0)] });
    expect(row(reliability, "source:s-wwr").reliability?.successRate).toMatchObject({ value: 1, sample: "insufficient" });
    expect(sortSources(reliability.automated, "success_rate").map((item) => item.key)).toEqual(["source:s-rok", "source:s-wwr"]);
  });
});
