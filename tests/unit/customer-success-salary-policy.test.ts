import {
  customerSuccessSalaryPolicy,
  evaluateSalaryPolicy,
  salaryAmountInUsd,
} from "@ai-career/customer-success";
import { describe, expect, it } from "vitest";

function evaluate(input: {
  minimum: number | null;
  maximum?: number | null;
  currency?: string | null;
  residencyRequirement: "US_REQUIRED" | "NON_US" | null;
  residencyRegions?: string[];
  substantiallyLowerCostCountries?: string[];
}) {
  return evaluateSalaryPolicy({
    minimum: input.minimum,
    maximum: input.maximum ?? input.minimum,
    currency: input.currency === undefined ? "USD" : input.currency,
    residencyRequirement: input.residencyRequirement,
    residencyRegions: input.residencyRegions ?? [],
    substantiallyLowerCostCountries:
      input.substantiallyLowerCostCountries ?? [],
  });
}

describe("Customer Success salary policy", () => {
  it.each([
    [59_999, "FAIL"],
    [60_000, "PASS"],
    [75_000, "PASS"],
    [100_000, "PASS"],
  ] as const)(
    "classifies a US-required USD minimum of %s as %s",
    (minimum, result) => {
      expect(
        evaluate({ minimum, residencyRequirement: "US_REQUIRED" }).result,
      ).toBe(result);
    },
  );

  it.each([
    [49_999, "FAIL"],
    [55_000, "REVIEW"],
    [59_999, "REVIEW"],
    [60_000, "PASS"],
    [75_000, "PASS"],
  ] as const)(
    "classifies a non-US USD minimum of %s as %s",
    (minimum, result) => {
      expect(
        evaluate({ minimum, residencyRequirement: "NON_US" }).result,
      ).toBe(result);
    },
  );

  it.each([50_000, 54_999])(
    "conditionally reviews a non-US minimum of %s only with configured geography viability",
    (minimum) => {
      const viable = evaluate({
        minimum,
        residencyRequirement: "NON_US",
        residencyRegions: ["MX"],
        substantiallyLowerCostCountries: ["Mexico"],
      });
      expect(viable.result).toBe("REVIEW");
      expect(viable.reason).toBe("NON_US_CONDITIONAL_REVIEW");

      const unknown = evaluate({
        minimum,
        residencyRequirement: "NON_US",
        residencyRegions: ["ES"],
        substantiallyLowerCostCountries: ["Mexico"],
      });
      expect(unknown.result).toBe("UNKNOWN");
      expect(unknown.reason).toBe("NON_US_CONDITIONAL_UNKNOWN");
    },
  );

  it("selects the policy from residency rather than salary currency", () => {
    const spainInUsd = evaluate({
      minimum: 57_000,
      residencyRequirement: "NON_US",
      residencyRegions: ["ES"],
    });
    expect(spainInUsd.result).toBe("REVIEW");
    expect(spainInUsd.reason).toBe("NON_US_REVIEW");

    const unitedStatesInEur = evaluate({
      minimum: 54_000,
      currency: "EUR",
      residencyRequirement: "US_REQUIRED",
      residencyRegions: ["US"],
    });
    expect(unitedStatesInEur.minimumUsd).toBe(60_453);
    expect(unitedStatesInEur.result).toBe("PASS");

    const mixedEligibility = evaluate({
      minimum: 57_000,
      residencyRequirement: "NON_US",
      residencyRegions: ["US", "CA-ON"],
    });
    expect(mixedEligibility.result).toBe("REVIEW");
    expect(mixedEligibility.reason).toBe("NON_US_REVIEW");
  });

  it("uses the versioned ECB cross-rate configuration", () => {
    expect(customerSuccessSalaryPolicy.version).toBe(
      "cs-salary-policy-v2-ecb-2026-10-14",
    );
    expect(salaryAmountInUsd(10_000, "EUR")).toBe(11_195);
    expect(salaryAmountInUsd(10_000, "GBP")).toBe(13_266.58);
    expect(salaryAmountInUsd(10_000, "XYZ")).toBeNull();
  });

  it("preserves Unknown instead of guessing required facts", () => {
    expect(
      evaluate({ minimum: null, residencyRequirement: "US_REQUIRED" }),
    ).toMatchObject({ result: "UNKNOWN", reason: "UNKNOWN_SALARY" });
    expect(
      evaluate({
        minimum: 75_000,
        currency: null,
        residencyRequirement: "US_REQUIRED",
      }),
    ).toMatchObject({ result: "UNKNOWN", reason: "UNKNOWN_CURRENCY" });
    expect(
      evaluate({ minimum: 75_000, residencyRequirement: null }),
    ).toMatchObject({ result: "UNKNOWN", reason: "UNKNOWN_RESIDENCY" });
    expect(
      evaluate({
        minimum: 75_000,
        maximum: 60_000,
        residencyRequirement: "US_REQUIRED",
        residencyRegions: ["US"],
      }),
    ).toMatchObject({ result: "UNKNOWN", reason: "CONFLICTING_SALARY" });
    expect(
      evaluate({
        minimum: 75_000,
        residencyRequirement: "US_REQUIRED",
        residencyRegions: ["US", "CA-ON"],
      }),
    ).toMatchObject({ result: "UNKNOWN", reason: "CONFLICTING_RESIDENCY" });
  });

  it("uses a disclosed minimum as the gate and never recreates a US review band", () => {
    expect(
      evaluate({
        minimum: 59_999,
        maximum: 100_000,
        residencyRequirement: "US_REQUIRED",
      }).result,
    ).toBe("FAIL");
  });

  it("keeps a max-only disclosure Unknown unless even its maximum is below the floor", () => {
    expect(
      evaluate({
        minimum: null,
        maximum: 75_000,
        residencyRequirement: "US_REQUIRED",
      }).result,
    ).toBe("UNKNOWN");
    expect(
      evaluate({
        minimum: null,
        maximum: 49_999,
        residencyRequirement: "NON_US",
      }).result,
    ).toBe("FAIL");
  });
});
