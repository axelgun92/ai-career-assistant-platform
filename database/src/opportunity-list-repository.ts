import type { OpportunityLifecycleState } from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

export const opportunityListDefaultLimit = 100;
export const opportunityListMaximumLimit = 200;

export interface OpportunityListItem {
  id: string;
  domain: string | null;
  status: string;
  source: string | null;
  sourceType: string | null;
  title: string | null;
  companyName: string | null;
  location: string | null;
  salaryText: string | null;
  postingDate: Date | null;
  createdAt: Date;
  discoveredAt: Date;
  updatedAt: Date;
  applicationUrl: string | null;
  // An evaluation request is waiting in the deferred backlog.
  deferred: boolean;
  latestEvaluation: {
    id: string;
    status: string;
    decision: string | null;
    createdAt: Date;
    completedAt: Date | null;
  } | null;
  // From the latest completed evaluation (the latest Recommendation row).
  // It stays the current recommendation while a reevaluation is queued,
  // running, or has failed. Values are read from the persisted result as-is.
  currentRecommendation: {
    decision: string;
    evaluationId: string;
    isLatest: boolean;
  } | null;
  priorityBand: string | null;
  roleFamily: string | null;
  customerSegment: string | null;
}

// Stored filter values (see apps/web/src/server/opportunity-query.ts).
export interface OpportunityListFilters {
  statuses?: readonly OpportunityLifecycleState[];
  searchTerms?: string[];
  recommendations?: string[];
  evaluationStates?: string[];
  priorityBands?: string[];
  roleFamilies?: string[];
  segments?: string[];
  sourceTypes?: string[];
  source?: string | null;
  companyId?: string | null;
  domain?: string | null;
  titleContains?: string | null;
  locationContains?: string | null;
  salaryStated?: boolean | null;
  discoveredFrom?: Date | null;
  discoveredBefore?: Date | null;
}

export type OpportunityListSort = "newest" | "oldest" | "updated" | "priority" | "company" | "title";

export interface OpportunityListPage {
  items: OpportunityListItem[];
  total: number;
  page: number;
  requestedPage: number;
  pageCount: number;
  pageSize: number;
}

// The latest evaluation per opportunity (any status), the current
// recommendation with values read from its persisted Customer Success result,
// and open deferrals. Read-only JSON paths into Evaluation.domainResult:
// opportunityPriority.band, hardFilters.role.classification,
// companyAlignment.alignment.customerSegment.classification.
const withClause = Prisma.sql`
  WITH latest_eval AS (
    SELECT DISTINCT ON (e."opportunityId")
      e."opportunityId", e."id", e."createdAt", e."completedAt",
      COALESCE(t."status"::text, e."status"::text) AS "status"
    FROM "Evaluation" e
    LEFT JOIN "EvaluationTask" t ON t."evaluationId" = e."id"
    ORDER BY e."opportunityId", e."createdAt" DESC, e."id" DESC
  ),
  current_rec AS (
    SELECT DISTINCT ON (r."opportunityId")
      r."opportunityId", r."decision", r."evaluationId",
      ev."domainResult" #>> '{opportunityPriority,band}' AS "band",
      ev."domainResult" #>> '{hardFilters,role,classification}' AS "roleFamily",
      ev."domainResult" #>> '{companyAlignment,alignment,customerSegment,classification}' AS "segment"
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
  LEFT JOIN "Company" c ON c."id" = o."companyId"
  LEFT JOIN latest_eval le ON le."opportunityId" = o."id"
  LEFT JOIN current_rec cr ON cr."opportunityId" = o."id"
  LEFT JOIN open_deferral od ON od."opportunityId" = o."id"
`;

// Contract enum order of the priority band (lowest → highest).
const priorityRank = Prisma.sql`CASE cr."band"
  WHEN 'VERY_HIGH' THEN 5 WHEN 'HIGH' THEN 4 WHEN 'MIXED_MODERATE' THEN 3
  WHEN 'LOW' THEN 2 WHEN 'VERY_LOW' THEN 1 ELSE NULL END`;

export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function anyOf(conditions: Prisma.Sql[]): Prisma.Sql | null {
  return conditions.length ? Prisma.sql`(${Prisma.join(conditions, " OR ")})` : null;
}

// Values matched against `column`, plus an optional "missing" value that
// matches NULL. Returns null when no values are selected.
function valuesOrMissing(column: Prisma.Sql, values: string[] | undefined, missing: string): Prisma.Sql | null {
  if (!values?.length) return null;
  const present = values.filter((value) => value !== missing);
  return anyOf([
    ...(present.length ? [Prisma.sql`${column} IN (${Prisma.join(present)})`] : []),
    ...(values.includes(missing) ? [Prisma.sql`${column} IS NULL`] : []),
  ]);
}

