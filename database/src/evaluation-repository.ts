import { originatingVersion, residencyRequirement, storedCompensationTiers, storedEligibilityFacts, storedWorkArrangements } from "./manual-opportunity-repository";
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

// Normalized fields first populated by product normalization in the Task 7
// completion amendment (residency / geographic eligibility included). Until the evaluator workstream adopts them, the
// evaluator subject keeps receiving exactly what it received before (null,
// and no provenance rows for them): the Customer Success salary hard filter
// prefers salaryMin/salaryMax over its own parsing and does not compare
// currencies, so delivering them would silently change recommendations.
// See HANDOFFS.md ("Task 7 Completion Amendment"). timeZoneRequirements
// (stated by the user since the Features 1–10 Gap Closure) is withheld the
// same way: the evaluator reads time zones from the job text itself.
export const fieldsWithheldFromEvaluator = [
  "salaryMin",
  "salaryMax",
  "currency",
  "remoteStatus",
  "seniority",
  "department",
  "employmentType",
  "closingDate",
  "residencyRequirement",
  "residencyRegions",
  "timeZoneRequirements",
  // Added with the shared-normalization convergence (October 2026): what a
  // stated compensation range is (base or OTE), and the explicit work-
  // authorization facts. Whether an OTE range counts as base salary, and
  // what work authorization means for a user, are decisions for the
  // coordinated evaluator integration (HANDOFFS.md).
  "compensationBasis",
  "workAuthorizationRequirement",
  "workAuthorizationRegions",
  "visaSponsorship",
  "relocationSupport",
  "employerOfRecordRegions",
  // Added with the cross-source correction (October 26, 2026): the stated
  // seniority label. Withheld like the normalized level.
  "seniorityLabel",
  // Every arrangement the posting offers (withheld like remoteStatus).
  "workArrangements",
  // Added with the final cross-source batch (October 27, 2026): labelled
  // regional pay tiers (withheld like salaryMin/salaryMax), and variable pay
  // stated on its own, newly read (it was always null before).
  "compensationTiers",
  "bonus",
] as const;

// What the evaluator received for each withheld field before it existed.
const withheldValues = {
  salaryMin: null,
  salaryMax: null,
  currency: null,
  remoteStatus: null,
  seniority: null,
  department: null,
  employmentType: null,
  closingDate: null,
  residencyRequirement: null,
  residencyRegions: [],
  timeZoneRequirements: null,
  compensationBasis: null,
  workAuthorizationRequirement: null,
  workAuthorizationRegions: [],
  visaSponsorship: null,
  relocationSupport: null,
  employerOfRecordRegions: [],
  seniorityLabel: null,
  workArrangements: [],
  compensationTiers: [],
  bonus: null,
} satisfies Pick<NormalizedOpportunity, (typeof fieldsWithheldFromEvaluator)[number]>;

const withheldFromEvaluator = new Set<string>(fieldsWithheldFromEvaluator);

function mapOpportunity(
  record: Prisma.OpportunityGetPayload<{ include: { company: true } }>,
): NormalizedOpportunity & { id: string } {
  return {
    ...mapOpportunityFields(record),
    ...withheldValues,
  };
}

