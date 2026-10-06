import {
  canRequestEvaluation,
  isNormalizedLifecycleState,
  opportunityLifecycleStateSchema,
} from "@ai-career/core";
import {
  createCustomerSuccessEvaluator,
  createCustomerSuccessProfileContext,
  loadCustomerSuccessPreferencesFromProfile,
} from "@ai-career/customer-success";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
} from "@ai-career/database";
import type {
  EvaluationRepository,
  EvaluationTaskRepository,
  SemanticExecutorConfig,
} from "@ai-career/evaluation";
import { summarizeSemanticUsage } from "@ai-career/evaluation";
import {
  readEvaluationWorkerEnvironment,
} from "@ai-career/shared";
import { z } from "zod";
import { EvaluationApiError } from "./evaluation-errors";
import { semanticExecutorConfigFromEnvironment } from "./semantic-execution-config";

const evaluationRequestSchema = z
  .object({
    domain: z.string().trim().min(1).optional(),
    userProfileId: z.uuid().optional(),
  })
  .strict();

interface EvaluationQueryRepository {
  findOpportunityForEvaluation(opportunityId: string): Promise<{
    id: string;
    domain: string | null;
    status: string;
    jobDescription: string | null;
    sourceRecords: Array<{ id: string }>;
  } | null>;
  resolveUserProfile(
    userProfileId: string | null,
  ): Promise<{ id: string; version: number } | null>;
  findLatestEvaluationId(input: {
    opportunityId: string;
    domain?: string | null;
  }): Promise<string | null>;
  listEvaluationHistory(input: {
    opportunityId: string;
    domain?: string | null;
  }): Promise<
    Array<{
      id: string;
      status: string;
      evaluationVersion: string;
      promptVersion: string | null;
      userProfileVersion: number | null;
      createdAt: Date;
      completedAt: Date | null;
      task: { status: string } | null;
      recommendation: { decision: string } | null;
    }>
  >;
}

export interface EvaluationServiceDependencies {
  queries: EvaluationQueryRepository;
  evaluations: EvaluationRepository;
  tasks: EvaluationTaskRepository;
  semanticConfig: SemanticExecutorConfig;
  jobMaxAttempts: number;
}

function validateCustomerSuccessProfile(
  subject: Awaited<ReturnType<EvaluationRepository["loadSubject"]>>,
) {
  if (!subject?.userProfile) {
    throw new EvaluationApiError(
      "USER_PROFILE_NOT_FOUND",
      "A usable versioned user profile is required",
      422,
    );
  }
  try {
    createCustomerSuccessProfileContext(subject.userProfile);
    loadCustomerSuccessPreferencesFromProfile(
      (subject.userProfile.data as { domainPreferences?: unknown })
        .domainPreferences,
    );
  } catch {
    throw new EvaluationApiError(
      "CUSTOMER_SUCCESS_CONFIGURATION_INVALID",
      "The selected profile does not contain valid Customer Success preferences",
      422,
    );
  }
}

