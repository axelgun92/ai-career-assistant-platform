import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Mode B: stages the job cards the extension read from a results page, for
// automatic detail acquisition and normal ingestion. Pairing credential
// required. Staging never evaluates anything.
export async function POST(request: Request) {
  return getExtensionApi().pageCapture(request);
}

// No CORS preflight is answered for the extension's routes.
export async function OPTIONS() {
  return methodNotAllowed("POST");
}
