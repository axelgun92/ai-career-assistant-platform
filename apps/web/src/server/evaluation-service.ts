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
  AdmissionNotConsumableError,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  type DeferredEvaluationRecord,
} from "@ai-career/database";
import type {
  EvaluationRepository,
  EvaluationTask,
  EvaluationTaskRepository,
  SemanticExecutorConfig,
} from "@ai-career/evaluation";
import { summarizeSemanticUsage } from "@ai-career/evaluation";
import {
  readEvaluationWorkerEnvironment,
} from "@ai-career/shared";
import { z } from "zod";
import { aiConfigurationStatus } from "./ai-configuration";
import { getBudgetService, type EvaluationAdmissionGate } from "./budget-service";
import { EvaluationApiError } from "./evaluation-errors";
import { evaluationQueueState } from "./evaluation-queue-state";
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
    domain?: string | null,
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

export interface AdmittedTaskEnqueuer {
  enqueueAdmitted(
    input: Parameters<EvaluationTaskRepository["enqueue"]>[0] & { admissionId: string },
  ): Promise<EvaluationTask>;
}

export interface EvaluationServiceDependencies {
  queries: EvaluationQueryRepository;
  evaluations: EvaluationRepository;
  tasks: EvaluationTaskRepository & Partial<AdmittedTaskEnqueuer>;
  // Product admission gate: request integrity and the budget decision.
  // Optional so evaluator-level tests can run without a database.
  admissionGate?: EvaluationAdmissionGate;
  // Execution settings are needed only to queue work. Either give them
  // directly, or give a resolver that is called only when requesting or
  // resuming, so reading results never requires AI configuration.
  semanticConfig?: SemanticExecutorConfig;
  jobMaxAttempts?: number;
  resolveExecution?: () => { semanticConfig: SemanticExecutorConfig; jobMaxAttempts: number };
  now?: () => Date;
}

// The public evaluation JSON omits stored error messages and provider request
// IDs; they can hold internal or provider detail. Codes remain.
function publicStage<Stage extends { errorMessage?: unknown }>(stage: Stage) {
  const { errorMessage: _errorMessage, ...rest } = stage;
  return rest;
}

