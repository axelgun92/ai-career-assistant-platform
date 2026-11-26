// How a closing date already saved from LinkedIn's validThrough (Kerv and
// Staffr on the acceptance database, November 9, 2026) is corrected, on the
// test database: absence never clears a saved fact, so the corrected reader
// simply no longer supplying the date would leave it. Instead, the next read
// of the same listing (a Single Capture, or a Mode B refresh the existing
// rules select) retracts a closing date that the listing's own structured
// expiry supplied, with a provenance row saying why and keeping the retracted
// value as its text. Nothing else is cleared: a deadline from the posting's
// words, from another site or from another listing stays. No network,
// evaluator or profile; no request is made for an evaluation.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import { createRetrievalIngestionService, extensionCaptureSchema, extensionCaptureSchemaVersion, pageReaderRevision, type RawOpportunity } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { listingExpiryRetractionSourceField, PrismaExtensionLookupRepository, PrismaManualOpportunityRepository } from "@ai-career/database";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { JSDOM } from "jsdom";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing, createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { readJobPage } from "../../apps/web/src/server/page-capture-acquisition";
import fixture from "../fixtures/real-captures/linkedin-nov9-q4-descriptions.json";
import { createCleanup, database } from "../support/budget-integration";

const cleanup = createCleanup();
const run = randomUUID().slice(0, 8);
const clock = { now: new Date("2026-11-10T09:00:00.000Z") };
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() });
const service = createExtensionCaptureService({
  ingestion,
  lookup: new PrismaExtensionLookupRepository(),
  latestEvaluation: async () => null,
  discovery: customerSuccessDiscoveryConfiguration,
  now: () => clock.now,
});
let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };

const kervText = (extra: string[] = []) =>
  [
    "We are a hybrid working company and this role will require to attend Richmond (TW9) based office twice a week depending on business needs.",
    "Own onboarding and adoption for a portfolio of enterprise customers.",
    "Comfortable working within a hybrid model that balances office-based and remote work.",
    `Reference ${run}.`,
    ...extra,
  ].join("\n\n");
const expiry = "2026-11-22T20:10:32.000Z";

function envelope(pageUrl: string, description: string, extractor: string, fields: Record<string, unknown> = {}) {
  clock.now = new Date(clock.now.getTime() + 60_000);
  return {
    schemaVersion: extensionCaptureSchemaVersion,
    pageUrl,
    extractor,
    capturedAt: clock.now.toISOString(),
    extensionVersion: "0.3.0",
    readerRevision: pageReaderRevision,
    fields: { title: "Customer Success Manager – 12-Month FTC", company: `Kerv ${run}`, location: "Greater London, United Kingdom", employmentType: "Contract", description, ...fields },
    editedFields: [],
  };
}
async function capture(pageUrl: string, description: string, extractor = "structured-data", fields: Record<string, unknown> = {}) {
  const { result } = await service.capture(envelope(pageUrl, description, extractor, fields) as never, pairing);
  if (!cleanup.opportunityIds.includes(result.opportunityId)) cleanup.opportunityIds.push(result.opportunityId);
  return result;
}
// A record as the reader before November 10 saved it: the escaped markup as
// literal tags and LinkedIn's validThrough as the source's closing date.
async function savedBeforeTheFix(pageUrl: string): Promise<string> {
  const tagged = `<p>${kervText().split("\n\n").join("</p><p>")}</p>`;
  const built = envelope(pageUrl, tagged, "structured-data", { closingDate: expiry, postedAt: "2026-10-23T20:10:32.000Z" });
  const { raw } = capturedListing(extensionCaptureSchema.parse(built), { pairingId: pairing.id, domain: customerSuccessDiscoveryConfiguration.domain, receivedAt: clock.now, method: "single" });
  const old: RawOpportunity = {
    ...raw,
    sourceMetadata: { ...raw.sourceMetadata, sourceFacts: { ...(raw.sourceMetadata?.sourceFacts as object), closingDate: expiry }, capture: { ...(raw.sourceMetadata?.capture as object), readerRevision: 1 } },
    retrieval: { ...raw.retrieval!, contentHash: "0".repeat(64) },
  };
  const result = await ingestion.ingest(old);
  cleanup.opportunityIds.push(result.opportunityId);
  return result.opportunityId;
}
const linkedInUrl = () => `https://www.linkedin.com/jobs/view/${randomInt(4_100_000_000, 4_199_999_999)}/`;
const closingProvenance = (opportunityId: string) =>
  database.fieldProvenance.findMany({ where: { opportunityId, fieldName: "closingDate" }, orderBy: { createdAt: "asc" }, select: { sourceField: true, sourceText: true, normalizedValue: true, supersededAt: true } });
