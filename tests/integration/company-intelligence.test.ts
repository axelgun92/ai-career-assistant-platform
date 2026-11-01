import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCompanyDetail, buildCompanyIndex, parseCompanyIndexQuery, parseCompanyWindow, type CiFacts } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { getDatabaseClient, PrismaCompanyIntelligenceRepository } from "@ai-career/database";
import { normalizeCompanyName } from "@ai-career/deduplication";

// Feature 18 Company Intelligence over the real read model, on the isolated
// test database only. Synthetic companies, listings and applications are
// seeded directly (no provider, no live request), scoped by a unique token,
// and removed afterwards.

const database = getDatabaseClient();
const repository = new PrismaCompanyIntelligenceRepository();
const token = randomUUID().slice(0, 8);
const now = new Date();
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(now.getTime() - days * day);
const dateAgo = (days: number) => new Date(`${ago(days).toISOString().slice(0, 10)}T00:00:00.000Z`);
const terms = customerSuccessDiscoveryConfiguration.titleTerms;
const scope = `scope-${randomUUID()}`;

const created = { sources: [] as string[], opportunities: [] as string[], records: [] as string[], companies: [] as string[] };
const ids: Record<string, string> = {};
let board = "";
let facts: CiFacts;

async function company(name: string, normalized = true) {
  const row = await database.company.create({ data: { name, normalizedName: normalized ? normalizeCompanyName(name) : null } });
  created.companies.push(row.id);
  return row.id;
}

async function role(title: string, companyId: string | null, extra: Record<string, unknown> = {}) {
  const row = await database.opportunity.create({
    data: { title: `${title} ${token}`, domain: "customer-success", status: "NORMALIZED", companyId, firstSeenAt: ago(30), lastSeenAt: ago(1), ...extra },
  });
  created.opportunities.push(row.id);
  return row.id;
}

async function record(opportunityId: string, data: Record<string, unknown>) {
  const row = await database.sourceRecord.create({ data: { source: "greenhouse", sourceType: "ATS", opportunityId, createdAt: ago(30), discoveredAt: ago(30), ...data } as never });
  created.records.push(row.id);
  return row.id;
}

const retrieved = (externalId: string, extra: Record<string, unknown> = {}) => ({
  externalId: `${token}-${externalId}`,
  retrievalSourceId: board,
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "ATS",
  contentHash: `${token}-${externalId}`,
  ...extra,
});

async function listing(opportunityId: string, externalId: string, extra: Record<string, unknown> = {}) {
  await database.retrievedListing.create({
    data: { retrievalSourceId: board, trackingScopeKey: scope, source: "greenhouse", externalId: `${token}-${externalId}`, opportunityId, removalCapable: true, state: "LISTED", firstSeenAt: ago(25), lastSeenAt: ago(0.1), ...extra } as never,
  });
}

async function apply(opportunityId: string, stage: "APPLIED" | "SCREENING" | "CLOSED", appliedDaysAgo: number, extra: { outcome?: "REJECTED" | "NO_RESPONSE" | "OFFER_ACCEPTED"; reached?: string[]; screen?: boolean; closedDaysAgo?: number } = {}) {
  const appliedOn = dateAgo(appliedDaysAgo);
  const application = await database.application.create({
    data: { opportunityId, stage, outcome: extra.outcome ?? null, appliedOn, closedOn: stage === "CLOSED" ? dateAgo(extra.closedDaysAgo ?? appliedDaysAgo - 5) : null },
  });
  let sequence = 0;
  await database.applicationEvent.create({ data: { applicationId: application.id, sequence: ++sequence, type: "SUBMITTED", occurredOn: appliedOn } });
  for (const toStage of extra.reached ?? []) {
    // The tracker records stage changes without a date: only when they were recorded.
    await database.applicationEvent.create({ data: { applicationId: application.id, sequence: ++sequence, type: "STAGE_CHANGED", toStage: toStage as never, createdAt: ago(appliedDaysAgo - 6) } });
  }
  if (extra.screen) {
    await database.applicationInterview.create({ data: { applicationId: application.id, kind: "RECRUITER_SCREEN", status: "COMPLETED", scheduledAt: ago(appliedDaysAgo - 9), createdAt: ago(appliedDaysAgo - 7) } });
  }
}

