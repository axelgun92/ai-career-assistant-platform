import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  budgetPeriod,
  buildSourceInsightDetail,
  buildSourceInsights,
  type SiFacts,
  type SiSourceMetrics,
  type SiWindow,
} from "@ai-career/core";
import { getDatabaseClient, PrismaBudgetRepository, PrismaSourceIntelligenceRepository } from "@ai-career/database";

// Feature 15 Source Intelligence over the real read model, on the isolated
// test database only. Synthetic histories are seeded directly (no provider,
// no live request), scoped by a unique token, and removed afterwards.

const database = getDatabaseClient();
const token = randomUUID().slice(0, 8);
const now = new Date();
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(now.getTime() - days * day);
const allTime: SiWindow = { key: "all", from: null, to: new Date(now.getTime() + 60_000) };

const created = { sources: [] as string[], opportunities: [] as string[], records: [] as string[], pricing: [] as string[], runs: [] as string[] };
let usd = "";
let eur = "";

async function createSource(adapterKey: string, category: "ATS" | "JOB_BOARD", name: string) {
  const source = await database.retrievalSource.create({
    data: { adapterKey, name: `${name} ${token}`, domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: category, enabled: true, config: {}, trackingScopeKey: `scope-${randomUUID()}` },
  });
  created.sources.push(source.id);
  return source;
}

async function createOpportunity(extra: Record<string, unknown> = {}) {
  const opportunity = await database.opportunity.create({
    data: { title: `Customer Success Manager ${token}`, domain: "customer-success", status: "NORMALIZED", ...extra },
  });
  created.opportunities.push(opportunity.id);
  return opportunity.id;
}

type Source = Awaited<ReturnType<typeof createSource>>;

async function head(opportunityId: string | null, from: Source | "manual" | { site: string }, at: Date, extra: Record<string, unknown> = {}) {
  const data =
    from === "manual"
      ? { source: "manual-input", sourceType: "MANUAL" as const }
      : "site" in from
        ? {
            source: "browser-extension",
            sourceType: "BROWSER_EXTENSION" as const,
            retrievalType: "BROWSER_ASSISTED" as const,
            sourceCategory: "JOB_BOARD" as const,
            externalId: `${from.site}:${randomUUID()}`,
            sourceMetadata: { capture: { site: from.site } },
          }
        : {
            source: from.adapterKey,
            sourceType: from.sourceCategory === "ATS" ? ("ATS" as const) : ("API" as const),
            retrievalType: "OFFICIAL_PUBLIC_API_FEED" as const,
            sourceCategory: from.sourceCategory,
            retrievalSourceId: from.id,
            externalId: `${token}-${randomUUID()}`,
          };
  const record = await database.sourceRecord.create({ data: { ...data, opportunityId, createdAt: at, discoveredAt: at, ...extra } });
  created.records.push(record.id);
  return record;
}

async function evaluate(opportunityId: string, status: "COMPLETED" | "FAILED" | "RUNNING", decision: string | null, at: Date, costs: Array<{ cost: number | null; pricing?: string }>) {
  const evaluation = await database.evaluation.create({
    data: { opportunityId, domain: "customer-success", status, evaluationVersion: "test", domainVersion: "test", ruleVersion: "test", createdAt: at, completedAt: status === "COMPLETED" ? at : null },
  });
  if (decision) {
    await database.recommendation.create({ data: { opportunityId, evaluationId: evaluation.id, decision, explanation: "seeded", evaluationVersion: "test" } });
  }
  let attempt = 0;
  for (const entry of costs) {
    attempt += 1;
    await database.semanticOperationAttempt.create({
      data: {
        evaluationId: evaluation.id,
        opportunityId,
        domain: `si-${token}`,
        operationId: `op-${attempt}`,
        promptVersion: "test",
        attempt,
        provider: "openai",
        model: "test-model",
        status: "SUCCESS",
        durationMs: 10,
        estimatedCost: entry.cost,
        pricingConfigurationId: entry.cost === null ? null : (entry.pricing ?? usd),
        createdAt: at,
      },
    });
  }
  return evaluation.id;
}

