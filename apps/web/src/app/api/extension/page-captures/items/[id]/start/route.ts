import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Mode B background-tab reading (P2). Before opening a job's background tab: whether the job is still to be read.
// Pairing credential required.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getExtensionApi().pageCaptureTabStart(request, id);
}

export async function OPTIONS() {
  return methodNotAllowed("POST");
}
