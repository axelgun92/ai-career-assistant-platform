import {
  opportunityListMaximumLimit,
  PrismaOpportunityListRepository,
  type OpportunityListItem,
} from "@ai-career/database";
import { z } from "zod";

export interface OpportunityListReader {
  listOpportunities(input?: { limit?: number }): Promise<OpportunityListItem[]>;
}

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(opportunityListMaximumLimit).optional(),
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
      const opportunities = await reader.listOpportunities(parsed.data);
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
