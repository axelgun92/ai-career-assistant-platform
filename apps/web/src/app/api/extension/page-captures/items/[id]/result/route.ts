import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Mode B background-tab reading (P2). Why the job's page gave no posting (unreadable, gone, tab closed, access restriction).
// Pairing credential required.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getExtensionApi().pageCaptureTabResult(request, id);
}

export async function OPTIONS() {
  return methodNotAllowed("POST");
}
