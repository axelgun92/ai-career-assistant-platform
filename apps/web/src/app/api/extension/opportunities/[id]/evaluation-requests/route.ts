import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Feature 14B: the extension's "Request evaluation". Checks the pairing
// credential, then calls the existing production evaluation handler.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getExtensionApi().requestEvaluation(request, id);
}

export async function OPTIONS() {
  return methodNotAllowed("POST");
}
