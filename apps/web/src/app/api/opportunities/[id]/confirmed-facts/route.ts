import { getConfirmedFactHandlers } from "@/server/confirmed-fact-service";

// Add missing information (November 25, 2026): the facts the user confirmed
// from the job description, with their history; confirm or edit one; undo
// one. Each change re-runs pre-evaluator triage at once.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getConfirmedFactHandlers().get(id);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getConfirmedFactHandlers().save(request, id);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getConfirmedFactHandlers().undo(request, id);
}
