import { PrismaUserEligibilityRepository } from "@ai-career/database";
import { createEligibilityApiHandlers } from "@/server/eligibility-api";

export async function GET() {
  return createEligibilityApiHandlers(new PrismaUserEligibilityRepository()).get();
}

// Saves the user's own work eligibility. Never changes any opportunity.
export async function PUT(request: Request) {
  return createEligibilityApiHandlers(new PrismaUserEligibilityRepository()).put(request);
}
