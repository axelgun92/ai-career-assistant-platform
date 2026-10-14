import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  fieldsWithheldFromEvaluator,
  getDatabaseClient,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityDashboardRepository,
  PrismaOpportunityListRepository,
  type OpportunityListSort,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { parseOpportunityQuery, toListFilters } from "../../apps/web/src/server/opportunity-query";

// Task 7 completion amendment: manual opportunities are normalized through
// the real service, then filtered and sorted through the real query layer.
// Every list query is scoped by a unique token in the title.

const database = getDatabaseClient();
const repository = new PrismaOpportunityListRepository();
const token = `nf${randomUUID().slice(0, 8)}`;
const ids: Record<string, string> = {};
const opportunityIds: string[] = [];
let tick = Date.parse("2026-10-01T10:00:00Z");
const service = createManualOpportunityService({
  repository: new PrismaManualOpportunityRepository(),
  normalizer: createManualOpportunityNormalizer(),
  // One hour apart, in creation order: later seeds are newer.
  clock: () => new Date((tick += 3_600_000)),
});

const manualSeeds: Array<[string, Record<string, string>]> = [
  ["senior", {
    title: "Senior Customer Success Manager", location: "Remote - United States",
    compensationText: "$90,000-$110,000",
  }],
  ["hybrid", {
    title: "Customer Success Manager", location: "Boston, MA (Hybrid)", compensationText: "USD 70,000 - 80,000",
    department: "Customer Success", employmentType: "FULL_TIME",
  }],
  ["director", {
    title: "Director of Customer Success", location: "London", compensationText: "£95,000",
    workArrangement: "ONSITE", closingDate: "2026-11-30",
  }],
  ["ote", { title: "Customer Success Manager", location: "Remote or hybrid", compensationText: "$120k OTE" }],
  ["conflict", { title: "CSM", compensationText: "€60,000 USD" }],
  ["upTo", { title: "Customer Success Manager", compensationText: "Up to $85,000", seniority: "MID", department: "Support" }],
  ["from", { title: "Customer Success Manager", compensationText: "From $100,000" }],
];

beforeAll(async () => {
  for (const [key, fields] of manualSeeds) {
    const detail = await service.submit({
      rawText: `Customer Success role ${key}. Remote team; competitive pay.`,
      domain: "customer-success",
      ...fields,
      title: `${fields.title} ${token}`,
    });
    ids[key] = detail.opportunity.id;
    opportunityIds.push(detail.opportunity.id);
  }
  // A record captured before this amendment: salary text only, every
  // normalized fact null. It is never backfilled.
  const legacy = await database.opportunity.create({
    data: {
      title: `Legacy CSM ${token}`,
      salaryText: "$75,000",
      source: "manual-input",
      originalSource: "manual-input",
      sourceType: "MANUAL",
      domain: "customer-success",
      status: "NORMALIZED",
      jobDescription: "Legacy description",
      discoveredAt: new Date("2026-09-01T10:00:00Z"),
      firstSeenAt: new Date("2026-09-01T10:00:00Z"),
      lastSeenAt: new Date("2026-09-01T10:00:00Z"),
    },
  });
  ids.legacy = legacy.id;
  opportunityIds.push(legacy.id);
});

afterAll(async () => {
  const companies = await database.opportunity.findMany({
    where: { id: { in: opportunityIds } },
    select: { companyId: true },
  });
  await database.sourceRecord.deleteMany({ where: { opportunityId: { in: opportunityIds } } });
  await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  const companyIds = companies.flatMap((row) => (row.companyId ? [row.companyId] : []));
  if (companyIds.length) await database.company.deleteMany({ where: { id: { in: companyIds } } });
  await database.$disconnect();
});

const list = (search: string) => {
  const query = parseOpportunityQuery(new URLSearchParams(search));
  const filters = toListFilters(query);
  return repository.listPage({
    filters: { ...filters, searchTerms: [...filters.searchTerms, token] },
    sort: query.sort as OpportunityListSort,
    page: 1,
    pageSize: 50,
  });
};
const keysOf = (result: Awaited<ReturnType<typeof list>>) =>
  result.items.map((item) => Object.entries(ids).find(([, id]) => id === item.id)?.[0]);