async function evaluate(opportunityId: string, status: "COMPLETED" | "FAILED", segment?: string) {
  await database.evaluation.create({
    data: {
      opportunityId, domain: "customer-success", status, evaluationVersion: "test", domainVersion: "test", ruleVersion: "test", createdAt: ago(20), completedAt: status === "COMPLETED" ? ago(20) : null,
      ...(status === "COMPLETED"
        ? {
            domainResult: {
              companyAlignment: { alignment: { customerSegment: { classification: segment ?? "ENTERPRISE" }, customerType: { classification: "LIGHT_B2B" }, businessModel: { classification: "SAAS" }, alignmentSummary: "prose never read" } },
              ghostJobRisk: { evaluated: true, risk: { classification: "UNKNOWN" } },
            },
          }
        : {}),
    },
  });
}

beforeAll(async () => {
  const source = await database.retrievalSource.create({
    data: { adapterKey: "greenhouse", name: `Acme board ${token}`, domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", enabled: false, config: {}, trackingScopeKey: scope },
  });
  created.sources.push(source.id);
  board = source.id;

  ids.acme = await company(`Acme ${token}`);
  ids.acmeLegacy = await company(`ACME ${token}, Inc.`);
  ids.acmeUk = await company(`Acme ${token} UK Ltd`);
  ids.beta = await company(`Beta ${token}`);

  // A currently listed role, also on another source (one role, two records).
  ids.listed = await role("Customer Success Manager", ids.acme, { remoteStatus: "REMOTE", workArrangements: ["REMOTE"], residencyRegions: ["US"] });
  await record(ids.listed, retrieved("gh-1"));
  await record(ids.listed, { source: "remote-ok", sourceType: "API", externalId: `${token}-ro-1`, createdAt: ago(29), duplicateDecision: "MATCH", duplicateEvidence: { matchedOn: ["url"], conflicts: [] } });
  await listing(ids.listed, "gh-1");
  await evaluate(ids.listed, "COMPLETED");
  await apply(ids.listed, "APPLIED", 10);

  // Listed again after a confirmed removal (Feature 13), on the legacy row of the same company.
  ids.reposted = await role("Customer Success Manager", ids.acmeLegacy, { remoteStatus: "REMOTE", workArrangements: ["REMOTE"] });
  await record(ids.reposted, retrieved("gh-2"));
  await listing(ids.reposted, "gh-2", { reappearedAt: ago(3), reappearances: 1, removedAt: ago(10) });
  await evaluate(ids.reposted, "FAILED");
  await apply(ids.reposted, "SCREENING", 40, { reached: ["SCREENING"], screen: true });

  // Confirmed removed, and relisted under a new listing ID with the same requisition; its content changed once.
  ids.removed = await role("Implementation Consultant", ids.acme, { remoteStatus: "ONSITE", workArrangements: ["ONSITE"] });
  const first = await record(ids.removed, retrieved("gh-3", { requisitionId: `${token}-REQ-9` }));
  await record(ids.removed, retrieved("gh-3", { previousSourceRecordId: first, contentHash: `${token}-gh-3b`, createdAt: ago(20) }));
  await record(ids.removed, retrieved("gh-4", { requisitionId: `${token}-REQ-9`, createdAt: ago(15), duplicateDecision: "MATCH", duplicateEvidence: { matchedOn: ["requisitionId", "company"], conflicts: [] } }));
  await listing(ids.removed, "gh-3", { state: "REMOVED", firstSeenAt: ago(30), lastSeenAt: ago(8), missingSince: ago(7), removedAt: ago(6) });
  await apply(ids.removed, "CLOSED", 60, { outcome: "NO_RESPONSE" });

  // A manual capture: no listing ledger, so its status is unknown.
  ids.manual = await role("Customer Success Lead", ids.acme, { remoteStatus: "HYBRID", workArrangements: ["HYBRID"] });
  await record(ids.manual, { source: "manual-input", sourceType: "MANUAL", externalId: null });
  await apply(ids.manual, "CLOSED", 50, { outcome: "OFFER_ACCEPTED", reached: ["SCREENING", "INTERVIEWING", "OFFER"], closedDaysAgo: 20 });

  ids.rejected = await role("Customer Success Manager", ids.acme);
  await apply(ids.rejected, "CLOSED", 45, { outcome: "REJECTED", closedDaysAgo: 35 });

  // An unresolved possible duplicate inside the company.
  await database.duplicateReference.create({ data: { opportunityId: ids.manual, relatedOpportunityId: ids.listed, decision: "PROBABLE_MATCH", confidence: 0.8 } });

  // Similar names that stay separate, another company, and a job without a company.
  ids.uk = await role("Customer Success Manager", ids.acmeUk);
  ids.betaRole = await role("Account Manager", ids.beta);
  await evaluate(ids.betaRole, "COMPLETED", "SMB");
  ids.noCompany = await role("Customer Success Manager", null);

  const before = await Promise.all([database.opportunity.count(), database.company.count(), database.sourceRecord.count(), database.retrievedListing.count(), database.application.count()]);
  const all = await repository.facts();
  const after = await Promise.all([database.opportunity.count(), database.company.count(), database.sourceRecord.count(), database.retrievedListing.count(), database.application.count()]);
  expect(after).toEqual(before);
  const ours = new Set(created.companies);
  facts = { ...all, companies: all.companies.filter((row) => ours.has(row.id)), opportunities: all.opportunities.filter((row) => ours.has(row.companyId)) };
});

afterAll(async () => {
  await database.sourceRecord.deleteMany({ where: { id: { in: created.records } } });
  await database.opportunity.deleteMany({ where: { id: { in: created.opportunities } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: created.sources } } });
  await database.company.deleteMany({ where: { id: { in: created.companies } } });
  await database.$disconnect();
});

