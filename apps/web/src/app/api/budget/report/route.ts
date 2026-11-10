import { connection } from "next/server";
import { createBudgetApiHandlers, getBudgetService } from "@/server/budget-service";

// Operational AI usage, capacity and backlog report. Domain-neutral; never
// includes credentials, provider error text or request IDs.
export async function GET() {
  await connection();
  return createBudgetApiHandlers(getBudgetService()).report();
}
