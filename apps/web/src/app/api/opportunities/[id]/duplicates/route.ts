import { createDuplicateResolutionHandler, getDuplicateStore } from "@/server/duplicate-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createDuplicateResolutionHandler(getDuplicateStore())(request, id);
}
