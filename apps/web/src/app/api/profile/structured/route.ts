import { getProfileApiHandlers } from "@/server/profile-service";

// Saves structured-form changes, applied to the base version, as a new version.
export async function POST(request: Request) {
  return getProfileApiHandlers().postStructured(request);
}
