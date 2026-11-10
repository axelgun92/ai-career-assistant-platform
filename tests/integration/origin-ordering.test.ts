import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSourceInsights } from "@ai-career/core";
import { originatingVersion, PrismaManualOpportunityRepository, PrismaSourceIntelligenceRepository } from "@ai-career/database";
import { captureOpportunity, createCleanup, database, recordAttempt } from "../support/budget-integration";

// The origin contract (Feature 15 attribution, current-version projection):
// an opportunity's first source record is the earliest by (createdAt, id).
// Two records with the same createdAt must resolve the same way everywhere,
// whatever order the database returns them in. Isolated test database only.

const cleanup = createCleanup();
const lowestId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => cleanup.before());
afterEach(() => cleanup.after());
afterAll(() => database.$disconnect());

// A manual opportunity whose captured record and a later-inserted record share
// one createdAt; the later one has the lowest possible id, so insertion order
// and (createdAt, id) order disagree.
async function tiedOpportunity() {
  const opportunityId = await captureOpportunity(cleanup);
  const first = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId } });
  const at = new Date("2026-10-30T12:00:00.000Z");
  await database.sourceRecord.update({ where: { id: first.id }, data: { createdAt: at } });
  await database.sourceRecord.create({
    data: { id: lowestId, opportunityId, source: "tie-breaker-source", sourceType: "OTHER", createdAt: at, discoveredAt: at },
  });
  return { opportunityId, insertedFirst: first.id };
}

describe("first source record ordering is (createdAt, id)", () => {
  it("resolves the origin, the opportunity page's first record and Feature 15 credit to the lower id", async () => {
    const { opportunityId, insertedFirst } = await tiedOpportunity();
    expect(insertedFirst > lowestId).toBe(true);
    expect((await originatingVersion(database, opportunityId))?.origin.id).toBe(lowestId);
    const detail = await new PrismaManualOpportunityRepository().findOpportunityDetail(opportunityId);
    expect(detail?.sourceRecords.map((record) => record.id)).toEqual([lowestId, insertedFirst]);
    const facts = await new PrismaSourceIntelligenceRepository().facts({ currency: "USD" });
    const scoped = { ...facts, listings: facts.listings.filter((listing) => listing.opportunityId === opportunityId), opportunities: facts.opportunities.filter((item) => item.id === opportunityId), ledger: [], runs: [], pendingDetails: [], sources: [] };
    const insights = buildSourceInsights({ facts: scoped, window: { key: "all", from: null, to: new Date() }, now: new Date(), currency: "USD" });
    const credited = [...insights.automated, ...insights.userCollected].filter((row) => row.discovery.new > 0).map((row) => row.key);
    expect(credited).toEqual(["adapter:tie-breaker-source"]);
  });

  it("attributes an unbound evaluation's attempts to the lower-id first record", async () => {
    const { opportunityId } = await tiedOpportunity();
    const evaluation = await database.evaluation.create({
      data: { opportunityId, domain: "customer-success", status: "RUNNING", evaluationVersion: "test", domainVersion: "test", ruleVersion: "test" },
    });
    expect(evaluation.sourceRecordId).toBeNull();
    await recordAttempt(evaluation.id, 1, 0.01);
    const attempt = await database.semanticOperationAttempt.findFirstOrThrow({ where: { evaluationId: evaluation.id } });
    expect(attempt.sourceRecordId).toBe(lowestId);
    expect(attempt.jobSource).toBe("tie-breaker-source");
  });
});
