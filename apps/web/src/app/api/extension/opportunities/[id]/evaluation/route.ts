import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Feature 14B: the persisted evaluation state, read-only. Checks the
// pairing credential, then calls the existing latest-evaluation read.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getExtensionApi().evaluationStatus(request, id);
}

export async function OPTIONS() {
  return methodNotAllowed("GET");
}
