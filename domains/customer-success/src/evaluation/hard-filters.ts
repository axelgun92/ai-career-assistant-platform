import { defineEvaluationStage } from "@ai-career/evaluation";
import type { CustomerSuccessDomainData } from "../evaluator";
import { reconstructCustomerSuccessJob } from "../extraction/extractor";
import {
  hardFiltersDataSchema,
  type HardFiltersData,
} from "../schemas/results";

type Criterion = HardFiltersData["salary"];

function salaryResult(data: CustomerSuccessDomainData): Criterion {
  const salary = data.reconstruction!.salary;
  const preferences = data.preferences.salary;
  if (salary.disclosure === "UNDISCLOSED") {
    return {
      result: "UNKNOWN",
      explanation: "Salary is not disclosed and remains Unknown.",
      evidenceReferences: [],
    };
  }
  if (salary.disclosure === "COMPETITIVE") {
    return {
      result: "UNKNOWN",
      explanation: "Competitive salary is not meaningful compensation evidence.",
      evidenceReferences: salary.evidenceReferences,
    };
  }
  const minimum = salary.minimum!;
  const maximum = salary.maximum ?? minimum;
  if (minimum >= preferences.passMinimum) {
    return {
      result: "PASS",
      explanation: `The disclosed minimum meets the ${preferences.passMinimum} pass threshold.`,
      evidenceReferences: salary.evidenceReferences,
    };
  }
  if (minimum >= preferences.reviewMinimum) {
    return {
      result: "REVIEW",
      explanation: `The disclosed minimum is between ${preferences.reviewMinimum} and ${preferences.passMinimum}.`,
      evidenceReferences: salary.evidenceReferences,
    };
  }
  if (maximum >= preferences.reviewMinimum) {
    return {
      result: "REVIEW",
      explanation: "The disclosed range crosses a configured salary boundary.",
      evidenceReferences: salary.evidenceReferences,
    };
  }
  const location = data.reconstruction!.location;
  const requiresUnitedStates = location.countryRestrictions.some((country) =>
    /^(united states|us|u\.s\.)$/i.test(country),
  );
  if (requiresUnitedStates) {
    return {
      result: "FAIL",
      explanation:
        "Salary below the review threshold fails when United States residency is required.",
      evidenceReferences: [
        ...salary.evidenceReferences,
        ...location.evidenceReferences,
      ],
    };
  }
  const lowerCostCountryAllowed =
    location.internationalEligibility === "EXPLICITLY_ALLOWED" &&
    preferences.substantiallyLowerCostCountries.length > 0;
  const namedLowerCostCountry = location.countryRestrictions.some((country) =>
    preferences.substantiallyLowerCostCountries.some(
      (allowed) => allowed.toLowerCase() === country.toLowerCase(),
    ),
  );
  if (lowerCostCountryAllowed || namedLowerCostCountry) {
    return {
      result: "PASS",
      explanation:
        "The role explicitly permits residence in a configured substantially lower-cost country, so evaluation may continue.",
      evidenceReferences: [
        ...salary.evidenceReferences,
        ...location.evidenceReferences,
      ],
    };
  }
  return {
    result: "REVIEW",
    explanation:
      "Salary is below the review threshold and residency flexibility is unclear.",
    evidenceReferences: salary.evidenceReferences,
  };
}

function locationResult(data: CustomerSuccessDomainData): Criterion {
  const location = data.reconstruction!.location;
  const preferences = data.preferences.location;
  const disallowed = location.countryRestrictions.find((country) =>
    preferences.disallowedCountries.some(
      (item) => item.toLowerCase() === country.toLowerCase(),
    ),
  );
  if (disallowed) {
    return {
      result: "FAIL",
      explanation: `${disallowed} is excluded by the configured location preferences.`,
      evidenceReferences: location.evidenceReferences,
    };
  }
  const outsideAllowed = location.countryRestrictions.find(
    (country) =>
      preferences.allowedCountries.length > 0 &&
      !preferences.allowedCountries.some(
        (item) => item.toLowerCase() === country.toLowerCase(),
      ),
  );
  if (outsideAllowed) {
    return {
      result: "FAIL",
      explanation: `${outsideAllowed} is outside the configured allowed countries.`,
      evidenceReferences: location.evidenceReferences,
    };
  }
  const usOnly = location.countryRestrictions.some((country) =>
    /^(united states|us|u\.s\.)$/i.test(country),
  );
  if (usOnly && !preferences.allowUnitedStatesOnlyRoles) {
    return {
      result: "FAIL",
      explanation: "United States-only employment conflicts with the configured preference.",
      evidenceReferences: location.evidenceReferences,
    };
  }
  if (location.countryRestrictions.length === 0) {
    return {
      result: "UNKNOWN",
      explanation: "Country eligibility is not stated and remains Unknown.",
      evidenceReferences: location.evidenceReferences,
    };
  }
  return {
    result: "PASS",
    explanation:
      location.timeZoneRequirements.length > 0
        ? `The location is eligible; time-zone requirements are displayed factually: ${location.timeZoneRequirements.join(", ")}.`
        : "The stated country restriction does not conflict with configured preferences.",
    evidenceReferences: location.evidenceReferences,
  };
}

