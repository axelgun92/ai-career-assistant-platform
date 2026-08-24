import {
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
  createCustomerSuccessProfileContext,
  createProductionCustomerSuccessSemanticOperations,
  hardFiltersDataSchema,
  loadCustomerSuccessPreferencesFromProfile,
} from "@ai-career/customer-success";
import {
  EvaluationWorkerError,
  createEvaluationExecutor,
  createSemanticExecutor,
  type EvaluationTask,
  type EvaluationTaskRepository,
  type EvaluationRepository,
  type SemanticExecutorConfig,
  type SemanticProviderTransport,
} from "@ai-career/evaluation";
import type {
  EvidenceRecordDraft,
  PersistedEvidenceRecord,
} from "@ai-career/evidence";

function asDraftEvidence(
  records: PersistedEvidenceRecord[],
): EvidenceRecordDraft[] {
  return records.map((record) => ({
    referenceId: record.referenceId,
    criterionId: record.criterionId,
    claim: record.claim,
    sourceType: record.sourceType,
    sourceRecordId: record.sourceRecordId,
    provenanceId: record.provenanceId,
    sourceField: record.sourceField,
    sourceReference: record.sourceReference,
    sourceText: record.sourceText,
    evidenceType: record.evidenceType,
    origin: record.origin,
    evidenceLevel: record.evidenceLevel,
    collectedAt: record.collectedAt,
  }));
}

function evaluationCallBudget(
  executionMetadata: Record<string, unknown> | null,
  fallback: number,
) {
  const persisted = executionMetadata?.semanticCallBudget;
  return typeof persisted === "number" && Number.isInteger(persisted) && persisted > 0
    ? persisted
    : fallback;
}

