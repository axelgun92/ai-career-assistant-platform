// Workstream B evidence-based updates on the test database (November 6,
// 2026): successive browser-extension reads of the same job through the
// real capture path. Only evidence changes a saved fact: a complete salary
// statement replaces a saved salary, a partial one never does; unstated
// facts are kept; only the posting's own explicit words withdraw a fact
// (no deadline, pay not disclosed, arrangement not decided), never a
// template "Not specified"; user corrections stay; exclusions persist and
// re-project; an identical re-read adds no source record; and two similar
// postings with different listing IDs and URLs (the FourKites case) are at
// most a probable duplicate, never merged. No network, evaluator or profile.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createRetrievalIngestionService, extensionCaptureSchemaVersion, pageReaderRevision } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { PrismaExtensionLookupRepository, PrismaManualOpportunityRepository } from "@ai-career/database";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createCleanup, database } from "../support/budget-integration";

const cleanup = createCleanup();
const run = randomUUID().slice(0, 8);
const clock = { now: new Date("2026-11-06T12:00:00.000Z") };
const service = createExtensionCaptureService({
  ingestion: createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() }),
  lookup: new PrismaExtensionLookupRepository(),
  latestEvaluation: async () => null,
  discovery: customerSuccessDiscoveryConfiguration,
  now: () => clock.now,
});
let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };

const base = [
  "Customer Success Manager for a workflow SaaS platform.",
  "Own onboarding, adoption, education, and retention for a portfolio of B2B customers.",
  "Run quarterly business reviews and partner with Sales on renewals.",
];
const pageUrl = (name: string) => `https://careers.evidence-${run}.example/jobs/${name}`;
async function read(name: string, lines: string[], fields: Record<string, unknown> = {}, editedFields: string[] = []) {
  clock.now = new Date(clock.now.getTime() + 60_000);
  const { result } = await service.capture(
    {
      schemaVersion: extensionCaptureSchemaVersion,
      pageUrl: pageUrl(name),
      extractor: "main-content",
      capturedAt: clock.now.toISOString(),
      extensionVersion: "0.3.0",
      readerRevision: pageReaderRevision,
      fields: { title: "Customer Success Manager", company: `Evidence ${name} ${run}`, description: lines.join("\n\n"), ...fields },
      editedFields,
    },
    pairing,
  );
  if (!cleanup.opportunityIds.includes(result.opportunityId)) cleanup.opportunityIds.push(result.opportunityId);
  return result;
}
const saved = (id: string) => database.opportunity.findUniqueOrThrow({ where: { id } });
const current = (id: string, fieldName: string) =>
  database.fieldProvenance.findMany({ where: { opportunityId: id, fieldName, supersededAt: null }, orderBy: { createdAt: "asc" } });
const history = (id: string, fieldName: string) =>
  database.fieldProvenance.findMany({ where: { opportunityId: id, fieldName }, orderBy: { createdAt: "asc" } });
const salaryOf = async (id: string) => {
  const row = await saved(id);
  return {
    min: row.salaryMin === null ? null : Number(row.salaryMin),
    max: row.salaryMax === null ? null : Number(row.salaryMax),
    currency: row.currency,
    basis: row.compensationBasis,
    tiers: Array.isArray(row.compensationTiers) ? row.compensationTiers.length : 0,
    text: row.salaryText,
  };
};

