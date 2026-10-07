import {
  addDays,
  followUpState,
  toIsoDate,
  utcToday,
  type ApplicationOutcome,
  type ApplicationStage,
  type FollowUpState,
} from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import { escapeLikePattern } from "./opportunity-list-repository";

export const applicationListMaximumPageSize = 100;

export type ApplicationListView = "active" | "closed" | "all";
export type ApplicationFollowUpFilter = "overdue" | "due" | "today" | "upcoming" | "none";
export type ApplicationListSort = "next-action" | "applied-newest" | "applied-oldest" | "updated" | "company";

export interface ApplicationListFilters {
  view: ApplicationListView;
  stages?: ApplicationStage[];
  outcomes?: ApplicationOutcome[];
  followUp?: ApplicationFollowUpFilter | null;
  searchTerms?: string[];
  appliedFrom?: string | null;
  appliedTo?: string | null;
}

export interface ApplicationListItem {
  id: string;
  opportunityId: string;
  title: string | null;
  companyName: string | null;
  opportunityStatus: string;
  stage: ApplicationStage;
  outcome: ApplicationOutcome | null;
  appliedOn: string | null;
  closedOn: string | null;
  nextFollowUp: { description: string; dueOn: string; state: FollowUpState } | null;
  lastActivityAt: Date;
}

export interface ApplicationListPage {
  items: ApplicationListItem[];
  total: number;
  page: number;
  requestedPage: number;
  pageCount: number;
  pageSize: number;
}

export interface ApplicationTrackerSummary {
  active: number;
  followUpsOverdue: number;
  followUpsDueToday: number;
  interviewsScheduled: number;
  offers: number;
  closed: number;
}

// The earliest open follow-up per application (its "next action") and the
// latest history event (its "last activity").
const withClause = Prisma.sql`
  WITH next_follow_up AS (
    SELECT DISTINCT ON (f."applicationId")
      f."applicationId", f."dueOn", f."description"
    FROM "ApplicationFollowUp" f
    WHERE f."completedAt" IS NULL
    ORDER BY f."applicationId", f."dueOn" ASC, f."createdAt" ASC, f."id" ASC
  ),
  last_event AS (
    SELECT e."applicationId", MAX(e."createdAt") AS "lastActivityAt"
    FROM "ApplicationEvent" e
    GROUP BY e."applicationId"
  )
`;

const joins = Prisma.sql`
  FROM "Application" a
  JOIN "Opportunity" o ON o."id" = a."opportunityId"
  LEFT JOIN "Company" c ON c."id" = o."companyId"
  LEFT JOIN next_follow_up nf ON nf."applicationId" = a."id"
  LEFT JOIN last_event le ON le."applicationId" = a."id"
`;

const sqlDate = (isoDate: string) => Prisma.sql`${isoDate}::date`;

function followUpCondition(filter: ApplicationFollowUpFilter, today: string): Prisma.Sql {
  switch (filter) {
    case "overdue":
      return Prisma.sql`nf."dueOn" < ${sqlDate(today)}`;
    case "due":
      return Prisma.sql`nf."dueOn" <= ${sqlDate(today)}`;
    case "today":
      return Prisma.sql`nf."dueOn" = ${sqlDate(today)}`;
    case "upcoming":
      return Prisma.sql`nf."dueOn" > ${sqlDate(today)} AND nf."dueOn" <= ${sqlDate(addDays(today, 7))}`;
    case "none":
      return Prisma.sql`nf."applicationId" IS NULL`;
  }
}

