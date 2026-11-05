import { readFileSync } from "node:fs";
import path from "node:path";
import { pageCaptureDetailMechanism, pageCaptureSites } from "@ai-career/core";
import { enabledSitesFromEnvironment } from "./page-capture";

// What Setup & Connection states about the extension, derived from what the
// app actually ships and enables (never invented): the extension version in
// this checkout, and which sites support which capture mode.

// The version of the extension this checkout builds (apps/extension); null
// when it cannot be read.
export function shippedExtensionVersion(cwd = process.cwd()): string | null {
  for (const candidate of [path.join(cwd, "../extension/static/manifest.json"), path.join(cwd, "apps/extension/static/manifest.json")]) {
    try {
      const version = (JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown }).version;
      if (typeof version === "string") return version;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

export interface SupportedSiteRow {
  site: string;
  single: string;
  batch: string;
}

// Single Job works on any job page (LinkedIn only on a job's own page).
// Batch Capture only on the results pages of a site the app enables, with
// how its jobs' details are read.
export function supportedSites(environment: NodeJS.ProcessEnv = process.env): SupportedSiteRow[] {
  const enabled = enabledSitesFromEnvironment(environment);
  const rows: SupportedSiteRow[] = pageCaptureSites
    .filter((site) => !site.testOnly)
    .map((site) => {
      const cards = enabled.cards.includes(site.key);
      const details = enabled.details.includes(site.key);
      const verified = site.cardVerified && site.detailVerified;
      const how = pageCaptureDetailMechanism(site) === "extension-tabs" ? "details read in background tabs of your browser" : "details read automatically by the app";
      return {
        site: site.name,
        single: site.key === "linkedin" ? "Yes, on a job's own page" : "Yes",
        batch: !cards
          ? verified
            ? "Not enabled"
            : "Not available yet (pending live acceptance)"
          : `${verified ? "Yes" : "Enabled for acceptance testing"}${details ? `; ${how}` : "; details not read automatically"}`,
      };
    });
  return [...rows, { site: "Any other job site", single: "Yes (saved as a lower-priority source)", batch: "No" }];
}
