import { fieldsWithheldFromEvaluator } from "../../database/src/evaluation-repository";
import { describe, expect, it } from "vitest";

describe("evaluation input contract", () => {
  it("releases the six approved fields while retaining all 15 unrelated fields", () => {
    expect(fieldsWithheldFromEvaluator).toEqual([
      "remoteStatus",
      "seniority",
      "department",
      "employmentType",
      "closingDate",
      "timeZoneRequirements",
      "workAuthorizationRequirement",
      "workAuthorizationRegions",
      "visaSponsorship",
      "relocationSupport",
      "employerOfRecordRegions",
      "seniorityLabel",
      "workArrangements",
      "compensationTiers",
      "bonus",
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
