import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPersonalAnalytics, parsePersonalQuery, type PaFacts } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { getDatabaseClient, PrismaPersonalAnalyticsRepository, resumeMatchOperationId } from "@ai-career/database";

// Feature 17 Personal Job-Search Analytics over the real read model, on the
// isolated test database only. Synthetic histories are seeded directly (no
// provider, no live request), scoped by a unique token, and removed afterwards.
// The active-profile pointer is never changed; profile cohorts are selected
// explicitly.

const database = getDatabaseClient();
const token = randomUUID().slice(0, 8);
const now = new Date();
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(now.getTime() - days * day);
const dateAgo = (days: number) => new Date(`${ago(days).toISOString().slice(0, 10)}T00:00:00.000Z`);
const terms = customerSuccessDiscoveryConfiguration.titleTerms;

const created = { sources: [] as string[], opportunities: [] as string[], records: [] as string[], profiles: [] as string[] };
const ids: Record<string, string> = {};
let facts: PaFacts;
let board = "";
let profileOld = "";
let profileNew = "";

async function opportunity(title: string, origin: "board" | "manual" | "extension" | null, extra: Record<string, unknown> = {}) {
  const row = await database.opportunity.create({ data: { title: `${title} ${token}`, domain: "customer-success", status: "NORMALIZED", ...extra } });
  created.opportunities.push(row.id);
  if (origin) {
    const data =
      origin === "board"
        ? { source: "remote-ok", sourceType: "API" as const, retrievalSourceId: board, externalId: `${token}-${randomUUID()}` }
        : origin === "extension"
          ? { source: "browser-extension", sourceType: "BROWSER_EXTENSION" as const, externalId: `linkedin:${randomUUID()}`, sourceMetadata: { capture: { site: "linkedin" } } }
          : { source: "manual-input", sourceType: "MANUAL" as const };
    const record = await database.sourceRecord.create({ data: { ...data, opportunityId: row.id, createdAt: ago(90), discoveredAt: ago(90) } });
    created.records.push(record.id);
  }
  return row.id;
}

const gaps = (...items: Array<[string, string, string?]>) =>
  items.map(([category, requirementText, strength], index) => ({
    requirementIndex: index,
    requirementText,
    category,
    strength: strength ?? "REQUIRED",
    classification: "GENUINE_GAP",
    decisionImpact: "MATERIAL_UNCERTAINTY",
    explanation: `Prose about ${requirementText} that must never be grouped.`,
  }));

async function evaluate(
  opportunityId: string,
  input: { decision: string | null; at: Date; profile?: string | null; resumeMatchVersion?: string; band?: string; gaps?: ReturnType<typeof gaps>; status?: "COMPLETED" | "FAILED"; segment?: string; customerType?: string },
) {
  const status = input.status ?? "COMPLETED";
  const evaluation = await database.evaluation.create({
    data: {
      opportunityId,
      domain: "customer-success",
      status,
      evaluationVersion: "test",
      domainVersion: "test",
      ruleVersion: "test",
      createdAt: input.at,
      completedAt: status === "COMPLETED" ? input.at : null,
      userProfileId: input.profile === undefined ? profileNew : input.profile,
      userProfileVersion: input.profile === null ? null : input.profile === profileOld ? 1 : 2,
      ...(status === "COMPLETED"
        ? {
            domainResult: {
              hardFilters: { role: { classification: "CORE_CS" } },
              companyAlignment: { alignment: { customerSegment: { classification: input.segment ?? "ENTERPRISE" }, customerType: { classification: input.customerType ?? "LIGHT_B2B" } } },
              alexFit: { evaluated: true, fit: { classification: "GOOD" } },
              resumeMatch: { evaluated: true, band: input.band ?? "GOOD_HIGH", match: { score: 70, requirementAssessments: input.gaps ?? [] } },
            },
          }
        : {}),
    },
  });
  if (input.decision) {
    await database.recommendation.create({ data: { opportunityId, evaluationId: evaluation.id, decision: input.decision, explanation: "seeded", evaluationVersion: "test" } });
  }
  if (status === "COMPLETED") {
    await database.semanticOperationAttempt.create({
      data: {
        evaluationId: evaluation.id, opportunityId, domain: `personal-${token}`, operationId: resumeMatchOperationId,
        promptVersion: input.resumeMatchVersion ?? "cs-resume-match-v2", attempt: 1, provider: "openai", model: "test-model",
        status: "SUCCESS", durationMs: 1, createdAt: input.at,
      },
    });
  }
}

