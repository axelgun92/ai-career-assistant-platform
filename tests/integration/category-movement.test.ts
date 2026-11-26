// Working categories follow the lifecycle (November 25, 2026), on the
// isolated test database: moving a job removes it from its source category
// and adds it to the destination, with the counts, and it stays so when read
// again; its historical triage result never keeps it in a triage working
// category, but stays on the job; a move to where it already is is skipped.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabaseClient, PrismaOpportunityDashboardRepository, PrismaPreEvaluatorTriageRepository } from "@ai-career/database";
import { getOpportunityActionWriter } from "../../apps/web/src/server/opportunity-action-service";
import { createOpportunityMoveService } from "../../apps/web/src/server/opportunity-move-service";
import { getOpportunityListReader } from "../../apps/web/src/server/opportunity-list-service";
import { parseOpportunityQuery, toListFilters } from "../../apps/web/src/server/opportunity-query";

const database = getDatabaseClient();
const moves = createOpportunityMoveService(getOpportunityActionWriter());
const dashboard = new PrismaOpportunityDashboardRepository();
const token = `Cat${randomUUID().slice(0, 8)}`;
let rejectId = "";
let reviewId = "";

beforeAll(async () => {
  const company = await database.company.create({ data: { name: `Catco ${token}` } });
  const make = async (outcome: "REJECT" | "NEEDS_REVIEW") => {
    const opportunity = await database.opportunity.create({
      data: { domain: "customer-success", status: "NORMALIZED", companyId: company.id, title: `Customer Success Manager ${token} ${outcome}` },
    });
    await database.preEvaluatorTriage.create({
      data: { opportunityId: opportunity.id, domain: "customer-success", outcome, reasons: [{ code: "x", fields: ["salaryMin"], disposition: outcome, message: "seeded" }], inputFingerprint: token, assessedAt: new Date() },
    });
    return opportunity.id;
  };
  rejectId = await make("REJECT");
  reviewId = await make("NEEDS_REVIEW");
});

afterAll(async () => {
  await database.opportunity.deleteMany({ where: { id: { in: [rejectId, reviewId] } } });
  await database.company.deleteMany({ where: { name: { contains: token } } });
  await database.$disconnect();
});

// The job's place in every list the dashboard can show for it.
async function listed(search: string) {
  const lists: Record<string, boolean> = {};
  for (const view of ["active", "triage", "saved", "applied", "dismissed", "archived", "all"]) {
    for (const triage of ["", "reject"]) {
      const query = parseOpportunityQuery(new URLSearchParams(`view=${view}&q=${token}${triage ? `&triage=${triage}` : ""}`));
      const page = await getOpportunityListReader().listPage({ filters: toListFilters(query), sort: query.sort, page: 1, pageSize: 25 });
      lists[`${view}${triage ? "+reject" : ""}`] = page.items.some((item) => item.id === search);
    }
  }
  return Object.entries(lists).filter(([, present]) => present).map(([name]) => name).sort();
}

const counts = async () => {
  const summary = await dashboard.summarize();
  return { active: summary.active, saved: summary.saved, dismissed: summary.dismissed, archived: summary.archived, rejectActive: summary.triage.REJECT.active, rejectDismissed: summary.triage.REJECT.dismissed };
};
const delta = (after: Record<string, number>, before: Record<string, number>) =>
  Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - before[key]!]).filter(([, value]) => value !== 0));

describe("moving a rejected job between categories", () => {
  it("leaves its source category and joins its destination, with the counts, at every step", async () => {
    expect(await listed(rejectId)).toEqual(["active", "active+reject", "all", "all+reject", "triage", "triage+reject"]);
    const steps: Array<[Parameters<typeof moves.move>[1], string[], Record<string, number>]> = [
      ["SAVED", ["active", "active+reject", "all", "all+reject", "saved", "saved+reject"], { saved: 1 }],
      ["ARCHIVED", ["all", "all+reject", "archived", "archived+reject"], { active: -1, saved: -1, archived: 1, rejectActive: -1 }],
      ["DISMISSED", ["all", "all+reject", "dismissed", "dismissed+reject"], { archived: -1, dismissed: 1, rejectDismissed: 1 }],
      ["RESTORE", ["all", "all+reject", "archived", "archived+reject"], { archived: 1, dismissed: -1, rejectDismissed: -1 }],
      ["ACTIVE", ["active", "active+reject", "all", "all+reject", "triage", "triage+reject"], { active: 1, archived: -1, rejectActive: 1 }],
      ["DISMISSED", ["all", "all+reject", "dismissed", "dismissed+reject"], { active: -1, dismissed: 1, rejectActive: -1, rejectDismissed: 1 }],
    ];
    for (const [destination, lists, change] of steps) {
      const before = await counts();
      expect(await moves.move(rejectId, destination), destination).toMatchObject({ result: "MOVED" });
      // Read again from the database: the move persisted.
      expect(await listed(rejectId), destination).toEqual(lists);
      expect(delta(await counts(), before), destination).toEqual(change);
    }
  });

  it("skips a move to Dismissed for a job already there, changing nothing", async () => {
    const before = await counts();
    expect(await moves.move(rejectId, "DISMISSED")).toMatchObject({ result: "ALREADY_THERE", reason: "Already in Dismissed" });
    expect(await counts()).toEqual(before);
  });

  it("keeps the historical triage result on the job after it moved", async () => {
    const triage = await new PrismaPreEvaluatorTriageRepository().get(rejectId);
    expect(triage).toMatchObject({ outcome: "REJECT", reasons: [{ message: "seeded" }] });
    const history = await database.opportunityUserAction.findMany({ where: { opportunityId: rejectId }, orderBy: { createdAt: "asc" } });
    expect(history.map((row) => row.action)).toEqual(["SAVE", "ARCHIVE", "DISMISS", "RESTORE", "REACTIVATE", "DISMISS"]);
  });

  it("drops a dismissed job from the Needs Review queue, and brings it back when it returns to Active", async () => {
    const queue = async () => (await new PrismaPreEvaluatorTriageRepository().listNeedsReview()).map((row) => row.opportunityId);
    expect(await queue()).toContain(reviewId);
    await moves.move(reviewId, "DISMISSED");
    expect(await queue()).not.toContain(reviewId);
    await moves.move(reviewId, "RESTORE");
    expect(await queue()).toContain(reviewId);
  });
});
