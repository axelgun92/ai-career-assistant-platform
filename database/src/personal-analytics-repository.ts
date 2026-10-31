import type { PaApplicationFact, PaEvaluationFact, PaFacts, PaGapFact, SourceCategory } from "@ai-career/core";
import { getDatabaseClient } from "./client";
import { noLongerListedCondition } from "./opportunity-list-repository";

// Personal Job-Search Analytics read model (feature 17). Read-only: every query
// is a SELECT over persisted opportunities, source records, evaluations,
// recommendations, semantic-call telemetry, profiles, deferrals, lifecycle
// actions and the application tracker. It writes nothing, stores no aggregate,
// and never calls a provider. Metrics are derived by the pure Core module
// (personal-analytics.ts).
//
// Evaluated facts are read from Evaluation.domainResult by JSON path, as
// stored and never re-run: Resume Match band and its structured requirement
// assessments classified GENUINE_GAP (category, strength, decision impact and
// the job's requirement text — never the evaluator's prose), Alex Fit
// classification, the role classification and the company's customer segment
// and customer type. The Resume Match version is the prompt version of the
// evaluation's successful customer-success.resume-match call.

export const resumeMatchOperationId = "customer-success.resume-match";
const customerSuccessDomain = "customer-success";

type OpportunityRow = {
  id: string;
  title: string | null;
  status: string;
  seniority: string | null;
  remoteStatus: string | null;
  workArrangements: string[] | null;
  originSource: string | null;
  originSourceType: string | null;
  originRetrievalSourceId: string | null;
  originCaptureSite: string | null;
  originExternalId: string | null;
  openDeferralReason: string | null;
  markedAppliedAt: Date | null;
  noLongerListed: boolean | null;
};

type EvaluationRow = Omit<PaEvaluationFact, "resumeMatch"> & {
  opportunityId: string;
  resumeMatchEvaluated: string | null;
  resumeMatchBand: string | null;
  gaps: unknown;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

// Stored GENUINE_GAP assessments; anything malformed is skipped.
export function readStoredGaps(value: unknown): PaGapFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const category = text(entry.category);
    const requirementText = text(entry.requirementText);
    if (!category || !requirementText) return [];
    return [{ category, requirementText, strength: text(entry.strength) ?? "UNKNOWN", decisionImpact: text(entry.decisionImpact) ?? "UNKNOWN" }];
  });
}

export class PrismaPersonalAnalyticsRepository {
  private readonly database = getDatabaseClient();

