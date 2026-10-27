// Shared-normalization convergence (Feature 14B correction, October 25,
// 2026; Core TDD §51, v1.15). Equivalent evidence through the automated
// Greenhouse adapter and the browser extension converges on the same
// normalized facts; a stated compensation range keeps its numbers whatever
// its basis, in its own currency; explicit team prose populates Department
// without inference; work authorization is a fact of its own, interpreted
// for the user only by a separate relevance layer; the application URL is
// captured with its basis. Synthetic data and the fixture transport only.
import { describe, expect, it } from "vitest";
import {
  applicationUrlProvenance,
  readLocationGeography,
  workAuthorizationRelevance,
  type NormalizedOpportunity,
  type RawOpportunity,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { buildRetrievedListing, createFixtureTransport, createTitleMatcher, defaultAdapterRegistry } from "@ai-career/discovery";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer, parseCompensation, readJobTextFacts } from "@ai-career/normalization";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";
import { healthieDescriptionParagraphs, healthieGreenhouseResponse, healthieJobUrl, healthiePage } from "../support/healthie-fixture";
import { jsonLdPage, runExtractor } from "../support/extension-pages";

const normalizer = createRetrievedOpportunityNormalizer();
const receivedAt = new Date("2026-10-25T09:00:00.000Z");

async function viaGreenhouseAdapter() {
  const adapter = defaultAdapterRegistry.get("greenhouse")!;
  const config = adapter.configSchema.parse({ board: "healthie" });
  const result = await adapter.collect(
    {
      transport: createFixtureTransport({ [adapter.verificationUrl(config)]: { status: 200, contentType: "application/json", body: JSON.stringify(healthieGreenhouseResponse()) } }),
      discovery: customerSuccessDiscoveryConfiguration,
      keepTitle: createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms),
      env: {},
      now: () => receivedAt,
      maxPages: 1,
      maxDetailRequests: 0,
    },
    config,
  );
  expect(result.listings).toHaveLength(1);
  return { raw: result.listings[0]!, ...(await normalizer.normalize(result.listings[0]!)) };
}

async function viaExtension(html = healthiePage(), url = healthieJobUrl) {
  const extraction = runExtractor(html, url);
  const envelope = buildCaptureEnvelope(extraction, "page", { extensionVersion: "0.1.0", capturedAt: receivedAt });
  if (!envelope.ok) throw new Error(envelope.problems.join("; "));
  const { raw } = capturedListing(parseCapture(envelope.envelope), { pairingId: "p1", domain: "customer-success", receivedAt });
  return { extraction, raw, ...(await normalizer.normalize(raw)) };
}

const provenanceOf = (rows: Array<{ fieldName: string; sourceField: string }>, field: string) => rows.filter((row) => row.fieldName === field).map((row) => row.sourceField);

const comparable = (opportunity: NormalizedOpportunity) => ({
  title: opportunity.title,
  companyName: opportunity.companyName,
  location: opportunity.location,
  remoteStatus: opportunity.remoteStatus,
  employmentType: opportunity.employmentType,
  salaryText: opportunity.salaryText,
  salaryMin: opportunity.salaryMin,
  salaryMax: opportunity.salaryMax,
  currency: opportunity.currency,
  compensationBasis: opportunity.compensationBasis,
  department: opportunity.department,
  seniority: opportunity.seniority,
  timeZoneRequirements: opportunity.timeZoneRequirements,
  closingDate: opportunity.closingDate,
  workAuthorizationRequirement: opportunity.workAuthorizationRequirement,
  workAuthorizationRegions: opportunity.workAuthorizationRegions,
  visaSponsorship: opportunity.visaSponsorship,
  residencyRequirement: opportunity.residencyRequirement,
  canonicalUrl: opportunity.canonicalUrl,
  applicationUrl: opportunity.applicationUrl,
});

