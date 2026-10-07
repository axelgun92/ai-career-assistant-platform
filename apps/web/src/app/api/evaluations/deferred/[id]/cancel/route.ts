import { handleDeferredEvaluationAction } from "@/server/evaluation-api";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleDeferredEvaluationAction("cancel", id);
}
