// Triage-to-lifecycle routing (November 25, 2026): REJECT and off-title jobs
// go to Dismissed through one guarded, reversible writer; EVALUATE and
// NEEDS_REVIEW stay Active; application history, the user's lifecycle and
// triage decisions and evaluation work in flight are never overridden. The
// historical cleanup plans, applies, verifies and restores with the same
// rules. Isolated test database only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTitlePolicy } from "@ai-career/core";
import { customerSuccessDefaultTitlePolicy } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  PrismaApplicationRepository,
  PrismaTriageRoutingRepository,
  readAutomaticDismissalRows,
} from "@ai-career/database";
import { applyHistoricalRouting, planHistoricalRouting, verifyManifest, type HistoricalRoutingManifest } from "../../apps/web/src/server/triage-routing-cleanup";
import { createTriageRouting } from "../../apps/web/src/server/triage-routing";

const database = getDatabaseClient();
const repository = new PrismaTriageRoutingRepository();
const policy = createTitlePolicy(customerSuccessDefaultTitlePolicy);
const token = `Route${randomUUID().slice(0, 8)}`;
const ids: Record<string, string> = {};

type Case = { title: string; outcome?: "EVALUATE" | "NEEDS_REVIEW" | "REJECT"; manual?: "EVALUATE" | "REJECT"; status?: "NORMALIZED" | "EVALUATED" | "SAVED" };
const cases: Record<string, Case> = {
  evaluate: { title: "Customer Success Manager", outcome: "EVALUATE" },
  review: { title: "Customer Success Manager", outcome: "NEEDS_REVIEW" },
  reject: { title: "Customer Success Manager", outcome: "REJECT" },
  offTitle: { title: "Payroll Support Representative", outcome: "EVALUATE" },
  both: { title: "Program Manager, M&A Recruiting", outcome: "REJECT" },
  noTriageOffTitle: { title: "Payroll Support Representative" },
  saved: { title: "Payroll Support Representative", outcome: "REJECT", status: "SAVED" },
  applied: { title: "Customer Success Manager", outcome: "REJECT" },
  manual: { title: "Customer Success Manager", outcome: "REJECT", manual: "EVALUATE" },
  deferred: { title: "Payroll Support Representative", outcome: "EVALUATE" },
};

beforeAll(async () => {
  const company = await database.company.create({ data: { name: `Routeco ${token}` } });
  for (const [key, item] of Object.entries(cases)) {
    const opportunity = await database.opportunity.create({
      data: { domain: "customer-success", status: item.status ?? "NORMALIZED", companyId: company.id, title: item.title, jobDescription: `${key} ${token}` },
    });
    ids[key] = opportunity.id;
    if (item.outcome) {
      await database.preEvaluatorTriage.create({
        data: {
          opportunityId: opportunity.id, domain: "customer-success", outcome: item.outcome, reasons: [], inputFingerprint: token, assessedAt: new Date(),
          ...(item.manual ? { manualDecision: item.manual, manuallyDecidedAt: new Date() } : {}),
        },
      });
    }
  }
  await database.opportunityUserAction.create({ data: { opportunityId: ids.saved!, action: "SAVE", fromStatus: "NORMALIZED", toStatus: "SAVED" } });
  await database.application.create({ data: { opportunityId: ids.applied!, stage: "PLANNED" } as never });
  await database.deferredEvaluation.create({
    data: { opportunityId: ids.deferred!, domain: "customer-success", reasonCode: "BUDGET", reasonSnapshot: {}, lastCheckedAt: new Date(), status: "DEFERRED" } as never,
  });
});

afterAll(async () => {
  const all = Object.values(ids);
  await database.deferredEvaluation.deleteMany({ where: { opportunityId: { in: all } } });
  await database.application.deleteMany({ where: { opportunityId: { in: all } } });
  await database.opportunity.deleteMany({ where: { id: { in: all } } });
  await database.company.deleteMany({ where: { name: { contains: token } } });
  await database.$disconnect();
});

const rows = async () => (await readAutomaticDismissalRows(database)).filter((row) => Object.values(ids).includes(row.id));
const status = async (key: string) => (await database.opportunity.findUniqueOrThrow({ where: { id: ids[key]! } })).status;

