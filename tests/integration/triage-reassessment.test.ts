// Stale triage reassessment and confirmed missing information (November 25,
// 2026), on the isolated test database with the real triage of the
// evaluation service: an unchanged job is left alone; new compensation
// tiers, a new profile version and a user's confirmed fact each assess it
// again, keeping every assessment in the history; a confirmed fact moves the
// job to the right working category at once, survives a later capture that
// disagrees (shown as a conflict) and can be edited or undone.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { reassessStaleTriage } from "../../apps/web/src/server/triage-reassessment";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";

const triageRepository = new PrismaPreEvaluatorTriageRepository();
const triageService = createPreEvaluatorTriageService({ repository: triageRepository });
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ pricingCurrencies: () => ["USD"] }).gate,
  triageGate: triageService.gate,
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
const dashboard = new PrismaOpportunityDashboardRepository();
const cleanup = createCleanup();
const token = `Re${randomUUID().slice(0, 8)}`;
let activeBefore: { userProfileId: string } | null = null;

beforeAll(async () => {
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup, `Reassessment ${token}`);
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: profile.id }, update: { userProfileId: profile.id } });
});

afterEach(() => undefined);

afterAll(async () => {
  if (activeBefore) {
    await database.activeUserProfile.update({ where: { domain: "customer-success" }, data: { userProfileId: activeBefore.userProfileId } });
  } else {
    await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  }
  await cleanup.after();
  await database.$disconnect();
});

async function job(overrides: Record<string, unknown> = {}) {
  const company = await database.company.create({ data: { name: `Reco ${token} ${randomUUID().slice(0, 4)}` } });
  const opportunity = await database.opportunity.create({
    data: {
      domain: "customer-success", status: "NORMALIZED", companyId: company.id, title: "Customer Success Manager",
      location: "Remote - United States", remoteStatus: "REMOTE", workArrangements: ["REMOTE"], employmentType: "FULL_TIME",
      residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], compensationBasis: "BASE",
      jobDescription: "Own onboarding and renewals for mid-market customers.",
      ...overrides,
    },
  });
  cleanup.opportunityIds.push(opportunity.id);
  return opportunity.id;
}
const history = async (id: string) => (await triageRepository.history(id)).map((entry) => `${entry.outcome}:${entry.trigger}`);
const post = (id: string, body: unknown) => facts.save(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), id);

describe("stale triage reassessment", () => {
  it("leaves an unchanged job alone and assesses it again when a material input changes", async () => {
    const id = await job();
    expect(await evaluation.assessTriage(id)).toMatchObject({ status: "ASSESSED", triage: { outcome: "NEEDS_REVIEW" } });
    expect(await history(id)).toEqual(["NEEDS_REVIEW:INITIAL"]);
    // Nothing changed: kept, no new history entry.
    expect(await evaluation.assessTriage(id, { onlyIfStale: true })).toMatchObject({ unchanged: true });
    expect(await history(id)).toEqual(["NEEDS_REVIEW:INITIAL"]);
    // A recapture adds compensation tiers: the salary is no longer Unknown.
    await database.opportunity.update({
      where: { id },
      data: { currency: "USD", compensationTiers: [{ label: "Zone A", minimum: 90_000, maximum: 110_000, currency: "USD" }, { label: "Zone B", minimum: 80_000, maximum: 95_000, currency: "USD" }] },
    });
    expect(await evaluation.assessTriage(id, { onlyIfStale: true, trigger: "CAPTURE_CHANGED" })).toMatchObject({ triage: { outcome: "EVALUATE" } });
    expect(await history(id)).toEqual(["NEEDS_REVIEW:INITIAL", "EVALUATE:CAPTURE_CHANGED"]);
  });

  it("assesses again after the active profile changes, through the batch", async () => {
    const id = await job({ salaryMin: 70_000, salaryMax: 85_000, currency: "USD" });
    await evaluation.assessTriage(id);
    const next = await createProfile(cleanup, `Reassessment ${token} v2`);
    await database.activeUserProfile.update({ where: { domain: "customer-success" }, data: { userProfileId: next.id } });
    const summary = await reassessStaleTriage({ assess: (opportunityId) => evaluation.assessTriage(opportunityId, { onlyIfStale: true }) });
    expect(summary.failed).toBe(0);
    expect(summary.reassessed).toBeGreaterThanOrEqual(1);
    expect(await history(id)).toEqual(["EVALUATE:INITIAL", "EVALUATE:PROFILE_CHANGED"]);
    expect((await triageRepository.get(id))?.userProfileId).toBe(next.id);
  });
});

