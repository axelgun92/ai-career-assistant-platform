import { after } from "next/server";
import { reassessStaleTriage } from "@/server/triage-reassessment";
import { getProfileApiHandlers } from "@/server/profile-service";

export async function GET() {
  return getProfileApiHandlers().getOverview();
}

// Saves a full profile document as a new append-only version.
export async function POST(request: Request) {
  const response = await getProfileApiHandlers().postDocument(request);
  // A saved (possibly activated) profile can change a hard-requirement input: triage is
  // assessed again where it is stale, after the response (November 25).
  if (response.ok) after(() => reassessStaleTriage({ log: console }).then(() => undefined));
  return response;
}
