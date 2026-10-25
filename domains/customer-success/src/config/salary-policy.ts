import {
  geographyCountryNames,
  geographyRegionNames,
  geographySubdivisionNames,
  parseGeographyList,
  residencyRequirementFor,
  type ResidencyRequirement,
} from "@ai-career/core";

export const customerSuccessSalaryPolicy = {
  version: "cs-salary-policy-v3-ecb-2026-10-14",
  source:
    "European Central Bank euro foreign exchange reference rates, 2026-10-14",
  sourceUrl:
    "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
  referenceDate: "2026-10-14",
  usdPassMinimum: 60_000,
  nonUsReviewMinimum: 55_000,
  nonUsConditionalMinimum: 50_000,
  // ECB values are units of each currency per EUR. EUR itself is the base.
  unitsPerEuro: {
    EUR: 1,
    USD: 1.1195,
    JPY: 177.39,
    DKK: 7.4754,
    GBP: 0.84385,
    PLN: 4.3658,
    SEK: 11.158,
    CHF: 0.933,
    NOK: 10.6035,
    AUD: 1.5971,
    BRL: 5.6246,
    CAD: 1.5918,
    INR: 106.5283,
    MXN: 20.56,
    NZD: 1.9941,
    SGD: 1.4359,
    ZAR: 18.4382,
  },
} as const;

type SalaryPolicyResult = "PASS" | "REVIEW" | "FAIL" | "UNKNOWN";

