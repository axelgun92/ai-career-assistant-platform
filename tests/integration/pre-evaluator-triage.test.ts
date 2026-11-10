import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createManualOpportunityService } from "@ai-career/core";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaPreEvaluatorTriageRepository,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import {
  activeEvaluationCount,
  createCleanup,
  createProfile,
  database,
  semanticConfig,
  setBudget,
} from "../support/budget-integration";

const cleanup = createCleanup();
const clock = { now: new Date("2026-11-02T12:00:00.000Z") };
const triageRepository = new PrismaPreEvaluatorTriageRepository();
const triage = createPreEvaluatorTriageService({
  repository: triageRepository,
  now: () => clock.now,
});
const budget = createBudgetService({
  now: () => clock.now,
  pricingCurrencies: () => ["USD"],
});
const service = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: budget.gate,
  triageGate: triage.gate,
});

beforeEach(async () => {
  clock.now = new Date("2026-11-02T12:00:00.000Z");
  await cleanup.before();
});
afterEach(() => cleanup.after());
afterAll(() => database.$disconnect());

async function capture(kind: "compatible" | "unknown" | "reject") {
  const compensationText = kind === "unknown" ? null : kind === "reject" ? "$45,000-$50,000" : "$72,000-$88,000";
  const salaryLine = compensationText ? `Base salary ${compensationText}.` : "Compensation is not stated.";
  const detail = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    title: "Customer Success Manager",
    company: `Triage ${kind} ${randomUUID()}`,
    location: "Remote - United States",
    ...(compensationText ? { compensationText } : {}),
    postingDate: "2026-11-01",
    domain: "customer-success",
    rawText: [
      "Customer Success Manager for a workflow SaaS platform.",
      "This is a fully remote role. Applicants must reside in the United States.",
      salaryLine,
      "Own onboarding, adoption, education, and retention.",
    ].join("\n"),
  });
  cleanup.opportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

async function writeCounts(opportunityId: string) {
  const [evaluations, tasks, admissions, deferrals, attempts] = await Promise.all([
    database.evaluation.count({ where: { opportunityId } }),
    database.evaluationTask.count({ where: { evaluation: { opportunityId } } }),
    database.evaluationAdmission.count({ where: { opportunityId } }),
    database.deferredEvaluation.count({ where: { opportunityId } }),
    database.semanticOperationAttempt.count({ where: { opportunityId } }),
  ]);
  return { evaluations, tasks, admissions, deferrals, attempts };
}

