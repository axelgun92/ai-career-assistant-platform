// Every implemented source adapter against the shared normalization contract
// (Feature 14B correction, October 25, 2026). Each adapter's committed
// fixture (synthetic for the unverified LinkedIn and Adzuna adapters) is
// collected and every listing followed through the shared retrieved
// normalizer: what the source states survives, in its own currency, with its
// compensation basis, application link basis and identifiers; nothing absent
// is invented; and no listing's content hash changed. Nothing reaches the
// network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applicationUrlBasisOf, applicationUrlProvenance, type FieldProvenanceInput, type NormalizedOpportunity, type RawOpportunity } from "@ai-career/core";
import { listingUrlKey } from "@ai-career/deduplication";
import { buildRetrievedListing, defaultAdapterRegistry, type CollectContext } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer, parseCompensation } from "@ai-career/normalization";
import { collectFixture, fixtureAdapterKeys, type FixtureAdapterKey } from "../support/adapter-fixture-harness";

const normalizer = createRetrievedOpportunityNormalizer();
type Normalized = { raw: RawOpportunity; opportunity: NormalizedOpportunity; provenance: FieldProvenanceInput[] };
const cache = new Map<FixtureAdapterKey, Normalized[]>();
async function normalized(key: FixtureAdapterKey): Promise<Normalized[]> {
  if (!cache.has(key)) {
    const listings = await collectFixture(key);
    cache.set(key, await Promise.all(listings.map(async (raw) => ({ raw, ...(await normalizer.normalize(raw)) }))));
  }
  return cache.get(key)!;
}
const find = async (key: FixtureAdapterKey, externalId: string) => (await normalized(key)).find((item) => item.raw.externalId === externalId)!;
const markers = (item: Normalized, field: string) => item.provenance.filter((row) => row.fieldName === field).map((row) => row.sourceField);
const structuredOf = (raw: RawOpportunity) => (raw.sourceMetadata?.structured ?? {}) as Record<string, unknown>;

describe("every implemented adapter: the invariants of the shared contract", () => {
  it.each(fixtureAdapterKeys)("%s", async (key) => {
    const items = await normalized(key);
    expect(items.length).toBeGreaterThan(0);
    for (const { raw, opportunity, provenance } of items) {
      const label = `${key}:${raw.externalId}`;
      // Identity and links are carried, never rewritten.
      expect(opportunity.externalListingId, label).toBe(raw.externalId);
      // A requisition ID the posting labels as one fills a missing source
      // value (October 26, 2026); a source value is never rewritten.
      const labelledRequisition = provenance.find((row) => row.fieldName === "atsRequisitionId" && row.sourceField.endsWith(":labelled-requisition-id"));
      expect(opportunity.atsRequisitionId, label).toBe(raw.requisitionId ?? (labelledRequisition ? labelledRequisition.normalizedValue : null));
      expect(opportunity.canonicalUrl, label).toBe(raw.sourceUrl);
      expect(opportunity.jobDescription, label).toBe(raw.description);
      if (raw.postingDate) expect(opportunity.postingDate?.toISOString(), label).toBe(new Date(raw.postingDate).toISOString());

      // Structured annual pay is stored as stated: the same numbers, in the
      // source's own currency; nothing is converted.
      const structured = structuredOf(raw);
      if (structured.salaryPeriod === "YEAR" && structured.salaryCurrency && (structured.salaryMin !== null || structured.salaryMax !== null)) {
        expect([opportunity.salaryMin, opportunity.salaryMax, opportunity.currency], label).toEqual([structured.salaryMin, structured.salaryMax, structured.salaryCurrency]);
        expect(markers({ raw, opportunity, provenance }, "currency"), label).toEqual(["source.salaryCurrency"]);
      }
      // Pay stated per hour, day, week or month is never stored as salary.
      if (structured.salaryPeriod && structured.salaryPeriod !== "YEAR") expect([opportunity.salaryMin, opportunity.salaryMax], label).toEqual([null, null]);
      // A currency read from a bare "$" is marked as derived.
      if (opportunity.currency && opportunity.salaryText && !structured.salaryCurrency && parseCompensation(opportunity.salaryText).currency === null) {
        expect(markers({ raw, opportunity, provenance }, "currency"), label).toEqual(["compensationText:bare-dollar-as-usd"]);
      }
      // OTE bounds are kept and named.
      if (opportunity.salaryText && /\bOTE\b|on[- ]target/i.test(opportunity.salaryText) && opportunity.salaryMin !== null) {
        expect(opportunity.compensationBasis, label).toBe("OTE");
      }

      // The application link: present only with an explicit basis, distinct
      // when the source names a distinct destination, the posting page only
      // when the source says its posting page is the application page, and
      // never a job board's own listing page.
      const basis = applicationUrlBasisOf(raw.sourceMetadata);
      if (raw.applicationUrl) expect(basis, `${label} states no basis for its application URL`).not.toBeNull();
      expect(opportunity.applicationUrl, label).toBe(raw.applicationUrl);
      if (basis === "SOURCE_LISTING_PAGE") expect(opportunity.applicationUrl, label).toBeNull();
      if (basis === "SOURCE_APPLY_URL") expect(listingUrlKey(opportunity.applicationUrl), label).not.toBe(listingUrlKey(opportunity.canonicalUrl));
      if (basis === "SOURCE_POSTING_PAGE") expect(listingUrlKey(opportunity.applicationUrl), label).toBe(listingUrlKey(opportunity.canonicalUrl));
      if (opportunity.applicationUrl) expect(markers({ raw, opportunity, provenance }, "applicationUrl"), label).toEqual([applicationUrlProvenance(basis).sourceField]);
      else expect(markers({ raw, opportunity, provenance }, "applicationUrl"), label).toEqual([]);
    }
  });

  it("no adapter's content hash changed: every fixture listing hashes as it did at e6bacc6", async () => {
    const recorded = JSON.parse(readFileSync(path.resolve("tests/fixtures/sources/content-hashes-e6bacc6.json"), "utf8")).hashes as Record<string, string>;
    const now: Record<string, string> = {};
    for (const key of fixtureAdapterKeys) for (const { raw } of await normalized(key)) now[`${key}:${raw.externalId}`] = raw.retrieval!.contentHash;
    expect(Object.keys(now).sort()).toEqual(Object.keys(recorded).sort());
    expect(now).toEqual(recorded);
  });

  it("Welcome to the Jungle is registered but produces no listings (no verified listing page)", async () => {
    const adapter = defaultAdapterRegistry.get("welcome-to-the-jungle")!;
    expect(adapter.verified).toBe(false);
    await expect(adapter.collect({} as CollectContext, adapter.configSchema.parse({}))).rejects.toMatchObject({ code: "CONFIG" });
  });
});

