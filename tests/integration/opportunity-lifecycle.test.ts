import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createManualOpportunityService, type OpportunityUserAction } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityLifecycleRepository,
  PrismaOpportunityListRepository,
} from "@ai-career/database";
import { createEvaluationWorker, type SemanticProviderTransport } from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { readSemanticEnvironment } from "@ai-career/shared";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { withOpportunityLifecycleSync } from "../../apps/web/src/server/opportunity-lifecycle-sync";
import { semanticExecutorConfigFromEnvironment } from "../../apps/web/src/server/semantic-execution-config";
import {
  createCustomerSuccessFixtureTransport,
  customerSuccessTestPreferences,
} from "../fixtures/customer-success";
import { e2eEnvironment } from "../support/e2e-environment";

const database = getDatabaseClient();
const lifecycle = new PrismaOpportunityLifecycleRepository();
const createdOpportunityIds: string[] = [];
const createdProfileIds: string[] = [];
// Deterministic, provider-free configuration (same as the E2E worker).
const semanticConfig = {
  ...semanticExecutorConfigFromEnvironment(
    readSemanticEnvironment({ ...process.env, ...e2eEnvironment() }),
  ),
  apiKey: "deterministic-integration-key",
};

afterEach(async () => {
  for (const id of createdOpportunityIds.splice(0)) {
    const opportunity = await database.opportunity.findUnique({ where: { id }, select: { companyId: true } });
    await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
    await database.opportunity.deleteMany({ where: { id } });
    if (opportunity?.companyId) await database.company.deleteMany({ where: { id: opportunity.companyId } });
  }
  await database.userProfile.deleteMany({ where: { id: { in: createdProfileIds.splice(0) } } });
});

afterAll(async () => {
  await database.$disconnect();
});

async function createProfile() {
  const profile = await database.userProfile.create({
    data: {
      label: `Lifecycle integration profile ${randomUUID()}`,
      version: 1,
      careerGoals: [{ id: "goal-it", statement: "Build a strategic SaaS career." }],
      experience: [{ id: "experience-it", statement: "Led customer onboarding, adoption, and education.", relationship: "DIRECT" }],
      skills: [{ id: "skill-it", statement: "Customer enablement" }],
      transferableSkills: [{ id: "transfer-it", statement: "Teaching and facilitation" }],
      workPreferences: [{ id: "work-it", statement: "Prefers strategic documented work." }],
      domainPreferences: { customerSuccess: customerSuccessTestPreferences },
    },
  });
  createdProfileIds.push(profile.id);
  return profile.id;
}

async function createOpportunity() {
  const detail = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    title: "Customer Success Manager",
    company: `Lifecycle SaaS ${randomUUID()}`,
    location: "Remote - United States",
    compensationText: "$72,000-$88,000",
    domain: "customer-success",
    rawText: [
      "Customer Success Manager at a SaaS workflow platform.",
      "Remote. Applicants must reside in the United States. Central or Eastern time preferred.",
      "Salary $72,000-$88,000. No travel required.",
      "Own onboarding, adoption, education, retention, and business reviews.",
      "Collaborate with Product and hand technical escalations to Support.",
      "3 years of Customer Success experience required. Salesforce preferred.",
    ].join("\n"),
  });
  createdOpportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

const tasks = new PrismaEvaluationTaskRepository();
const service = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks,
  semanticConfig,
  jobMaxAttempts: 1,
});

// The production composition: processor wrapped with lifecycle sync.
function runWorker(transport: SemanticProviderTransport = createCustomerSuccessFixtureTransport()) {
  return createEvaluationWorker({
    tasks,
    leaseSeconds: 60,
    processor: withOpportunityLifecycleSync(
      createCustomerSuccessEvaluationProcessor({
        evaluations: new PrismaEvaluationRepository(),
        tasks,
        semanticConfig,
        transport,
      }),
      lifecycle,
    ),
  }).runOnce();
}

async function evaluate(opportunityId: string, profileId: string) {
  await service.requestEvaluation(opportunityId, { userProfileId: profileId });
  return runWorker();
}

async function statusOf(opportunityId: string) {
  return (await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { status: true } })).status;
}

const countActions = (opportunityId: string) =>
  database.opportunityUserAction.count({ where: { opportunityId } });
const countEvaluations = (opportunityId: string) =>
  database.evaluation.count({ where: { opportunityId } });

async function act(opportunityId: string, action: OpportunityUserAction) {
  const result = await lifecycle.applyUserAction({ opportunityId, action });
  if (result.status !== "APPLIED") throw new Error(`${action} was ${result.status}`);
  return result.to;
}

