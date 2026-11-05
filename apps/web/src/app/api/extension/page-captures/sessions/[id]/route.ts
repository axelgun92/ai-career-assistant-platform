import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// One save from a results page, with each of its jobs' current state and a
// link to the added opportunity. Pairing credential required.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getExtensionApi().pageCaptureSession(request, id);
}

export async function OPTIONS() {
  return methodNotAllowed("GET");
}