describe("Healthie: the automated adapter and the browser extension converge", () => {
  it("normalizes the expected Healthie facts on both paths, with the same values", async () => {
    const automated = await viaGreenhouseAdapter();
    const captured = await viaExtension();
    const expected = {
      title: "Customer Success Manager",
      companyName: "Healthie",
      location: "NYC",
      remoteStatus: "HYBRID",
      employmentType: "FULL_TIME",
      salaryText: "The salary range is $105,000 - $155,000 per year (OTE) annually.",
      salaryMin: 105000,
      salaryMax: 155000,
      // A bare "$" with the posting's explicit U.S. work-authorization
      // requirement: unambiguous U.S. context (October 27, 2026; a city
      // alone is still not).
      currency: "USD",
      compensationBasis: "OTE",
      department: "Customer Success",
      // Legitimately Unknown: never stated.
      seniority: null,
      timeZoneRequirements: null,
      closingDate: null,
      workAuthorizationRequirement: "RIGHT_TO_WORK",
      workAuthorizationRegions: ["US"],
      visaSponsorship: null,
      // Work authorization is not residency.
      residencyRequirement: null,
      canonicalUrl: healthieJobUrl,
      // The posting page is the application page (it holds the form).
      applicationUrl: healthieJobUrl,
    };
    expect(comparable(automated.opportunity)).toEqual(expected);
    expect(comparable(captured.opportunity)).toEqual(expected);

    // The same facts, with provenance saying how each path knows them.
    expect(provenanceOf(automated.provenance, "applicationUrl")).toEqual(["source.postingPageIsApplication"]);
    expect(provenanceOf(captured.provenance, "applicationUrl")).toEqual(["page:application-form"]);
    expect(provenanceOf(automated.provenance, "department")).toEqual(["source.department"]);
    expect(provenanceOf(captured.provenance, "department")).toEqual(["rawText:explicit-team-statement"]);
    expect(provenanceOf(captured.provenance, "companyName").concat(provenanceOf(captured.provenance, "company.name"))).toEqual(["pageContext:page-title-company"]);
    for (const result of [automated, captured]) {
      expect(provenanceOf(result.provenance, "compensationBasis")).toEqual(["rawText:explicit-compensation-statement"]);
      expect(provenanceOf(result.provenance, "workAuthorizationRequirement")).toEqual(["rawText:explicit-work-authorization-statement"]);
      expect(result.provenance.find((row) => row.fieldName === "workAuthorizationRegions")).toMatchObject({ normalizedValue: ["US"], sourceText: "U.S. work authorization is required." });
      expect(result.opportunity.jobDescription).toContain(healthieDescriptionParagraphs[3]);
    }
    // Evidence only the API states (its publish date) is the one difference.
    expect(automated.opportunity.postingDate?.toISOString()).toBe("2026-10-14T14:00:00.000Z");
    expect(captured.opportunity.postingDate).toBeNull();
  });

  it("the extension finds the on-page application form, and the server (not the page) names the URL", async () => {
    const { extraction, raw } = await viaExtension(healthiePage(), `${healthieJobUrl}?gh_src=abc&utm_source=linkedin`);
    expect(extraction.application).toEqual({ url: null, basis: "PAGE_APPLICATION_FORM" });
    expect(raw.applicationUrl).toBe(raw.sourceUrl);
    expect(raw.sourceMetadata).toMatchObject({ sourceFacts: { applicationUrlBasis: "PAGE_APPLICATION_FORM" } });
  });
});