async function apply(opportunityId: string, stage: "PLANNED" | "APPLIED" | "SCREENING" | "INTERVIEWING" | "FINAL_ROUND" | "OFFER" | "CLOSED", appliedDaysAgo: number, extra: { outcome?: "REJECTED" | "WITHDRAWN" | "NO_RESPONSE" | "OFFER_ACCEPTED" | "NOT_SUBMITTED"; reached?: string[]; interview?: { kind: "RECRUITER_SCREEN" | "HIRING_MANAGER" | "FINAL"; status: "SCHEDULED" | "COMPLETED" | "CANCELLED" } } = {}) {
  // The tracker's constraint: PLANNED and NOT_SUBMITTED have no applied date.
  const appliedOn = stage === "PLANNED" || extra.outcome === "NOT_SUBMITTED" ? null : dateAgo(appliedDaysAgo);
  const application = await database.application.create({
    data: { opportunityId, stage, outcome: extra.outcome ?? null, appliedOn, closedOn: stage === "CLOSED" ? dateAgo(Math.max(0, appliedDaysAgo - 5)) : null },
  });
  let sequence = 0;
  if (appliedOn) await database.applicationEvent.create({ data: { applicationId: application.id, sequence: ++sequence, type: "SUBMITTED", occurredOn: appliedOn } });
  for (const toStage of extra.reached ?? []) {
    await database.applicationEvent.create({ data: { applicationId: application.id, sequence: ++sequence, type: "STAGE_CHANGED", toStage: toStage as never, occurredOn: dateAgo(Math.max(0, appliedDaysAgo - 3)) } });
  }
  if (extra.interview) await database.applicationInterview.create({ data: { applicationId: application.id, kind: extra.interview.kind, status: extra.interview.status, scheduledAt: ago(Math.max(0, appliedDaysAgo - 4)) } });
}

const query = (params: Record<string, string> = {}) =>
  buildPersonalAnalytics({ facts, titleTerms: terms, query: parsePersonalQuery({ profile: profileNew, ...params }, now, terms), now, timeZone: "UTC" });