describe("normalization persists explicit facts and preserves the source", () => {
  it("stores numeric compensation, currency and position facts with provenance", async () => {
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: ids.senior! } });
    expect(opportunity).toMatchObject({
      salaryText: "$90,000-$110,000",
      currency: "USD",
      remoteStatus: "REMOTE",
      seniority: "SENIOR",
      department: null,
      employmentType: null,
      closingDate: null,
    });
    expect(opportunity.salaryMin?.toNumber()).toBe(90000);
    expect(opportunity.salaryMax?.toNumber()).toBe(110000);

    const [source] = await database.sourceRecord.findMany({ where: { opportunityId: ids.senior! } });
    expect(source).toMatchObject({
      rawSalaryText: "$90,000-$110,000",
      rawLocation: "Remote - United States",
      rawTitle: `Senior Customer Success Manager ${token}`,
    });
    const provenance = await database.fieldProvenance.findMany({ where: { opportunityId: ids.senior! } });
    const byField = Object.fromEntries(provenance.map((row) => [row.fieldName, row]));
    expect(byField.salaryMin).toMatchObject({ kind: "DETERMINISTIC", sourceField: "compensationText", normalizedValue: 90000, sourceText: "$90,000-$110,000" });
    expect(byField.salaryMax).toMatchObject({ normalizedValue: 110000 });
    // A bare "$" is read as USD and recorded as derived, with its own marker.
    expect(byField.currency).toMatchObject({
      kind: "DETERMINISTIC", sourceField: "compensationText:bare-dollar-as-usd", normalizedValue: "USD", sourceText: "$90,000-$110,000",
    });
    expect(byField.remoteStatus).toMatchObject({ kind: "DETERMINISTIC", sourceField: "location", normalizedValue: "REMOTE" });
    expect(byField.seniority).toMatchObject({ kind: "DETERMINISTIC", sourceField: "title", normalizedValue: "SENIOR" });
    expect(provenance.every((row) => row.sourceRecordId === source!.id)).toBe(true);
  });

  it("records stated details as entered and keeps ambiguous or conflicting text Unknown", async () => {
    const director = await database.opportunity.findUniqueOrThrow({ where: { id: ids.director! } });
    expect(director).toMatchObject({ currency: "GBP", remoteStatus: "ONSITE", seniority: "DIRECTOR" });
    expect(director.closingDate?.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    const hybrid = await database.opportunity.findUniqueOrThrow({ where: { id: ids.hybrid! } });
    expect(hybrid).toMatchObject({ remoteStatus: "HYBRID", seniority: null, department: "Customer Success", employmentType: "FULL_TIME", currency: "USD" });
    const hybridCurrency = await database.fieldProvenance.findFirstOrThrow({ where: { opportunityId: ids.hybrid!, fieldName: "currency" } });
    expect(hybridCurrency).toMatchObject({ kind: "DETERMINISTIC", sourceField: "compensationText", sourceText: "USD 70,000 - 80,000" });
    const [hybridSource] = await database.sourceRecord.findMany({ where: { opportunityId: ids.hybrid! } });
    expect(hybridSource).toMatchObject({ rawEmploymentType: "FULL_TIME" });
    expect(hybridSource!.sourceMetadata).toMatchObject({ details: { department: "Customer Success" } });

    const ote = await database.opportunity.findUniqueOrThrow({ where: { id: ids.ote! } });
    expect(ote).toMatchObject({ salaryMin: null, salaryMax: null, currency: "USD", remoteStatus: null, salaryText: "$120k OTE" });
    const conflict = await database.opportunity.findUniqueOrThrow({ where: { id: ids.conflict! } });
    expect(conflict.currency).toBeNull();
    expect(conflict.salaryMin?.toNumber()).toBe(60000);
    const upTo = await database.opportunity.findUniqueOrThrow({ where: { id: ids.upTo! } });
    expect(upTo).toMatchObject({ salaryMin: null, seniority: "MID", department: "Support" });
    expect(upTo.salaryMax?.toNumber()).toBe(85000);
  });

  it("delivers the evaluator exactly the pre-amendment subject for the newly populated fields", async () => {
    const subject = await new PrismaEvaluationRepository().loadSubject({ opportunityId: ids.director!, userProfileId: null });
    // Withheld as their pre-amendment empty value: null, or [] for a list.
    for (const field of fieldsWithheldFromEvaluator) {
      expect(subject!.opportunity[field]).toEqual(field === "residencyRegions" ? [] : null);
    }
    expect(subject!.opportunity.salaryText).toBe("£95,000");
    expect(subject!.opportunity.location).toBe("London");
    const delivered = subject!.provenance.map((row) => row.fieldName);
    expect(delivered).toContain("jobDescription");
    expect(delivered).toContain("salaryText");
    for (const field of fieldsWithheldFromEvaluator) expect(delivered).not.toContain(field);
  });
});