describe("compensation: stated bounds are kept, in their own currency, whatever the basis", () => {
  const unitedStates = { location: "Austin, TX" };
  it.each([
    ["$70,000–$90,000", unitedStates, 70000, 90000, "USD", null],
    ["$80,000–$100,000 base salary", unitedStates, 80000, 100000, "USD", "BASE"],
    ["$105,000–$155,000 OTE", unitedStates, 105000, 155000, "USD", "OTE"],
    ["€58,000–€68,000", {}, 58000, 68000, "EUR", null],
    ["£55,000–£65,000", {}, 55000, 65000, "GBP", null],
    ["$70,000–$90,000 USD", {}, 70000, 90000, "USD", null],
    ["$88,000–$123,200 CAD", {}, 88000, 123200, "CAD", null],
    // A bare "$" is US dollars with no other context (October 27, 2026;
    // previously Unknown without unambiguous U.S. geography).
    ["$105,000 - $155,000 per year (OTE) annually", { location: "NYC" }, 105000, 155000, "USD", "OTE"],
    // OTE wording takes precedence over a "base" mention in the same
    // statement (Feature 14B v5 correction, October 25, 2026).
    ["$100,000 - $120,000 base, OTE", unitedStates, 100000, 120000, "USD", "OTE"],
  ] as const)("%s", (text, geography, minimum, maximum, currency, basis) => {
    void geography; // (where the job is no longer matters to the currency)
    expect(parseCompensation(text)).toMatchObject({ minimum, maximum, currency, basis });
  });

  it("never converts: the original currency and amounts are what is stored", async () => {
    const raw = buildRetrievedListing(
      { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
      { externalId: "eur-1", title: "Customer Success Manager", company: "Euroco", location: "Berlin, Germany", description: "Salary: €58,000–€68,000 per year.", sourceUrl: "https://ats.example.test/eur-1", applicationUrl: null, sourceItem: {} },
      { domain: "customer-success", discoveredAt: receivedAt },
    );
    const { opportunity } = await normalizer.normalize(raw);
    expect(opportunity).toMatchObject({ salaryMin: 58000, salaryMax: 68000, currency: "EUR", compensationBasis: null });
  });

  it("records a bare-dollar USD as derived, not stated", async () => {
    const raw = buildRetrievedListing(
      { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
      { externalId: "usd-1", title: "Customer Success Manager", company: "Usco", location: "Denver, CO", description: "The OTE for this role is $150,000 - $180,000 per year.", sourceUrl: "https://ats.example.test/usd-1", applicationUrl: null, sourceItem: {} },
      { domain: "customer-success", discoveredAt: receivedAt },
    );
    const { opportunity, provenance } = await normalizer.normalize(raw);
    expect(opportunity).toMatchObject({ salaryMin: 150000, salaryMax: 180000, currency: "USD", compensationBasis: "OTE" });
    expect(provenance.find((row) => row.fieldName === "currency")?.sourceField).toBe("compensationText:bare-dollar-as-usd");
  });

  it("manual entry follows the same rule", async () => {
    const raw: RawOpportunity = {
      source: "manual-input", sourceType: "MANUAL", sourceUrl: null, applicationUrl: null, domain: "customer-success", externalId: null, requisitionId: null,
      title: "Customer Success Manager", company: "Manualco", location: "Chicago, IL", description: "Compensation: $105,000–$155,000 OTE.",
      salaryText: null, employmentType: null, postingDate: null, sourceMetadata: null, rawPayload: null, discoveredAt: receivedAt,
    } as RawOpportunity;
    const { opportunity } = await createManualOpportunityNormalizer().normalize(raw);
    expect(opportunity).toMatchObject({ salaryMin: 105000, salaryMax: 155000, compensationBasis: "OTE", currency: "USD" });
  });
});

describe("compensation basis: OTE takes precedence over base in the same statement", () => {
  it.each([
    ["$120,000–$150,000 OTE (base + commission)", 120000, 150000, "OTE"],
    ["OTE: $120,000–$150,000; 60/40 base to variable", 120000, 150000, "OTE"],
    ["On-target earnings of $130,000 - $160,000, base plus uncapped commission", 130000, 160000, "OTE"],
    ["Base salary $80,000–$100,000", 80000, 100000, "BASE"],
    ["Base salary $80,000–$100,000 plus commission", 80000, 100000, "BASE"],
    ["$80,000–$100,000", 80000, 100000, null],
  ] as const)("%s", (text, minimum, maximum, basis) => {
    expect(parseCompensation(text)).toMatchObject({ minimum, maximum, basis, currency: "USD", amountsUnknownReason: null });
  });

  it("separate or conflicting figures keep the existing ambiguity: amounts and basis Unknown", () => {
    for (const text of [
      "Base salary $80,000 - $100,000 plus commission; OTE $140,000",
      "Base $100,000 - $120,000, OTE $160,000 - $180,000",
      "$72k-$88k base + $10k bonus, OTE",
    ]) {
      expect(parseCompensation(text), text).toMatchObject({ minimum: null, maximum: null, basis: null, amountsUnknownReason: "AMBIGUOUS_AMOUNTS" });
    }
  });
});

describe("compensation basis: the job description may say a source-stated range is OTE", () => {
  const source = { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" } as const;
  const structured = { salaryMin: 120000, salaryMax: 150000, salaryCurrency: "USD", salaryPeriod: "YEAR" } as const;
  const listing = (description: string, extra: { structured?: object; salaryText?: string; pageText?: string } = {}) =>
    buildRetrievedListing(
      source,
      {
        externalId: `s-${description.length}-${extra.salaryText ?? ""}`, title: "Customer Success Manager", company: "Rangeco", location: "Denver, CO",
        description, sourceUrl: "https://ats.example.test/range", applicationUrl: null, sourceItem: {},
        structured: "structured" in extra ? extra.structured : structured, salaryText: extra.salaryText ?? null,
        ...(extra.pageText ? { metadata: { pageText: extra.pageText } } : {}),
      } as never,
      { domain: "customer-success", discoveredAt: receivedAt },
    );
  const basisRows = (rows: Array<{ fieldName: string }>) => rows.filter((row) => row.fieldName === "compensationBasis");

  it("structured bounds without a basis become OTE when the description states that same range as OTE", async () => {
    const { opportunity, provenance } = await normalizer.normalize(listing("Customer success role. The OTE for this role is $120,000 - $150,000 per year."));
    // The numbers and currency are the source's own; only the basis is added.
    expect(opportunity).toMatchObject({ salaryMin: 120000, salaryMax: 150000, currency: "USD", compensationBasis: "OTE" });
    expect(basisRows(provenance)).toEqual([
      expect.objectContaining({ sourceField: "rawText:explicit-compensation-statement", normalizedValue: "OTE", sourceText: "The OTE for this role is $120,000 - $150,000 per year." }),
    ]);
    expect(provenance.find((row) => row.fieldName === "salaryMin")?.sourceField).toBe("source.salaryMin");
  });

  it("OTE language about anything but that same range leaves the basis Unknown", async () => {
    for (const description of [
      // No figure at all.
      "Top performers regularly exceed OTE through uncapped commission. Base salary is competitive.",
      // A different range.
      "The OTE for this role is $180,000 - $200,000.",
      // The same numbers in another currency.
      "OTE: €120,000 - €150,000 per year.",
      // Several figures in one statement: ambiguous, so it says nothing.
      "Base pay $120,000 - $150,000 with an OTE of $200,000.",
      // Only one end matches.
      "The OTE for this role is $120,000 - $160,000.",
    ]) {
      const { opportunity, provenance } = await normalizer.normalize(listing(description));
      expect(opportunity, description).toMatchObject({ salaryMin: 120000, salaryMax: 150000, currency: "USD", compensationBasis: null });
      expect(basisRows(provenance), description).toEqual([]);
    }
  });

  it("a source salary text without a basis takes OTE from the description's statement of the same range", async () => {
    const { opportunity, provenance } = await normalizer.normalize(
      listing("Compensation: OTE $120,000 - $150,000 (50/50 base and variable).", { structured: {}, salaryText: "$120,000 - $150,000" }),
    );
    expect(opportunity).toMatchObject({ salaryText: "$120,000 - $150,000", salaryMin: 120000, salaryMax: 150000, currency: "USD", compensationBasis: "OTE" });
    expect(basisRows(provenance).map((row) => row.sourceField)).toEqual(["rawText:explicit-compensation-statement"]);
  });

  it("OTE takes precedence over a base reading of that same range", async () => {
    const { opportunity, provenance } = await normalizer.normalize(
      listing("The on-target earnings for this role are $120,000 - $150,000.", { structured: {}, salaryText: "Base salary $120,000 - $150,000" }),
    );
    expect(opportunity.compensationBasis).toBe("OTE");
    expect(basisRows(provenance)).toHaveLength(1);
  });

  it("a source's own basis is kept when the description states nothing about that range", async () => {
    const { opportunity, provenance } = await normalizer.normalize(listing("A great team.", { structured, salaryText: "$120,000 - $150,000 base salary" }));
    expect(opportunity.compensationBasis).toBe("BASE");
    expect(basisRows(provenance).map((row) => row.sourceField)).toEqual(["salaryText"]);
  });

  it("page context is not the description: page-only OTE wording adds no basis", async () => {
    const { opportunity } = await normalizer.normalize(listing("A great team.", { pageText: "OTE: $120,000 - $150,000" }));
    expect(opportunity).toMatchObject({ salaryMin: 120000, compensationBasis: null });
  });

  it("manual entry: a stated salary text takes OTE from the pasted description's statement of the same range", async () => {
    const raw = {
      source: "manual-input", sourceType: "MANUAL", sourceUrl: null, applicationUrl: null, domain: "customer-success", externalId: null, requisitionId: null,
      title: "Customer Success Manager", company: "Manualco", location: "Chicago, IL", description: "This role's OTE is $120,000 - $150,000 per year.",
      salaryText: "$120,000 - $150,000", employmentType: null, postingDate: null, sourceMetadata: null, rawPayload: null, discoveredAt: receivedAt,
    } as RawOpportunity;
    const { opportunity, provenance } = await createManualOpportunityNormalizer().normalize(raw);
    expect(opportunity).toMatchObject({ salaryText: "$120,000 - $150,000", salaryMin: 120000, salaryMax: 150000, currency: "USD", compensationBasis: "OTE" });
    expect(basisRows(provenance).map((row) => (row as { sourceField: string }).sourceField)).toEqual(["rawText:explicit-compensation-statement"]);
  });
});

describe("bare \"$\" is USD wherever the job is; an explicit country still settles a place for the relevance layer", () => {
  const range = "$185,000 - $205,000 per year";
  // (October 27, 2026: the currency no longer depends on the location.)
  const currencyIn = (_location: string | null, text = range) => parseCompensation(text);
  it("1: a bare $ is USD with any location, or none", () => {
    for (const location of ["Sunnyvale, CA, United States", "Sunnyvale, CA", "Toronto, ON, Canada", "Remote", "Global", null]) {
      expect(currencyIn(location), String(location)).toMatchObject({ minimum: 185000, maximum: 205000, currency: "USD", currencyBasis: "BARE_DOLLAR_AS_USD" });
    }
  });
  it("2: an explicit country still settles an ambiguous region abbreviation (where the job is)", () => {
    expect(readLocationGeography("Sunnyvale, CA, United States")).toEqual({ codes: ["US"], ambiguous: false });
    expect(readLocationGeography("Sunnyvale, CA")).toMatchObject({ ambiguous: true });
  });
  it("3: an explicit currency stays authoritative over the symbol", () => {
    expect(currencyIn("Sunnyvale, CA, United States", "CA$185,000 - CA$205,000 per year")).toMatchObject({ currency: "CAD", currencyBasis: "STATED_CODE_OR_SYMBOL" });
    expect(currencyIn("Toronto, ON, Canada", "$88,000 - $123,200 CAD")).toMatchObject({ currency: "CAD", minimum: 88000, maximum: 123200 });
    expect(currencyIn("Sunnyvale, CA, United States", "€58,000 – €68,000")).toMatchObject({ currency: "EUR" });
  });
  it("the same reading places a job for the work-eligibility relevance layer", () => {
    const facts = {
      workAuthorizationRequirement: null, workAuthorizationRegions: [], visaSponsorship: null, relocationSupport: null,
      employerOfRecordRegions: [], residencyRegions: [],
    } as const;
    const alex = { authorizedRegions: ["US"], citizenshipRegions: ["US"] };
    expect(workAuthorizationRelevance({ ...facts, location: "Sunnyvale, CA, United States" }, alex)).toMatchObject({ status: "NOT_APPLICABLE", jobRegions: ["US"] });
    expect(workAuthorizationRelevance({ ...facts, location: "Toronto, ON, Canada" }, alex)).toMatchObject({ status: "UNKNOWN_CHECK" });
    expect(workAuthorizationRelevance({ ...facts, location: "Sunnyvale, CA" }, alex)).toMatchObject({ status: "NOT_APPLICABLE", jobRegions: [] });
  });
});

describe("department: an explicit team statement, never an inference", () => {
  const department = (text: string, company: string | null = null) => readJobTextFacts({ text, title: "Customer Success Manager", company }).department;
  it("reads the team the posting says the role joins", () => {
    expect(department("You'll join Healthie's Customer Success team and own a book of practices.")).toMatchObject({ value: "Customer Success", sourceField: "rawText:explicit-team-statement" });
    expect(department("Join our Revenue Operations team in Austin.")?.value).toBe("Revenue Operations");
    expect(department("You will be part of the Support organization.")?.value).toBe("Support");
  });
  it("never reads the title, responsibilities, descriptions or the employer as a department", () => {
    expect(department("Own onboarding, adoption and renewals for SaaS customers.")).toBeNull();
    expect(department("Join our growing team of customer advocates.")).toBeNull();
    expect(department("Join our customer success team.")).toBeNull();
    expect(department("Come join the Healthie team!", "Healthie")).toBeNull();
    expect(department("Join our Sales team. You will also join our Support team.")).toBeNull();
  });
  it("a labelled department outranks the prose", () => {
    expect(department("Department: Client Services\nYou'll join our Customer Success team.")).toMatchObject({ value: "Client Services", sourceField: "rawText:labelled-department" });
  });
});

describe("work authorization: a normalized fact for any country, never residency", () => {
  const facts = (text: string, pageText: string | null = null) => readJobTextFacts({ text, title: "Customer Success Manager", pageText });
  it("1: U.S. work-authorization requirements normalize correctly", () => {
    expect(facts("U.S. work authorization is required.").workAuthorization).toMatchObject({
      value: { requirement: "RIGHT_TO_WORK", regions: ["US"] }, sourceField: "rawText:explicit-work-authorization-statement",
    });
    expect(facts("Candidates must be legally authorized to work in the United States.").workAuthorization?.value).toEqual({ requirement: "RIGHT_TO_WORK", regions: ["US"] });
    // Not residency.
    expect(facts("U.S. work authorization is required.").location).toBeNull();
  });
  it("reads other countries, citizenship, sponsorship, relocation and employer of record", () => {
    expect(facts("You must hold the right to work in the UK.").workAuthorization?.value).toEqual({ requirement: "RIGHT_TO_WORK", regions: ["GB"] });
    expect(facts("Applicants must be a Canadian citizen.").workAuthorization?.value).toEqual({ requirement: "CITIZENSHIP", regions: ["CA"] });
    expect(facts("We are unable to sponsor visas for this role.").visaSponsorship?.value).toBe("NOT_AVAILABLE");
    expect(facts("Must be authorized to work in Germany without sponsorship.").visaSponsorship?.value).toBe("NOT_AVAILABLE");
    expect(facts("Must be authorized to work in Germany without sponsorship.").workAuthorization?.value).toEqual({ requirement: "RIGHT_TO_WORK", regions: ["DE"] });
    expect(facts("Visa sponsorship is available for this position.").visaSponsorship?.value).toBe("AVAILABLE");
    expect(facts("Relocation assistance is provided.").relocationSupport?.value).toBe("AVAILABLE");
    expect(facts("You will not need to relocate.").relocationSupport).toBeNull();
    expect(facts("We can employ you through an employer of record in Spain or Portugal.").employerOfRecord?.value).toEqual(["ES", "PT"]);
  });
  it("leaves preferred, conditional and conflicting wording Unknown", () => {
    expect(facts("U.S. work authorization is preferred.").workAuthorization).toBeNull();
    expect(facts("We may sponsor visas for exceptional candidates.").visaSponsorship).toBeNull();
    expect(facts("Must be authorized to work in the US. Must be authorized to work in Canada.").workAuthorization).toBeNull();
  });
  it("reads page context only through labels", () => {
    expect(facts("Own onboarding.", "Visa sponsorship: Not available\nWork authorization: United Kingdom").visaSponsorship).toMatchObject({ value: "NOT_AVAILABLE", sourceField: "pageContext:labelled-sponsorship" });
    expect(facts("Own onboarding.", "We are unable to sponsor visas.").visaSponsorship).toBeNull();
  });
});

describe("work authorization: personalized relevance (never normalization)", () => {
  const alex = { authorizedRegions: ["US"], citizenshipRegions: ["US"] };
  const job = (overrides: Partial<NormalizedOpportunity> = {}) => ({
    workAuthorizationRequirement: null, workAuthorizationRegions: [], visaSponsorship: null, relocationSupport: null,
    employerOfRecordRegions: [], residencyRegions: [], location: null, ...overrides,
  }) as Parameters<typeof workAuthorizationRelevance>[0];

  it("2: a profile already eligible in the U.S. gets no warning for a U.S. requirement", () => {
    expect(workAuthorizationRelevance(job({ workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"], location: "NYC" }), alex).status).toBe("SATISFIED");
    expect(workAuthorizationRelevance(job({ workAuthorizationRequirement: "CITIZENSHIP", workAuthorizationRegions: ["US"] }), alex).status).toBe("SATISFIED");
    // Sponsorship being unavailable does not matter to someone who needs none.
    expect(workAuthorizationRelevance(job({ workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"], visaSponsorship: "NOT_AVAILABLE" }), alex).status).toBe("SATISFIED");
  });
  it("3: non-U.S. requirements and sponsorship are surfaced for eligibility review", () => {
    const uk = workAuthorizationRelevance(job({ workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["GB"] }), alex);
    expect(uk).toMatchObject({ status: "REVIEW", statedFacts: ["United Kingdom work authorization required"] });
    expect(workAuthorizationRelevance(job({ workAuthorizationRequirement: "CITIZENSHIP", workAuthorizationRegions: ["CA"], visaSponsorship: "AVAILABLE" }), alex).status).toBe("REVIEW");
    expect(workAuthorizationRelevance(job({ location: "Berlin, Germany", visaSponsorship: "NOT_AVAILABLE" }), alex).status).toBe("REVIEW");
    expect(workAuthorizationRelevance(job({ location: "Berlin, Germany", visaSponsorship: "AVAILABLE" }), alex)).toMatchObject({ status: "FAVORABLE", statedFacts: ["Visa sponsorship available"] });
    expect(workAuthorizationRelevance(job({ location: "Madrid, Spain", employerOfRecordRegions: ["US"] }), alex).status).toBe("FAVORABLE");
  });
  it("4: unknown non-U.S. authorization stays Unknown and is only flagged as worth checking", () => {
    const london = job({ location: "London, United Kingdom" });
    expect(workAuthorizationRelevance(london, alex)).toMatchObject({ status: "UNKNOWN_CHECK", jobRegions: ["GB"], statedFacts: [] });
    expect(london.workAuthorizationRequirement).toBeNull();
    expect(workAuthorizationRelevance(job({ location: "Austin, TX" }), alex).status).toBe("NOT_APPLICABLE");
    expect(workAuthorizationRelevance(job({ location: "Remote" }), alex).status).toBe("NOT_APPLICABLE");
    expect(workAuthorizationRelevance(job({ location: "London, United Kingdom" }), null).status).toBe("NOT_CONFIGURED");
  });
});

describe("application URL: captured with its basis on every path", () => {
  const ats = { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" } as const;
  const board = { key: "test-board", name: "Test Board", attribution: null, sourceType: "API", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "JOB_BOARD" } as const;
  const listing = (adapter: typeof ats | typeof board, sourceUrl: string, applicationUrl: string | null, applicationUrlBasis: string | null) =>
    buildRetrievedListing(adapter, {
      externalId: sourceUrl, title: "Customer Success Manager", company: "Linkco", location: "Austin, TX", description: "Own onboarding and renewals.",
      sourceUrl, applicationUrl, sourceItem: {}, sourceFacts: { applicationUrlBasis: applicationUrlBasis as never },
    }, { domain: "customer-success", discoveredAt: receivedAt });

  it("keeps a distinct application destination distinct from the source URL", async () => {
    const { opportunity, provenance } = await normalizer.normalize(listing(ats, "https://jobs.lever.co/linkco/1", "https://jobs.lever.co/linkco/1/apply", "SOURCE_APPLY_URL"));
    expect(opportunity).toMatchObject({ canonicalUrl: "https://jobs.lever.co/linkco/1", applicationUrl: "https://jobs.lever.co/linkco/1/apply" });
    expect(provenanceOf(provenance, "applicationUrl")).toEqual(["source.applyUrl"]);
  });
  it("uses the posting page only on explicit evidence, deterministically", async () => {
    const { opportunity, provenance } = await normalizer.normalize(listing(ats, "https://boards.greenhouse.io/linkco/jobs/2", "https://boards.greenhouse.io/linkco/jobs/2", "SOURCE_POSTING_PAGE"));
    expect(opportunity.applicationUrl).toBe(opportunity.canonicalUrl);
    expect(provenanceOf(provenance, "applicationUrl")).toEqual(["source.postingPageIsApplication"]);
    // A job board's own listing page is not an application destination.
    const boardPage = await normalizer.normalize(listing(board, "https://board.example.test/3", "https://board.example.test/3", "SOURCE_LISTING_PAGE"));
    expect(boardPage.opportunity.applicationUrl).toBeNull();
    expect(provenanceOf(boardPage.provenance, "applicationUrl")).toEqual([]);
  });
  it("names every basis in provenance", () => {
    expect(applicationUrlProvenance("PAGE_APPLY_LINK")).toEqual({ sourceField: "page:apply-link", kind: "DIRECT" });
    expect(applicationUrlProvenance("STRUCTURED_DIRECT_APPLY")).toEqual({ sourceField: "structured.directApply", kind: "DETERMINISTIC" });
    expect(applicationUrlProvenance(null)).toEqual({ sourceField: "applicationUrl", kind: "DIRECT" });
  });
});

describe("extension collection: application evidence and structured dates", () => {
  const page = (body: string) => `<!doctype html><html><head><title>Customer Success Manager - Careers</title></head><body>${body}</body></html>`;
  const description = "<p>Own onboarding, adoption and renewals for a portfolio of mid-market customers across North America, with quarterly business reviews.</p>";
  it("an explicit Apply link to another address is taken; an in-page anchor or two destinations are not", () => {
    const one = runExtractor(page(`<main><h1>CSM</h1>${description}<a href="https://boards.greenhouse.io/acme/jobs/9?utm_source=x">Apply now</a></main>`), "https://careers.acme.example/jobs/9");
    expect(one.application).toEqual({ url: "https://boards.greenhouse.io/acme/jobs/9?utm_source=x", basis: "PAGE_APPLY_LINK" });
    const inPage = runExtractor(page(`<main><h1>CSM</h1>${description}<a href="#apply">Apply</a></main>`), "https://careers.acme.example/jobs/9");
    expect(inPage.application).toBeNull();
    const two = runExtractor(page(`<main><h1>CSM</h1>${description}<a href="https://a.example/apply">Apply</a><a href="https://b.example/apply">Apply</a></main>`), "https://careers.acme.example/jobs/9");
    expect(two.application).toBeNull();
    const related = runExtractor(page(`<main><h1>CSM</h1>${description}<section class="related-jobs"><a href="https://a.example/other">Apply now</a></section></main>`), "https://careers.acme.example/jobs/9");
    expect(related.application).toBeNull();
  });
  it("a search, sign-in or newsletter form is not an application form", () => {
    const forms = `<form><input name="q"><button>Search</button></form><form><input name="email" type="email"><button>Subscribe</button></form><form><input name="username"><input type="password"><button>Sign in</button></form>`;
    expect(runExtractor(page(`<main><h1>CSM</h1>${description}${forms}</main>`), "https://careers.acme.example/jobs/9").application).toBeNull();
  });
  it("structured data: validThrough is the closing date, and directApply makes the posting page the application page", async () => {
    const html = jsonLdPage({ title: "Customer Success Manager", company: "Datesco", descriptionHtml: description, extra: { validThrough: "2026-11-30", directApply: true } });
    const captured = await viaExtension(html, "https://careers.datesco.example/jobs/csm");
    expect(captured.extraction.posting).toMatchObject({ closingDate: "2026-11-30", applicationUrlBasis: "STRUCTURED_DIRECT_APPLY" });
    expect(captured.opportunity).toMatchObject({ closingDate: new Date("2026-11-30T00:00:00.000Z"), applicationUrl: "https://careers.datesco.example/jobs/csm" });
    expect(provenanceOf(captured.provenance, "closingDate")).toEqual(["source.closingDate"]);
    expect(provenanceOf(captured.provenance, "applicationUrl")).toEqual(["structured.directApply"]);
  });
  it("never looks for forms or links on LinkedIn", () => {
    const html = `<html><body><main><h1 class="top-card-layout__title">CSM</h1><div class="show-more-less-html__markup">${description}</div><form><input type="file" name="resume"><input name="first_name"><input name="email"><button>Submit application</button></form></main></body></html>`;
    expect(runExtractor(html, "https://www.linkedin.com/jobs/view/1234567890/").application).toBeNull();
  });
});
