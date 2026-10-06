import {
  opportunityListMaximumLimit,
  PrismaOpportunityListRepository,
  type OpportunityListItem,
} from "@ai-career/database";
import type { OpportunityLifecycleState } from "@ai-career/core";
import { z } from "zod";

export interface OpportunityListReader {
  listOpportunities(input?: {
    limit?: number;
    statuses?: readonly OpportunityLifecycleState[];
  }): Promise<OpportunityListItem[]>;
}

// Dashboard views over the lifecycle. "active" is the default working list;
// dismissed and archived opportunities stay available in their own views.
export const opportunityListViews = {
  active: { label: "Active", statuses: ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"] },
  saved: { label: "Saved", statuses: ["SAVED"] },
  applied: { label: "Applied", statuses: ["APPLIED"] },
  dismissed: { label: "Dismissed", statuses: ["REJECTED_BY_USER"] },
  archived: { label: "Archived", statuses: ["ARCHIVED", "CLOSED"] },
  all: { label: "All", statuses: undefined },
} as const satisfies Record<
  string,
  { label: string; statuses: readonly OpportunityLifecycleState[] | undefined }
>;

export type OpportunityListView = keyof typeof opportunityListViews;
export const opportunityListViewSchema = z.enum(
  Object.keys(opportunityListViews) as [OpportunityListView, ...OpportunityListView[]],
);
export const defaultOpportunityListView: OpportunityListView = "active";

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(opportunityListMaximumLimit).optional(),
    view: opportunityListViewSchema.optional(),
  })
  .strict();

let opportunityListReader: OpportunityListReader | undefined;

export function getOpportunityListReader(): OpportunityListReader {
  opportunityListReader ??= new PrismaOpportunityListRepository();
  return opportunityListReader;
}

export function createOpportunityListHandler(reader: OpportunityListReader) {
  return async function get(request: Request) {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return Response.json(
        {
          error: "The opportunity list query is invalid",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    try {
      const { view, limit } = parsed.data;
      const opportunities = await reader.listOpportunities({
        limit,
        statuses: view ? opportunityListViews[view].statuses : undefined,
      });
      return Response.json({ opportunities });
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
