import {
  geographyCountryNames,
  geographyRegionNames,
  geographySubdivisionNames,
  parseGeographyList,
  preEvaluatorTriageAssessmentSchema,
  residencyRequirementFor,
  workAuthorizationRelevance,
  type NormalizedOpportunity,
  type PreEvaluatorTriageAssessment,
  type PreEvaluatorTriageReason,
  type UserWorkEligibility,
} from "@ai-career/core";
import type { CustomerSuccessPreferences } from "../config/preferences";
import { evaluateSalaryPolicy, sameLocationScope, type SalaryPolicyDecision } from "../config/salary-policy";
import { employmentReasons, seniorityReasons, type PositionRequirementInput } from "./position-requirements";

// The normalized facts triage reads (November 25, 2026: the position facts,
// compensation tiers and the listing's explicit position evidence were
// added, so every hard requirement the opportunity page can show is the one
// triage decides on).
export type TriageOpportunity = Pick<
  NormalizedOpportunity,
  | "salaryMin"
  | "salaryMax"
  | "currency"
  | "compensationBasis"
  | "residencyRequirement"
  | "residencyRegions"
  | "remoteStatus"
  | "workArrangements"
  | "location"
  | "workAuthorizationRequirement"
  | "workAuthorizationRegions"
  | "visaSponsorship"
  | "relocationSupport"
  | "employerOfRecordRegions"
> &
  Partial<Pick<NormalizedOpportunity, "compensationTiers">> &
  Partial<PositionRequirementInput> & {
    // True when the stored arrangement's remote option is offered only by
    // exception (an office-first posting): not a genuine remote option.
    remoteByException?: boolean;
  };

const knownGeographyCodes = new Set([
  ...Object.keys(geographyCountryNames),
  ...Object.keys(geographySubdivisionNames),
  ...Object.keys(geographyRegionNames),
]);

