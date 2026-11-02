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
import { evaluateSalaryPolicy, sameLocationScope } from "../config/salary-policy";

type TriageOpportunity = Pick<
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
>;

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

function salaryReasons(
  opportunity: TriageOpportunity,
  preferences: CustomerSuccessPreferences,
): PreEvaluatorTriageReason[] {
  const decision = evaluateSalaryPolicy({
    minimum: opportunity.salaryMin,
    maximum: opportunity.salaryMax,
    currency: opportunity.currency,
    compensationBasis: opportunity.compensationBasis,
    residencyRequirement: opportunity.residencyRequirement,
    residencyRegions: opportunity.residencyRegions,
    substantiallyLowerCostCountries: preferences.salary.substantiallyLowerCostCountries,
  });
  if (decision.result === "PASS") return [];
  const messages: Record<typeof decision.reason, string> = {
    UNKNOWN_SALARY: "Base salary is Unknown.",
    UNKNOWN_CURRENCY: "Salary currency is Unknown or unsupported.",
    UNKNOWN_RESIDENCY: "Salary compatibility depends on an unresolved residency requirement.",
    OTE_NOT_CONFIRMED_BASE: "The disclosed compensation is OTE, not confirmed base salary.",
    CONFLICTING_SALARY: "The normalized salary bounds conflict.",
    CONFLICTING_RESIDENCY: "The structured residency evidence conflicts.",
    US_THRESHOLD: "The definite base-salary ceiling is below the U.S. hard minimum.",
    NON_US_PASS: "The salary meets the non-U.S. pass threshold.",
    NON_US_REVIEW: "The salary is in the non-U.S. review band.",
    NON_US_CONDITIONAL_REVIEW: "The salary is in the conditional non-U.S. review band.",
    NON_US_CONDITIONAL_UNKNOWN: "The salary is in the conditional band but location-cost viability is unresolved.",
    BELOW_NON_US_MINIMUM: "The definite base-salary ceiling is below the non-U.S. hard minimum.",
    OPEN_MAXIMUM_UNKNOWN: "Only a salary ceiling is known and it does not establish compatibility.",
  };
  const codes: Record<typeof decision.reason, string> = {
    UNKNOWN_SALARY: "salary-unknown-salary",
    UNKNOWN_CURRENCY: "salary-unknown-currency",
    UNKNOWN_RESIDENCY: "salary-unknown-residency",
    OTE_NOT_CONFIRMED_BASE: "salary-ote-not-confirmed-base",
    CONFLICTING_SALARY: "salary-conflicting-salary",
    CONFLICTING_RESIDENCY: "salary-conflicting-residency",
    US_THRESHOLD: "salary-us-threshold",
    NON_US_PASS: "salary-non-us-pass",
    NON_US_REVIEW: "salary-non-us-review",
    NON_US_CONDITIONAL_REVIEW: "salary-non-us-conditional-review",
    NON_US_CONDITIONAL_UNKNOWN: "salary-non-us-conditional-unknown",
    BELOW_NON_US_MINIMUM: "salary-below-non-us-minimum",
    OPEN_MAXIMUM_UNKNOWN: "salary-open-maximum-unknown",
  };
  return [{
    code: codes[decision.reason],
    fields: ["salaryMin", "salaryMax", "currency", "compensationBasis", "residencyRequirement", "residencyRegions"],
    disposition: decision.result === "FAIL" ? "REJECT" : "NEEDS_REVIEW",
    message: `${messages[decision.reason]} Policy ${decision.policyVersion}.`,
  }];
}

function arrangementReasons(
  opportunity: TriageOpportunity,
  preferences: CustomerSuccessPreferences,
): PreEvaluatorTriageReason[] {
  const valid = new Set(["REMOTE", "HYBRID", "ONSITE"]);
  const offered = opportunity.workArrangements.length
    ? [...new Set(opportunity.workArrangements)]
    : opportunity.remoteStatus
      ? [opportunity.remoteStatus]
      : [];
  const conflict =
    opportunity.remoteStatus !== null &&
    opportunity.workArrangements.length > 0 &&
    !opportunity.workArrangements.includes(opportunity.remoteStatus as "REMOTE" | "HYBRID" | "ONSITE");
  if (conflict || offered.some((item) => !valid.has(item))) {
    return [{
      code: "work-arrangement-conflicting",
      fields: ["remoteStatus", "workArrangements"],
      disposition: "NEEDS_REVIEW",
      message: "The structured work-arrangement evidence conflicts or is unsupported.",
    }];
  }
  if (offered.length === 0) {
    return [{
      code: "work-arrangement-unknown",
      fields: ["remoteStatus", "workArrangements"],
      disposition: "NEEDS_REVIEW",
      message: "Work arrangement is Unknown.",
    }];
  }
  if (!offered.some((item) => preferences.workArrangement.allowed.includes(item as "REMOTE" | "HYBRID" | "ONSITE"))) {
    return [{
      code: "work-arrangement-incompatible",
      fields: ["remoteStatus", "workArrangements"],
      disposition: "REJECT",
      message: "Every stated work arrangement conflicts with the configured hard work-arrangement policy.",
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

export function triageCustomerSuccessOpportunity(input: {
  opportunity: TriageOpportunity;
  preferences: CustomerSuccessPreferences;
  eligibility: UserWorkEligibility | null;
}): PreEvaluatorTriageAssessment {
  const reasons = [
    ...salaryReasons(input.opportunity, input.preferences),
    ...residencyReasons(input.opportunity, input.preferences),
    ...arrangementReasons(input.opportunity, input.preferences),
    ...authorizationReasons(input.opportunity, input.eligibility),
  ];
  const outcome = reasons.some((reason) => reason.disposition === "REJECT")
    ? "REJECT"
    : reasons.length > 0
      ? "NEEDS_REVIEW"
      : "EVALUATE";
  return preEvaluatorTriageAssessmentSchema.parse({ outcome, reasons });
}
