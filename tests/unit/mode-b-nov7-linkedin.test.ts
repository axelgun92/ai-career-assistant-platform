// November 7, 2026 LinkedIn Mode B results (Rev 3, three jobs read live and
// cross-checked by Alex against their postings), offline:
//   Nearmap (4483749069): "Role Location: Fully remote within the continental
//     United States." gave Work arrangement Unknown and no eligibility.
//   Thomson Reuters (4479301564): a target-total-cash range "inclusive of base
//     salary and any target sales incentive" was shown as a bare range; its
//     eight weeks a year of working from anywhere is a benefit, not the role's
//     arrangement.
// Plus the worker's waiting states and the observation time of a refresh.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { formatArrangementWithExceptions, formatCompensationRange, formatResidencyEligibility } from "../../apps/web/src/components/opportunity-facts";
import { statusText, type PageCaptureRowView } from "../../apps/web/src/components/extension/page-capture-labels";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";

const normalizer = createRetrievedOpportunityNormalizer();
const readAt = new Date("2026-11-07T18:00:00.000Z");
async function read(input: { id: string; location: string; description: string }) {
  const envelope = {
    schemaVersion: 1,
    pageUrl: `https://www.linkedin.com/jobs/view/${input.id}`,
    extractor: "site:linkedin",
    capturedAt: readAt.toISOString(),
    extensionVersion: "0.2.0",
    readerRevision: 1,
    notes: [],
    pageTitle: null,
    pageText: null,
    fields: { title: "Customer Success Manager", company: "Company", location: input.location, description: input.description, siteJobId: input.id },
  };
  const { raw } = capturedListing(parseCapture(envelope), { pairingId: "p1", domain: "customer-success", receivedAt: readAt, method: "batch" });
  const { opportunity, provenance } = await normalizer.normalize(raw);
  return { raw, opportunity: opportunity as Record<string, unknown>, provenance: provenance as Array<{ fieldName: string; sourceField: string; sourceText?: string | null }> };
}

describe("Nearmap: an explicit fully remote role within the continental United States", () => {
  const description = [
    "Nearmap is looking for a Customer Success Manager to own onboarding, adoption and renewals for a portfolio of customers.",
    "Role Location: Fully remote within the continental United States.",
    "Work from overseas: up to four weeks a year from approved cities.",
  ].join("\n\n");

  it("is Remote, U.S. residence excluding Alaska and Hawaii (the contiguous states), with the posting's location kept as stated", async () => {
    const { opportunity, provenance } = await read({ id: "4483749069", location: "Lehi, UT", description });
    expect(opportunity).toMatchObject({
      remoteStatus: "REMOTE",
      workArrangements: ["REMOTE"],
      residencyRequirement: "US_REQUIRED",
      residencyRegions: ["US"],
      residencyExclusions: ["US-AK", "US-HI"],
      location: "Lehi, UT",
    });
    expect(provenance.find((row) => row.fieldName === "residencyExclusions")?.sourceText).toContain("continental United States");
    expect(formatResidencyEligibility("US_REQUIRED", ["US"], ["US-AK", "US-HI"])).toBe("Continental U.S. residence required (excluding Alaska and Hawaii)");
  });

  it("an overseas working benefit is not international eligibility, and the continent named for customers is no restriction", async () => {
    const customers = await read({ id: "4400000001", location: "Austin, TX", description: "Our customers span the continental United States.\n\nThis is an on-site role in Austin.\n\nOwn renewals." });
    expect(customers.opportunity).toMatchObject({ residencyRequirement: null, residencyExclusions: [] });
    const { opportunity } = await read({ id: "4483749069", location: "Lehi, UT", description });
    expect(opportunity.residencyRegions).toEqual(["US"]);
  });

  it("a candidate statement naming the continental U.S. (the Wellfound case) keeps U.S. residence and now states the two excluded states", async () => {
    const { opportunity } = await read({ id: "4400000002", location: "Oakland, CA", description: "We are fully distributed.\n\nCandidates must be based in the continental U.S., between Pacific and Eastern time zones.\n\nOwn renewals." });
    expect(opportunity).toMatchObject({ residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], residencyExclusions: ["US-AK", "US-HI"], timeZoneRequirements: null });
  });
});

