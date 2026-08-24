import {
  createCustomerSuccessProfileContext,
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
    const boundary = experience.find(
      (item) => item.id === "experience-scope-boundary",
    );

    expect(tutor?.statement).toContain("55% long-term retention rate");
    expect(tutor?.statement).toContain("4.8/5");
    expect(tutor?.statement).not.toContain("5/5 satisfaction rating");
    expect(tutor?.statement).toContain("not literal SaaS accounts");
    expect(boundary?.statement).toContain(
      "No source verifies direct SaaS Customer Success Manager employment",
    );
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
