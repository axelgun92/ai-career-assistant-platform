import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMarketAnalytics, parseMarketQuery, type MarketOpportunityFact } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { getDatabaseClient, jdReconstructionOperationId, PrismaMarketAnalyticsRepository } from "@ai-career/database";

// Feature 16 Job-Market Analytics over the real read model, on the isolated
// test database only. Synthetic jobs are seeded directly (no provider, no live
// request), scoped by a unique token, and removed afterwards.

const database = getDatabaseClient();
const token = randomUUID().slice(0, 8);
const now = new Date();
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(now.getTime() - days * day);
const terms = customerSuccessDiscoveryConfiguration.titleTerms;

const created = { sources: [] as string[], opportunities: [] as string[], records: [] as string[] };
const ids: Record<string, string> = {};
let facts: MarketOpportunityFact[];
let sourceId = "";
let scopeKey = "";

async function createOpportunity(title: string, extra: Record<string, unknown> = {}) {
  const opportunity = await database.opportunity.create({
    data: { title: `${title} ${token}`, domain: "customer-success", status: "NORMALIZED", firstSeenAt: ago(5), ...extra },
  });
  created.opportunities.push(opportunity.id);
  return opportunity.id;
}

async function record(opportunityId: string, kind: "automated" | "manual" | "extension", at = ago(5), extra: Record<string, unknown> = {}) {
  const data =
    kind === "manual"
      ? { source: "manual-input", sourceType: "MANUAL" as const }
      : kind === "extension"
        ? { source: "browser-extension", sourceType: "BROWSER_EXTENSION" as const, externalId: `linkedin:${randomUUID()}` }
        : { source: "greenhouse", sourceType: "ATS" as const, retrievalSourceId: sourceId, externalId: `${token}-${randomUUID()}` };
  const row = await database.sourceRecord.create({ data: { ...data, opportunityId, createdAt: at, discoveredAt: at, ...extra } });
  created.records.push(row.id);
  return row;
}

async function automatedJob(title: string, extra: Record<string, unknown> = {}) {
  const id = await createOpportunity(title, extra);
  await record(id, "automated");
  return id;
}

const reconstruction = (requirements: Array<{ requirement: string; category: string; strength: string; statedYears?: number }>) => ({
  requirements: requirements.map((item) => ({
    statedYears: null,
    statedYearsMaximum: null,
    statedYearsOpenEnded: false,
    experienceSpecificity: null,
    evidenceReferences: ["evidence-1"],
    ambiguity: { isAmbiguous: false, explanation: null },
    ...item,
  })),
});

async function evaluate(
  opportunityId: string,
  status: "COMPLETED" | "FAILED" | "RUNNING",
  decision: string | null,
  extra: { role?: string; segment?: string; requirements?: ReturnType<typeof reconstruction>; version?: string; at?: Date } = {},
) {
  const at = extra.at ?? ago(2);
  const domainResult =
    status === "COMPLETED"
      ? {
          hardFilters: { role: { classification: extra.role ?? "CORE_CS" }, ...(extra.requirements ? { reconstruction: extra.requirements } : {}) },
          companyAlignment: { alignment: { customerSegment: { classification: extra.segment ?? "UNKNOWN" } } },
          opportunityPriority: { band: "HIGH" },
        }
      : undefined;
  const evaluation = await database.evaluation.create({
    data: {
      opportunityId,
      domain: "customer-success",
      status,
      evaluationVersion: "test",
      domainVersion: "test",
      ruleVersion: "test",
      createdAt: at,
      completedAt: status === "COMPLETED" ? at : null,
      ...(domainResult ? { domainResult } : {}),
    },
  });
  if (decision) {
    await database.recommendation.create({ data: { opportunityId, evaluationId: evaluation.id, decision, explanation: "seeded", evaluationVersion: "test" } });
  }
  if (extra.version) {
    await database.semanticOperationAttempt.create({
      data: {
        evaluationId: evaluation.id,
        opportunityId,
        domain: `market-${token}`,
        operationId: jdReconstructionOperationId,
        promptVersion: extra.version,
        attempt: 1,
        provider: "openai",
        model: "test-model",
        status: "SUCCESS",
        durationMs: 10,
        createdAt: at,
      },
    });
  }
}