beforeEach(async () => {
  await cleanup.before();
  pairing = await database.extensionPairing.create({ data: { label: "Evidence updates", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const ids = [...cleanup.opportunityIds];
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: ids }, laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.duplicateReference.deleteMany({ where: { OR: [{ opportunityId: { in: ids } }, { relatedOpportunityId: { in: ids } }] } });
  await cleanup.after();
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
});

afterAll(() => database.$disconnect());

describe("salary: a complete statement replaces a saved salary; a partial one never does", () => {
  it("keeps a verified range against partial evidence, takes a complete new range, and clears only on an explicit 'not disclosed'", async () => {
    const first = await read("salary", [...base, "The base salary range is $90,000 - $110,000 USD per year."]);
    expect(await salaryOf(first.opportunityId)).toMatchObject({ min: 90_000, max: 110_000, currency: "USD" });

    // A salary text with no amounts.
    expect((await read("salary", [...base, "Read two."], { salaryText: "Competitive" })).outcome).toBe("CHANGED");
    expect(await salaryOf(first.opportunityId)).toMatchObject({ min: 90_000, max: 110_000, currency: "USD" });
    // Amounts with no currency.
    await read("salary", [...base, "Read three."], { salaryText: "95,000 - 120,000" });
    expect(await salaryOf(first.opportunityId)).toMatchObject({ min: 90_000, max: 110_000, currency: "USD" });
    // A template "Not specified": not a withdrawal, and not a salary.
    await read("salary", [...base, "Salary: Not specified", "Read four."]);
    expect(await salaryOf(first.opportunityId)).toMatchObject({ min: 90_000, max: 110_000, currency: "USD" });
    // The current provenance still cites the read that stated the range.
    expect((await current(first.opportunityId, "salaryMin")).map((row) => row.sourceText)).toEqual([expect.stringContaining("$90,000 - $110,000")]);

    // A complete new statement replaces the whole group.
    await read("salary", [...base, "The base salary range is $95,000 - $120,000 USD per year."]);
    expect(await salaryOf(first.opportunityId)).toMatchObject({ min: 95_000, max: 120_000, currency: "USD" });

    // The posting's own words withdraw it; the history keeps both ranges.
    await read("salary", [...base, "Salary: not disclosed."]);
    expect(await salaryOf(first.opportunityId)).toMatchObject({ min: null, max: null, currency: null, text: null, tiers: 0 });
    expect(await current(first.opportunityId, "salaryMin")).toEqual([
      expect.objectContaining({ sourceField: "explicit-withdrawal:salary", sourceText: "Salary: not disclosed" }),
    ]);
    expect((await history(first.opportunityId, "salaryMin")).map((row) => row.normalizedValue)).toEqual(expect.arrayContaining([90_000, 95_000]));
  });

  it("keeps saved tiers against partial evidence, and fills an empty salary group with partial text", async () => {
    const tiered = await read("tiers", [
      ...base,
      "We hire across the United States and Canada.",
      "The base salary range for this role is $86,000 - $95,000 USD in the U.S. and $77,000 - $85,000 CAD in Canada.",
    ]);
    expect(await salaryOf(tiered.opportunityId)).toMatchObject({ min: null, tiers: 2 });
    await read("tiers", [...base, "We hire across the United States and Canada.", "Read two."], { salaryText: "Competitive pay" });
    expect(await salaryOf(tiered.opportunityId)).toMatchObject({ tiers: 2 });
    await read("tiers", [...base, "Read three."]);
    expect(await salaryOf(tiered.opportunityId)).toMatchObject({ tiers: 2 });

    // No amounts saved yet: a partial salary text is still recorded.
    const textOnly = await read("text-only", base, { salaryText: "Competitive" });
    expect(await salaryOf(textOnly.opportunityId)).toMatchObject({ min: null, text: "Competitive" });
    await read("text-only", [...base, "Read two."], { salaryText: "Competitive plus bonus" });
    expect(await salaryOf(textOnly.opportunityId)).toMatchObject({ min: null, text: "Competitive plus bonus" });
  });
});

describe("work arrangement and closing date: kept unless the posting withdraws them in its own words", () => {
  it("keeps a stated arrangement when a read omits it or shows a template 'Not specified', and clears it on 'to be determined'", async () => {
    const first = await read("arrangement", [...base, "This is a fully remote role."]);
    expect(await saved(first.opportunityId)).toMatchObject({ remoteStatus: "REMOTE" });
    await read("arrangement", [...base, "Read two."]);
    expect(await saved(first.opportunityId)).toMatchObject({ remoteStatus: "REMOTE" });
    await read("arrangement", [...base, "Remote: Not specified", "Read three."]);
    expect(await saved(first.opportunityId)).toMatchObject({ remoteStatus: "REMOTE" });
    await read("arrangement", [...base, "Work arrangement: to be determined with the hiring manager."]);
    expect(await saved(first.opportunityId)).toMatchObject({ remoteStatus: null, workArrangements: [] });
    expect(await current(first.opportunityId, "remoteStatus")).toEqual([
      expect.objectContaining({ sourceField: "explicit-withdrawal:workArrangement", sourceText: "Work arrangement: to be determined with the hiring manager" }),
    ]);
    expect((await history(first.opportunityId, "remoteStatus")).some((row) => row.normalizedValue === "REMOTE" && row.supersededAt !== null)).toBe(true);
  });

  it("keeps a closing date a read omits, and clears it only on 'open until filled'", async () => {
    const first = await read("closing", [...base, "Applications close on December 20, 2026."]);
    expect((await saved(first.opportunityId)).closingDate).not.toBeNull();
    await read("closing", [...base, "Deadline: Unknown"]);
    expect((await saved(first.opportunityId)).closingDate).not.toBeNull();
    await read("closing", [...base, "This position is open until filled."]);
    expect((await saved(first.opportunityId)).closingDate).toBeNull();
  });
});

describe("user corrections, exclusions and identity", () => {
  it("keeps a location the user corrected when a later read states another, and when it states none", async () => {
    const first = await read("corrected", base, { location: "Austin, TX" }, ["location"]);
    expect(await saved(first.opportunityId)).toMatchObject({ location: "Austin, TX" });
    await read("corrected", [...base, "Read two."], { location: "Remote" });
    expect(await saved(first.opportunityId)).toMatchObject({ location: "Austin, TX" });
    await read("corrected", [...base, "Read three."]);
    expect(await saved(first.opportunityId)).toMatchObject({ location: "Austin, TX" });
    expect(await current(first.opportunityId, "location")).toEqual([expect.objectContaining({ sourceField: "userCorrected:location" })]);
  });

  it("saves residency exclusions, updates them from a new statement, keeps them when a read omits residency, and never touches work authorization", async () => {
    const first = await read("exclusions", [...base, "Candidates must reside in the United States, excluding residents of Alaska, California, and Hawaii."]);
    expect(await saved(first.opportunityId)).toMatchObject({ residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], residencyExclusions: ["US-AK", "US-CA", "US-HI"], workAuthorizationRequirement: null });
    await read("exclusions", [...base, "Candidates must reside in the United States, excluding residents of Alaska."]);
    expect(await saved(first.opportunityId)).toMatchObject({ residencyExclusions: ["US-AK"] });
    await read("exclusions", [...base, "Read three."]);
    expect(await saved(first.opportunityId)).toMatchObject({ residencyRequirement: "US_REQUIRED", residencyExclusions: ["US-AK"], workAuthorizationRequirement: null, workAuthorizationRegions: [] });
    expect(await current(first.opportunityId, "residencyExclusions")).toEqual([expect.objectContaining({ sourceField: "rawText:explicit-residency-exclusion" })]);
  });

  it("adds no source record for an identical re-read", async () => {
    const lines = [...base, "Same text each time."];
    const first = await read("identical", lines);
    const records = await database.sourceRecord.count({ where: { opportunityId: first.opportunityId } });
    clock.now = new Date(clock.now.getTime() - 60_000); // same capture time
    const again = await read("identical", lines);
    expect(again).toMatchObject({ opportunityId: first.opportunityId, outcome: "UNCHANGED" });
    expect(await database.sourceRecord.count({ where: { opportunityId: first.opportunityId } })).toBe(records);
  });

  it("keeps two similar postings with different listing IDs and URLs apart (at most a probable duplicate), and attaches only the same posting", async () => {
    const company = `FourKites ${run}`;
    const description = [
      `${company} is the leading supply chain visibility platform.`,
      "As a Customer Success Manager you own onboarding, adoption, renewals and expansion for a portfolio of mid-market customers.",
      "Run quarterly business reviews. Partner with Sales and Support. Chicago, IL.",
    ];
    const capture = async (url: string, title: string) => {
      clock.now = new Date(clock.now.getTime() + 60_000);
      const { result } = await service.capture(
        {
          schemaVersion: extensionCaptureSchemaVersion,
          pageUrl: url,
          extractor: "structured-data",
          capturedAt: clock.now.toISOString(),
          extensionVersion: "0.3.0",
          readerRevision: pageReaderRevision,
          fields: { title, company, location: "Chicago, IL", description: description.join("\n\n") },
        },
        pairing,
      );
      if (!cleanup.opportunityIds.includes(result.opportunityId)) cleanup.opportunityIds.push(result.opportunityId);
      return result;
    };
    const first = await capture(`https://www.welcometothejungle.com/en/companies/fourkites-${run}/jobs/customer-success-manager_chicago_a1b2c3d4`, "Customer Success Manager");
    const similar = await capture(`https://www.welcometothejungle.com/en/companies/fourkites-${run}/jobs/senior-customer-success-manager_chicago_e5f6g7h8`, "Senior Customer Success Manager");
    const identicalText = await capture(`https://www.welcometothejungle.com/en/companies/fourkites-${run}/jobs/customer-success-manager_chicago_i9j0k1l2`, "Customer Success Manager");
    for (const other of [similar, identicalText]) {
      expect(other.opportunityId).not.toBe(first.opportunityId);
      expect(other.outcome).toBe("CREATED");
      expect(other.decision === null || other.decision === "NO_MATCH" || other.decision === "PROBABLE_MATCH").toBe(true);
      const references = await database.duplicateReference.findMany({ where: { opportunityId: other.opportunityId } });
      expect(references.every((reference) => reference.decision === "PROBABLE_MATCH")).toBe(true);
    }
    expect(await database.opportunity.count({ where: { company: { name: company } } })).toBe(3);
    // The same posting (same URL) attaches, as before.
    const again = await capture(`https://www.welcometothejungle.com/en/companies/fourkites-${run}/jobs/customer-success-manager_chicago_a1b2c3d4?utm_source=x`, "Customer Success Manager");
    expect(again.opportunityId).toBe(first.opportunityId);
    expect(await database.opportunity.count({ where: { company: { name: company } } })).toBe(3);
  });
});
