// Lifecycle versus triage queues (November 25, 2026; review), on the isolated
// test database with the real triage of the evaluation service:
// - a reassessed Active listing moves between the Evaluate, Needs Review and
//   Rejected queues and stays Active (reassessment never routes);
// - reassessment never overrides an explicit lifecycle decision: a Saved or
//   Dismissed listing keeps its state (an Archived one is not assessed again
//   until restored, as for evaluation), and a Dismissed one never reappears
//   in an Active queue or the Needs Review list;
// - a confirmed fact changes the triage queue and counts at once and never
//   changes the lifecycle state (no dismiss, archive or evaluation);
// - a listing with application history keeps its state and application.
// Initial automatic routing is covered by triage-routing.test.ts ("future
// routing after automatic triage") and tests/unit/triage-routing.test.ts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfirmedFactRepository,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaOpportunityDashboardRepository,
  PrismaPreEvaluatorTriageRepository,
} from "@ai-career/database";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createConfirmedFactHandlers } from "../../apps/web/src/server/confirmed-fact-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { getOpportunityActionWriter } from "../../apps/web/src/server/opportunity-action-service";
import { createOpportunityMoveService } from "../../apps/web/src/server/opportunity-move-service";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { reassessStaleTriage } from "../../apps/web/src/server/triage-reassessment";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";

const triageRepository = new PrismaPreEvaluatorTriageRepository();
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ pricingCurrencies: () => ["USD"] }).gate,
  triageGate: createPreEvaluatorTriageService({ repository: triageRepository }).gate,
});
const store = new PrismaConfirmedFactRepository();
const facts = createConfirmedFactHandlers({
  store,
  captured: (opportunityId) => store.capturedFacts(opportunityId),
  reassess: async (opportunityId) => {
    const result = await evaluation.assessTriage(opportunityId, { trigger: "USER_CORRECTION" });
    return result.status === "ASSESSED" ? { outcome: result.triage.outcome } : null;
  },
});
const moves = createOpportunityMoveService(getOpportunityActionWriter());
const dashboard = new PrismaOpportunityDashboardRepository();
const cleanup = createCleanup();
const token = `Life${randomUUID().slice(0, 8)}`;
let activeBefore: { userProfileId: string } | null = null;

beforeAll(async () => {
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup, `Lifecycle ${token}`);
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: profile.id }, update: { userProfileId: profile.id } });
});

afterAll(async () => {
  if (activeBefore) await database.activeUserProfile.update({ where: { domain: "customer-success" }, data: { userProfileId: activeBefore.userProfileId } });
  else await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  await cleanup.after();
  await database.$disconnect();
});

// Needs Review on assessment: no salary or currency stated.
async function job() {
  const company = await database.company.create({ data: { name: `Lifeco ${token} ${randomUUID().slice(0, 4)}` } });
  const opportunity = await database.opportunity.create({
    data: {
      domain: "customer-success", status: "NORMALIZED", companyId: company.id, title: "Customer Success Manager",
      location: "Remote - United States", remoteStatus: "REMOTE", workArrangements: ["REMOTE"], employmentType: "FULL_TIME",
      residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], compensationBasis: "BASE",
      jobDescription: "Own onboarding and renewals for mid-market customers.",
    },
  });
  cleanup.opportunityIds.push(opportunity.id);
  return opportunity.id;
}
const recapture = (id: string, salaryMin: number, salaryMax: number) =>
  database.opportunity.update({ where: { id }, data: { salaryMin, salaryMax, currency: "USD" } });