function configuredCodes(values: readonly string[]): string[] | null {
  const codes: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const parsed = knownGeographyCodes.has(trimmed) ? [trimmed] : parseGeographyList(trimmed);
    if (!parsed) return null;
    for (const code of parsed) if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

function residencyReasons(
  opportunity: TriageOpportunity,
  preferences: CustomerSuccessPreferences,
): PreEvaluatorTriageReason[] {
  const fields = ["residencyRequirement", "residencyRegions"];
  if (!opportunity.residencyRequirement) {
    return [{
      code: "residency-unknown",
      fields,
      disposition: "NEEDS_REVIEW",
      message: "The job's residency requirement is Unknown or unresolved.",
    }];
  }
  const unknownRegion = opportunity.residencyRegions.some((region) => !knownGeographyCodes.has(region));
  const derived = residencyRequirementFor(opportunity.residencyRegions);
  if (
    unknownRegion ||
    (derived !== null && derived !== opportunity.residencyRequirement) ||
    (opportunity.residencyRequirement === "NON_US" && opportunity.residencyRegions.length === 0)
  ) {
    return [{
      code: "residency-conflicting-or-incomplete",
      fields,
      disposition: "NEEDS_REVIEW",
      message: "The structured residency evidence is conflicting or incomplete.",
    }];
  }
  if (opportunity.residencyRequirement === "US_REQUIRED" && !preferences.location.allowUnitedStatesOnlyRoles) {
    return [{
      code: "residency-us-only-incompatible",
      fields,
      disposition: "REJECT",
      message: "The job definitely requires U.S. residency, which conflicts with the configured location policy.",
    }];
  }
  const allowed = configuredCodes(preferences.location.allowedCountries);
  const disallowed = configuredCodes(preferences.location.disallowedCountries);
  if (allowed === null || disallowed === null) {
    return [{
      code: "residency-policy-unreadable",
      fields,
      disposition: "NEEDS_REVIEW",
      message: "The configured location policy cannot be compared safely with the structured residency evidence.",
    }];
  }
  const regions = opportunity.residencyRegions.length
    ? opportunity.residencyRegions
    : opportunity.residencyRequirement === "US_REQUIRED"
      ? ["US"]
      : [];
  if (
    disallowed.length > 0 &&
    regions.length > 0 &&
    regions.every((region) => disallowed.some((scope) => sameLocationScope(region, scope)))
  ) {
    return [{
      code: "residency-disallowed",
      fields,
      disposition: "REJECT",
      message: "Every stated eligible residency region is excluded by the configured location policy.",
    }];
  }
  if (
    allowed.length > 0 &&
    regions.length > 0 &&
    !regions.some((region) => allowed.some((scope) => sameLocationScope(region, scope)))
  ) {
    return [{
      code: "residency-outside-allowed",
      fields,
      disposition: "REJECT",
      message: "The stated eligible residency regions are outside the configured allowed locations.",
    }];
  }
  return [];
}

const salaryMessages: Record<SalaryPolicyDecision["reason"], string> = {
  UNKNOWN_SALARY: "Base salary is Unknown.",
  UNKNOWN_CURRENCY: "Salary currency is Unknown or unsupported.",
  UNKNOWN_RESIDENCY: "Salary compatibility depends on an unresolved residency requirement.",
  OTE_NOT_CONFIRMED_BASE: "The disclosed compensation includes variable pay (such as OTE, target total cash or bonuses), not confirmed base salary.",
  CONFLICTING_SALARY: "The normalized salary bounds conflict.",
  CONFLICTING_RESIDENCY: "The structured residency evidence conflicts.",
  US_THRESHOLD: "The definite base-salary ceiling is below the U.S. hard minimum.",
  US_REVIEW: "The salary is in the U.S. review band ($55,000-$59,999).",
  NON_US_PASS: "The salary meets the non-U.S. pass threshold.",
  NON_US_REVIEW: "The salary is in the non-U.S. review band.",
  NON_US_CONDITIONAL_REVIEW: "The salary is in the conditional non-U.S. review band.",
  NON_US_CONDITIONAL_UNKNOWN: "The salary is in the conditional band but location-cost viability is unresolved.",
  BELOW_NON_US_MINIMUM: "The definite base-salary ceiling is below the non-U.S. hard minimum.",
  NON_US_LOWER_COST_REVIEW: "The salary is below the non-U.S. minimum, but the eligible location is a configured lower-cost country.",
  OPEN_MAXIMUM_UNKNOWN: "Only a salary ceiling is known and it does not establish compatibility.",
};
const salaryCode = (reason: SalaryPolicyDecision["reason"]) => `salary-${reason.toLowerCase().replace(/_/g, "-")}`;
const salaryFields = ["salaryMin", "salaryMax", "currency", "compensationBasis", "compensationTiers", "residencyRequirement", "residencyRegions"];

function salaryDecision(
  range: { minimum: number | null; maximum: number | null; currency: string | null },
  opportunity: TriageOpportunity,
  preferences: CustomerSuccessPreferences,
): SalaryPolicyDecision {
  return evaluateSalaryPolicy({
    minimum: range.minimum,
    maximum: range.maximum,
    currency: range.currency,
    compensationBasis: opportunity.compensationBasis,
    residencyRequirement: opportunity.residencyRequirement,
    residencyRegions: opportunity.residencyRegions,
    substantiallyLowerCostCountries: preferences.salary.substantiallyLowerCostCountries,
  });
}

// Compensation tiers (pay stated per place, zone or band; November 25,
// 2026). The tiers the job's location or residency establishes are judged;
// when none is established, every tier is potentially applicable: all pass
// -> pass, all fail -> reject, otherwise review.
export function applicableCompensationTiers(
  tiers: NonNullable<TriageOpportunity["compensationTiers"]>,
  opportunity: Pick<TriageOpportunity, "location" | "residencyRegions">,
): { tiers: NonNullable<TriageOpportunity["compensationTiers"]>; established: boolean } {
  const location = (opportunity.location ?? "").toLowerCase();
  const matches = tiers.filter((tier) => {
    const label = tier.label.toLowerCase().trim();
    // The job's location names the tier ("Denver" in "Denver, CO"), or the
    // tier names exactly the job's residency region ("UK" for GB). A wider
    // residency ("US") never establishes a narrower tier ("New York").
    if (label.length >= 3 && location.length > 0 && (location.includes(label) || label.includes(location))) return true;
    const codes = parseGeographyList(tier.label);
    return Boolean(codes && opportunity.residencyRegions.length > 0 && codes.some((code) => opportunity.residencyRegions.includes(code)));
  });
  return matches.length > 0 && matches.length < tiers.length ? { tiers: matches, established: true } : { tiers, established: false };
}

function tierSalaryReasons(opportunity: TriageOpportunity, preferences: CustomerSuccessPreferences): PreEvaluatorTriageReason[] {
  const tiers = opportunity.compensationTiers ?? [];
  const { tiers: applicable, established } = applicableCompensationTiers(tiers, opportunity);
  const decisions = applicable.map((tier) => ({
    tier,
    decision: salaryDecision({ minimum: tier.minimum, maximum: tier.maximum, currency: tier.currency ?? opportunity.currency }, opportunity, preferences),
  }));
  const describe = (item: (typeof decisions)[number]) => `${item.tier.label}: ${item.decision.result.toLowerCase()}`;
  const scope = established ? "The tier the job's location establishes" : `Every potentially applicable tier (${applicable.length})`;
  const policy = decisions[0]?.decision.policyVersion ?? "";
  if (decisions.every((item) => item.decision.result === "PASS")) return [];
  if (decisions.every((item) => item.decision.result === "FAIL")) {
    return [{
      code: "salary-tiers-below-minimum",
      fields: salaryFields,
      disposition: "REJECT",
      message: `${scope} is below the base-salary minimum (${decisions.map(describe).join("; ")}). Policy ${policy}.`,
    }];
  }
  if (decisions.length === 1) {
    const only = decisions[0]!.decision;
    return [{ code: salaryCode(only.reason), fields: salaryFields, disposition: "NEEDS_REVIEW", message: `${salaryMessages[only.reason]} (tier ${decisions[0]!.tier.label}) Policy ${policy}.` }];
  }
  return [{
    code: "salary-tiers-differ",
    fields: salaryFields,
    disposition: "NEEDS_REVIEW",
    message: `The salary tiers give different results and the applicable tier is not established (${decisions.map(describe).join("; ")}). Policy ${policy}.`,
  }];
}

function salaryReasons(
  opportunity: TriageOpportunity,
  preferences: CustomerSuccessPreferences,
): PreEvaluatorTriageReason[] {
  // Usable tiers are salary evidence: the salary is never reported missing
  // while the opportunity states pay per tier.
  if (opportunity.salaryMin === null && opportunity.salaryMax === null && (opportunity.compensationTiers ?? []).length > 0) {
    return tierSalaryReasons(opportunity, preferences);
  }
  const decision = salaryDecision({ minimum: opportunity.salaryMin, maximum: opportunity.salaryMax, currency: opportunity.currency }, opportunity, preferences);
  if (decision.result === "PASS") return [];
  return [{
    code: salaryCode(decision.reason),
    fields: salaryFields.filter((field) => field !== "compensationTiers"),
    disposition: decision.result === "FAIL" ? "REJECT" : "NEEDS_REVIEW",
    message: `${salaryMessages[decision.reason]} Policy ${decision.policyVersion}.`,
  }];
}

// Customer Success work arrangement (November 25, 2026): Remote and Hybrid
// pass; on-site only is rejected wherever the job is; several genuine
// options pass when one is Remote or Hybrid; a remote option offered only by
// exception is not a genuine one; unknown or conflicting evidence is
// reviewed. These are the Customer Success hard rules themselves, so a
// stored profile that still lists On-site, or omits Hybrid, does not change
// them (the profile source now allows Remote and Hybrid only).
function arrangementReasons(opportunity: TriageOpportunity): PreEvaluatorTriageReason[] {
  const valid = new Set(["REMOTE", "HYBRID", "ONSITE"]);
  const fields = ["remoteStatus", "workArrangements"];
  const stated = opportunity.workArrangements.length
    ? [...new Set(opportunity.workArrangements)]
    : opportunity.remoteStatus
      ? [opportunity.remoteStatus]
      : [];
  const conflict =
    opportunity.remoteStatus !== null &&
    opportunity.workArrangements.length > 0 &&
    !opportunity.workArrangements.includes(opportunity.remoteStatus as "REMOTE" | "HYBRID" | "ONSITE");
  if (conflict || stated.some((item) => !valid.has(item))) {
    return [{ code: "work-arrangement-conflicting", fields, disposition: "NEEDS_REVIEW", message: "The structured work-arrangement evidence conflicts or is unsupported." }];
  }
  if (stated.length === 0) {
    return [{ code: "work-arrangement-unknown", fields, disposition: "NEEDS_REVIEW", message: "Work arrangement is Unknown." }];
  }
  // A remote option offered only by exception is not a genuine option.
  const genuine = opportunity.remoteByException ? stated.filter((item) => item !== "REMOTE") : stated;
  const flexible = genuine.filter((item) => item === "REMOTE" || item === "HYBRID");
  if (flexible.length === 0) {
    return [{
      code: "work-arrangement-onsite-only",
      fields,
      disposition: "REJECT",
      message: opportunity.remoteByException
        ? "The role is on-site; remote work is offered only by exception, which is not a genuine remote option."
        : "The role is on-site only; Customer Success roles must be remote or hybrid.",
    }];
  }
  return [];
}

function authorizationReasons(
  opportunity: TriageOpportunity,
  eligibility: UserWorkEligibility | null,
): PreEvaluatorTriageReason[] {
  const relevance = workAuthorizationRelevance(opportunity, eligibility);
  const explicit =
    opportunity.workAuthorizationRequirement !== null ||
    opportunity.visaSponsorship !== null ||
    opportunity.relocationSupport !== null ||
    opportunity.employerOfRecordRegions.length > 0;
  if (relevance.status === "REVIEW") {
    return [{
      code: "work-authorization-needs-review",
      fields: ["workAuthorizationRequirement", "workAuthorizationRegions", "visaSponsorship", "relocationSupport", "employerOfRecordRegions"],
      disposition: "NEEDS_REVIEW",
      message: "The job's explicit work-authorization requirement is not established as satisfied.",
    }];
  }
  if (relevance.status === "UNKNOWN_CHECK" || relevance.status === "FAVORABLE") {
    return [{
      code: "work-authorization-unresolved",
      fields: ["workAuthorizationRequirement", "workAuthorizationRegions", "visaSponsorship", "relocationSupport", "employerOfRecordRegions"],
      disposition: "NEEDS_REVIEW",
      message: "Work authorization may be possible, but the hard prerequisite remains unresolved.",
    }];
  }
  if (relevance.status === "NOT_CONFIGURED" && explicit) {
    return [{
      code: "work-eligibility-not-configured",
      fields: ["workAuthorizationRequirement", "workAuthorizationRegions"],
      disposition: "NEEDS_REVIEW",
      message: "The job states a work-authorization fact, but the user's eligibility is not configured.",
    }];
  }
  return [];
}

// The version of these triage rules. It is part of every assessment's input
// fingerprint, so a rule change makes earlier assessments stale and they are
// assessed again (November 25, 2026: seniority, employment type, on-site
// only, compensation tiers).
export const customerSuccessTriageRulesVersion = "cs-triage-2026-11-25";

export function triageCustomerSuccessOpportunity(input: {
  opportunity: TriageOpportunity;
  preferences: CustomerSuccessPreferences;
  eligibility: UserWorkEligibility | null;
}): PreEvaluatorTriageAssessment {
  const position: PositionRequirementInput = {
    title: input.opportunity.title ?? null,
    seniority: input.opportunity.seniority ?? null,
    seniorityLabel: input.opportunity.seniorityLabel ?? null,
    employmentType: input.opportunity.employmentType ?? null,
    evidence: input.opportunity.evidence ?? { peopleManagement: null, fullTimeSchedule: null },
  };
  const reasons = [
    ...seniorityReasons(position),
    ...employmentReasons(position),
    ...salaryReasons(input.opportunity, input.preferences),
    ...residencyReasons(input.opportunity, input.preferences),
    ...arrangementReasons(input.opportunity),
    ...authorizationReasons(input.opportunity, input.eligibility),
  ];
  const outcome = reasons.some((reason) => reason.disposition === "REJECT")
    ? "REJECT"
    : reasons.length > 0
      ? "NEEDS_REVIEW"
      : "EVALUATE";
  return preEvaluatorTriageAssessmentSchema.parse({ outcome, reasons });
}
