import { createRetrievalApiHandlers, getRetrievalService } from "@/server/retrieval-service";

type Context = { params: Promise<{ id: string }> };

// Run history, newest first.
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return createRetrievalApiHandlers(getRetrievalService()).runs(id);
}

// Run now: queues a run for the retrieval worker (one at a time per source).
// An optional {"override": true} body runs once past our own backoff; a rate
// limit or a wait the source asked for is never overridden.
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return createRetrievalApiHandlers(getRetrievalService()).runNow(id, request);
}
