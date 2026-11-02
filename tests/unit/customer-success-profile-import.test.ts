import {
  createCustomerSuccessProfileContext,
  customerSuccessProfileLimitationsByEvidenceReference,
  loadCustomerSuccessPreferencesFromProfile,
  validateCustomerSuccessUserProfileData,
} from "@ai-career/customer-success";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { alexandraNugentCustomerSuccessProfile } from "../../apps/web/src/server/profile-import/alexandra-nugent-customer-success-profile";

describe("Alexandra Nugent Customer Success profile import data", () => {
  it("passes the existing profile and domain-preference validators", () => {
    const data = validateCustomerSuccessUserProfileData(
      alexandraNugentCustomerSuccessProfile,
    );
    const context = createCustomerSuccessProfileContext({
      id: randomUUID(),
      version: 1,
      data,
    });
    const preferences = loadCustomerSuccessPreferencesFromProfile(
      data.domainPreferences,
    );

    expect(context.version).toBe(1);
    expect(context.evidence.length).toBeGreaterThan(0);
    expect(preferences.salary.passMinimum).toBe(60_000);
    expect(preferences.salary.reviewMinimum).toBe(55_000);
    expect(preferences.workArrangement.allowed).toEqual(["REMOTE"]);
  });

  it("uses the corrected tutor metrics and preserves role boundaries", () => {
    const data = validateCustomerSuccessUserProfileData(
      alexandraNugentCustomerSuccessProfile,
    );
    const experience = data.experience ?? [];
    const tutor = experience.find(
      (item) => item.id === "experience-independent-esl-tutor",
    );
    const boundary = (data.limitations ?? []).find(
      (item) => item.id === "limitation-saas-customer-success-scope",
    );

    expect(tutor?.statement).toContain("55% long-term retention rate");
    expect(tutor?.statement).toContain("4.8/5");
    expect(tutor?.statement).not.toContain("5/5 satisfaction rating");
    expect(tutor?.statement).toContain("not literal SaaS accounts");
    expect(boundary?.statement).toContain(
      "No source verifies direct SaaS Customer Success Manager employment",
    );
    // Classification guidance is not profile data; structure carries it.
    expect(boundary?.statement).toContain("HubSpot Service Hub and Pendo evidence is certification-based.");
    expect(boundary?.statement).not.toMatch(/must remain|genuine gaps/i);
    // The scope boundary is a structured limitation, not an experience record.
    expect(boundary).toMatchObject({
      category: "EXPERIENCE",
      disclaimedExperienceSpecificity: "DIRECT_SAAS_CUSTOMER_SUCCESS",
    });
    expect(experience.some((item) => item.id === "experience-scope-boundary")).toBe(false);
    expect(experience.some((item) => item.relationship === "DIRECT")).toBe(
      false,
    );
  });

  it("contains one evidence-rich record for every verified role", () => {
    const roleIds = new Set(
      (alexandraNugentCustomerSuccessProfile.experience ?? []).map(
        (item) => item.id,
      ),
    );

    expect(roleIds.has("experience-nalcap-training-specialist")).toBe(true);
    expect(roleIds.has("experience-barnes-noble-customer-engagement")).toBe(
      true,
    );
    expect(roleIds.has("experience-independent-esl-tutor")).toBe(true);
    expect(roleIds.has("experience-social-science-instructor")).toBe(true);
  });
});

describe("structured profile limitations", () => {
  const { limitations: _limitations, ...withoutLimitations } = alexandraNugentCustomerSuccessProfile;

  it("keeps stored profiles without limitations valid", () => {
    expect(() => validateCustomerSuccessUserProfileData(withoutLimitations)).not.toThrow();
    const context = createCustomerSuccessProfileContext({ id: randomUUID(), version: 1, data: withoutLimitations });
    expect(context.evidence.some((item) => item.evidenceType === "PROFILE_LIMITATION")).toBe(false);
    expect(customerSuccessProfileLimitationsByEvidenceReference(context).size).toBe(0);
  });

  it("requires an experience level exactly on EXPERIENCE limitations", () => {
    const withLimitation = (limitation: Record<string, unknown>) => () =>
      validateCustomerSuccessUserProfileData({
        ...withoutLimitations,
        limitations: [{ id: "limitation", statement: "I do not have this.", ...limitation }],
      });
    expect(withLimitation({ category: "EXPERIENCE", disclaimedExperienceSpecificity: "DIRECT_CUSTOMER_SUCCESS" })).not.toThrow();
    expect(withLimitation({ category: "EXPERIENCE", disclaimedExperienceSpecificity: null })).toThrow();
    expect(withLimitation({ category: "TOOL", disclaimedExperienceSpecificity: null })).not.toThrow();
    expect(withLimitation({ category: "TOOL", disclaimedExperienceSpecificity: "ANY_WORK_EXPERIENCE" })).toThrow();
    expect(withLimitation({ category: "PREFERENCE", disclaimedExperienceSpecificity: null })).toThrow();
  });

  it("carries each limitation as profile evidence keyed to its structured semantics", () => {
    const context = createCustomerSuccessProfileContext({
      id: randomUUID(),
      version: 1,
      data: alexandraNugentCustomerSuccessProfile,
    });
    const limitationEvidence = context.evidence.filter((item) => item.evidenceType === "PROFILE_LIMITATION");
    expect(limitationEvidence.map((item) => item.referenceId)).toEqual(["cs-profile-limitations-0"]);
    expect(customerSuccessProfileLimitationsByEvidenceReference(context).get("cs-profile-limitations-0"))
      .toMatchObject({ category: "EXPERIENCE", disclaimedExperienceSpecificity: "DIRECT_SAAS_CUSTOMER_SUCCESS" });
    // Preferences remain preferences, never limitations.
    expect(context.evidence.filter((item) => item.evidenceType === "WORK_PREFERENCE").length).toBeGreaterThan(0);
  });
});