beforeAll(async () => {
  const source = await database.retrievalSource.create({
    data: { adapterKey: "remote-ok", name: `Personal board ${token}`, domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "JOB_BOARD", enabled: false, config: {}, trackingScopeKey: `scope-${randomUUID()}` },
  });
  created.sources.push(source.id);
  board = source.id;
  for (const version of [1, 2]) {
    const profile = await database.userProfile.create({ data: { label: `personal-${token}`, version, contentHash: `${token}-${version}` } });
    created.profiles.push(profile.id);
    if (version === 1) profileOld = profile.id;
    else profileNew = profile.id;
  }

  // Evaluated earlier, then applied: recommendations credited; repeated TOOL gaps with similar-but-different wording.
  ids.applyInterview = await opportunity("Senior Customer Success Manager", "board", { seniority: "SENIOR", workArrangements: ["REMOTE"] });
  await evaluate(ids.applyInterview, { decision: "APPLY", at: ago(50), gaps: gaps(["TOOL", "Salesforce"], ["EXPERIENCE", "5 years SaaS"]), segment: "SMB", customerType: "B2C" });
  await apply(ids.applyInterview, "INTERVIEWING", 45, { reached: ["SCREENING", "INTERVIEWING"], interview: { kind: "RECRUITER_SCREEN", status: "COMPLETED" } });

  ids.reviewOffer = await opportunity("Customer Success Manager", "board");
  await evaluate(ids.reviewOffer, { decision: "REVIEW", at: ago(70), gaps: gaps(["TOOL", "salesforce "]) });
  await apply(ids.reviewOffer, "OFFER", 60, { reached: ["SCREENING", "INTERVIEWING", "FINAL_ROUND", "OFFER"], interview: { kind: "FINAL", status: "COMPLETED" } });

  ids.skipRejected = await opportunity("Customer Success Manager", "board");
  await evaluate(ids.skipRejected, { decision: "SKIP", at: ago(70), gaps: gaps(["TOOL", "CRM experience"]) });
  await apply(ids.skipRejected, "CLOSED", 60, { outcome: "REJECTED" });

  // Same calendar day as a date-only application: order unknown.
  ids.sameDay = await opportunity("Customer Success Manager", "board");
  await evaluate(ids.sameDay, { decision: "APPLY", at: new Date(dateAgo(40).getTime() + 15 * 60 * 60 * 1000) });
  await apply(ids.sameDay, "APPLIED", 40);

  // Evaluated after applying.
  ids.after = await opportunity("Customer Success Manager", "board");
  await evaluate(ids.after, { decision: "APPLY", at: ago(20) });
  await apply(ids.after, "APPLIED", 40);

  // Lifecycle "Mark as applied" only (an exact timestamp after the evaluation), and an Application plus MARK_APPLIED counted once.
  ids.marked = await opportunity("Customer Success Manager", "extension");
  await evaluate(ids.marked, { decision: "REVIEW", at: ago(36) });
  await database.opportunityUserAction.create({ data: { opportunityId: ids.marked, action: "MARK_APPLIED", fromStatus: "RECOMMENDED", toStatus: "APPLIED", createdAt: ago(35) } });
  ids.both = await opportunity("Customer Success Manager", "manual");
  await apply(ids.both, "APPLIED", 34);
  await database.opportunityUserAction.create({ data: { opportunityId: ids.both, action: "MARK_APPLIED", fromStatus: "SAVED", toStatus: "APPLIED", createdAt: ago(33) } });

  // Not applications: PLANNED and NOT_SUBMITTED.
  ids.planned = await opportunity("Customer Success Manager", "board");
  await apply(ids.planned, "PLANNED", 0);
  ids.notSubmitted = await opportunity("Customer Success Manager", "board");
  await apply(ids.notSubmitted, "CLOSED", 30, { outcome: "NOT_SUBMITTED" });

  // Awaiting response; an open screening (in process); a withdrawn application; a failed evaluation.
  ids.young = await opportunity("Customer Success Manager", "board");
  await apply(ids.young, "APPLIED", 3);
  ids.screening = await opportunity("Customer Success Manager", "board");
  await apply(ids.screening, "SCREENING", 50, { reached: ["SCREENING"] });
  ids.withdrawn = await opportunity("Customer Success Manager", "board");
  await evaluate(ids.withdrawn, { decision: null, at: ago(80), status: "FAILED" });
  await apply(ids.withdrawn, "CLOSED", 70, { outcome: "WITHDRAWN" });

  // Five mature Implementation applications without any interview, one of them evaluated under the old profile with v4 Resume Match.
  for (let index = 0; index < 5; index += 1) {
    const id = await opportunity("Implementation Consultant", "board");
    ids[`impl${index}`] = id;
    await apply(id, "APPLIED", 40 + index);
  }
  await evaluate(ids.impl0!, { decision: "APPLY", at: ago(60), profile: profileOld, gaps: gaps(["TOOL", "Salesforce"]) });
  await evaluate(ids.impl1!, { decision: "APPLY", at: ago(60), resumeMatchVersion: "cs-resume-match-v4", gaps: gaps(["TOOL", "Salesforce"]) });
  await evaluate(ids.impl2!, { decision: "APPLY", at: ago(60), profile: null });

  // APPLY recommended but not applied.
  ids.notApplied = await opportunity("Customer Success Manager", "board");
  await evaluate(ids.notApplied, { decision: "APPLY", at: ago(10) });

  const ours = new Set(created.opportunities);
  const before = await Promise.all([database.opportunity.count(), database.evaluation.count(), database.application.count(), database.userProfile.count()]);
  const all = await new PrismaPersonalAnalyticsRepository().facts();
  const after = await Promise.all([database.opportunity.count(), database.evaluation.count(), database.application.count(), database.userProfile.count()]);
  expect(after).toEqual(before);
  facts = { ...all, opportunities: all.opportunities.filter((item) => ours.has(item.id)), profiles: all.profiles.filter((profile) => created.profiles.includes(profile.id)) };
});

