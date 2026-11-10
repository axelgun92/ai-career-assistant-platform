import type { CiApplicationFact, CiCompanyFact, CiEvaluationFact, CiFacts, CiOpportunityFact, CiRecordFact, PostingHistoryListing, SourceCategory } from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

// Company Intelligence read model (feature 18). Read-only: every query is a
// SELECT over persisted companies, opportunities, source records, the Feature
// 13 listing ledger, duplicate references, evaluations and the application
// tracker. It writes nothing, stores no aggregate, and never calls a provider.
// Metrics are derived by the pure Core module (company-intelligence.ts).
//
// Evaluated facts are read from each Evaluation.domainResult by JSON path, as
// stored and never re-run: the company-side Company Alignment
// classifications customerSegment, customerType and businessModel. Ghost Job
// Risk and every profile-relative output are not read.

type OpportunityRow = Omit<CiOpportunityFact, "origin" | "listings" | "records" | "evaluations" | "application" | "workArrangements" | "residencyRegions" | "employerOfRecordRegions"> & {
  workArrangements: string[] | null;
  residencyRegions: string[] | null;
  employerOfRecordRegions: string[] | null;
  originSource: string | null;
  originSourceType: string | null;
  originRetrievalSourceId: string | null;
  originCaptureSite: string | null;
  originExternalId: string | null;
};