describe("database-backed pre-evaluator triage", () => {
  it("EVALUATE enters the existing evaluator admission and backlog", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await capture("compatible");

    await expect(service.requestEvaluation(opportunityId, { userProfileId: profile.id })).resolves.toMatchObject({
      outcome: "QUEUED",
    });
    expect(await triageRepository.get(opportunityId)).toMatchObject({ outcome: "EVALUATE", reasons: [] });
    expect(await activeEvaluationCount(opportunityId)).toBe(1);
    expect((await writeCounts(opportunityId)).admissions).toBe(1);
  });

  it("NEEDS_REVIEW persists with zero evaluator work and manual Evaluate releases it", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await capture("unknown");

    const held = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(held).toMatchObject({ outcome: "NEEDS_REVIEW" });
    expect(await writeCounts(opportunityId)).toEqual({ evaluations: 0, tasks: 0, admissions: 0, deferrals: 0, attempts: 0 });
    expect(await triageRepository.get(opportunityId)).toMatchObject({
      outcome: "NEEDS_REVIEW",
      manualDecision: null,
    });

    await expect(service.decideTriage(opportunityId, { decision: "EVALUATE" })).resolves.toMatchObject({
      outcome: "QUEUED",
    });
    expect(await triageRepository.get(opportunityId)).toMatchObject({
      outcome: "NEEDS_REVIEW",
      manualDecision: "EVALUATE",
      manuallyDecidedAt: clock.now,
    });
    expect(await activeEvaluationCount(opportunityId)).toBe(1);
  });

  it("manual Reject stops a NEEDS_REVIEW job with zero evaluator work", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await capture("unknown");
    await service.requestEvaluation(opportunityId, { userProfileId: profile.id });

    await expect(service.decideTriage(opportunityId, { decision: "REJECT" })).resolves.toMatchObject({
      outcome: "REJECT",
    });
    expect(await writeCounts(opportunityId)).toEqual({ evaluations: 0, tasks: 0, admissions: 0, deferrals: 0, attempts: 0 });
    expect(await triageRepository.get(opportunityId)).toMatchObject({ manualDecision: "REJECT" });
  });

  it("automatic REJECT persists reasons and creates no evaluator task, admission, or deferral", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await capture("reject");

    await expect(service.requestEvaluation(opportunityId, { userProfileId: profile.id })).resolves.toMatchObject({
      outcome: "REJECT",
    });
    expect(await writeCounts(opportunityId)).toEqual({ evaluations: 0, tasks: 0, admissions: 0, deferrals: 0, attempts: 0 });
    expect(await triageRepository.get(opportunityId)).toMatchObject({
      outcome: "REJECT",
      reasons: expect.arrayContaining([expect.objectContaining({ disposition: "REJECT" })]),
    });
  });

  it("reassessment updates one triage record without duplicating the opportunity and preserves a manual decision", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await capture("unknown");
    await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    await service.decideTriage(opportunityId, { decision: "REJECT" });
    const first = await triageRepository.get(opportunityId);

    await database.opportunity.update({
      where: { id: opportunityId },
      data: { salaryMin: 72_000, salaryMax: 88_000, currency: "USD", compensationBasis: "BASE" },
    });
    const reassessed = await triage.gate.assess({
      opportunityId,
      domain: "customer-success",
      profile: { id: profile.id, version: profile.version },
    });

    expect(reassessed).toMatchObject({ automaticOutcome: "EVALUATE", outcome: "REJECT", manualDecision: "REJECT" });
    expect((await triageRepository.get(opportunityId))?.id).toBe(first?.id);
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId } })).toBe(1);
    expect(await database.opportunity.count({ where: { id: opportunityId } })).toBe(1);
  });

  it("only EVALUATE reaches budget admission; held and rejected jobs consume no budget rows", async () => {
    await setBudget({ amount: 0, reservePerEvaluation: 1 });
    const profile = await createProfile(cleanup);
    const eligible = await capture("compatible");
    const held = await capture("unknown");
    const rejected = await capture("reject");

    await expect(service.requestEvaluation(eligible, { userProfileId: profile.id })).resolves.toMatchObject({ outcome: "DEFERRED" });
    await expect(service.requestEvaluation(held, { userProfileId: profile.id })).resolves.toMatchObject({ outcome: "NEEDS_REVIEW" });
    await expect(service.requestEvaluation(rejected, { userProfileId: profile.id })).resolves.toMatchObject({ outcome: "REJECT" });

    expect((await writeCounts(eligible)).deferrals).toBe(1);
    expect(await writeCounts(held)).toEqual({ evaluations: 0, tasks: 0, admissions: 0, deferrals: 0, attempts: 0 });
    expect(await writeCounts(rejected)).toEqual({ evaluations: 0, tasks: 0, admissions: 0, deferrals: 0, attempts: 0 });
  });

  it("triage does not alter source or provenance history", async () => {
    const profile = await createProfile(cleanup);
    const opportunityId = await capture("unknown");
    const before = {
      sources: await database.sourceRecord.count({ where: { opportunityId } }),
      provenance: await database.fieldProvenance.count({ where: { opportunityId } }),
    };

    await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect({
      sources: await database.sourceRecord.count({ where: { opportunityId } }),
      provenance: await database.fieldProvenance.count({ where: { opportunityId } }),
    }).toEqual(before);
  });
});
