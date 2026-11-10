import { methodNotAllowed } from "@/server/extension-auth";
import { handlePageCaptureAction } from "@/server/page-capture-progress";

// Alex's actions on a job saved from a results page (retry reading its
// details, dismiss, restore). Same-origin only, from the progress page.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlePageCaptureAction(request, id);
}

export async function OPTIONS() {
  return methodNotAllowed("POST");
}
