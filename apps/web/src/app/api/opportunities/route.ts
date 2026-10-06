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

    return Response.json(detail, {
      status: 201,
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

    console.error("Manual opportunity submission failed", error);
    return Response.json(
      { error: "The opportunity could not be stored" },
      { status: 500 },
    );
  }
}
