import { createBudgetApiHandlers, getBudgetService } from "@/server/budget-service";

export async function GET() {
  return createBudgetApiHandlers(getBudgetService()).get();
}

// Creates or updates the budget. Never rewrites usage or cost records.
export async function PUT(request: Request) {
  return createBudgetApiHandlers(getBudgetService()).put(request);
}

// Removes the budget; evaluations become unrestricted. Usage is unchanged.
export async function DELETE() {
  return createBudgetApiHandlers(getBudgetService()).delete();
}
