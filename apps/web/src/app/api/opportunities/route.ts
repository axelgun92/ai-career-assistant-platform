import { ZodError } from "zod";
import { getManualOpportunityService } from "@/server/manual-opportunity-service";
import {
  createOpportunityListHandler,
  getOpportunityListReader,
} from "@/server/opportunity-list-service";

export async function GET(request: Request) {
  return createOpportunityListHandler(getOpportunityListReader())(request);
}

export async function POST(request: Request) {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  try {
    const detail = await getManualOpportunityService().submit(requestBody);

    // An exact duplicate is attached to the opportunity already saved: 200
    // with that opportunity, never a second one.
    return Response.json(detail, {
      status: detail.deduplication.outcome === "ATTACHED" ? 200 : 201,
      headers: {
        Location: `/opportunities/${detail.opportunity.id}`,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "Manual opportunity submission is invalid",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    // The error name only: a raw error can carry submitted job text or
    // database details, which must not reach the logs.
    console.error("Manual opportunity submission failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json(
      { error: "The opportunity could not be stored" },
      { status: 500 },
    );
  }
}