export function createEvaluationService(
  dependencies: EvaluationServiceDependencies,
) {
  return {
    async requestEvaluation(opportunityIdValue: string, body: unknown) {
      const opportunityId = z.uuid().parse(opportunityIdValue);
      const request = evaluationRequestSchema.parse(body ?? {});
      const opportunity =
        await dependencies.queries.findOpportunityForEvaluation(opportunityId);
      if (!opportunity) {
        throw new EvaluationApiError(
          "OPPORTUNITY_NOT_FOUND",
          "Opportunity not found",
          404,
        );
      }
      const lifecycle = opportunityLifecycleStateSchema.safeParse(opportunity.status);
      if (!lifecycle.success || !isNormalizedLifecycleState(lifecycle.data)) {
        throw new EvaluationApiError(
          "OPPORTUNITY_NOT_NORMALIZED",
          "Only a normalized opportunity can be evaluated",
          409,
        );
      }
      if (!canRequestEvaluation(lifecycle.data)) {
        throw new EvaluationApiError(
          "OPPORTUNITY_NOT_EVALUABLE",
          "Restore the opportunity before reevaluating it",
          409,
        );
      }
      if (!opportunity.jobDescription && opportunity.sourceRecords.length === 0) {
        throw new EvaluationApiError(
          "NORMALIZED_SOURCE_CONTENT_MISSING",
          "The opportunity has no normalized job description or raw source content",
          422,
        );
      }

      const domain = request.domain ?? opportunity.domain;
      if (domain !== "customer-success") {
        throw new EvaluationApiError(
          "DOMAIN_UNSUPPORTED",
          domain
            ? `The '${domain}' domain is not executable`
            : "An executable opportunity domain is required",
          422,
        );
      }
      if (request.domain && opportunity.domain && request.domain !== opportunity.domain) {
        throw new EvaluationApiError(
          "DOMAIN_MISMATCH",
          "The requested domain does not match the normalized opportunity",
          409,
        );
      }

      const profile = await dependencies.queries.resolveUserProfile(
        request.userProfileId ?? null,
      );
      if (!profile) {
        throw new EvaluationApiError(
          "USER_PROFILE_NOT_FOUND",
          "A usable versioned user profile is required",
          422,
        );
      }
      const subject = await dependencies.evaluations.loadSubject({
        opportunityId,
        userProfileId: profile.id,
      });
      validateCustomerSuccessProfile(subject);

      const evaluator = createCustomerSuccessEvaluator();
      const task = await dependencies.tasks.enqueue({
        opportunityId,
        userProfileId: profile.id,
        userProfileVersion: profile.version,
        evaluator,
        executionMetadata: {
          provider: "openai",
          model: dependencies.semanticConfig.model,
          maxOutputTokens: dependencies.semanticConfig.maxOutputTokens,
          semanticCallBudget: dependencies.semanticConfig.callBudget,
          pricingConfigurationVersion:
            dependencies.semanticConfig.pricing.version,
          semanticExecutionPolicyVersion:
            dependencies.semanticConfig.executionPolicy?.version ?? null,
          semanticOperationExecutionPolicy:
            dependencies.semanticConfig.executionPolicy?.operations ?? null,
        },
        maxAttempts: dependencies.jobMaxAttempts,
      });
      return {
        opportunityId,
        evaluationId: task.evaluationId,
        taskId: task.id,
        domain,
        status: task.status,
      };
    },

    async getLatestEvaluation(
      opportunityIdValue: string,
      requestedEvaluationIdValue?: string | null,
    ) {
      const opportunityId = z.uuid().parse(opportunityIdValue);
      const requestedEvaluationId = requestedEvaluationIdValue
        ? z.uuid().parse(requestedEvaluationIdValue)
        : null;
      const opportunity =
        await dependencies.queries.findOpportunityForEvaluation(opportunityId);
      if (!opportunity) {
        throw new EvaluationApiError(
          "OPPORTUNITY_NOT_FOUND",
          "Opportunity not found",
          404,
        );
      }
      const history = await dependencies.queries.listEvaluationHistory({
        opportunityId,
        domain: opportunity.domain,
      });
      const evaluationId = requestedEvaluationId ?? history[0]?.id ?? null;
      if (!evaluationId) {
        throw new EvaluationApiError(
          "EVALUATION_NOT_FOUND",
          "No evaluation exists for this opportunity",
          404,
        );
      }
      if (!history.some((item) => item.id === evaluationId)) {
        throw new EvaluationApiError(
          "EVALUATION_NOT_FOUND",
          "The requested evaluation does not exist for this opportunity",
          404,
        );
      }
      const [evaluation, task, operations] = await Promise.all([
        dependencies.evaluations.getEvaluationSnapshot(evaluationId),
        dependencies.tasks.getByEvaluationId(evaluationId),
        dependencies.tasks.listSemanticOperations(evaluationId),
      ]);
      if (!evaluation || !task) {
        throw new EvaluationApiError(
          "EVALUATION_STATE_INCOMPLETE",
          "The evaluation state could not be loaded",
          500,
        );
      }
      return {
        opportunityId,
        evaluationId,
        isLatest: history[0]?.id === evaluationId,
        domain: evaluation.domain,
        status: task.status,
        evaluationStatus: evaluation.status,
        task: {
          id: task.id,
          status: task.status,
          attempt: task.attempt,
          maxAttempts: task.maxAttempts,
          errorCode: task.errorCode,
          errorMessage: task.errorMessage,
        },
        versions: {
          evaluation: evaluation.evaluationVersion,
          domain: evaluation.domainVersion,
          rules: evaluation.ruleVersion,
          prompt: evaluation.promptVersion,
          userProfile: evaluation.userProfileVersion,
        },
        startedAt: evaluation.startedAt,
        completedAt: evaluation.completedAt,
        stages: evaluation.stageResults,
        evidence: evaluation.evidenceRecords,
        contradictions: evaluation.contradictions,
        result: evaluation.domainResult,
        recommendation: evaluation.recommendation,
        operations,
        usage: summarizeSemanticUsage(operations),
        error: evaluation.errorMessage,
        history: history.map((item, index) => ({
          evaluationId: item.id,
          isLatest: index === 0,
          status: item.task?.status ?? item.status,
          evaluationStatus: item.status,
          decision: item.recommendation?.decision ?? null,
          evaluationVersion: item.evaluationVersion,
          promptVersion: item.promptVersion,
          userProfileVersion: item.userProfileVersion,
          createdAt: item.createdAt,
          completedAt: item.completedAt,
        })),
      };
    },
  };
}

export type EvaluationService = ReturnType<typeof createEvaluationService>;

let evaluationService: EvaluationService | undefined;

export function getEvaluationService(): EvaluationService {
  if (!evaluationService) {
    let semanticConfig;
    let worker;
    try {
      semanticConfig = semanticExecutorConfigFromEnvironment();
      worker = readEvaluationWorkerEnvironment();
    } catch {
      throw new EvaluationApiError(
        "PRODUCTION_CONFIGURATION_MISSING",
        "Production semantic execution is not configured",
        503,
      );
    }
    evaluationService = createEvaluationService({
      queries: new PrismaEvaluationQueryRepository(),
      evaluations: new PrismaEvaluationRepository(),
      tasks: new PrismaEvaluationTaskRepository(),
      semanticConfig,
      jobMaxAttempts: worker.EVALUATION_JOB_MAX_ATTEMPTS,
    });
  }
  return evaluationService;
}
