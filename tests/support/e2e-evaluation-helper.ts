import "dotenv/config";
import {
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  getDatabaseClient,
} from "../../database/src/index";
import { createEvaluationWorker } from "../../packages/evaluation/src/index";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
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
    process.stdout.write(profile.id);
  } else if (command === "run-worker") {
    const review = process.argv[3] === "review";
    const tasks = new PrismaEvaluationTaskRepository();
    const worker = createEvaluationWorker({
      tasks,
      leaseSeconds: 60,
      processor: createCustomerSuccessEvaluationProcessor({
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
      }),
    });
    const task = await worker.runOnce();
    if (task?.status !== "COMPLETED") {
      throw new Error(`Deterministic worker ended in ${task?.status ?? "NO_TASK"}`);
    }
    process.stdout.write(task.evaluationId);
  } else if (command === "cleanup") {
    const opportunityId = process.argv[3];
    const profileId = process.argv[4];
    if (opportunityId) await database.opportunity.deleteMany({ where: { id: opportunityId } });
    if (profileId) await database.userProfile.deleteMany({ where: { id: profileId } });
  } else {
    throw new Error("Unknown deterministic E2E helper command");
  }
} finally {
  await database.$disconnect();
}
