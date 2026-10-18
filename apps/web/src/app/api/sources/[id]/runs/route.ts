import { createRetrievalApiHandlers, getRetrievalService } from "@/server/retrieval-service";

type Context = { params: Promise<{ id: string }> };

// Run history, newest first.
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return createRetrievalApiHandlers(getRetrievalService()).runs(id);
}

// Run now: queues a run for the retrieval worker (one at a time per source).
export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  return createRetrievalApiHandlers(getRetrievalService()).runNow(id);
}