function workArrangementResult(data: CustomerSuccessDomainData): Criterion {
  const arrangement = data.reconstruction!.location.remoteStatus;
  if (arrangement === "UNKNOWN") {
    return {
      result: data.preferences.workArrangement.unknownResult,
      explanation: "Work arrangement is not stated and remains Unknown.",
      evidenceReferences: data.reconstruction!.location.evidenceReferences,
    };
  }
  const allowed = data.preferences.workArrangement.allowed.includes(arrangement);
  return {
    result: allowed ? "PASS" : "FAIL",
    explanation: allowed
      ? `${arrangement} is allowed by the configured work-arrangement preference.`
      : `${arrangement} conflicts with the configured work-arrangement preference.`,
    evidenceReferences: data.reconstruction!.location.evidenceReferences,
  };
}

function travelResult(data: CustomerSuccessDomainData): Criterion {
  const travel = data.reconstruction!.travel;
  if (travel.purpose === "UNKNOWN") {
    return {
      result: "UNKNOWN",
      explanation: "Travel is not stated and remains Unknown.",
      evidenceReferences: [],
    };
  }
  if (travel.purpose === "NONE") {
    return {
      result: "PASS",
      explanation: "The job explicitly states that travel is not required.",
      evidenceReferences: travel.evidenceReferences,
    };
  }
  const recurring = /weekly|monthly|frequent|recurring/i.test(
    travel.frequency ?? "",
  );
  if (travel.purpose === "FIELD_TRAVEL") {
    return {
      result: data.preferences.travel.fieldTravelResult,
      explanation: "The role is built around field travel.",
      evidenceReferences: travel.evidenceReferences,
    };
  }
  if (travel.purpose === "CUSTOMER_ONSITE" && recurring) {
    return {
      result: data.preferences.travel.recurringCustomerOnsiteResult,
      explanation: "Recurring customer on-site travel is a material mismatch.",
      evidenceReferences: travel.evidenceReferences,
    };
  }
  if (travel.purpose === "CUSTOMER_ONSITE") {
    return {
      result: data.preferences.travel.allowExceptionalCustomerVisits
        ? "REVIEW"
        : "FAIL",
      explanation:
        "Customer on-site travel is stated but appears exceptional or insufficiently frequent to classify as recurring.",
      evidenceReferences: travel.evidenceReferences,
    };
  }
  if (
    (travel.purpose === "COMPANY_EVENT" || travel.purpose === "CONFERENCE") &&
    data.preferences.travel.allowInfrequentCompanyEvents &&
    !recurring
  ) {
    return {
      result: "PASS",
      explanation: "Travel is limited to an infrequent company event or conference.",
      evidenceReferences: travel.evidenceReferences,
    };
  }
  return {
    result: "REVIEW",
    explanation: "The stated travel requires contextual review.",
    evidenceReferences: travel.evidenceReferences,
  };
}

export function createHardFiltersStage() {
  return defineEvaluationStage<CustomerSuccessDomainData, HardFiltersData>({
    id: "hard-filters",
    version: "cs-hard-filters-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-jd-reconstruction-v1",
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: hardFiltersDataSchema,
    async evaluate(context) {
      const reconstruction = await reconstructCustomerSuccessJob(context);
      context.domainData.reconstruction = reconstruction;
      const roleClassification = reconstruction.roleMetadata.actualRoleClassification;
      const role: HardFiltersData["role"] = {
        classification: roleClassification,
        result: roleClassification === "UNRELATED" ? "FAIL" : "PASS",
        explanation:
          roleClassification === "UNRELATED"
            ? "The reconstructed work is unrelated to Customer Success."
            : "The reconstructed role remains eligible for substantive evaluation.",
        evidenceReferences: reconstruction.roleMetadata.evidenceReferences,
      };
      const salary = salaryResult(context.domainData);
      const location = locationResult(context.domainData);
      const workArrangement = workArrangementResult(context.domainData);
      const travel = travelResult(context.domainData);
      const results = [role, salary, location, workArrangement, travel];
      const overall = results.some((item) => item.result === "FAIL")
        ? "FAIL"
        : results.some(
              (item) => item.result === "REVIEW" || item.result === "UNKNOWN",
            )
          ? "REVIEW"
          : "PASS";
      const data = hardFiltersDataSchema.parse({
        overall,
        role,
        salary,
        location,
        workArrangement,
        travel,
        reconstruction,
      });
      const unknowns = [
        salary.result === "UNKNOWN"
          ? {
              code: "salary-unknown",
              description: salary.explanation,
              materiality: "Requires compensation clarification.",
            }
          : null,
        location.result === "UNKNOWN"
          ? {
              code: "location-unknown",
              description: location.explanation,
              materiality: "Requires eligibility clarification.",
            }
          : null,
        travel.result === "UNKNOWN"
          ? {
              code: "travel-unknown",
              description: travel.explanation,
              materiality: null,
            }
          : null,
      ].filter((item) => item !== null);
      return {
        classification: overall,
        data,
        evidence: reconstruction.evidence,
        findings: results.map((item) => item.explanation),
        strengths: results
          .filter((item) => item.result === "PASS")
          .map((item) => item.explanation),
        concerns: results
          .filter((item) => item.result === "FAIL" || item.result === "REVIEW")
          .map((item) => item.explanation),
        unknowns,
        contradictions: reconstruction.contradictions,
        confidence: reconstruction.evidence.length > 0 ? "STRONG_EVIDENCE" : "UNKNOWN",
        completeness: unknowns.length > 0 ? "PARTIAL" : "COMPLETE",
      };
    },
  });
}