describe("salary range filters", () => {
  it("matches stated ranges that can reach the amount, in one currency, and reports what was left out", async () => {
    const atLeast = await list("view=all&salaryMin=95000&currency=USD");
    expect(keysOf(atLeast)).toEqual(["from", "senior"]);
    expect(atLeast.salaryExclusions).toEqual({ currency: "USD", withoutAmount: 2, unknownCurrency: 1, otherCurrency: 1 });

    expect(keysOf(await list("view=all&salaryMax=80000&currency=USD"))).toEqual(["upTo", "hybrid"]);
    // Inclusive boundaries.
    expect(keysOf(await list("view=all&salaryMin=110000&salaryMax=110000&currency=USD"))).toEqual(["from", "senior"]);
    expect(keysOf(await list("view=all&salaryMin=110001&currency=USD"))).toEqual(["from"]);
    expect(keysOf(await list("view=all&salaryMin=90000&currency=GBP"))).toEqual(["director"]);
  });

  it("defaults an amount to USD, never compares across currencies, and filters by currency alone", async () => {
    const defaulted = await list("view=all&salaryMin=95000");
    expect(defaulted.salaryExclusions?.currency).toBe("USD");
    expect(keysOf(defaulted)).toEqual(["from", "senior"]);
    expect(keysOf(await list("view=all&currency=GBP"))).toEqual(["director"]);
    expect((await list("view=all&currency=GBP")).salaryExclusions).toBeNull();
    await expect(
      repository.listPage({ filters: { salaryAtLeast: 1000 }, sort: "newest", page: 1, pageSize: 10 }),
    ).rejects.toThrow("A salary amount filter requires a currency");
  });

  it("ignores malformed salary parameters instead of failing", async () => {
    const all = keysOf(await list("view=all"));
    expect(all).toHaveLength(8);
    expect(keysOf(await list("view=all&salaryMin=abc&salaryMax=-5&currency=XYZ"))).toEqual(all);
    // An inverted range is dropped as a whole.
    expect(keysOf(await list("view=all&salaryMin=120000&salaryMax=90000"))).toEqual(all);
  });
});

describe("position filters", () => {
  it("work arrangement: OR within the filter, Unknown is its own option", async () => {
    expect(keysOf(await list("view=all&arrangement=remote"))).toEqual(["senior"]);
    expect(keysOf(await list("view=all&arrangement=remote,hybrid"))).toEqual(["hybrid", "senior"]);
    expect(keysOf(await list("view=all&arrangement=unknown"))).toEqual(["from", "upTo", "conflict", "ote", "legacy"]);
  });

  it("seniority and department, combined with AND across groups", async () => {
    expect(keysOf(await list("view=all&seniority=mid"))).toEqual(["upTo"]);
    expect(keysOf(await list("view=all&seniority=senior,director&arrangement=onsite"))).toEqual(["director"]);
    expect(keysOf(await list("view=all&seniority=unknown"))).toEqual(["from", "conflict", "ote", "hybrid", "legacy"]);
    expect(keysOf(await list("view=all&department=Customer%20Success"))).toEqual(["hybrid"]);
    expect(keysOf(await list("view=all&department=Support&salaryMax=80000&currency=USD"))).toEqual(["upTo"]);
  });

  it("older records with null facts stay listed and filterable", async () => {
    expect(keysOf(await list("view=all&salary=stated&seniority=unknown&arrangement=unknown"))).toContain("legacy");
    const legacy = (await list("view=all&q=legacy")).items[0]!;
    expect(legacy).toMatchObject({ salaryText: "$75,000", salaryMin: null, salaryMax: null, currency: null, remoteStatus: null, seniority: null });
  });

  it("offers departments and salary currencies present in the data", async () => {
    const options = await new PrismaOpportunityDashboardRepository().filterOptions();
    expect(options.departments.map((option) => option.value)).toEqual(expect.arrayContaining(["Customer Success", "Support"]));
    expect(options.currencies.map((option) => option.value)).toEqual(expect.arrayContaining(["GBP", "USD"]));
  });
});

describe("salary sorts", () => {
  it("highest first: grouped by currency, unknown currency next, no amount last, stable ties", async () => {
    expect(keysOf(await list("view=all&sort=salary-high"))).toEqual([
      "director", // GBP
      "senior", "from", "upTo", "hybrid", // USD 110k, 100k, 85k, 80k
      "conflict", // amount, unknown currency
      "ote", "legacy", // no amount, newest first
    ]);
  });

  it("lowest first, and within one currency when a currency is selected", async () => {
    expect(keysOf(await list("view=all&sort=salary-low"))).toEqual([
      "director",
      "hybrid", "upTo", "senior", "from", // USD 70k, 85k, 90k, 100k
      "conflict",
      "ote", "legacy",
    ]);
    // A currency alone also keeps a listing that states the currency but no
    // amount (OTE); it sorts after every amount.
    expect(keysOf(await list("view=all&sort=salary-low&currency=USD"))).toEqual(["hybrid", "upTo", "senior", "from", "ote"]);
    const first = keysOf(await list("view=all&sort=salary-high"));
    expect(keysOf(await list("view=all&sort=salary-high"))).toEqual(first);
  });
});
