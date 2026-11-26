import { ZodError } from "zod";
import { getManualOpportunityService } from "@/server/manual-opportunity-service";

// Read-only: the duplicate decision a capture would get now. Nothing is
// written; the capture itself decides again inside its transaction.
export async function POST(request: Request) {
  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  try {
    return Response.json(await getManualOpportunityService().checkDuplicates(requestBody));
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "Manual opportunity submission is invalid",
          issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        { status: 400 },
      );
    }
    console.error("Duplicate check failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "The duplicate check could not be completed" }, { status: 500 });
  }
}
