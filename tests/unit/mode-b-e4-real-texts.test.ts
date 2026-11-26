// The November 5, 2026 LinkedIn Mode B failures, replayed from their real
// stored text (E4 evidence: the acceptance database's source versions,
// exported read-only at 144fa6c on November 6). Each listing goes through the
// same capture mapping and normalization a Mode B read uses today.
//   Critical Start: "The application deadline for this position is November
//     20, 2026." was not a closing date.
//   AlertMedia: "Location: Position is fully remote and open to candidates in
//     Austin, Texas or other cities in the United States. Please note that we
//     currently do not hire candidates residing in the following states: …"
//     gave no arrangement, residency or exclusions.
//   Juniper Square: "The U.S. base salary range … $86,000 - $95,000 USD and
//     the Canadian base salary range is $77,000 to $85,000 CAD." was Unknown;
//     the company works across "27 U.S. states, 2 Canadian Provinces, …", so
//     both tiers are kept and neither is the role's primary.
// Negatives from the same texts: nothing invented that the posting does not
// state (Critical Start's pay-transparency "remotely within the U.S." is not a
// remote role; Juniper Square's company-wide ways of working are not this
// role's arrangement or residency).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";
import { formatResidencyEligibility } from "../../apps/web/src/components/opportunity-facts";

interface Listing {
  sourceUrl: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  employmentType: string;
  postingDate: string;
  capturedAt: string;
  seniority: string[] | null;
  description: string;
}
const fixture = JSON.parse(readFileSync("tests/fixtures/real-captures/mode-b-e4-linkedin-nov5.json", "utf8")) as { listings: Record<string, Listing> };
const normalizer = createRetrievedOpportunityNormalizer();

// The listing as a Mode B read today captures it (the LinkedIn job-page reader's fields).
async function replay(name: string) {
  const listing = fixture.listings[name]!;
  const capturedAt = new Date(listing.capturedAt);
  const envelope = {
    schemaVersion: 1,
    pageUrl: listing.sourceUrl,
    extractor: "site:linkedin",
    capturedAt: capturedAt.toISOString(),
    extensionVersion: "0.3.0",
    readerRevision: 1,
    notes: [],
    pageTitle: null,
    pageText: null,
    fields: {
      title: listing.title,
      company: listing.company,
      location: listing.location,
      description: listing.description,
      employmentType: listing.employmentType,
      postedAt: listing.postingDate,
      seniority: listing.seniority?.[0] ?? null,
      siteJobId: listing.externalId.split(":")[1],
    },
  };
  const { raw } = capturedListing(parseCapture(envelope), { pairingId: "p1", domain: "customer-success", receivedAt: capturedAt, method: "batch" });
  const normalized = await normalizer.normalize(raw);
  return { raw, opportunity: normalized.opportunity as Record<string, unknown>, provenance: normalized.provenance as Array<{ fieldName: string; sourceField: string; sourceText?: string | null }> };
}
const cited = (provenance: Array<{ fieldName: string; sourceField: string; sourceText?: string | null }>, field: string) => provenance.find((row) => row.fieldName === field);

describe("the November 5 LinkedIn failures, on their real stored text", () => {
  it("Critical Start: the stated application deadline is the closing date; nothing else is invented", async () => {
    const { opportunity, provenance, raw } = await replay("critical-start");
    expect(opportunity.closingDate).toEqual(new Date("2026-11-20T00:00:00.000Z"));
    expect(cited(provenance, "closingDate")?.sourceText).toBe("The application deadline for this position is November 20, 2026.");
    // Unchanged facts from the same text.
    expect(opportunity).toMatchObject({ salaryMin: 80_000, salaryMax: 110_000, currency: "USD", compensationBasis: "BASE", location: "Tallahassee, FL" });
    // A pay-transparency clause ("performed … remotely within the U.S.") is not this role's arrangement or residency.
    expect(opportunity).toMatchObject({ remoteStatus: null, workArrangements: [], residencyRequirement: null, residencyExclusions: [] });
    // The careers front page in the text is never the application link; the LinkedIn listing is the labelled fallback.
    expect(raw.applicationUrl).toBe("https://www.linkedin.com/jobs/view/4483410074");
  });

  it("AlertMedia: fully remote, U.S. residence with the 15 excluded states, the Austin location kept, work authorization apart", async () => {
    const { opportunity, provenance } = await replay("alertmedia");
    expect(opportunity).toMatchObject({
      location: "Austin, Texas Metropolitan Area",
      remoteStatus: "REMOTE",
      workArrangements: ["REMOTE"],
      residencyRequirement: "US_REQUIRED",
      residencyRegions: ["US"],
      residencyExclusions: ["US-AK", "US-CA", "US-HI", "US-LA", "US-MS", "US-MT", "US-NH", "US-ND", "US-OR", "US-PA", "US-RI", "US-VT", "US-WA", "US-WV", "US-WY"],
      workAuthorizationRequirement: "RIGHT_TO_WORK",
      workAuthorizationRegions: ["US"],
      visaSponsorship: "NOT_AVAILABLE",
      salaryMin: null,
    });
    expect(cited(provenance, "remoteStatus")?.sourceText).toContain("Position is fully remote");
    expect(cited(provenance, "residencyExclusions")?.sourceText).toContain("we currently do not hire candidates residing in the following states");
    expect(formatResidencyEligibility(opportunity.residencyRequirement as string, opportunity.residencyRegions as string[], opportunity.residencyExclusions as string[])).toBe(
      "U.S. residence required, excluding: Alaska, California, Hawaii, Louisiana, Mississippi, Montana, New Hampshire, North Dakota, Oregon, Pennsylvania, Rhode Island, Vermont, Washington State, West Virginia, Wyoming",
    );
  });

  it("Juniper Square: both country tiers kept in their own currencies; no primary, because Canada is open too", async () => {
    const { opportunity } = await replay("juniper-square");
    expect(opportunity.compensationTiers).toEqual([
      { label: "United States", minimum: 86_000, maximum: 95_000, currency: "USD" },
      { label: "Canada", minimum: 77_000, maximum: 85_000, currency: "CAD" },
    ]);
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, currency: null });
    // Company-wide ways of working are not this role's arrangement or residency.
    expect(opportunity).toMatchObject({ remoteStatus: null, workArrangements: [], residencyRequirement: null, residencyExclusions: [], location: "Denver, CO" });
  });

  it("each listing keeps its LinkedIn listing as the labelled application fallback (no employer link in the stored text)", async () => {
    for (const name of ["critical-start", "alertmedia", "juniper-square"]) {
      const { raw } = await replay(name);
      expect(raw.applicationUrl, name).toBe(fixture.listings[name]!.sourceUrl);
      expect((raw.sourceMetadata as { sourceFacts: { applicationUrlBasis: string } }).sourceFacts.applicationUrlBasis, name).toBe("LISTING_PAGE_FALLBACK");
    }
  });
});