// One predicate for the count, the page, and the dashboard's linked counts.
export function buildApplicationPredicate(filters: ApplicationListFilters, today: string): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (filters.view === "active") conditions.push(Prisma.sql`a."stage" <> 'CLOSED'`);
  if (filters.view === "closed") conditions.push(Prisma.sql`a."stage" = 'CLOSED'`);
  if (filters.stages?.length) conditions.push(Prisma.sql`a."stage"::text IN (${Prisma.join(filters.stages)})`);
  if (filters.outcomes?.length) conditions.push(Prisma.sql`a."outcome"::text IN (${Prisma.join(filters.outcomes)})`);
  if (filters.followUp) conditions.push(followUpCondition(filters.followUp, today));
  for (const term of filters.searchTerms ?? []) {
    const pattern = `%${escapeLikePattern(term)}%`;
    conditions.push(Prisma.sql`(o."title" ILIKE ${pattern} ESCAPE '\\' OR c."name" ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (filters.appliedFrom) conditions.push(Prisma.sql`a."appliedOn" >= ${sqlDate(filters.appliedFrom)}`);
  if (filters.appliedTo) conditions.push(Prisma.sql`a."appliedOn" <= ${sqlDate(filters.appliedTo)}`);
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

const tieBreakers = Prisma.sql`a."createdAt" DESC, a."id" DESC`;
const sortOrders: Record<ApplicationListSort, Prisma.Sql> = {
  // Overdue first (earliest due), then soonest due, then no next action.
  "next-action": Prisma.sql`nf."dueOn" ASC NULLS LAST, ${tieBreakers}`,
  "applied-newest": Prisma.sql`a."appliedOn" DESC NULLS LAST, ${tieBreakers}`,
  "applied-oldest": Prisma.sql`a."appliedOn" ASC NULLS LAST, ${tieBreakers}`,
  updated: Prisma.sql`le."lastActivityAt" DESC NULLS LAST, ${tieBreakers}`,
  company: Prisma.sql`lower(NULLIF(btrim(c."name"), '')) ASC NULLS LAST, ${tieBreakers}`,
};

type Row = {
  id: string;
  opportunityId: string;
  title: string | null;
  companyName: string | null;
  opportunityStatus: string;
  stage: ApplicationStage;
  outcome: ApplicationOutcome | null;
  appliedOn: Date | null;
  closedOn: Date | null;
  nextDueOn: Date | null;
  nextDescription: string | null;
  lastActivityAt: Date | null;
  createdAt: Date;
};

export class PrismaApplicationListRepository {
  private readonly database = getDatabaseClient();

  async listPage(input: {
    filters: ApplicationListFilters;
    sort: ApplicationListSort;
    page: number;
    pageSize: number;
    today?: string;
  }): Promise<ApplicationListPage> {
    const today = input.today ?? utcToday();
    const pageSize = Math.min(Math.max(Math.trunc(input.pageSize) || 1, 1), applicationListMaximumPageSize);
    const requestedPage = Number.isInteger(input.page) && input.page >= 1 ? input.page : 1;
    const predicate = buildApplicationPredicate(input.filters, today);
    return this.database.$transaction(
      async (transaction) => {
        const [count] = await transaction.$queryRaw<Array<{ total: number }>>`
          ${withClause} SELECT COUNT(*)::int AS "total" ${joins} ${predicate}
        `;
        const total = count?.total ?? 0;
        const pageCount = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(requestedPage, pageCount);
        if (total === 0) return { items: [], total, page, requestedPage, pageCount, pageSize };
        const rows = await transaction.$queryRaw<Row[]>`
          ${withClause}
          SELECT
            a."id", a."opportunityId", o."title", c."name" AS "companyName", o."status"::text AS "opportunityStatus",
            a."stage"::text AS "stage", a."outcome"::text AS "outcome", a."appliedOn", a."closedOn",
            nf."dueOn" AS "nextDueOn", nf."description" AS "nextDescription",
            le."lastActivityAt", a."createdAt"
          ${joins} ${predicate}
          ORDER BY ${sortOrders[input.sort] ?? sortOrders["next-action"]}
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `;
        const items = rows.map((row): ApplicationListItem => {
          const dueOn = row.nextDueOn ? toIsoDate(row.nextDueOn) : null;
          return {
            id: row.id,
            opportunityId: row.opportunityId,
            title: row.title,
            companyName: row.companyName,
            opportunityStatus: row.opportunityStatus,
            stage: row.stage,
            outcome: row.outcome,
            appliedOn: row.appliedOn ? toIsoDate(row.appliedOn) : null,
            closedOn: row.closedOn ? toIsoDate(row.closedOn) : null,
            nextFollowUp:
              dueOn && row.nextDescription !== null
                ? { description: row.nextDescription, dueOn, state: followUpState(dueOn, null, today) }
                : null,
            lastActivityAt: row.lastActivityAt ?? row.createdAt,
          };
        });
        return { items, total, page, requestedPage, pageCount, pageSize };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  // Counts that each equal a filtered /applications view (or, for
  // interviews, the scheduled interviews of active applications).
  async summarize(input: { today?: string; now?: Date } = {}): Promise<ApplicationTrackerSummary> {
    const today = input.today ?? utcToday();
    const now = input.now ?? new Date();
    const count = async (filters: ApplicationListFilters) => {
      const [row] = await this.database.$queryRaw<Array<{ total: number }>>`
        ${withClause} SELECT COUNT(*)::int AS "total" ${joins} ${buildApplicationPredicate(filters, today)}
      `;
      return row?.total ?? 0;
    };
    const [active, followUpsOverdue, followUpsDueToday, offers, closed, interviews] = await Promise.all([
      count({ view: "active" }),
      count({ view: "active", followUp: "overdue" }),
      count({ view: "active", followUp: "today" }),
      count({ view: "active", stages: ["OFFER"] }),
      count({ view: "closed" }),
      this.database.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS "total"
        FROM "ApplicationInterview" i JOIN "Application" a ON a."id" = i."applicationId"
        WHERE a."stage" <> 'CLOSED' AND i."status" = 'SCHEDULED'
          AND (i."scheduledAt" IS NULL OR i."scheduledAt" >= ${now})
      `,
    ]);
    return {
      active,
      followUpsOverdue,
      followUpsDueToday,
      interviewsScheduled: interviews[0]?.total ?? 0,
      offers,
      closed,
    };
  }

  // Active applications whose next follow-up is overdue or due today: the
  // dashboard's "Follow-ups due" count, equal to /applications?followUp=due.
  async countFollowUpsDue(today: string = utcToday()): Promise<number> {
    const [row] = await this.database.$queryRaw<Array<{ total: number }>>`
      ${withClause} SELECT COUNT(*)::int AS "total" ${joins}
      ${buildApplicationPredicate({ view: "active", followUp: "due" }, today)}
    `;
    return row?.total ?? 0;
  }
}