describe("Thomson Reuters: target total cash compensation", () => {
  const variants = {
    "one sentence": "In the United States, the target total cash compensation range for this role is $106,400 - $197,600 USD, inclusive of base salary and any target sales incentive.",
    "range then what it includes": "Target total cash compensation range: $106,400 - $197,600 USD. This range is inclusive of base salary and any target sales incentive.",
  };
  for (const [name, statement] of Object.entries(variants)) {
    it(`is on-target pay (base plus target incentive), never base salary alone: ${name}`, async () => {
      const description = ["Customer Success Manager — Global Trade.", statement, "Work from anywhere: up to 8 weeks a year you can work from anywhere.", "Own renewals and adoption."].join("\n\n");
      const { opportunity } = await read({ id: "4479301564", location: "United States", description });
      expect(opportunity).toMatchObject({ salaryMin: 106_400, salaryMax: 197_600, currency: "USD", compensationBasis: "OTE" });
      // Eight weeks a year from anywhere is a benefit: no arrangement.
      expect(opportunity).toMatchObject({ remoteStatus: null, workArrangements: [] });
      // Shown in the employer's own terms, with what it is made of; never
      // relabelled OTE (final pre-live corrections, November 8, 2026).
      expect(formatCompensationRange(106_400, 197_600, "USD", "OTE", opportunity.salaryText as string)).toBe("$106,400–$197,600 USD (Target total cash: base + incentives)");
    });
  }

  it("a base salary statement stays base salary, also with a bonus mentioned", async () => {
    for (const statement of ["The base salary range for this role is $90,000 - $110,000 USD.", "The base salary range for this role is $90,000 - $110,000 USD, plus an annual bonus."]) {
      const { opportunity } = await read({ id: "4400000003", location: "United States", description: `${statement}\n\nOwn renewals.` });
      expect(opportunity.compensationBasis, statement).toBe("BASE");
    }
  });
});

describe("a job waiting in the batch says why", () => {
  const row = (overrides: Partial<PageCaptureRowView>): PageCaptureRowView => ({
    id: "i", site: "linkedin", siteName: "LinkedIn", title: "CSM", company: null, location: null, postedText: null, sourceUrl: "https://www.linkedin.com/jobs/view/1",
    firstSeenAt: readAt.toISOString(), status: "QUEUED", lastReason: null, resolvedOpportunityId: null, opportunityTitle: null, triageOutcome: null,
    triageManualDecision: null, evaluationStatus: null, recommendation: null, handoffOutcome: null, ...overrides,
  });
  it("behind a site stop or a worker without a browser, not just \"Getting details\"", () => {
    expect(statusText(row({}))).toBe("Getting details");
    expect(statusText(row({ lastReason: "RATE_LIMITED" }))).toBe("Waiting: The site asked us to slow down; it will not be contacted again for at least a day");
    expect(statusText(row({ lastReason: "NO_BROWSER" }))).toMatch(/^Waiting: No browser is configured .* read automatically once it is$/);
    expect(statusText(row({ lastReason: "DB_PENDING" }))).toBe("Getting details");
    expect(statusText(row({ lastReason: "REFRESH:1" }))).toBe("Reading again to update");
  });
});

// ------------------------------------------------ the real November 7 texts

