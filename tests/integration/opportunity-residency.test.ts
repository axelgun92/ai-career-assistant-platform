import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityListRepository,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { parseOpportunityQuery, toListFilters } from "../../apps/web/src/server/opportunity-query";

// Task 7: explicit residency / geographic eligibility, persisted with
// provenance, independent of salary currency, filterable, and withheld from
// the evaluator. Every list query is scoped by a unique token in the title.

const database = getDatabaseClient();
const repository = new PrismaOpportunityListRepository();
const token = `rs${randomUUID().slice(0, 8)}`;
const ids: Record<string, string> = {};
const opportunityIds: string[] = [];
let tick = Date.parse("2026-10-02T10:00:00Z");
const service = createManualOpportunityService({
  repository: new PrismaManualOpportunityRepository(),
  normalizer: createManualOpportunityNormalizer(),
  clock: () => new Date((tick += 3_600_000)),
});

const seeds: Array<[string, Record<string, string>]> = [
  // U.S.-residency-required, quoted in a non-USD currency.
  ["usRequiredEur", { rawText: "Customer Success Manager.\nApplicants must reside in the United States.", compensationText: "€60,000" }],
  // Internationally located, quoted with a bare "$" (read as USD).
  ["spainUsd", { location: "Remote (Spain)", rawText: "Customer Success Manager for our EMEA customers.", compensationText: "$70,000" }],
  // Generic Remote: Unknown.
  ["remote", { location: "Remote", rawText: "Fully remote team.", compensationText: "USD 80,000" }],
  // Ambiguous geography: Unknown.
  ["ambiguous", { location: "Berlin, Germany", rawText: "US preferred. Must be authorized to work in the United States." }],
  // Stated by the user; wins over the text.
  ["stated", {
    rawText: "Applicants must reside in the United States.",
    residencyRequirement: "NON_US", residencyRegions: "Spain, Portugal",
  }],
];

beforeAll(async () => {
  for (const [key, fields] of seeds) {
    const detail = await service.submit({ domain: "customer-success", ...fields, title: `CSM ${key} ${token}` });
    ids[key] = detail.opportunity.id;
    opportunityIds.push(detail.opportunity.id);
  }
  // Captured before residency existed: no value, never backfilled.
  const legacy = await database.opportunity.create({
    data: {
      title: `Legacy CSM ${token}`, source: "manual-input", originalSource: "manual-input", sourceType: "MANUAL",
      domain: "customer-success", status: "NORMALIZED", jobDescription: "Applicants must reside in the United States.",
      discoveredAt: new Date("2026-09-01T10:00:00Z"), firstSeenAt: new Date("2026-09-01T10:00:00Z"),
      lastSeenAt: new Date("2026-09-01T10:00:00Z"),
    },
  });
  ids.legacy = legacy.id;
  opportunityIds.push(legacy.id);
});

afterAll(async () => {
  await database.sourceRecord.deleteMany({ where: { opportunityId: { in: opportunityIds } } });
  await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  await database.$disconnect();
});

const list = async (search: string) => {
  const query = parseOpportunityQuery(new URLSearchParams(search));
  const filters = toListFilters(query);
  return repository.listPage({
    filters: { ...filters, searchTerms: [...filters.searchTerms, token] },
    sort: query.sort,
    page: 1,
    pageSize: 50,
  });
};
const keysOf = async (search: string) =>
  (await list(search)).items.map((item) => Object.entries(ids).find(([, id]) => id === item.id)?.[0]);
const opportunity = (key: string) => database.opportunity.findUniqueOrThrow({ where: { id: ids[key]! } });
const provenance = (key: string) =>
  database.fieldProvenance.findMany({ where: { opportunityId: ids[key]!, fieldName: { startsWith: "residency" } }, orderBy: { fieldName: "asc" } });

