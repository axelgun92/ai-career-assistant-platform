import "dotenv/config";
import {
  EvaluationWorkerLock,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaOpportunityLifecycleRepository,
  PrismaUserProfileRepository,
  getDatabaseClient,
  type VersionedUserProfileData,
} from "../../database/src/index";
import { createEvaluationWorker } from "../../packages/evaluation/src/index";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { withOpportunityLifecycleSync } from "../../apps/web/src/server/opportunity-lifecycle-sync";
import {
  createCustomerSuccessFixtureTransport,
  customerSuccessTestPreferences,
} from "../fixtures/customer-success";
import { readSemanticEnvironment } from "../../packages/shared/src/index";
import { semanticExecutorConfigFromEnvironment } from "../../apps/web/src/server/semantic-execution-config";
import { e2eEnvironment } from "./e2e-environment";

const database = getDatabaseClient();
const command = process.argv[2];

try {
  if (command === "create-profile") {
    const profile = await database.userProfile.create({
      data: {
        label: "Deterministic E2E Customer Success profile",
        version: 10,
        careerGoals: [{ id: "goal-e2e", statement: "Build a strategic SaaS career." }],
        experience: [{ id: "experience-e2e", statement: "Led customer onboarding, adoption, and education.", relationship: "DIRECT" }],
        skills: [{ id: "skill-e2e", statement: "Customer enablement" }],
        transferableSkills: [{ id: "transfer-e2e", statement: "Teaching and facilitation" }],
        workPreferences: [{ id: "work-e2e", statement: "Prefers strategic documented work." }],
        domainPreferences: { customerSuccess: customerSuccessTestPreferences },
      },
    });
    // Make it the active profile so UI-requested evaluations use it even if
    // a developer database has another version active; print the previous
    // active version so cleanup can restore it.
    const previous = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" } });
    await database.activeUserProfile.upsert({
      where: { domain: "customer-success" },
      create: { domain: "customer-success", userProfileId: profile.id },
      update: { userProfileId: profile.id },
    });
    process.stdout.write(`${profile.id} ${previous?.userProfileId ?? ""}`.trim());
  } else if (command === "create-profile-version") {
    // A fresh, active v1 in its own label lineage for profile-management specs.
    const label = process.argv[3]!;
    const result = await new PrismaUserProfileRepository().saveVersion(
      "customer-success",
      {
        label,
        careerGoals: [{ id: "goal-e2e", statement: "Build a strategic SaaS career." }],
        experience: [{ id: "experience-e2e", statement: "Led customer onboarding, adoption, and education.", relationship: "DIRECT" }],
        skills: [{ id: "skill-e2e", statement: "Customer enablement" }],
        transferableSkills: [{ id: "transfer-e2e", statement: "Teaching and facilitation" }],
        locationPreferences: null,
        compensationPreferences: null,
        workPreferences: [{ id: "work-e2e", statement: "Prefers strategic documented work." }],
        companyPreferences: null,
        domainPreferences: { customerSuccess: customerSuccessTestPreferences },
      } as unknown as VersionedUserProfileData,
      { activate: true },
    );
    process.stdout.write(result.id);
  } else if (command === "active-profile") {
    const active = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" } });
    process.stdout.write(active?.userProfileId ?? "");
  } else if (command === "count-profile-versions") {
    process.stdout.write(String(await database.userProfile.count({ where: { label: process.argv[3]! } })));
  } else if (command === "cleanup-profiles") {
    // Deletes a label lineage (its active pointer cascades) and restores the
    // previously active version, if any.
    const label = process.argv[3]!;
    const previous = process.argv[4];
    await database.userProfile.deleteMany({ where: { label } });
    if (previous && (await database.userProfile.findUnique({ where: { id: previous } }))) {
      await database.activeUserProfile.upsert({
        where: { domain: "customer-success" },
        create: { domain: "customer-success", userProfileId: previous },
        update: { userProfileId: previous },
      });
    }
  } else if (command === "budget-snapshot") {
    // The budget is global: specs that change it snapshot and restore it.
    const row = await database.budgetSetting.findUnique({ where: { id: "global" } });
    process.stdout.write(row ? JSON.stringify(row) : "");
  } else if (command === "budget-restore") {
    const snapshot = process.argv[3];
    await database.budgetSetting.deleteMany({ where: { id: "global" } });
    if (snapshot) {
      const row = JSON.parse(snapshot) as Record<string, unknown>;
      await database.budgetSetting.create({ data: { ...row, updatedAt: new Date(String(row.updatedAt)) } as never });
    }
  } else if (command === "run-worker") {
    const review = process.argv[3] === "review";
    const tasks = new PrismaEvaluationTaskRepository();
    const worker = createEvaluationWorker({
      tasks,
      leaseSeconds: 60,
      // Same lifecycle-syncing composition as the production worker.
      processor: withOpportunityLifecycleSync(createCustomerSuccessEvaluationProcessor({
        evaluations: new PrismaEvaluationRepository(),
        tasks,
        // Use the same policy the web server queues (accepted production
        // routing). The fixture transport below replaces the provider, so the
        // API key is never used and no provider call is possible.
        semanticConfig: {
          ...semanticExecutorConfigFromEnvironment(
            readSemanticEnvironment({ ...process.env, ...e2eEnvironment() }),
          ),
          apiKey: "deterministic-e2e-key",
        },
        transport: createCustomerSuccessFixtureTransport({
          resumeMatch: review ? {
            requirementClassifications: ["GENUINE_GAP", "STRONG_MATCH"],
            matchedExperienceSpecificities: ["UNSUPPORTED", "DIRECT_CUSTOMER_SUCCESS"],
            decisionImpacts: ["MATERIAL_UNCERTAINTY", "NON_DECISIVE"],
          } : undefined,
        }),
      }), new PrismaOpportunityLifecycleRepository()),
    });
    const task = await worker.runOnce();
    if (task?.status !== "COMPLETED") {
      throw new Error(`Deterministic worker ended in ${task?.status ?? "NO_TASK"}`);
    }
    process.stdout.write(task.evaluationId);
  } else if (command === "fail-latest" || command === "age-latest") {
    // Deterministic stand-ins for worker outcomes the UI must present:
    // a failed latest evaluation, or a task left queued (no worker running).
    const opportunityId = process.argv[3]!;
    const latest = await database.evaluation.findFirst({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latest) throw new Error("No evaluation exists for the opportunity");
    if (command === "fail-latest") {
      const internalDetail = "E2E-INTERNAL-DETAIL-MUST-NOT-RENDER";
      await database.evaluation.update({
        where: { id: latest.id },
        data: { status: "FAILED", errorMessage: internalDetail, completedAt: new Date() },
      });
      await database.evaluationTask.update({
        where: { evaluationId: latest.id },
        data: {
          status: "FAILED",
          errorCode: "PROVIDER_TIMEOUT",
          errorMessage: internalDetail,
          completedAt: new Date(),
        },
      });
    } else {
      const ageSeconds = Number(process.argv[4] ?? "300");
      const createdAt = new Date(Date.now() - ageSeconds * 1000);
      await database.evaluation.update({ where: { id: latest.id }, data: { createdAt } });
      await database.evaluationTask.update({ where: { evaluationId: latest.id }, data: { createdAt } });
    }
  } else if (command === "expire-lease") {
    // Test data only: the state a worker leaves when it dies during the final
    // attempt — RUNNING, no attempts left, lease expired, a stage mid-run.
    const opportunityId = process.argv[3]!;
    const latest = await database.evaluation.findFirst({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
      select: { id: true, task: { select: { maxAttempts: true } } },
    });
    if (!latest?.task) throw new Error("No queued evaluation exists for the opportunity");
    const past = new Date(Date.now() - 10 * 60_000);
    await database.evaluationTask.update({
      where: { evaluationId: latest.id },
      data: {
        status: "RUNNING",
        attempt: latest.task.maxAttempts,
        claimedAt: past,
        startedAt: past,
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    await database.evaluation.update({ where: { id: latest.id }, data: { status: "RUNNING", startedAt: past } });
    await database.stageResult.updateMany({
      where: { evaluationId: latest.id, position: 0 },
      data: { status: "RUNNING", startedAt: past },
    });
  } else if (command === "run-recovery") {
    // The worker's own recovery step, under the single-worker lock.
    const lock = new EvaluationWorkerLock();
    if (!(await lock.acquire())) throw new Error("Another evaluation worker holds the lock");
    try {
      const recovered = await new PrismaEvaluationTaskRepository().failExpiredExhaustedTasks();
      process.stdout.write(String(recovered.length));
    } finally {
      await lock.release();
    }
  } else if (command === "cleanup") {
    const opportunityId = process.argv[3];
    const profileId = process.argv[4];
    const previousActiveId = process.argv[5];
    if (opportunityId) await database.opportunity.deleteMany({ where: { id: opportunityId } });
    if (profileId) await database.userProfile.deleteMany({ where: { id: profileId } });
    if (previousActiveId && (await database.userProfile.findUnique({ where: { id: previousActiveId } }))) {
      await database.activeUserProfile.upsert({
        where: { domain: "customer-success" },
        create: { domain: "customer-success", userProfileId: previousActiveId },
        update: { userProfileId: previousActiveId },
      });
    }
  } else {
    throw new Error("Unknown deterministic E2E helper command");
  }
} finally {
  await database.$disconnect();
}
