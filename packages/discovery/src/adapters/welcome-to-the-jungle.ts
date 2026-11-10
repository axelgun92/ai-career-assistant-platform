import { z } from "zod";
import { AdapterError, type SourceAdapter } from "../contract";

// Welcome to the Jungle / Otta (job board; public logged-out webpage
// retrieval, feature 14 classification). No public jobs API exists, so its
// public pages are the candidate interface, read conservatively and bounded,
// never removal-capable. Its terms' anti-scraping language is not, by
// itself, the reason it is disabled: the live public surface is.
// UNVERIFIED and cannot be enabled, on this evidence:
// - October 18, 2026: the logged-out search document
//   (GET https://www.welcometothejungle.com/en/jobs?query=customer%20success)
//   answered HTTP 200 with a sign-up and matching flow: no listings in its
//   markup or embedded state.
// - October 19, 2026 (feature 14): the same plain GET answered HTTP 200 with
//   the same landing page (no job links or job data; the query is ignored),
//   and one logged-out headless-browser load of it was refused by the site's
//   CloudFront firewall (HTTP 403, "Request blocked"), a stop condition.
//   Retrieval stopped there: no retry, no other page and no workaround.
// - Later on October 19, 2026, a local WSL browser check (run by the user,
//   logged out, no cookies) loaded the public company jobs page
//   /en/companies/wttj/jobs (final address /en/companies-v1/wttj/jobs) with
//   no 403, 429, CAPTCHA, sign-in wall or challenge. Plain HTML is not
//   enough; with JavaScript rendering the page showed the company shell and
//   a "Jobs 16" tab, but "We didn't find any jobs for your search": no job
//   cards, links, IDs or job fields.
// So the cloud 403 was specific to that environment, not a universal block,
// but no tested public surface exposes usable job records, and no hidden or
// internal endpoint is to be discovered to force one.

const configSchema = z.object({}).strict();

export const welcomeToTheJungleAdapter: SourceAdapter<z.infer<typeof configSchema>> = {
  key: "welcome-to-the-jungle",
  name: "Welcome to the Jungle / Otta",
  retrievalType: "PUBLIC_HTML",
  sourceCategory: "JOB_BOARD",
  sourceType: "PUBLIC_SEARCH",
  configSchema,
  configFields: [],
  requiredEnv: [],
  verified: false,
  attribution: null,
  verificationUrl: () => "https://www.welcometothejungle.com/en/jobs?query=customer%20success",
  async collect() {
    throw new AdapterError("CONFIG", "Welcome to the Jungle has no verified public listing page");
  },
};
