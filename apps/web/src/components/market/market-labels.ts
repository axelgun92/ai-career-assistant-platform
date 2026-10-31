import type { MarketEvaluationState, MarketMedian, SiWindow } from "@ai-career/core";
import { geographyLabels, sampleLabels, windowLabels } from "../sources/insight-labels";

// Wording for Job-Market Analytics (feature 16). Neutral by design: no value
// is described as good or bad, and Unknown is always named.

export const seniorityLabels: Record<string, string> = {
  ENTRY: "Entry",
  MID: "Mid",
  SENIOR: "Senior",
  LEAD: "Lead",
  PRINCIPAL: "Principal",
  DIRECTOR: "Director",
  EXECUTIVE: "Executive",
  UNKNOWN: "Unknown",
};

export const arrangementLabels: Record<string, string> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ONSITE: "On-site",
  SEVERAL: "Several options",
  UNKNOWN: "Unknown",
};

export const basisLabels: Record<string, string> = {
  BASE: "Base salary",
  OTE: "On-target earnings (OTE)",
  UNKNOWN: "Unknown basis",
};

export const roleClassificationLabels: Record<string, string> = {
  CORE_CS: "Core Customer Success",
  CS_ADJACENT: "CS-adjacent",
  SUPPORT_HEAVY: "Support-heavy",
  SALES_HEAVY: "Sales-heavy",
  IMPLEMENTATION_HEAVY: "Implementation-heavy",
  TECHNICAL_CS: "Technical CS",
  UNRELATED: "Unrelated",
  UNKNOWN: "Not recorded",
};

export const segmentLabels: Record<string, string> = {
  SMB: "SMB",
  MID_MARKET: "Mid-market",
  COMMERCIAL: "Commercial",
  ENTERPRISE: "Enterprise",
  MIXED: "Mixed",
  UNKNOWN: "Unknown",
};

export const workAuthorizationLabels: Record<string, string> = {
  RIGHT_TO_WORK: "Right to work required",
  CITIZENSHIP: "Citizenship required",
  UNKNOWN: "Not stated",
};

export const availabilityLabels: Record<string, string> = {
  AVAILABLE: "Available",
  NOT_AVAILABLE: "Not available",
  UNKNOWN: "Not stated",
};

export const requirementCategoryLabels: Record<string, string> = {
  EXPERIENCE: "Experience",
  CAPABILITY: "Capability",
  TOOL: "Tools",
  INDUSTRY: "Industry",
  EDUCATION: "Education",
  CERTIFICATION: "Certification",
  TECHNICAL_KNOWLEDGE: "Technical knowledge",
  LANGUAGE: "Language",
};

export const marketStateLabels: Record<MarketEvaluationState, string> = {
  evaluated: "Completed with a recommendation",
  completed_without_recommendation: "Completed without recommendation",
  in_progress: "Evaluation in progress",
  waiting_budget: "Waiting: AI budget",
  waiting_usage_limit: "Waiting: usage limit",
  failed: "Evaluation failed",
  not_yet_evaluated: "Not yet evaluated",
};

export const collectionLabels = { automated: "Automated only", all: "All collected" } as const;

export const titleGroupLabel = (key: string) => (key === "OTHER" ? "Other title" : key);
export const regionLabel = (key: string) => geographyLabels[key as keyof typeof geographyLabels] ?? key;
export const labelFrom = (labels: Record<string, string>) => (key: string) => labels[key] ?? key;

// Whole amounts in their own currency; nothing is converted.
export function formatAmount(value: number | null | undefined, currency: string | null): string {
  if (value === null || value === undefined) return "Unknown";
  if (!currency || currency === "UNKNOWN") return `${Math.round(value).toLocaleString("en-US")} (currency not stated)`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString("en-US")} ${currency}`;
  }
}

// "$110,000 (n = 2) · Insufficient sample"; no data reads "No data", never 0.
export function formatMedian(median: MarketMedian, currency: string | null): string {
  if (median.value === null) return "No data";
  const label = sampleLabels[median.sample];
  return `${formatAmount(median.value, currency)} (n = ${median.n})${label ? ` · ${label}` : ""}`;
}

export function marketWindowDescription(window: { key: SiWindow["key"]; from: string | null; to: string }): string {
  if (window.key !== "custom") return windowLabels[window.key];
  const end = new Date(new Date(window.to).getTime() - 24 * 60 * 60 * 1000);
  return `${window.from?.slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
}