describe("each adapter: the facts its source states survive normalization", () => {
  it("Greenhouse: a stated USD range, department, requisition, posting date and residency; its posting page hosts the application", async () => {
    const ai = await find("greenhouse", "8716179002");
    expect(ai.opportunity).toMatchObject({
      salaryMin: 203200, salaryMax: 345600, currency: "USD", compensationBasis: null, department: "AI", atsRequisitionId: "6821",
      companyName: "GitLab", remoteStatus: "REMOTE", applicationUrl: "https://job-boards.greenhouse.io/gitlab/jobs/8716179002",
    });
    expect(markers(ai, "currency")).toEqual(["rawText:explicit-compensation-statement"]);
    expect(markers(ai, "department")).toEqual(["source.department"]);
    expect(markers(ai, "applicationUrl")).toEqual(["source.postingPageIsApplication"]);
    const architect = await find("greenhouse", "8877426002");
    expect(architect.opportunity).toMatchObject({ residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], postingDate: new Date("2026-10-16T19:58:24.000Z"), closingDate: null });
  });

  it("Lever: a distinct /apply destination, workplace type, department; a bare-$ range in Washington, D.C. is USD, marked derived", async () => {
    const defense = await find("lever", "1345438c-ebfc-4fa5-b545-30c1414f317c");
    expect(defense.opportunity).toMatchObject({ salaryMin: 135000, salaryMax: 200000, currency: "USD", remoteStatus: "ONSITE", employmentType: "FULL_TIME", department: "Dev" });
    expect(defense.opportunity.applicationUrl).toBe(`${defense.opportunity.canonicalUrl}/apply`);
    expect(markers(defense, "applicationUrl")).toEqual(["source.applyUrl"]);
    expect(markers(defense, "currency")).toEqual(["compensationText:bare-dollar-as-usd"]);
  });

  it("Ashby: structured AUD stays AUD (never converted), with a distinct application page", async () => {
    const support = await find("ashby", "55078a90-f1f0-4190-9d2a-c14d1cbc5486");
    expect(support.opportunity).toMatchObject({ salaryMin: 89000, salaryMax: 105000, currency: "AUD", department: "Customer Success", remoteStatus: "REMOTE" });
    expect(support.opportunity.applicationUrl).toBe(`${support.opportunity.canonicalUrl}/application`);
  });

  it("SmartRecruiters: a stated base range keeps its numbers and basis; \"Sunnyvale, CA, United States\" makes a bare $ USD, marked derived", async () => {
    const bosch = await find("smartrecruiters", "744000156080369");
    expect(bosch.opportunity).toMatchObject({
      salaryMin: 185000, salaryMax: 205000, compensationBasis: "BASE", currency: "USD", location: "Sunnyvale, CA, United States",
      seniority: "SENIOR", atsRequisitionId: "REF286758X", remoteStatus: "HYBRID", employmentType: "FULL_TIME",
    });
    expect(markers(bosch, "currency")).toEqual(["compensationText:bare-dollar-as-usd"]);
    expect(markers(bosch, "applicationUrl")).toEqual(["source.applyUrl"]);
  });

  it("Remote OK: its apply_url repeats its own listing page, so no application URL is stored", async () => {
    for (const item of await normalized("remote-ok")) {
      expect(applicationUrlBasisOf(item.raw.sourceMetadata)).toBe("SOURCE_LISTING_PAGE");
      expect(item.opportunity.applicationUrl).toBeNull();
    }
    expect((await find("remote-ok", "1137529")).opportunity).toMatchObject({ location: "Remote", remoteStatus: "REMOTE" });
  });

  it("We Work Remotely: an OTE range keeps its numbers (USD by \"USA Only\"); hourly pay is not salary; no application URL", async () => {
    const fixd = await find("we-work-remotely", "https://weworkremotely.com/remote-jobs/fixd-automotive-client-success-manager-enterprise-accounts");
    expect(fixd.opportunity).toMatchObject({ salaryMin: 80000, salaryMax: 100000, currency: "USD", compensationBasis: "OTE", employmentType: "FULL_TIME", applicationUrl: null });
    expect(markers(fixd, "compensationBasis")).toEqual(["rawText:explicit-compensation-statement"]);
    const hourly = await find("we-work-remotely", "https://weworkremotely.com/remote-jobs/new-law-business-model-solutions-engineer-customer-success");
    expect(hourly.opportunity).toMatchObject({ salaryMin: null, salaryMax: null });
    expect(hourly.opportunity.salaryText).toContain("$40.87");
  });

  it("Himalayas: structured EUR stays EUR; monthly and hourly pay are not salary; seniority as stated; listing pages are not application URLs", async () => {
    const coo = await find("himalayas", "https://himalayas.app/companies/ewor-gmbh/jobs/ai-co-founder-coo-100-remote-m-f-d-270749859");
    expect(coo.opportunity).toMatchObject({ salaryMin: 500000, salaryMax: 500000, currency: "EUR", seniority: "EXECUTIVE", employmentType: "FULL_TIME", applicationUrl: null });
    const monthly = await find("himalayas", "https://himalayas.app/companies/fyul/jobs/senior-cybersecurity-engineer-infrastructure");
    expect(monthly.opportunity).toMatchObject({ salaryMin: null, salaryMax: null, currency: null, seniority: "SENIOR" });
    for (const item of await normalized("himalayas")) expect(applicationUrlBasisOf(item.raw.sourceMetadata)).toBe("SOURCE_LISTING_PAGE");
  });

  it("Working Nomads: its link is its own listing page, so no application URL is stored", async () => {
    for (const item of await normalized("working-nomads")) {
      expect(item.opportunity).toMatchObject({ applicationUrl: null });
      expect(item.opportunity.canonicalUrl).toMatch(/^https:\/\/www\.workingnomads\.com\/job\/go\/\d+\/$/);
    }
  });

  it("Workday: the requisition and the posting page, which is where its application starts", async () => {
    const [director] = await normalized("workday");
    expect(director!.opportunity).toMatchObject({ atsRequisitionId: "JR-0110682", remoteStatus: null });
    expect(director!.opportunity.applicationUrl).toBe(director!.opportunity.canonicalUrl);
    expect(markers(director!, "applicationUrl")).toEqual(["source.postingPageIsApplication"]);
  });

  it("Workable: department and workplace type as stated; a jobs.workable.com listing page is not an application URL", async () => {
    const trackier = await find("workable", "1671f9c9-4f39-44b7-b44a-5889b15bfafd");
    expect(trackier.opportunity).toMatchObject({ department: "Customer Success", remoteStatus: "ONSITE", employmentType: "FULL_TIME", applicationUrl: null });
    expect(trackier.opportunity.canonicalUrl).toMatch(/^https:\/\/jobs\.workable\.com\/view\//);
  });

  it("Wellfound: candidates apply on the job page; a compensation text without a stated period keeps its words but no amounts", async () => {
    const head = await find("wellfound", "4829861");
    expect(head.opportunity).toMatchObject({ salaryText: "$155k – $190k", salaryMin: null, salaryMax: null, employmentType: "FULL_TIME" });
    expect(markers(head, "salaryText")).toEqual(["source.compensation"]);
    expect(head.opportunity.applicationUrl).toBe(head.opportunity.canonicalUrl);
    expect(markers(head, "applicationUrl")).toEqual(["source.postingPageIsApplication"]);
    expect((await find("wellfound", "1716423")).opportunity).toMatchObject({ salaryText: "₹30,000 – ₹50,000", currency: null, remoteStatus: "ONSITE" });
  });

  it("LinkedIn (unverified): the employer's apply link stays distinct, and a \"$90,000/yr - $110,000/yr\" range keeps its numbers", async () => {
    const applyco = await find("linkedin", "4100000001");
    expect(applyco.opportunity).toMatchObject({ applicationUrl: "https://boards.greenhouse.io/applyco/jobs/77", salaryMin: 90000, salaryMax: 110000, currency: "USD", employmentType: "FULL_TIME" });
    expect(markers(applyco, "applicationUrl")).toEqual(["source.applyUrl"]);
    expect(markers(applyco, "currency")).toEqual(["compensationText:bare-dollar-as-usd"]);
    // Easy Apply: no external link is stated, so none is stored.
    expect((await find("linkedin", "4100000002")).opportunity).toMatchObject({ applicationUrl: null, remoteStatus: "REMOTE" });
  });

  it("Adzuna (unverified): a stated GBP salary stays GBP, a predicted one is never taken, and its redirect is not an application URL", async () => {
    expect((await find("adzuna", "5001")).opportunity).toMatchObject({ salaryMin: 45000, salaryMax: 55000, currency: "GBP", employmentType: "FULL_TIME", applicationUrl: null });
    expect((await find("adzuna", "5002")).opportunity).toMatchObject({ salaryMin: null, salaryMax: null, currency: null });
  });
});