const opportunity = (id: string) => database.opportunity.findUniqueOrThrow({ where: { id }, select: { closingDate: true, remoteStatus: true, jobDescription: true } });

beforeEach(async () => {
  await cleanup.before();
  pairing = await database.extensionPairing.create({ data: { label: "Nov 9 closing date", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const ids = [...cleanup.opportunityIds];
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: ids }, laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.duplicateReference.deleteMany({ where: { OR: [{ opportunityId: { in: ids } }, { relatedOpportunityId: { in: ids } }] } });
  await cleanup.after();
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
});

afterAll(() => database.$disconnect());

describe("a LinkedIn closing date saved from validThrough", () => {
  it("is retracted by the next Single Capture of the same listing, which also cleans the description and reads Hybrid; same job, one new version, history kept, idempotent", async () => {
    const pageUrl = linkedInUrl();
    const id = await savedBeforeTheFix(pageUrl);
    expect(await opportunity(id)).toMatchObject({ closingDate: new Date(expiry) });
    expect((await closingProvenance(id)).map((row) => row.sourceField)).toEqual(["source.closingDate"]);

    const reread = await capture(pageUrl, kervText());
    expect(reread).toMatchObject({ outcome: "CHANGED", opportunityId: id });
    const after = await opportunity(id);
    expect(after.closingDate).toBeNull();
    expect(after.remoteStatus).toBe("HYBRID");
    expect(after.jobDescription).not.toMatch(/<\/?p>/);
    expect(await closingProvenance(id)).toEqual([
      expect.objectContaining({ sourceField: "source.closingDate", supersededAt: expect.any(Date) }),
      { sourceField: listingExpiryRetractionSourceField, sourceText: expiry, normalizedValue: null, supersededAt: null },
    ]);
    const listing = { externalId: { endsWith: pageUrl.match(/(\d+)\/$/)![1]! } };
    expect(await database.sourceRecord.count({ where: listing })).toBe(2);
    expect(await database.opportunity.count({ where: { id } })).toBe(1);

    // The same read again: unchanged, nothing written, nothing retracted twice.
    expect(await capture(pageUrl, kervText())).toMatchObject({ outcome: "UNCHANGED", opportunityId: id });
    expect(await closingProvenance(id)).toHaveLength(2);
    expect(await database.sourceRecord.count({ where: listing })).toBe(2);
  });

  it("is retracted the same way by a read through LinkedIn's job page (the Mode B reader), which never had a validThrough", async () => {
    const pageUrl = linkedInUrl();
    const id = await savedBeforeTheFix(pageUrl);
    expect(await capture(pageUrl, kervText(), "site:linkedin")).toMatchObject({ outcome: "CHANGED", opportunityId: id });
    expect((await opportunity(id)).closingDate).toBeNull();
    expect((await closingProvenance(id)).at(-1)).toMatchObject({ sourceField: listingExpiryRetractionSourceField, supersededAt: null });
  });

  it("is replaced by a deadline the posting states in its own words", async () => {
    const pageUrl = linkedInUrl();
    const id = await savedBeforeTheFix(pageUrl);
    await capture(pageUrl, kervText(["Applications close on 5 December 2026."]));
    expect((await opportunity(id)).closingDate?.toISOString()).toBe("2026-12-05T00:00:00.000Z");
    expect((await closingProvenance(id)).filter((row) => !row.supersededAt)).toEqual([expect.objectContaining({ sourceField: "rawText:explicit-closing-date-statement" })]);
  });

  it("never clears anything else: a LinkedIn deadline from the posting's words, or another site's structured closing date, stays when a read omits it", async () => {
    const linkedIn = linkedInUrl();
    const stated = await capture(linkedIn, kervText(["Applications close on 5 December 2026."]), "site:linkedin");
    await capture(linkedIn, kervText(["A later read without the sentence."]), "site:linkedin");
    expect((await opportunity(stated.opportunityId)).closingDate?.toISOString()).toBe("2026-12-05T00:00:00.000Z");

    const careers = `https://careers.kerv-${run}.example/jobs/csm`;
    const other = await capture(careers, kervText(), "structured-data", { closingDate: "2026-11-30" });
    expect((await opportunity(other.opportunityId)).closingDate?.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    await capture(careers, kervText(["A later read without the date."]), "structured-data");
    expect((await opportunity(other.opportunityId)).closingDate?.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect((await closingProvenance(other.opportunityId)).filter((row) => !row.supersededAt)).toEqual([expect.objectContaining({ sourceField: "source.closingDate" })]);
  });
});

// ------------------------------------- Kerv and Staffr, as Q1–Q4 stored them

type StoredListing = { externalId: string; rawPostingDate: string; sourceClosingDate: string; location: string; description: string };
const stored = fixture.listings as unknown as Record<"kerv" | "staffr", StoredListing>;
// The record as November 9 saved it: the stored literal-HTML description, the
// stored location, and LinkedIn's datePosted and validThrough as the source's
// posting and closing dates (Q1), giving Q2's provenance.
async function savedOnNovember9(listing: StoredListing, url: string, company: string): Promise<string> {
  const built = {
    schemaVersion: extensionCaptureSchemaVersion,
    pageUrl: url,
    extractor: "structured-data",
    capturedAt: clock.now.toISOString(),
    extensionVersion: "0.3.0",
    readerRevision: 1,
    fields: { title: "Customer Success Manager", company, location: listing.location, description: listing.description, postedAt: listing.rawPostingDate, closingDate: listing.sourceClosingDate },
    editedFields: [],
  };
  const { raw } = capturedListing(extensionCaptureSchema.parse(built), { pairingId: pairing.id, domain: customerSuccessDiscoveryConfiguration.domain, receivedAt: clock.now, method: "single" });
  const old: RawOpportunity = {
    ...raw,
    sourceMetadata: { ...raw.sourceMetadata, sourceFacts: { ...(raw.sourceMetadata?.sourceFacts as object), closingDate: listing.sourceClosingDate } },
    retrieval: { ...raw.retrieval!, contentHash: "0".repeat(64) },
  };
  const result = await ingestion.ingest(old);
  cleanup.opportunityIds.push(result.opportunityId);
  return result.opportunityId;
}
// The same job read again by the corrected reader: through LinkedIn's
// structured data (its markup escaped, as LinkedIn serves it) or its job page.
function correctedRead(listing: StoredListing, url: string, company: string, structured: boolean) {
  const escaped = listing.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const [locality, country] = listing.location.split(", ");
  const jsonLd = structured
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "http://schema.org", "@type": "JobPosting", title: "Customer Success Manager", description: escaped,
        datePosted: listing.rawPostingDate, validThrough: listing.sourceClosingDate, hiringOrganization: { "@type": "Organization", name: company },
        jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: locality, addressCountry: country } },
      }).replace(/</g, "\\u003c")}</script>`
    : "";
  const html = `<!doctype html><html><head><title>Customer Success Manager | ${company} | LinkedIn</title>${jsonLd}</head><body><main>