interface Listing { sourceUrl: string; externalId: string; title: string; company: string; location: string; employmentType: string | null; postingDate: string | null; capturedAt: string; seniority: string[] | null; description: string }
const nov7 = JSON.parse(readFileSync("tests/fixtures/real-captures/mode-b-e5-linkedin-nov7.json", "utf8")) as { listings: Record<string, Listing> };
async function replay(name: string) {
  const listing = nov7.listings[name]!;
  const at = new Date(listing.capturedAt);
  const envelope = {
    schemaVersion: 1, pageUrl: listing.sourceUrl, extractor: "site:linkedin", capturedAt: at.toISOString(), extensionVersion: "0.2.0", readerRevision: 1,
    notes: [], pageTitle: null, pageText: null,
    fields: { title: listing.title, company: listing.company, location: listing.location, description: listing.description, employmentType: listing.employmentType, postedAt: listing.postingDate, seniority: listing.seniority?.[0] ?? null, siteJobId: listing.externalId.split(":")[1] },
  };
  const { raw } = capturedListing(parseCapture(envelope), { pairingId: "p1", domain: "customer-success", receivedAt: at, method: "batch" });
  const { opportunity, provenance } = await normalizer.normalize(raw);
  return { raw, opportunity: opportunity as Record<string, unknown>, provenance: provenance as Array<{ fieldName: string; sourceField: string; sourceText?: string | null }> };
}

describe("the November 7 LinkedIn jobs, on their real stored text (E5)", () => {
  it("TENEX.AI: Hybrid, with remote availability only by exception; no office days, residency or salary invented", async () => {
    const { opportunity, provenance, raw } = await replay("tenex");
    expect(opportunity).toMatchObject({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"], residencyRequirement: null, residencyExclusions: [], salaryMin: null, timeZoneRequirements: null });
    const exception = provenance.find((row) => row.fieldName === "remoteStatus" && row.sourceField.endsWith(":remote-by-exception"));
    expect(exception?.sourceText).toContain("we offer the flexibility of fully remote work");
    expect(provenance.find((row) => row.fieldName === "remoteStatus" && row.sourceField.endsWith(":explicit-office-first-statement"))?.sourceText).toMatch(/in-person work|relocate and commute/);
    expect(formatArrangementWithExceptions(opportunity as never, provenance)).toBe("Hybrid, with remote availability only by exception");
    expect(raw.applicationUrl).toBe("https://www.linkedin.com/jobs/view/4372638963");
  });

  it("Nearmap: Remote within the continental United States (U.S. residence excluding Alaska and Hawaii); Lehi, UT kept; the overseas-work benefit adds nothing", async () => {
    const { opportunity } = await replay("nearmap");
    expect(opportunity).toMatchObject({ remoteStatus: "REMOTE", workArrangements: ["REMOTE"], residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], residencyExclusions: ["US-AK", "US-HI"], location: "Lehi, UT" });
  });

  it("Thomson Reuters: $106,400–$197,600 USD target total cash (base pay plus any target sales incentive), closing 12/31/2026; work from anywhere 8 weeks a year is no arrangement", async () => {
    const { opportunity } = await replay("thomson-reuters");
    expect(opportunity).toMatchObject({ salaryMin: 106_400, salaryMax: 197_600, currency: "USD", compensationBasis: "OTE", remoteStatus: null, workArrangements: [] });
    expect((opportunity.closingDate as Date).toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("the office-first rule reads only what the posting states", () => {
  const office = "This role is perfect for those eager to relocate and commute here.";
  const exception = "For exceptional candidates who prefer not to relocate, we offer fully remote work.";
  it("an office-first posting without an exception, or an exception without an office expectation, infers nothing", async () => {
    for (const description of [`${office}\n\nOwn renewals.`, `${exception}\n\nOwn renewals.`]) {
      const { opportunity } = await read({ id: "4400000010", location: "Sarasota, FL", description });
      expect(opportunity.remoteStatus, description).toBeNull();
    }
  });
  it("an explicit on-site statement is kept; a remote role that mentions \"exceptional customer experiences\" stays Remote", async () => {
    const onsite = await read({ id: "4400000011", location: "Sarasota, FL", description: `This is an on-site role in Sarasota.\n\n${office}\n\n${exception}` });
    expect(onsite.opportunity.remoteStatus).toBe("ONSITE");
    const remote = await read({ id: "4400000012", location: "United States", description: "This role is fully remote.\n\nDeliver exceptional customer experiences across your portfolio." });
    expect(remote.opportunity.remoteStatus).toBe("REMOTE");
    expect(remote.provenance.some((row) => row.sourceField.endsWith(":remote-by-exception"))).toBe(false);
  });
});
