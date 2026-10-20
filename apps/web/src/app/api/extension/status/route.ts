import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Feature 14B: whether the extension's pairing credential is valid.
export async function GET(request: Request) {
  return getExtensionApi().status(request);
}

export async function OPTIONS() {
  return methodNotAllowed("GET");
}
