import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
  toOrganizationalMaturityProviderTransport,
  toAlexFitProviderTransport,
  toOpportunityPriorityProviderTransport,
  toResumeMatchProviderTransport,
  type ResumeMatchFixtureOptions,
} from "../fixtures/customer-success";
import type {
  SemanticReconstruction,
  SemanticAlexFit,
  SemanticOrganizationalMaturity,
  SemanticResumeMatch,
  SemanticOpportunityPriority,
} from "@ai-career/customer-success";
import { customerSuccessSemanticOperationIds } from "@ai-career/customer-success";
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
  defineSemanticExecutionPolicy,
  type SemanticExecutionPolicy,
  type SemanticPricingConfiguration,
  type SemanticProviderTransport,
} from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  testLunaSemanticPricing,
  testSemanticPricing,
} from "../fixtures/semantic-pricing";

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
  await database.aiModelPricingConfiguration.deleteMany({
    where: {
      version: {
        in: [testSemanticPricing.version, testLunaSemanticPricing.version],
      },
      semanticOperations: { none: {} },
    },
  });
  await database.$disconnect();
});

const semanticConfig = {
  apiKey: "deterministic-test-key",
  model: "gpt-5.6-terra",
  maxOutputTokens: 12_000,
  retryLimit: 1,
  callBudget: 16,
  timeoutMs: 30_000,
  pricing: testSemanticPricing,
};

const productionSemanticPricing = {
  ...testSemanticPricing,
  version: "openai-gpt-5.6-terra-standard-2026-07-30",
};

