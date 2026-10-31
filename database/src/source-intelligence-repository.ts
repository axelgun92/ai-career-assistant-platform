import {
  normalizeDeferralReason,
  type SiApplicationFact,
  type SiDuplicateDecision,
  type SiEvaluationFact,
  type SiEvaluationStatus,
  type SiFacts,
  type SiLedgerState,
  type SiListingFact,
  type SiOpportunityFact,
  type SiRunFact,
  type SourceCategory,
  type RetrievalRunStatusValue,
} from "@ai-career/core";
import type { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import { noLongerListedCondition } from "./opportunity-list-repository";

// Source Intelligence read model (feature 15). Read-only: every query is a
// SELECT over the persisted retrieval, deduplication, evaluation, usage,
// deferral and application history. It writes nothing, adds no record for
// analytics, and never calls a provider. Metrics are derived from these facts
// by the pure Core module (source-intelligence.ts).
//
// Cost follows the existing usage-reporting rule: an attempt's cost is known
// when it recorded an estimated cost priced in the report currency; any other
// attempt is counted as unknown, never priced at zero.
export class PrismaSourceIntelligenceRepository {
  private readonly database = getDatabaseClient();

  async facts(input: { currency: string | null }): Promise<SiFacts> {
    const currency = input.currency ?? "";
    const [sources, listings, ledger, pending, opportunities, evaluations, applications, runs] = await Promise.all([
      this.database.retrievalSource.findMany({
        select: { id: true, name: true, adapterKey: true, sourceCategory: true, enabled: true, archivedAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.database.$queryRaw<
        Array<{
          id: string;
          opportunityId: string | null;
          source: string;
          sourceType: string;
          sourceCategory: string | null;
          retrievalSourceId: string | null;
          captureSite: string | null;
          externalId: string | null;
          duplicateDecision: string | null;
          sourceUrl: string | null;
          applicationUrl: string | null;
          createdAt: Date;
        }>
      >`
        SELECT sr."id", sr."opportunityId", sr."source", sr."sourceType"::text AS "sourceType",
               sr."sourceCategory"::text AS "sourceCategory", sr."retrievalSourceId",
               sr."sourceMetadata"->'capture'->>'site' AS "captureSite", sr."externalId",
               sr."duplicateDecision"::text AS "duplicateDecision", sr."sourceUrl", sr."applicationUrl", sr."createdAt"
        FROM "SourceRecord" sr
        WHERE sr."previousSourceRecordId" IS NULL
      `,
      this.database.retrievedListing.findMany({
        where: { opportunityId: { not: null } },
        select: { retrievalSourceId: true, externalId: true, opportunityId: true, firstSeenAt: true, state: true },
      }),
      this.database.$queryRaw<Array<{ retrievalSourceId: string; count: bigint }>>`
        SELECT l."retrievalSourceId", COUNT(*) AS count
        FROM "RetrievedListing" l JOIN "RetrievalSource" s ON s."id" = l."retrievalSourceId"
        WHERE l."opportunityId" IS NULL AND l."state" = 'LISTED'
          AND l."trackingScopeKey" = COALESCE(s."trackingScopeKey", '')
        GROUP BY 1
      `,
      this.database.$queryRaw<
        Array<{
          id: string;
          title: string | null;
          company: string | null;
          status: string;
          createdAt: Date;
          canonicalUrl: string | null;
          applicationUrl: string | null;
          atsPlatform: string | null;
          location: string | null;
          remoteStatus: string | null;
          workArrangements: string[];
          residencyRegions: string[];
          workAuthorizationRegions: string[];
          openDeferralReason: string | null;
          markedAppliedAt: Date | null;
          probableUnresolved: boolean;
          noLongerListed: boolean | null;
        }>
      >`
        SELECT o."id", o."title", c."name" AS company, o."status"::text AS status, o."createdAt",
               o."canonicalUrl", o."applicationUrl", o."atsPlatform", o."location", o."remoteStatus",
               o."workArrangements", o."residencyRegions", o."workAuthorizationRegions",
               (SELECT d."reasonCode" FROM "DeferredEvaluation" d
                 WHERE d."opportunityId" = o."id" AND d."status" = 'DEFERRED'
                 ORDER BY d."createdAt" DESC, d."id" DESC LIMIT 1) AS "openDeferralReason",
               (SELECT MIN(a."createdAt") FROM "OpportunityUserAction" a
                 WHERE a."opportunityId" = o."id" AND a."action" = 'MARK_APPLIED') AS "markedAppliedAt",
               -- The newer side of an unresolved probable pair (the listing whose
               -- arrival raised it), so one pair counts once.
               EXISTS (SELECT 1 FROM "DuplicateReference" dr
                 WHERE dr."decision" = 'PROBABLE_MATCH' AND dr."resolution" IS NULL
                   AND dr."opportunityId" = o."id") AS "probableUnresolved",
               ${noLongerListedCondition} AS "noLongerListed"
        FROM "Opportunity" o LEFT JOIN "Company" c ON c."id" = o."companyId"
      `,
      this.database.$queryRaw<
        Array<{
          id: string;
          opportunityId: string;
          status: string;
          createdAt: Date;
          completedAt: Date | null;
          decision: string | null;
          knownCost: Prisma.Decimal | null;
          unknownCostAttempts: bigint;
        }>
      >`
        SELECT e."id", e."opportunityId", e."status"::text AS status, e."createdAt", e."completedAt",
               r."decision",
               (SELECT COALESCE(SUM(a."estimatedCost"), 0) FROM "SemanticOperationAttempt" a
                  LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
                 WHERE a."evaluationId" = e."id" AND a."estimatedCost" IS NOT NULL AND p."currency" = ${currency}) AS "knownCost",
               (SELECT COUNT(*) FROM "SemanticOperationAttempt" a
                  LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
                 WHERE a."evaluationId" = e."id"
                   AND NOT (a."estimatedCost" IS NOT NULL AND p."currency" IS NOT NULL AND p."currency" = ${currency})) AS "unknownCostAttempts"
        FROM "Evaluation" e LEFT JOIN "Recommendation" r ON r."evaluationId" = e."id"
      `,
      this.database.application.findMany({
        select: {
          opportunityId: true,
          stage: true,
          outcome: true,
          appliedOn: true,
          createdAt: true,
          events: { select: { type: true, toStage: true, outcome: true, occurredOn: true, createdAt: true } },
          interviews: { select: { status: true, scheduledAt: true, createdAt: true } },
        },
      }),
      this.database.$queryRaw<
        Array<{ retrievalSourceId: string; createdAt: Date; status: string; errorCode: string | null; fetched: string | null; keptByTerms: string | null }>
      >`
        SELECT r."retrievalSourceId", r."createdAt", r."status"::text AS status, r."errorCode",
               r."counts"->>'fetched' AS fetched, r."counts"->>'keptByTerms' AS "keptByTerms"
        FROM "RetrievalRun" r
      `,
    ]);

    const evaluationsByOpportunity = new Map<string, SiEvaluationFact[]>();
    for (const row of evaluations) {
      const list = evaluationsByOpportunity.get(row.opportunityId) ?? [];
      list.push({
        id: row.id,
        status: row.status as SiEvaluationStatus,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        decision: row.decision,
        knownCost: input.currency ? Number(row.knownCost ?? 0) : 0,
        unknownCostAttempts: Number(row.unknownCostAttempts),
      });
      evaluationsByOpportunity.set(row.opportunityId, list);
    }
    const applicationsByOpportunity = new Map<string, SiApplicationFact>(
      applications.map((application) => [
        application.opportunityId,
        {
          stage: application.stage,
          outcome: application.outcome,
          appliedOn: application.appliedOn,
          createdAt: application.createdAt,
          events: application.events.map((event) => ({
            type: event.type,
            toStage: event.toStage,
            outcome: event.outcome,
            at: event.occurredOn ?? event.createdAt,
          })),
          interviews: application.interviews.map((interview) => ({ status: interview.status, at: interview.scheduledAt ?? interview.createdAt })),
        },
      ]),
    );
    const number = (value: string | null) => {
      if (value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        adapterKey: source.adapterKey,
        category: source.sourceCategory as SourceCategory,
        enabled: source.enabled,
        archived: source.archivedAt !== null,
      })),
      listings: listings.map(
        (row): SiListingFact => ({
          recordId: row.id,
          opportunityId: row.opportunityId,
          source: row.source,
          sourceType: row.sourceType,
          sourceCategory: row.sourceCategory as SourceCategory | null,
          retrievalSourceId: row.retrievalSourceId,
          captureSite: row.captureSite,
          externalId: row.externalId,
          duplicateDecision: row.duplicateDecision as SiDuplicateDecision | null,
          sourceUrl: row.sourceUrl,
          applicationUrl: row.applicationUrl,
          createdAt: row.createdAt,
        }),
      ),
      ledger: ledger.map((row) => ({
        retrievalSourceId: row.retrievalSourceId,
        externalId: row.externalId,
        opportunityId: row.opportunityId,
        firstSeenAt: row.firstSeenAt,
        state: row.state as SiLedgerState,
      })),
      pendingDetails: pending.map((row) => ({ retrievalSourceId: row.retrievalSourceId, count: Number(row.count) })),
      opportunities: opportunities.map(
        (row): SiOpportunityFact => ({
          id: row.id,
          title: row.title,
          company: row.company,
          status: row.status,
          createdAt: row.createdAt,
          canonicalUrl: row.canonicalUrl,
          applicationUrl: row.applicationUrl,
          atsPlatform: row.atsPlatform,
          location: row.location,
          remoteStatus: row.remoteStatus,
          workArrangements: row.workArrangements ?? [],
          residencyRegions: row.residencyRegions ?? [],
          workAuthorizationRegions: row.workAuthorizationRegions ?? [],
          evaluations: evaluationsByOpportunity.get(row.id) ?? [],
          openDeferralReason: row.openDeferralReason ? normalizeDeferralReason(row.openDeferralReason) : null,
          markedAppliedAt: row.markedAppliedAt,
          application: applicationsByOpportunity.get(row.id) ?? null,
          probableUnresolved: row.probableUnresolved,
          noLongerListed: row.noLongerListed ?? false,
        }),
      ),
      runs: runs.map(
        (row): SiRunFact => ({
          retrievalSourceId: row.retrievalSourceId,
          createdAt: row.createdAt,
          status: row.status as RetrievalRunStatusValue,
          errorCode: row.errorCode,
          fetched: number(row.fetched),
          keptByTerms: number(row.keptByTerms),
        }),
      ),
    };
  }
}
