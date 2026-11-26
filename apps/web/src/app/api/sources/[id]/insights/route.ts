import { createSourceInsightsApiHandlers, getSourceInsightsService } from "@/server/source-intelligence-service";

type Context = { params: Promise<{ id: string }> };

// One source's Source Intelligence drill-down: a configured source's id, or
// adapter--<key>, extension--<site> or manual. Read-only.
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return createSourceInsightsApiHandlers(getSourceInsightsService()).detail(request, id);
}
