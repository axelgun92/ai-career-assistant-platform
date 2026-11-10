// Readable labels for dashboard filters, badges and chips. Display only:
// persisted values are never reinterpreted.

import { sourceTypeLabel } from "../opportunity-provenance";
import {
  arrangementOptions,
  residencyOptions,
  evaluationStateOptions,
  opportunityHref,
  opportunityViews,
  priorityOptions,
  recommendationOptions,
  roleFamilyOptions,
  segmentOptions,
  seniorityOptions,
  sortOptions,
  sourceTypeOptions,
  withChanges,
  type OpportunityQuery,
} from "../../server/opportunity-query";

export const recommendationLabels: Record<keyof typeof recommendationOptions, string> = {
  apply: "Apply",
  review: "Review",
  skip: "Skip",
  none: "No recommendation yet",
};

export const evaluationStateLabels: Record<keyof typeof evaluationStateOptions, string> = {
  none: "Not evaluated",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  deferred: "Deferred for budget",
};

export const priorityLabels: Record<keyof typeof priorityOptions, string> = {
  "very-high": "Very high",
  high: "High",
  "mixed-moderate": "Mixed / moderate",
  low: "Low",
  "very-low": "Very low",
  unknown: "Unknown or not evaluated",
};

export const roleFamilyLabels: Record<keyof typeof roleFamilyOptions, string> = {
  "core-cs": "Core Customer Success",
  "cs-adjacent": "Customer Success–adjacent",
  "support-heavy": "Support-heavy",
  "sales-heavy": "Sales-heavy",
  "implementation-heavy": "Implementation-heavy",
  "technical-cs": "Technical Customer Success",
  unrelated: "Unrelated",
  unknown: "Unknown or not evaluated",
};

export const segmentLabels: Record<keyof typeof segmentOptions, string> = {
  smb: "SMB",
  "mid-market": "Mid-market",
  commercial: "Commercial",
  enterprise: "Enterprise",
  mixed: "Mixed",
  unknown: "Unknown (evaluated)",
  "not-evaluated": "Not evaluated",
};

export const arrangementLabels: Record<keyof typeof arrangementOptions, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unknown: "Unknown (not stated)",
};

export const seniorityLabels: Record<keyof typeof seniorityOptions, string> = {
  entry: "Entry / junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead / staff",
  principal: "Principal",
  director: "Director",
  executive: "VP / executive",
  unknown: "Unknown (not stated)",
};

export const residencyFilterLabels: Record<keyof typeof residencyOptions, string> = {
  "us-required": "U.S. residence required",
  "non-us": "Non-U.S. residence allowed",
  unknown: "Unknown (not stated)",
};

export const sourceTypeFilterLabels = Object.fromEntries(
  Object.entries(sourceTypeOptions).map(([key, stored]) => [key, sourceTypeLabel(stored)]),
) as Record<keyof typeof sourceTypeOptions, string>;

// Stored value → label, for badges.
const priorityBandLabels: Record<string, string> = {
  VERY_HIGH: "Very high priority",
  HIGH: "High priority",
  MIXED_MODERATE: "Mixed / moderate priority",
  LOW: "Low priority",
  VERY_LOW: "Very low priority",
};

export function priorityBandLabel(band: string | null | undefined): string | null {
  return band ? priorityBandLabels[band] ?? null : null;
}

const evaluationStatusLabels: Record<string, string> = {
  PENDING: "Evaluation queued",
  RUNNING: "Evaluation running",
  COMPLETED: "Evaluation completed",
  FAILED: "Evaluation failed",
};

export function evaluationStatusLabel(status: string | null | undefined): string {
  return status ? evaluationStatusLabels[status] ?? "Evaluation status unknown" : "Not evaluated";
}

export interface FilterChip {
  label: string;
  removeHref: string;
}

type MultiKey =
  | "rec" | "eval" | "priority" | "role" | "segment" | "sourceType" | "arrangement" | "seniority" | "residency";

