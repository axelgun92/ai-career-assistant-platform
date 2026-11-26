import { createBudgetApiHandlers, getBudgetService } from "@/server/budget-service";

export async function GET(request: Request) {
  return createBudgetApiHandlers(getBudgetService()).listDeferred(request);
}
