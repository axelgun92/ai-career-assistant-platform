import { listingUrlKey } from "@ai-career/deduplication";
import { z } from "zod";

// Configuration values shared by adapters.

// A board, site or company slug as it appears in a public job-board URL.
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Use the board name exactly as it appears in the job board's web address");

// Employer name for boards whose API does not return one (Lever, Ashby).
// It is what the user typed for the source, used as the company of every
// listing from that board.
export const companyNameSchema = z.string().trim().min(1).max(120);

export function workplaceType(value: string | null | undefined): "REMOTE" | "HYBRID" | "ONSITE" | null {
  const key = value?.toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (key === "remote") return "REMOTE";
  if (key === "hybrid") return "HYBRID";
  if (key === "onsite" || key === "inoffice") return "ONSITE";
  return null;
}

// A job board's "apply" field names a distinct application destination only
// when it is not the board's own listing page (some boards repeat the
// listing URL there): otherwise the link is the listing page.
export function boardApplyBasis(applyUrl: string | null | undefined, listingUrl: string | null | undefined): "SOURCE_APPLY_URL" | "SOURCE_LISTING_PAGE" | null {
  const apply = listingUrlKey(applyUrl);
  if (apply && apply !== listingUrlKey(listingUrl)) return "SOURCE_APPLY_URL";
  return applyUrl || listingUrl ? "SOURCE_LISTING_PAGE" : null;
}

export function isoDate(value: number | string | null | undefined, unit: "ms" | "s" = "ms"): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" ? new Date(unit === "s" ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