const evaluationStateConditions: Record<string, Prisma.Sql> = {
  NONE: Prisma.sql`le."id" IS NULL`,
  QUEUED: Prisma.sql`le."status" = 'PENDING'`,
  RUNNING: Prisma.sql`le."status" = 'RUNNING'`,
  COMPLETED: Prisma.sql`le."status" = 'COMPLETED'`,
  FAILED: Prisma.sql`le."status" = 'FAILED'`,
  DEFERRED: Prisma.sql`od."opportunityId" IS NOT NULL`,
};

const searchColumns = [
  Prisma.sql`o."title"`,
  Prisma.sql`c."name"`,
  Prisma.sql`o."location"`,
  Prisma.sql`o."source"`,
  Prisma.sql`o."originalSource"`,
  Prisma.sql`o."salaryText"`,
  Prisma.sql`o."externalListingId"`,
  Prisma.sql`o."atsRequisitionId"`,
];

// The single filter predicate used by both the count and the item query, so
// their results can never disagree.
export function buildFilterPredicate(filters: OpportunityListFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  const add = (condition: Prisma.Sql | null) => {
    if (condition) conditions.push(condition);
  };
  if (filters.statuses) {
    add(filters.statuses.length
      ? Prisma.sql`o."status"::text IN (${Prisma.join([...filters.statuses])})`
      : Prisma.sql`FALSE`);
  }
  for (const term of filters.searchTerms ?? []) {
    const pattern = `%${escapeLikePattern(term)}%`;
    add(anyOf(searchColumns.map((column) => Prisma.sql`${column} ILIKE ${pattern} ESCAPE '\\'`)));
  }
  add(valuesOrMissing(Prisma.sql`cr."decision"`, filters.recommendations, "NONE"));
  add(anyOf((filters.evaluationStates ?? []).flatMap((state) => evaluationStateConditions[state] ?? [])));
  add(valuesOrMissing(Prisma.sql`cr."band"`, filters.priorityBands, "UNKNOWN"));
  add(valuesOrMissing(Prisma.sql`cr."roleFamily"`, filters.roleFamilies, "UNKNOWN"));
  add(valuesOrMissing(Prisma.sql`cr."segment"`, filters.segments, "NOT_EVALUATED"));
  if (filters.sourceTypes?.length) add(Prisma.sql`o."sourceType"::text IN (${Prisma.join(filters.sourceTypes)})`);
  if (filters.source) add(Prisma.sql`o."source" = ${filters.source}`);
  if (filters.companyId) add(Prisma.sql`o."companyId" = ${filters.companyId}::uuid`);
  if (filters.domain) add(Prisma.sql`o."domain" = ${filters.domain}`);
  if (filters.titleContains) {
    add(Prisma.sql`o."title" ILIKE ${`%${escapeLikePattern(filters.titleContains)}%`} ESCAPE '\\'`);
  }
  if (filters.locationContains) {
    add(Prisma.sql`o."location" ILIKE ${`%${escapeLikePattern(filters.locationContains)}%`} ESCAPE '\\'`);
  }
  if (filters.salaryStated === true) add(Prisma.sql`NULLIF(btrim(o."salaryText"), '') IS NOT NULL`);
  if (filters.salaryStated === false) add(Prisma.sql`NULLIF(btrim(o."salaryText"), '') IS NULL`);
  if (filters.discoveredFrom) add(Prisma.sql`o."discoveredAt" >= ${filters.discoveredFrom}`);
  if (filters.discoveredBefore) add(Prisma.sql`o."discoveredAt" < ${filters.discoveredBefore}`);
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

// Whitelisted orderings. Unknown values sort last; every order ends with the
// same tie-breakers so results and pages are deterministic.
const tieBreakers = Prisma.sql`o."discoveredAt" DESC, o."id" DESC`;
const sortOrders: Record<OpportunityListSort, Prisma.Sql> = {
  newest: tieBreakers,
  oldest: Prisma.sql`o."discoveredAt" ASC, o."id" DESC`,
  updated: Prisma.sql`o."updatedAt" DESC, ${tieBreakers}`,
  priority: Prisma.sql`${priorityRank} DESC NULLS LAST, ${tieBreakers}`,
  company: Prisma.sql`lower(NULLIF(btrim(c."name"), '')) ASC NULLS LAST, ${tieBreakers}`,
  title: Prisma.sql`lower(NULLIF(btrim(o."title"), '')) ASC NULLS LAST, ${tieBreakers}`,
};

type Row = {
  id: string;
  domain: string | null;
  status: string;
  source: string | null;
  sourceType: string | null;
  title: string | null;
  companyName: string | null;
  location: string | null;
  salaryText: string | null;
  postingDate: Date | null;
  createdAt: Date;
  discoveredAt: Date;
  updatedAt: Date;
  applicationUrl: string | null;
  deferred: boolean;
  latestId: string | null;
  latestStatus: string | null;
  latestCreatedAt: Date | null;
  latestCompletedAt: Date | null;
  recDecision: string | null;
  recEvaluationId: string | null;
  priorityBand: string | null;
  roleFamily: string | null;
  customerSegment: string | null;
};

function toItem(row: Row): OpportunityListItem {
  const latestIsRecommended = row.latestId !== null && row.latestId === row.recEvaluationId;
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    source: row.source,
    sourceType: row.sourceType,
    title: row.title,
    companyName: row.companyName,
    location: row.location,
    salaryText: row.salaryText,
    postingDate: row.postingDate,
    createdAt: row.createdAt,
    discoveredAt: row.discoveredAt,
    updatedAt: row.updatedAt,
    applicationUrl: row.applicationUrl,
    deferred: row.deferred,
    latestEvaluation: row.latestId
      ? {
          id: row.latestId,
          // Match the evaluation API: queue/task state is the user-visible status.
          status: row.latestStatus ?? "UNKNOWN",
          decision: latestIsRecommended ? row.recDecision : null,
          createdAt: row.latestCreatedAt!,
          completedAt: row.latestCompletedAt,
        }
      : null,
    currentRecommendation:
      row.recDecision && row.recEvaluationId
        ? { decision: row.recDecision, evaluationId: row.recEvaluationId, isLatest: latestIsRecommended }
        : null,
    priorityBand: row.priorityBand,
    roleFamily: row.roleFamily,
    customerSegment: row.customerSegment,
  };
}

