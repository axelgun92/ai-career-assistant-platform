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

// The stated range with what it is, when the posting says ("OTE", "base").
export function formatCompensationRange(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
  currency: string | null | undefined,
  basis: string | null | undefined,
): string | null {
  const range = formatSalaryRange(minimum, maximum, currency);
  if (!range) return null;
  return basis === "OTE" ? `${range} (OTE)` : basis === "BASE" ? `${range} (base salary)` : range;
}

// The opportunity's salary, as shown everywhere in the product: the range
// (with its basis and currency) when it is known; otherwise the labelled
// regional ranges, each with its own label and currency, side by side and
// never merged ("Zone 2: 120,000–160,000 USD · Zone 3: 108,000–144,000
// USD"); otherwise null (Unknown). The raw compensation text is kept as a
// fact and in provenance, but is not shown in place of a salary.
export function formatSalary(facts: {
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  compensationBasis?: string | null;
  salaryText?: string | null;
  compensationTiers?: ReadonlyArray<{ label: string; minimum: number | null; maximum: number | null; currency: string | null }> | null;
}): string | null {
  const range = formatCompensationRange(facts.salaryMin, facts.salaryMax, facts.currency, facts.compensationBasis);
  if (range) return range;
  const tiers = (facts.compensationTiers ?? [])
    .map((tier) => {
      const amount = formatSalaryRange(tier.minimum, tier.maximum, tier.currency);
      return amount ? `${tier.label}: ${amount}` : null;
    })
    .filter((tier): tier is string => tier !== null);
  return tiers.length ? tiers.join(" · ") : null;
}

// The work arrangement as stated: one arrangement, or every option the
// posting offers in its order ("On-site / Remote"); Unknown when none.
export function formatWorkArrangements(facts: { remoteStatus?: string | null; workArrangements?: readonly string[] | null }): string {
  const stated = facts.workArrangements?.length ? facts.workArrangements : facts.remoteStatus ? [facts.remoteStatus] : [];
  return stated.length ? stated.map((value) => workArrangementLabel(value)).join(" / ") : workArrangementLabel(null);
}

// The work-authorization facts as stated: the requirement (or that none is
// stated), and sponsorship always, since its absence is itself Unknown.
export function formatWorkAuthorization(facts: {
  workAuthorizationRequirement: string | null;
  workAuthorizationRegions: string[];
  visaSponsorship: string | null;
  relocationSupport: string | null;
  employerOfRecordRegions: string[];
}, regionName: (code: string) => string): string | null {
  const regions = facts.workAuthorizationRegions.map(regionName).join(", ");
  const stated = facts.workAuthorizationRequirement !== null || facts.visaSponsorship !== null || facts.relocationSupport !== null || facts.employerOfRecordRegions.length > 0;
  if (!stated) return null;
  const parts = [
    facts.workAuthorizationRequirement === "RIGHT_TO_WORK" ? `${regions} authorization required`
      : facts.workAuthorizationRequirement === "CITIZENSHIP" ? `${regions} citizenship required`
      : "Requirement not stated",
    `Sponsorship: ${facts.visaSponsorship === "AVAILABLE" ? "available" : facts.visaSponsorship === "NOT_AVAILABLE" ? "not available" : "Unknown"}`,
    ...(facts.relocationSupport ? [`Relocation support: ${facts.relocationSupport === "AVAILABLE" ? "available" : "not available"}`] : []),
    ...(facts.employerOfRecordRegions.length ? [`Employer of record in ${facts.employerOfRecordRegions.map(regionName).join(", ")}`] : []),
  ];
  return parts.join(" · ");
}

// How the application link was established, from its provenance marker.
export const applicationUrlBasisNotes: Record<string, string> = {
  "source.applyUrl": "the application link the source states",
  "source.postingPageIsApplication": "the posting page, which hosts the application",
  "page:application-form": "the captured page, which holds the application form",
  "structured.directApply": "the posting page, which its job data says is applied to directly",
  "page:apply-link": "the apply link on the captured page",
};
