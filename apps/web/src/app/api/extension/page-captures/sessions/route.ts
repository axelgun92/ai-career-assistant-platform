import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Capture history for the extension's side panel: recent saves from results
// pages with their jobs' current state. Pairing credential required.
export async function GET(request: Request) {
  return getExtensionApi().pageCaptureSessions(request);
}

export async function OPTIONS() {
  return methodNotAllowed("GET");
}