const reassess = async (id: string) => evaluation.assessTriage(id, { onlyIfStale: true, trigger: "CAPTURE_CHANGED" });
const outcome = async (id: string) => (await triageRepository.get(id))?.outcome;
const status = async (id: string) => (await database.opportunity.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const queues = async () => (await dashboard.summarize()).triage;
const inReviewList = async (id: string) => (await triageRepository.listNeedsReview()).some((item: { opportunityId?: string; id?: string }) => (item.opportunityId ?? item.id) === id);
const nothingEvaluated = async (id: string) => {
  expect(await database.evaluation.count({ where: { opportunityId: id } })).toBe(0);
  expect(await database.evaluationAdmission.count({ where: { opportunityId: id } })).toBe(0);
};

describe("an Active listing reassessed", () => {
  it("moves between the Evaluate, Needs Review and Rejected queues and stays Active", async () => {
    const id = await job();
    await evaluation.assessTriage(id);
    expect([await outcome(id), await status(id)]).toEqual(["NEEDS_REVIEW", "NORMALIZED"]);
    expect(await inReviewList(id)).toBe(true);

    let before = await queues();
    await recapture(id, 72_000, 88_000);
    await reassess(id);
    let after = await queues();
    expect([await outcome(id), await status(id)]).toEqual(["EVALUATE", "NORMALIZED"]);
    expect([after.NEEDS_REVIEW.active - before.NEEDS_REVIEW.active, after.EVALUATE.active - before.EVALUATE.active]).toEqual([-1, 1]);

    before = after;
    await recapture(id, 40_000, 45_000);
    await reassess(id);
    after = await queues();
    // Rejected by triage, still Active: never dismissed by a reassessment.
    expect([await outcome(id), await status(id)]).toEqual(["REJECT", "NORMALIZED"]);
    expect([after.EVALUATE.active - before.EVALUATE.active, after.REJECT.active - before.REJECT.active, after.REJECT.dismissed - before.REJECT.dismissed]).toEqual([-1, 1, 0]);
    await nothingEvaluated(id);
  });
});

describe("explicit lifecycle decisions", () => {
  it("are never overridden by reassessment, and a Dismissed listing never reappears in an Active queue", async () => {
    const saved = await job();
    const dismissed = await job();
    const archived = await job();
    for (const id of [saved, dismissed, archived]) await evaluation.assessTriage(id);
    expect(await moves.move(saved, "SAVED")).toMatchObject({ result: "MOVED" });
    expect(await moves.move(dismissed, "DISMISSED")).toMatchObject({ result: "MOVED" });
    expect(await moves.move(archived, "ARCHIVED")).toMatchObject({ result: "MOVED" });
    const before = await queues();

    // New captures change every outcome; the per-job path and the batch.
    await recapture(saved, 40_000, 45_000);
    await recapture(dismissed, 72_000, 88_000);
    await recapture(archived, 40_000, 45_000);
    for (const id of [saved, dismissed]) await reassess(id);
    // An Archived (or Closed) listing is not assessed again until restored,
    // as for evaluation; every reassessment path catches this refusal.
    await expect(reassess(archived)).rejects.toMatchObject({ code: "OPPORTUNITY_NOT_EVALUABLE" });
    await reassessStaleTriage({ assess: (opportunityId) => evaluation.assessTriage(opportunityId, { onlyIfStale: true }) });

    expect([await outcome(saved), await status(saved)]).toEqual(["REJECT", "SAVED"]);
    expect([await outcome(dismissed), await status(dismissed)]).toEqual(["EVALUATE", "REJECTED_BY_USER"]);
    expect([await outcome(archived), await status(archived)]).toEqual(["NEEDS_REVIEW", "ARCHIVED"]);
    const after = await queues();
    // Saved is part of Active: it moved from Needs Review to Rejected there.
    expect(after.REJECT.active - before.REJECT.active).toBe(1);
    // The Dismissed job's new EVALUATE result is counted under Dismissed,
    // never in the Active queue; it is not in the Needs Review list.
    expect(after.EVALUATE.active - before.EVALUATE.active).toBe(0);
    expect(after.EVALUATE.dismissed - before.EVALUATE.dismissed).toBe(1);
    expect(after.NEEDS_REVIEW.active - before.NEEDS_REVIEW.active).toBe(-1);
    expect(await inReviewList(dismissed)).toBe(false);
    // Each user action is still the latest lifecycle action.
    for (const [id, action] of [[saved, "SAVE"], [dismissed, "DISMISS"], [archived, "ARCHIVE"]] as const) {
      const latest = await database.opportunityUserAction.findFirst({ where: { opportunityId: id }, orderBy: { createdAt: "desc" }, select: { action: true } });
      expect(latest?.action, id).toBe(action);
    }
    for (const id of [saved, dismissed, archived]) await nothingEvaluated(id);
    // A fact confirmed on the Archived listing is saved; triage is not run
    // (it stays stale until the listing is restored), and it stays Archived.
    const response = await facts.save(new Request("http://test", { method: "POST", body: JSON.stringify({ fieldName: "currency", value: "USD" }) }), archived);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { triage: unknown }).triage).toBeNull();
    expect([await outcome(archived), await status(archived)]).toEqual(["NEEDS_REVIEW", "ARCHIVED"]);
  });
});

