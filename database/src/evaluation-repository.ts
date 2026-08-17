import type { NormalizedOpportunity } from "@ai-career/core";
import {
  evaluationSnapshotSchema,
  persistedStageResultSchema,
  type DomainEvaluatorDefinition,
  type EvaluationRepository,
  type EvaluationSnapshot,
  type EvaluationSubject,
  type JsonValue,
  type PersistedStageResult,
} from "@ai-career/evaluation";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

function asInputJson(value: JsonValue | unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function mapOpportunity(
  record: Prisma.OpportunityGetPayload<{ include: { company: true } }>,
): NormalizedOpportunity & { id: string } {
  return {
    id: record.id,
    domain: record.domain,
    externalListingId: record.externalListingId,
    atsRequisitionId: record.atsRequisitionId,
    canonicalUrl: record.canonicalUrl,
    applicationUrl: record.applicationUrl,
    originalSource: record.originalSource,
    discoveredAt: record.discoveredAt,
    sourceUpdatedAt: record.sourceUpdatedAt,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    companyName: record.company?.name ?? null,
    brand: record.company?.brand ?? null,
    parentCompany: null,
    industry: record.company?.industry ?? null,
    headquarters: record.company?.headquarters ?? null,
    companySize: record.company?.companySize ?? null,
    title: record.title,
    department: record.department,
    employmentType: record.employmentType,
    seniority: record.seniority,
    location: record.location,
    remoteStatus: record.remoteStatus,
    timeZoneRequirements: record.timeZoneRequirements,
    salaryMin: record.salaryMin?.toNumber() ?? null,
    salaryMax: record.salaryMax?.toNumber() ?? null,
    salaryText: record.salaryText,
    bonus: record.bonus,
    equity: record.equity,
    currency: record.currency,
    compensationNotes: record.compensationNotes,
    postingDate: record.postingDate,
    closingDate: record.closingDate,
    source: record.source,
    sourceType: record.sourceType,
    atsPlatform: record.atsPlatform,
    jobDescription: record.jobDescription,
    responsibilities: record.responsibilities,
    requirements: record.requirements,
    benefits: record.benefits,
    additionalNotes: record.additionalNotes,
    status: record.status,
  };
}

type EvaluationRecord = Prisma.EvaluationGetPayload<{
  include: {
    stageResults: true;
    evidenceRecords: true;
    contradictions: true;
    recommendation: true;
  };
}>;

function mapStageResult(
  record: EvaluationRecord["stageResults"][number],
): PersistedStageResult {
  return persistedStageResultSchema.parse({
    ...record,
    result: record.result,
  });
}

function mapEvaluation(record: EvaluationRecord): EvaluationSnapshot {
  return evaluationSnapshotSchema.parse({
    id: record.id,
    opportunityId: record.opportunityId,
    userProfileId: record.userProfileId,
    domain: record.domain,
    status: record.status,
    evaluationVersion: record.evaluationVersion,
    domainVersion: record.domainVersion,
    ruleVersion: record.ruleVersion,
    promptVersion: record.promptVersion,
    userProfileVersion: record.userProfileVersion,
    executionMetadata: record.executionMetadata,
    domainResult: record.domainResult,
    recommendation: record.recommendation
      ? {
          id: record.recommendation.id,
          opportunityId: record.recommendation.opportunityId,
          evaluationId: record.recommendation.evaluationId,
          decision: record.recommendation.decision,
          explanation: record.recommendation.explanation,
          strongestPositives: record.recommendation.strongestPositives,
          strongestConcerns: record.recommendation.strongestConcerns,
          reviewConditions: record.recommendation.reviewConditions,
          unknowns: record.recommendation.unknowns,
          contradictions: record.recommendation.contradictions,
          evidenceReferences: record.recommendation.evidenceReferences,
          evaluationVersion: record.recommendation.evaluationVersion,
          createdAt: record.recommendation.createdAt,
          updatedAt: record.recommendation.updatedAt,
        }
      : null,
    errorMessage: record.errorMessage,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    stageResults: record.stageResults.map(mapStageResult),
    evidenceRecords: record.evidenceRecords.map((evidence) => ({
      id: evidence.id,
      referenceId: evidence.referenceId,
      evaluationId: evidence.evaluationId,
      stageResultId: evidence.stageResultId,
      stageId: evidence.stageId,
      criterionId: evidence.criterionId,
      claim: evidence.claim,
      sourceType: evidence.sourceType,
      sourceRecordId: evidence.sourceRecordId,
      provenanceId: evidence.provenanceId,
      sourceField: evidence.sourceField,
      sourceReference: evidence.sourceReference,
      sourceText: evidence.sourceText,
      evidenceType: evidence.evidenceType,
      origin: evidence.origin,
      evidenceLevel: evidence.evidenceLevel,
      collectedAt: evidence.collectedAt,
      createdAt: evidence.createdAt,
    })),
    contradictions: record.contradictions.map((contradiction) => ({
      id: contradiction.id,
      evaluationId: contradiction.evaluationId,
      stageResultId: contradiction.stageResultId,
      stageId: contradiction.stageId,
      claimA: contradiction.claimA,
      claimB: contradiction.claimB,
      interpretation: contradiction.interpretation,
      relevantField: contradiction.relevantField,
      significance: contradiction.significance,
      evidenceIdsA: contradiction.evidenceIdsA,
      evidenceIdsB: contradiction.evidenceIdsB,
      resolutionStatus: contradiction.resolutionStatus,
      resolutionNote: contradiction.resolutionNote,
      resolvedAt: contradiction.resolvedAt,
      createdAt: contradiction.createdAt,
    })),
  });
}

export class PrismaEvaluationRepository implements EvaluationRepository {
  private readonly database = getDatabaseClient();

  async loadSubject(input: {
    opportunityId: string;
    userProfileId: string | null;
  }): Promise<EvaluationSubject | null> {
    const [opportunity, userProfile] = await Promise.all([
      this.database.opportunity.findUnique({
        where: { id: input.opportunityId },
        include: {
          company: true,
          sourceRecords: { orderBy: { createdAt: "asc" } },
          fieldProvenance: { orderBy: { createdAt: "asc" } },
        },
      }),
      input.userProfileId
        ? this.database.userProfile.findUnique({
            where: { id: input.userProfileId },
          })
        : Promise.resolve(null),
    ]);

    if (!opportunity || (input.userProfileId && !userProfile)) return null;

    return {
      opportunity: mapOpportunity(opportunity),
      rawSources: opportunity.sourceRecords.map((source) => ({
        id: source.id,
        source: source.source,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        rawDescription: source.rawDescription,
        rawPayload: source.rawPayload,
      })),
      provenance: opportunity.fieldProvenance.map((provenance) => ({
        id: provenance.id,
        sourceRecordId: provenance.sourceRecordId,
        fieldName: provenance.fieldName,
        sourceField: provenance.sourceField,
        kind: provenance.kind,
        normalizedValue: provenance.normalizedValue,
        sourceReference: provenance.sourceReference,
        sourceText: provenance.sourceText,
      })),
      userProfile: userProfile
        ? {
            id: userProfile.id,
            version: userProfile.version,
            data: {
              label: userProfile.label,
              careerGoals: userProfile.careerGoals,
              experience: userProfile.experience,
              skills: userProfile.skills,
              transferableSkills: userProfile.transferableSkills,
              locationPreferences: userProfile.locationPreferences,
              compensationPreferences: userProfile.compensationPreferences,
              workPreferences: userProfile.workPreferences,
              companyPreferences: userProfile.companyPreferences,
              domainPreferences: userProfile.domainPreferences,
            },
          }
        : null,
    };
  }

  async createEvaluation(input: {
    opportunityId: string;
    userProfileId: string | null;
    userProfileVersion: number | null;
    evaluator: DomainEvaluatorDefinition<unknown, unknown>;
    executionMetadata: Record<string, JsonValue>;
  }) {
    const evaluation = await this.database.evaluation.create({
      data: {
        opportunityId: input.opportunityId,
        userProfileId: input.userProfileId,
        domain: input.evaluator.domain,
        evaluationVersion: input.evaluator.evaluationVersion,
        domainVersion: input.evaluator.domainVersion,
        ruleVersion: input.evaluator.ruleVersion,
        promptVersion: input.evaluator.promptVersion,
        userProfileVersion: input.userProfileVersion,
        executionMetadata: asInputJson(input.executionMetadata),
        stageResults: {
          create: input.evaluator.stages.map((stage, position) => ({
            stageId: stage.id,
            position,
            stageVersion: stage.version,
            ruleVersion: stage.ruleVersion,
            promptVersion: stage.promptVersion,
          })),
        },
      },
      select: { id: true },
    });
    return evaluation.id;
  }

  async getEvaluationSnapshot(evaluationId: string) {
    const evaluation = await this.database.evaluation.findUnique({
      where: { id: evaluationId },
      include: {
        stageResults: { orderBy: { position: "asc" } },
        evidenceRecords: { orderBy: { createdAt: "asc" } },
        contradictions: { orderBy: { createdAt: "asc" } },
        recommendation: true,
      },
    });
    return evaluation ? mapEvaluation(evaluation) : null;
  }

  async markEvaluationRunning(evaluationId: string) {
    await this.database.$transaction(async (transaction) => {
      await transaction.evaluation.updateMany({
        where: { id: evaluationId, startedAt: null },
        data: { startedAt: new Date() },
      });
      await transaction.evaluation.update({
        where: { id: evaluationId },
        data: {
          status: "RUNNING",
          completedAt: null,
          errorMessage: null,
        },
      });
    });
  }

  async beginStage(input: {
    evaluationId: string;
    stageId: string;
    maxAttempts: number;
  }) {
    const stage = await this.database.$transaction(async (transaction) => {
      const current = await transaction.stageResult.findUnique({
        where: {
          evaluationId_stageId: {
            evaluationId: input.evaluationId,
            stageId: input.stageId,
          },
        },
      });
      if (!current) throw new Error("Evaluation stage does not exist");
      if (current.status === "COMPLETED" || current.status === "RUNNING") {
        throw new Error(`Stage ${input.stageId} cannot be started from ${current.status}`);
      }
      if (current.status === "FAILED" && !current.retryable) {
        throw new Error(`Stage ${input.stageId} is not retryable`);
      }
      const attempt = current.status === "FAILED" ? current.attempt + 1 : 1;
      if (attempt > input.maxAttempts) {
        throw new Error(`Stage ${input.stageId} has exhausted its retry attempts`);
      }
      return transaction.stageResult.update({
        where: { id: current.id },
        data: {
          status: "RUNNING",
          attempt,
          retryable: false,
          failureCode: null,
          errorMessage: null,
          startedAt: new Date(),
          completedAt: null,
        },
      });
    });
    return mapStageResult(stage);
  }

  async completeStage(input: Parameters<EvaluationRepository["completeStage"]>[0]) {
    const stage = await this.database.$transaction(async (transaction) => {
      const current = await transaction.stageResult.findUnique({
        where: { id: input.stageResultId },
      });
      if (
        !current ||
        current.evaluationId !== input.evaluationId ||
        current.stageId !== input.stageId ||
        current.status !== "RUNNING"
      ) {
        throw new Error("Stage completion rejected for invalid stage state");
      }

      const evidenceByReference = new Map<string, string>();
      for (const evidence of input.output.evidence) {
        if (evidence.sourceRecordId) {
          const source = await transaction.sourceRecord.findFirst({
            where: {
              id: evidence.sourceRecordId,
              opportunityId: input.opportunityId,
            },
            select: { id: true },
          });
          if (!source) throw new Error("Evidence SourceRecord does not belong to the Opportunity");
        }
        if (evidence.provenanceId) {
          const provenance = await transaction.fieldProvenance.findFirst({
            where: {
              id: evidence.provenanceId,
              opportunityId: input.opportunityId,
            },
            select: { id: true },
          });
          if (!provenance) throw new Error("Evidence provenance does not belong to the Opportunity");
        }

        const created = await transaction.evidenceRecord.create({
          data: {
            opportunityId: input.opportunityId,
            evaluationId: input.evaluationId,
            stageResultId: input.stageResultId,
            stageId: input.stageId,
            referenceId: evidence.referenceId,
            criterionId: evidence.criterionId,
            claim: evidence.claim,
            sourceType: evidence.sourceType,
            sourceRecordId: evidence.sourceRecordId,
            provenanceId: evidence.provenanceId,
            sourceField: evidence.sourceField,
            sourceReference: evidence.sourceReference,
            sourceText: evidence.sourceText,
            evidenceType: evidence.evidenceType,
            origin: evidence.origin,
            evidenceLevel: evidence.evidenceLevel,
            collectedAt: evidence.collectedAt,
          },
          select: { id: true },
        });
        evidenceByReference.set(evidence.referenceId, created.id);
      }

      const contradictionIds: string[] = [];
      for (const contradiction of input.output.contradictions) {
        const evidenceIdsA = contradiction.evidenceReferencesA.map(
          (reference) => evidenceByReference.get(reference)!,
        );
        const evidenceIdsB = contradiction.evidenceReferencesB.map(
          (reference) => evidenceByReference.get(reference)!,
        );
        const created = await transaction.contradiction.create({
          data: {
            evaluationId: input.evaluationId,
            stageResultId: input.stageResultId,
            stageId: input.stageId,
            claimA: contradiction.claimA,
            claimB: contradiction.claimB,
            interpretation: contradiction.interpretation,
            relevantField: contradiction.relevantField,
            significance: contradiction.significance,
            evidenceIdsA,
            evidenceIdsB,
          },
          select: { id: true },
        });
        contradictionIds.push(created.id);
      }

      const persistedResult = {
        classification: input.output.classification,
        data: input.output.data,
        findings: input.output.findings,
        strengths: input.output.strengths,
        concerns: input.output.concerns,
        unknowns: input.output.unknowns,
        confidence: input.output.confidence,
        completeness: input.output.completeness,
        evidenceRecordIds: [...evidenceByReference.values()],
        contradictionIds,
      };

      return transaction.stageResult.update({
        where: { id: current.id },
        data: {
          status: "COMPLETED",
          result: asInputJson(persistedResult),
          retryable: false,
          failureCode: null,
          errorMessage: null,
          completedAt: new Date(),
        },
      });
    });
    return mapStageResult(stage);
  }

  async failStage(input: Parameters<EvaluationRepository["failStage"]>[0]) {
    const stage = await this.database.stageResult.update({
      where: { id: input.stageResultId },
      data: {
        status: "FAILED",
        retryable: input.failure.retryable,
        failureCode: input.failure.code,
        errorMessage: input.failure.reason,
        completedAt: new Date(),
      },
    });
    return mapStageResult(stage);
  }

  async finishEvaluation(
    input: Parameters<EvaluationRepository["finishEvaluation"]>[0],
  ) {
    await this.database.$transaction(async (transaction) => {
      const evaluation = await transaction.evaluation.update({
        where: { id: input.evaluationId },
        data: {
          status: input.status,
          errorMessage: input.errorMessage,
          domainResult:
            input.domainResult === undefined
              ? undefined
              : input.domainResult === null
                ? Prisma.JsonNull
                : asInputJson(input.domainResult),
          completedAt: new Date(),
        },
        select: {
          opportunityId: true,
          evaluationVersion: true,
        },
      });

      if (input.status === "COMPLETED" && input.recommendation) {
        await transaction.recommendation.upsert({
          where: { evaluationId: input.evaluationId },
          create: {
            opportunityId: evaluation.opportunityId,
            evaluationId: input.evaluationId,
            decision: input.recommendation.decision,
            strongestPositives: input.recommendation.strongestPositives === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.strongestPositives),
            strongestConcerns: input.recommendation.strongestConcerns === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.strongestConcerns),
            reviewConditions: input.recommendation.reviewConditions === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.reviewConditions),
            unknowns: input.recommendation.unknowns === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.unknowns),
            contradictions: input.recommendation.contradictions === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.contradictions),
            evidenceReferences: input.recommendation.evidenceReferences,
            explanation: input.recommendation.explanation,
            evaluationVersion: evaluation.evaluationVersion,
          },
          update: {
            decision: input.recommendation.decision,
            strongestPositives: input.recommendation.strongestPositives === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.strongestPositives),
            strongestConcerns: input.recommendation.strongestConcerns === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.strongestConcerns),
            reviewConditions: input.recommendation.reviewConditions === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.reviewConditions),
            unknowns: input.recommendation.unknowns === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.unknowns),
            contradictions: input.recommendation.contradictions === null
              ? Prisma.JsonNull
              : asInputJson(input.recommendation.contradictions),
            evidenceReferences: input.recommendation.evidenceReferences,
            explanation: input.recommendation.explanation,
          },
        });
      }
    });
  }
}
