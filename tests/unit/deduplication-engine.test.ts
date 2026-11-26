import { describe, expect, it } from "vitest";
import {
  compareListings,
  decideDuplicates,
  deduplicationEngineVersion,
  listingIdKey,
  listingUrlKey,
  listingUrlPrefix,
  normalizeCompanyName,
  probableMatchThreshold,
  type DuplicateCandidate,
  type DuplicateIdentity,
} from "@ai-career/deduplication";

const description =
  "Own onboarding, adoption, education, retention and business reviews for a portfolio of SaaS customers. " +
  "Partner with Product and Support. Three years of Customer Success experience required.";

function identity(overrides: Partial<DuplicateIdentity> = {}): DuplicateIdentity {
  return {
    companyName: "Acme Analytics",
    title: "Customer Success Manager",
    location: "Remote - United States",
    description,
    urls: [],
    listingIds: [],
    requisitionIds: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    ...identity(),
    opportunityId: id,
    firstSeenAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("normalizeCompanyName", () => {
  it("ignores case, width, punctuation, whitespace and '&'", () => {
    expect(normalizeCompanyName("Acme Analytics")).toBe("acme analytics");
    expect(normalizeCompanyName("  ACME   analytics ")).toBe("acme analytics");
    expect(normalizeCompanyName("Ａｃｍｅ Analytics")).toBe("acme analytics");
    expect(normalizeCompanyName("Smith & Sons")).toBe(normalizeCompanyName("Smith and Sons"));
    expect(normalizeCompanyName("Acme-Analytics!")).toBe("acme analytics");
  });

  it("removes exactly one recognized trailing legal-entity suffix", () => {
    for (const name of ["Acme, Inc.", "Acme Inc", "Acme LLC", "Acme L.L.C.", "Acme Ltd.", "Acme Limited", "Acme Corp", "Acme Corporation", "Acme GmbH", "Acme PLC", "Acme S.A.", "Acme B.V.", "Acme Pty Ltd"]) {
      expect(normalizeCompanyName(name), name).toBe("acme");
    }
    // One suffix only, and only at the end.
    expect(normalizeCompanyName("Acme Holdings Inc")).toBe("acme holdings");
    expect(normalizeCompanyName("Inc Magazine")).toBe("inc magazine");
    expect(normalizeCompanyName("Acme Ltd Inc")).toBe("acme ltd");
  });

  it("never removes ordinary business words or a whole name", () => {
    expect(normalizeCompanyName("Acme Company")).toBe("acme company");
    expect(normalizeCompanyName("Acme Group")).toBe("acme group");
    expect(normalizeCompanyName("Acme Technologies")).toBe("acme technologies");
    expect(normalizeCompanyName("Limited")).toBe("limited");
    expect(normalizeCompanyName("Café Ünïcode")).toBe("café ünïcode");
  });

  it("returns null without letters or digits", () => {
    expect(normalizeCompanyName(null)).toBeNull();
    expect(normalizeCompanyName("")).toBeNull();
    expect(normalizeCompanyName(" -- ")).toBeNull();
  });
});

describe("listing identifiers", () => {
  it("builds the same URL key for presentational differences only", () => {
    const key = listingUrlKey("https://boards.greenhouse.io/acme/jobs/4012345");
    expect(key).toBe("boards.greenhouse.io/acme/jobs/4012345");
    for (const variant of [
      "https://www.boards.greenhouse.io/acme/jobs/4012345/",
      "http://BOARDS.greenhouse.io/Acme/Jobs/4012345",
      "https://boards.greenhouse.io/acme/jobs/4012345?utm_source=linkedin&gclid=x",
      "https://boards.greenhouse.io/acme/jobs/4012345#apply",
    ]) {
      expect(listingUrlKey(variant), variant).toBe(key);
    }
  });

  it("keeps identifying query parameters in a stable order and route fragments", () => {
    expect(listingUrlKey("https://acme.com/careers?gh_jid=77&b=2")).toBe("acme.com/careers?b=2&gh_jid=77");
    expect(listingUrlKey("https://acme.com/careers?b=2&gh_jid=77&utm_medium=x")).toBe("acme.com/careers?b=2&gh_jid=77");
    expect(listingUrlKey("https://acme.com/careers?gh_jid=78")).not.toBe(listingUrlKey("https://acme.com/careers?gh_jid=77"));
    expect(listingUrlKey("https://jobs.acme.com/#/job/12")).toBe("jobs.acme.com#/job/12");
  });

  it("refuses non-http values and site roots", () => {
    expect(listingUrlKey("javascript:alert(1)")).toBeNull();
    expect(listingUrlKey("not a url")).toBeNull();
    expect(listingUrlKey("https://acme.com/")).toBeNull();
    expect(listingUrlKey("https://www.acme.com")).toBeNull();
    expect(listingUrlKey(null)).toBeNull();
  });

  it("derives a candidate prefix contained in every equivalent URL", () => {
    expect(listingUrlPrefix("https://www.acme.com/jobs/1/?utm_source=x")).toBe("acme.com/jobs/1");
    expect(listingIdKey("  REQ-42 ")).toBe("req-42");
    expect(listingIdKey("   ")).toBeNull();
  });
});

describe("compareListings", () => {
  it("MATCH on the same URL when nothing conflicts", () => {
    const match = compareListings(
      identity({ urls: ["https://boards.greenhouse.io/acme/jobs/4012345?utm_source=x"] }),
      candidate("a", { urls: ["https://boards.greenhouse.io/acme/jobs/4012345"] }),
    );
    expect(match).toMatchObject({ decision: "MATCH", confidence: 1, evidence: { matchedOn: ["url"], conflicts: [], engineVersion: deduplicationEngineVersion } });
  });

  it("MATCH when an application URL equals a source URL", () => {
    const match = compareListings(
      identity({ urls: [null, "https://jobs.lever.co/acme/abc-123/apply"] }),
      candidate("a", { urls: ["https://jobs.lever.co/acme/abc-123/apply", null] }),
    );
    expect(match?.decision).toBe("MATCH");
  });

  it("downgrades a shared URL to PROBABLE_MATCH when the titles differ (generic careers page)", () => {
    const match = compareListings(
      identity({ urls: ["https://acme.com/careers"], title: "Onboarding Specialist" }),
      candidate("a", { urls: ["https://acme.com/careers"] }),
    );
    expect(match).toMatchObject({ decision: "PROBABLE_MATCH", evidence: { conflicts: ["title"] } });
  });

  it("downgrades a shared URL when companies or listing IDs differ", () => {
    expect(
      compareListings(identity({ urls: ["https://x.com/j/1"], companyName: "Other Co" }), candidate("a", { urls: ["https://x.com/j/1"] }))?.decision,
    ).toBe("PROBABLE_MATCH");
    expect(
      compareListings(
        identity({ urls: ["https://x.com/j/1"], listingIds: ["1"] }),
        candidate("a", { urls: ["https://x.com/j/1"], listingIds: ["2"] }),
      ),
    ).toMatchObject({ decision: "PROBABLE_MATCH", evidence: { conflicts: ["listingId"] } });
  });

  it("MATCH on a listing or requisition ID only within the same company", () => {
    expect(
      compareListings(identity({ listingIds: [" REQ-42 "], companyName: "Acme Analytics, Inc." }), candidate("a", { listingIds: ["req-42"] })),
    ).toMatchObject({ decision: "MATCH", evidence: { matchedOn: ["listingId", "company"] } });
    expect(compareListings(identity({ requisitionIds: ["R1"] }), candidate("a", { requisitionIds: ["r1"] }))?.decision).toBe("MATCH");
    // The same ID at another company is not a duplicate.
    expect(compareListings(identity({ listingIds: ["42"], companyName: "Globex", title: "Other", description: "x" }), candidate("a", { listingIds: ["42"] }))).toBeNull();
    // Without both companies it is a warning only.
    expect(compareListings(identity({ listingIds: ["42"], companyName: null }), candidate("a", { listingIds: ["42"] }))).toMatchObject({
      decision: "PROBABLE_MATCH",
      confidence: 0.7,
    });
  });

  it("scores PROBABLE_MATCH from company, title, location and description", () => {
    const same = compareListings(identity(), candidate("a"));
    expect(same?.decision).toBe("PROBABLE_MATCH");
    expect(same?.confidence).toBe(0.99);
    expect(same?.evidence.similarity).toEqual({ title: 1, location: 1, description: 1, salaryPenalty: 0 });

    const senior = compareListings(identity({ title: "Senior Customer Success Manager" }), candidate("a"));
    expect(senior?.decision).toBe("PROBABLE_MATCH");
    expect(senior!.confidence).toBeGreaterThanOrEqual(probableMatchThreshold);
  });

  it("does not flag a different role at the same company sharing boilerplate", () => {
    expect(compareListings(identity({ title: "Onboarding Specialist" }), candidate("a"))).toBeNull();
  });

  it("requires the same company for a similarity match", () => {
    expect(compareListings(identity({ companyName: "Globex" }), candidate("a"))).toBeNull();
    expect(compareListings(identity({ companyName: null }), candidate("a"))).toBeNull();
  });

  it("subtracts a penalty when stated salary ranges in one currency do not overlap", () => {
    const withSalary = { salaryMin: 60_000, salaryMax: 70_000, currency: "USD" };
    const match = compareListings(identity(withSalary), candidate("a", { salaryMin: 90_000, salaryMax: 100_000, currency: "USD" }));
    expect(match?.evidence.similarity?.salaryPenalty).toBe(0.1);
    expect(match?.evidence.conflicts).toEqual(["salary"]);
    // Different currencies are never compared.
    expect(compareListings(identity(withSalary), candidate("a", { salaryMin: 90_000, currency: "EUR" }))?.evidence.similarity?.salaryPenalty).toBe(0);
  });

  it("treats missing locations on both sides as neutral and one-sided as different", () => {
    const both = compareListings(identity({ location: null }), candidate("a", { location: null }));
    const oneSided = compareListings(identity({ location: null }), candidate("a"));
    expect(both?.evidence.similarity?.location).toBe(0.5);
    expect(oneSided?.evidence.similarity?.location).toBe(0);
  });
});

describe("decideDuplicates", () => {
  it("returns NO_MATCH without candidates", () => {
    expect(decideDuplicates(identity(), [])).toEqual({ decision: "NO_MATCH", canonical: null, matches: [] });
  });

  it("picks the earliest-seen exact match as canonical, then lists probable matches", () => {
    const url = "https://acme.com/jobs/1";
    const result = decideDuplicates(identity({ urls: [url] }), [
      candidate("later", { urls: [url], firstSeenAt: new Date("2026-10-05T00:00:00Z") }),
      candidate("probable"),
      candidate("earliest", { urls: [url], firstSeenAt: new Date("2026-10-02T00:00:00Z") }),
      candidate("tie-b", { urls: [url], firstSeenAt: new Date("2026-10-02T00:00:00Z") }),
      candidate("unrelated", { companyName: "Globex", title: "Engineer", description: "Build things" }),
    ]);
    expect(result.decision).toBe("MATCH");
    expect(result.canonical?.opportunityId).toBe("earliest");
    expect(result.matches.map((match) => match.opportunityId)).toEqual(["earliest", "tie-b", "later", "probable"]);
  });

  it("is deterministic for identical input", () => {
    const candidates = [candidate("b"), candidate("a")];
    expect(decideDuplicates(identity(), candidates)).toEqual(decideDuplicates(identity(), [...candidates].reverse()));
  });
});
