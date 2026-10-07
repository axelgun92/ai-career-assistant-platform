import {
  PrismaOpportunityListRepository,
  type OpportunityListPage,
  type OpportunityListSort,
} from "@ai-career/database";
import type { OpportunityLifecycleState } from "@ai-career/core";
import { z } from "zod";
import {
  defaultView,
  maximumPageSize,
  opportunityViews,
  parseOpportunityQuery,
  toListFilters,
  type OpportunityListFilters,
  type OpportunityView,
} from "./opportunity-query";

export interface OpportunityListReader {
  listPage(input: {
    filters: Omit<OpportunityListFilters, "statuses"> & { statuses?: readonly OpportunityLifecycleState[] };
    sort: OpportunityListSort;
    page: number;
    pageSize: number;
  }): Promise<OpportunityListPage>;
}

// Dashboard views over the lifecycle (see opportunity-query.ts). "active" is
// the default working list; dismissed and archived stay in their own views.
export const opportunityListViews = opportunityViews;
export type OpportunityListView = OpportunityView;
export const opportunityListViewSchema = z.enum(
  Object.keys(opportunityListViews) as [OpportunityListView, ...OpportunityListView[]],
);
export const defaultOpportunityListView: OpportunityListView = defaultView;

let opportunityListReader: OpportunityListReader | undefined;

export function getOpportunityListReader(): OpportunityListReader {
  opportunityListReader ??= new PrismaOpportunityListRepository();
  return opportunityListReader;
}

// Pagination parameters must be well-formed; every other parameter is
// parsed leniently (invalid values are ignored, never an error).
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(maximumPageSize).optional(),
  pageSize: z.coerce.number().int().min(1).max(maximumPageSize).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export function createOpportunityListHandler(reader: OpportunityListReader) {
  return async function get(request: Request) {
    const searchParams = new URL(request.url).searchParams;
    const pagination = paginationSchema.safeParse({
      limit: searchParams.get("limit") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
      page: searchParams.get("page") ?? undefined,
    });
    if (!pagination.success) {
      return Response.json(
        {
          error: "The opportunity list query is invalid",
          issues: pagination.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    // The API lists every lifecycle state unless a view is requested.
    const query = parseOpportunityQuery(searchParams, { defaultView: "all" });
    try {
      const result = await reader.listPage({
        filters: toListFilters(query),
        sort: query.sort,
        page: query.page,
        pageSize: pagination.data.pageSize ?? pagination.data.limit ?? query.pageSize,
      });
      return Response.json({
        opportunities: result.items,
        total: result.total,
        page: result.page,
        requestedPage: result.requestedPage,
        pageCount: result.pageCount,
        pageSize: result.pageSize,
      });
    } catch (error) {
      console.error("Opportunity list request failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return Response.json(
        { error: "Opportunities could not be loaded" },
        { status: 500 },
      );
    }
  };
}