describe("a confirmed fact", () => {
  it("changes the triage queue and counts at once and never changes the lifecycle state", async () => {
    const active = await job();
    const saved = await job();
    const dismissed = await job();
    for (const id of [active, saved, dismissed]) await evaluation.assessTriage(id);
    await moves.move(saved, "SAVED");
    await moves.move(dismissed, "DISMISSED");
    const confirm = (id: string) =>
      Promise.all([
        facts.save(new Request("http://test", { method: "POST", body: JSON.stringify({ fieldName: "salaryRange", value: { minimum: 72_000, maximum: 88_000 } }) }), id),
      ]).then(() => facts.save(new Request("http://test", { method: "POST", body: JSON.stringify({ fieldName: "currency", value: "USD" }) }), id));

    let before = await queues();
    await confirm(active);
    let after = await queues();
    expect([await outcome(active), await status(active)]).toEqual(["EVALUATE", "NORMALIZED"]);
    expect([after.NEEDS_REVIEW.active - before.NEEDS_REVIEW.active, after.EVALUATE.active - before.EVALUATE.active]).toEqual([-1, 1]);

    before = after;
    await confirm(saved);
    after = await queues();
    expect([await outcome(saved), await status(saved)]).toEqual(["EVALUATE", "SAVED"]);
    expect(after.EVALUATE.active - before.EVALUATE.active).toBe(1);

    before = after;
    await confirm(dismissed);
    after = await queues();
    expect([await outcome(dismissed), await status(dismissed)]).toEqual(["EVALUATE", "REJECTED_BY_USER"]);
    expect([after.EVALUATE.active - before.EVALUATE.active, after.EVALUATE.dismissed - before.EVALUATE.dismissed]).toEqual([0, 1]);
    for (const id of [active, saved, dismissed]) await nothingEvaluated(id);
  });
});

describe("application history", () => {
  it("keeps the listing's state and its application through reassessment and a confirmed fact, and still blocks Dismiss", async () => {
    const id = await job();
    await evaluation.assessTriage(id);
    await database.opportunity.update({ where: { id }, data: { status: "APPLIED" } });
    const application = await database.application.create({ data: { opportunityId: id, stage: "APPLIED", appliedOn: new Date("2026-11-20") } });
    await recapture(id, 40_000, 45_000);
    await reassess(id);
    expect([await outcome(id), await status(id)]).toEqual(["REJECT", "APPLIED"]);
    await facts.save(new Request("http://test", { method: "POST", body: JSON.stringify({ fieldName: "salaryRange", value: { minimum: 72_000, maximum: 88_000 } }) }), id);
    expect([await outcome(id), await status(id)]).toEqual(["EVALUATE", "APPLIED"]);
    expect(await database.application.findUnique({ where: { id: application.id }, select: { stage: true } })).toEqual({ stage: "APPLIED" });
    expect((await moves.move(id, "DISMISSED")).result).not.toBe("MOVED");
    expect(await status(id)).toBe("APPLIED");
  });
});
