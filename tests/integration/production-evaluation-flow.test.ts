import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
  type ResumeMatchFixtureOptions,
} from "../fixtures/customer-success";
import { createManualOpportunityService } from "@ai-career/core";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  getDatabaseClient,
} from "@ai-career/database";
import {
  createEvaluationWorker,
  type SemanticProviderTransport,
} from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const database = getDatabaseClient();
const opportunityIds: string[] = [];
const profileIds: string[] = [];

afterEach(async () => {
  await database.opportunity.deleteMany({
    where: { id: { in: opportunityIds.splice(0) } },
  });
  await database.userProfile.deleteMany({
    where: { id: { in: profileIds.splice(0) } },
  });
});

afterAll(async () => {
  await database.$disconnect();
});

const semanticConfig = {
  apiKey: "deterministic-test-key",
  model: "gpt-5.6-terra",
  maxOutputTokens: 12_000,
  retryLimit: 1,
  callBudget: 16,
  timeoutMs: 30_000,
};

function deterministicTransport(input: {
  resumeMatch?: ResumeMatchFixtureOptions;
  invalidOnceAt?: string;
  alwaysInvalidAt?: string;
  onCall?: () => void;
} = {}): SemanticProviderTransport {
  const fixture = createCustomerSuccessFixtureOperations({
    scenario: "strong",
    resumeMatch: input.resumeMatch,
  });
  const calls = new Map<string, number>();
  return {
    async execute(request) {
      input.onCall?.();
      const call = (calls.get(request.operationId) ?? 0) + 1;
      calls.set(request.operationId, call);
      if (
        input.alwaysInvalidAt === request.operationId ||
        (input.invalidOnceAt === request.operationId && call === 1)
      ) {
        return {
          outputText: "{}",
          providerRequestId: `req-${request.operationId}-${call}`,
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
        };
      }
      const payload = JSON.parse(request.input) as {
        userConfiguration: unknown;
        trustedStructuredContext: Record<string, unknown>;
        untrustedSourceContent: string | null;
      };
      const trusted = payload.trustedStructuredContext;
      let output: unknown;
      switch (request.operationId) {
        case "customer-success.jd-reconstruction":
          output = await fixture.semanticOperations.reconstructJobDescription({
            ...(trusted as never),
            untrustedJobDescription: payload.untrustedSourceContent!,
          });
          break;
        case "customer-success.job-evaluation":
          output = await fixture.semanticOperations.evaluateJob(trusted as never);
          break;
        case "customer-success.company-alignment":
          output = await fixture.semanticOperations.evaluateCompanyAlignment({
            ...trusted,
            preferences: payload.userConfiguration,
          } as never);
          break;
        case "customer-success.organizational-maturity":
          output = await fixture.semanticOperations.evaluateOrganizationalMaturity(
            trusted as never,
          );
          break;
        case "customer-success.alex-fit":
          output = await fixture.semanticOperations.evaluateAlexFit({
            ...trusted,
            preferences: payload.userConfiguration,
          } as never);
          break;
        case "customer-success.burnout-risk":
          output = await fixture.semanticOperations.evaluateBurnoutRisk({
            ...trusted,
            preferences: payload.userConfiguration,
          } as never);
          break;
        case "customer-success.resume-match":
          output = await fixture.semanticOperations.evaluateResumeMatch({
            ...trusted,
            preferences: payload.userConfiguration,
          } as never);
          break;
        case "customer-success.opportunity-priority":
          output = await fixture.semanticOperations.evaluateOpportunityPriority(
            trusted as never,
          );
          break;
        case "customer-success.ghost-job-risk":
          output = await fixture.semanticOperations.evaluateGhostJobRisk(
            trusted as never,
          );
          break;
        default:
          throw new Error(`Unexpected semantic operation: ${request.operationId}`);
      }
      return {
        outputText: JSON.stringify(output),
        providerRequestId: `req-${request.operationId}-${call}`,
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
      };
    },
  };
}

async function createProductionSubject(salary = "$70,000 per year") {
  const opportunity = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    sourceUrl: "https://example.test/jobs/production-flow",
    applicationUrl: "https://example.test/jobs/production-flow/apply",
    title: "Customer Success Manager",
    company: "Example SaaS",
    location: "Remote - United States",
    compensationText: salary,
    postingDate: "2026-08-15",
    domain: "customer-success",
    rawText: [
      "Customer Success Manager at a SaaS workflow platform.",
      "This is a remote role and candidates must reside in the United States.",
      `Salary: ${salary}.`,
      "Zero travel.",
      "Own onboarding, adoption, retention, and strategic customer relationships.",
      "Collaborate with Product and Support while retaining Customer Success ownership.",
      "3+ years of Customer Success experience required.",
      "Salesforce experience preferred.",
    ].join("\n"),
  });
  opportunityIds.push(opportunity.opportunity.id);
  const profile = await database.userProfile.create({
    data: {
      label: "Production-flow Customer Success profile",
      version: 7,
      careerGoals: [
        { id: "goal-1", statement: "Build a strategic SaaS career." },
      ],
      experience: [
        {
          id: "experience-1",
          statement: "Led onboarding, adoption, and customer education.",
          relationship: "DIRECT",
        },
      ],
      skills: [{ id: "skill-1", statement: "Customer enablement" }],
      transferableSkills: [
        { id: "transfer-1", statement: "Cross-functional teaching" },
      ],
      locationPreferences: null,
      compensationPreferences: null,
      workPreferences: [
        { id: "work-1", statement: "Prefers strategic asynchronous work." },
      ],
      companyPreferences: null,
      domainPreferences: {
        customerSuccess: customerSuccessTestPreferences,
      },
    },
  });
  profileIds.push(profile.id);
  return { opportunity, profile };
}

