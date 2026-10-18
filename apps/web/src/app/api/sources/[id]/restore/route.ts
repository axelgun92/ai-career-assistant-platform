import { createRetrievalApiHandlers, getRetrievalService } from "@/server/retrieval-service";

// Brings an archived source back, disabled.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createRetrievalApiHandlers(getRetrievalService()).restore(id);
}
