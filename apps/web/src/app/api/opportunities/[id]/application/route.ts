import { getApplicationApiHandlers } from "@/server/application-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return getApplicationApiHandlers().forOpportunity(id);
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return getApplicationApiHandlers().create(request, id);
}
