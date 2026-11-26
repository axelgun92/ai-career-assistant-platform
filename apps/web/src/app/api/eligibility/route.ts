import { after } from "next/server";
import { reassessStaleTriage } from "@/server/triage-reassessment";
import { PrismaUserEligibilityRepository } from "@ai-career/database";
import { createEligibilityApiHandlers } from "@/server/eligibility-api";

export async function GET() {
  return createEligibilityApiHandlers(new PrismaUserEligibilityRepository()).get();
}

// Saves the user's own work eligibility. Never changes any opportunity.
export async function PUT(request: Request) {
  const response = await createEligibilityApiHandlers(new PrismaUserEligibilityRepository()).put(request);
  // Work eligibility is a hard-requirement input: triage is assessed again
  // where it is stale, after the response (November 25, 2026).
  if (response.ok) after(() => reassessStaleTriage({ log: console }).then(() => undefined));
  return response;
}
