import { fieldsWithheldFromEvaluator } from "../../database/src/evaluation-repository";
import { describe, expect, it } from "vitest";

describe("evaluation input contract", () => {
  it("releases compensation, currency, and residency while retaining unrelated withholding", () => {
    expect(fieldsWithheldFromEvaluator).toEqual([
      "remoteStatus",
      "seniority",
      "department",
      "employmentType",
      "closingDate",
    ]);
    expect(fieldsWithheldFromEvaluator).not.toEqual(
      expect.arrayContaining([
        "salaryMin",
        "salaryMax",
        "salaryText",
        "currency",
        "compensationBasis",
        "residencyRequirement",
        "residencyRegions",
      ]),
    );
  });
});