async function runFlow(input: {
  salary?: string;
  resumeMatch?: ResumeMatchFixtureOptions;
  invalidOnceAt?: string;
  alwaysInvalidAt?: string;
  retryLimit?: number;
  requestCallBudget?: number;
  workerCallBudget?: number;
  persistedAttempts?: number;
  onCall?: () => void;
}) {
  const { opportunity, profile } = await createProductionSubject(input.salary);
  const evaluations = new PrismaEvaluationRepository();
  const tasks = new PrismaEvaluationTaskRepository();
  const service = createEvaluationService({
    queries: new PrismaEvaluationQueryRepository(),
    evaluations,
    tasks,
    semanticConfig: {
      ...semanticConfig,
      retryLimit: input.retryLimit ?? 1,
      callBudget: input.requestCallBudget ?? semanticConfig.callBudget,
    },
    jobMaxAttempts: 2,
  });
  const accepted = await service.requestEvaluation(opportunity.opportunity.id, {
    userProfileId: profile.id,
  });
  for (let attempt = 1; attempt <= (input.persistedAttempts ?? 0); attempt += 1) {
    await tasks.recordSemanticOperation(accepted.evaluationId, {
      operationId: "customer-success.prior-attempt",
      promptVersion: "cs-m9-prompts-v1",
      attempt,
      provider: "openai",
      model: semanticConfig.model,
      status: "SUCCESS",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      durationMs: 1,
      providerRequestId: `req-prior-${attempt}`,
      errorCode: null,
      errorMessage: null,
    });
  }
  const worker = createEvaluationWorker({
    tasks,
    leaseSeconds: 60,
    processor: createCustomerSuccessEvaluationProcessor({
      evaluations,
      tasks,
      semanticConfig: {
        ...semanticConfig,
        retryLimit: input.retryLimit ?? 1,
        callBudget: input.workerCallBudget ?? semanticConfig.callBudget,
      },
      transport: deterministicTransport(input),
    }),
  });
  const task = await worker.runOnce();
  const response = await service.getLatestEvaluation(opportunity.opportunity.id);
  return { accepted, task, response };
}