function deterministicTransport(input: {
  resumeMatch?: ResumeMatchFixtureOptions;
  invalidOnceAt?: string;
  alwaysInvalidAt?: string;
  onCall?: () => void;
  onOperationCall?: (operationId: string) => void;
  onRequest?: (operationId: string, model: string) => void;
  transformOutput?: (operationId: string, output: unknown) => unknown;
} = {}): SemanticProviderTransport {
  const fixture = createCustomerSuccessFixtureOperations({
    scenario: "strong",
    resumeMatch: input.resumeMatch,
  });
  const calls = new Map<string, number>();
  return {
    async execute(request) {
      input.onCall?.();
      input.onOperationCall?.(request.operationId);
      input.onRequest?.(request.operationId, request.model);
      const call = (calls.get(request.operationId) ?? 0) + 1;
      calls.set(request.operationId, call);
      if (
        input.alwaysInvalidAt === request.operationId ||
        (input.invalidOnceAt === request.operationId && call === 1)
      ) {
        return {
          outputText: "{}",
          providerRequestId: `req-${request.operationId}-${call}`,
          usage: {
            inputTokens: 5,
            outputTokens: 1,
            cachedInputTokens: null,
            reasoningTokens: null,
            totalTokens: 6,
          },
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
        case "customer-success.jd-reconstruction": {
          const reconstruction =
            await fixture.semanticOperations.reconstructJobDescription({
              ...(trusted as never),
              untrustedJobDescription: payload.untrustedSourceContent!,
            });
          output = {
            ...reconstruction,
            responsibilityMap: {
              areas: Object.entries(reconstruction.responsibilityMap.areas).map(
                ([area, assessment]) =>
                  assessment.prominence === "ABSENT"
                    ? {
                        area,
                        ...assessment,
                        absenceBasis: "EXPLICIT_EXCLUSION" as const,
                      }
                    : { area, ...assessment },
              ),
              other: reconstruction.responsibilityMap.other,
            },
            requirements: reconstruction.requirements.map((requirement) => {
              if (requirement.evidenceReferences.length !== 1) {
                throw new Error(
                  "JD reconstruction fixture requirements must have one atomic evidence reference",
                );
              }
              return {
                ...requirement,
                evidenceReferences: [requirement.evidenceReferences[0]!],
                assessmentUnit: "INDEPENDENT_QUALIFICATION" as const,
                compoundExplanation: null,
              };
            }),
            ownershipMap: {
              functions: Object.entries(
                reconstruction.ownershipMap.functions,
              ).map(([functionName, assessment]) => ({
                function: functionName,
                ...assessment,
              })),
            },
            evidence: reconstruction.evidence.map((evidence) => ({
              sourceIndex: 0,
              referenceId: evidence.referenceId,
              claim: evidence.claim,
              sourceField: evidence.sourceField,
              sourceText: evidence.sourceText,
              evidenceType: evidence.evidenceType,
              origin: evidence.origin,
              evidenceLevel: evidence.evidenceLevel,
            })),
          };
          break;
        }
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
          output = toOrganizationalMaturityProviderTransport(
            (await fixture.semanticOperations.evaluateOrganizationalMaturity(
              trusted as never,
            )) as SemanticOrganizationalMaturity,
            trusted.crossFunctionalRelationshipCatalog as Parameters<typeof toOrganizationalMaturityProviderTransport>[1],
          );
          break;
        case "customer-success.alex-fit":
          output = toAlexFitProviderTransport(await fixture.semanticOperations.evaluateAlexFit({
            ...trusted,
            availableEvidence: trusted.availableEvidenceCatalog,
            preferences: payload.userConfiguration,
          } as never) as SemanticAlexFit, trusted.availableEvidenceCatalog as Parameters<typeof toAlexFitProviderTransport>[1]);
          break;
        case "customer-success.burnout-risk":
          output = await fixture.semanticOperations.evaluateBurnoutRisk({
            ...trusted,
            preferences: payload.userConfiguration,
          } as never);
          break;
        case "customer-success.resume-match":
          {
            const providerRequirements = trusted.requirementMap as Array<
              SemanticReconstruction["requirements"][number] & {
                requirementIndex: number;
              }
            >;
            const jdEvidenceCatalog = trusted.jdEvidenceCatalog as Array<{
              evidenceReference: string;
              evidenceType: string;
              statement: string;
              sourceType: string;
            }>;
            const profileEvidenceCatalog =
              trusted.profileEvidenceCatalog as Array<{
                evidenceReference: string;
                evidenceType: string;
                statement: string;
              }>;
            const providerEvidence = [
              ...jdEvidenceCatalog.map((evidence) => ({
                referenceId: evidence.evidenceReference,
                sourceType: evidence.sourceType,
                evidenceType: evidence.evidenceType,
                claim: evidence.statement,
              })),
              ...profileEvidenceCatalog.map((evidence) => ({
                referenceId: evidence.evidenceReference,
                sourceType: "USER_PROFILE",
                evidenceType: evidence.evidenceType,
                claim: evidence.statement,
              })),
            ];
            const domain = await fixture.semanticOperations.evaluateResumeMatch({
              ...trusted,
              requirementMap: providerRequirements.map(
                ({ requirementIndex: _requirementIndex, ...requirement }) =>
                  requirement,
              ),
              userProfile: { version: 1 },
              availableEvidence: providerEvidence,
              preferences: payload.userConfiguration,
            } as never);
            output = toResumeMatchProviderTransport(
              domain as SemanticResumeMatch,
              providerRequirements,
              providerEvidence,
            );
          }
          break;
        case "customer-success.opportunity-priority":
          {
            const availableEvidenceCatalog =
              trusted.availableEvidenceCatalog as Array<{
                evidenceIndex: number;
                referenceId: string;
                sourceType: string;
              }>;
            const availableEvidence = availableEvidenceCatalog.map(
              ({ evidenceIndex: _evidenceIndex, ...evidence }) => evidence,
            );
            const domain =
              await fixture.semanticOperations.evaluateOpportunityPriority({
                ...trusted,
                availableEvidence,
              } as never);
            output = toOpportunityPriorityProviderTransport(
              domain as SemanticOpportunityPriority,
              availableEvidenceCatalog,
            );
          }
          break;
        case "customer-success.ghost-job-risk":
          {
            const risk = (await fixture.semanticOperations.evaluateGhostJobRisk(
              trusted as never,
            )) as import("@ai-career/customer-success").SemanticGhostJobRisk;
            output = {
              risk: {
                classification: risk.classification,
                assessment: risk.assessment,
                interpretation: risk.interpretation,
                evidenceReferences: risk.evidenceReferences,
              },
              unknowns: risk.unknowns,
              contradictions: risk.contradictions,
            };
          }
          break;
        default:
          throw new Error(`Unexpected semantic operation: ${request.operationId}`);
      }
      const transformedOutput = input.transformOutput?.(
        request.operationId,
        output,
      ) ?? output;
      return {
        outputText: JSON.stringify(transformedOutput),
        providerRequestId: `req-${request.operationId}-${call}`,
        usage: {
          inputTokens: 50,
          outputTokens: 25,
          cachedInputTokens: 10,
          reasoningTokens: 5,
          totalTokens: 75,
        },
      };
    },
  };
}

async function createProductionSubject(input: {
  salary?: string;
  sparseNormalizedFields?: boolean;
  rawText?: string;
  postingHistory?: Array<{
    type: "ACTIVE_ATS" | "CURRENT_POSTING";
    description: string;
    occurredAt: string | null;
  }>;
} = {}) {
  const salary = input.salary ?? "$70,000 per year";
  const rawText =
    input.rawText ??
    [
      "Customer Success Manager at a SaaS workflow platform.",
      "This is a remote role and candidates must reside in the United States.",
      `Salary: ${salary}.`,
      "Zero travel.",
      "Own onboarding, adoption, retention, and strategic customer relationships.",
      "Collaborate with Product and Support while retaining Customer Success ownership.",
      "3+ years of Customer Success experience required.",
      "Salesforce experience preferred.",
    ].join("\n");
  const opportunity = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    ...(input.sparseNormalizedFields
      ? {}
      : {
          sourceUrl: "https://example.test/jobs/production-flow",
          applicationUrl: "https://example.test/jobs/production-flow/apply",
          title: "Customer Success Manager",
          company: "Example SaaS",
          location: "Remote - United States",
          compensationText: salary,
          postingDate: "2026-08-15",
        }),
    domain: "customer-success",
    rawText,
  });
  opportunityIds.push(opportunity.opportunity.id);
  if (input.postingHistory) {
    await database.sourceRecord.updateMany({
      where: { opportunityId: opportunity.opportunity.id },
      data: {
        rawPayload: {
          rawText,
          postingHistory: input.postingHistory,
        },
      },
    });
  }
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
  sparseNormalizedFields?: boolean;
  resolveLatestProfile?: boolean;
  pricing?: SemanticPricingConfiguration;
  executionPolicy?: SemanticExecutionPolicy;
  pricingConfigurations?: readonly SemanticPricingConfiguration[];
  onCall?: () => void;
  onOperationCall?: (operationId: string) => void;
  onRequest?: (operationId: string, model: string) => void;
  transformOutput?: (operationId: string, output: unknown) => unknown;
  rawText?: string;
  postingHistory?: Array<{
    type: "ACTIVE_ATS" | "CURRENT_POSTING";
    description: string;
    occurredAt: string | null;
  }>;
}) {
  const { opportunity, profile } = await createProductionSubject({
    salary: input.salary,
    sparseNormalizedFields: input.sparseNormalizedFields,
    rawText: input.rawText,
    postingHistory: input.postingHistory,
  });
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
      pricing: input.pricing ?? semanticConfig.pricing,
      executionPolicy: input.executionPolicy,
      pricingConfigurations: input.pricingConfigurations,
    },
    jobMaxAttempts: 2,
  });
  const accepted = await service.requestEvaluation(
    opportunity.opportunity.id,
    input.resolveLatestProfile ? {} : { userProfileId: profile.id },
  );
  for (let attempt = 1; attempt <= (input.persistedAttempts ?? 0); attempt += 1) {
    await tasks.recordSemanticOperation(accepted.evaluationId, {
      operationId: "customer-success.prior-attempt",
      promptVersion: "cs-m9-prompts-v1",
      attempt,
      provider: "openai",
      model: semanticConfig.model,
      status: "SUCCESS",
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 2 },
      estimatedCost: 0.000014,
      pricingConfiguration: testSemanticPricing,
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
        pricing: input.pricing ?? semanticConfig.pricing,
        executionPolicy: input.executionPolicy,
        pricingConfigurations: input.pricingConfigurations,
      },
      transport: deterministicTransport(input),
    }),
  });
  const task = await worker.runOnce();
  const response = await service.getLatestEvaluation(opportunity.opportunity.id);
  return { accepted, task, response, opportunity };
}

