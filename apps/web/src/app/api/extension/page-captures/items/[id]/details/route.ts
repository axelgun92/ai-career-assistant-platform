import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Mode B background-tab reading (P2). The single-job capture the extension's reader made of the job's page.
// Pairing credential required.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getExtensionApi().pageCaptureTabDetails(request, id);
}

export async function OPTIONS() {
  return methodNotAllowed("POST");
}