export function createCustomerSuccessEvaluationProcessor(input: {
  evaluations: EvaluationRepository;
  tasks: EvaluationTaskRepository;
  semanticConfig: SemanticExecutorConfig;
  transport?: SemanticProviderTransport;
}) {
  return {
    async process(task: EvaluationTask) {
      const evaluator = createCustomerSuccessEvaluator();
      let snapshot = await input.evaluations.getEvaluationSnapshot(
        task.evaluationId,
      );
      if (!snapshot) {
        throw new EvaluationWorkerError(
          "EVALUATION_NOT_FOUND",
          "The queued evaluation no longer exists",
          false,
        );
      }
      if (snapshot.status === "COMPLETED") return;
      if (snapshot.domain !== evaluator.domain) {
        throw new EvaluationWorkerError(
          "DOMAIN_UNSUPPORTED",
          `The '${snapshot.domain}' domain is not executable by this worker`,
          false,
        );
      }
      const queuedPricingVersion =
        snapshot.executionMetadata?.pricingConfigurationVersion;
      if (
        typeof queuedPricingVersion === "string" &&
        queuedPricingVersion !== input.semanticConfig.pricing.version
      ) {
        throw new EvaluationWorkerError(
          "SEMANTIC_PRICING_CONFIGURATION_MISMATCH",
          "The queued evaluation pricing version does not match the worker configuration",
          false,
        );
      }
      const subject = await input.evaluations.loadSubject({
        opportunityId: snapshot.opportunityId,
        userProfileId: snapshot.userProfileId,
      });
      if (!subject?.userProfile) {
        await input.evaluations.finishEvaluation({
          evaluationId: snapshot.id,
          status: "FAILED",
          errorMessage: "A usable versioned user profile is required",
          domainResult: null,
          recommendation: null,
        });
        throw new EvaluationWorkerError(
          "USER_PROFILE_NOT_FOUND",
          "A usable versioned user profile is required",
          false,
        );
      }

      let profile;
      let preferences;
      try {
        profile = createCustomerSuccessProfileContext(subject.userProfile);
        preferences = loadCustomerSuccessPreferencesFromProfile(
          (subject.userProfile.data as { domainPreferences?: unknown })
            .domainPreferences,
        );
      } catch {
        await input.evaluations.finishEvaluation({
          evaluationId: snapshot.id,
          status: "FAILED",
          errorMessage: "The Customer Success profile configuration is invalid",
          domainResult: null,
          recommendation: null,
        });
        throw new EvaluationWorkerError(
          "CUSTOMER_SUCCESS_CONFIGURATION_INVALID",
          "The Customer Success profile configuration is invalid",
          false,
        );
      }

      const priorSemanticAttempts = await input.tasks.listSemanticOperations(
        snapshot.id,
      );
      const semanticExecutor = createSemanticExecutor({
        config: {
          ...input.semanticConfig,
          callBudget: evaluationCallBudget(
            snapshot.executionMetadata,
            input.semanticConfig.callBudget,
          ),
        },
        initialCallsUsed: priorSemanticAttempts.length,
        transport: input.transport,
        recorder: {
          record: (attempt) =>
            input.tasks.recordSemanticOperation(snapshot!.id, attempt),
        },
      });
      const domainData = createCustomerSuccessDomainData({
        preferences,
        semanticOperations:
          createProductionCustomerSuccessSemanticOperations(semanticExecutor),
        evaluationDate: snapshot.createdAt,
      });
      domainData.userProfile = profile;
      const hardFilters = snapshot.stageResults.find(
        (stage) => stage.stageId === "hard-filters" && stage.status === "COMPLETED",
      );
      if (hardFilters?.result?.data) {
        domainData.reconstruction = hardFiltersDataSchema.parse(
          hardFilters.result.data,
        ).reconstruction;
      }
      domainData.derivedEvidence = asDraftEvidence(snapshot.evidenceRecords)
        .filter((evidence) => evidence.origin === "DERIVED");

      const executor = createEvaluationExecutor(input.evaluations);
      for (let pass = 0; pass <= evaluator.stages.length; pass += 1) {
        snapshot = await input.evaluations.getEvaluationSnapshot(task.evaluationId);
        if (!snapshot) {
          throw new EvaluationWorkerError(
            "EVALUATION_NOT_FOUND",
            "The evaluation disappeared during worker execution",
            false,
          );
        }
        if (snapshot.status === "COMPLETED") return;

        const retryableStage = snapshot.stageResults.find((result) => {
          if (result.status !== "FAILED" || !result.retryable) return false;
          const stage = evaluator.stages.find((item) => item.id === result.stageId);
          return stage !== undefined && result.attempt < stage.maxAttempts;
        });
        const terminalFailure = snapshot.stageResults.find((result) => {
          if (result.status !== "FAILED") return false;
          const stage = evaluator.stages.find((item) => item.id === result.stageId);
          return (
            !result.retryable ||
            stage === undefined ||
            result.attempt >= stage.maxAttempts
          );
        });
        if (terminalFailure) {
          throw new EvaluationWorkerError(
            terminalFailure.failureCode ?? "EVALUATION_STAGE_FAILED",
            terminalFailure.errorMessage ?? "An evaluation stage failed",
            false,
          );
        }
        const result = retryableStage
          ? await executor.retryStage({
              evaluationId: snapshot.id,
              stageId: retryableStage.stageId,
              evaluator,
              domainData,
            })
          : await executor.executeExisting({
              evaluationId: snapshot.id,
              evaluator,
              domainData,
            });
        if (result.evaluation.status === "COMPLETED") return;
      }

      snapshot = await input.evaluations.getEvaluationSnapshot(task.evaluationId);
      const failedStage = snapshot?.stageResults.find(
        (stage) => stage.status === "FAILED",
      );
      throw new EvaluationWorkerError(
        failedStage?.failureCode ?? "EVALUATION_FAILED",
        failedStage?.errorMessage ??
          snapshot?.errorMessage ??
          "The evaluation did not complete",
        false,
      );
    },
  };
}
