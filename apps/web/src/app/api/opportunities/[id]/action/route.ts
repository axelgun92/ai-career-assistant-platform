import {
  createOpportunityActionHandler,
  getOpportunityActionWriter,
} from "@/server/opportunity-action-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return createOpportunityActionHandler(getOpportunityActionWriter())(request, id);
}
