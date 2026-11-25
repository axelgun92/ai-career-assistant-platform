// Duplicate decisions and the Possible Duplicates review (November 25, 2026),
// on the isolated test database: a relationship reads the same from both
// opportunities, a decision persists and Undo restores it, pairs are decided
// independently, "same job" merges nothing but blocks a second paid
// evaluation, and the review groups the listings once.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaDuplicateRepository,
  PrismaDuplicateReviewRepository,
  PrismaManualOpportunityRepository,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

const database = getDatabaseClient();
const duplicates = new PrismaDuplicateRepository();
const service = createManualOpportunityService({ repository: new PrismaManualOpportunityRepository(), normalizer: createManualOpportunityNormalizer() });
const token = `Rev${randomUUID().slice(0, 8)}`;
let ids: string[] = [];

const body = (city: string) => [
  `Customer Success Manager at Reviewco ${token}. Location: ${city}.`,
  "Own onboarding, adoption and renewals for a portfolio of mid-market SaaS customers across North America.",
  "Run quarterly business reviews, build success plans and partner with Sales and Support on expansion.",
  "Track health scores, lead escalations and turn customer feedback into product requests for the roadmap team.",
].join("\n");

beforeAll(async () => {
  for (const city of ["Remote - United States", "New York, NY", "Chicago, IL"]) {
    const saved = await service.submit({ title: "Customer Success Manager", company: `Reviewco ${token}`, location: city, domain: "customer-success", rawText: body(city) });
    ids.push(saved.opportunity.id);
  }
});

afterAll(async () => {
  await database.deferredEvaluation.deleteMany({ where: { opportunityId: { in: ids } } });
  await database.sourceRecord.deleteMany({ where: { opportunityId: { in: ids } } });
  await database.opportunity.deleteMany({ where: { id: { in: ids } } });
  await database.company.deleteMany({ where: { name: { contains: token } } });
  await database.$disconnect();
});

// What each opportunity's page shows about the other: id -> state.
async function seenFrom(id: string) {
  return Object.fromEntries((await duplicates.relationships(id)).map((relationship) => [ids.indexOf(relationship.otherOpportunityId), relationship.resolution]));
}

describe("duplicate decisions read the same from both opportunities", () => {
  it("records the possible duplicates the captures found and shows each from both sides", async () => {
    const [a, b, c] = ids as [string, string, string];
    expect(await seenFrom(a)).toEqual({ 1: null, 2: null });
    expect(await seenFrom(b)).toEqual({ 0: null, 2: null });
    expect(await seenFrom(c)).toEqual({ 0: null, 1: null });
  });

  it("persists Not the same job from either page, and Undo restores the unresolved state", async () => {
    const [a, b, c] = ids as [string, string, string];
    // Decided on the earlier opportunity's page...
    await duplicates.resolve({ opportunityId: a, otherOpportunityId: b, resolution: "DISTINCT" });
    expect((await seenFrom(a))[1]).toBe("DISTINCT");
    expect((await seenFrom(b))[0]).toBe("DISTINCT");
    // ...the other pair of each is untouched.
    expect((await seenFrom(a))[2]).toBeNull();
    expect((await seenFrom(c))[0]).toBeNull();
    // Undone on the later one's page.
    await duplicates.resolve({ opportunityId: b, otherOpportunityId: a, resolution: null });
    expect(await seenFrom(a)).toEqual({ 1: null, 2: null });
    expect(await seenFrom(b)).toEqual({ 0: null, 2: null });
    // One stored row per pair, whichever page decided.
    expect(await database.duplicateReference.count({ where: { opportunityId: { in: ids }, relatedOpportunityId: { in: ids } } })).toBe(3);
  });

  it("records Same job without merging, and then refuses a second paid evaluation", async () => {
    const [a, b] = ids as [string, string, string];
    // b has an open budget deferral: evaluation work is on its way.
    await database.deferredEvaluation.create({ data: { opportunityId: b, domain: "customer-success", reasonCode: "BUDGET", reasonSnapshot: {}, lastCheckedAt: new Date() } });
    expect(await duplicates.blockingTwin(a)).toBeNull();
    await duplicates.resolve({ opportunityId: a, otherOpportunityId: b, resolution: "SAME_JOB" });
    expect((await seenFrom(b))[0]).toBe("SAME_JOB");
    expect(await duplicates.blockingTwin(a)).toMatchObject({ opportunityId: b });
    expect(await database.opportunity.count({ where: { id: { in: ids } } })).toBe(3);
    await duplicates.resolve({ opportunityId: b, otherOpportunityId: a, resolution: null });
    expect(await duplicates.blockingTwin(a)).toBeNull();
  });
});

describe("the Possible Duplicates review", () => {
  it("shows the three listings as one group with each pair once, and counts it until every pair is decided", async () => {
    const review = new PrismaDuplicateReviewRepository();
    const focused = await review.page({ filter: "open", page: 1, pageSize: 10, groupKey: ids[1]! });
    expect(focused.groups).toHaveLength(1);
    const [group] = focused.groups;
    expect([...group!.memberIds].sort()).toEqual([...ids].sort());
    expect(group!.members.map((member) => member.id)).toEqual(ids);
    expect(group!.edges).toHaveLength(3);
    expect(group!.unresolved).toBe(3);
    const before = (await review.page({ filter: "open", page: 1, pageSize: 10 })).counts;
    for (const [left, right] of [[0, 1], [1, 2], [0, 2]] as const) {
      await duplicates.resolve({ opportunityId: ids[left]!, otherOpportunityId: ids[right]!, resolution: "DISTINCT" });
    }
    const after = (await review.page({ filter: "open", page: 1, pageSize: 10 })).counts;
    expect(after.open).toBe(before.open - 1);
    expect(after.decided).toBe(before.decided + 1);
    const decided = await review.page({ filter: "decided", page: 1, pageSize: 10, groupKey: ids[0]! });
    expect(decided.groups[0]!.edges.every((edge) => edge.state === "DISTINCT")).toBe(true);
  });
});