afterAll(async () => {
  await database.sourceRecord.deleteMany({ where: { id: { in: created.records } } });
  await database.opportunity.deleteMany({ where: { id: { in: created.opportunities } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: created.sources } } });
  await database.userProfile.deleteMany({ where: { id: { in: created.profiles } } });
  await database.$disconnect();
});

describe("Personal Job-Search Analytics read model (isolated test database)", () => {
  it("reads origins, applications, MARK_APPLIED, structured gaps and versions as stored", () => {
    const byId = new Map(facts.opportunities.map((item) => [item.id, item]));
    expect(byId.get(ids.applyInterview!)!.origin).toMatchObject({ source: "remote-ok", retrievalSourceId: board });
    expect(byId.get(ids.marked!)!.origin).toMatchObject({ source: "browser-extension", captureSite: "linkedin" });
    expect(byId.get(ids.both!)!.origin).toMatchObject({ sourceType: "MANUAL" });
    expect(byId.get(ids.marked!)!.markedAppliedAt).toBeInstanceOf(Date);
    const evaluation = byId.get(ids.applyInterview!)!.evaluations[0]!;
    expect(evaluation).toMatchObject({ decision: "APPLY", userProfileId: profileNew, userProfileVersion: 2, alexFit: "GOOD", customerSegment: "SMB", customerType: "B2C", resumeMatchVersion: "cs-resume-match-v2" });
    expect(evaluation.resumeMatch).toEqual({
      band: "GOOD_HIGH",
      gaps: [
        { category: "TOOL", requirementText: "Salesforce", strength: "REQUIRED", decisionImpact: "MATERIAL_UNCERTAINTY" },
        { category: "EXPERIENCE", requirementText: "5 years SaaS", strength: "REQUIRED", decisionImpact: "MATERIAL_UNCERTAINTY" },
      ],
    });
    expect(JSON.stringify(evaluation)).not.toContain("must never be grouped");
    expect(byId.get(ids.applyInterview!)!.application!.interviews[0]).toMatchObject({ kind: "RECRUITER_SCREEN", status: "COMPLETED" });
    expect(byId.get(ids.withdrawn!)!.evaluations[0]).toMatchObject({ status: "FAILED", resumeMatch: null });
  });

  it("counts applications once, excludes PLANNED and NOT_SUBMITTED, and applies the maturity and offer rules", () => {
    const market = query();
    // applyInterview, reviewOffer, skipRejected, sameDay, after, marked, both, young, screening, withdrawn, impl0–4.
    expect(market.overview.applied).toBe(15);
    expect(market.overview.awaitingResponse).toBe(1);
    expect(market.overview.inProcess).toBe(2);
    expect(market.overview.interviews).toBe(3);
    expect(market.overview.interviewRate).toMatchObject({ numerator: 3, denominator: 14 });
    // Resolved: all mature except the two in process (applyInterview, screening).
    expect(market.overview.offerRate).toMatchObject({ numerator: 1, denominator: 12 });
    expect(market.overview.interviewToOffer).toMatchObject({ numerator: 1, denominator: 1 });
    expect(market.funnels.applications).toMatchObject({ recruiterScreen: 3, beyondScreening: 2, finalRound: 1, offers: 1 });
    expect(market.funnels.applications.closed).toMatchObject({ REJECTED: 1, WITHDRAWN: 1 });
  });

  it("credits the recommendation at application from the strongest temporal evidence", () => {
    const states = Object.fromEntries(query().funnels.byRecommendationAtApplication.map((row) => [row.key, row.applied]));
    // APPLY: applyInterview, impl0, impl1, impl2; REVIEW: reviewOffer, marked (exact MARK_APPLIED after its evaluation); SKIP: skipRejected.
    expect(states).toMatchObject({ APPLY: 4, REVIEW: 2, SKIP: 1, SAME_DAY_UNKNOWN: 1, EVALUATED_AFTER: 1 });
    // both, young, screening, withdrawn (failed evaluation), impl3, impl4: not evaluated.
    expect(states.NOT_EVALUATED).toBe(6);
    expect(query({ recommendation: "SAME_DAY_UNKNOWN" }).overview.applied).toBe(1);
  });

  it("reports personal outcomes by Feature 15 first-discovery source, user-collected apart", () => {
    const sources = query().sources;
    expect(sources.automated.find((row) => row.key === `source:${board}`)).toMatchObject({ name: `Personal board ${token}`, applied: 13, interviews: 3, offers: 1 });
    expect(sources.userCollected.map((row) => [row.name, row.applied]).sort()).toEqual([
      ["Browser extension · LinkedIn", 1],
      ["Manual entry", 1],
    ]);
  });

  it("groups Genuine Gaps by category and exact wording, within one profile and compatible Resume Match version", () => {
    const gapsNew = query().gaps;
    // Profile v2, Resume Match v2: applyInterview, reviewOffer, skipRejected, sameDay, after, marked, notApplied.
    expect(gapsNew.evaluated).toBe(7);
    expect(gapsNew.versions).toEqual([
      { version: "cs-resume-match-v2", group: "cs-resume-match-v2", evaluated: 7, included: true },
      { version: "cs-resume-match-v4", group: "cs-resume-match-v4", evaluated: 1, included: false },
    ]);
    const tool = gapsNew.categories.find((row) => row.category === "TOOL")!;
    expect(tool).toMatchObject({ opportunities: 3, otherwiseGood: 2, applied: 3, interviewed: 2 });
    expect(gapsNew.phrases.find((row) => row.requirement === "Salesforce")).toMatchObject({ opportunities: 2, otherwiseGood: 2 });
    expect(gapsNew.phrases.find((row) => row.requirement === "CRM experience")).toMatchObject({ opportunities: 1, otherwiseGood: 0 });
    const old = query({ profile: profileOld }).gaps;
    expect(old.evaluated).toBe(1);
    expect(query({ profile: "none" }).gaps.evaluated).toBe(1);
  });

  it("lists where applications are not progressing and keeps APPLY-not-applied neutral", () => {
    const market = query();
    expect(market.notProgressing.groups).toContainEqual({ dimension: "titleGroup", key: "Implementation", label: "Implementation", mature: 5 });
    expect(market.notProgressing.groups.some((row) => row.key === "Customer Success")).toBe(false);
    expect(market.notProgressing.recommendedNotApplied).toBe(1);
  });

  it("breaks evaluated applications down by customer segment and customer type", () => {
    const company = query().companyType;
    expect(company.segment.find((row) => row.key === "SMB")).toMatchObject({ applied: 1, interviews: 1 });
    expect(company.customerType.find((row) => row.key === "B2C")).toMatchObject({ applied: 1 });
    // Applications without a completed evaluation are not in company-type rows:
    // applyInterview, reviewOffer, skipRejected, sameDay, after, marked, impl0–2.
    expect(company.evaluatedApplied).toBe(9);
  });
});
