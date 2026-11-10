import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  backfillDeduplication,
  getDatabaseClient,
  PrismaOpportunityDashboardRepository,
  PrismaOpportunityListRepository,
} from "@ai-career/database";
import { createDoctorReads } from "../../apps/web/src/server/doctor";
import { parseOpportunityQuery, toListFilters } from "../../apps/web/src/server/opportunity-query";

// Legacy data as it exists before deduplication: one Company row per
// opportunity, no normalized names, duplicate listings as separate
// opportunities. Assertions are scoped to this suite's own rows.

const database = getDatabaseClient();
const token = `bf${randomUUID().slice(0, 8)}`;
const companyKey = `legacyco ${token}`;
const ids: Record<string, string> = {};
const companies: Record<string, string> = {};

async function legacyOpportunity(key: string, input: { company: string; title: string; url?: string; firstSeenAt: string; description?: string }) {
  const company = await database.company.create({ data: { name: input.company } });
  companies[key] = company.id;
  const opportunity = await database.opportunity.create({
    data: {
      domain: "customer-success",
      title: input.title,
      companyId: company.id,
      canonicalUrl: input.url ?? null,
      jobDescription: input.description ?? `Own onboarding, adoption and renewals for ${token} customers. Partner with Product.`,
      firstSeenAt: new Date(input.firstSeenAt),
      lastSeenAt: new Date(input.firstSeenAt),
      discoveredAt: new Date(input.firstSeenAt),
      status: "NORMALIZED",
      source: "manual-input",
      sourceType: "MANUAL",
    },
  });
  ids[key] = opportunity.id;
}

const ourReferences = () =>
  database.duplicateReference.findMany({
    where: { opportunityId: { in: Object.values(ids) } },
    orderBy: [{ opportunityId: "asc" }, { relatedOpportunityId: "asc" }],
  });
const ourCompanies = () =>
  database.company.findMany({ where: { id: { in: Object.values(companies) } }, orderBy: { id: "asc" } });

beforeAll(async () => {
  const url = `https://jobs.example.com/legacy/${token}`;
  await legacyOpportunity("original", { company: `LegacyCo ${token}`, title: "Customer Success Manager", url, firstSeenAt: "2026-09-01T00:00:00Z" });
  await legacyOpportunity("exactCopy", { company: `legacyco ${token}, Inc.`, title: "Customer Success Manager", url: `${url}?utm_source=x`, firstSeenAt: "2026-09-05T00:00:00Z" });
  await legacyOpportunity("probable", { company: `LEGACYCO ${token}`, title: "Senior Customer Success Manager", firstSeenAt: "2026-09-10T00:00:00Z" });
  await legacyOpportunity("distinct", { company: `LegacyCo ${token} LLC`, title: "Customer Success Manager", url, firstSeenAt: "2026-09-12T00:00:00Z" });
  await legacyOpportunity("unrelated", { company: `Othercorp ${token}`, title: "Implementation Engineer", firstSeenAt: "2026-09-15T00:00:00Z", description: "Build integrations." });
  // Already reviewed by the user: must stay exactly as it is.
  await database.duplicateReference.create({
    data: {
      opportunityId: ids.distinct!,
      relatedOpportunityId: ids.original!,
      decision: "MATCH",
      confidence: 1,
      evidence: { recordedBy: "CAPTURE_KEPT_SEPARATE" },
      resolution: "DISTINCT",
      resolvedAt: new Date("2026-09-12T00:00:00Z"),
    },
  });
  // A company whose normalized name was already set is never overwritten.
  await database.company.update({ where: { id: companies.unrelated! }, data: { normalizedName: `othercorp ${token}` } });
  // An orphan company (no opportunity).
  companies.orphan = (await database.company.create({ data: { name: `LegacyCo ${token}` } })).id;
});

afterAll(async () => {
  await database.opportunity.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await database.company.deleteMany({ where: { id: { in: Object.values(companies) } } });
  await database.$disconnect();
});

