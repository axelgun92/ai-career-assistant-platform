import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Mode B background-tab reading (P2): the rest of a batch the extension
// stopped (the user's Stop, a removed permission). Pairing credential
// required.
export async function POST(request: Request) {
  return getExtensionApi().pageCaptureTabStop(request);
}

export async function OPTIONS() {
  return methodNotAllowed("POST");
}