describe("the changed application-URL behavior, by basis", () => {
  const board = { key: "test-board", name: "Test Board", attribution: null, sourceType: "API", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "JOB_BOARD" } as const;
  const input = { externalId: "1", title: "Customer Success Manager", company: "Boardco", location: null, description: "Own renewals.", sourceUrl: "https://board.example.test/1", applicationUrl: "https://board.example.test/1", sourceItem: {} };
  const context = { domain: "customer-success", discoveredAt: new Date("2026-10-25T00:00:00Z") };
  it("a listing page is hashed as before but stored as no application URL", () => {
    const listing = buildRetrievedListing(board, { ...input, sourceFacts: { applicationUrlBasis: "SOURCE_LISTING_PAGE" } }, context);
    const before = buildRetrievedListing(board, input, context);
    expect(listing.applicationUrl).toBeNull();
    expect(listing.retrieval!.contentHash).toBe(before.retrieval!.contentHash);
  });
});

describe("the LinkedIn salary format reaches the shared parser", () => {
  it.each([
    ["$90,000/yr - $110,000/yr", 90000, 110000],
    ["$90,000.00/yr - $110,000.00/yr", 90000, 110000],
    ["$90,000 per year - $110,000 per year", 90000, 110000],
  ] as const)("%s", (text, minimum, maximum) => {
    expect(parseCompensation(text, null, { location: "Denver, CO" })).toMatchObject({ minimum, maximum, currency: "USD" });
  });
  it("still refuses non-annual pay and keeps European thousands", () => {
    expect(parseCompensation("$6,000.00/mo - $7,000.00/mo", null, { location: "Denver, CO" })).toMatchObject({ minimum: null, maximum: null, amountsUnknownReason: "NON_ANNUAL_PERIOD" });
    expect(parseCompensation("€58.000 – €68.000")).toMatchObject({ minimum: 58000, maximum: 68000, currency: "EUR" });
  });
});
