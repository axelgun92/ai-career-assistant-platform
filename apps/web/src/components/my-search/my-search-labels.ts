import type { PaWindowKey, RecommendationAtApplication } from "@ai-career/core";

// Wording for Personal Job-Search Analytics (feature 17). Factual by design:
// no figure is called good, bad, wasted, accurate or the "best fit".

export const recommendationAtApplicationLabels: Record<RecommendationAtApplication, string> = {
  APPLY: "Apply",
  REVIEW: "Review",
  SKIP: "Skip",
  SAME_DAY_UNKNOWN: "Same-day order unknown",
  EVALUATED_AFTER: "Evaluated after applying",
  NOT_EVALUATED: "Not evaluated",
};

export const personalWindowLabels: Record<PaWindowKey, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "180d": "Last 180 days",
  all: "All time",
  custom: "Custom range",
};

export const resumeMatchBandLabels: Record<string, string> = {
  VERY_STRONG_VERY_HIGH: "Very strong",
  GOOD_HIGH: "Good",
  MIXED_MODERATE: "Mixed",
  LOW: "Low",
  VERY_LOW: "Very low",
  UNKNOWN: "Unknown",
};

export const alexFitLabels: Record<string, string> = { STRONG: "Strong", GOOD: "Good", MIXED: "Mixed", LOW: "Low" };

export const customerTypeLabels: Record<string, string> = {
  B2C: "B2C",
  B2B2C: "B2B2C",
  LIGHT_B2B: "Light B2B",
  ENTERPRISE_HEAVY_B2B: "Enterprise-heavy B2B",
  MIXED: "Mixed",
  UNKNOWN: "Unknown",
};

export const closedOutcomeLabels: Record<string, string> = {
  OFFER_ACCEPTED: "Offer accepted",
  OFFER_DECLINED: "Offer declined",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  NO_RESPONSE: "No response",
};

export const decisionImpactLabels: Record<string, string> = {
  DECISIVE_DISQUALIFIER: "Decisive",
  MATERIAL_UNCERTAINTY: "Material uncertainty",
  NON_DECISIVE: "Not decisive",
  UNKNOWN: "Not recorded",
};

export const dimensionLabels: Record<string, string> = {
  titleGroup: "Title group",
  source: "Found first by",
  arrangement: "Work arrangement",
  seniority: "Seniority",
  customerSegment: "Customer segment",
};

export function personalWindowDescription(window: { key: PaWindowKey; from: string | null; to: string }): string {
  if (window.key !== "custom") return personalWindowLabels[window.key];
  const end = new Date(new Date(window.to).getTime() - 24 * 60 * 60 * 1000);
  return `${window.from?.slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
}
