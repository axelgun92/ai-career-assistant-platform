import { createRetrievalApiHandlers, getRetrievalService } from "@/server/retrieval-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return createRetrievalApiHandlers(getRetrievalService()).get(id);
}

// Renames, reconfigures, reschedules, enables or disables a source.
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return createRetrievalApiHandlers(getRetrievalService()).update(request, id);
}

// Deletes a source that never produced anything; otherwise archives it so
// every retrieved record keeps its provenance.
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  return createRetrievalApiHandlers(getRetrievalService()).remove(id);
}
