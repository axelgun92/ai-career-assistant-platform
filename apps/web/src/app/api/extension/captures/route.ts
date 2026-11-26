import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Feature 14B: saves the job page the extension read. Pairing credential
// required. A capture only saves; it never starts an evaluation.
export async function POST(request: Request) {
  return getExtensionApi().capture(request);
}

// No CORS preflight is answered for the extension's routes.
export async function OPTIONS() {
  return methodNotAllowed("POST");
}