describe("pnpm db:backfill-dedup", () => {
  it("reports what it would do in a dry run and writes nothing", async () => {
    const before = { companies: await ourCompanies(), references: await ourReferences(), opportunities: await database.opportunity.findMany({ where: { id: { in: Object.values(ids) } }, orderBy: { id: "asc" } }) };
    const report = await backfillDeduplication({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.companiesNormalized).toBe(0);
    expect(report.duplicateReferencesCreated).toBe(0);
    expect(report.companiesMissingNormalizedName).toBeGreaterThanOrEqual(5);
    expect(report.duplicateReferencesMissing).toBeGreaterThanOrEqual(2);
    expect(await ourCompanies()).toEqual(before.companies);
    expect(await ourReferences()).toEqual(before.references);
    expect(await database.opportunity.findMany({ where: { id: { in: Object.values(ids) } }, orderBy: { id: "asc" } })).toEqual(before.opportunities);
  });

  it("is reported by the read-only doctor before it runs", async () => {
    const reads = createDoctorReads(database, { workerConnected: async () => false, queueSnapshot: async () => ({ pending: 0, oldestPendingAt: null, running: 0, expiredReclaimable: 0, expiredExhausted: 0 }) });
    expect(await reads.companiesNeedingBackfill()).toBeGreaterThanOrEqual(5);
  });

  it("fills missing normalized names and records missing duplicate references, changing nothing else", async () => {
    const opportunitiesBefore = await database.opportunity.findMany({ where: { id: { in: Object.values(ids) } }, orderBy: { id: "asc" } });
    const distinctBefore = await database.duplicateReference.findUniqueOrThrow({
      where: { opportunityId_relatedOpportunityId: { opportunityId: ids.distinct!, relatedOpportunityId: ids.original! } },
    });

    const report = await backfillDeduplication({ dryRun: false });
    expect(report.companiesNormalized).toBeGreaterThanOrEqual(5);

    const after = await ourCompanies();
    expect(after).toHaveLength(Object.keys(companies).length);
    for (const company of after) {
      if (company.id === companies.unrelated) expect(company.normalizedName).toBe(`othercorp ${token}`);
      else expect(company.normalizedName, company.name).toBe(companyKey);
    }
    // Names, links and opportunities are untouched; nothing was merged or deleted.
    expect(after.map((company) => company.name).sort()).toEqual(
      [`LegacyCo ${token}`, `legacyco ${token}, Inc.`, `LEGACYCO ${token}`, `LegacyCo ${token} LLC`, `Othercorp ${token}`, `LegacyCo ${token}`].sort(),
    );
    expect(await database.opportunity.findMany({ where: { id: { in: Object.values(ids) } }, orderBy: { id: "asc" } })).toEqual(opportunitiesBefore);

    const references = await ourReferences();
    const pair = (from: string, to: string) =>
      references.find((reference) => reference.opportunityId === ids[from] && reference.relatedOpportunityId === ids[to]);
    expect(pair("exactCopy", "original")).toMatchObject({ decision: "MATCH", resolution: null, evidence: expect.objectContaining({ recordedBy: "BACKFILL", matchedOn: ["url"] }) });
    expect(pair("probable", "original")).toMatchObject({ decision: "PROBABLE_MATCH", resolution: null });
    expect(pair("distinct", "original")).toEqual(distinctBefore);
    expect(references.some((reference) => [reference.opportunityId, reference.relatedOpportunityId].includes(ids.unrelated!))).toBe(false);
  });

  it("is idempotent", async () => {
    const companiesBefore = await ourCompanies();
    const referencesBefore = await ourReferences();
    await backfillDeduplication({ dryRun: false });
    expect(await ourCompanies()).toEqual(companiesBefore);
    expect(await ourReferences()).toEqual(referencesBefore);
    const reads = createDoctorReads(database, { workerConnected: async () => false, queueSnapshot: async () => ({ pending: 0, oldestPendingAt: null, running: 0, expiredReclaimable: 0, expiredExhausted: 0 }) });
    expect(await reads.companiesNeedingBackfill()).toBe(0);
  });
});

describe("dashboard company filter", () => {
  const list = (search: string) => {
    const filters = toListFilters(parseOpportunityQuery(new URLSearchParams(`view=all&${search}`)));
    return new PrismaOpportunityListRepository().listPage({
      filters: { ...filters, searchTerms: [token] },
      sort: "oldest",
      page: 1,
      pageSize: 25,
    });
  };

  it("offers one entry per logical company with the combined count, excluding orphans", async () => {
    const options = await new PrismaOpportunityDashboardRepository().filterOptions();
    const legacy = options.companies.filter((company) => company.value === companyKey);
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({ name: `LegacyCo ${token}`, count: 4 });
    expect(legacy[0]!.companyIds.sort()).toEqual([companies.original, companies.exactCopy, companies.probable, companies.distinct].sort());
    expect(legacy[0]!.companyIds).not.toContain(companies.orphan);
  });

  it("filters by the normalized name, and an older company-id link selects the whole group", async () => {
    const byKey = await list(`company=${encodeURIComponent(companyKey)}`);
    expect(byKey.items.map((item) => item.id)).toEqual([ids.original, ids.exactCopy, ids.probable, ids.distinct]);
    const byLegacyId = await list(`company=${companies.probable}`);
    expect(byLegacyId.items.map((item) => item.id)).toEqual(byKey.items.map((item) => item.id));
    const other = await list(`company=${encodeURIComponent(`othercorp ${token}`)}`);
    expect(other.items.map((item) => item.id)).toEqual([ids.unrelated]);
  });

  it("drops malformed company values", () => {
    for (const value of ["Acme Analytics", "acme  analytics", "acme!", "acme-analytics", "x".repeat(201)]) {
      expect(parseOpportunityQuery(new URLSearchParams({ company: value })).company, value).toBeNull();
    }
    expect(parseOpportunityQuery(new URLSearchParams({ company: "acme analytics" })).company).toBe("acme analytics");
    expect(parseOpportunityQuery(new URLSearchParams({ company: "café ünïcode 2" })).company).toBe("café ünïcode 2");
  });
});
