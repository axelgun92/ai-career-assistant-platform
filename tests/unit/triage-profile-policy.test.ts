// Alex's stated profile baseline (November 5, 2026) against the
// deterministic pre-evaluator triage, with a synthetic profile only: no
// database, no real profile, no provider call. Each case names the stated
// requirement it checks. The two salary differences first reported were
// corrected with Alex's approval (salary policy v4, D-P1 and D-P2); no other
// hard constraint is added or altered here.
import { describe, expect, it } from "vitest";
import { defineCustomerSuccessPreferences, triageCustomerSuccessOpportunity } from "@ai-career/customer-success";

// Remote only; U.S.-only roles allowed; no country is allowed-only or
// excluded (the Europe goal is not a rejection rule); lower-cost countries
// configured for the conditional salary band; a U.S. citizen.
const preferences = defineCustomerSuccessPreferences({
  salary: { currency: "USD", passMinimum: 60_000, reviewMinimum: 55_000, substantiallyLowerCostCountries: ["Mexico", "Colombia", "Philippines"] },
  location: { allowedCountries: [], disallowedCountries: [], allowUnitedStatesOnlyRoles: true },
  travel: { allowInfrequentCompanyEvents: true, allowExceptionalCustomerVisits: true, recurringCustomerOnsiteResult: "FAIL", fieldTravelResult: "FAIL" },
  workArrangement: { allowed: ["REMOTE"], unknownResult: "UNKNOWN" },
  roleFamilies: { continuingClassifications: ["CORE_CS", "CS_ADJACENT"] },
});
const usCitizen = { authorizedRegions: ["US"], citizenshipRegions: ["US"] };

type Opportunity = Parameters<typeof triageCustomerSuccessOpportunity>[0]["opportunity"];
const remoteUs: Opportunity = {
  salaryMin: 70_000,
  salaryMax: 85_000,
  currency: "USD",
  compensationBasis: "BASE",
  residencyRequirement: "US_REQUIRED",
  residencyRegions: ["US"],
  remoteStatus: "REMOTE",
  workArrangements: ["REMOTE"],
  location: "Remote - United States",
  workAuthorizationRequirement: null,
  workAuthorizationRegions: [],
  visaSponsorship: null,
  relocationSupport: null,
  employerOfRecordRegions: [],
};
const nonUs = (regions: string[], extra: Partial<Opportunity> = {}): Partial<Opportunity> => ({ residencyRequirement: "NON_US", residencyRegions: regions, ...extra });

const assess = (opportunity: Partial<Opportunity> = {}, eligibility: typeof usCitizen | null = usCitizen) =>
  triageCustomerSuccessOpportunity({ opportunity: { ...remoteUs, ...opportunity }, preferences, eligibility });
const codes = (opportunity: Partial<Opportunity> = {}, eligibility: typeof usCitizen | null = usCitizen) =>
  assess(opportunity, eligibility).reasons.map((reason) => `${reason.code}:${reason.disposition}`);