async function apply(opportunityId: string, input: { stage: "APPLIED" | "SCREENING" | "OFFER" | "CLOSED"; appliedOn: Date; outcome?: "REJECTED" | "OFFER_ACCEPTED"; toStages?: string[]; interview?: "SCHEDULED" | "CANCELLED" }) {
  const application = await database.application.create({
    data: { opportunityId, stage: input.stage, outcome: input.outcome ?? null, appliedOn: input.appliedOn, closedOn: input.stage === "CLOSED" ? input.appliedOn : null },
  });
  let sequence = 0;
  await database.applicationEvent.create({ data: { applicationId: application.id, sequence: ++sequence, type: "SUBMITTED", occurredOn: input.appliedOn } });
  for (const stage of input.toStages ?? []) {
    await database.applicationEvent.create({ data: { applicationId: application.id, sequence: ++sequence, type: "STAGE_CHANGED", toStage: stage as never, occurredOn: input.appliedOn } });
  }
  if (input.interview) {
    await database.applicationInterview.create({ data: { applicationId: application.id, kind: "RECRUITER_SCREEN", status: input.interview, scheduledAt: input.appliedOn } });
  }
}

const sources: Record<string, Source> = {};
const ids: Record<string, string> = {};

let facts: SiFacts;
const scoped = (all: SiFacts): SiFacts => {
  const ourSources = new Set(created.sources);
  const ourOpportunities = new Set(created.opportunities);
  return {
    sources: all.sources.filter((source) => ourSources.has(source.id)),
    listings: all.listings.filter((listing) => (listing.opportunityId ? ourOpportunities.has(listing.opportunityId) : Boolean(listing.retrievalSourceId && ourSources.has(listing.retrievalSourceId)))),
    ledger: all.ledger.filter((row) => ourSources.has(row.retrievalSourceId)),
    opportunities: all.opportunities.filter((opportunity) => ourOpportunities.has(opportunity.id)),
    runs: all.runs.filter((run) => ourSources.has(run.retrievalSourceId)),
    pendingDetails: all.pendingDetails.filter((row) => ourSources.has(row.retrievalSourceId)),
  };
};
const rowOf = (rows: SiSourceMetrics[], id: string) => {
  const found = rows.find((row) => row.key === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

beforeAll(async () => {
  const pricing = async (currency: string) => {
    const config = await database.aiModelPricingConfiguration.create({
      data: { provider: "openai", model: "test-model", version: `si-${token}-${currency}`, currency, inputCostPerMillionTokens: 1, cachedInputCostPerMillionTokens: 1, outputCostPerMillionTokens: 1, longContextInputMultiplier: 1, longContextOutputMultiplier: 1, effectiveFrom: ago(400) },
    });
    created.pricing.push(config.id);
    return config.id;
  };
  usd = await pricing("USD");
  eur = await pricing("EUR");

  sources.board = await createSource("remote-ok", "JOB_BOARD", "High-volume board");
  sources.ats = await createSource("greenhouse", "ATS", "Quality ATS");
  sources.ats2 = await createSource("greenhouse", "ATS", "Second board of same ATS");
  sources.flaky = await createSource("we-work-remotely", "JOB_BOARD", "Unreliable board");
  sources.budget = await createSource("himalayas", "JOB_BOARD", "Budget-deferred board");

  // Low-volume, high-quality ATS: 6 jobs, 5 useful, 1 skip.
  for (let index = 0; index < 6; index += 1) {
    const id = await createOpportunity({ location: index % 2 ? "London, United Kingdom" : "Austin, Texas, United States" });
    ids[`ats${index}`] = id;
    await head(id, sources.ats, ago(50 - index));
    await evaluate(id, "COMPLETED", index === 5 ? "SKIP" : index % 2 ? "REVIEW" : "APPLY", ago(45 - index), [{ cost: 0.1 }, { cost: 0.1 }]);
  }
  // High-volume, high-duplicate board: 2 new jobs plus 4 listings of the ATS's jobs.
  for (let index = 0; index < 2; index += 1) {
    const id = await createOpportunity();
    ids[`board${index}`] = id;
    await head(id, sources.board, ago(30 - index));
  }
  for (let index = 0; index < 4; index += 1) await head(ids[`ats${index}`]!, sources.board, ago(40 - index), { duplicateDecision: "MATCH" });

  // Multi-source: the board found it first; the ATS listed it later and its link is canonical.
  ids.multi = await createOpportunity({ canonicalUrl: "https://job-boards.greenhouse.io/acme/jobs/1" });
  await head(ids.multi, sources.board, ago(20));
  const atsCopy = await head(ids.multi, sources.ats, ago(19), { duplicateDecision: "MATCH" });
  await evaluate(ids.multi, "COMPLETED", "APPLY", ago(18), [{ cost: 0.2 }]);
  await apply(ids.multi, { stage: "OFFER", appliedOn: ago(17), toStages: ["SCREENING", "INTERVIEWING", "OFFER"], interview: "SCHEDULED" });
  // A second configured Greenhouse source saw the same listing: re-observation wrote no record, only its ledger row.
  await database.retrievedListing.create({
    data: { retrievalSourceId: sources.ats2.id, trackingScopeKey: sources.ats2.trackingScopeKey!, source: "greenhouse", externalId: atsCopy.externalId!, opportunityId: ids.multi, state: "LISTED", firstSeenAt: ago(18), lastSeenAt: ago(1) },
  });

  // Unreliable source: only failed runs.
  for (const [code, daysAgo] of [["RATE_LIMITED", 3], ["SERVER_ERROR", 2], ["INTERNAL", 1]] as const) {
    const run = await database.retrievalRun.create({ data: { retrievalSourceId: sources.flaky.id, trigger: "SCHEDULE", status: "FAILED", errorCode: code, createdAt: ago(daysAgo) } });
    created.runs.push(run.id);
  }
  const good = await database.retrievalRun.create({ data: { retrievalSourceId: sources.board.id, trigger: "SCHEDULE", status: "COMPLETED", counts: { fetched: 40, keptByTerms: 6 }, createdAt: ago(2) } });
  created.runs.push(good.id);

  // Budget-deferred source: 4 waiting on budget or usage limit, 1 evaluated useful, 1 cancelled deferral.
  for (let index = 0; index < 4; index += 1) {
    const id = await createOpportunity();
    await head(id, sources.budget, ago(10 - index));
    await database.deferredEvaluation.create({ data: { opportunityId: id, domain: "customer-success", reasonCode: index % 2 ? "USAGE_LIMIT_REACHED" : index === 0 ? "BUDGET_UNAVAILABLE" : "AI_BUDGET_LIMIT", reasonSnapshot: {}, lastCheckedAt: ago(1) } });
  }
  ids.budgetEvaluated = await createOpportunity();
  await head(ids.budgetEvaluated, sources.budget, ago(9));
  await evaluate(ids.budgetEvaluated, "COMPLETED", "REVIEW", ago(8), [{ cost: 0.3 }]);
  ids.cancelled = await createOpportunity();
  await head(ids.cancelled, sources.budget, ago(9));
  await database.deferredEvaluation.create({ data: { opportunityId: ids.cancelled, domain: "customer-success", status: "CANCELLED", reasonCode: "AI_BUDGET_LIMIT", reasonSnapshot: {}, lastCheckedAt: ago(2), cancelledAt: ago(2) } });

  // Applications without interviews: one recent (awaiting response), one old and rejected; plus a lifecycle-only application.
  await apply(ids.ats0!, { stage: "APPLIED", appliedOn: ago(5) });
  await apply(ids.ats1!, { stage: "CLOSED", appliedOn: ago(40), outcome: "REJECTED", interview: "CANCELLED" });
  await database.opportunityUserAction.create({ data: { opportunityId: ids.ats2!, action: "MARK_APPLIED", fromStatus: "RECOMMENDED", toStatus: "APPLIED", createdAt: ago(35) } });

  // Failed evaluation plus a reevaluation: spend split; an unknown-cost and an other-currency attempt.
  await evaluate(ids.ats3!, "FAILED", null, ago(30), [{ cost: 0.05 }, { cost: null }]);
  await evaluate(ids.ats4!, "COMPLETED", "APPLY", ago(10), [{ cost: 0.4, pricing: eur }]);

  // Listing removed after application keeps its credit.
  const removedHead = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: ids.ats1!, retrievalSourceId: sources.ats.id } });
  await database.retrievedListing.create({
    data: { retrievalSourceId: sources.ats.id, trackingScopeKey: sources.ats.trackingScopeKey!, source: "greenhouse", externalId: removedHead.externalId!, opportunityId: ids.ats1!, removalCapable: true, state: "REMOVED", firstSeenAt: ago(49), lastSeenAt: ago(20), removedAt: ago(10) },
  });

  // A probable-duplicate pair from the board; a record that failed normalization.
  const probable = await createOpportunity();
  await head(probable, sources.board, ago(4), { duplicateDecision: "PROBABLE_MATCH" });
  await database.duplicateReference.create({ data: { opportunityId: probable, relatedOpportunityId: ids.board0!, decision: "PROBABLE_MATCH", confidence: 0.8 } });
  await head(null, sources.board, ago(3));

  // User-collected: a manual entry and an extension capture of an existing job.
  ids.manual = await createOpportunity();
  await head(ids.manual, "manual", ago(15));
  await head(ids.board1!, { site: "linkedin" }, ago(12), { duplicateDecision: "MATCH" });

  // Double-count guard. The board's own listing of board0 also has ledger rows (listed now, the Feature 13
  // baseline scope and an earlier tracking scope) and a changed version (same-source re-observation);
  // the ATS's MATCH copy of the multi-source job has its own ledger row. None may add a listing.
  const boardHead = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: ids.board0!, retrievalSourceId: sources.board.id } });
  ids.boardVersion = (await head(ids.board0!, sources.board, ago(20), { previousSourceRecordId: boardHead.id, externalId: boardHead.externalId, contentHash: `changed-${token}` })).id;
  for (const [scope, state, daysAgo] of [[sources.board.trackingScopeKey!, "LISTED", 30], ["", "HISTORICAL", 31], [`old-scope-${token}`, "UNTRACKED", 29]] as const) {
    await database.retrievedListing.create({
      data: { retrievalSourceId: sources.board.id, trackingScopeKey: scope, source: "remote-ok", externalId: boardHead.externalId!, opportunityId: ids.board0!, state, firstSeenAt: ago(daysAgo), lastSeenAt: ago(1) },
    });
  }
  await database.retrievedListing.create({
    data: { retrievalSourceId: sources.ats.id, trackingScopeKey: sources.ats.trackingScopeKey!, source: "greenhouse", externalId: atsCopy.externalId!, opportunityId: ids.multi, state: "LISTED", firstSeenAt: ago(19), lastSeenAt: ago(1) },
  });

  facts = scoped(await new PrismaSourceIntelligenceRepository().facts({ currency: "USD" }));
});