const market = (params: Record<string, string> = {}) =>
  buildMarketAnalytics({ opportunities: facts, titleTerms: terms, query: parseMarketQuery({ window: "30d", ...params }, now, terms) });
const counts = (rows: Array<{ key: string; count: number }>) => Object.fromEntries(rows.map((row) => [row.key, row.count]));

beforeAll(async () => {
  const source = await database.retrievalSource.create({
    data: { adapterKey: "greenhouse", name: `Market ATS ${token}`, domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", enabled: true, config: {}, trackingScopeKey: `scope-${randomUUID()}` },
  });
  created.sources.push(source.id);
  sourceId = source.id;
  scopeKey = source.trackingScopeKey!;

  // A job two sources listed (MATCH): one observation.
  ids.multi = await automatedJob("Senior Customer Success Manager", {
    seniority: "SENIOR", salaryMin: 100_000, salaryMax: 120_000, currency: "USD", compensationBasis: "BASE",
    location: "Toronto, Ontario, Canada", residencyRegions: ["US", "CA"], remoteStatus: "REMOTE", workArrangements: ["REMOTE"],
  });
  await record(ids.multi, "automated", ago(4), { duplicateDecision: "MATCH" });
  await evaluate(ids.multi, "COMPLETED", "APPLY", {
    role: "CORE_CS", segment: "ENTERPRISE", version: "cs-jd-reconstruction-v3",
    requirements: reconstruction([
      { requirement: "5+ years of Customer Success", category: "EXPERIENCE", strength: "REQUIRED", statedYears: 5 },
      { requirement: "Gainsight", category: "TOOL", strength: "PREFERRED" },
      { requirement: "Based in North America", category: "LOCATION", strength: "REQUIRED" },
    ]),
  });

  // Mixed currencies and bases; min-only, max-only, exact.
  ids.ote = await automatedJob("Customer Success Manager", { salaryMin: 150_000, salaryMax: 170_000, currency: "USD", compensationBasis: "OTE", workArrangements: ["REMOTE", "HYBRID"] });
  ids.minOnly = await automatedJob("Customer Success Manager", { salaryMin: 90_000, currency: "USD", compensationBasis: "BASE", remoteStatus: "HYBRID", workArrangements: ["HYBRID"] });
  ids.maxOnly = await automatedJob("Customer Success Manager", { salaryMax: 140_000, currency: "USD", compensationBasis: "BASE", remoteStatus: "ONSITE", workArrangements: ["ONSITE"] });
  ids.exact = await automatedJob("Onboarding Specialist", { salaryMin: 110_000, salaryMax: 110_000, currency: "USD", compensationBasis: "BASE", location: "London, United Kingdom" });
  ids.cad = await automatedJob("Implementation Consultant", { salaryMin: 80_000, salaryMax: 90_000, currency: "CAD", compensationBasis: "BASE" });
  ids.eur = await automatedJob("Account Executive", { salaryMin: 60_000, salaryMax: 70_000, currency: "EUR" });
  // Tiered pay: three tiers, one job, never in single-range statistics.
  ids.tiered = await automatedJob("Customer Success Manager", {
    compensationBasis: "BASE",
    compensationTiers: [
      { label: "Zone A", minimum: 130_000, maximum: 150_000, currency: "USD" },
      { label: "Zone B", minimum: 115_000, maximum: 135_000, currency: "USD" },
      { label: "Zone C", minimum: 100_000, maximum: 120_000, currency: "USD" },
    ],
  });

  // Evaluation states.
  await evaluate(ids.ote, "COMPLETED", "REVIEW", { segment: "SMB", version: "cs-jd-reconstruction-v3", requirements: reconstruction([{ requirement: "gainsight", category: "TOOL", strength: "REQUIRED" }]) });
  await evaluate(ids.minOnly, "COMPLETED", "SKIP", { role: "SALES_HEAVY", version: "cs-jd-reconstruction-v7", requirements: reconstruction([{ requirement: "Salesforce", category: "TOOL", strength: "REQUIRED" }]) });
  await evaluate(ids.maxOnly, "FAILED", null);
  await evaluate(ids.exact, "RUNNING", null);
  await database.deferredEvaluation.create({ data: { opportunityId: ids.cad, domain: "customer-success", reasonCode: "AI_BUDGET_LIMIT", reasonSnapshot: {}, lastCheckedAt: ago(1) } });
  await database.deferredEvaluation.create({ data: { opportunityId: ids.eur, domain: "customer-success", reasonCode: "USAGE_LIMIT_REACHED", reasonSnapshot: {}, lastCheckedAt: ago(1) } });

  // User-collected only: a manual entry and an extension capture.
  ids.manual = await createOpportunity("Customer Success Manager");
  await record(ids.manual, "manual");
  ids.extension = await createOpportunity("Client Success Lead");
  await record(ids.extension, "extension");
  // Origin rule (earliest SourceRecord by createdAt, id): a job the user captured first stays
  // user-collected even when automated retrieval lists it later; an automated-origin job stays
  // automated when the user captures it later.
  ids.manualThenFound = await createOpportunity("Customer Success Manager");
  await record(ids.manualThenFound, "manual", ago(5));
  await record(ids.manualThenFound, "automated", ago(4), { duplicateDecision: "MATCH" });
  ids.extensionThenFound = await createOpportunity("Customer Success Manager");
  await record(ids.extensionThenFound, "extension", ago(5));
  await record(ids.extensionThenFound, "automated", ago(4), { duplicateDecision: "MATCH" });
  ids.automatedThenCaptured = await createOpportunity("Customer Success Manager");
  await record(ids.automatedThenCaptured, "automated", ago(5));
  await record(ids.automatedThenCaptured, "manual", ago(4), { duplicateDecision: "MATCH" });
  await record(ids.automatedThenCaptured, "extension", ago(3), { duplicateDecision: "MATCH" });

  // An annual amount with no stated currency: coverage only.
  ids.unstated = await automatedJob("Customer Success Manager", { salaryMin: 70_000, salaryMax: 75_000, compensationBasis: "BASE" });

  // An unresolved probable-duplicate pair: both count, the pair once.
  ids.probable = await automatedJob("Customer Success Manager");
  await database.duplicateReference.create({ data: { opportunityId: ids.probable, relatedOpportunityId: ids.maxOnly, decision: "PROBABLE_MATCH", confidence: 0.8 } });

  // No longer listed: its only removal-capable listing was removed.
  ids.removed = await createOpportunity("Customer Success Manager");
  const removedRecord = await record(ids.removed, "automated");
  await database.retrievedListing.create({
    data: { retrievalSourceId: sourceId, trackingScopeKey: scopeKey, source: "greenhouse", externalId: removedRecord.externalId!, opportunityId: ids.removed, removalCapable: true, state: "REMOVED", firstSeenAt: ago(5), lastSeenAt: ago(3), removedAt: ago(2) },
  });

  // Outside the 30-day cohort by firstSeenAt (created recently, evaluated recently).
  ids.old = await automatedJob("Customer Success Manager", { firstSeenAt: ago(45) });
  await evaluate(ids.old, "COMPLETED", "APPLY");

  const ours = new Set(created.opportunities);
  const before = await Promise.all([database.opportunity.count(), database.evaluation.count(), database.sourceRecord.count(), database.duplicateReference.count()]);
  facts = (await new PrismaMarketAnalyticsRepository().facts()).filter((fact) => ours.has(fact.id));
  const after = await Promise.all([database.opportunity.count(), database.evaluation.count(), database.sourceRecord.count(), database.duplicateReference.count()]);
  expect(after).toEqual(before);
});

afterAll(async () => {
  await database.sourceRecord.deleteMany({ where: { id: { in: created.records } } });
  await database.opportunity.deleteMany({ where: { id: { in: created.opportunities } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: created.sources } } });
  await database.$disconnect();
});