// Persisted completed evaluation + recommendation, then the product sync.
async function seedRecommended(opportunityId: string) {
  const evaluation = await database.evaluation.create({
    data: {
      opportunityId,
      domain: "customer-success",
      status: "COMPLETED",
      evaluationVersion: "lifecycle-test",
      domainVersion: "lifecycle-test",
      ruleVersion: "lifecycle-test",
      completedAt: new Date(),
    },
  });
  await database.recommendation.create({
    data: {
      opportunityId,
      evaluationId: evaluation.id,
      decision: "APPLY",
      evidenceReferences: [],
      explanation: "Lifecycle test recommendation.",
      evaluationVersion: "lifecycle-test",
    },
  });
  await lifecycle.syncSystemLifecycle(opportunityId);
}

describe("opportunity lifecycle with the production worker composition", () => {
  it("moves NORMALIZED to RECOMMENDED after a completed evaluation and keeps it on reevaluation", async () => {
    const profileId = await createProfile();
    const opportunityId = await createOpportunity();
    expect(await statusOf(opportunityId)).toBe("NORMALIZED");

    expect((await evaluate(opportunityId, profileId))?.status).toBe("COMPLETED");
    expect(await statusOf(opportunityId)).toBe("RECOMMENDED");

    expect((await evaluate(opportunityId, profileId))?.status).toBe("COMPLETED");
    expect(await statusOf(opportunityId)).toBe("RECOMMENDED");
    expect(await countEvaluations(opportunityId)).toBe(2);
    expect(await countActions(opportunityId)).toBe(0);
  });

  it("reevaluates a SAVED opportunity: stays SAVED, adds an Evaluation row, adds no user-action row", async () => {
    const profileId = await createProfile();
    const opportunityId = await createOpportunity();
    await evaluate(opportunityId, profileId);
    await act(opportunityId, "SAVE");
    expect(await countActions(opportunityId)).toBe(1);

    const task = await evaluate(opportunityId, profileId);

    expect(task?.status).toBe("COMPLETED");
    expect(await statusOf(opportunityId)).toBe("SAVED");
    expect(await countEvaluations(opportunityId)).toBe(2);
    expect(await countActions(opportunityId)).toBe(1);
  });

  it("leaves the lifecycle unchanged when an evaluation fails", async () => {
    const profileId = await createProfile();
    const opportunityId = await createOpportunity();
    await service.requestEvaluation(opportunityId, { userProfileId: profileId });
    const failingTransport: SemanticProviderTransport = {
      async execute() {
        return { outputText: "{}", providerRequestId: "req-invalid", usage: null };
      },
    };

    const task = await runWorker(failingTransport);

    expect(task?.status).toBe("FAILED");
    expect(await statusOf(opportunityId)).toBe("NORMALIZED");
    expect(await lifecycle.syncSystemLifecycle(opportunityId)).toBeNull();
    expect(await countActions(opportunityId)).toBe(0);
  });

  it("restores to the evaluation-derived state when saved before the evaluation completed", async () => {
    const profileId = await createProfile();
    const opportunityId = await createOpportunity();
    await act(opportunityId, "SAVE"); // from NORMALIZED

    await evaluate(opportunityId, profileId);
    expect(await statusOf(opportunityId)).toBe("SAVED"); // sync never overwrites user states

    expect(await act(opportunityId, "RESTORE")).toBe("RECOMMENDED"); // not the stale NORMALIZED
  });

  it("lets an in-flight evaluation finish after archiving without corrupting the restore target", async () => {
    const profileId = await createProfile();
    const opportunityId = await createOpportunity();
    await service.requestEvaluation(opportunityId, { userProfileId: profileId });
    await act(opportunityId, "MARK_APPLIED");
    await act(opportunityId, "ARCHIVE");

    expect((await runWorker())?.status).toBe("COMPLETED");
    expect(await statusOf(opportunityId)).toBe("ARCHIVED");

    expect(await act(opportunityId, "RESTORE")).toBe("APPLIED");
    expect(await act(opportunityId, "RESTORE")).toBe("RECOMMENDED");
  });

  it("rejects new evaluation requests for archived opportunities", async () => {
    const opportunityId = await createOpportunity();
    await act(opportunityId, "ARCHIVE");
    await expect(service.requestEvaluation(opportunityId, {})).rejects.toMatchObject({
      code: "OPPORTUNITY_NOT_EVALUABLE",
    });
  });
});

