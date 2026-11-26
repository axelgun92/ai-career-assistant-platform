// The November 9, 2026 LinkedIn records exactly as the acceptance database
// stored them (Q1–Q4, nov9-dx.txt), replayed offline through the corrected
// shared reader, capture mapping and normalizer (November 10, 2026). Papirfly,
// SWEEP and Busuu were read by Mode B, Easyship by Single Capture, all through
// LinkedIn's job page; Kerv and Staffr by Single Capture through LinkedIn's
// JobPosting structured data, whose escaped description the earlier reader
// left as literal HTML. Kerv's and Staffr's pages are rebuilt from their
// stored HTML both ways: as LinkedIn's structured data (the markup escaped,
// with the stored datePosted and validThrough) and as its job page.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extensionCaptureSchema, extensionCaptureSchemaVersion, pageReaderRevision, type RawOpportunity } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { createRetrievedOpportunityNormalizer, readJobTextFacts } from "@ai-career/normalization";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing } from "../../apps/web/src/server/extension-capture";
import { readJobPage } from "../../apps/web/src/server/page-capture-acquisition";
import fixture from "../fixtures/real-captures/linkedin-nov9-q4-descriptions.json";

type Listing = {
  externalId: string;
  method: string;
  extractor: string;
  rawPostingDate: string;
  sourceClosingDate: string | null;
  location: string;
  expectedRemoteStatus: "HYBRID" | null;
  description: string;
};
const listings = fixture.listings as Record<string, Listing>;
const capturedAt = new Date("2026-11-10T06:00:00.000Z");
const listingId = (listing: Listing) => listing.externalId.split(":")[1]!;
const pageUrl = (listing: Listing) => `https://www.linkedin.com/jobs/view/${listingId(listing)}/`;
const tags = /<\/?(?:p|br|strong|ul|li|em)\b/;
const words = (text: string) => text.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const mapped = (envelope: unknown): RawOpportunity =>
  capturedListing(extensionCaptureSchema.parse(envelope), { pairingId: "p", domain: customerSuccessDiscoveryConfiguration.domain, receivedAt: capturedAt, method: "single" }).raw;
const normalize = async (raw: RawOpportunity) => {
  const { opportunity, provenance } = await createRetrievedOpportunityNormalizer().normalize(raw);
  return { opportunity, provenance: (field: string) => provenance.filter((row) => row.fieldName === field) };
};
// What the page reader stored, sent again as the capture it came from.
const storedCapture = (listing: Listing) =>
  mapped({
    schemaVersion: extensionCaptureSchemaVersion,
    pageUrl: pageUrl(listing),
    extractor: listing.extractor,
    capturedAt: capturedAt.toISOString(),
    extensionVersion: "0.3.0",
    readerRevision: pageReaderRevision,
    fields: { title: "Customer Success Manager", company: "Employer", location: listing.location, description: listing.description },
    editedFields: [],
  });
// A structured-data record's page, rebuilt from its stored HTML.
function rebuiltPage(listing: Listing, structured: boolean) {
  const escaped = listing.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const [locality, country] = listing.location.split(", ");
  const jsonLd = structured
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "http://schema.org",
        "@type": "JobPosting",
        title: "Customer Success Manager",
        description: escaped,
        datePosted: listing.rawPostingDate,
        validThrough: listing.sourceClosingDate,
        hiringOrganization: { "@type": "Organization", name: "Employer" },
        jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: locality, addressCountry: country } },
      }).replace(/</g, "\\u003c")}</script>`
    : "";
  return `<!doctype html><html><head><title>Customer Success Manager | Employer | LinkedIn</title>${jsonLd}</head><body><main>
