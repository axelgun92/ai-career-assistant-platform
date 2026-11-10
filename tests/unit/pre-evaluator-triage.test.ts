import { describe, expect, it } from "vitest";
import { effectivePreEvaluatorTriageOutcome } from "@ai-career/core";
import { triageCustomerSuccessOpportunity } from "@ai-career/customer-success";
import { customerSuccessTestPreferences } from "../fixtures/customer-success";

type OpportunityInput = Parameters<typeof triageCustomerSuccessOpportunity>[0]["opportunity"];

const compatible: OpportunityInput = {
  salaryMin: 70_000,
  salaryMax: 85_000,
  currency: "USD",
  compensationBasis: "BASE" as const,
  residencyRequirement: "US_REQUIRED" as const,
  residencyRegions: ["US"],
  remoteStatus: "REMOTE",
  workArrangements: ["REMOTE" as const],
  location: "Remote - United States",
  workAuthorizationRequirement: null,
  workAuthorizationRegions: [],
  visaSponsorship: null,
  relocationSupport: null,
  employerOfRecordRegions: [],
};

const assess = (
  opportunity: Partial<OpportunityInput> = {},
  eligibility: { authorizedRegions: string[]; citizenshipRegions: string[] } | null = {
    authorizedRegions: ["US"],
    citizenshipRegions: ["US"],
  },
) => triageCustomerSuccessOpportunity({
  opportunity: { ...compatible, ...opportunity },
  preferences: customerSuccessTestPreferences,
  eligibility,
});

describe("pre-evaluator triage", () => {
  it("returns EVALUATE for clearly compatible structured evidence", () => {
    expect(assess()).toEqual({ outcome: "EVALUATE", reasons: [] });
  });

  it("returns REJECT only for a definite salary hard-constraint failure", () => {
    const result = assess({ salaryMin: 45_000, salaryMax: 50_000 });
    expect(result.outcome).toBe("REJECT");
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "salary-us-threshold", disposition: "REJECT" }),
    ]));
  });

  it("returns NEEDS_REVIEW for an important Unknown", () => {
    const result = assess({ salaryMin: null, salaryMax: null, currency: null });
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.reasons[0]).toMatchObject({
      code: "salary-unknown-salary",
      disposition: "NEEDS_REVIEW",
    });
  });

  it("returns NEEDS_REVIEW for conflicting structured evidence", () => {
    const result = assess({ salaryMin: 90_000, salaryMax: 70_000 });
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "salary-conflicting-salary" }),
    ]));
  });

  it("preserves multiple review reasons and the fields that caused them", () => {
    const result = assess({
      salaryMin: null,
      salaryMax: null,
      currency: null,
      residencyRequirement: null,
      residencyRegions: [],
      remoteStatus: null,
      workArrangements: [],
    });
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "salary-unknown-salary",
      "residency-unknown",
      "work-arrangement-unknown",
    ]));
    expect(result.reasons.every((reason) => reason.fields.length > 0)).toBe(true);
  });

  it("does not semantically infer prerequisites from free-text location", () => {
    const result = assess({
      salaryMin: null,
      salaryMax: null,
      currency: null,
      residencyRequirement: null,
      residencyRegions: [],
      remoteStatus: null,
      workArrangements: [],
      location: "Remote, United States",
    });
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.reasons.map((reason) => reason.code)).toContain("work-arrangement-unknown");
    expect(result.reasons.map((reason) => reason.code)).toContain("residency-unknown");
  });

  it("never converts Unknown into REJECT", () => {
    const result = assess({
      salaryMin: null,
      salaryMax: null,
      currency: null,
      residencyRequirement: null,
      residencyRegions: [],
      remoteStatus: null,
      workArrangements: [],
    }, null);
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.reasons.some((reason) => reason.disposition === "REJECT")).toBe(false);
  });

  it("rejects a definitely incompatible work arrangement", () => {
    const result = assess({ remoteStatus: "ONSITE", workArrangements: ["ONSITE"] });
    expect(result.outcome).toBe("REJECT");
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "work-arrangement-incompatible" }),
    ]));
  });

  it("holds an explicit unmatched work-authorization requirement for review instead of guessing", () => {
    const result = assess({
      workAuthorizationRequirement: "RIGHT_TO_WORK",
      workAuthorizationRegions: ["CA"],
    });
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "work-authorization-needs-review" }),
    ]));
  });
});

describe("manual triage decisions", () => {
  it("manual Evaluate overrides NEEDS_REVIEW without changing the automatic outcome", () => {
    expect(effectivePreEvaluatorTriageOutcome({
      outcome: "NEEDS_REVIEW",
      manualDecision: "EVALUATE",
    })).toBe("EVALUATE");
  });

  it("manual Reject overrides NEEDS_REVIEW", () => {
    expect(effectivePreEvaluatorTriageOutcome({
      outcome: "NEEDS_REVIEW",
      manualDecision: "REJECT",
    })).toBe("REJECT");
  });
});
