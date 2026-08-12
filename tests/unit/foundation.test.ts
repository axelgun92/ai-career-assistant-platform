import { describe, expect, it } from "vitest";
import {
  normalizedOpportunitySchema,
  platformMetadata,
} from "@ai-career/core";
import { serverEnvironmentSchema } from "@ai-career/shared";

describe("Milestone 1 foundation", () => {
  it("exposes the modular-monolith platform identity", () => {
    expect(platformMetadata).toEqual({
      id: "ai-career-platform",
      name: "AI Career Platform",
      architecture: "modular-monolith",
    });
  });

  it("represents unavailable normalized opportunity fields explicitly", () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    const opportunity = normalizedOpportunitySchema.parse({
      domain: "customer-success",
      externalListingId: null,
      atsRequisitionId: null,
      canonicalUrl: null,
      applicationUrl: null,
      originalSource: null,
      discoveredAt: now,
      sourceUpdatedAt: null,
      firstSeenAt: now,
      lastSeenAt: now,
      companyName: null,
      brand: null,
      parentCompany: null,
      industry: null,
      headquarters: null,
      companySize: null,
      title: null,
      department: null,
      employmentType: null,
      seniority: null,
      location: null,
      remoteStatus: null,
      timeZoneRequirements: null,
      salaryMin: null,
      salaryMax: null,
      salaryText: null,
      bonus: null,
      equity: null,
      currency: null,
      compensationNotes: null,
      postingDate: null,
      closingDate: null,
      source: null,
      sourceType: null,
      atsPlatform: null,
      jobDescription: null,
      responsibilities: null,
      requirements: null,
      benefits: null,
      additionalNotes: null,
      status: "DISCOVERED",
    });

    expect(opportunity.title).toBeNull();
    expect(opportunity.salaryMin).toBeNull();
    expect(opportunity.status).toBe("DISCOVERED");
  });

  it("accepts PostgreSQL configuration and rejects another database protocol", () => {
    expect(
      serverEnvironmentSchema.parse({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/platform",
      }).DATABASE_URL,
    ).toContain("postgresql://");

    expect(() =>
      serverEnvironmentSchema.parse({ DATABASE_URL: "file:./local.db" }),
    ).toThrow();
  });
});