type ListingRow = Omit<PostingHistoryListing, "currentScope"> & { opportunityId: string; currentScope: boolean };
type RecordRow = Omit<CiRecordFact, "matchedOn"> & { opportunityId: string; matchedOn: unknown };
type EvaluationRow = CiEvaluationFact & { opportunityId: string };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export class PrismaCompanyIntelligenceRepository {
  private readonly database = getDatabaseClient();

  // Every Company row in the same normalized-name group as the given id (the
  // dashboard's company grouping); empty when the id is not a company.
  async companyGroupIds(companyId: string): Promise<string[]> {
    const rows = await this.database.$queryRaw<Array<{ id: string }>>`
      SELECT c."id"::text AS id FROM "Company" c
      WHERE COALESCE(c."normalizedName", c."id"::text) = (
        SELECT COALESCE(t."normalizedName", t."id"::text) FROM "Company" t WHERE t."id" = ${companyId}::uuid
      )
      ORDER BY c."createdAt" ASC, c."id" ASC
    `;
    return rows.map((row) => row.id);
  }

  // The company an opportunity links to, for the opportunity page's link.
  async companyIdForOpportunity(opportunityId: string): Promise<string | null> {
    const row = await this.database.opportunity.findUnique({ where: { id: opportunityId }, select: { companyId: true } });
    return row?.companyId ?? null;
  }

  // The facts for every company, or only for the given Company rows.
  async facts(companyIds?: readonly string[]): Promise<CiFacts> {
    const ids = companyIds ? [...companyIds] : null;
    const companyScope = ids ? Prisma.sql`WHERE c."id" = ANY(${ids}::uuid[])` : Prisma.empty;
    const opportunityScope = ids ? Prisma.sql`o."companyId" = ANY(${ids}::uuid[])` : Prisma.sql`o."companyId" IS NOT NULL`;
    const scoped = (alias: string) =>
      Prisma.sql`${Prisma.raw(alias)}."opportunityId" IN (SELECT o."id" FROM "Opportunity" o WHERE ${opportunityScope})`;

    const [sources, companies, opportunities, withoutCompany, listings, records, evaluations, pairs, applications] = await Promise.all([
      this.database.retrievalSource.findMany({
        select: { id: true, name: true, adapterKey: true, sourceCategory: true, enabled: true, archivedAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.database.$queryRaw<CiCompanyFact[]>`
        SELECT c."id"::text AS id, c."name", c."normalizedName", c."createdAt" FROM "Company" c ${companyScope}
        ORDER BY c."createdAt" ASC, c."id" ASC
      `,
      this.database.$queryRaw<OpportunityRow[]>`
        SELECT o."id"::text AS id, o."companyId"::text AS "companyId", o."title", o."firstSeenAt", o."lastSeenAt", o."postingDate", o."closingDate",
               o."salaryText", o."location", o."remoteStatus", o."workArrangements", o."residencyRequirement", o."residencyRegions",
               o."visaSponsorship", o."relocationSupport", o."employerOfRecordRegions",
               origin."source" AS "originSource", origin."sourceType" AS "originSourceType",
               origin."retrievalSourceId" AS "originRetrievalSourceId", origin."captureSite" AS "originCaptureSite",
               origin."externalId" AS "originExternalId",
               (SELECT MIN(a."createdAt") FROM "OpportunityUserAction" a
                 WHERE a."opportunityId" = o."id" AND a."action" = 'MARK_APPLIED') AS "markedAppliedAt"
        FROM "Opportunity" o
        -- The originating listing: the earliest chain head by (createdAt, id),
        -- Feature 15's first-discovery rule.
        LEFT JOIN LATERAL (
          SELECT sr."source", sr."sourceType"::text AS "sourceType", sr."retrievalSourceId"::text AS "retrievalSourceId",
                 sr."sourceMetadata"->'capture'->>'site' AS "captureSite", sr."externalId"
          FROM "SourceRecord" sr
          WHERE sr."opportunityId" = o."id" AND sr."previousSourceRecordId" IS NULL
          ORDER BY sr."createdAt" ASC, sr."id" ASC LIMIT 1
        ) origin ON TRUE
        WHERE ${opportunityScope}
        ORDER BY o."createdAt" ASC, o."id" ASC
      `,
      ids ? Promise.resolve(0) : this.database.opportunity.count({ where: { companyId: null } }),
      this.database.$queryRaw<ListingRow[]>`
        SELECT l."opportunityId"::text AS "opportunityId", s."name" AS "sourceName", s."sourceCategory"::text AS "sourceCategory",
               s."scheduleMinutes", l."removalCapable", l."trackingScopeKey" = COALESCE(s."trackingScopeKey", '') AS "currentScope",
               l."state"::text AS state, l."firstSeenAt", l."lastSeenAt", l."missingSince", l."removedAt", l."reappearedAt",
               l."reappearances", l."sourceExpiresAt"
        FROM "RetrievedListing" l JOIN "RetrievalSource" s ON s."id" = l."retrievalSourceId"
        WHERE ${scoped("l")}
        ORDER BY l."firstSeenAt" ASC, l."id" ASC
      `,
      this.database.$queryRaw<RecordRow[]>`
        SELECT sr."opportunityId"::text AS "opportunityId", sr."source", COALESCE(rs."name", sr."source") AS "sourceName", sr."externalId",
               sr."createdAt", sr."discoveredAt", sr."lastObservedAt", sr."retrievalType" IS NOT NULL AS retrieved,
               EXISTS (SELECT 1 FROM "SourceRecord" later WHERE later."previousSourceRecordId" = sr."id") AS superseded,
               sr."previousSourceRecordId" IS NOT NULL AS changed,
               CASE WHEN sr."duplicateDecision" = 'MATCH' THEN sr."duplicateEvidence"->'matchedOn' END AS "matchedOn"
        FROM "SourceRecord" sr LEFT JOIN "RetrievalSource" rs ON rs."id" = sr."retrievalSourceId"
        WHERE ${scoped("sr")}
        ORDER BY sr."createdAt" ASC, sr."id" ASC
      `,
      this.database.$queryRaw<EvaluationRow[]>`
        SELECT e."id"::text AS id, e."opportunityId"::text AS "opportunityId", e."status"::text AS status, e."createdAt", e."completedAt",
               e."domainResult" #>> '{companyAlignment,alignment,customerSegment,classification}' AS "customerSegment",
               e."domainResult" #>> '{companyAlignment,alignment,customerType,classification}' AS "customerType",
               e."domainResult" #>> '{companyAlignment,alignment,businessModel,classification}' AS "businessModel"
        FROM "Evaluation" e
        WHERE ${scoped("e")}
        ORDER BY e."createdAt" ASC, e."id" ASC
      `,
      this.database.$queryRaw<Array<{ a: string; b: string }>>`
        SELECT d."opportunityId"::text AS a, d."relatedOpportunityId"::text AS b FROM "DuplicateReference" d
        WHERE d."decision" = 'PROBABLE_MATCH' AND d."resolution" IS NULL AND ${scoped("d")}
      `,
      this.database.application.findMany({
        where: { opportunity: ids ? { companyId: { in: ids } } : { companyId: { not: null } } },
        select: {
          opportunityId: true,
          stage: true,
          outcome: true,
          appliedOn: true,
          closedOn: true,
          createdAt: true,
          events: { select: { type: true, toStage: true, outcome: true, occurredOn: true, createdAt: true } },
          interviews: { select: { status: true, kind: true, scheduledAt: true, createdAt: true } },
        },
      }),
    ]);

    const listingsBy = new Map<string, PostingHistoryListing[]>();
    for (const { opportunityId, ...row } of listings) push(listingsBy, opportunityId, row);
    const recordsBy = new Map<string, CiRecordFact[]>();
    for (const { opportunityId, matchedOn, ...row } of records) push(recordsBy, opportunityId, { ...row, matchedOn: strings(matchedOn) });
    const evaluationsBy = new Map<string, CiEvaluationFact[]>();
    for (const { opportunityId, ...row } of evaluations) push(evaluationsBy, opportunityId, row);
    const applicationsBy = new Map<string, CiApplicationFact>(
      applications.map((application) => [
        application.opportunityId,
        {
          stage: application.stage,
          outcome: application.outcome,
          appliedOn: application.appliedOn,
          closedOn: application.closedOn,
          createdAt: application.createdAt,
          // Feature 15/17's event date: the stated date, else when it was recorded.
          events: application.events.map((event) => ({
            type: event.type,
            toStage: event.toStage,
            outcome: event.outcome,
            at: event.occurredOn ?? event.createdAt,
            occurredOn: event.occurredOn,
            recordedAt: event.createdAt,
          })),
          interviews: application.interviews.map((interview) => ({
            status: interview.status,
            kind: interview.kind,
            at: interview.scheduledAt ?? interview.createdAt,
            scheduledAt: interview.scheduledAt,
            recordedAt: interview.createdAt,
          })),
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
      companies,
      withoutCompany,
      probablePairs: pairs.map((pair) => [pair.a, pair.b]),
      opportunities: opportunities.map(({ originSource, originSourceType, originRetrievalSourceId, originCaptureSite, originExternalId, ...row }) => ({
        ...row,
        workArrangements: row.workArrangements ?? [],
        residencyRegions: row.residencyRegions ?? [],
        employerOfRecordRegions: row.employerOfRecordRegions ?? [],
        origin: originSource
          ? { source: originSource, sourceType: originSourceType ?? "OTHER", retrievalSourceId: originRetrievalSourceId, captureSite: originCaptureSite, externalId: originExternalId }
          : null,
        listings: listingsBy.get(row.id) ?? [],
        records: recordsBy.get(row.id) ?? [],
        evaluations: evaluationsBy.get(row.id) ?? [],
        application: applicationsBy.get(row.id) ?? null,
      })),
    };
  }
}
