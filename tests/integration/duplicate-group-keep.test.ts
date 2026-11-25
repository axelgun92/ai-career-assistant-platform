// Possible Duplicates (November 25, 2026 correction), on the isolated test
// database: in a group of five similar listings, any combination can be kept
// and the rest dismissed, one listing at a time through the guarded Move to.
// Keeping or dismissing never changes another listing or any duplicate
// decision, and every listing stays in its group.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import { getDatabaseClient, PrismaDuplicateReviewRepository, PrismaManualOpportunityRepository } from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { getOpportunityActionWriter } from "../../apps/web/src/server/opportunity-action-service";
import { createOpportunityMoveService } from "../../apps/web/src/server/opportunity-move-service";

const database = getDatabaseClient();
const capture = createManualOpportunityService({ repository: new PrismaManualOpportunityRepository(), normalizer: createManualOpportunityNormalizer() });
const moves = createOpportunityMoveService(getOpportunityActionWriter());
const review = new PrismaDuplicateReviewRepository();
const token = `Keep${randomUUID().slice(0, 8)}`;
const ids: string[] = [];

const body = (city: string) => [
  `Customer Success Manager at Keepco ${token}. Location: ${city}.`,
  "Own onboarding, adoption and renewals for a portfolio of mid-market SaaS customers across North America.",
  "Run quarterly business reviews, build success plans and partner with Sales and Support on expansion.",
  "Track health scores, lead escalations and turn customer feedback into product requests for the roadmap team.",
].join("\n");

beforeAll(async () => {
  for (const city of ["Denver, CO", "Austin, TX", "Boston, MA", "Chicago, IL", "Seattle, WA"]) {
    const saved = await capture.submit({ title: "Customer Success Manager", company: `Keepco ${token}`, location: city, domain: "customer-success", rawText: body(city) });
    ids.push(saved.opportunity.id);
  }
}, 60_000);

afterAll(async () => {
  await database.application.deleteMany({ where: { opportunityId: { in: ids } } });
  await database.sourceRecord.deleteMany({ where: { opportunityId: { in: ids } } });
  await database.opportunity.deleteMany({ where: { id: { in: ids } } });
  await database.company.deleteMany({ where: { name: { contains: token } } });
  await database.$disconnect();
});

const statuses = async () => {
  const rows = await database.opportunity.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  return ids.map((id) => rows.find((row) => row.id === id)!.status);
};
const decisions = async () =>
  (await database.duplicateReference.findMany({
    where: { opportunityId: { in: ids } },
    select: { opportunityId: true, relatedOpportunityId: true, resolution: true },
    orderBy: [{ opportunityId: "asc" }, { relatedOpportunityId: "asc" }],
  }));

describe("keeping any combination of listings in a group", () => {
  it("puts all five listings in one group", async () => {
    const page = await review.page({ filter: "all", page: 1, pageSize: 10, groupKey: ids[0]! });
    expect(page.groups).toHaveLength(1);
    expect([...page.groups[0]!.memberIds].sort()).toEqual([...ids].sort());
  });

  it("reaches every one of the 32 keep/dismiss combinations, one listing at a time", async () => {
    const before = await decisions();
    expect(before.length).toBeGreaterThan(0);
    for (let mask = 0; mask < 32; mask += 1) {
      const keep = ids.map((_, index) => Boolean(mask & (1 << index)));
      const current = await statuses();
      for (const [index, id] of ids.entries()) {
        const dismissed = current[index] === "REJECTED_BY_USER";
        if (keep[index] && dismissed) expect(await moves.move(id, "RESTORE")).toMatchObject({ result: "MOVED", status: "NORMALIZED" });
        if (!keep[index] && !dismissed) expect(await moves.move(id, "DISMISSED")).toMatchObject({ result: "MOVED", status: "REJECTED_BY_USER" });
      }
      expect(await statuses()).toEqual(keep.map((kept) => (kept ? "NORMALIZED" : "REJECTED_BY_USER")));
      // No keep or dismiss ever records a duplicate decision.
      expect(await decisions()).toEqual(before);
    }
  }, 120_000);

  it("keeps dismissed listings in their group, and changing one listing leaves the others as they are", async () => {
    // From the last combination (all kept), dismiss listings 2 and 4 only.
    await moves.move(ids[1]!, "DISMISSED");
    await moves.move(ids[3]!, "DISMISSED");
    expect(await statuses()).toEqual(["NORMALIZED", "REJECTED_BY_USER", "NORMALIZED", "REJECTED_BY_USER", "NORMALIZED"]);
    const page = await review.page({ filter: "all", page: 1, pageSize: 10, groupKey: ids[0]! });
    expect(page.groups[0]!.members.map((member) => [member.id, member.status])).toEqual(
      ids.map((id, index) => [id, index === 1 || index === 3 ? "REJECTED_BY_USER" : "NORMALIZED"]),
    );
    // Keep listing 4 again: listing 2 stays dismissed.
    await moves.move(ids[3]!, "RESTORE");
    expect(await statuses()).toEqual(["NORMALIZED", "REJECTED_BY_USER", "NORMALIZED", "NORMALIZED", "NORMALIZED"]);
  });

  it("refuses to dismiss a listing with application history and leaves the rest alone", async () => {
    await database.application.create({ data: { opportunityId: ids[4]!, stage: "APPLIED", appliedOn: new Date("2026-11-20") } as never });
    await database.opportunity.update({ where: { id: ids[4]! }, data: { status: "APPLIED" } });
    expect(await moves.move(ids[4]!, "DISMISSED")).toMatchObject({ result: expect.stringMatching(/BLOCKED_BY_APPLICATION|NOT_ALLOWED/) });
    expect(await statuses()).toEqual(["NORMALIZED", "REJECTED_BY_USER", "NORMALIZED", "NORMALIZED", "APPLIED"]);
  });
});
