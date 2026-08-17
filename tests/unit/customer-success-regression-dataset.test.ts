import { describe, expect, it } from "vitest";
import {
  customerSuccessRegressionCases,
  customerSuccessRegressionCategories,
} from "../fixtures/customer-success-regression";

describe("Customer Success regression dataset harness", () => {
  it("contains every required review category", () => {
    expect(new Set(customerSuccessRegressionCases.map((item) => item.category))).toEqual(
      new Set(customerSuccessRegressionCategories),
    );
  });

  it("labels representative fixtures honestly and does not fabricate real sources", () => {
    expect(customerSuccessRegressionCases.every((item) => item.sourceStatus === "SYNTHETIC")).toBe(true);
    expect(customerSuccessRegressionCases.every((item) => item.sourceUrl === null)).toBe(true);
    expect(customerSuccessRegressionCases.every((item) => item.id.startsWith("synthetic-"))).toBe(true);
  });
});