<section class="top-card-layout"><h1 class="top-card-layout__title">Customer Success Manager</h1><a class="topcard__org-name-link" href="https://www.linkedin.com/company/x">Employer</a>
<span class="topcard__flavor topcard__flavor--bullet">${listing.location}</span><span class="posted-time-ago__text">2 weeks ago</span></section>
<section class="description"><div class="show-more-less-html__markup">${listing.description}</div></section></main></body></html>`;
}
function readRebuilt(listing: Listing, structured: boolean) {
  const window = new JSDOM(rebuiltPage(listing, structured), { url: pageUrl(listing), runScripts: "outside-only" }).window;
  try {
    const extraction = readJobPage(window.document)!;
    const built = buildCaptureEnvelope({ ...extraction, pageUrl: pageUrl(listing) }, "page", { extensionVersion: "0.3.0", capturedAt });
    if (!built.ok) throw new Error(built.problems.join("; "));
    return { extraction, raw: mapped(built.envelope) };
  } finally {
    window.close();
  }
}
// Every line of a description that on its own states an arrangement.
const statingLines = (text: string, location: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const facts = readJobTextFacts({ text: line, title: "Customer Success Manager", location, observedAt: capturedAt });
      return facts.remoteStatus || facts.workArrangements ? [{ line, value: facts.remoteStatus?.value ?? facts.workArrangements!.value.join("/") }] : [];
    });

describe("the stored records as Q1 shows them", () => {
  it("are the six listings, with the reader branch, dates and lengths the acceptance database stored (characters, as PostgreSQL counts them)", () => {
    const summary = Object.fromEntries(Object.entries(listings).map(([name, listing]) => [name, [listing.extractor, [...listing.description].length, tags.test(listing.description)]]));
    expect(summary).toEqual({
      papirfly: ["site:linkedin", 5439, false],
      sweep: ["site:linkedin", 6937, false],
      busuu: ["site:linkedin", 4073, false],
      easyship: ["site:linkedin", 4269, false],
      kerv: ["structured-data", 5699, true],
      staffr: ["structured-data", 5816, true],
    });
    // Q3: both structured closing dates are exactly 30 days after posting.
    for (const listing of [listings.kerv!, listings.staffr!]) {
      expect(Date.parse(listing.sourceClosingDate!) - Date.parse(listing.rawPostingDate)).toBe(30 * 86_400_000);
    }
  });
});

describe("work arrangement, from the complete stored descriptions", () => {
  it.each([
    ["papirfly", "HYBRID", "rawText:explicit-work-arrangement-statement", "Must be based in London and excited about working in a hybrid, collaborative environment."],
    ["easyship", "HYBRID", "rawText:explicit-work-arrangement-statement", "This is a full-time, hybrid role (3 days in office) based in London."],
    ["busuu", null, null, null],
    ["sweep", null, null, null],
  ] as const)("%s (LinkedIn's job page) → %s", async (name, remoteStatus, sourceField, sourceText) => {
    const { opportunity, provenance } = await normalize(storedCapture(listings[name]!));
    expect(opportunity.remoteStatus).toBe(remoteStatus);
    expect(opportunity.workArrangements).toEqual(remoteStatus ? [remoteStatus] : []);
    expect(provenance("remoteStatus").map((row) => [row.sourceField, row.sourceText])).toEqual(sourceField ? [[sourceField, sourceText]] : []);
  });

  it.each([
    ["kerv", "Please note: We are a hybrid working company and this role will require to attend Richmond (TW9) based office twice a week depending on business needs."],
    ["staffr", "• Location: Hybrid, London (1–2 days a week in the office)"],
  ] as const)("%s (read again through the corrected structured-data reader) → Hybrid, from office attendance", async (name, sourceText) => {
    const { opportunity, provenance } = await normalize(readRebuilt(listings[name]!, true).raw);
    expect(opportunity.remoteStatus).toBe("HYBRID");
    expect(provenance("remoteStatus").map((row) => [row.sourceField, row.sourceText])).toEqual([["rawText:explicit-office-days-statement", sourceText]]);
  });

  it("no other line of any posting states a different arrangement; Work from Anywhere weeks and company policy state none", () => {
    const lines = Object.fromEntries(
      Object.entries(listings).map(([name, listing]) => {
        const text = tags.test(listing.description) ? readRebuilt(listing, false).extraction.posting!.description! : listing.description;
        return [name, statingLines(text, listing.location)];
      }),
    );
    expect(lines.papirfly!.map((hit) => hit.value)).toEqual(["HYBRID"]);
    expect(lines.easyship!.map((hit) => hit.value)).toEqual(["HYBRID"]);
    expect(lines.kerv).toEqual([
      { line: expect.stringContaining("attend Richmond (TW9) based office twice a week"), value: "HYBRID" },
      { line: "Comfortable working within a hybrid model, balancing office-based and remote working.", value: "HYBRID" },
    ]);
    expect(lines.staffr).toEqual([
      { line: "• Location: Hybrid, London (1–2 days a week in the office)", value: "HYBRID" },
      { line: "• Hybrid working in London. 1–2 days a week in the office with the team, and flexibility around it.", value: "HYBRID" },
    ]);
    expect(lines.busuu).toEqual([]);
    expect(lines.sweep).toEqual([]);
    for (const line of [
      "The freedom to ‘Work from Anywhere’ for 4 weeks in a year",
      "• Work from anywhere. Two weeks a year to work from wherever you like.",
      "We like to support our teams with their work-life balance so we offer flexible working hours and hybrid or remote model of working.",
      "Our hybrid work model, with hiring focussed around our head offices in Paris, London and Montpellier, allows us to balance our personal and professional lives while staying connected and engaged with colleagues and clients.",
      "The role is based in London.",
    ]) expect(statingLines(line, "London, England, United Kingdom"), line).toEqual([]);
  });
});

describe("Kerv and Staffr: one description, one version and no closing date, whichever LinkedIn reader branch reads them", () => {
  it.each(["kerv", "staffr"] as const)("%s: structured data and the job page give the same clean text, every word kept, the same content hash", (name) => {
    const listing = listings[name]!;
    const structured = readRebuilt(listing, true);
    const page = readRebuilt(listing, false);
    expect([structured.extraction.extractor, page.extraction.extractor]).toEqual(["structured-data", "site:linkedin"]);
    expect(structured.raw.description).toBe(page.raw.description);
    expect(structured.raw.description).not.toMatch(tags);
    expect(words(structured.raw.description!)).toBe(words(listing.description));
    expect(structured.raw.retrieval!.contentHash).toBe(page.raw.retrieval!.contentHash);
  });

  it.each(["kerv", "staffr"] as const)("%s: LinkedIn's validThrough (posted + 30 days) is read but is no closing date; the posting date stays the stated one", async (name) => {
    const listing = listings[name]!;
    const { extraction, raw } = readRebuilt(listing, true);
    expect(extraction.posting).toMatchObject({ postedAt: listing.rawPostingDate, closingDate: listing.sourceClosingDate });
    expect(JSON.stringify(raw)).not.toContain(listing.sourceClosingDate!);
    const { opportunity, provenance } = await normalize(raw);
    expect(opportunity.closingDate).toBeNull();
    expect(provenance("closingDate")).toEqual([]);
    expect(opportunity.postingDate?.toISOString()).toBe(listing.rawPostingDate);
  });
});