describe("Job-Market Analytics read model (isolated test database)", () => {
  it("reads one fact per canonical opportunity and flags collection, duplicates and removal", () => {
    expect(facts).toHaveLength(created.opportunities.length);
    const byId = new Map(facts.map((fact) => [fact.id, fact]));
    expect(byId.get(ids.multi!)!.automated).toBe(true);
    expect(byId.get(ids.manual!)!.automated).toBe(false);
    expect(byId.get(ids.extension!)!.automated).toBe(false);
    expect(byId.get(ids.manualThenFound!)!.automated).toBe(false);
    expect(byId.get(ids.extensionThenFound!)!.automated).toBe(false);
    expect(byId.get(ids.automatedThenCaptured!)!.automated).toBe(true);
    expect(byId.get(ids.unstated!)).toMatchObject({ currency: null, salaryMin: 70_000 });
    expect(byId.get(ids.probable!)!.probableUnresolved).toBe(true);
    expect(byId.get(ids.maxOnly!)!.probableUnresolved).toBe(false);
    expect(byId.get(ids.removed!)!.noLongerListed).toBe(true);
    expect(byId.get(ids.multi!)!.noLongerListed).toBe(false);
    expect(byId.get(ids.tiered!)!.compensationTiers).toHaveLength(3);
    expect(byId.get(ids.minOnly!)).toMatchObject({ salaryMin: 90_000, salaryMax: null });
  });

  it("reads evaluated facts as stored, with the reconstruction version from the recorded call", () => {
    const evaluation = facts.find((fact) => fact.id === ids.multi)!.evaluations[0]!;
    expect(evaluation).toMatchObject({ status: "COMPLETED", decision: "APPLY", roleClassification: "CORE_CS", customerSegment: "ENTERPRISE", reconstructionVersion: "cs-jd-reconstruction-v3" });
    expect(evaluation.requirements?.map((item) => item.category)).toEqual(["EXPERIENCE", "TOOL", "LOCATION"]);
    expect(evaluation.requirements?.[0]).toMatchObject({ statedYears: 5, statedYearsOpenEnded: false });
    const failed = facts.find((fact) => fact.id === ids.maxOnly)!.evaluations[0]!;
    expect(failed).toMatchObject({ status: "FAILED", requirements: null, reconstructionVersion: null });
  });

  it("defaults to automated-origin jobs only, counting a multi-source job once, and adds user captures with the bias note", () => {
    const automated = market();
    // multi, ote, minOnly, maxOnly, exact, cad, eur, tiered, probable, removed, automatedThenCaptured, unstated.
    expect(automated.overview.total).toBe(12);
    expect(automated.notes.selectionBias).toBeNull();
    expect(automated.overview.coverage.probableDuplicates).toBe(1);
    const all = market({ collected: "all" });
    // + manual, extension, manualThenFound, extensionThenFound.
    expect(all.overview.total).toBe(16);
    expect(all.notes.selectionBias).toMatch(/selection bias/);
    expect(market({ excludeRemoved: "1" }).overview.total).toBe(11);
    expect(market({ window: "all" }).overview.total).toBe(13);
  });

  it("keeps currencies and bases apart, with min-only, max-only, exact and tiers handled separately", () => {
    const salary = market().salary;
    expect(salary.currencies.map((row) => row.currency)).toEqual(["USD", "CAD", "EUR", "UNKNOWN"]);
    expect(salary.currencyNotStated).toBe(1);
    expect(salary.selectedCurrency).toBe("USD");
    const base = salary.stats.find((row) => row.basis === "BASE")!;
    expect(base).toMatchObject({ jobs: 4, exact: 1, range: 1, minOnly: 1, maxOnly: 1 });
    expect(base.medianMidpoint).toMatchObject({ value: 110_000, n: 2, sample: "insufficient" });
    expect(base.medianMinimum).toMatchObject({ value: 100_000, n: 3 });
    expect(base.medianMaximum).toMatchObject({ value: 120_000, n: 3 });
    expect(salary.stats.find((row) => row.basis === "OTE")!.medianMidpoint.value).toBe(160_000);
    expect(salary.tiered).toBe(1);
    expect(salary.tiers.filter((row) => row.opportunityId === ids.tiered)).toHaveLength(3);
    const cad = market({ currency: "CAD" }).salary;
    expect(cad.stats).toHaveLength(1);
    expect(cad.stats[0]).toMatchObject({ currency: "CAD", medianMidpoint: { value: 85_000 } });
    expect(market({ currency: "EUR" }).salary.stats[0]!.basis).toBe("UNKNOWN");
    // The unknown-currency amount counts toward coverage only; probable, removed and automatedThenCaptured state none.
    expect(salary.known).toMatchObject({ numerator: 9, denominator: 12 });
    expect(salary.stats.every((row) => row.currency === "USD")).toBe(true);
  });

  it("groups titles by discovery term and keeps the evaluator role classification evaluated-only", () => {
    const roles = market().roles;
    expect(counts(roles.titleGroups.rows)).toEqual({ "Customer Success": 9, Onboarding: 1, Implementation: 1, OTHER: 1 });
    expect(roles.roleClassification.evaluated).toBe(3);
    expect(counts(roles.roleClassification.distribution.rows)).toMatchObject({ CORE_CS: 2, SALES_HEAVY: 1 });
    expect(market({ titleGroup: "OTHER" }).overview.total).toBe(1);
  });

  it("separates job location from hiring eligibility and reads arrangements", () => {
    const geography = market().geography;
    expect(counts(geography.jobLocation.rows)).toMatchObject({ CANADA: 1, UNITED_KINGDOM: 1, UNKNOWN: 10 });
    expect(counts(geography.hiringEligibility.rows)).toMatchObject({ UNITED_STATES: 1, CANADA: 1, UNKNOWN: 11 });
    expect(counts(geography.arrangement.rows)).toMatchObject({ REMOTE: 1, HYBRID: 1, ONSITE: 1, SEVERAL: 1, UNKNOWN: 8 });
    expect(market({ arrangement: "SEVERAL" }).overview.total).toBe(1);
    expect(market({ region: "UNITED_KINGDOM" }).overview.total).toBe(1);
  });

  it("keeps explicit and Unknown seniority", () => {
    expect(counts(market().seniority.distribution.rows)).toMatchObject({ SENIOR: 1, UNKNOWN: 11 });
    expect(market({ seniority: "SENIOR" }).overview.total).toBe(1);
  });

  it("rates recommendations over completed evaluations only, with deferred, failed and unevaluated states", () => {
    const recommendations = market().recommendations;
    expect(recommendations.completed).toBe(3);
    expect(recommendations.coverage).toMatchObject({ numerator: 3, denominator: 12 });
    expect(recommendations.apply).toMatchObject({ numerator: 1, denominator: 3 });
    expect(recommendations.states).toMatchObject({ evaluated: 3, in_progress: 1, failed: 1, waiting_budget: 1, waiting_usage_limit: 1, not_yet_evaluated: 5 });
    const week = recommendations.trend.find((row) => row.completed > 0)!;
    expect(week.applyRate).toMatchObject({ numerator: 1, denominator: 3, sample: "insufficient" });
    expect(week.coverage).toMatchObject({ numerator: 3, denominator: 12 });
  });

  it("combines requirements only within one compatible reconstruction version, and reports segment coverage", () => {
    const { requirements, segment } = market();
    expect(requirements.versions).toEqual([
      { version: "cs-jd-reconstruction-v3", group: "cs-jd-reconstruction-v3", jobs: 2, included: true },
      { version: "cs-jd-reconstruction-v7", group: "cs-jd-reconstruction-v7", jobs: 1, included: false },
    ]);
    expect(requirements.cohort).toMatchObject({ jobs: 2, excluded: 1 });
    const tool = requirements.categories.find((row) => row.category === "TOOL")!;
    expect(tool.jobs).toMatchObject({ numerator: 2, denominator: 2 });
    expect(requirements.topPhrases[0]).toMatchObject({ phrase: "Gainsight", jobs: 2 });
    expect(requirements.topPhrases.some((row) => row.phrase === "Salesforce")).toBe(false);
    expect(requirements.categories.map((row) => row.category)).not.toContain("LOCATION");
    expect(segment.coverage).toMatchObject({ numerator: 3, denominator: 12 });
    expect(counts(segment.distribution.rows)).toMatchObject({ ENTERPRISE: 1, SMB: 1, UNKNOWN: 1 });
  });
});
