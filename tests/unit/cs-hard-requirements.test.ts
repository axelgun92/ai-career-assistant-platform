// Customer Success hard requirements in pre-evaluator triage (November 25,
// 2026): seniority, work arrangement, full-time employment and compensation
// tiers, read from the normalized facts and the listing's explicit
// evidence. Synthetic opportunities and preferences only.
import { describe, expect, it } from "vitest";
import {
  applicableCompensationTiers,
  clearlyDisallowedCustomerSuccessTitle,
  defineCustomerSuccessPreferences,
  triageCustomerSuccessOpportunity,
} from "@ai-career/customer-success";
import { readPositionEvidence, standardizeEmploymentType } from "@ai-career/normalization";
import { createAcquisitionTitlePolicyLoader } from "../../apps/web/src/server/title-policy-service";

const preferences = defineCustomerSuccessPreferences({
  salary: { currency: "USD", passMinimum: 60_000, reviewMinimum: 55_000, substantiallyLowerCostCountries: ["Mexico", "Colombia", "Philippines"] },
  location: { allowedCountries: [], disallowedCountries: [], allowUnitedStatesOnlyRoles: true },
  travel: { allowInfrequentCompanyEvents: true, allowExceptionalCustomerVisits: true, recurringCustomerOnsiteResult: "FAIL", fieldTravelResult: "FAIL" },
  workArrangement: { allowed: ["REMOTE", "HYBRID"], unknownResult: "UNKNOWN" },
  roleFamilies: { continuingClassifications: ["CORE_CS", "CS_ADJACENT"] },
});
type Opportunity = Parameters<typeof triageCustomerSuccessOpportunity>[0]["opportunity"];
const base: Opportunity = {
  title: "Customer Success Manager",
  seniority: null,
  seniorityLabel: null,
  employmentType: "FULL_TIME",
  evidence: { peopleManagement: null, fullTimeSchedule: null },
  salaryMin: 70_000,
  salaryMax: 85_000,
  currency: "USD",
  compensationBasis: "BASE",
  compensationTiers: [],
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
const triage = (opportunity: Partial<Opportunity>) =>
  triageCustomerSuccessOpportunity({ opportunity: { ...base, ...opportunity }, preferences, eligibility: { authorizedRegions: ["US"], citizenshipRegions: ["US"] } });
const codes = (opportunity: Partial<Opportunity>) => triage(opportunity).reasons.map((reason) => `${reason.code}:${reason.disposition}`);

describe("seniority", () => {
  it.each(["Senior Customer Success Manager", "Sr. Customer Success Manager", "Customer Success Lead", "Lead Onboarding Specialist", "Principal Customer Success Manager",
    "Director, Customer Success", "Head of Customer Success", "VP Customer Success", "Vice President, Customer Experience", "Chief Customer Officer"])(
    "rejects %s", (title) => {
      expect(triage({ title }).outcome).toBe("REJECT");
      expect(codes({ title })).toContain("seniority-above-mid-level:REJECT");
    });

  it.each(["Customer Success Manager", "Associate Customer Success Manager", "Junior Customer Success Manager", "Entry-Level Onboarding Specialist", "Mid-Level Customer Success Manager", "Customer Success Manager II"])(
    "allows %s", (title) => {
      expect(triage({ title }).outcome).toBe("EVALUATE");
    });

  it("rejects a normalized level above mid-level, and allows entry and mid", () => {
    for (const seniority of ["SENIOR", "LEAD", "PRINCIPAL", "DIRECTOR", "EXECUTIVE"]) expect(triage({ seniority }).outcome).toBe("REJECT");
    for (const seniority of ["ENTRY", "MID"]) expect(triage({ seniority }).outcome).toBe("EVALUATE");
  });

  it("judges a manager-of title by its people-management evidence, never by the word Manager", () => {
    const title = "Manager, Customer Success";
    expect(codes({ title })).toEqual(["seniority-manager-title-ambiguous:NEEDS_REVIEW"]);
    expect(triage({ title, seniority: "MID" }).outcome).toBe("EVALUATE");
    const evidence = readPositionEvidence({ title, description: "You will manage a team of 6 Customer Success Managers and run their performance reviews." });
    expect(evidence.peopleManagement?.sourceText).toContain("manage a team of 6");
    expect(codes({ title, evidence })).toEqual(["seniority-people-manager:REJECT"]);
    // The individual-contributor title is never judged by such evidence.
    expect(triage({ title: "Customer Success Manager", evidence }).outcome).toBe("EVALUATE");
  });

  it("never reads years of experience as seniority", () => {
    const evidence = readPositionEvidence({ title: "Customer Success Manager", description: "You bring 8+ years of customer success experience." });
    expect(evidence.peopleManagement).toBeNull();
    expect(triage({ evidence }).outcome).toBe("EVALUATE");
  });

  it("reviews an Executive title whose level is not stated", () => {
    expect(codes({ title: "Customer Success Executive" })).toEqual(["seniority-executive-title-ambiguous:NEEDS_REVIEW"]);
    expect(triage({ title: "Customer Success Executive", seniority: "ENTRY" }).outcome).toBe("EVALUATE");
  });
});

describe("work arrangement", () => {
  it("passes Remote and Hybrid, and options that include either", () => {
    expect(triage({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"] }).outcome).toBe("EVALUATE");
    expect(triage({ remoteStatus: null, workArrangements: ["ONSITE", "HYBRID"] }).outcome).toBe("EVALUATE");
    expect(triage({ remoteStatus: null, workArrangements: ["ONSITE", "REMOTE"] }).outcome).toBe("EVALUATE");
  });

  it("rejects on-site only wherever the job is, and a remote option offered only by exception", () => {
    expect(codes({ remoteStatus: "ONSITE", workArrangements: ["ONSITE"] })).toEqual(["work-arrangement-onsite-only:REJECT"]);
    expect(codes({ remoteStatus: "ONSITE", workArrangements: ["ONSITE"], residencyRequirement: "NON_US", residencyRegions: ["DE"], currency: "EUR", salaryMin: 70_000, salaryMax: 80_000 }))
      .toContain("work-arrangement-onsite-only:REJECT");
    expect(codes({ remoteStatus: null, workArrangements: ["ONSITE", "REMOTE"], remoteByException: true })).toEqual(["work-arrangement-onsite-only:REJECT"]);
    // Hybrid offered with remote by exception is still hybrid.
    expect(triage({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"], remoteByException: true }).outcome).toBe("EVALUATE");
  });

  it("reviews unknown or conflicting evidence", () => {
    expect(codes({ remoteStatus: null, workArrangements: [] })).toEqual(["work-arrangement-unknown:NEEDS_REVIEW"]);
    expect(codes({ remoteStatus: "ONSITE", workArrangements: ["REMOTE"] })).toEqual(["work-arrangement-conflicting:NEEDS_REVIEW"]);
  });
});

describe("employment type (Customer Success only)", () => {
  it("passes full-time and rejects part-time, internship, stage, alternance and apprenticeship", () => {
    expect(triage({ employmentType: "FULL_TIME" }).outcome).toBe("EVALUATE");
    for (const employmentType of ["PART_TIME", "INTERNSHIP", "APPRENTICESHIP"]) {
      expect(codes({ employmentType })).toEqual(["employment-type-not-full-time:REJECT"]);
    }
    for (const title of ["Customer Success Intern", "Stage - Customer Success Manager", "Alternance Customer Success Manager", "Customer Success Apprentice", "Part-time Customer Success Manager"]) {
      expect(triage({ title }).outcome, title).toBe("REJECT");
    }
    expect(standardizeEmploymentType("Stage")).toBe("INTERNSHIP");
    expect(standardizeEmploymentType("Alternance")).toBe("APPRENTICESHIP");
    expect(standardizeEmploymentType("Apprenticeship")).toBe("APPRENTICESHIP");
  });

  it("passes a contract or an unset type with a stated full-time schedule and reviews other contracts and unknown types", () => {
    const fullTime = readPositionEvidence({ title: "Customer Success Manager", description: "This is a full-time contract role for 12 months." });
    expect(triage({ employmentType: "CONTRACT", evidence: fullTime }).outcome).toBe("EVALUATE");
    expect(codes({ employmentType: "CONTRACT" })).toEqual(["employment-type-contract-schedule-unknown:NEEDS_REVIEW"]);
    expect(codes({ employmentType: "TEMPORARY" })).toEqual(["employment-type-contract-schedule-unknown:NEEDS_REVIEW"]);
    const mixed = readPositionEvidence({ title: null, description: "Full-time or part-time schedules available." });
    expect(mixed.fullTimeSchedule).toBeNull();
    expect(codes({ employmentType: null })).toEqual(["employment-type-unknown:NEEDS_REVIEW"]);
    // No normalized type, but the description explicitly states full-time:
    // full-time. A full-time-or-part-time statement is no such evidence.
    const stated = readPositionEvidence({ title: null, description: "Full-time. Remote. Applicants must reside in the United States." });
    expect(triage({ employmentType: null, evidence: stated }).outcome).toBe("EVALUATE");
    expect(codes({ employmentType: null, evidence: mixed })).toEqual(["employment-type-unknown:NEEDS_REVIEW"]);
    expect(codes({ employmentType: null, evidence: readPositionEvidence({ title: null, description: "This is not a full-time role." }) })).toEqual(["employment-type-unknown:NEEDS_REVIEW"]);
  });
});

describe("compensation tiers", () => {
  const tiers = (...ranges: Array<[string, number, number]>) => ranges.map(([label, minimum, maximum]) => ({ label, minimum, maximum, currency: "USD" }));
  const noRange = { salaryMin: null, salaryMax: null };

  it("uses tiers as salary evidence instead of reporting salary missing", () => {
    expect(triage({ ...noRange, compensationTiers: tiers(["Zone A", 90_000, 110_000], ["Zone B", 80_000, 95_000]) }).outcome).toBe("EVALUATE");
    expect(codes({ ...noRange, compensationTiers: tiers(["Zone A", 90_000, 110_000]) })).not.toContain("salary-unknown-salary:NEEDS_REVIEW");
  });

  it("rejects when every potentially applicable tier fails", () => {
    expect(codes({ ...noRange, compensationTiers: tiers(["Zone A", 40_000, 48_000], ["Zone B", 38_000, 45_000]) })).toEqual(["salary-tiers-below-minimum:REJECT"]);
  });

  it("reviews tiers that disagree when the applicable one is not established", () => {
    expect(codes({ ...noRange, compensationTiers: tiers(["Zone A", 90_000, 110_000], ["Zone B", 40_000, 48_000]) })).toEqual(["salary-tiers-differ:NEEDS_REVIEW"]);
  });

  it("judges only the tier the job's location establishes", () => {
    const mixed = tiers(["New York", 90_000, 110_000], ["Denver", 40_000, 48_000]);
    expect(applicableCompensationTiers(mixed, { location: "Denver, CO (Hybrid)", residencyRegions: ["US"] })).toEqual({ tiers: [mixed[1]], established: true });
    expect(codes({ ...noRange, compensationTiers: mixed, location: "Denver, CO (Hybrid)", remoteStatus: "HYBRID", workArrangements: ["HYBRID"] })).toEqual(["salary-tiers-below-minimum:REJECT"]);
    expect(triage({ ...noRange, compensationTiers: mixed, location: "New York, NY (Hybrid)", remoteStatus: "HYBRID", workArrangements: ["HYBRID"] }).outcome).toBe("EVALUATE");
  });

  it("keeps OTE, unknown currency and unknown geography for review", () => {
    expect(triage({ ...noRange, compensationTiers: tiers(["Zone A", 90_000, 110_000]), compensationBasis: "OTE" }).outcome).toBe("NEEDS_REVIEW");
    expect(triage({ ...noRange, compensationTiers: [{ label: "Zone A", minimum: 90_000, maximum: 110_000, currency: null }], currency: null }).outcome).toBe("NEEDS_REVIEW");
    expect(triage({ ...noRange, compensationTiers: tiers(["Zone A", 90_000, 110_000]), residencyRequirement: null, residencyRegions: [] }).outcome).toBe("NEEDS_REVIEW");
  });
});

describe("automatic discovery", () => {
  it("skips titles a Customer Success hard requirement clearly rules out, before any page is read", async () => {
    expect(clearlyDisallowedCustomerSuccessTitle("Senior Customer Success Manager")).toBe("Senior level");
    expect(clearlyDisallowedCustomerSuccessTitle("Customer Success Intern")).toBe("internship");
    expect(clearlyDisallowedCustomerSuccessTitle("Customer Success Manager")).toBeNull();
    expect(clearlyDisallowedCustomerSuccessTitle("Manager, Customer Success")).toBeNull();
    const policy = await createAcquisitionTitlePolicyLoader({ get: async () => null })();
    expect(policy("Senior Customer Success Manager")).toEqual({ verdict: "EXCLUDED", pattern: "Senior level" });
    expect(policy("Customer Success Manager").verdict).toBe("ACCEPTED");
    expect(policy("Payroll Support Representative").verdict).toBe("OUTSIDE");
  });
});

// Role fit stays with the evaluator (November 25, 2026): enterprise-heavy,
// support-heavy, sales-heavy and implementation-heavy roles are scored by
// the evaluator's fit judgments, and onboarding and customer-facing
// implementation are valid bridge roles, so triage never filters them by
// title. (The evaluator's own deterministic rules are covered in
// customer-success.test.ts: those classifications continue into Job
// Evaluation; only UNRELATED work fails the role hard filter.)
describe("role fit is never a triage title filter", () => {
  it.each([
    "Enterprise Customer Success Manager",
    "Customer Support & Success Manager",
    "Customer Success Manager (Renewals and Expansion)",
    "Implementation Specialist",
    "Implementation Manager",
    "Customer Onboarding Specialist",
    "Customer Education Specialist",
    "Technical Customer Success Manager",
  ])("passes %s on to evaluation", (title) => {
    expect(triage({ title }).outcome).toBe("EVALUATE");
  });
});