describe("production evaluation vertical slice", () => {
  it("runs the database-backed fake provider through all nine semantic operations", async () => {
    const { task, response } = await runFlow({
      postingHistory: [
        {
          type: "ACTIVE_ATS",
          description: "The authoritative source reports an active posting.",
          occurredAt: "2026-08-24T12:00:00.000Z",
        },
      ],
    });

    expect(task?.status).toBe("COMPLETED");
    expect(response.stages.every((stage) => stage.status === "COMPLETED")).toBe(
      true,
    );
    expect(response.operations.map((attempt) => attempt.operationId)).toEqual([
      "customer-success.jd-reconstruction",
      "customer-success.job-evaluation",
      "customer-success.company-alignment",
      "customer-success.organizational-maturity",
      "customer-success.alex-fit",
      "customer-success.burnout-risk",
      "customer-success.resume-match",
      "customer-success.opportunity-priority",
      "customer-success.ghost-job-risk",
    ]);
  });

  it("runs a mixed-model fake-provider evaluation without changing result contracts", async () => {
    const selectedModels = new Map<string, string>();
    const executionPolicy = defineSemanticExecutionPolicy({
      version: "test-customer-success-mixed-model-policy-v1",
      operations: Object.fromEntries(
        customerSuccessSemanticOperationIds.map((operationId) => {
          const luna = operationId === "customer-success.resume-match";
          return [
            operationId,
            {
              provider: "openai",
              model: luna ? testLunaSemanticPricing.model : testSemanticPricing.model,
              pricingVersion: luna
                ? testLunaSemanticPricing.version
                : testSemanticPricing.version,
              reasoningEffort: "medium",
              maximumOutputTokens: 12_000,
              timeoutMs: 30_000,
              semanticRetryLimit: 1,
            },
          ];
        }),
      ),
    });
    const { task, response } = await runFlow({
      executionPolicy,
      pricingConfigurations: [testSemanticPricing, testLunaSemanticPricing],
      postingHistory: [
        {
          type: "ACTIVE_ATS",
          description: "The authoritative source reports an active posting.",
          occurredAt: "2026-08-24T12:00:00.000Z",
        },
      ],
      onRequest(operationId, model) {
        selectedModels.set(operationId, model);
      },
    });

    expect(task?.status).toBe("COMPLETED");
    expect(response.stages).toHaveLength(9);
    expect(response.stages.every((stage) => stage.status === "COMPLETED")).toBe(
      true,
    );
    expect(selectedModels.get("customer-success.resume-match")).toBe(
      "gpt-5.6-luna",
    );
    expect(
      [...selectedModels.entries()]
        .filter(([operationId]) => operationId !== "customer-success.resume-match")
        .every(([, model]) => model === "gpt-5.6-terra"),
    ).toBe(true);
    expect(
      response.operations.find(
        (attempt) => attempt.operationId === "customer-success.resume-match",
      ),
    ).toMatchObject({
      model: "gpt-5.6-luna",
      pricingConfigurationVersion: testLunaSemanticPricing.version,
    });
    expect(response.result).not.toBeNull();
    expect(response.recommendation?.decision).toBe("APPLY");
  });

  it("does not repeat a paid stage call for an input-dependent contract mismatch", async () => {
    const calls = new Map<string, number>();
    const { task, response } = await runFlow({
      onOperationCall(operationId) {
        calls.set(operationId, (calls.get(operationId) ?? 0) + 1);
      },
      transformOutput(operationId, output) {
        if (operationId !== "customer-success.organizational-maturity") {
          return output;
        }
        return {
          ...(output as Record<string, unknown>),
          scoreEvidenceReferences: ["unavailable-evidence"],
        };
      },
    });

    expect(calls.get("customer-success.organizational-maturity")).toBe(1);
    expect(task).toMatchObject({
      status: "FAILED",
      attempt: 1,
      errorCode: "ORGANIZATIONAL_MATURITY_EVIDENCE_INVALID",
    });
    expect(response.stages[3]).toMatchObject({
      stageId: "organizational-maturity",
      status: "FAILED",
      retryable: false,
      failureCode: "ORGANIZATIONAL_MATURITY_EVIDENCE_INVALID",
    });
    expect(
      response.operations.filter(
        (attempt) =>
          attempt.operationId ===
          "customer-success.organizational-maturity",
      ),
    ).toHaveLength(1);
    expect(response.operations.at(-1)).toMatchObject({
      operationId: "customer-success.organizational-maturity",
      status: "SUCCESS",
    });
  });

  it("does not retry or switch models for an invalid Opportunity Priority evidence index", async () => {
    const calls = new Map<string, number>();
    const selectedModels = new Map<string, string[]>();
    const { task, response } = await runFlow({
      onOperationCall(operationId) {
        calls.set(operationId, (calls.get(operationId) ?? 0) + 1);
      },
      onRequest(operationId, model) {
        selectedModels.set(operationId, [
          ...(selectedModels.get(operationId) ?? []),
          model,
        ]);
      },
      transformOutput(operationId, output) {
        if (operationId !== "customer-success.opportunity-priority") {
          return output;
        }
        return {
          ...(output as Record<string, unknown>),
          scoreEvidenceIndexes: [999_999],
        };
      },
    });

    expect(calls.get("customer-success.opportunity-priority")).toBe(1);
    expect(selectedModels.get("customer-success.opportunity-priority")).toEqual([
      "gpt-5.6-terra",
    ]);
    expect(task).toMatchObject({
      status: "FAILED",
      attempt: 1,
      errorCode: "OPPORTUNITY_PRIORITY_EVIDENCE_INVALID",
    });
    expect(response.stages[7]).toMatchObject({
      stageId: "opportunity-priority",
      status: "FAILED",
      retryable: false,
      failureCode: "OPPORTUNITY_PRIORITY_EVIDENCE_INVALID",
    });
    expect(
      response.operations.filter(
        (attempt) =>
          attempt.operationId === "customer-success.opportunity-priority",
      ),
    ).toHaveLength(1);
  });

  it("persists a semantic attempt for a sparse manual opportunity with production pricing", async () => {
    const { opportunity, profile } = await createProductionSubject({
      sparseNormalizedFields: true,
    });
    const tasks = new PrismaEvaluationTaskRepository();
    const service = createEvaluationService({
      queries: new PrismaEvaluationQueryRepository(),
      evaluations: new PrismaEvaluationRepository(),
      tasks,
      semanticConfig: {
        ...semanticConfig,
        pricing: productionSemanticPricing,
      },
      jobMaxAttempts: 2,
    });
    const accepted = await service.requestEvaluation(opportunity.opportunity.id, {
      userProfileId: profile.id,
    });

    await tasks.recordSemanticOperation(accepted.evaluationId, {
      operationId: "customer-success.jd-reconstruction",
      promptVersion: "cs-m9-prompts-v1",
      attempt: 1,
      provider: "openai",
      model: "gpt-5.6-terra",
      status: "SUCCESS",
      usage: {
        inputTokens: 1_000,
        outputTokens: 200,
        cachedInputTokens: 100,
        reasoningTokens: 50,
        totalTokens: 1_200,
      },
      estimatedCost: 0.00422,
      pricingConfiguration: productionSemanticPricing,
      durationMs: 100,
      providerRequestId: null,
      errorCode: null,
      errorMessage: null,
    });
    await tasks.recordSemanticOperation(accepted.evaluationId, {
      operationId: "customer-success.jd-reconstruction",
      promptVersion: "cs-m9-prompts-v1",
      attempt: 2,
      provider: "openai",
      model: "gpt-5.6-terra",
      status: "VALIDATION_FAILURE",
      usage: {
        inputTokens: 500,
        outputTokens: 50,
        cachedInputTokens: null,
        reasoningTokens: null,
        totalTokens: 550,
      },
      estimatedCost: null,
      pricingConfiguration: productionSemanticPricing,
      durationMs: 75,
      providerRequestId: null,
      errorCode: "STRUCTURED_OUTPUT_INVALID",
      errorMessage: "Structured output validation failed (issues: $.field:invalid_type)",
    });

    const attempts = await tasks.listSemanticOperations(accepted.evaluationId);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attempt: 1,
      status: "SUCCESS",
      opportunityId: opportunity.opportunity.id,
      domain: "customer-success",
      jobSource: "manual-input",
      inputTokens: 1_000,
      cachedInputTokens: 100,
      reasoningTokens: 50,
      outputTokens: 200,
      totalTokens: 1_200,
      estimatedCost: 0.00422,
      pricingConfigurationVersion: productionSemanticPricing.version,
    });
    expect(attempts[0]?.sourceRecordId).not.toBeNull();
    expect(attempts[1]).toMatchObject({
      attempt: 2,
      status: "VALIDATION_FAILURE",
      inputTokens: 500,
      cachedInputTokens: null,
      reasoningTokens: null,
      outputTokens: 50,
      totalTokens: 550,
      estimatedCost: null,
      pricingConfigurationVersion: productionSemanticPricing.version,
    });
  });

  it("persists accounting for a production-shaped sparse manual opportunity", async () => {
    const { task, response, opportunity } = await runFlow({
      sparseNormalizedFields: true,
      resolveLatestProfile: true,
      pricing: productionSemanticPricing,
    });

    const persistedOpportunity = await database.opportunity.findUniqueOrThrow({
      where: { id: opportunity.opportunity.id },
      select: {
        title: true,
        companyId: true,
        location: true,
        salaryText: true,
        jobDescription: true,
        sourceRecords: {
          select: { id: true, source: true, rawDescription: true },
        },
      },
    });
    expect(persistedOpportunity).toMatchObject({
      title: null,
      companyId: null,
      location: null,
      salaryText: null,
    });
    expect(persistedOpportunity.jobDescription).not.toBeNull();
    expect(persistedOpportunity.sourceRecords).toHaveLength(1);
    expect(persistedOpportunity.sourceRecords[0]).toMatchObject({
      source: "manual-input",
    });
    expect(persistedOpportunity.sourceRecords[0]?.rawDescription).not.toBeNull();

    expect(task?.status).toBe("COMPLETED");
    expect(response.status).toBe("COMPLETED");
    expect(response.stages).toHaveLength(9);
    expect(response.stages.every((stage) => stage.status === "COMPLETED")).toBe(
      true,
    );
    expect(response.versions.userProfile).toBe(7);
    expect(response.recommendation?.decision).toBe("APPLY");
    expect(response.operations.map((operation) => operation.operationId)).toEqual(
      [
        "customer-success.jd-reconstruction",
        "customer-success.job-evaluation",
        "customer-success.company-alignment",
        "customer-success.organizational-maturity",
        "customer-success.alex-fit",
        "customer-success.burnout-risk",
        "customer-success.resume-match",
        "customer-success.opportunity-priority",
      ],
    );
    expect(
      response.operations.every(
        (operation) =>
          operation.opportunityId === opportunity.opportunity.id &&
          operation.domain === "customer-success" &&
          operation.sourceRecordId ===
            persistedOpportunity.sourceRecords[0]?.id &&
          operation.jobSource === "manual-input" &&
          operation.cachedInputTokens === 10 &&
          operation.reasoningTokens === 5 &&
          operation.estimatedCost !== null &&
          operation.pricingConfigurationVersion ===
            productionSemanticPricing.version,
      ),
    ).toBe(true);
    expect(response.usage).toMatchObject({
      attemptCount: 8,
      inputTokens: 400,
      outputTokens: 200,
      cachedInputTokens: 80,
      reasoningTokens: 40,
      totalTokens: 600,
      pricingConfigurationVersions: [productionSemanticPricing.version],
      currency: "USD",
    });
    expect(response.usage.estimatedCost).not.toBeNull();
    expect(response.result).not.toBeNull();
  });

  it("persists a sanitized pricing-mismatch category without database details", async () => {
    const { task, response } = await runFlow({
      sparseNormalizedFields: true,
      pricing: {
        ...productionSemanticPricing,
        effectiveFrom: new Date("2026-07-31T00:00:00.000Z"),
      },
    });

    expect(task).toMatchObject({
      status: "FAILED",
      errorCode:
        "OPERATION_METADATA_PERSISTENCE_PRICING_CONFIGURATION_MISMATCH",
      errorMessage:
        "Semantic operation metadata could not be persisted (PRICING_CONFIGURATION_MISMATCH)",
    });
    expect(response.stages[0]).toMatchObject({
      stageId: "hard-filters",
      status: "FAILED",
      failureCode:
        "OPERATION_METADATA_PERSISTENCE_PRICING_CONFIGURATION_MISMATCH",
    });
    expect(JSON.stringify({ task, response })).not.toMatch(
      /SELECT|INSERT|DATABASE_URL|postgresql:\/\//i,
    );
  });

  it("runs manual normalized input through API, queue, worker, all stages, recommendation, and persistence", async () => {
    const { accepted, task, response, opportunity } = await runFlow({});
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
    expect(
      response.operations.every(
        (operation) =>
          operation.opportunityId === opportunity.opportunity.id &&
          operation.domain === "customer-success" &&
          operation.sourceRecordId !== null &&
          operation.jobSource !== null &&
          operation.cachedInputTokens === 10 &&
          operation.reasoningTokens === 5 &&
          operation.estimatedCost !== null &&
          operation.pricingConfigurationVersion === testSemanticPricing.version &&
          operation.pricingCurrency === "USD",
      ),
    ).toBe(true);
    expect(response.usage).toMatchObject({
      attemptCount: response.operations.length,
      pricingConfigurationVersions: [testSemanticPricing.version],
      currency: "USD",
    });
    expect(response.usage.totalTokens).toBe(
      response.operations.reduce(
        (total, operation) => total + operation.totalTokens!,
        0,
      ),
    );
    expect(response.usage.inputTokens).toBe(
      response.operations.reduce(
        (total, operation) => total + operation.inputTokens!,
        0,
      ),
    );
    expect(response.usage.outputTokens).toBe(
      response.operations.reduce(
        (total, operation) => total + operation.outputTokens!,
        0,
      ),
    );
    expect(response.usage.cachedInputTokens).toBe(
      response.operations.reduce(
        (total, operation) => total + operation.cachedInputTokens!,
        0,
      ),
    );
    expect(response.usage.reasoningTokens).toBe(
      response.operations.reduce(
        (total, operation) => total + operation.reasoningTokens!,
        0,
      ),
    );
    expect(response.usage.estimatedCost).toBeCloseTo(
      response.operations.reduce(
        (total, operation) => total + operation.estimatedCost!,
        0,
      ),
      12,
    );
    expect(
      await database.aiModelPricingConfiguration.count({
        where: {
          provider: "openai",
          model: "gpt-5.6-terra",
          version: testSemanticPricing.version,
        },
      }),
    ).toBe(1);
    expect(response.versions.userProfile).toBe(7);
    expect(JSON.stringify(response)).not.toContain("deterministic-test-key");
    expect(JSON.stringify(response)).not.toContain("overallScore");
  });

  it("persists a mixed deterministic-ambiguous and semantic Resume Match without changing the API shape", async () => {
    const salary = "$70,000 per year";
    const { task, response } = await runFlow({
      rawText: [
        "Customer Success Manager at a SaaS workflow platform.",
        "This is a remote role and candidates must reside in the United States.",
        `Salary: ${salary}.`,
        "Zero travel.",
        "Own onboarding, adoption, retention, and strategic customer relationships.",
        "3 years of experience.",
        "Customer Success experience required.",
      ].join("\n"),
    });

    expect(task?.status).toBe("COMPLETED");
    expect(response.status).toBe("COMPLETED");
    const result = response.result as {
      resumeMatch: {
        evaluated: boolean;
        match: {
          requirementAssessments: Array<{
            requirementIndex: number;
            classification: string;
            matchedExperienceSpecificity: string;
            isAmbiguous: boolean;
          }>;
        };
      };
      opportunityPriority: { evaluated: boolean };
      recommendation: { recommendation: string };
    };
    expect(result.resumeMatch.evaluated).toBe(true);
    expect(result.resumeMatch.match.requirementAssessments[0]).toMatchObject({
      requirementIndex: 0,
      classification: "UNKNOWN",
      matchedExperienceSpecificity: "UNKNOWN",
      isAmbiguous: true,
    });
    expect(result.resumeMatch.match.requirementAssessments[1]).toMatchObject({
      requirementIndex: 1,
      isAmbiguous: false,
    });
    expect(result.opportunityPriority.evaluated).toBe(true);
    expect(result.recommendation.recommendation).toMatch(/APPLY|REVIEW|SKIP/);
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
    const retried = response.operations.filter(
      (operation) =>
        operation.operationId === "customer-success.job-evaluation",
    );
    expect(retried.every((operation) => operation.estimatedCost !== null)).toBe(
      false,
    );
    expect(retried[0]).toMatchObject({
      status: "VALIDATION_FAILURE",
      inputTokens: 5,
      outputTokens: 1,
      cachedInputTokens: null,
      reasoningTokens: null,
      totalTokens: 6,
      estimatedCost: null,
      pricingConfigurationVersion: testSemanticPricing.version,
    });
    expect(retried[1]).toMatchObject({
      status: "SUCCESS",
      cachedInputTokens: 10,
      reasoningTokens: 5,
    });
    expect(response.usage.attemptCount).toBe(response.operations.length);
    expect(response.usage.inputTokens).toBe(
      response.operations.reduce(
        (total, operation) => total + operation.inputTokens!,
        0,
      ),
    );
    expect(response.usage.totalTokens).toBe(
      response.operations.reduce(
        (total, operation) => total + operation.totalTokens!,
        0,
      ),
    );
    expect(response.usage.cachedInputTokens).toBeNull();
    expect(response.usage.reasoningTokens).toBeNull();
    expect(response.usage.estimatedCost).toBeNull();
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
    const failedAttempt = response.operations.find(
      (operation) =>
        operation.operationId === "customer-success.job-evaluation" &&
        operation.status === "VALIDATION_FAILURE",
    );
    expect(failedAttempt).toMatchObject({
      inputTokens: 5,
      outputTokens: 1,
      cachedInputTokens: null,
      reasoningTokens: null,
      totalTokens: 6,
      estimatedCost: null,
      pricingConfigurationVersion: testSemanticPricing.version,
    });
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
    const latest = await service.getLatestEvaluation(opportunity.opportunity.id);
    expect(latest.history).toHaveLength(2);
    expect(latest.evaluationId).toBe(second.evaluationId);
    const earlier = await service.getLatestEvaluation(
      opportunity.opportunity.id,
      first.evaluationId,
    );
    expect(earlier.evaluationId).toBe(first.evaluationId);
    expect(earlier.isLatest).toBe(false);
    expect(earlier.history).toHaveLength(2);
  });
});