describe("compensation", () => {
  it("passes a stated base of $60k or more", () => {
    expect(assess()).toEqual({ outcome: "EVALUATE", reasons: [] });
    expect(assess({ salaryMin: 60_000, salaryMax: 60_000 }).outcome).toBe("EVALUATE");
  });

  it("holds an unknown salary for review, never rejects it", () => {
    expect(assess({ salaryMin: null, salaryMax: null, currency: null }).outcome).toBe("NEEDS_REVIEW");
    expect(codes({ salaryMin: null, salaryMax: null, currency: null })).toEqual(["salary-unknown-salary:NEEDS_REVIEW"]);
  });

  it("never treats OTE as base salary", () => {
    expect(codes({ compensationBasis: "OTE", salaryMin: 90_000, salaryMax: 120_000 })).toEqual(["salary-ote-not-confirmed-base:NEEDS_REVIEW"]);
  });

  it("rejects a U.S.-residence job with a base below $55k", () => {
    expect(assess({ salaryMin: 50_000, salaryMax: 54_000 }).outcome).toBe("REJECT");
  });

  it("reviews a non-U.S. job paying $55k-$59.9k", () => {
    expect(codes(nonUs(["DE"], { salaryMin: 57_000, salaryMax: 59_000 }))).toContain("salary-non-us-review:NEEDS_REVIEW");
    expect(assess(nonUs(["DE"], { salaryMin: 57_000, salaryMax: 59_000 })).outcome).toBe("NEEDS_REVIEW");
  });

  it("may consider a non-U.S. job paying $50k-$54.9k in a configured lower-cost country, and reviews it elsewhere", () => {
    expect(codes(nonUs(["MX"], { salaryMin: 52_000, salaryMax: 54_000 }))).toContain("salary-non-us-conditional-review:NEEDS_REVIEW");
    expect(codes(nonUs(["DE"], { salaryMin: 52_000, salaryMax: 54_000 }))).toContain("salary-non-us-conditional-unknown:NEEDS_REVIEW");
  });

  it("reviews a salary below $55k when the residency is unclear", () => {
    const result = assess({ residencyRequirement: null, residencyRegions: [], salaryMin: 50_000, salaryMax: 54_000 });
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.reasons.map((reason) => reason.code)).toEqual(["salary-unknown-residency", "residency-unknown"]);
  });

  describe("approved corrections (D-P1, D-P2; salary policy v4)", () => {
    it("reviews a U.S.-residence job whose minimum is $55k-$59.9k, including a range reaching $60k+", () => {
      expect(codes({ salaryMin: 57_000, salaryMax: 59_000 })).toEqual(["salary-us-review:NEEDS_REVIEW"]);
      expect(codes({ salaryMin: 57_000, salaryMax: 70_000 })).toEqual(["salary-us-review:NEEDS_REVIEW"]);
      expect(codes({ salaryMin: 55_000, salaryMax: 55_000 })).toEqual(["salary-us-review:NEEDS_REVIEW"]);
      expect(codes({ salaryMin: 54_999, salaryMax: 70_000 })).toEqual(["salary-us-threshold:REJECT"]);
    });

    it("reviews a non-U.S. base below $50k in a configured lower-cost country, and still rejects it elsewhere", () => {
      expect(codes(nonUs(["MX"], { salaryMin: 45_000, salaryMax: 48_000 }))).toContain("salary-non-us-lower-cost-review:NEEDS_REVIEW");
      expect(assess(nonUs(["MX"], { salaryMin: 45_000, salaryMax: 48_000 })).outcome).toBe("NEEDS_REVIEW");
      expect(codes(nonUs(["DE"], { salaryMin: 45_000, salaryMax: 48_000 }))).toContain("salary-below-non-us-minimum:REJECT");
      expect(assess(nonUs(["DE"], { salaryMin: 45_000, salaryMax: 48_000 })).outcome).toBe("REJECT");
    });

    it("keeps the salary basis rules: OTE and unknown salary are still reviewed, never passed", () => {
      expect(codes({ compensationBasis: "OTE", salaryMin: 57_000, salaryMax: 70_000 })).toEqual(["salary-ote-not-confirmed-base:NEEDS_REVIEW"]);
      expect(codes(nonUs(["MX"], { compensationBasis: "OTE", salaryMin: 45_000, salaryMax: 48_000 }))).toContain("salary-ote-not-confirmed-base:NEEDS_REVIEW");
    });
  });
});

