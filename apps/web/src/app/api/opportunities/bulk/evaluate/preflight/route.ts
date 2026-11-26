import { getBulkEvaluationHandlers } from "@/server/bulk-evaluation-api";

// Bulk evaluation preflight (November 26, 2026): checks the selection and
// every enabled limit; writes nothing and calls no provider.
export async function POST(request: Request) {
  return getBulkEvaluationHandlers().preflight(request);
}
