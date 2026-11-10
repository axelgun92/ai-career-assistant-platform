import { getProfileApiHandlers } from "@/server/profile-service";

// Chooses the version new evaluations use. Never modifies the version itself.
export async function POST(request: Request) {
  return getProfileApiHandlers().postActive(request);
}
