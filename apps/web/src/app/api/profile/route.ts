import { getProfileApiHandlers } from "@/server/profile-service";

export async function GET() {
  return getProfileApiHandlers().getOverview();
}

// Saves a full profile document as a new append-only version.
export async function POST(request: Request) {
  return getProfileApiHandlers().postDocument(request);
}
