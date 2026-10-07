import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

export interface DashboardSummary {
  total: number;
  // Lifecycle groups, matching the dashboard views.
  active: number;
  toTriage: number;
  saved: number;
  applied: number;
  dismissed: number;
  archived: number;
  // Within the Active view.
  activeNotEvaluated: number;
  activeFailed: number;
  // Within the To-triage view: current recommendation APPLY, not yet acted on.
  triageRecommendedApply: number;
  // Across all opportunities.
  evaluated: number;
  notEvaluated: number;
  queued: number;
  running: number;
  deferred: number;
  recommendations: { APPLY: number; REVIEW: number; SKIP: number; NONE: number };
  discoveredLast7Days: number;
  discoveredLast30Days: number;
  bySourceType: Array<{ sourceType: string | null; count: number }>;
  // Among opportunities with a completed evaluation.
  byPriorityBand: Array<{ band: string | null; count: number }>;
}

export interface DashboardFilterOptions {
  sources: Array<{ value: string; count: number }>;
  domains: Array<{ value: string; count: number }>;
  companies: Array<{ id: string; name: string; count: number }>;
}

const withClause = Prisma.sql`
  WITH latest_eval AS (
    SELECT DISTINCT ON (e."opportunityId")
      e."opportunityId", e."id", COALESCE(t."status"::text, e."status"::text) AS "status"
    FROM "Evaluation" e
    LEFT JOIN "EvaluationTask" t ON t."evaluationId" = e."id"
    ORDER BY e."opportunityId", e."createdAt" DESC, e."id" DESC
  ),
  current_rec AS (
    SELECT DISTINCT ON (r."opportunityId")
      r."opportunityId", r."decision", ev."domainResult" #>> '{opportunityPriority,band}' AS "band"
    FROM "Recommendation" r
    JOIN "Evaluation" ev ON ev."id" = r."evaluationId"
    ORDER BY r."opportunityId", r."createdAt" DESC, r."id" DESC
  ),
  open_deferral AS (
    SELECT DISTINCT d."opportunityId" FROM "DeferredEvaluation" d WHERE d."status" = 'DEFERRED'
  )
`;

const joins = Prisma.sql`
  FROM "Opportunity" o
  LEFT JOIN latest_eval le ON le."opportunityId" = o."id"
  LEFT JOIN current_rec cr ON cr."opportunityId" = o."id"
  LEFT JOIN open_deferral od ON od."opportunityId" = o."id"
`;

const active = Prisma.sql`o."status"::text IN ('NORMALIZED', 'EVALUATED', 'RECOMMENDED', 'SAVED')`;
const triage = Prisma.sql`o."status"::text IN ('NORMALIZED', 'EVALUATED', 'RECOMMENDED')`;

// Read-only aggregate counts over persisted data for the dashboard. Each
// count matches exactly the filtered dashboard view it links to.
export class PrismaOpportunityDashboardRepository {
  private readonly database = getDatabaseClient();

