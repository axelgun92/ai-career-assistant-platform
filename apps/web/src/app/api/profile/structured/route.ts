import { after } from "next/server";
import { getProfileApiHandlers } from "@/server/profile-service";
import { reassessStaleTriage } from "@/server/triage-reassessment";

// Saves structured-form changes, applied to the base version, as a new version.
export async function POST(request: Request) {
  const response = await getProfileApiHandlers().postStructured(request);
  // A saved (possibly activated) profile can change a hard-requirement
  // input: triage is assessed again where it is stale (November 25, 2026).
  if (response.ok) after(() => reassessStaleTriage({ log: console }).then(() => undefined));
  return response;
}
