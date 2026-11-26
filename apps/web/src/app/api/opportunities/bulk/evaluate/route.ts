import { getBulkEvaluationHandlers } from "@/server/bulk-evaluation-api";

// Bulk evaluation submit (November 26, 2026): rechecks the whole selection
// and every enabled limit, then queues every job or none.
export async function POST(request: Request) {
  return getBulkEvaluationHandlers().submit(request);
}