  async summarize(now: Date = new Date()): Promise<DashboardSummary> {
    const days = (count: number) => new Date(now.getTime() - count * 86_400_000);
    const [counts] = await this.database.$queryRaw<Array<Record<string, number>>>`
      ${withClause}
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE ${active})::int AS "active",
        COUNT(*) FILTER (WHERE ${triage})::int AS "toTriage",
        COUNT(*) FILTER (WHERE o."status" = 'SAVED')::int AS "saved",
        COUNT(*) FILTER (WHERE o."status" = 'APPLIED')::int AS "applied",
        COUNT(*) FILTER (WHERE o."status" = 'REJECTED_BY_USER')::int AS "dismissed",
        COUNT(*) FILTER (WHERE o."status"::text IN ('ARCHIVED', 'CLOSED'))::int AS "archived",
        COUNT(*) FILTER (WHERE ${active} AND le."id" IS NULL)::int AS "activeNotEvaluated",
        COUNT(*) FILTER (WHERE ${active} AND le."status" = 'FAILED')::int AS "activeFailed",
        COUNT(*) FILTER (WHERE ${triage} AND cr."decision" = 'APPLY')::int AS "triageRecommendedApply",
        COUNT(*) FILTER (WHERE le."id" IS NOT NULL)::int AS "evaluated",
        COUNT(*) FILTER (WHERE le."id" IS NULL)::int AS "notEvaluated",
        COUNT(*) FILTER (WHERE le."status" = 'PENDING')::int AS "queued",
        COUNT(*) FILTER (WHERE le."status" = 'RUNNING')::int AS "running",
        COUNT(*) FILTER (WHERE od."opportunityId" IS NOT NULL)::int AS "deferred",
        COUNT(*) FILTER (WHERE cr."decision" = 'APPLY')::int AS "recApply",
        COUNT(*) FILTER (WHERE cr."decision" = 'REVIEW')::int AS "recReview",
        COUNT(*) FILTER (WHERE cr."decision" = 'SKIP')::int AS "recSkip",
        COUNT(*) FILTER (WHERE cr."decision" IS NULL)::int AS "recNone",
        COUNT(*) FILTER (WHERE o."discoveredAt" >= ${days(7)})::int AS "last7",
        COUNT(*) FILTER (WHERE o."discoveredAt" >= ${days(30)})::int AS "last30"
      ${joins}
    `;
    const bySourceType = await this.database.$queryRaw<Array<{ sourceType: string | null; count: number }>>`
      SELECT o."sourceType"::text AS "sourceType", COUNT(*)::int AS "count"
      FROM "Opportunity" o
      GROUP BY o."sourceType"
      ORDER BY COUNT(*) DESC, o."sourceType" ASC NULLS LAST
    `;
    const byPriorityBand = await this.database.$queryRaw<Array<{ band: string | null; count: number }>>`
      ${withClause}
      SELECT cr."band" AS "band", COUNT(*)::int AS "count"
      ${joins}
      WHERE cr."opportunityId" IS NOT NULL
      GROUP BY cr."band"
    `;
    const c = counts ?? {};
    const n = (key: string) => Number(c[key] ?? 0);
    return {
      total: n("total"),
      active: n("active"),
      toTriage: n("toTriage"),
      saved: n("saved"),
      applied: n("applied"),
      dismissed: n("dismissed"),
      archived: n("archived"),
      activeNotEvaluated: n("activeNotEvaluated"),
      activeFailed: n("activeFailed"),
      triageRecommendedApply: n("triageRecommendedApply"),
      evaluated: n("evaluated"),
      notEvaluated: n("notEvaluated"),
      queued: n("queued"),
      running: n("running"),
      deferred: n("deferred"),
      recommendations: { APPLY: n("recApply"), REVIEW: n("recReview"), SKIP: n("recSkip"), NONE: n("recNone") },
      discoveredLast7Days: n("last7"),
      discoveredLast30Days: n("last30"),
      bySourceType,
      byPriorityBand,
    };
  }

  async filterOptions(): Promise<DashboardFilterOptions> {
    const [sources, domains, companies] = await Promise.all([
      this.database.$queryRaw<Array<{ value: string; count: number }>>`
        SELECT o."source" AS "value", COUNT(*)::int AS "count" FROM "Opportunity" o
        WHERE o."source" IS NOT NULL GROUP BY o."source" ORDER BY o."source" ASC LIMIT 200
      `,
      this.database.$queryRaw<Array<{ value: string; count: number }>>`
        SELECT o."domain" AS "value", COUNT(*)::int AS "count" FROM "Opportunity" o
        WHERE o."domain" IS NOT NULL GROUP BY o."domain" ORDER BY o."domain" ASC LIMIT 200
      `,
      this.database.$queryRaw<Array<{ id: string; name: string; count: number }>>`
        SELECT c."id" AS "id", c."name" AS "name", COUNT(o."id")::int AS "count"
        FROM "Company" c JOIN "Opportunity" o ON o."companyId" = c."id"
        GROUP BY c."id", c."name" ORDER BY lower(c."name") ASC, c."id" ASC LIMIT 200
      `,
    ]);
    return { sources, domains, companies };
  }
}