<section class="top-card-layout"><h1 class="top-card-layout__title">Customer Success Manager</h1><a class="topcard__org-name-link" href="https://www.linkedin.com/company/x">${company}</a>
<span class="topcard__flavor topcard__flavor--bullet">${listing.location}</span><span class="posted-time-ago__text">2 weeks ago</span></section>
<section class="description"><div class="show-more-less-html__markup">${listing.description}</div></section></main></body></html>`;
  const window = new JSDOM(html, { url, runScripts: "outside-only" }).window;
  try {
    const extraction = readJobPage(window.document)!;
    clock.now = new Date(clock.now.getTime() + 60_000);
    const built = buildCaptureEnvelope({ ...extraction, pageUrl: url }, "page", { extensionVersion: "0.3.0", capturedAt: clock.now });
    if (!built.ok) throw new Error(built.problems.join("; "));
    return built.envelope;
  } finally {
    window.close();
  }
}
const facts = (id: string) =>
  database.opportunity.findUniqueOrThrow({
    where: { id },
    select: { title: true, location: true, employmentType: true, salaryMin: true, salaryMax: true, currency: true, salaryText: true, postingDate: true, closingDate: true, remoteStatus: true, jobDescription: true, companyId: true },
  });

describe("Kerv and Staffr, from their stored November 9 records", () => {
  it.each(["kerv", "staffr"] as const)("%s: Q2's provenance; the next Single Capture retracts the expiry, cleans the description and keeps every other fact; a repeat is idempotent; one job, no evaluation", async (name) => {
    const listing = stored[name];
    const url = linkedInUrl();
    const company = `${name} ${run}`;
    const id = await savedOnNovember9(listing, url, company);
    const current = (field: string) => database.fieldProvenance.findMany({ where: { opportunityId: id, fieldName: field, supersededAt: null }, select: { sourceField: true, sourceText: true } });
    // As Q2 shows them.
    expect(await current("closingDate")).toEqual([{ sourceField: "source.closingDate", sourceText: listing.sourceClosingDate }]);
    expect(await current("postingDate")).toEqual([{ sourceField: "postingDate", sourceText: listing.rawPostingDate }]);
    const before = await facts(id);
    expect(before.closingDate?.toISOString()).toBe(listing.sourceClosingDate);

    const reread = (await service.capture(correctedRead(listing, url, company, true), pairing)).result;
    expect(reread).toMatchObject({ outcome: "CHANGED", opportunityId: id });
    const after = await facts(id);
    expect(after.closingDate).toBeNull();
    expect(await current("closingDate")).toEqual([{ sourceField: listingExpiryRetractionSourceField, sourceText: listing.sourceClosingDate }]);
    expect(after.jobDescription).not.toMatch(/<\/?(?:p|br|strong|ul|li|em)\b/);
    expect(after.remoteStatus).toBe("HYBRID");
    // Every other fact as it was (the posting date stays the stated one).
    // Staffr's salary, which the literal tags hid from the earlier reading,
    // is now read from its clean text: a fact gained, none cleared.
    const salary = (row: typeof before) => ({ salaryMin: row.salaryMin === null ? null : Number(row.salaryMin), salaryMax: row.salaryMax === null ? null : Number(row.salaryMax), currency: row.currency });
    const rest = ({ closingDate: _c, jobDescription: _d, remoteStatus: _r, salaryMin: _min, salaryMax: _max, currency: _cur, salaryText: _t, ...other }: typeof before) => other;
    expect(rest(after)).toEqual(rest(before));
    if (before.salaryMin !== null) expect(salary(after)).toEqual(salary(before));
    if (name === "staffr") expect(salary(after)).toEqual({ salaryMin: 30_000, salaryMax: 40_000, currency: "GBP" });
    expect(after.postingDate?.toISOString()).toBe(listing.rawPostingDate);

    // The same read again, and the job page's read of the same posting:
    // unchanged, nothing written, no second retraction.
    expect((await service.capture(correctedRead(listing, url, company, true), pairing)).result).toMatchObject({ outcome: "UNCHANGED", opportunityId: id });
    expect((await service.capture(correctedRead(listing, url, company, false), pairing)).result).toMatchObject({ outcome: "UNCHANGED", opportunityId: id });
    expect(await database.fieldProvenance.count({ where: { opportunityId: id, fieldName: "closingDate" } })).toBe(2);
    expect(await database.sourceRecord.count({ where: { externalId: { endsWith: url.match(/(\d+)\/$/)![1]! } } })).toBe(2);
    expect(await database.opportunity.count({ where: { sourceRecords: { some: { externalId: { endsWith: url.match(/(\d+)\/$/)![1]! } } } } })).toBe(1);
    expect(await database.evaluation.count({ where: { opportunityId: id } })).toBe(0);
  });

  it("a Mode B read (LinkedIn's job page, batch) of the stored Kerv record retracts it the same way, on the same job", async () => {
    const listing = stored.kerv;
    const url = linkedInUrl();
    const company = `kerv-b ${run}`;
    const id = await savedOnNovember9(listing, url, company);
    const envelope = correctedRead(listing, url, company, false);
    const { raw } = capturedListing(extensionCaptureSchema.parse(envelope), { pairingId: pairing.id, domain: customerSuccessDiscoveryConfiguration.domain, receivedAt: clock.now, method: "batch" });
    expect(await ingestion.ingest(raw)).toMatchObject({ outcome: "CHANGED", opportunityId: id });
    expect((await facts(id)).closingDate).toBeNull();
    expect(await database.fieldProvenance.findMany({ where: { opportunityId: id, fieldName: "closingDate", supersededAt: null }, select: { sourceField: true } })).toEqual([{ sourceField: listingExpiryRetractionSourceField }]);
    expect(await database.evaluation.count({ where: { opportunityId: id } })).toBe(0);
  });
});
