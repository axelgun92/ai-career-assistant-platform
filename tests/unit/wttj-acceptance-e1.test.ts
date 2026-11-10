// Welcome to the Jungle / Otta live acceptance, November 4, 2026: the 20 real
// jobs saved in Alex's acceptance database (the ten original acceptance
// jobs, Ogury as the control case, and nine more from the same results
// pages), exported read-only on November 5 (E1) and replayed exactly as the
// extension sent them through the server's capture mapping and the shared
// normalizer. Nothing reaches the network.
//
// What E1 established:
// - every record was read by the structured-data reader from the page's
//   JSON-LD, whose description is only the posting's "You'll be working on"
//   part; WTTJ renders "We're looking for" (and on some jobs "Recruitment
//   process") separately, so those sections were never captured (browser
//   extraction; fixed in the reader after E2);
// - 16 of 20 records carry no page context and no Apply link: the
//   background tab was read the moment it loaded, before the page rendered
//   its body (browser timing; fixed in the tab reader after E2); the four
//   with page context are exactly the four with an Apply link;
// - three facts the captured text did state were not normalized (server;
//   fixed here): Ogury's "#LI-Hybrid" tag and its in-person days, Standard
//   Metrics' remote-first model with optional offices, OpenGov's "Work from
//   anywhere" and "This is a senior-level role".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRetrievedOpportunityNormalizer, readJobTextFacts } from "@ai-career/normalization";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";

interface E1Record {
  role: "original" | "control" | "additional";
  company: string;
  title: string;
  sourceUrl: string;
  extractor: string;
  notes: string[];
  pageTitle: string | null;
  pageText: string | null;
  capturedFields: Record<string, unknown>;
  applicationUrl: string | null;
}
const fixture = JSON.parse(readFileSync("tests/fixtures/real-captures/wttj-acceptance-e1.json", "utf8")) as { records: E1Record[] };
const normalizer = createRetrievedOpportunityNormalizer();
const receivedAt = new Date("2026-11-04T18:00:00.000Z");

async function replay(record: E1Record) {
  const envelope = {
    schemaVersion: 1,
    pageUrl: record.sourceUrl,
    extractor: record.extractor,
    capturedAt: receivedAt.toISOString(),
    extensionVersion: "0.3.0",
    notes: record.notes,
    pageTitle: record.pageTitle,
    pageText: record.pageText,
    fields: record.capturedFields,
  };
  const { raw } = capturedListing(parseCapture(envelope), { pairingId: "p1", domain: "customer-success", receivedAt, method: "batch" });
  return normalizer.normalize(raw);
}
const record = (company: string, role: E1Record["role"] = "original") => fixture.records.find((item) => item.company === company && item.role === role)!;
const markers = (rows: Array<{ fieldName: string; sourceField: string }>, field: string) => rows.filter((row) => row.fieldName === field).map((row) => row.sourceField);

describe("the E1 records", () => {
  it("are the ten original acceptance jobs, Ogury and nine more, all read from JSON-LD", () => {
    expect(fixture.records).toHaveLength(20);
    expect(fixture.records.filter((item) => item.role === "original").map((item) => item.company).sort()).toEqual(
      ["Beam", "FourKites", "Hack The Box", "Mintlify", "OpenGov", "ServiceTitan", "ServiceUp", "Standard Metrics", "Vantage", "Zeta Global"],
    );
    expect(fixture.records.filter((item) => item.role === "control").map((item) => item.company)).toEqual(["Ogury"]);
    expect(fixture.records.every((item) => item.extractor === "structured-data")).toBe(true);
  });

  it("lack the posting's qualifications section (the JSON-LD description stops before it)", () => {
    const openGov = record("OpenGov");
    // The page context (rendered page) holds the section; the description does not.
    expect(openGov.pageText).toContain("We're looking for");
    expect(openGov.pageText).toContain("Minimum of 3–5 years in Customer Success");
    expect(openGov.capturedFields.description).not.toContain("We're looking for");
    expect(openGov.capturedFields.description).not.toContain("Minimum of 3–5 years");
  });

  it("carry page context and an Apply link only where the page had rendered when it was read", () => {
    const withContext = fixture.records.filter((item) => item.pageText).map((item) => item.company).sort();
    const withApply = fixture.records.filter((item) => item.applicationUrl).map((item) => item.company).sort();
    expect(withContext).toEqual(["OpenGov", "ServiceUp", "Vantage", "Workday"]);
    expect(withApply).toEqual(withContext);
  });
});

