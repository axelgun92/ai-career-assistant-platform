import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Feature 14B: revokes a pairing; its credential stops working at once.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getExtensionApi().revokePairing(request, id);
}

export async function OPTIONS() {
  return methodNotAllowed("POST");
}