describe("persisted residency facts", () => {
  it("keeps residency independent of the quoted currency", async () => {
    expect(await opportunity("usRequiredEur")).toMatchObject({ currency: "EUR", residencyRequirement: "US_REQUIRED", residencyRegions: ["US"] });
    expect(await opportunity("spainUsd")).toMatchObject({
      currency: "USD", residencyRequirement: "NON_US", residencyRegions: ["ES"], location: "Remote (Spain)",
    });
    expect(await opportunity("remote")).toMatchObject({ currency: "USD", residencyRequirement: null, residencyRegions: [] });
    expect(await opportunity("ambiguous")).toMatchObject({ residencyRequirement: null, residencyRegions: [], location: "Berlin, Germany" });
    expect(await opportunity("legacy")).toMatchObject({ residencyRequirement: null, residencyRegions: [] });
  });

  it("records deterministic provenance with a source marker, and direct provenance for stated values", async () => {
    expect(await provenance("usRequiredEur")).toEqual([
      expect.objectContaining({ fieldName: "residencyRegions", kind: "DETERMINISTIC", sourceField: "rawText:explicit-residency-statement", normalizedValue: ["US"] }),
      expect.objectContaining({
        fieldName: "residencyRequirement", kind: "DETERMINISTIC", sourceField: "rawText:explicit-residency-statement",
        normalizedValue: "US_REQUIRED", sourceText: "Applicants must reside in the United States.",
      }),
    ]);
    expect(await provenance("spainUsd")).toEqual([
      expect.objectContaining({ fieldName: "residencyRegions", sourceField: "location:explicit-eligible-geography", sourceText: "Remote (Spain)" }),
      expect.objectContaining({ fieldName: "residencyRequirement", sourceField: "location:explicit-eligible-geography", normalizedValue: "NON_US" }),
    ]);
    expect(await provenance("stated")).toEqual([
      expect.objectContaining({ fieldName: "residencyRegions", kind: "DETERMINISTIC", sourceField: "residencyRegions", normalizedValue: ["ES", "PT"] }),
      expect.objectContaining({ fieldName: "residencyRequirement", kind: "DIRECT", sourceField: "residencyRequirement", normalizedValue: "NON_US" }),
    ]);
    expect(await provenance("remote")).toEqual([]);
    expect(await provenance("ambiguous")).toEqual([]);
  });

  it("leaves the raw SourceRecord exactly as captured", async () => {
    const [source] = await database.sourceRecord.findMany({ where: { opportunityId: ids.spainUsd! } });
    expect(source).toMatchObject({
      rawLocation: "Remote (Spain)", rawSalaryText: "$70,000", rawDescription: "Customer Success Manager for our EMEA customers.",
    });
    const [stated] = await database.sourceRecord.findMany({ where: { opportunityId: ids.stated! } });
    expect(stated!.rawDescription).toBe("Applicants must reside in the United States.");
    expect(stated!.sourceMetadata).toMatchObject({ details: { residencyRequirement: "NON_US", residencyRegions: "Spain, Portugal" } });
  });

  it("withholds residency from the evaluator subject (no contract change yet)", async () => {
    const subject = await new PrismaEvaluationRepository().loadSubject({ opportunityId: ids.usRequiredEur!, userProfileId: null });
    expect(subject!.opportunity).toMatchObject({ residencyRequirement: null, residencyRegions: [], currency: null, salaryMin: null });
    expect(subject!.provenance.map((row) => row.fieldName)).not.toEqual(expect.arrayContaining(["residencyRequirement"]));
    expect(subject!.provenance.map((row) => row.fieldName)).not.toEqual(expect.arrayContaining(["residencyRegions"]));
    expect(subject!.opportunity.jobDescription).toContain("must reside in the United States");
  });
});

describe("residency filters", () => {
  it("U.S.-required, non-U.S. and Unknown; OR within the filter", async () => {
    expect(await keysOf("view=all&residency=us-required")).toEqual(["usRequiredEur"]);
    expect(await keysOf("view=all&residency=non-us")).toEqual(["stated", "spainUsd"]);
    expect(await keysOf("view=all&residency=unknown")).toEqual(["ambiguous", "remote", "legacy"]);
    expect(await keysOf("view=all&residency=us-required,non-us")).toEqual(["stated", "spainUsd", "usRequiredEur"]);
  });

  it("combines with salary and currency filters (AND), never treating currency as residency", async () => {
    expect(await keysOf("view=all&residency=us-required&currency=EUR")).toEqual(["usRequiredEur"]);
    expect(await keysOf("view=all&residency=non-us&currency=USD&salaryMin=60000")).toEqual(["spainUsd"]);
    expect(await keysOf("view=all&residency=us-required&currency=USD")).toEqual([]);
    expect(await keysOf("view=all&currency=USD")).toEqual(["remote", "spainUsd"]);
  });

  it("ignores malformed residency values; rows carry the facts", async () => {
    expect(await keysOf("view=all&residency=mars")).toHaveLength(6);
    const row = (await list("view=all&residency=non-us&q=spainUsd")).items[0]!;
    expect(row).toMatchObject({ residencyRequirement: "NON_US", residencyRegions: ["ES"], currency: "USD" });
    const legacy = (await list("view=all&q=legacy")).items[0]!;
    expect(legacy).toMatchObject({ residencyRequirement: null, residencyRegions: [] });
  });
});
