// The historical duplicate investigation's rules (November 24, 2026), on
// synthetic pairs: identifiers first, conflicts next, text last; never the
// PROBABLE_MATCH label or one similarity threshold alone.
import { describe, expect, it } from "vitest";
import { parseHistoryArguments } from "../../apps/web/src/server/duplicate-history-cli";
import { classifyPair, comparePair, descriptionOverlap, periodOf, type HistorySide } from "../../apps/web/src/server/duplicate-history-diagnostic";

const text = [
  "Own onboarding, adoption and renewals for a portfolio of mid-market SaaS customers across North America.",
  "Run quarterly business reviews, build success plans and partner with Sales and Support on expansion.",
  "Track health scores, lead escalations and turn customer feedback into product requests for the roadmap team.",
  "You bring three or more years in customer success or account management at a B2B software company.",
].join(" ");

function side(id: string, overrides: Partial<HistorySide> = {}): HistorySide {
  return {
    id, title: "Customer Success Manager", company: "Acme", status: "NORMALIZED", source: "linkedin", sourceType: "BROWSER_ASSISTED",
    firstSeenAt: new Date("2026-11-05T10:00:00Z"), canonicalUrl: null, applicationUrl: null, externalListingId: null, atsRequisitionId: null,
    location: "Remote - United States", residencyRegions: ["US"], workArrangements: ["REMOTE"], salaryMin: null, salaryMax: null, currency: null,
    employmentType: null, postingDate: null, triage: null, evaluations: 0, hasApplication: false, description: text, versions: [],
    identity: null, renormalizedIdentity: null,
    ...overrides,
  };
}
const classify = (a: HistorySide, b: HistorySide) => classifyPair(a, b, comparePair(a, b));

describe("pair classification", () => {
  it("a seniority difference in the title is a different job, not formatting", () => {
    const result = classify(side("a", { title: "Senior Customer Success Manager" }), side("b"));
    expect(comparePair(side("a", { title: "Senior Customer Success Manager" }), side("b")).title).toBe("SENIORITY_DIFFERS");
    expect(result.classification).toMatch(/DISTINCT/);
  });

  it("title formatting alone is not a difference", () => {
    const result = classify(side("a", { title: "Customer Success Manager - " }), side("b", { title: "customer success manager" }));
    expect(result.classification).toBe("LIKELY_SAME_POSTING");
    expect(result.nature).toBe("different versions of one posting (title formatting differ)");
  });

  it("the same text under two listing IDs from one source stays likely, never confirmed", () => {
    const result = classify(side("a", { externalListingId: "4100000001" }), side("b", { externalListingId: "4100000002" }));
    expect(result).toMatchObject({ classification: "LIKELY_SAME_POSTING", nature: "the same posting text under two listing IDs (repost or second opening)" });
  });

  it("a shared listing URL with a different title is never confirmed the same", () => {
    const shared = "https://careers.acme.example/jobs";
    const result = classify(side("a", { canonicalUrl: shared, title: "Onboarding Specialist" }), side("b", { canonicalUrl: shared }));
    expect(result.classification).not.toBe("CONFIRMED_SAME_POSTING");
  });

  it("different employers are never the same posting, and say so", () => {
    const result = classify(side("a", { company: "Acme" }), side("b", { company: "Northwind" }));
    expect(result.classification).toBe("STILL_UNRESOLVED");
    expect(result.missing).toContain("the same employer (company names differ or are unknown)");
  });

  it("non-overlapping salaries are a stated conflict", () => {
    const result = classify(side("a", { salaryMin: 50000, salaryMax: 60000, currency: "USD" }), side("b", { salaryMin: 90000, salaryMax: 110000, currency: "USD" }));
    expect(result.classification).toBe("LIKELY_DISTINCT");
    expect(result.evidence).toContain("conflict: non-overlapping salary ranges");
  });

  it("an earlier copy without a description leaves the pair unresolved, naming what is missing", () => {
    const result = classify(side("a"), side("b", { description: "" }));
    expect(result.classification).toBe("STILL_UNRESOLVED");
    expect(result.missing).toEqual([
      "a complete description (earlier copy incomplete)",
      "any listing or requisition identifier shared by, or conflicting between, the two copies",
    ]);
  });
});

describe("history helpers", () => {
  it("places a capture after the latest documented change on or before its day", () => {
    expect(periodOf(new Date("2026-10-16T12:00:00Z"))).toBe("before 2026-10-17");
    expect(periodOf(new Date("2026-11-07T12:00:00Z"))).toBe("after 2026-11-06 (Mode B live-round fixes; Rev 3)");
    expect(periodOf(new Date("2026-11-15T00:00:00Z"))).toBe("after 2026-11-15 (Normalization fixes F1-F7; continuous Mode B)");
  });

  it("measures text overlap so a truncated earlier copy is still recognized as contained", () => {
    expect(descriptionOverlap(text, text)).toEqual({ jaccard: 1, containment: 1 });
    const truncated = descriptionOverlap(text, text.slice(0, Math.floor(text.length / 2)));
    expect(truncated!.containment).toBe(1);
    expect(truncated!.jaccard).toBeLessThan(0.6);
    expect(descriptionOverlap("too short", text)).toBeNull();
  });

  it("requires the database DATABASE_URL names and never echoes the URL", () => {
    const environment = { DATABASE_URL: "postgresql://user:secret@localhost:5432/ai_career_assistant_acceptance" };
    expect(parseHistoryArguments(["--database", "ai_career_assistant_acceptance", "--summary-only"], environment)).toMatchObject({ ok: true, pairDetail: false, jsonFile: null });
    const wrong = parseHistoryArguments(["--database", "other"], environment);
    expect(wrong).toMatchObject({ ok: false });
    expect(JSON.stringify(wrong)).not.toContain("secret");
    expect(parseHistoryArguments(["--database", "ai_career_assistant_acceptance", "--json"], environment)).toEqual({ ok: false, problem: "--json needs a value" });
  });
});
