import { formatMoney } from "../budget/budget-format";
import type { SiEvaluationState, SiGeographyBucket, SiNote, SiRate, SiSample, SiWindowKey, SourceSortKey } from "@ai-career/core";

// Wording for Source Intelligence (feature 15). Neutral by design: states
// that are not a completed evaluation are never described as failures.

export const evaluationStateLabels: Record<SiEvaluationState, string> = {
  evaluated: "Evaluated",
  completed_without_recommendation: "Evaluated, no recommendation",
  in_progress: "Evaluation in progress",
  waiting_budget: "Waiting: AI budget",
  waiting_usage_limit: "Waiting: usage limit",
  failed: "Evaluation failed",
  user_dismissed: "User dismissed/archived",
  no_longer_listed: "No longer listed before evaluation",
  not_yet_evaluated: "Not yet evaluated",
};

export const geographyLabels: Record<SiGeographyBucket, string> = {
  UNITED_STATES: "United States",
  CANADA: "Canada",
  UNITED_KINGDOM: "United Kingdom",
  EUROPE: "Europe (excluding UK)",
  LATIN_AMERICA: "Latin America",
  APAC: "APAC",
  GLOBAL: "Global / Anywhere",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

export const noteLabels: Record<SiNote, string> = {
  no_runs_in_window: "No runs in this window.",
  no_successful_retrieval_in_window: "No successful retrieval in this window; listing counts here are not evidence of low yield.",
  waiting_for_details: "Some listings are waiting for their details to be read.",
  cost_incomplete: "Some evaluation attempts have no recorded cost, so cost figures are incomplete.",
  no_useful_jobs_yet: "No useful jobs yet among the evaluated ones.",
  selection_biased: "You chose these jobs yourself, so they are not comparable with automated sources.",
  awaiting_outcomes: "Some applications are under 30 days old and still awaiting a response.",
};

export const sampleLabels: Record<SiSample, string | null> = {
  none: null,
  insufficient: "Insufficient sample",
  small: "Small sample",
  normal: null,
};

export const windowLabels: Record<SiWindowKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom range",
};

export const sortLabels: Record<SourceSortKey, string> = {
  name: "Name",
  discovered: "Opportunities discovered",
  new: "New opportunities",
  useful_rate: "Useful rate",
  cost_per_useful: "Cost per useful job",
  success_rate: "Retrieval success rate",
};

export const decisionLabels: Record<string, string> = { APPLY: "Apply", REVIEW: "Review", SKIP: "Skip" };

export function formatPercent(value: number | null): string {
  if (value === null) return "Unknown";
  const percent = value * 100;
  return `${percent >= 10 || percent === 0 ? Math.round(percent) : percent.toFixed(1)}%`;
}

// "62% (5 of 8)"; with no denominator, the reason instead of a number.
export function formatRate(rate: SiRate, none = "Nothing to measure yet"): string {
  if (rate.value === null) return none;
  return `${formatPercent(rate.value)} (${rate.numerator} of ${rate.denominator})`;
}

// The compact last-30-days line on a /sources card.
export function sourceValueSummary(strip: {
  discovered: number;
  new: number;
  evaluated: number;
  useful: number;
  usefulSample: string;
  costPerUseful: number | null;
  costIncomplete: boolean;
  currency: string | null;
}): string {
  const parts = [`${strip.discovered} found`, `${strip.new} new`, `${strip.useful} useful of ${strip.evaluated} evaluated`];
  const sample = sampleLabels[strip.usefulSample as SiSample];
  if (sample) parts[2] += ` (${sample.toLowerCase()})`;
  if (strip.costPerUseful !== null) parts.push(`${formatMoney(strip.costPerUseful, strip.currency)} per useful job${strip.costIncomplete ? " (incomplete)" : ""}`);
  else if (strip.evaluated > 0 && strip.useful === 0) parts.push("no useful jobs yet");
  return `Last 30 days: ${parts.join(" · ")}`;
}