function mapOpportunityFields(
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
    seniorityLabel: record.seniorityLabel,
    location: record.location,
    remoteStatus: record.remoteStatus,
    workArrangements: storedWorkArrangements(record.workArrangements),
    timeZoneRequirements: record.timeZoneRequirements,
    residencyRequirement: residencyRequirement(record.residencyRequirement),
    residencyRegions: record.residencyRegions,
    ...storedEligibilityFacts(record),
    salaryMin: record.salaryMin?.toNumber() ?? null,
    salaryMax: record.salaryMax?.toNumber() ?? null,
    salaryText: record.salaryText,
    compensationTiers: storedCompensationTiers(record.compensationTiers),
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

  // The evaluated source version (Core TDD §51, v1.15). An evaluation is
  // bound, when it is created, to the current version of the opportunity's
  // originating listing; its subject is that version as it stood then: the
  // provenance rows current at binding (later superseded or not) and, if the
  // listing changed afterwards, the facts and description those rows and that
  // record state. Without an evaluation (eligibility checks) it is the
  // current version. An evaluation created before the binding existed
  // evaluated the opportunity's first source record.
  async loadSubject(input: {
    opportunityId: string;
    userProfileId: string | null;
    evaluationId?: string;
  }): Promise<EvaluationSubject | null> {
    const bound = input.evaluationId
      ? await this.database.evaluation.findUnique({ where: { id: input.evaluationId }, select: { sourceRecordId: true, createdAt: true } })
      : null;
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

    const origin = await originatingVersion(this.database, opportunity.id);
    const boundAt = bound?.createdAt ?? null;
    const subjectSourceRecordId = bound
      ? bound.sourceRecordId ?? origin?.origin.id ?? null
      : origin?.currentId ?? null;
    // Provenance current at binding: created by then, and not superseded by
    // then. Without a binding, the current rows.
    const provenanceRows = opportunity.fieldProvenance.filter((row) =>
      boundAt
        ? row.createdAt <= boundAt && (row.supersededAt === null || row.supersededAt > boundAt)
        : row.supersededAt === null,
    );
    const mapped = mapOpportunity(opportunity);
    // The listing changed after binding: the evaluator sees the bound
    // version's facts and description, not the newer projection.
    const changedSinceBinding = boundAt !== null && opportunity.fieldProvenance.some((row) => row.supersededAt !== null && row.supersededAt > boundAt);
    if (changedSinceBinding) {
      const asOf = (fieldName: string) => provenanceRows.find((row) => row.fieldName === fieldName)?.normalizedValue ?? null;
      const textOf = (fieldName: string) => {
        const value = asOf(fieldName);
        return typeof value === "string" ? value : null;
      };
      const boundRecord = opportunity.sourceRecords.find((source) => source.id === subjectSourceRecordId);
      const postingDate = textOf("postingDate");
      Object.assign(mapped, {
        title: textOf("title"),
        companyName: textOf("company.name"),
        location: textOf("location"),
        salaryText: textOf("salaryText"),
        postingDate: postingDate ? new Date(postingDate) : null,
        jobDescription: boundRecord?.rawDescription ?? textOf("jobDescription"),
      });
    }
    // A posting date dated from a stated age ("2 weeks ago") is approximate,
    // a fact newly derived by the cross-source correction (October 26, 2026):
    // withheld from the evaluator, as if unstated, until its use is approved.
    const approximatePostingDate = (row: { fieldName: string; sourceField: string }) =>
      row.fieldName === "postingDate" && row.sourceField.endsWith("relative-posted-age");
    if (provenanceRows.some(approximatePostingDate)) mapped.postingDate = null;

    return {
      opportunity: mapped,
      subjectSourceRecordId,
      rawSources: opportunity.sourceRecords.map((source) => ({
        id: source.id,
        source: source.source,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        rawDescription: source.rawDescription,
        rawPayload: source.rawPayload,
      })),
      provenance: provenanceRows
        .filter((provenance) => !withheldFromEvaluator.has(provenance.fieldName) && !approximatePostingDate(provenance))
        .map((provenance) => ({
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
              // Structured limitations reach the evaluator only when the
              // pinned version stores them; versions without limitations
              // are delivered exactly as before.
              ...(userProfile.limitations === null
                ? {}
                : { limitations: userProfile.limitations }),
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
    const version = await originatingVersion(this.database, input.opportunityId);
    const evaluation = await this.database.evaluation.create({
      data: {
        opportunityId: input.opportunityId,
        // Bound to the version being evaluated (Core TDD §51, v1.15).
        sourceRecordId: version?.currentId ?? null,
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

// Informational only (Core TDD §51, v1.15): whether the opportunity's latest
// completed evaluation evaluated an earlier version of its originating
// listing than the current one. Nothing is reevaluated.
export async function findListingVersionHint(opportunityId: string) {
  const database = getDatabaseClient();
  const evaluation = await database.evaluation.findFirst({
    where: { opportunityId, status: "COMPLETED" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: {
      sourceRecordId: true,
      completedAt: true,
      createdAt: true,
      semanticOperations: { select: { sourceRecordId: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!evaluation) return null;
  const version = await originatingVersion(database, opportunityId);
  if (!version) return null;
  // Before the binding existed, an evaluation evaluated the first record.
  const evaluatedId = evaluation.sourceRecordId ?? evaluation.semanticOperations[0]?.sourceRecordId ?? version.origin.id;
  if (evaluatedId === version.currentId) return null;
  const records = await database.sourceRecord.findMany({
    where: { id: { in: [evaluatedId, version.currentId] } },
    select: { id: true, createdAt: true },
  });
  const seen = (id: string) => records.find((record) => record.id === id)?.createdAt ?? null;
  return {
    evaluatedAt: evaluation.completedAt ?? evaluation.createdAt,
    evaluatedVersionSeenAt: seen(evaluatedId),
    currentVersionSeenAt: seen(version.currentId),
  };
}