const multiFilters: Array<{ key: MultiKey; name: string; labels: Record<string, string> }> = [
  { key: "rec", name: "Recommendation", labels: recommendationLabels },
  { key: "eval", name: "Evaluation", labels: evaluationStateLabels },
  { key: "priority", name: "Priority", labels: priorityLabels },
  { key: "role", name: "Role family", labels: roleFamilyLabels },
  { key: "segment", name: "Segment", labels: segmentLabels },
  { key: "sourceType", name: "Source type", labels: sourceTypeFilterLabels },
  { key: "arrangement", name: "Work arrangement", labels: arrangementLabels },
  { key: "seniority", name: "Seniority", labels: seniorityLabels },
  { key: "residency", name: "Residency", labels: residencyFilterLabels },
];

const formatAmount = (value: number) => value.toLocaleString("en-US");

// One chip per active filter value; each links to the same view without it.
export function activeFilterChips(
  query: OpportunityQuery,
  names: { companies?: Record<string, string> } = {},
): FilterChip[] {
  const chips: FilterChip[] = [];
  const remove = (changes: Partial<OpportunityQuery>) => opportunityHref(withChanges(query, changes));
  if (query.q) chips.push({ label: `Search: “${query.q}”`, removeHref: remove({ q: "" }) });
  for (const filter of multiFilters) {
    for (const value of query[filter.key] as string[]) {
      chips.push({
        label: `${filter.name}: ${filter.labels[value] ?? value}`,
        removeHref: remove({ [filter.key]: (query[filter.key] as string[]).filter((item) => item !== value) }),
      });
    }
  }
  const single: Array<[keyof OpportunityQuery, string, string | null]> = [
    ["source", "Source", query.source],
    ["company", "Company", query.company ? names.companies?.[query.company] ?? "Selected company" : null],
    ["domain", "Domain", query.domain],
    ["title", "Title contains", query.title],
    ["location", "Location contains", query.location],
    ["salary", "Salary", query.salary === "stated" ? "Stated" : query.salary === "not-stated" ? "Not stated" : null],
    // Removing the currency also removes the amounts it qualifies.
    ["currency", "Salary currency", query.currency],
    ["salaryMin", "Salary at least", query.salaryMin === null ? null : `${formatAmount(query.salaryMin)} ${query.currency ?? ""}`.trim()],
    ["salaryMax", "Salary at most", query.salaryMax === null ? null : `${formatAmount(query.salaryMax)} ${query.currency ?? ""}`.trim()],
    ["from", "Discovered from", query.from],
    ["to", "Discovered to", query.to],
  ];
  for (const [key, name, value] of single) {
    if (!value) continue;
    const changes: Partial<OpportunityQuery> =
      key === "currency" ? { currency: null, salaryMin: null, salaryMax: null } : { [key]: null };
    chips.push({ label: `${name}: ${value}`, removeHref: remove(changes) });
  }
  return chips;
}

const plural = (count: number) => `${count} ${count === 1 ? "opportunity" : "opportunities"}`;

// What a salary amount filter could not compare, under the other filters.
export function salaryExclusionNote(
  exclusions: { currency: string; withoutAmount: number; unknownCurrency: number; otherCurrency: number } | null,
): string | null {
  if (!exclusions) return null;
  const parts = [
    exclusions.withoutAmount ? `${plural(exclusions.withoutAmount)} without a stated salary amount` : null,
    exclusions.otherCurrency ? `${plural(exclusions.otherCurrency)} with a salary in another currency` : null,
    exclusions.unknownCurrency ? `${plural(exclusions.unknownCurrency)} with an unknown salary currency` : null,
  ].filter((part): part is string => part !== null);
  if (!parts.length) return null;
  return `Salary filter compares ${exclusions.currency} amounts only. Not included: ${parts.join("; ")}.`;
}

// Salary sorts group by currency; say so unless one currency is selected.
export function salarySortNote(query: Pick<OpportunityQuery, "sort" | "currency">): string | null {
  if (query.sort !== "salary-high" && query.sort !== "salary-low") return null;
  return query.currency
    ? null
    : "Salaries are sorted within each currency, never across currencies; listings without a stated amount come last. Choose a currency to compare one.";
}

export const viewTabs = Object.entries(opportunityViews).map(([key, view]) => ({
  key: key as keyof typeof opportunityViews,
  label: view.label,
}));

export const sortChoices = Object.entries(sortOptions).map(([value, label]) => ({ value, label }));