afterAll(async () => {
  // Versions first: previousSourceRecordId restricts deleting the record it points to.
  await database.sourceRecord.deleteMany({ where: { id: { in: created.records }, previousSourceRecordId: { not: null } } });
  await database.sourceRecord.deleteMany({ where: { id: { in: created.records } } });
  await database.opportunity.deleteMany({ where: { id: { in: created.opportunities } } });
  await database.retrievalRun.deleteMany({ where: { id: { in: created.runs } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: created.sources } } });
  await database.aiModelPricingConfiguration.deleteMany({ where: { id: { in: created.pricing } } });
  await database.$disconnect();
});

describe("Source Intelligence read model (isolated test database)", () => {
  it("credits first discovery and keeps presence separate across sources", () => {
    const result = buildSourceInsights({ facts, window: allTime, now, currency: "USD" });
    const board = rowOf(result.automated, `source:${sources.board!.id}`);
    const ats = rowOf(result.automated, `source:${sources.ats!.id}`);
    const ats2 = rowOf(result.automated, `source:${sources.ats2!.id}`);
    expect(board.discovery).toMatchObject({ listings: 8, new: 4, alreadyKnown: 4, possibleDuplicates: 1, notProcessed: 1 });
    expect(board.discovery.duplicateRate).toMatchObject({ numerator: 4, denominator: 8, sample: "small" });
    expect(ats.discovery).toMatchObject({ listings: 7, new: 6, alreadyKnown: 1 });
    expect(ats2.discovery).toMatchObject({ listings: 1, new: 0, alreadyKnown: 1, discovered: 1 });
    // The multi-source job's evaluation, cost and offer go to the board only.
    expect(board.outcomes).toMatchObject({ applications: 1, interviews: 1, offers: 1 });
    expect(ats.outcomes.alsoListedBefore).toEqual({ applications: 1, interviews: 1, offers: 1 });
    expect(ats2.outcomes.alsoListedBefore.applications).toBe(1);
    // Platform totals never double count.
    const credited = result.automated.reduce((sum, row) => sum + row.discovery.new, 0) + result.userCollected.reduce((sum, row) => sum + row.discovery.new, 0);
    expect(credited).toBe(result.platform.new);
    expect(result.platform.outcomes.offers).toBe(1);
  });

  it("never counts a configured source twice: its own record, its ledger rows and a changed version are one listing", () => {
    // Only chain heads are listings; the changed version is not one.
    expect(facts.listings.some((listing) => listing.recordId === ids.boardVersion)).toBe(false);
    const result = buildSourceInsights({ facts, window: allTime, now, currency: "USD" });
    expect(rowOf(result.automated, `source:${sources.board!.id}`).discovery).toMatchObject({ listings: 8, new: 4, alreadyKnown: 4 });
    expect(rowOf(result.automated, `source:${sources.ats!.id}`).discovery).toMatchObject({ listings: 7, new: 6, alreadyKnown: 1 });
    expect(rowOf(result.automated, `source:${sources.ats2!.id}`).discovery).toMatchObject({ listings: 1, alreadyKnown: 1 });
    const board0 = buildSourceInsightDetail({ facts, window: allTime, now, currency: "USD", identity: `source:${sources.board!.id}` })!.opportunities.find((row) => row.id === ids.board0)!;
    expect(board0.listings.map((listing) => listing.source)).toEqual([`source:${sources.board!.id}`]);
    const multi = buildSourceInsightDetail({ facts, window: allTime, now, currency: "USD", identity: `source:${sources.ats!.id}` })!.opportunities.find((row) => row.id === ids.multi)!;
    expect(multi.listings.map((listing) => listing.source)).toEqual([`source:${sources.board!.id}`, `source:${sources.ats!.id}`, `source:${sources.ats2!.id}`]);
  });

  it("separates the user-collected section and never ranks it with automated sources", () => {
    const result = buildSourceInsights({ facts, window: allTime, now, currency: "USD" });
    expect(result.userCollected.map((row) => row.key).sort()).toEqual(["extension:linkedin", "manual"]);
    expect(rowOf(result.userCollected, "extension:linkedin").discovery).toMatchObject({ alreadyKnown: 1, new: 0 });
    expect(rowOf(result.userCollected, "manual").discovery.new).toBe(1);
    expect(result.automated.every((row) => row.group === "automated")).toBe(true);
  });

  it("keeps budget and usage-limit deferrals neutral; a cancelled deferral is simply not yet evaluated", () => {
    const result = buildSourceInsights({ facts, window: allTime, now, currency: "USD" });
    const budget = rowOf(result.automated, `source:${sources.budget!.id}`).evaluation;
    expect(budget.states).toMatchObject({ waiting_budget: 2, waiting_usage_limit: 2, evaluated: 1, not_yet_evaluated: 1 });
    expect(budget.usefulRate).toMatchObject({ numerator: 1, denominator: 1, value: 1, sample: "insufficient" });
    expect(budget.coverage).toMatchObject({ numerator: 1, denominator: 6 });
  });

  it("evaluation quality, outcomes and maturity for the quality ATS", () => {
    const result = buildSourceInsights({ facts, window: allTime, now, currency: "USD" });
    const ats = rowOf(result.automated, `source:${sources.ats!.id}`);
    expect(ats.evaluation).toMatchObject({ evaluated: 6, apply: 3, review: 2, skip: 1, useful: 5 });
    expect(ats.evaluation.usefulRate.sample).toBe("small");
    // ats0 awaiting response (5 days), ats1 rejected (cancelled screen is no interview), ats2 lifecycle-only.
    expect(ats.outcomes).toMatchObject({ applications: 3, awaitingResponse: 1, matureApplications: 2, interviews: 0, offers: 0 });
    expect(rowOf(result.automated, `source:${sources.ats!.id}`).discovery.new).toBe(6);
  });

  it("cost per useful uses completed spend in the report currency; failed and unknown spend stay separate", () => {
    const result = buildSourceInsights({ facts, window: allTime, now, currency: "USD" });
    const ats = rowOf(result.automated, `source:${sources.ats!.id}`).cost;
    // Six completed evaluations at 0.2 each, plus the EUR reevaluation counted as unknown.
    expect(ats).toMatchObject({ completedSpend: 1.2, failedSpend: 0.05, completedUnknownAttempts: 1, unknownAttempts: 2, incomplete: true });
    expect(ats.costPerUseful).toBeCloseTo(1.2 / 5);
    const flaky = rowOf(result.automated, `source:${sources.flaky!.id}`);
    expect(flaky.cost.costPerUseful).toBeNull();
    expect(flaky.reliability).toMatchObject({ runs: 3, successfulRuns: 0, sourceFailures: 2, neutralRuns: 1 });
    expect(flaky.notes).toContain("no_successful_retrieval_in_window");
  });

  it("platform spend reconciles with the persisted attempts and the budget usage breakdown", async () => {
    const result = buildSourceInsights({ facts, window: allTime, now, currency: "USD" });
    const attempts = await database.semanticOperationAttempt.findMany({ where: { domain: `si-${token}` }, include: { pricingConfiguration: true } });
    const known = attempts.filter((attempt) => attempt.estimatedCost !== null && attempt.pricingConfiguration?.currency === "USD").reduce((sum, attempt) => sum + attempt.estimatedCost!.toNumber(), 0);
    expect(result.platform.cost.totalSpend).toBeCloseTo(known);
    expect(result.platform.cost.unknownAttempts).toBe(attempts.length - attempts.filter((attempt) => attempt.estimatedCost !== null && attempt.pricingConfiguration?.currency === "USD").length);
    const repository = new PrismaBudgetRepository();
    const periods = new Map<string, ReturnType<typeof budgetPeriod>>();
    for (const attempt of attempts) {
      const period = budgetPeriod(attempt.createdAt, "UTC");
      periods.set(period.label, period);
    }
    let breakdownKnown = 0;
    let breakdownUnknown = 0;
    for (const period of periods.values()) {
      for (const row of await repository.periodUsageBreakdown({ period, currency: "USD" })) {
        if (row.domain !== `si-${token}`) continue;
        breakdownKnown += row.knownCost ?? 0;
        breakdownUnknown += row.unknownCostAttempts;
      }
    }
    expect(result.platform.cost.totalSpend).toBeCloseTo(breakdownKnown);
    expect(result.platform.cost.unknownAttempts).toBe(breakdownUnknown);
  });

  it("geography, ATS coverage, reliability and too little data", () => {
    const result = buildSourceInsights({ facts, window: allTime, now, currency: "USD" });
    const ats = rowOf(result.automated, `source:${sources.ats!.id}`);
    expect(ats.geography.buckets).toMatchObject({ UNITED_STATES: 3, UNITED_KINGDOM: 3, UNKNOWN: 1 });
    expect(ats.ats).toMatchObject({ known: 7, platforms: { greenhouse: 7 } });
    const board = rowOf(result.automated, `source:${sources.board!.id}`);
    expect(board.ats.known).toBe(5);
    expect(board.ats.directShare).toMatchObject({ numerator: 5, denominator: 5 });
    expect(board.reliability).toMatchObject({ runs: 1, successfulRuns: 1, lastListingsScanned: 40 });
    expect(board.reliability?.roleFamilyYield).toBeCloseTo(0.15);
    const ats2 = rowOf(result.automated, `source:${sources.ats2!.id}`);
    expect(ats2.evaluation.usefulRate.sample).toBe("none");
    expect(ats2.notes).toContain("no_runs_in_window");
  });

  it("windows: a 7-day window holds only recent listings and cohorts", () => {
    const week: SiWindow = { key: "7d", from: ago(7), to: new Date(now.getTime() + 60_000) };
    const result = buildSourceInsights({ facts, window: week, now, currency: "USD" });
    const board = rowOf(result.automated, `source:${sources.board!.id}`);
    expect(board.discovery).toMatchObject({ listings: 1, new: 1, notProcessed: 1 });
    expect(rowOf(result.automated, `source:${sources.ats!.id}`).discovery.listings).toBe(0);
  });

  it("drill-down lists every listing's provenance and keeps credit visible", () => {
    const detail = buildSourceInsightDetail({ facts, window: allTime, now, currency: "USD", identity: `source:${sources.ats!.id}` })!;
    const multi = detail.opportunities.find((row) => row.id === ids.multi)!;
    expect(multi).toMatchObject({ credit: "also_listed", discoveredBy: `source:${sources.board!.id}` });
    expect(multi.listings.map((listing) => [listing.source, listing.via])).toEqual([
      [`source:${sources.board!.id}`, "record"],
      [`source:${sources.ats!.id}`, "record"],
      [`source:${sources.ats2!.id}`, "ledger"],
    ]);
    const removed = detail.opportunities.find((row) => row.id === ids.ats1)!;
    expect(removed.credit).toBe("discovered");
    expect(removed.listings[0]!.ledgerState).toBe("REMOVED");
    expect(buildSourceInsightDetail({ facts, window: allTime, now, currency: "USD", identity: "source:00000000-0000-0000-0000-000000000000" })).toBeNull();
  });
});
