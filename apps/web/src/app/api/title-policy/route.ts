import { PrismaTitlePolicyRepository } from "@ai-career/database";
import { createTitlePolicyApiHandlers } from "@/server/title-policy-service";

export async function GET() {
  return createTitlePolicyApiHandlers(new PrismaTitlePolicyRepository()).get();
}

// Saves the target job titles for automatic acquisition. Never changes any
// captured opportunity; the next automatic capture uses them.
export async function PUT(request: Request) {
  return createTitlePolicyApiHandlers(new PrismaTitlePolicyRepository()).put(request);
}

// Back to the default target job titles.
export async function DELETE() {
  return createTitlePolicyApiHandlers(new PrismaTitlePolicyRepository()).reset();
}