const allTime = parseCompanyWindow({}, now);
const detailOf = (companyId: string, input: CiFacts = facts) => buildCompanyDetail({ facts: input, titleTerms: terms, now, timeZone: "UTC", companyId, window: allTime });

describe("Company Intelligence read model (isolated test database)", () => {
  it("resolves a company's normalized-name group and keeps similar names apart", async () => {
    expect(await repository.companyGroupIds(ids.acmeLegacy!)).toEqual([ids.acme, ids.acmeLegacy]);
    expect(await repository.companyGroupIds(ids.acmeUk!)).toEqual([ids.acmeUk]);
    expect(await repository.companyGroupIds(randomUUID())).toEqual([]);
    expect(await repository.companyIdForOpportunity(ids.reposted!)).toBe(ids.acmeLegacy);
    expect(await repository.companyIdForOpportunity(ids.noCompany!)).toBeNull();
  });

  it("reads ledger rows, records, MATCH evidence, classifications and applications as stored", () => {
    const byId = new Map(facts.opportunities.map((item) => [item.id, item]));
    expect(byId.get(ids.listed!)!.listings[0]).toMatchObject({ sourceName: `Acme board ${token}`, sourceCategory: "ATS", removalCapable: true, currentScope: true, state: "LISTED" });
    expect(byId.get(ids.listed!)!.records.map((item) => [item.source, item.matchedOn])).toEqual([["greenhouse", []], ["remote-ok", ["url"]]]);
    expect(byId.get(ids.removed!)!.records.map((item) => [item.changed, item.superseded])).toEqual([[false, true], [true, false], [false, false]]);
    expect(byId.get(ids.listed!)!.evaluations[0]).toMatchObject({ status: "COMPLETED", customerSegment: "ENTERPRISE", customerType: "LIGHT_B2B", businessModel: "SAAS" });
    expect(JSON.stringify(byId.get(ids.listed!)!.evaluations)).not.toContain("prose never read");
    expect(byId.get(ids.listed!)!.origin).toMatchObject({ source: "greenhouse", retrievalSourceId: board });
    const screening = byId.get(ids.reposted!)!.application!;
    expect(screening.events.find((event) => event.type === "STAGE_CHANGED")).toMatchObject({ occurredOn: null });
    expect(screening.interviews[0]).toMatchObject({ kind: "RECRUITER_SCREEN", scheduledAt: expect.any(Date), recordedAt: expect.any(Date) });
    expect(facts.withoutCompany).toBeGreaterThanOrEqual(1);
  });

  it("reads only the requested company group when scoped", async () => {
    const scoped = await repository.facts(await repository.companyGroupIds(ids.acme!));
    expect(scoped.companies.map((row) => row.id).sort()).toEqual([ids.acme, ids.acmeLegacy].sort());
    expect(scoped.opportunities.map((row) => row.id).sort()).toEqual([ids.listed, ids.reposted, ids.removed, ids.manual, ids.rejected].sort());
    expect(scoped.probablePairs).toHaveLength(1);
    expect(detailOf(ids.acme!, scoped)!.overview.observedRoles).toBe(5);
  });

  it("builds the company detail: listing state, signals, recurring roles and arrangement", () => {
    const detail = detailOf(ids.acmeLegacy!)!;
    expect(detail.company).toMatchObject({ id: ids.acme, names: [`Acme ${token}`, `ACME ${token}, Inc.`] });
    expect(detail.overview).toMatchObject({ observedRoles: 5, currentlyListed: 2, noLongerListed: 1, statusUnknown: 2, applications: 5 });
    expect(detail.overview.companyType).toMatchObject({ evaluatedRoles: 1, roles: 5 });
    expect(detail.signals).toMatchObject({ removalTracked: 3, listedAgain: 1, reappearances: 1, requisitionRelisted: 1 });
    expect(detail.signals.relistings[0]).toMatchObject({ opportunityId: ids.reposted, days: 7 });
    expect(detail.postings).toMatchObject({ changedRoles: 1, probableDuplicatePairs: 1 });
    // Per listing: the removed listing's own first sighting (30 days ago) to its own removal (6 days ago).
    expect(detail.postings.duration.confirmed).toMatchObject({ n: 1, values: [24] });
    expect(detail.postings.duration.stillListed.map((row) => row.opportunityId).sort()).toEqual([ids.listed, ids.reposted].sort());
    // Title groups are the discovery terms: the three managers and the lead share "Customer Success".
    const cs = detail.recurring.groups.find((group) => group.key === "Customer Success")!;
    expect(cs).toMatchObject({ roles: 4, recurring: true, currentlyListed: 2, applied: 4 });
    expect(cs.titles).toEqual([
      { title: `Customer Success Manager ${token}`, count: 3 },
      { title: `Customer Success Lead ${token}`, count: 1 },
    ]);
    expect(detail.recurring.groups.find((group) => group.key === "Implementation")).toMatchObject({ roles: 1, recurring: false });
    expect(detail.arrangement).toMatchObject({ remote: 2, arrangementKnown: 4 });
    expect(detail.roles.find((row) => row.opportunityId === ids.manual)).toMatchObject({ state: "unknown", foundFirstBy: "Manual entry" });
  });

  it("builds your history with the company from Feature 17 outcomes and tracker dates", () => {
    const history = detailOf(ids.acme!)!.history;
    expect(history).toMatchObject({ applications: 5, awaitingResponse: 1, inProcess: 1, recruiterScreens: 2, offers: 1, matureNothingRecorded: 0 });
    expect(history.closed).toEqual({ NO_RESPONSE: 1, OFFER_ACCEPTED: 1, REJECTED: 1 });
    // Progress recorded: the screening (stage change 6 days after applying, interview logged 7 days after) and the offer path.
    expect(history.timings.progress).toMatchObject({ n: 2, values: [6, 6] });
    expect(history.timings.interview).toMatchObject({ n: 1, values: [9] });
    expect(history.timings.closed).toMatchObject({ n: 3, values: [5, 10, 30] });
  });

  it("lists companies in the index with name variants and keeps the UK entity separate", () => {
    const index = buildCompanyIndex({ facts, titleTerms: terms, now, timeZone: "UTC", query: parseCompanyIndexQuery({}, now, terms) });
    expect(index.rows.map((row) => [row.name, row.observedRoles])).toEqual([
      [`Acme ${token}`, 5],
      [`Acme ${token} UK Ltd`, 1],
      [`Beta ${token}`, 1],
    ]);
    // Listed again after removal is Feature 13 only (the reposted role); the same-requisition relisting is a separate detail signal.
    expect(index.rows[0]).toMatchObject({ otherNames: [`ACME ${token}, Inc.`], currentlyListed: 2, listedAgain: 1, applications: 5, interviews: 2, offers: 1 });
    // A window in which no role was first observed lists none of these companies, whatever their applications.
    const recent = buildCompanyIndex({ facts, titleTerms: terms, now, timeZone: "UTC", query: parseCompanyIndexQuery({ window: "custom", from: ago(3).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }, now, terms) });
    expect(recent.rows).toEqual([]);
    expect(index.withoutCompany).toBeGreaterThanOrEqual(1);
  });
});