describe("Add missing information", () => {
  it("re-runs triage at once and moves the job to the right working category", async () => {
    const id = await job();
    await evaluation.assessTriage(id);
    const before = (await dashboard.summarize()).triage;
    const response = await post(id, { fieldName: "salaryRange", value: { minimum: 70_000, maximum: 85_000 }, quotation: "Base salary: $70,000 - $85,000", note: "From the benefits section" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { triage: { outcome: string }; facts: Array<Record<string, unknown>> };
    expect(body.triage).toEqual({ outcome: "NEEDS_REVIEW" });
    // The currency is still Unknown: confirm it too.
    const second = (await (await post(id, { fieldName: "currency", value: "USD" })).json()) as { triage: { outcome: string } };
    expect(second.triage).toEqual({ outcome: "EVALUATE" });
    const after = (await dashboard.summarize()).triage;
    expect(after.NEEDS_REVIEW.active - before.NEEDS_REVIEW.active).toBe(-1);
    expect(after.EVALUATE.active - before.EVALUATE.active).toBe(1);
    // Persisted: read again from the database.
    expect((await triageRepository.get(id))?.outcome).toBe("EVALUATE");
    // Each change of inputs is a history entry, even when the outcome holds.
    expect(await history(id)).toEqual(["NEEDS_REVIEW:INITIAL", "NEEDS_REVIEW:USER_CORRECTION", "EVALUATE:USER_CORRECTION"]);
    const stored = await store.list(id);
    expect(stored.find((fact) => fact.fieldName === "salaryRange")).toMatchObject({
      value: { minimum: 70_000, maximum: 85_000 }, capturedValue: null, quotation: "Base salary: $70,000 - $85,000", note: "From the benefits section",
    });
    // The captured evidence was not changed.
    expect(await database.opportunity.findUniqueOrThrow({ where: { id }, select: { salaryMin: true, currency: true } })).toEqual({ salaryMin: null, currency: null });
  });

  it("is never overwritten by a later capture, shows the conflict, and can be edited and undone", async () => {
    const id = await job({ currency: "USD" });
    await evaluation.assessTriage(id);
    await post(id, { fieldName: "salaryRange", value: { minimum: 70_000, maximum: 85_000 } });
    expect((await triageRepository.get(id))?.outcome).toBe("EVALUATE");
    // A later capture states a different (low) salary.
    await database.opportunity.update({ where: { id }, data: { salaryMin: 40_000, salaryMax: 45_000 } });
    expect(await evaluation.assessTriage(id, { onlyIfStale: true, trigger: "CAPTURE_CHANGED" })).toMatchObject({ triage: { outcome: "EVALUATE" } });
    const state = (await (await facts.get(id)).json()) as { facts: Array<{ conflict: unknown }>; history: Array<{ action: string }> };
    expect(state.facts[0]!.conflict).toEqual({ capturedNow: { minimum: 40_000, maximum: 45_000 } });
    // Edit.
    await post(id, { fieldName: "salaryRange", value: { minimum: 72_000, maximum: 86_000 } });
    // Undo: the captured value applies again.
    const undone = await facts.undo(new Request(`http://test?field=salaryRange`, { method: "DELETE" }), id);
    expect(((await undone.json()) as { triage: { outcome: string } }).triage).toEqual({ outcome: "REJECT" });
    const events = (await store.history(id)).map((event) => event.action);
    expect(events).toEqual(["CONFIRMED", "EDITED", "UNDONE"]);
    expect(await store.list(id)).toEqual([]);
    // Every assessment is kept.
    // (The disagreeing capture changed nothing triage reads: no entry.)
    expect(await history(id)).toEqual(["NEEDS_REVIEW:INITIAL", "EVALUATE:USER_CORRECTION", "EVALUATE:USER_CORRECTION", "REJECT:USER_CORRECTION"]);
  });

  it("refuses invalid information and names the regions as codes", async () => {
    const id = await job({ residencyRequirement: null, residencyRegions: [] });
    expect((await post(id, { fieldName: "salaryRange", value: { minimum: 90_000, maximum: 80_000 } })).status).toBe(400);
    expect((await post(id, { fieldName: "bogus", value: 1 })).status).toBe(400);
    expect((await post(id, { fieldName: "residency", value: { requirement: "NON_US", regions: ["Atlantis"] } })).status).toBe(400);
    expect((await post(id, { fieldName: "residency", value: { requirement: "NON_US", regions: ["Germany", "France"] } })).status).toBe(200);
    expect((await store.list(id))[0]).toMatchObject({ value: { requirement: "NON_US", regions: ["DE", "FR"] } });
    expect((await facts.get(randomUUID())).status).toBe(404);
  });
});
