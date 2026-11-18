import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Continuous capture: which of the loaded job cards a batch may take (not
// captured before, or due to be read again), decided as staging would decide
// them. Read-only. Pairing credential required.
export async function POST(request: Request) {
  return getExtensionApi().pageCaptureSelection(request);
}

export async function OPTIONS() {
  return methodNotAllowed("POST");
}
