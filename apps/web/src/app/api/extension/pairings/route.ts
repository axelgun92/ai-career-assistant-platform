import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Feature 14B pairing management, for the app's Extension page only
// (same-origin; a pairing credential is refused here).
export async function GET(request: Request) {
  return getExtensionApi().listPairings(request);
}

// Creates a pairing; the response carries its credential, once.
export async function POST(request: Request) {
  return getExtensionApi().createPairing(request);
}

export async function OPTIONS() {
  return methodNotAllowed("GET, POST");
}