describe("replayed through the normalizer", () => {
  it("normalizes the facts the captured text states (server-side fixes)", async () => {
    const ogury = await replay(record("Ogury", "control"));
    expect(ogury.opportunity.workArrangements).toEqual(["HYBRID"]);
    expect([...markers(ogury.provenance, "remoteStatus"), ...markers(ogury.provenance, "workArrangements")]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^rawText:explicit-(?:workplace-tag|office-days-statement)$/)]),
    );

    const standardMetrics = await replay(record("Standard Metrics"));
    expect(standardMetrics.opportunity.workArrangements).toEqual(["REMOTE"]);

    const openGov = await replay(record("OpenGov"));
    expect(openGov.opportunity.workArrangements).toEqual(["REMOTE"]);
    expect(openGov.opportunity.seniority).toBe("SENIOR");
    expect(markers(openGov.provenance, "seniority")).toEqual(["rawText:explicit-seniority-statement"]);
  });

  it("keeps every other field as saved", async () => {
    const expected: Record<string, { arrangement: string[]; residency: string | null; seniority: string | null; location: string }> = {
      "Beam/original": { arrangement: [], residency: null, seniority: null, location: "New York, New York, US" },
      "FourKites/original": { arrangement: [], residency: null, seniority: null, location: "Chicago, US" },
      "Hack The Box/original": { arrangement: ["REMOTE"], residency: "US_REQUIRED", seniority: null, location: "Remote (US)" },
      "Mintlify/original": { arrangement: [], residency: null, seniority: null, location: "San Francisco, US" },
      "ServiceTitan/original": { arrangement: ["REMOTE"], residency: "US_REQUIRED", seniority: null, location: "Remote (US)" },
      "ServiceUp/original": { arrangement: [], residency: null, seniority: null, location: "Campbell, CA, US" },
      "Vantage/original": { arrangement: ["REMOTE"], residency: "US_REQUIRED", seniority: null, location: "Remote (US)" },
      "Zeta Global/original": { arrangement: ["REMOTE"], residency: "US_REQUIRED", seniority: null, location: "Remote (US)" },
      "Coder/additional": { arrangement: ["REMOTE"], residency: "US_REQUIRED", seniority: "SENIOR", location: "Remote (US)" },
      "MongoDB/additional": { arrangement: [], residency: null, seniority: "SENIOR", location: "Los Angeles, US" },
      "Workday/additional": { arrangement: [], residency: null, seniority: "SENIOR", location: "Boston, US" },
    };
    for (const [key, want] of Object.entries(expected)) {
      const [company, role] = key.split("/") as [string, E1Record["role"]];
      const { opportunity } = await replay(record(company, role));
      expect({ arrangement: opportunity.workArrangements, residency: opportunity.residencyRequirement, seniority: opportunity.seniority, location: opportunity.location }, key).toEqual(want);
    }
  });

  it("reads U.S. residency for Vantage and Hack The Box from the posting's own structured eligibility (applicantLocationRequirements), not from a listing location or market", async () => {
    for (const company of ["Vantage", "Hack The Box"]) {
      const item = record(company);
      expect(item.capturedFields.remoteLocations, company).toEqual(["US"]);
      expect(item.capturedFields.location ?? null, company).toBeNull();
      const { opportunity, provenance } = await replay(item);
      expect(opportunity.residencyRequirement, company).toBe("US_REQUIRED");
      expect(markers(provenance, "residencyRequirement"), company).toEqual(["location:explicit-eligible-geography"]);
    }
  });

  it("keeps Ogury's two stated dates as stated, never inventing a corrected one", async () => {
    const { opportunity } = await replay(record("Ogury", "control"));
    expect(opportunity.postingDate?.toISOString().slice(0, 10)).toBe("2026-07-16");
    expect(opportunity.closingDate?.toISOString().slice(0, 10)).toBe("2025-10-15");
  });
});

describe("the new text rules stay narrow", () => {
  const arrangement = (text: string) => {
    const facts = readJobTextFacts({ text, title: null });
    return facts.remoteStatus ? [facts.remoteStatus.value] : (facts.workArrangements?.value ?? null);
  };
  const seniority = (text: string) => readJobTextFacts({ text, title: null }).seniority?.value ?? null;

  it("reads a workplace tag, but not other #LI- tags", () => {
    expect(arrangement("Own onboarding and adoption for a portfolio of accounts.\n#LI-Remote")).toEqual(["REMOTE"]);
    expect(arrangement("Own onboarding and adoption for a portfolio of accounts.\n#LI-Onsite")).toEqual(["ONSITE"]);
    expect(arrangement("Own onboarding and adoption for a portfolio of accounts.\n#LI-HP1 #LI-DNI")).toBeNull();
  });

  it("reads remote-first only with an optional office, and work from anywhere only as its own line", () => {
    expect(arrangement("We are a remote-first company, but you can always drop by our offices in SF.")).toEqual(["REMOTE"]);
    expect(arrangement("We are a remote-first company with hubs in SF and NYC.")).toBeNull();
    expect(arrangement("Benefits\nWork from anywhere\nUnlimited vacation")).toEqual(["REMOTE"]);
    expect(arrangement("You can work from anywhere for up to four weeks a year.")).toBeNull();
  });

  it("reads in-person days per week, and not an optional or indefinite cadence", () => {
    expect(arrangement("We encourage team members to join us in-person at least two days per week.")).toEqual(["HYBRID"]);
    expect(arrangement("You may come in-person up to two days per week if you like.")).toBeNull();
  });

  it("reads a stated level, never years, a level number or a negation", () => {
    expect(seniority("This is a senior-level role for a CSM who excels at retention.")).toBe("SENIOR");
    expect(seniority("The position is an entry-level position on our onboarding team.")).toBe("ENTRY");
    expect(seniority("As a Customer Success Manager III, you own a portfolio.")).toBeNull();
    expect(seniority("Requires 8+ years of senior-level customer experience.")).toBeNull();
    expect(seniority("This is not a senior-level role.")).toBeNull();
  });
});