export interface SalaryPolicyDecision {
  result: SalaryPolicyResult;
  minimumUsd: number | null;
  maximumUsd: number | null;
  policyVersion: string;
  reason:
    | "UNKNOWN_SALARY"
    | "UNKNOWN_CURRENCY"
    | "UNKNOWN_RESIDENCY"
    | "OTE_NOT_CONFIRMED_BASE"
    | "CONFLICTING_SALARY"
    | "CONFLICTING_RESIDENCY"
    | "US_THRESHOLD"
    | "NON_US_PASS"
    | "NON_US_REVIEW"
    | "NON_US_CONDITIONAL_REVIEW"
    | "NON_US_CONDITIONAL_UNKNOWN"
    | "BELOW_NON_US_MINIMUM"
    | "OPEN_MAXIMUM_UNKNOWN";
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function salaryAmountInUsd(
  amount: number,
  currency: string,
): number | null {
  const rate =
    customerSuccessSalaryPolicy.unitsPerEuro[
      currency as keyof typeof customerSuccessSalaryPolicy.unitsPerEuro
    ];
  if (rate === undefined) return null;
  return roundCurrency(
    (amount / rate) * customerSuccessSalaryPolicy.unitsPerEuro.USD,
  );
}

const knownGeographyCodes = new Set([
  ...Object.keys(geographyCountryNames),
  ...Object.keys(geographySubdivisionNames),
  ...Object.keys(geographyRegionNames),
]);

function configuredGeographyCodes(values: readonly string[]) {
  return values.flatMap((value) => {
    const trimmed = value.trim();
    if (knownGeographyCodes.has(trimmed)) return [trimmed];
    return parseGeographyList(trimmed) ?? [];
  });
}

function sameLocationScope(actual: string, configured: string) {
  return (
    actual === configured ||
    actual.startsWith(`${configured}-`) ||
    actual === "WORLDWIDE"
  );
}

export function hasConfiguredLowerCostLocation(input: {
  residencyRegions: readonly string[];
  substantiallyLowerCostCountries: readonly string[];
}) {
  const configured = configuredGeographyCodes(
    input.substantiallyLowerCostCountries,
  );
  return input.residencyRegions.some((actual) =>
    configured.some((allowed) => sameLocationScope(actual, allowed)),
  );
}

function classifyKnownAmount(
  amountUsd: number,
  residencyRequirement: ResidencyRequirement,
  lowerCostLocation: boolean,
): Pick<SalaryPolicyDecision, "result" | "reason"> {
  if (residencyRequirement === "US_REQUIRED") {
    return {
      result:
        amountUsd >= customerSuccessSalaryPolicy.usdPassMinimum
          ? "PASS"
          : "FAIL",
      reason: "US_THRESHOLD",
    };
  }
  if (amountUsd >= customerSuccessSalaryPolicy.usdPassMinimum) {
    return { result: "PASS", reason: "NON_US_PASS" };
  }
  if (amountUsd >= customerSuccessSalaryPolicy.nonUsReviewMinimum) {
    return { result: "REVIEW", reason: "NON_US_REVIEW" };
  }
  if (amountUsd >= customerSuccessSalaryPolicy.nonUsConditionalMinimum) {
    return lowerCostLocation
      ? { result: "REVIEW", reason: "NON_US_CONDITIONAL_REVIEW" }
      : { result: "UNKNOWN", reason: "NON_US_CONDITIONAL_UNKNOWN" };
  }
  return { result: "FAIL", reason: "BELOW_NON_US_MINIMUM" };
}

export function evaluateSalaryPolicy(input: {
  minimum: number | null;
  maximum: number | null;
  currency: string | null;
  compensationBasis: "BASE" | "OTE" | null;
  residencyRequirement: ResidencyRequirement | null;
  residencyRegions: readonly string[];
  substantiallyLowerCostCountries: readonly string[];
}): SalaryPolicyDecision {
  const base = {
    minimumUsd: null,
    maximumUsd: null,
    policyVersion: customerSuccessSalaryPolicy.version,
  };
  if (input.minimum === null && input.maximum === null) {
    return { ...base, result: "UNKNOWN", reason: "UNKNOWN_SALARY" };
  }
  if (
    input.minimum !== null &&
    input.maximum !== null &&
    input.minimum > input.maximum
  ) {
    return { ...base, result: "UNKNOWN", reason: "CONFLICTING_SALARY" };
  }
  if (input.compensationBasis === "OTE") {
    return {
      ...base,
      result: "UNKNOWN",
      reason: "OTE_NOT_CONFIRMED_BASE",
    };
  }
  if (input.currency === null) {
    return { ...base, result: "UNKNOWN", reason: "UNKNOWN_CURRENCY" };
  }
  const minimumUsd =
    input.minimum === null
      ? null
      : salaryAmountInUsd(input.minimum, input.currency);
  const maximumUsd =
    input.maximum === null
      ? null
      : salaryAmountInUsd(input.maximum, input.currency);
  if (
    (input.minimum !== null && minimumUsd === null) ||
    (input.maximum !== null && maximumUsd === null)
  ) {
    return { ...base, result: "UNKNOWN", reason: "UNKNOWN_CURRENCY" };
  }
  const converted = { ...base, minimumUsd, maximumUsd };
  if (input.residencyRequirement === null) {
    return {
      ...converted,
      result: "UNKNOWN",
      reason: "UNKNOWN_RESIDENCY",
    };
  }
  const unknownRegion = input.residencyRegions.some(
    (region) => !knownGeographyCodes.has(region),
  );
  const derivedRequirement = residencyRequirementFor(input.residencyRegions);
  if (
    unknownRegion ||
    (derivedRequirement !== null &&
      derivedRequirement !== input.residencyRequirement)
  ) {
    return {
      ...converted,
      result: "UNKNOWN",
      reason: "CONFLICTING_RESIDENCY",
    };
  }
  const lowerCostLocation = hasConfiguredLowerCostLocation(input);
  if (minimumUsd === null) {
    if (maximumUsd === null) {
      return { ...converted, result: "UNKNOWN", reason: "UNKNOWN_SALARY" };
    }
    const maximumDecision = classifyKnownAmount(
      maximumUsd,
      input.residencyRequirement,
      lowerCostLocation,
    );
    return maximumDecision.result === "FAIL"
      ? { ...converted, ...maximumDecision }
      : { ...converted, result: "UNKNOWN", reason: "OPEN_MAXIMUM_UNKNOWN" };
  }
  const minimumDecision = classifyKnownAmount(
    minimumUsd,
    input.residencyRequirement,
    lowerCostLocation,
  );
  return { ...converted, ...minimumDecision };
}
