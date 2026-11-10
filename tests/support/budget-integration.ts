import { randomUUID } from "node:crypto";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityLifecycleRepository,
} from "@ai-career/database";
import { createEvaluationWorker } from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { readSemanticEnvironment } from "@ai-career/shared";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { withOpportunityLifecycleSync } from "../../apps/web/src/server/opportunity-lifecycle-sync";
import { semanticExecutorConfigFromEnvironment } from "../../apps/web/src/server/semantic-execution-config";
import { createCustomerSuccessFixtureTransport, customerSuccessTestPreferences } from "../fixtures/customer-success";
import { testSemanticPricing } from "../fixtures/semantic-pricing";
import { e2eEnvironment } from "./e2e-environment";

// Shared, deterministic setup for the budget and admission integration
// suites. The budget row and active profile are global, so suites snapshot
// and restore them; everything else they create is deleted afterwards.

export const database = getDatabaseClient();
export const tasks = new PrismaEvaluationTaskRepository();
export const semanticConfig = {
  ...semanticExecutorConfigFromEnvironment(readSemanticEnvironment({ ...process.env, ...e2eEnvironment() })),
  apiKey: "deterministic-integration-key",
};

export function createHarness(clock: { now: Date }) {
  const budget = createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] });
  const service = createEvaluationService({
    queries: new PrismaEvaluationQueryRepository(),
    evaluations: new PrismaEvaluationRepository(),
    tasks,
    semanticConfig,
    jobMaxAttempts: 1,
    admissionGate: budget.gate,
  });
  return { budget, service };
}

export function createCleanup() {
  const opportunityIds: string[] = [];
  const profileIds: string[] = [];
  let budgetBefore: Awaited<ReturnType<typeof database.budgetSetting.findUnique>> = null;
  return {
    opportunityIds,
    profileIds,
    async before() {
      budgetBefore = await database.budgetSetting.findUnique({ where: { id: "global" } });
      await database.budgetSetting.deleteMany({ where: { id: "global" } });
    },
    async after() {
      for (const id of opportunityIds.splice(0)) {
        const opportunity = await database.opportunity.findUnique({ where: { id }, select: { companyId: true } });
        await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
        await database.opportunity.deleteMany({ where: { id } }); // cascades evaluations, admissions, deferrals
        if (opportunity?.companyId) await database.company.deleteMany({ where: { id: opportunity.companyId } });
      }
      await database.userProfile.deleteMany({ where: { id: { in: profileIds.splice(0) } } });
      await database.budgetSetting.deleteMany({ where: { id: "global" } });
      if (budgetBefore) await database.budgetSetting.create({ data: budgetBefore });
    },
  };
}

export async function createProfile(cleanup: { profileIds: string[] }, label = `Budget profile ${randomUUID()}`) {
  const profile = await database.userProfile.create({
    data: {
      label,
      version: 1,
      careerGoals: [{ id: "goal-budget", statement: "Build a strategic SaaS career." }],
      experience: [{ id: "experience-budget", statement: "Led customer onboarding, adoption, and education.", relationship: "DIRECT" }],
      skills: [{ id: "skill-budget", statement: "Customer enablement" }],
      transferableSkills: [{ id: "transfer-budget", statement: "Teaching and facilitation" }],
      workPreferences: [{ id: "work-budget", statement: "Prefers strategic documented work." }],
      domainPreferences: { customerSuccess: customerSuccessTestPreferences },
    },
  });
  cleanup.profileIds.push(profile.id);
  return profile;
}

export async function captureOpportunity(cleanup: { opportunityIds: string[] }) {
  const detail = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    title: "Customer Success Manager",
    company: `Budget SaaS ${randomUUID()}`,
    location: "Remote - United States",
    compensationText: "$72,000-$88,000",
    postingDate: "2026-10-01",
    domain: "customer-success",
    rawText: [
      "Customer Success Manager at a SaaS workflow platform.",
      "Remote. Applicants must reside in the United States.",
      "Salary $72,000-$88,000. No travel required.",
      "Own onboarding, adoption, education, retention, and business reviews.",
      "3 years of Customer Success experience required.",
    ].join("\n"),
  });
  cleanup.opportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

export function runWorker() {
  return createEvaluationWorker({
    tasks,
    leaseSeconds: 60,
    processor: withOpportunityLifecycleSync(
      createCustomerSuccessEvaluationProcessor({
        evaluations: new PrismaEvaluationRepository(),
        tasks,
        semanticConfig,
        transport: createCustomerSuccessFixtureTransport(),
      }),
      new PrismaOpportunityLifecycleRepository(),
    ),
  }).runOnce();
}

// Records one attempt through the existing production recorder, unchanged.
// `createdAt` may then be moved for period-boundary tests (seed data only).
export async function recordAttempt(
  evaluationId: string,
  attempt: number,
  estimatedCost: number | null,
  createdAt?: Date,
) {
  await tasks.recordSemanticOperation(evaluationId, {
    operationId: "customer-success.job-evaluation",
    promptVersion: "budget-test",
    attempt,
    provider: "openai",
    model: testSemanticPricing.model,
    status: "SUCCESS",
    usage: estimatedCost === null
      ? { inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null, totalTokens: null }
      : { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0, reasoningTokens: 20, totalTokens: 1200 },
    estimatedCost,
    pricingConfiguration: testSemanticPricing,
    durationMs: 10,
    providerRequestId: `req-budget-${evaluationId}-${attempt}`,
    errorCode: null,
    errorMessage: null,
  });
  if (createdAt) {
    await database.semanticOperationAttempt.updateMany({
      where: { evaluationId, attempt, operationId: "customer-success.job-evaluation" },
      data: { createdAt },
    });
  }
}

export async function setBudget(input: {
  amount: number;
  reservePerEvaluation: number;
  enforced?: boolean;
  timeZone?: string;
}) {
  await database.budgetSetting.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      amount: input.amount,
      currency: "USD",
      timeZone: input.timeZone ?? "UTC",
      enforced: input.enforced ?? true,
      reservePerEvaluation: input.reservePerEvaluation,
    },
    update: {
      amount: input.amount,
      timeZone: input.timeZone ?? "UTC",
      enforced: input.enforced ?? true,
      reservePerEvaluation: input.reservePerEvaluation,
    },
  });
}

export async function activeEvaluationCount(opportunityId: string) {
  return database.evaluationTask.count({
    where: { evaluation: { opportunityId }, status: { in: ["PENDING", "RUNNING"] } },
  });
}
