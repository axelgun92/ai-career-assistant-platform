import {
  evaluationSnapshotSchema,
  persistedStageResultSchema,
  type EvaluationRepository,
  type EvaluationSnapshot,
  type EvaluationSubject,
} from "@ai-career/evaluation";
import { randomUUID } from "node:crypto";

const now = () => new Date("2026-08-13T20:00:00.000Z");

export function createNeutralEvaluationSubject(): EvaluationSubject {
  const opportunityId = randomUUID();
  const sourceRecordId = randomUUID();
  const provenanceId = randomUUID();
  const timestamp = now();
  return {
    opportunity: {
      id: opportunityId,
      domain: null,
      externalListingId: null,
      atsRequisitionId: null,
      canonicalUrl: null,
      applicationUrl: null,
      originalSource: "neutral-fixture",
      discoveredAt: timestamp,
      sourceUpdatedAt: null,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      companyName: null,
      brand: null,
      parentCompany: null,
      industry: null,
      headquarters: null,
      companySize: null,
      title: "Neutral Opportunity",
      department: null,
      employmentType: null,
      seniority: null,
      location: null,
      remoteStatus: null,
      timeZoneRequirements: null,
      salaryMin: null,
      salaryMax: null,
      salaryText: null,
      bonus: null,
      equity: null,
      currency: null,
      compensationNotes: null,
      postingDate: null,
      closingDate: null,
      source: "neutral-fixture",
      sourceType: "MANUAL",
      atsPlatform: null,
      jobDescription: "Neutral source text",
      responsibilities: null,
      requirements: null,
      benefits: null,
      additionalNotes: null,
      status: "NORMALIZED",
    },
    rawSources: [
      {
        id: sourceRecordId,
        source: "neutral-fixture",
        sourceType: "MANUAL",
        sourceUrl: "https://example.test/neutral",
        rawDescription: "Neutral source text",
        rawPayload: { rawText: "Neutral source text" },
      },
    ],
    provenance: [
      {
        id: provenanceId,
        sourceRecordId,
        fieldName: "jobDescription",
        sourceField: "rawText",
        kind: "DIRECT",
        normalizedValue: "Neutral source text",
        sourceReference: "https://example.test/neutral",
        sourceText: "Neutral source text",
      },
    ],
    userProfile: null,
  };
}

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private snapshot: EvaluationSnapshot | null = null;

  constructor(readonly subject: EvaluationSubject) {}

  async loadSubject(input: { opportunityId: string; userProfileId: string | null }) {
    if (input.opportunityId !== this.subject.opportunity.id) return null;
    if (input.userProfileId !== this.subject.userProfile?.id && input.userProfileId !== null) {
      return null;
    }
    return this.subject;
  }

  async createEvaluation(
    input: Parameters<EvaluationRepository["createEvaluation"]>[0],
  ) {
    const timestamp = now();
    const id = randomUUID();
    this.snapshot = evaluationSnapshotSchema.parse({
      id,
      opportunityId: input.opportunityId,
      userProfileId: input.userProfileId,
      domain: input.evaluator.domain,
      status: "PENDING",
      evaluationVersion: input.evaluator.evaluationVersion,
      domainVersion: input.evaluator.domainVersion,
      ruleVersion: input.evaluator.ruleVersion,
      promptVersion: input.evaluator.promptVersion,
      userProfileVersion: input.userProfileVersion,
      executionMetadata: input.executionMetadata,
      domainResult: null,
      recommendation: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      stageResults: input.evaluator.stages.map((stage, position) => ({
        id: randomUUID(),
        evaluationId: id,
        stageId: stage.id,
        position,
        status: "PENDING",
        stageVersion: stage.version,
        ruleVersion: stage.ruleVersion,
        promptVersion: stage.promptVersion,
        attempt: 1,
        retryable: false,
        failureCode: null,
        result: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      evidenceRecords: [],
      contradictions: [],
    });
    return id;
  }

  async getEvaluationSnapshot(evaluationId: string) {
    return this.snapshot?.id === evaluationId
      ? evaluationSnapshotSchema.parse(this.snapshot)
      : null;
  }

  async markEvaluationRunning(evaluationId: string) {
    const snapshot = this.requireSnapshot(evaluationId);
    snapshot.status = "RUNNING";
    snapshot.startedAt ??= now();
    snapshot.completedAt = null;
    snapshot.errorMessage = null;
    snapshot.updatedAt = now();
  }

  async beginStage(input: Parameters<EvaluationRepository["beginStage"]>[0]) {
    const snapshot = this.requireSnapshot(input.evaluationId);
    const stage = this.requireStage(snapshot, input.stageId);
    if (stage.status === "FAILED") {
      if (!stage.retryable || stage.attempt >= input.maxAttempts) {
        throw new Error("Stage is not eligible for retry");
      }
      stage.attempt += 1;
    } else if (stage.status !== "PENDING") {
      throw new Error("Stage cannot be started from its current state");
    }
    stage.status = "RUNNING";
    stage.retryable = false;
    stage.failureCode = null;
    stage.errorMessage = null;
    stage.startedAt = now();
    stage.completedAt = null;
    stage.updatedAt = now();
    return persistedStageResultSchema.parse(stage);
  }

  async completeStage(input: Parameters<EvaluationRepository["completeStage"]>[0]) {
    const snapshot = this.requireSnapshot(input.evaluationId);
    const stage = snapshot.stageResults.find(
      (result) => result.id === input.stageResultId,
    );
    if (!stage || stage.status !== "RUNNING") throw new Error("Invalid stage state");

    const evidenceIds = new Map<string, string>();
    for (const evidence of input.output.evidence) {
      const id = randomUUID();
      evidenceIds.set(evidence.referenceId, id);
      snapshot.evidenceRecords.push({
        id,
        referenceId: evidence.referenceId,
        evaluationId: input.evaluationId,
        stageResultId: stage.id,
        stageId: stage.stageId,
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
        createdAt: now(),
      });
    }

    const contradictionIds = input.output.contradictions.map((contradiction) => {
      const id = randomUUID();
      snapshot.contradictions.push({
        id,
        evaluationId: input.evaluationId,
        stageResultId: stage.id,
        stageId: stage.stageId,
        claimA: contradiction.claimA,
        claimB: contradiction.claimB,
        interpretation: contradiction.interpretation,
        relevantField: contradiction.relevantField,
        significance: contradiction.significance,
        evidenceIdsA: contradiction.evidenceReferencesA.map(
          (reference) => evidenceIds.get(reference)!,
        ),
        evidenceIdsB: contradiction.evidenceReferencesB.map(
          (reference) => evidenceIds.get(reference)!,
        ),
        resolutionStatus: "UNRESOLVED",
        resolutionNote: null,
        resolvedAt: null,
        createdAt: now(),
      });
      return id;
    });

    stage.status = "COMPLETED";
    stage.result = {
      classification: input.output.classification,
      data: input.output.data,
      findings: input.output.findings,
      strengths: input.output.strengths,
      concerns: input.output.concerns,
      unknowns: input.output.unknowns,
      confidence: input.output.confidence,
      completeness: input.output.completeness,
      evidenceRecordIds: [...evidenceIds.values()],
      contradictionIds,
    };
    stage.retryable = false;
    stage.failureCode = null;
    stage.errorMessage = null;
    stage.completedAt = now();
    stage.updatedAt = now();
    return persistedStageResultSchema.parse(stage);
  }

  async failStage(input: Parameters<EvaluationRepository["failStage"]>[0]) {
    if (!this.snapshot) throw new Error("Evaluation does not exist");
    const stage = this.snapshot.stageResults.find(
      (result) => result.id === input.stageResultId,
    );
    if (!stage) throw new Error("Stage does not exist");
    stage.status = "FAILED";
    stage.retryable = input.failure.retryable;
    stage.failureCode = input.failure.code;
    stage.errorMessage = input.failure.reason;
    stage.completedAt = now();
    stage.updatedAt = now();
    return persistedStageResultSchema.parse(stage);
  }

  async finishEvaluation(
    input: Parameters<EvaluationRepository["finishEvaluation"]>[0],
  ) {
    const snapshot = this.requireSnapshot(input.evaluationId);
    snapshot.status = input.status;
    snapshot.errorMessage = input.errorMessage;
    snapshot.domainResult = input.domainResult ?? null;
    snapshot.recommendation = input.recommendation
      ? {
          id: randomUUID(),
          opportunityId: snapshot.opportunityId,
          evaluationId: snapshot.id,
          evaluationVersion: snapshot.evaluationVersion,
          ...input.recommendation,
          createdAt: now(),
          updatedAt: now(),
        }
      : null;
    snapshot.completedAt = now();
    snapshot.updatedAt = now();
  }

  private requireSnapshot(evaluationId: string) {
    if (!this.snapshot || this.snapshot.id !== evaluationId) {
      throw new Error("Evaluation does not exist");
    }
    return this.snapshot;
  }

  private requireStage(snapshot: EvaluationSnapshot, stageId: string) {
    const stage = snapshot.stageResults.find((result) => result.stageId === stageId);
    if (!stage) throw new Error("Stage does not exist");
    return stage;
  }
}
