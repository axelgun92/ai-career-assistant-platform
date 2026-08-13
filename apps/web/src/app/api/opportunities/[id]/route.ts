import { ZodError } from "zod";
import { getManualOpportunityService } from "@/server/manual-opportunity-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const detail = await getManualOpportunityService().getById(id);

    if (!detail) {
      return Response.json({ error: "Opportunity not found" }, { status: 404 });
    }

    return Response.json(detail);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Opportunity ID must be a valid UUID" },
        { status: 400 },
      );
    }

    console.error("Opportunity retrieval failed", error);
    return Response.json(
      { error: "The opportunity could not be retrieved" },
      { status: 500 },
    );
  }
}
