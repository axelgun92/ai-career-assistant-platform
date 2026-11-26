// The 500-candidate cap (November 25, 2026): company similarity is capped,
// reliable identifiers are not. With 600 opportunities at one employer, an
// exact listing-ID, requisition-ID or URL match held by the NEWEST of them
// (outside the 500 oldest) is still found, and a capture attaches to it.
// No threshold or engine rule changes.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import { decideDuplicates, normalizeCompanyName, type DuplicateIdentity } from "@ai-career/deduplication";
import { findDuplicateCandidates, getDatabaseClient, PrismaManualOpportunityRepository } from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

const database = getDatabaseClient();
const service = createManualOpportunityService({
  repository: new PrismaManualOpportunityRepository(),
  normalizer: createManualOpportunityNormalizer(),
});
const token = `Cap${randomUUID().slice(0, 8)}`;
const companyName = `Capco ${token}`;
let companyId = "";
let newestId = "";
let oldestId = "";
const newestUrl = `https://boards.greenhouse.io/capco/jobs/${token}-newest`;

beforeAll(async () => {
  const company = await database.company.create({ data: { name: companyName, normalizedName: normalizeCompanyName(companyName) } });
  companyId = company.id;
  const base = Date.UTC(2026, 0, 1);
  await database.opportunity.createMany({
    data: Array.from({ length: 600 }, (_, index) => ({
      domain: "customer-success",
      status: "NORMALIZED" as const,
      companyId,
      title: `Customer Success Manager ${index}`,
      location: "Remote - United States",
      jobDescription: `Role ${index} at ${companyName}.`,
      firstSeenAt: new Date(base + index * 60_000),
      ...(index === 599
        ? { externalListingId: `${token}-L599`, atsRequisitionId: `${token}-R599`, canonicalUrl: newestUrl }
        : {}),
      ...(index === 0 ? { externalListingId: `${token}-L0` } : {}),
    })),
  });
  const ends = await database.opportunity.findMany({
    where: { companyId },
    orderBy: { firstSeenAt: "asc" },
    select: { id: true, externalListingId: true },
  });
  expect(ends).toHaveLength(600);
  oldestId = ends[0]!.id;
  newestId = ends.at(-1)!.id;
}, 60_000);

afterAll(async () => {
  const ids = (await database.opportunity.findMany({ where: { companyId }, select: { id: true } })).map((row) => row.id);
  await database.duplicateReference.deleteMany({ where: { OR: [{ opportunityId: { in: ids } }, { relatedOpportunityId: { in: ids } }] } });
  await database.sourceRecord.deleteMany({ where: { OR: [{ opportunityId: { in: ids } }, { rawDescription: { contains: token } }] } });
  await database.opportunity.deleteMany({ where: { companyId } });
  await database.company.deleteMany({ where: { name: { contains: token } } });
  await database.$disconnect();
}, 60_000);

function subject(overrides: Partial<DuplicateIdentity>): DuplicateIdentity {
  return {
    companyName,
    title: "Customer Success Manager",
    location: "Remote - United States",
    description: `A new capture at ${companyName}.`,
    urls: [],
    listingIds: [],
    requisitionIds: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
    ...overrides,
  } as DuplicateIdentity;
}

describe("candidate lookup with 600 opportunities at one employer", () => {
  it("still caps company-similarity candidates at 500", async () => {
    const { candidates } = await findDuplicateCandidates(database, subject({}));
    expect(candidates).toHaveLength(500);
    expect(candidates.map((candidate) => candidate.opportunityId)).not.toContain(newestId);
  });

  it.each([
    ["listing ID", { listingIds: [`${token}-L599`] }],
    ["requisition ID", { requisitionIds: [`${token}-R599`] }],
    ["listing URL", { urls: [`${newestUrl}?utm_source=newsletter`] }],
  ] as const)("finds the newest opportunity's %s beyond the cap and decides MATCH", async (_label, identifiers) => {
    // The same title: a URL match never overrides a title conflict.
    const identity = subject({ ...identifiers, title: "Customer Success Manager 599" });
    const { candidates } = await findDuplicateCandidates(database, identity);
    expect(candidates.map((candidate) => candidate.opportunityId)).toContain(newestId);
    // The 500 company candidates are still read, plus the identified one.
    expect(candidates).toHaveLength(501);
    const decision = decideDuplicates(identity, candidates);
    expect(decision.decision).toBe("MATCH");
    expect(decision.canonical?.opportunityId).toBe(newestId);
  });

  it("keeps the oldest-first order and lists an identified opportunity once", async () => {
    const { candidates } = await findDuplicateCandidates(database, subject({ listingIds: [`${token}-L0`] }));
    expect(candidates).toHaveLength(500);
    expect(candidates[0]!.opportunityId).toBe(oldestId);
    const times = candidates.map((candidate) => candidate.firstSeenAt.getTime());
    expect(times).toEqual([...times].sort((left, right) => left - right));
  });

  it("attaches a capture of the newest opportunity's URL to it instead of creating another", async () => {
    const result = await service.submit({
      rawText: `Customer Success Manager 599 at ${companyName}.\nRole 599 at ${companyName}.`,
      title: "Customer Success Manager 599",
      company: companyName,
      location: "Remote - United States",
      domain: "customer-success",
      sourceUrl: `${newestUrl}?utm_source=newsletter`,
    });
    expect(result.deduplication).toMatchObject({ outcome: "ATTACHED", decision: "MATCH", canonicalOpportunityId: newestId });
    expect(await database.opportunity.count({ where: { companyId } })).toBe(600);
  });
});