describe("deterministic RESTORE against PostgreSQL", () => {
  it("RECOMMENDED → SAVED → RESTORE → RECOMMENDED", async () => {
    const opportunityId = await createOpportunity();
    await seedRecommended(opportunityId);
    expect(await statusOf(opportunityId)).toBe("RECOMMENDED");
    await act(opportunityId, "SAVE");
    expect(await act(opportunityId, "RESTORE")).toBe("RECOMMENDED");
  });

  it("APPLIED → ARCHIVED → RESTORE → APPLIED", async () => {
    const opportunityId = await createOpportunity();
    await seedRecommended(opportunityId);
    await act(opportunityId, "MARK_APPLIED");
    await act(opportunityId, "ARCHIVE");
    expect(await act(opportunityId, "RESTORE")).toBe("APPLIED");
  });

  it("REJECTED_BY_USER → ARCHIVED → RESTORE → REJECTED_BY_USER", async () => {
    const opportunityId = await createOpportunity();
    await seedRecommended(opportunityId);
    await act(opportunityId, "DISMISS");
    await act(opportunityId, "ARCHIVE");
    expect(await act(opportunityId, "RESTORE")).toBe("REJECTED_BY_USER");
  });

  it("repeated RESTORE walks backward without bouncing, then is refused", async () => {
    const opportunityId = await createOpportunity();
    await seedRecommended(opportunityId);
    await act(opportunityId, "SAVE");
    await act(opportunityId, "MARK_APPLIED");
    await act(opportunityId, "ARCHIVE");
    expect(await act(opportunityId, "RESTORE")).toBe("APPLIED");
    expect(await act(opportunityId, "RESTORE")).toBe("SAVED");
    expect(await act(opportunityId, "RESTORE")).toBe("RECOMMENDED");
    expect(await lifecycle.applyUserAction({ opportunityId, action: "RESTORE" })).toMatchObject({
      status: "NOT_ALLOWED",
    });
    expect(await statusOf(opportunityId)).toBe("RECOMMENDED");
    expect(await countActions(opportunityId)).toBe(6);
  });

  it("rejects disallowed actions and lets only one of two concurrent actions apply", async () => {
    const opportunityId = await createOpportunity();
    expect(await lifecycle.applyUserAction({ opportunityId, action: "RESTORE" })).toMatchObject({ status: "NOT_ALLOWED" });
    expect(await lifecycle.applyUserAction({ opportunityId: randomUUID(), action: "SAVE" })).toEqual({ status: "NOT_FOUND" });

    const results = await Promise.all([
      lifecycle.applyUserAction({ opportunityId, action: "SAVE" }),
      lifecycle.applyUserAction({ opportunityId, action: "SAVE" }),
    ]);
    expect(results.filter((result) => result.status === "APPLIED")).toHaveLength(1);
    expect(await statusOf(opportunityId)).toBe("SAVED");
    expect(await countActions(opportunityId)).toBe(1);
  });
});

describe("lifecycle sweep and list filtering", () => {
  it("repairs completed-but-unsynced opportunities and never touches user states", async () => {
    const unsynced = await createOpportunity();
    const evaluatedOnly = await createOpportunity();
    const saved = await createOpportunity();
    for (const opportunityId of [unsynced, saved]) {
      const evaluation = await database.evaluation.create({
        data: { opportunityId, domain: "customer-success", status: "COMPLETED", evaluationVersion: "t", domainVersion: "t", ruleVersion: "t", completedAt: new Date() },
      });
      await database.recommendation.create({
        data: { opportunityId, evaluationId: evaluation.id, decision: "REVIEW", evidenceReferences: [], explanation: "t", evaluationVersion: "t" },
      });
    }
    await database.evaluation.create({
      data: { opportunityId: evaluatedOnly, domain: "neutral-test", status: "COMPLETED", evaluationVersion: "t", domainVersion: "t", ruleVersion: "t", completedAt: new Date() },
    });
    await act(saved, "SAVE");

    expect(await lifecycle.sweepSystemLifecycle()).toBeGreaterThanOrEqual(2);
    expect(await statusOf(unsynced)).toBe("RECOMMENDED");
    expect(await statusOf(evaluatedOnly)).toBe("EVALUATED");
    expect(await statusOf(saved)).toBe("SAVED");
  });

  it("filters the opportunity list by lifecycle status", async () => {
    const active = await createOpportunity();
    const archived = await createOpportunity();
    await act(archived, "ARCHIVE");
    const ids = (statuses?: Parameters<PrismaOpportunityListRepository["listOpportunities"]>[0]) =>
      new PrismaOpportunityListRepository().listOpportunities(statuses).then((items) =>
        items.map((item) => item.id).filter((id) => createdOpportunityIds.includes(id)),
      );
    expect(await ids({ statuses: ["NORMALIZED", "SAVED"] })).toEqual([active]);
    expect(await ids({ statuses: ["ARCHIVED"] })).toEqual([archived]);
    expect((await ids()).sort()).toEqual([active, archived].sort());
  });
});
