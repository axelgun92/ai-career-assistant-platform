// Confirmed facts (November 25, 2026): validation per field, the overlay on
// the captured facts (a confirmed value always wins; an unconfirmed field
// keeps its captured value), and the fields a review reason asks for.
import { describe, expect, it } from "vitest";
import { applyConfirmedFacts, capturedFactValue, confirmedFactInputSchema, type ConfirmableFacts } from "@ai-career/core";
import { suggestedConfirmableFields } from "../../apps/web/src/components/confirmed-facts/suggested-fields";
import { confirmedFactView } from "../../apps/web/src/server/confirmed-fact-service";

const captured: ConfirmableFacts = {
  salaryMin: null, salaryMax: null, currency: null, compensationBasis: null,
  compensationTiers: [{ label: "New York", minimum: 90_000, maximum: 110_000, currency: "USD" }, { label: "Denver", minimum: 70_000, maximum: 85_000, currency: "USD" }],
  residencyRequirement: null, residencyRegions: [], remoteStatus: null, workArrangements: [], employmentType: null,
  workAuthorizationRequirement: null, workAuthorizationRegions: [], visaSponsorship: null, seniority: null,
};

describe("confirmed facts", () => {
  it("validates each field's structured value", () => {
    expect(confirmedFactInputSchema.safeParse({ fieldName: "salaryRange", value: { minimum: 70_000, maximum: 85_000 } }).success).toBe(true);
    expect(confirmedFactInputSchema.safeParse({ fieldName: "salaryRange", value: { minimum: null, maximum: null } }).success).toBe(false);
    expect(confirmedFactInputSchema.safeParse({ fieldName: "currency", value: "XYZ" }).success).toBe(false);
    expect(confirmedFactInputSchema.safeParse({ fieldName: "workArrangements", value: [] }).success).toBe(false);
    expect(confirmedFactInputSchema.safeParse({ fieldName: "residency", value: { requirement: "NON_US", regions: [] } }).success).toBe(false);
    expect(confirmedFactInputSchema.safeParse({ fieldName: "employmentType", value: { type: "CONTRACT", fullTimeSchedule: true } }).success).toBe(true);
    expect(confirmedFactInputSchema.safeParse({ fieldName: "secret", value: 1 }).success).toBe(false);
  });

  it("overlays confirmed values and keeps every other captured value", () => {
    const shown = applyConfirmedFacts({ ...captured, fullTimeScheduleConfirmed: false }, [
      { fieldName: "applicableTier", value: { label: "Denver" } },
      { fieldName: "workArrangements", value: ["HYBRID"] },
      { fieldName: "employmentType", value: { type: "CONTRACT", fullTimeSchedule: true } },
      { fieldName: "residency", value: { requirement: "US_REQUIRED", regions: [] } },
      { fieldName: "seniority", value: "MID" },
    ]);
    expect(shown).toMatchObject({
      salaryMin: 70_000, salaryMax: 85_000, currency: "USD", compensationTiers: [],
      workArrangements: ["HYBRID"], remoteStatus: "HYBRID",
      employmentType: "CONTRACT", fullTimeScheduleConfirmed: true,
      residencyRequirement: "US_REQUIRED", residencyRegions: ["US"],
      seniority: "MID",
      // Unconfirmed: as captured.
      compensationBasis: null, visaSponsorship: null,
    });
    // An invalid stored value is ignored, never applied.
    expect(applyConfirmedFacts(captured, [{ fieldName: "currency", value: "nope" }]).currency).toBeNull();
  });

  it("shows a later capture that disagrees as a conflict, never silently", () => {
    const fact = { id: "f", opportunityId: "o", fieldName: "salaryRange" as const, value: { minimum: 70_000, maximum: 85_000 }, capturedValue: null, quotation: null, note: null, confirmedAt: new Date("2026-11-25T10:00:00Z") };
    expect(confirmedFactView(fact, captured).conflict).toBeNull();
    const recaptured = { ...captured, salaryMin: 40_000, salaryMax: 45_000 };
    expect(capturedFactValue("salaryRange", recaptured)).toEqual({ minimum: 40_000, maximum: 45_000 });
    expect(confirmedFactView(fact, recaptured).conflict).toEqual({ capturedNow: { minimum: 40_000, maximum: 45_000 } });
    // A capture that now agrees is no conflict.
    expect(confirmedFactView(fact, { ...captured, salaryMin: 70_000, salaryMax: 85_000 }).conflict).toBeNull();
  });

  it("offers the fields a review reason asks about first", () => {
    expect(suggestedConfirmableFields(["salary-unknown-salary", "salary-unknown-currency", "employment-type-unknown", "work-arrangement-unknown", "salary-tiers-differ", "seniority-manager-title-ambiguous", "residency-unknown"]))
      .toEqual(["salaryRange", "currency", "employmentType", "workArrangements", "applicableTier", "seniority", "residency"]);
    expect(suggestedConfirmableFields(["seniority-above-mid-level"])).toEqual([]);
  });
});