function publicOperation<Operation extends { errorMessage?: unknown; providerRequestId?: unknown }>(
  operation: Operation,
) {
  const { errorMessage: _errorMessage, providerRequestId: _providerRequestId, ...rest } = operation;
  return rest;
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
  const gate = dependencies.admissionGate;
  const now = dependencies.now ?? (() => new Date());

  function execution() {
    if (dependencies.resolveExecution) return dependencies.resolveExecution();
    if (!dependencies.semanticConfig || dependencies.jobMaxAttempts === undefined) {
      throw new Error("Evaluation execution settings are not configured");
    }
    return { semanticConfig: dependencies.semanticConfig, jobMaxAttempts: dependencies.jobMaxAttempts };
  }

  async function loadEvaluableOpportunity(opportunityId: string) {
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
    return opportunity;
  }

  // Server-side duplicate guard: never enqueue a second paid evaluation
  // while one is still queued or running for this opportunity. With the
  // admission gate this is re-checked under its lock, which also closes the
  // check-then-enqueue race.
  async function assertNoActiveEvaluation(opportunityId: string) {
    const [latest] = await dependencies.queries.listEvaluationHistory({ opportunityId });
    const latestTaskStatus = latest?.task?.status ?? latest?.status;
    if (latestTaskStatus === "PENDING" || latestTaskStatus === "RUNNING") {
      throw alreadyActive();
    }
  }

  const alreadyActive = () =>
    new EvaluationApiError(
      "EVALUATION_ALREADY_ACTIVE",
      "An evaluation is already queued or running for this opportunity",
      409,
    );
  const deferralNotOpen = () =>
    new EvaluationApiError(
      "DEFERRAL_NOT_OPEN",
      "This deferred evaluation was already resumed or cancelled",
      409,
    );

  async function admitAndEnqueue(input: {
    opportunityId: string;
    domain: string;
    profile: { id: string; version: number };
    resumeDeferralId?: string;
  }) {
    const { semanticConfig, jobMaxAttempts } = execution();
    const evaluator = createCustomerSuccessEvaluator();
    const enqueueInput = {
      opportunityId: input.opportunityId,
      userProfileId: input.profile.id,
      userProfileVersion: input.profile.version,
      evaluator,
      executionMetadata: {
        provider: "openai",
        model: semanticConfig.model,
        maxOutputTokens: semanticConfig.maxOutputTokens,
        semanticCallBudget: semanticConfig.callBudget,
        pricingConfigurationVersion:
          semanticConfig.pricing.version,
        semanticExecutionPolicyVersion:
          semanticConfig.executionPolicy?.version ?? null,
        semanticOperationExecutionPolicy:
          semanticConfig.executionPolicy?.operations ?? null,
      },
      maxAttempts: jobMaxAttempts,
    };
    const queued = (task: { id: string; evaluationId: string; status: string }) => ({
      outcome: "QUEUED" as const,
      opportunityId: input.opportunityId,
      evaluationId: task.evaluationId,
      taskId: task.id,
      domain: input.domain,
      status: task.status,
    });

    if (!gate) return queued(await dependencies.tasks.enqueue(enqueueInput));
    const enqueueAdmitted = dependencies.tasks.enqueueAdmitted?.bind(dependencies.tasks);
    if (!enqueueAdmitted) {
      throw new Error("The admission gate requires a task repository with enqueueAdmitted");
    }

    const admitted = await gate.admit(input);
    switch (admitted.outcome) {
      case "ACTIVE":
        throw alreadyActive();
      case "DEFERRAL_EXISTS":
        throw new EvaluationApiError(
          "DEFERRED_REQUEST_EXISTS",
          "This opportunity already has a deferred evaluation request; resume or cancel it",
          409,
        );
      case "DEFERRAL_NOT_OPEN":
        throw deferralNotOpen();
      case "DEFERRED":
      case "STILL_DEFERRED":
        return {
          outcome: "DEFERRED" as const,
          opportunityId: input.opportunityId,
          domain: input.domain,
          deferredEvaluationId: admitted.deferral.id,
          reason: "BUDGET_UNAVAILABLE" as const,
          resumed: admitted.outcome === "STILL_DEFERRED",
          userProfileVersion: admitted.deferral.userProfileVersion,
          budget: admitted.budget,
        };
      case "ADMITTED":
        break;
    }
    try {
      return queued(await enqueueAdmitted({ ...enqueueInput, admissionId: admitted.admissionId }));
    } catch (error) {
      // Nothing was created; release the admission (and return a resumed
      // request to the backlog) so the user can simply try again.
      await gate.abandon(admitted.admissionId);
      if (error instanceof AdmissionNotConsumableError) {
        throw new EvaluationApiError(
          "ADMISSION_EXPIRED",
          "The evaluation took too long to start; please try again",
          409,
        );
      }
      throw error;
    }
  }

  async function resumeDeferredRequest(deferral: DeferredEvaluationRecord) {
    await loadEvaluableOpportunity(deferral.opportunityId);
    await assertNoActiveEvaluation(deferral.opportunityId);
    // A deferred request keeps the profile version it was requested with.
    const unavailable = () =>
      new EvaluationApiError(
        "DEFERRED_PROFILE_UNAVAILABLE",
        "The profile version this request was made with no longer exists; cancel it and request a new evaluation",
        422,
      );
    if (!deferral.userProfileId) throw unavailable();
    const subject = await dependencies.evaluations.loadSubject({
      opportunityId: deferral.opportunityId,
      userProfileId: deferral.userProfileId,
    });
    if (!subject?.userProfile) throw unavailable();
    validateCustomerSuccessProfile(subject);
    return admitAndEnqueue({
      opportunityId: deferral.opportunityId,
      domain: deferral.domain,
      profile: {
        id: deferral.userProfileId,
        version: deferral.userProfileVersion ?? subject.userProfile.version,
      },
      resumeDeferralId: deferral.id,
    });
  }

  async function findDeferral(idValue: string) {
    const id = z.uuid().safeParse(idValue);
    const deferral = id.success && gate ? await gate.getDeferral(id.data) : null;
    if (!deferral) {
      throw new EvaluationApiError(
        "DEFERRED_EVALUATION_NOT_FOUND",
        "Deferred evaluation not found",
        404,
      );
    }
    return deferral;
  }

  return {
    async requestEvaluation(opportunityIdValue: string, body: unknown) {
      const opportunityId = z.uuid().parse(opportunityIdValue);
      const request = evaluationRequestSchema.parse(body ?? {});
      // Fail before any write (including a deferral) when AI evaluation is
      // not configured.
      execution();
      const opportunity = await loadEvaluableOpportunity(opportunityId);

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

      await assertNoActiveEvaluation(opportunityId);

      // An open deferred request is resumed rather than duplicated, with the
      // profile version it was originally requested with.
      const open = gate ? await gate.findOpenDeferral(opportunityId) : null;
      if (open) {
        if (request.userProfileId && request.userProfileId !== open.userProfileId) {
          throw new EvaluationApiError(
            "DEFERRED_REQUEST_EXISTS",
            "This opportunity already has a deferred evaluation request with another profile version; resume or cancel it",
            409,
          );
        }
        return resumeDeferredRequest(open);
      }

      const profile = await dependencies.queries.resolveUserProfile(
        request.userProfileId ?? null,
        domain,
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

      return admitAndEnqueue({ opportunityId, domain, profile });
    },

    async resumeDeferred(deferredIdValue: string) {
      const deferral = await findDeferral(deferredIdValue);
      if (deferral.status !== "DEFERRED") throw deferralNotOpen();
      execution();
      return resumeDeferredRequest(deferral);
    },

    async cancelDeferred(deferredIdValue: string) {
      const deferral = await findDeferral(deferredIdValue);
      if (!(await gate!.cancelDeferral(deferral.id))) throw deferralNotOpen();
      return { deferredEvaluationId: deferral.id, status: "CANCELLED" as const };
    },

    async getOpenDeferral(opportunityId: string) {
      return gate ? gate.findOpenDeferral(opportunityId) : null;
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
        queueState: evaluationQueueState(task, now()),
        task: {
          id: task.id,
          status: task.status,
          attempt: task.attempt,
          maxAttempts: task.maxAttempts,
          errorCode: task.errorCode,
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
        stages: evaluation.stageResults.map(publicStage),
        evidence: evaluation.evidenceRecords,
        contradictions: evaluation.contradictions,
        result: evaluation.domainResult,
        recommendation: evaluation.recommendation,
        operations: operations.map(publicOperation),
        usage: summarizeSemanticUsage(operations),
        // The budget held before the run (when a budget was configured), for
        // showing reserved vs actual cost. Usage and cost are unaffected.
        reservation: gate ? await gate.reservationForEvaluation(evaluationId) : null,
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
let executionSettings: { semanticConfig: SemanticExecutorConfig; jobMaxAttempts: number } | undefined;

// Resolved on first request/resume and cached for the process. Reading
// results never needs it. A missing or placeholder key is reported as
// PRODUCTION_CONFIGURATION_MISSING before anything is written.
function resolveProductionExecution() {
  if (executionSettings) return executionSettings;
  const notConfigured = () =>
    new EvaluationApiError(
      "PRODUCTION_CONFIGURATION_MISSING",
      "AI evaluation is not configured. Set OPENAI_API_KEY and the AI settings, then restart the app.",
      503,
    );
  if (aiConfigurationStatus().state !== "configured") throw notConfigured();
  try {
    executionSettings = {
      semanticConfig: semanticExecutorConfigFromEnvironment(),
      jobMaxAttempts: readEvaluationWorkerEnvironment().EVALUATION_JOB_MAX_ATTEMPTS,
    };
  } catch {
    throw notConfigured();
  }
  return executionSettings;
}

export function getEvaluationService(): EvaluationService {
  evaluationService ??= createEvaluationService({
    queries: new PrismaEvaluationQueryRepository(),
    evaluations: new PrismaEvaluationRepository(),
    tasks: new PrismaEvaluationTaskRepository(),
    resolveExecution: resolveProductionExecution,
    admissionGate: getBudgetService().gate,
  });
  return evaluationService;
}