function clamp(requestedPage: number, total: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { pageCount, page: Math.min(Math.max(1, requestedPage), pageCount) };
}

export class PrismaOpportunityListRepository {
  private readonly database = getDatabaseClient();

  // Count first, then the clamped page, in one read-only snapshot.
  async listPage(input: {
    filters: OpportunityListFilters;
    sort: OpportunityListSort;
    page: number;
    pageSize: number;
  }): Promise<OpportunityListPage> {
    const pageSize = Math.min(Math.max(Math.trunc(input.pageSize) || 1, 1), opportunityListMaximumLimit);
    const requestedPage = Number.isInteger(input.page) && input.page >= 1 ? input.page : 1;
    const predicate = buildFilterPredicate(input.filters);
    return this.database.$transaction(
      async (transaction) => {
        const [count] = await transaction.$queryRaw<Array<{ total: number }>>`
          ${withClause} SELECT COUNT(*)::int AS "total" ${joins} ${predicate}
        `;
        const total = count?.total ?? 0;
        const { page, pageCount } = clamp(requestedPage, total, pageSize);
        if (total === 0) return { items: [], total, page, requestedPage, pageCount, pageSize };
        const rows = await transaction.$queryRaw<Row[]>`
          ${withClause}
          SELECT
            o."id", o."domain", o."status"::text AS "status", o."source", o."sourceType"::text AS "sourceType",
            o."title", c."name" AS "companyName", o."location", o."salaryText", o."postingDate",
            o."createdAt", o."discoveredAt", o."updatedAt", o."applicationUrl",
            (od."opportunityId" IS NOT NULL) AS "deferred",
            le."id" AS "latestId", le."status" AS "latestStatus",
            le."createdAt" AS "latestCreatedAt", le."completedAt" AS "latestCompletedAt",
            cr."decision" AS "recDecision", cr."evaluationId" AS "recEvaluationId",
            cr."band" AS "priorityBand", cr."roleFamily" AS "roleFamily", cr."segment" AS "customerSegment"
          ${joins} ${predicate}
          ORDER BY ${sortOrders[input.sort] ?? sortOrders.newest}
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `;
        return { items: rows.map(toItem), total, page, requestedPage, pageCount, pageSize };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  // Original list API: newest first, optionally limited to lifecycle states.
  async listOpportunities(
    input: { limit?: number; statuses?: readonly OpportunityLifecycleState[] } = {},
  ): Promise<OpportunityListItem[]> {
    const limit = Math.min(Math.max(input.limit ?? opportunityListDefaultLimit, 1), opportunityListMaximumLimit);
    const result = await this.listPage({
      filters: { statuses: input.statuses },
      sort: "newest",
      page: 1,
      pageSize: limit,
    });
    return result.items;
  }
}