describe("historical cleanup", () => {
  let manifest: HistoricalRoutingManifest;

  it("plans exactly the REJECT and off-title jobs it may move, and says why others stay", async () => {
    const plan = planHistoricalRouting(await rows(), policy);
    const moving = Object.fromEntries(plan.candidates.map((candidate) => [Object.keys(ids).find((key) => ids[key] === candidate.id), candidate.reason]));
    expect(moving).toEqual({ reject: "TRIAGE_REJECT", offTitle: "OUTSIDE_TARGET_TITLES", both: "TRIAGE_REJECT", noTriageOffTitle: "OUTSIDE_TARGET_TITLES" });
    const skippedKeys = (skip: keyof typeof plan.skipped) => (plan.skipped[skip] ?? []).map((item) => Object.keys(ids).find((key) => ids[key] === item.id));
    expect(skippedKeys("NOT_A_SYSTEM_STATE")).toEqual(["saved"]);
    expect(skippedKeys("APPLICATION_HISTORY")).toEqual(["applied"]);
    expect(skippedKeys("EVALUATION_IN_PROGRESS")).toEqual(["deferred"]);
    // A manual "evaluate anyway" is no REJECT; it is not matched at all.
    expect(plan.candidates.concat(...Object.values(plan.skipped).flat()).map((item) => item.id)).not.toContain(ids.manual);
    expect(plan.matched).toEqual({ reject: 4, outsideTitles: 5, overlap: 2 });
    expect(plan.projected).toEqual({ active: plan.activeNow - 4, dismissed: plan.dismissedNow + 4, total: plan.total });
  });

  it("moves them reversibly, keeps every record, and verifies each one", async () => {
    const before = { triage: await database.preEvaluatorTriage.count({ where: { opportunityId: { in: Object.values(ids) } } }), opportunities: (await rows()).length };
    const plan = planHistoricalRouting(await rows(), policy);
    const result = await applyHistoricalRouting(plan, (input) => repository.dismissAutomatically(input));
    expect(result.skipped).toEqual([]);
    manifest = { kind: "historical-triage-routing", version: 1, database: "ai_career_assistant_test", appliedAt: new Date().toISOString(), moved: result.moved };
    expect(verifyManifest(manifest, await rows())).toEqual({ checked: 4, verified: 4, problems: [] });
    for (const key of ["reject", "offTitle", "both", "noTriageOffTitle"]) expect(await status(key)).toBe("REJECTED_BY_USER");
    for (const key of ["evaluate", "review", "manual", "deferred", "applied"]) expect(await status(key)).toBe("NORMALIZED");
    expect(await status("saved")).toBe("SAVED");
    expect(await repository.automaticDismissal(ids.reject!)).toMatchObject({ reason: "TRIAGE_REJECT" });
    expect({ triage: await database.preEvaluatorTriage.count({ where: { opportunityId: { in: Object.values(ids) } } }), opportunities: (await rows()).length }).toEqual(before);
    // Re-running finds nothing more to move.
    const again = planHistoricalRouting(await rows(), policy);
    expect(again.candidates).toEqual([]);
    expect(again.alreadyRouted).toBe(4);
  });

  it("restores exactly the moved jobs, which are never moved again", async () => {
    const lifecycle = new PrismaApplicationRepository();
    for (const entry of manifest.moved) {
      expect(await lifecycle.applyLifecycleActionGuarded({ opportunityId: entry.id, action: "RESTORE" })).toMatchObject({ status: "APPLIED", to: "NORMALIZED" });
    }
    expect(verifyManifest(manifest, await rows()).problems.map((problem) => problem.problem)).toEqual(Array(4).fill("status is NORMALIZED, not Dismissed"));
    const plan = planHistoricalRouting(await rows(), policy);
    expect(plan.candidates).toEqual([]);
    expect(plan.skipped.USER_LIFECYCLE_DECISION?.length).toBe(4);
    expect(await repository.dismissAutomatically({ opportunityId: ids.reject!, reason: "TRIAGE_REJECT" })).toEqual({ status: "SKIPPED", skip: "USER_LIFECYCLE_DECISION" });
  });
});

describe("future routing after automatic triage", () => {
  it("keeps EVALUATE and NEEDS_REVIEW Active and dismisses REJECT and off-title jobs", async () => {
    const company = await database.company.findFirstOrThrow({ where: { name: { contains: token } } });
    const fresh = async (title: string, outcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT") => {
      const opportunity = await database.opportunity.create({ data: { domain: "customer-success", status: "NORMALIZED", companyId: company.id, title } });
      ids[`fresh-${title}-${outcome}`] = opportunity.id;
      await database.preEvaluatorTriage.create({ data: { opportunityId: opportunity.id, domain: "customer-success", outcome, reasons: [], inputFingerprint: token, assessedAt: new Date() } });
      return opportunity.id;
    };
    const route = createTriageRouting({
      triageOutcome: async (id) => (await database.preEvaluatorTriage.findUnique({ where: { opportunityId: id } }))?.outcome ?? null,
      title: async (id) => (await database.opportunity.findUnique({ where: { id } }))?.title ?? null,
      titlePolicy: async () => policy,
      dismiss: (input) => repository.dismissAutomatically(input),
    });
    expect(await route(await fresh("Customer Success Manager", "EVALUATE"))).toEqual({ status: "ACTIVE", triageOutcome: "EVALUATE" });
    expect(await route(await fresh("Senior Customer Success Manager", "NEEDS_REVIEW"))).toEqual({ status: "ACTIVE", triageOutcome: "NEEDS_REVIEW" });
    expect(await route(await fresh("Customer Success Manager", "REJECT"))).toMatchObject({ status: "DISMISSED", reason: "TRIAGE_REJECT", from: "NORMALIZED" });
    expect(await route(await fresh("Employee Onboarding Specialist", "EVALUATE"))).toMatchObject({ status: "DISMISSED", reason: "OUTSIDE_TARGET_TITLES" });
    // A routing problem leaves the job Active.
    const failing = createTriageRouting({ triageOutcome: async () => { throw new Error("down"); }, title: async () => null, titlePolicy: async () => policy, dismiss: async () => { throw new Error("never"); } });
    expect(await failing(ids.evaluate!)).toEqual({ status: "FAILED" });
  });
});