describe("work arrangement", () => {
  it("requires fully remote: hybrid-only and on-site-only jobs are rejected", () => {
    expect(codes({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"] })).toEqual(["work-arrangement-incompatible:REJECT"]);
    expect(codes({ remoteStatus: "ONSITE", workArrangements: ["ONSITE"] })).toEqual(["work-arrangement-incompatible:REJECT"]);
  });

  it("accepts a job offering remote among its arrangements", () => {
    expect(assess({ remoteStatus: null, workArrangements: ["REMOTE", "HYBRID"] }).outcome).toBe("EVALUATE");
  });

  it("holds an unknown arrangement for review", () => {
    expect(codes({ remoteStatus: null, workArrangements: [] })).toEqual(["work-arrangement-unknown:NEEDS_REVIEW"]);
  });
});

describe("geographic eligibility", () => {
  it("does not reject U.S.-only roles", () => {
    expect(assess().outcome).toBe("EVALUATE");
  });

  it("holds unresolved eligibility for review", () => {
    expect(codes({ residencyRequirement: null, residencyRegions: [] })).toEqual(["salary-unknown-residency:NEEDS_REVIEW", "residency-unknown:NEEDS_REVIEW"]);
    expect(codes({ residencyRequirement: "NON_US", residencyRegions: [] })).toContain("residency-conflicting-or-incomplete:NEEDS_REVIEW");
  });

  it("never rejects a European role for its location (a goal, not a rule); without an established right to work there it is held for review", () => {
    for (const country of ["IE", "DE", "NL", "GB"]) {
      const result = assess(nonUs([country], { currency: "EUR", salaryMin: 60_000, salaryMax: 70_000 }));
      expect(result.outcome, country).toBe("NEEDS_REVIEW");
      expect(result.reasons.every((reason) => reason.disposition === "NEEDS_REVIEW"), country).toBe(true);
      expect(result.reasons.map((reason) => reason.code), country).toEqual(["work-authorization-unresolved"]);
    }
  });

  it("holds a worldwide role for review rather than rejecting it", () => {
    expect(assess(nonUs(["WORLDWIDE"])).outcome).toBe("NEEDS_REVIEW");
  });
});

describe("work authorization", () => {
  it("treats a U.S. citizen as authorized for a job requiring U.S. work authorization (W-2 is not a disqualifier)", () => {
    expect(assess({ workAuthorizationRequirement: "REQUIRED", workAuthorizationRegions: ["US"] })).toEqual({ outcome: "EVALUATE", reasons: [] });
  });

  it("holds an explicit non-U.S. authorization requirement for review, never rejects it", () => {
    expect(codes(nonUs(["IE"], { currency: "EUR", salaryMin: 60_000, salaryMax: 70_000, workAuthorizationRequirement: "REQUIRED", workAuthorizationRegions: ["IE"] }))).toEqual([
      "work-authorization-needs-review:NEEDS_REVIEW",
    ]);
  });

  it("holds an explicit requirement for review when the eligibility is not configured", () => {
    expect(codes({ workAuthorizationRequirement: "REQUIRED", workAuthorizationRegions: ["US"] }, null)).toEqual(["work-eligibility-not-configured:NEEDS_REVIEW"]);
  });
});

describe("constraints with no deterministic triage rule (reported, not added)", () => {
  // Role relevance, required working hours and mandatory travel are not
  // structured facts the triage reads: the evaluator judges role fit and
  // travel (its hard filters) after admission, and nothing checks working
  // hours. A job is therefore never held or rejected here for them.
  it("does not hold or reject a job for its role, hours or travel", () => {
    const result = assess();
    expect(result).toEqual({ outcome: "EVALUATE", reasons: [] });
    const fields = new Set(["salaryMin", "salaryMax", "currency", "compensationBasis", "residencyRequirement", "residencyRegions", "remoteStatus", "workArrangements", "workAuthorizationRequirement", "workAuthorizationRegions", "visaSponsorship", "relocationSupport", "employerOfRecordRegions"]);
    const everyReasonField = [
      assess({ salaryMin: null, salaryMax: null, currency: null, residencyRequirement: null, residencyRegions: [], remoteStatus: null, workArrangements: [], workAuthorizationRequirement: "REQUIRED", workAuthorizationRegions: ["IE"] }),
    ].flatMap((assessment) => assessment.reasons.flatMap((reason) => reason.fields));
    expect(everyReasonField.every((field) => fields.has(field))).toBe(true);
  });
});

describe("combined outcome", () => {
  it("rejects when any constraint is definitely failed, otherwise reviews any open question", () => {
    // A definite failure wins over open questions.
    expect(assess({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"], salaryMin: null, salaryMax: null, currency: null }).outcome).toBe("REJECT");
    // Several open questions: one review with every reason kept.
    const held = assess({ salaryMin: null, salaryMax: null, currency: null, remoteStatus: null, workArrangements: [] });
    expect(held.outcome).toBe("NEEDS_REVIEW");
    expect(held.reasons.map((reason) => reason.code)).toEqual(["salary-unknown-salary", "work-arrangement-unknown"]);
  });
});
