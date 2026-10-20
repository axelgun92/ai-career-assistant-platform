import { methodNotAllowed } from "@/server/extension-auth";
import { getExtensionApi } from "@/server/extension-api";

// Feature 14B, read-only: whether the page at ?url= is already saved.
export async function GET(request: Request) {
  return getExtensionApi().lookup(request);
}

export async function OPTIONS() {
  return methodNotAllowed("GET");
}
