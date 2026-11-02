import {
  defineEvaluationStage,
  type CoreEvaluationContext,
} from "@ai-career/evaluation";
import type { CustomerSuccessDomainData } from "../evaluator";
import {
  evaluateSalaryPolicy,
} from "../config/salary-policy";
import { reconstructCustomerSuccessJob } from "../extraction/extractor";
import {
  hardFiltersDataSchema,
  type HardFiltersData,
} from "../schemas/results";

type Criterion = HardFiltersData["salary"];

function salaryResult(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
): Criterion {
  const data = context.domainData;
  const salary = data.reconstruction!.salary;
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
  const residencyEvidence = data.reconstruction!.evidence
    .filter((item) => item.criterionId === "residency")
    .map((item) => item.referenceId);
  const decision = evaluateSalaryPolicy({
    minimum: salary.minimum,
    maximum: salary.maximum,
    currency: salary.currency,
    compensationBasis: context.opportunity.compensationBasis,
    residencyRequirement: context.opportunity.residencyRequirement,
    residencyRegions: context.opportunity.residencyRegions,
    substantiallyLowerCostCountries:
      data.preferences.salary.substantiallyLowerCostCountries,
  });
  const converted = [decision.minimumUsd, decision.maximumUsd]
    .filter((amount): amount is number => amount !== null)
    .map((amount) => `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`)
    .join("–");
  const explanations: Record<typeof decision.reason, string> = {
    UNKNOWN_SALARY: "Annual salary is not normalized and remains Unknown.",
    UNKNOWN_CURRENCY:
      "Salary currency is Unknown or unsupported, so no raw amount was compared with USD thresholds.",
    UNKNOWN_RESIDENCY:
      "Residency eligibility is Unknown, so the U.S. or non-U.S. salary policy cannot be selected.",
    OTE_NOT_CONFIRMED_BASE:
      "The disclosed range is explicitly OTE, not confirmed base salary, so base-salary eligibility remains Unknown.",
    CONFLICTING_SALARY:
      "The normalized salary bounds conflict, so salary eligibility remains Unknown.",
    CONFLICTING_RESIDENCY:
      "The normalized residency requirement and eligible regions conflict, so salary-policy selection remains Unknown.",
    US_THRESHOLD:
      decision.result === "PASS"
        ? `The USD-equivalent salary (${converted}) meets the $60,000 U.S.-residency threshold.`
        : `The USD-equivalent salary (${converted}) is below the $60,000 U.S.-residency threshold.`,
    NON_US_PASS: `The USD-equivalent salary (${converted}) meets the $60,000 non-U.S. pass threshold.`,
    NON_US_REVIEW: `The USD-equivalent salary (${converted}) is in the $55,000–$59,999 non-U.S. review band.`,
    NON_US_CONDITIONAL_REVIEW: `The USD-equivalent salary (${converted}) is in the conditional $50,000–$54,999 non-U.S. band and the eligible geography matches a configured viable location.`,
    NON_US_CONDITIONAL_UNKNOWN: `The USD-equivalent salary (${converted}) is in the conditional $50,000–$54,999 non-U.S. band, but location-cost viability is not established and remains Unknown.`,
    BELOW_NON_US_MINIMUM: `The USD-equivalent salary (${converted}) is below the $50,000 non-U.S. minimum.`,
    OPEN_MAXIMUM_UNKNOWN: `Only a maximum USD-equivalent salary (${converted}) is known, so threshold eligibility remains Unknown.`,
  };
  return {
    result: decision.result,
    explanation: `${explanations[decision.reason]} Policy ${decision.policyVersion}.`,
    evidenceReferences: [
      ...new Set([...salary.evidenceReferences, ...residencyEvidence]),
    ],
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
    version: "cs-hard-filters-v3",
    ruleVersion: "cs-rules-v1.2",
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
      const salary = salaryResult(context);
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
