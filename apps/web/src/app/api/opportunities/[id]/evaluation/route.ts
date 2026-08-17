import { handleProductionEvaluationGet } from "@/server/evaluation-api";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleProductionEvaluationGet(request, id);
}
