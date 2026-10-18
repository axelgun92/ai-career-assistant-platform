import { z } from "zod";
import { AdapterError, type SourceAdapter } from "../contract";

// Welcome to the Jungle / Otta (job board; public/guest internal endpoint,
// Type 3). UNVERIFIED and cannot be enabled. On October 18, 2026 the
// logged-out search document
// (GET https://www.welcometothejungle.com/en/jobs?query=customer%20success)
// returned HTTP 200, unblocked, but showed a sign-up and matching flow: no
// job listings in its markup or embedded state, and no anonymous listing
// endpoint, GraphQL operation, paging, job ids or listing fields. Individual
// public job pages exist (https://app.welcometothejungle.com/jobs/<id>), but
// without a verified listing there is nothing to collect. Browser-assisted
// retrieval (feature 14) may reconsider it.

const configSchema = z.object({}).strict();

export const welcomeToTheJungleAdapter: SourceAdapter<z.infer<typeof configSchema>> = {
  key: "welcome-to-the-jungle",
  name: "Welcome to the Jungle / Otta",
  retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT",
  sourceCategory: "JOB_BOARD",
  sourceType: "PUBLIC_SEARCH",
  configSchema,
  configFields: [],
  requiredEnv: [],
  verified: false,
  attribution: null,
  verificationUrl: () => "https://www.welcometothejungle.com/en/jobs?query=customer%20success",
  async collect() {
    throw new AdapterError("CONFIG", "Welcome to the Jungle has no verified listing interface");
  },
};