  async facts(): Promise<PaFacts> {
    const [sources, profiles, active, opportunities, evaluations, applications] = await Promise.all([
      this.database.retrievalSource.findMany({
        select: { id: true, name: true, adapterKey: true, sourceCategory: true, enabled: true, archivedAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.database.userProfile.findMany({ select: { id: true, label: true, version: true }, orderBy: [{ label: "asc" }, { version: "desc" }] }),
      this.database.activeUserProfile.findUnique({ where: { domain: customerSuccessDomain }, select: { userProfileId: true } }),
      this.database.$queryRaw<OpportunityRow[]>`
        SELECT o."id", o."title", o."status"::text AS status, o."seniority", o."remoteStatus", o."workArrangements",
               origin."source" AS "originSource", origin."sourceType" AS "originSourceType",
               origin."retrievalSourceId" AS "originRetrievalSourceId", origin."captureSite" AS "originCaptureSite",
               origin."externalId" AS "originExternalId",
               (SELECT d."reasonCode" FROM "DeferredEvaluation" d
                 WHERE d."opportunityId" = o."id" AND d."status" = 'DEFERRED'
                 ORDER BY d."createdAt" DESC, d."id" DESC LIMIT 1) AS "openDeferralReason",
               (SELECT MIN(a."createdAt") FROM "OpportunityUserAction" a
                 WHERE a."opportunityId" = o."id" AND a."action" = 'MARK_APPLIED') AS "markedAppliedAt",
               ${noLongerListedCondition} AS "noLongerListed"
        FROM "Opportunity" o
        -- The originating listing: the earliest chain head by (createdAt, id),
        -- Feature 15's first-discovery rule.
        LEFT JOIN LATERAL (
          SELECT sr."source", sr."sourceType"::text AS "sourceType", sr."retrievalSourceId",
                 sr."sourceMetadata"->'capture'->>'site' AS "captureSite", sr."externalId"
          FROM "SourceRecord" sr
          WHERE sr."opportunityId" = o."id" AND sr."previousSourceRecordId" IS NULL
          ORDER BY sr."createdAt" ASC, sr."id" ASC LIMIT 1
        ) origin ON TRUE
        ORDER BY o."createdAt" ASC, o."id" ASC
      `,
      this.database.$queryRaw<EvaluationRow[]>`
        SELECT e."id", e."opportunityId", e."status"::text AS status, e."createdAt", e."completedAt", r."decision",
               e."userProfileId", e."userProfileVersion",
               e."domainResult" #>> '{hardFilters,role,classification}' AS "roleClassification",
               e."domainResult" #>> '{companyAlignment,alignment,customerSegment,classification}' AS "customerSegment",
               e."domainResult" #>> '{companyAlignment,alignment,customerType,classification}' AS "customerType",
               CASE WHEN e."domainResult" #>> '{alexFit,evaluated}' = 'true' THEN e."domainResult" #>> '{alexFit,fit,classification}' END AS "alexFit",
               e."domainResult" #>> '{resumeMatch,evaluated}' AS "resumeMatchEvaluated",
               e."domainResult" #>> '{resumeMatch,band}' AS "resumeMatchBand",
               (SELECT jsonb_agg(jsonb_build_object(
                         'category', a->>'category', 'strength', a->>'strength',
                         'decisionImpact', a->>'decisionImpact', 'requirementText', a->>'requirementText'))
                  FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(e."domainResult" #> '{resumeMatch,match,requirementAssessments}') = 'array'
                         THEN e."domainResult" #> '{resumeMatch,match,requirementAssessments}' ELSE '[]'::jsonb END) a
                 WHERE a->>'classification' = 'GENUINE_GAP') AS gaps,
               (SELECT a."promptVersion" FROM "SemanticOperationAttempt" a
                 WHERE a."evaluationId" = e."id" AND a."operationId" = ${resumeMatchOperationId} AND a."status" = 'SUCCESS'
                 ORDER BY a."createdAt" DESC, a."attempt" DESC LIMIT 1) AS "resumeMatchVersion"
        FROM "Evaluation" e LEFT JOIN "Recommendation" r ON r."evaluationId" = e."id"
        ORDER BY e."createdAt" ASC, e."id" ASC
      `,
      this.database.application.findMany({
        select: {
          opportunityId: true,
          stage: true,
          outcome: true,
          appliedOn: true,
          createdAt: true,
          events: { select: { type: true, toStage: true, outcome: true, occurredOn: true, createdAt: true } },
          interviews: { select: { status: true, kind: true, scheduledAt: true, createdAt: true } },
        },
      }),
    ]);

    const evaluationsByOpportunity = new Map<string, PaEvaluationFact[]>();
    for (const { opportunityId, resumeMatchEvaluated, resumeMatchBand, gaps, ...row } of evaluations) {
      const list = evaluationsByOpportunity.get(opportunityId) ?? [];
      list.push({ ...row, resumeMatch: resumeMatchEvaluated === "true" ? { band: resumeMatchBand, gaps: readStoredGaps(gaps) } : null });
      evaluationsByOpportunity.set(opportunityId, list);
    }
    const applicationsByOpportunity = new Map<string, PaApplicationFact>(
      applications.map((application) => [
        application.opportunityId,
        {
          stage: application.stage,
          outcome: application.outcome,
          appliedOn: application.appliedOn,
          createdAt: application.createdAt,
          events: application.events.map((event) => ({ type: event.type, toStage: event.toStage, outcome: event.outcome, at: event.occurredOn ?? event.createdAt })),
          interviews: application.interviews.map((interview) => ({ status: interview.status, kind: interview.kind, at: interview.scheduledAt ?? interview.createdAt })),
        },
      ]),
    );
    return {
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        adapterKey: source.adapterKey,
        category: source.sourceCategory as SourceCategory,
        enabled: source.enabled,
        archived: source.archivedAt !== null,
      })),
      profiles,
      activeProfileId: active?.userProfileId ?? null,
      opportunities: opportunities.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        seniority: row.seniority,
        remoteStatus: row.remoteStatus,
        workArrangements: row.workArrangements ?? [],
        origin: row.originSource
          ? {
              source: row.originSource,
              sourceType: row.originSourceType ?? "OTHER",
              retrievalSourceId: row.originRetrievalSourceId,
              captureSite: row.originCaptureSite,
              externalId: row.originExternalId,
            }
          : null,
        evaluations: evaluationsByOpportunity.get(row.id) ?? [],
        openDeferralReason: row.openDeferralReason,
        noLongerListed: Boolean(row.noLongerListed),
        markedAppliedAt: row.markedAppliedAt,
        application: applicationsByOpportunity.get(row.id) ?? null,
      })),
    };
  }
}