describe("production evaluation vertical slice", () => {
  it("runs manual normalized input through API, queue, worker, all stages, recommendation, and persistence", async () => {
    const { accepted, task, response } = await runFlow({});
    expect(accepted.status).toBe("PENDING");
    expect(task?.status).toBe("COMPLETED");
    expect(response.status).toBe("COMPLETED");
    expect(response.stages).toHaveLength(9);
    expect(response.stages.every((stage) => stage.status === "COMPLETED")).toBe(
      true,
    );
    expect(response.recommendation?.decision).toBe("APPLY");
    expect(response.result).toMatchObject({
      recommendation: { recommendation: "APPLY" },
      ghostJobRisk: {
        evaluated: true,
        risk: { classification: "UNKNOWN" },
      },
    });
    expect(response.evidence.length).toBeGreaterThan(0);
    expect(
      response.evidence.every((record) => record.referenceId.length > 0),
    ).toBe(true);
    const persistedReferences = new Set(
      response.evidence.map((record) => record.referenceId),
    );
    expect(
      response.recommendation?.evidenceReferences.every((reference) =>
        persistedReferences.has(reference),
      ),
    ).toBe(true);
    expect(response.operations.length).toBeGreaterThan(0);
    expect(response.operations.every((operation) => operation.model === "gpt-5.6-terra")).toBe(true);
    expect(response.versions.userProfile).toBe(7);
    expect(JSON.stringify(response)).not.toContain("deterministic-test-key");
    expect(JSON.stringify(response)).not.toContain("overallScore");
  });

  it.each([
    {
      name: "materially ambiguous required gap",
      resumeMatch: {
        requirementClassifications: ["GENUINE_GAP", "STRONG_MATCH"],
        matchedExperienceSpecificities: ["UNSUPPORTED", "DIRECT_CUSTOMER_SUCCESS"],
        decisionImpacts: ["MATERIAL_UNCERTAINTY", "NON_DECISIVE"],
      } satisfies ResumeMatchFixtureOptions,
      impact: "MATERIAL_UNCERTAINTY",
      expected: "REVIEW",
    },
    {
      name: "decisive required gap",
      resumeMatch: {
        requirementClassifications: ["GENUINE_GAP", "STRONG_MATCH"],
        matchedExperienceSpecificities: ["UNSUPPORTED", "DIRECT_CUSTOMER_SUCCESS"],
        decisionImpacts: ["DECISIVE_DISQUALIFIER", "NON_DECISIVE"],
      } satisfies ResumeMatchFixtureOptions,
      impact: "DECISIVE_DISQUALIFIER",
      expected: "SKIP",
    },
    {
      name: "non-decisive required gap",
      resumeMatch: {
        requirementClassifications: ["GENUINE_GAP", "STRONG_MATCH"],
        matchedExperienceSpecificities: ["UNSUPPORTED", "DIRECT_CUSTOMER_SUCCESS"],
        decisionImpacts: ["NON_DECISIVE", "NON_DECISIVE"],
      } satisfies ResumeMatchFixtureOptions,
      impact: "NON_DECISIVE",
      expected: "APPLY",
    },
    {
      name: "contradicted would-be decisive gap",
      resumeMatch: {
        requirementClassifications: ["GENUINE_GAP", "STRONG_MATCH"],
        matchedExperienceSpecificities: ["UNSUPPORTED", "DIRECT_CUSTOMER_SUCCESS"],
        decisionImpacts: ["DECISIVE_DISQUALIFIER", "NON_DECISIVE"],
        contradiction: "INFLATED_YEARS",
      } satisfies ResumeMatchFixtureOptions,
      impact: "DECISIVE_DISQUALIFIER",
      expected: "REVIEW",
    },
  ])("persists a $name recommendation as $expected", async ({ resumeMatch, impact, expected }) => {
    const { response } = await runFlow({ resumeMatch });
    expect(response.status).toBe("COMPLETED");
    expect(response.recommendation?.decision).toBe(expected);
    const result = response.result as {
      resumeMatch: {
        match: {
          requirementAssessments: Array<{ decisionImpact: string }>;
        };
      };
    };
    expect(
      result.resumeMatch.match.requirementAssessments[0]?.decisionImpact,
    ).toBe(impact);
  });

  it("preserves deterministic hard-filter precedence", async () => {
    const { response } = await runFlow({ salary: "$50,000 per year" });
    expect(response.status).toBe("COMPLETED");
    expect(response.recommendation?.decision).toBe("SKIP");
    expect(response.result).toMatchObject({
      hardFilters: { overall: "FAIL" },
    });
  });

  it("retries an invalid provider response and records both attempts", async () => {
    const { response } = await runFlow({
      invalidOnceAt: "customer-success.job-evaluation",
    });
    expect(response.status).toBe("COMPLETED");
    expect(
      response.operations
        .filter((operation) => operation.operationId === "customer-success.job-evaluation")
        .map((operation) => operation.status),
    ).toEqual(["VALIDATION_FAILURE", "SUCCESS"]);
  });

  it("enforces the persisted evaluation budget across a resumed worker attempt", async () => {
    let providerCalls = 0;
    const { task, response } = await runFlow({
      requestCallBudget: 1,
      workerCallBudget: 5,
      persistedAttempts: 1,
      onCall: () => { providerCalls += 1; },
    });

    expect(task?.status).toBe("FAILED");
    expect(task?.errorCode).toBe("SEMANTIC_CALL_BUDGET_EXHAUSTED");
    expect(response.status).toBe("FAILED");
    expect(providerCalls).toBe(0);
    expect(response.operations).toHaveLength(1);
  });

  it("records terminal invalid-output failure without corrupting earlier valid stages", async () => {
    const { task, response } = await runFlow({
      alwaysInvalidAt: "customer-success.job-evaluation",
      retryLimit: 0,
    });
    expect(task?.status).toBe("FAILED");
    expect(response.status).toBe("FAILED");
    expect(response.stages.find((stage) => stage.stageId === "hard-filters")?.status).toBe("COMPLETED");
    expect(response.stages.find((stage) => stage.stageId === "job-evaluation")?.status).toBe("FAILED");
    expect(response.result).toBeNull();
    expect(response.recommendation).toBeNull();
  });

  it("creates a new historical evaluation instead of overwriting a completed run", async () => {
    const { opportunity, profile } = await createProductionSubject();
    const evaluations = new PrismaEvaluationRepository();
    const tasks = new PrismaEvaluationTaskRepository();
    const service = createEvaluationService({
      queries: new PrismaEvaluationQueryRepository(),
      evaluations,
      tasks,
      semanticConfig,
      jobMaxAttempts: 2,
    });
    const first = await service.requestEvaluation(opportunity.opportunity.id, { userProfileId: profile.id });
    const second = await service.requestEvaluation(opportunity.opportunity.id, { userProfileId: profile.id });
    expect(second.evaluationId).not.toBe(first.evaluationId);
    expect(await database.evaluation.count({ where: { opportunityId: opportunity.opportunity.id } })).toBe(2);
  });
});
