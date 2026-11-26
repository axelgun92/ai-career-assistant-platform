import { after } from "next/server";
import { reassessStaleTriage } from "@/server/triage-reassessment";
import { getProfileApiHandlers } from "@/server/profile-service";

// Chooses the version new evaluations use. Never modifies the version itself.
export async function POST(request: Request) {
  const response = await getProfileApiHandlers().postActive(request);
  // A new active profile changes a hard-requirement input: triage is
  // assessed again where it is stale, after the response (November 25).
  if (response.ok) after(() => reassessStaleTriage({ trigger: "PROFILE_CHANGED", log: console }).then(() => undefined));
  return response;
}
