import { handleProductionEvaluationPost } from "@/server/evaluation-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleProductionEvaluationPost(request, id);
}
