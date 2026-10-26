import type { EmploymentType, Seniority, WorkArrangement } from "@ai-career/core";

// Deterministic readings of explicit position facts. Each returns null
// (Unknown) unless exactly one value is stated; nothing is inferred from
// absence, context or the job description body.

const arrangementPatterns: Array<[WorkArrangement, RegExp]> = [
  ["REMOTE", /\bremote\b/i],
  ["HYBRID", /\bhybrid\b/i],
  ["ONSITE", /\b(?:on[- ]?site|in[- ]office|in[- ]person)\b/i],
];

// From a location field such as "Remote - United States" or "Boston, MA
// (Hybrid)". A plain place name is not read as on-site.
export function workArrangementFromLocation(location: string | null): WorkArrangement | null {
  if (!location) return null;
  if (/\b(?:not|no|non)[- ]remote\b/i.test(location)) return null;
  const stated = arrangementPatterns.filter(([, pattern]) => pattern.test(location)).map(([value]) => value);
  return stated.length === 1 ? stated[0]! : null;
}

// Only unambiguous level words. "Lead", "Staff", "Associate", "Head" and
// "Manager" are not read: in Customer Success titles they do not reliably
// state a level.
const seniorityPatterns: Array<[Seniority, RegExp]> = [
  ["ENTRY", /\b(?:junior|jr|entry[- ]level)\b/i],
  ["SENIOR", /\b(?:senior|sr)\b/i],
  ["PRINCIPAL", /\bprincipal\b/i],
  ["DIRECTOR", /\bdirector\b/i],
  ["EXECUTIVE", /\b(?:vice president|s?vp|evp|chief)\b/i],
];

export function seniorityFromTitle(title: string | null): Seniority | null {
  if (!title) return null;
  const stated = seniorityPatterns.filter(([, pattern]) => pattern.test(title)).map(([value]) => value);
  return stated.length === 1 ? stated[0]! : null;
}

const employmentTypes: Record<string, EmploymentType> = {
  fulltime: "FULL_TIME",
  parttime: "PART_TIME",
  contract: "CONTRACT",
  contractor: "CONTRACT",
  temporary: "TEMPORARY",
  temp: "TEMPORARY",
  internship: "INTERNSHIP",
  intern: "INTERNSHIP",
};

// Words that qualify an employment type without changing it
// ("Full-time/Permanent", "Regular full-time").
const permanence = new Set(["permanent", "regular", "perm"]);

// Standardizes an employment-type value as a source states it ("Full-time",
// "FULL_TIME", "Contract", "Full-time/Permanent"). Two different types
// ("Full-time, Contract") or unrecognized values stay Unknown.
export function standardizeEmploymentType(value: string | null): EmploymentType | null {
  if (!value) return null;
  const key = (part: string) => part.toLowerCase().replace(/[\s_-]+/g, "");
  const direct = employmentTypes[key(value)];
  if (direct) return direct;
  const parts = value.split(/\s*(?:[/,&+]|\band\b)\s*|\s+(?=(?:full|part)[\s-]?time\b)/i).map((part) => part.trim()).filter(Boolean);
  const types = new Set<EmploymentType>();
  for (const part of parts) {
    if (permanence.has(part.toLowerCase())) continue;
    const words = part.split(/\s+/).filter((word) => !permanence.has(word.toLowerCase())).join(" ");
    const type = employmentTypes[key(words)];
    if (!type) return null;
    types.add(type);
  }
  return types.size === 1 ? [...types][0]! : null;
}
