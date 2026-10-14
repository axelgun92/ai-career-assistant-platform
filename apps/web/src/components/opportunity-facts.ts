// Readable labels for normalized position and compensation facts. Display
// only: stored values are shown as recorded and null always reads Unknown.

import { geographyName } from "@ai-career/core";

export const workArrangementChoices = [
  ["REMOTE", "Remote"],
  ["HYBRID", "Hybrid"],
  ["ONSITE", "On-site"],
] as const;

export const seniorityChoices = [
  ["ENTRY", "Entry / junior"],
  ["MID", "Mid-level"],
  ["SENIOR", "Senior"],
  ["LEAD", "Lead / staff"],
  ["PRINCIPAL", "Principal"],
  ["DIRECTOR", "Director"],
  ["EXECUTIVE", "VP / executive"],
] as const;

export const employmentTypeChoices = [
  ["FULL_TIME", "Full-time"],
  ["PART_TIME", "Part-time"],
  ["CONTRACT", "Contract"],
  ["TEMPORARY", "Temporary"],
  ["INTERNSHIP", "Internship"],
] as const;

const lookup = (choices: ReadonlyArray<readonly [string, string]>) => {
  const labels = new Map<string, string>(choices);
  return (value: string | null | undefined): string => (value ? labels.get(value) ?? value : "Unknown");
};

export const workArrangementLabel = lookup(workArrangementChoices);
export const seniorityLabel = lookup(seniorityChoices);
export const employmentTypeLabel = lookup(employmentTypeChoices);

const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

// "72,000–88,000 USD", "At least 70,000 USD", "Up to 90,000 USD". Null when
// no amount was stated; an unknown currency is said, never assumed.
export function formatSalaryRange(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  const unit = currency ? ` ${currency}` : " (currency unknown)";
  const min = minimum ?? null;
  const max = maximum ?? null;
  if (min === null && max === null) return null;
  if (min !== null && max !== null) {
    return min === max ? `${amount(min)}${unit}` : `${amount(min)}–${amount(max)}${unit}`;
  }
  return min !== null ? `At least ${amount(min)}${unit}` : `Up to ${amount(max!)}${unit}`;
}

export const residencyChoices = [
  ["US_REQUIRED", "U.S. residence required"],
  ["NON_US", "Non-U.S. residence allowed"],
] as const;

export const residencyLabel = lookup(residencyChoices);

// "U.S. residence required", "U.S. residence required (Texas, Florida)",
// "Non-U.S. residence allowed (Spain, Portugal)", or "Unknown". The eligible
// geographies are shown exactly as stated; the whole U.S. needs no list.
export function formatResidency(
  requirement: string | null | undefined,
  regions: readonly string[] | null | undefined,
): string {
  const label = residencyLabel(requirement);
  if (!requirement || !regions?.length || (regions.length === 1 && regions[0] === "US")) return label;
  return `${label} (${regions.map(geographyName).join(", ")})`;
}
