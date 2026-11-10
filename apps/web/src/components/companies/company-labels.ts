import type { CiWindowKey, CompanySort, RoleListingState } from "@ai-career/core";

// Wording for Company Intelligence (feature 18). Factual by design: nothing is
// called a hire, a hiring speed, remote-friendly, suspicious or ghost, and no
// company is described as good or bad.

export const companyWindowLabels: Record<CiWindowKey, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "180d": "Last 180 days",
  "365d": "Last year",
  all: "All time",
  custom: "Custom range",
};

export const companySortLabels: Record<CompanySort, string> = {
  roles: "Most observed roles",
  recent: "Most recent activity",
  relisted: "Most roles listed again after removal",
  applications: "Most applications",
  name: "Name A–Z",
};

export const listingStateLabels: Record<RoleListingState, string> = {
  listed: "Currently listed",
  no_longer_listed: "No longer listed",
  unknown: "Status unknown",
};

export const businessModelLabels: Record<string, string> = {
  SAAS: "SaaS",
  SOFTWARE: "Software",
  TECHNOLOGY: "Technology",
  EDTECH: "EdTech",
  MARKETPLACE: "Marketplace",
  SUBSCRIPTION: "Subscription",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

export const applicationStageLabels: Record<string, string> = {
  PLANNED: "Planned",
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEWING: "Interviewing",
  FINAL_ROUND: "Final round",
  OFFER: "Offer",
  CLOSED: "Closed",
};

export const companyClosedLabels: Record<string, string> = {
  OFFER_ACCEPTED: "Offer accepted",
  OFFER_DECLINED: "Offer declined",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  NO_RESPONSE: "No response (recorded outcome)",
  CLOSED_WITHOUT_OUTCOME: "Closed without an outcome",
};

export function companyWindowDescription(window: { key: CiWindowKey; from: string | null; to: string }): string {
  if (window.key !== "custom") return companyWindowLabels[window.key];
  const end = new Date(new Date(window.to).getTime() - 24 * 60 * 60 * 1000);
  return `${window.from?.slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
}

// The window as a phrase: "at any time", "in the last 90 days", "from … to …".
export function companyWindowPhrase(window: { key: CiWindowKey; from: string | null; to: string }): string {
  if (window.key === "all") return "at any time";
  if (window.key === "custom") return `from ${companyWindowDescription(window)}`;
  return `in the ${companyWindowLabels[window.key].toLowerCase()}`;
}

export const day = (value: string | null) => (value ? value.slice(0, 10) : "—");
