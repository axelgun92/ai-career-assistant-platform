// Feature 14B cross-source correction (October 26, 2026): every confirmed
// live-acceptance finding, reproduced through the real path it failed on
// (the extension's page reader, the capture envelope, the server's capture
// mapping and the shared normalizer), with the negative cases that keep each
// correction from spreading. The pages are synthetic, modelled on each
// site's public layout and on the failure Alex observed; none is a captured
// response, and nothing reaches the network.
import { describe, expect, it } from "vitest";
import type { NormalizedOpportunity, RawOpportunity } from "@ai-career/core";
import { buildRetrievedListing } from "@ai-career/discovery";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer, parseCompensation, readJobTextFacts } from "@ai-career/normalization";
import { formatSalary, formatWorkArrangements } from "../../apps/web/src/components/opportunity-facts";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";
import { runExtractor } from "../support/extension-pages";

const observedAt = new Date("2026-10-26T15:00:00.000Z");
const normalizer = createRetrievedOpportunityNormalizer();

async function capture(html: string, url: string) {
  const extraction = runExtractor(html, url);
  const envelope = buildCaptureEnvelope(extraction, "page", { extensionVersion: "0.1.0", capturedAt: observedAt });
  if (!envelope.ok) throw new Error(envelope.problems.join("; "));
  const { raw } = capturedListing(parseCapture(envelope.envelope), { pairingId: "p1", domain: "customer-success", receivedAt: observedAt });
  const { opportunity, provenance } = await normalizer.normalize(raw);
  return { extraction, raw, opportunity, provenance };
}

const jsonLd = (posting: Record<string, unknown>) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", ...posting }).replace(/</g, "\\u003c")}</script>`;
const page = (head: string, body: string, title = "Customer Success Manager") =>
  `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
const markers = (rows: Array<{ fieldName: string; sourceField: string }>, field: string) => rows.filter((row) => row.fieldName === field).map((row) => row.sourceField);
const daysBefore = (days: number) => new Date(Date.UTC(2026, 9, 26 - days)).toISOString();
const unstatedEligibility = (opportunity: NormalizedOpportunity) => ({
  workAuthorizationRequirement: opportunity.workAuthorizationRequirement,
  workAuthorizationRegions: opportunity.workAuthorizationRegions,
});

describe("Lever (Mongoose): one pay range with its OTE and base-plus-variable detail", () => {
  const description = [
    "Customer Success Manager",
    "Own a book of mid-market customers.",
    "$65,000 - $75,000 a year",
    "OTE = $75,000",
    "$65,000 base + $10,000 variable",
  ].join("\n");

  it("normalizes the stated range, on the extension path, the retrieval path and manual entry alike", async () => {
    const captured = await capture(
      page(jsonLd({ title: "Customer Success Manager", description: description.replace(/\n/g, "<br>"), hiringOrganization: { name: "Mongoose" } }), "<main><h1>Customer Success Manager</h1></main>"),
      "https://jobs.lever.co/mongoose/6f1e0c1e-0000-4000-8000-000000000001",
    );
    const retrieved = await normalizer.normalize(buildRetrievedListing(
      { key: "lever", name: "Lever", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
      { externalId: "m-1", title: "Customer Success Manager", company: "Mongoose", location: "United States", description, sourceUrl: "https://jobs.lever.co/mongoose/m-1", applicationUrl: null, sourceItem: {} },
      { domain: "customer-success", discoveredAt: observedAt },
    ));
    const manual = await createManualOpportunityNormalizer().normalize({
      source: "manual-input", sourceType: "MANUAL", sourceUrl: null, applicationUrl: null, domain: "customer-success", externalId: null, requisitionId: null,
      title: "Customer Success Manager", company: "Mongoose", location: "United States", description, salaryText: null, employmentType: null, postingDate: null,
      sourceMetadata: null, rawPayload: null, discoveredAt: observedAt,
    } as RawOpportunity);
    for (const opportunity of [captured.opportunity, retrieved.opportunity, manual.opportunity]) {
      expect(opportunity).toMatchObject({ salaryMin: 65000, salaryMax: 75000, salaryText: "$65,000 - $75,000 a year" });
    }
    // The bare "$" is U.S. dollars where the location says United States.
    expect(retrieved.opportunity.currency).toBe("USD");
    expect(manual.opportunity.currency).toBe("USD");
  });

  it("still leaves two different ranges, or an amount beyond the range, Unknown", () => {
    const facts = (text: string) => readJobTextFacts({ text, title: null }).compensation;
    expect(facts("Salary: $80,000 - $100,000 per year.\nThe salary range is $90,000 - $120,000 per year.")).toBeNull();
    expect(facts("Base salary: $100,000 - $120,000 per year.\nOTE: $160,000 - $180,000 per year.")).toBeNull();
    expect(facts("Salary: $80,000 - $100,000 per year.\nTotal compensation up to $150,000 per year.")).toBeNull();
    // "plus commission" is not an open-ended salary.
    expect(parseCompensation("$80,000 plus commission")).toMatchObject({ minimum: 80000, maximum: 80000 });
  });
});

describe("Ashby (Hubstaff): an office in a remote posting's data, and the distinct application page", () => {
  const posting = (extra: Record<string, unknown> = {}) => jsonLd({
    title: "Customer Success Manager",
    description: "<p>Help customers succeed with Hubstaff.</p>",
    hiringOrganization: { name: "Hubstaff" },
    jobLocationType: "TELECOMMUTE",
    jobLocation: { "@type": "Place", address: { addressLocality: "Atlanta", addressRegion: "Georgia", addressCountry: "United States" } },
    baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 70000, maxValue: 90000, unitText: "YEAR" } },
    directApply: true,
    ...extra,
  });
  const body = `<main><nav><a href="/hubstaff/5c8e">Overview</a><a href="/hubstaff/5c8e/application">Application</a></nav>
    <h1>Customer Success Manager</h1><div><div>Location</div><div>United States</div><div>Location Type</div><div>Remote</div></div>
    <p>Help customers succeed.</p><a class="apply-cta" href="/hubstaff/5c8e/application">Apply for this Job</a></main>`;
  const url = "https://jobs.ashbyhq.com/hubstaff/5c8e";

  it("never takes the office (Atlanta) as the location; the page's own location is used", async () => {
    const { opportunity, extraction } = await capture(page(posting(), body), url);
    expect(extraction.posting!.location).toBeNull();
    expect(opportunity).toMatchObject({ location: "United States", remoteStatus: "REMOTE", salaryMin: 70000, salaryMax: 90000, currency: "USD" });
    // A job location is not candidate eligibility: only a statement of where
    // remote candidates may be is (see the next case).
    expect(opportunity).toMatchObject({ residencyRequirement: null, residencyRegions: [] });
    expect(unstatedEligibility(opportunity)).toEqual({ workAuthorizationRequirement: null, workAuthorizationRegions: [] });
  });

  it("with stated remote-hiring places, the location is the remote geography", async () => {
    const { opportunity, provenance } = await capture(page(posting({ applicantLocationRequirements: [{ "@type": "Country", name: "United States" }] }), body), url);
    expect(opportunity.location).toBe("Remote (United States)");
    expect(markers(provenance, "location")).toEqual(["source.remoteLocations"]);
    expect(opportunity).toMatchObject({ residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], workAuthorizationRequirement: null });
  });

  it("takes the distinct /application page over the structured directApply flag", async () => {
    const { opportunity, provenance } = await capture(page(posting(), body), url);
    expect(opportunity.applicationUrl).toBe("https://jobs.ashbyhq.com/hubstaff/5c8e/application");
    expect(markers(provenance, "applicationUrl")).toEqual(["page:apply-link"]);
    // With no application page or link, directApply still marks the posting page.
    const bare = await capture(page(posting(), "<main><h1>Customer Success Manager</h1><p>Help customers succeed.</p></main>"), url);
    expect(bare.opportunity.applicationUrl).toBe(url);
    expect(markers(bare.provenance, "applicationUrl")).toEqual(["structured.directApply"]);
  });
});

describe("SmartRecruiters: the posting's microdata fields reach shared normalization", () => {
  const html = page("", `<main><div itemscope itemtype="http://schema.org/JobPosting">
      <h1 itemprop="title">Customer Success Manager</h1>
      <span itemprop="hiringOrganization" itemscope itemtype="http://schema.org/Organization"><meta itemprop="name" content="Acme Analytics"></span>
      <span itemprop="jobLocation" itemscope itemtype="http://schema.org/Place"><span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
        <span itemprop="addressLocality">Denver</span>, <span itemprop="addressRegion">CO</span>, <span itemprop="addressCountry">US</span></span></span>
      <span itemprop="employmentType">Full-time</span><meta itemprop="datePosted" content="2026-10-12">
      <div itemprop="description"><p>Own renewals for enterprise accounts.</p><p>Candidates must reside in the United States.</p>
        <p>The salary range for this role is $90,000 - $110,000 per year.</p></div>
    </div><a href="https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeAnalytics/publication/1f2e?dcr_ci=AcmeAnalytics">I'm interested</a></main>`);

  it("reads company, location, employment type, salary, eligibility and the apply page", async () => {
    const { opportunity, extraction, provenance } = await capture(html, "https://jobs.smartrecruiters.com/AcmeAnalytics/744000100000001-customer-success-manager");
    expect(extraction.extractor).toBe("structured-data");
    expect(opportunity).toMatchObject({
      companyName: "Acme Analytics", location: "Denver, CO, US", employmentType: "FULL_TIME",
      salaryMin: 90000, salaryMax: 110000, currency: "USD", residencyRequirement: "US_REQUIRED", residencyRegions: ["US"],
      applicationUrl: "https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeAnalytics/publication/1f2e?dcr_ci=AcmeAnalytics",
    });
    expect(opportunity.postingDate?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(markers(provenance, "applicationUrl")).toEqual(["page:apply-link"]);
  });

  it("structured data without its own description takes the page's main content as the description", async () => {
    const withoutDescription = page(jsonLd({ title: "Customer Success Manager", hiringOrganization: { name: "Acme Analytics" }, employmentType: "FULL_TIME" }),
      `<main><h1>Customer Success Manager</h1><p>${"Own renewals for enterprise accounts. ".repeat(4)}</p></main>`);
    const { extraction, opportunity } = await capture(withoutDescription, "https://jobs.smartrecruiters.com/AcmeAnalytics/744000100000002-csm");
    expect(extraction.extractor).toBe("structured-data");
    expect(opportunity).toMatchObject({ companyName: "Acme Analytics", employmentType: "FULL_TIME" });
    expect(opportunity.jobDescription).toContain("Own renewals for enterprise accounts.");
  });
});

describe("Remote OK (INNERGY): eligible U.S. states listed one per line", () => {
  const description = [
    "<p>This is a U.S.-based remote role.</p>",
    "<p>Candidates must reside in one of the following states:</p>",
    "<ul><li>Arizona</li><li>Colorado</li><li>Florida</li><li>Texas</li></ul>",
    "<p>We are unable to hire in the following states:</p><ul><li>California</li><li>New York</li></ul>",
  ].join("");

  it("normalizes the eligible states as eligibility, never as work authorization", async () => {
    const { opportunity } = await capture(page(jsonLd({
      title: "Customer Success Manager", description, hiringOrganization: { name: "INNERGY" }, jobLocationType: "TELECOMMUTE",
      baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 70000, maxValue: 85000, unitText: "YEAR" } },
    }), "<main><h1>Customer Success Manager</h1></main>"), "https://remoteok.com/remote-jobs/remote-customer-success-manager-innergy-1100001");
    expect(opportunity).toMatchObject({ residencyRequirement: "US_REQUIRED", residencyRegions: ["US-AZ", "US-CO", "US-FL", "US-TX"], salaryMin: 70000, salaryMax: 85000, currency: "USD" });
    expect(unstatedEligibility(opportunity)).toEqual({ workAuthorizationRequirement: null, workAuthorizationRegions: [] });
  });
});

describe("We Work Remotely (Dropbox): the target posting, never the Related Jobs beside it", () => {
  const related = `<section class="jobs"><h2>Related Jobs</h2>
    <article><a href="/remote-jobs/other-1"><h3>Support Engineer</h3><span>Anywhere in the World</span><span>Open to candidates worldwide</span></a></article>
    <article><a href="/remote-jobs/other-2"><h3>Account Manager</h3><span>Anywhere in the World</span></a></article></section>`;
  const body = `<div class="content">${related}
    <div class="listing-header"><h1>Customer Success Manager</h1><a href="/company/dropbox">Dropbox</a>
      <span>Full-Time</span><span>United States</span><span>Apply before November 5, 2026</span></div>
    <div class="listing-container"><p>Dropbox is Virtual First: you work remotely, with in-person collaboration when it helps.</p>
      <p>Zone 2 salary range: $120,000 - $160,000 per year.</p><p>Zone 3 salary range: $108,000 - $144,000 per year.</p>
      <p>${"Own onboarding and adoption for strategic customers. ".repeat(6)}</p></div></div>`;

  it("reads the Dropbox body and metadata; Related Jobs never reach normalization", async () => {
    const { extraction, opportunity, raw } = await capture(page("", body, "Dropbox: Customer Success Manager"), "https://weworkremotely.com/remote-jobs/dropbox-customer-success-manager");
    expect(extraction.extractor).toBe("main-content");
    for (const text of [raw.description ?? "", String(raw.sourceMetadata?.pageText ?? "")]) {
      expect(text).toContain("Own onboarding and adoption");
      expect(text).not.toContain("Support Engineer");
      expect(text).not.toContain("Anywhere in the World");
    }
    expect(opportunity.residencyRequirement).toBeNull();
    expect(opportunity).toMatchObject({ employmentType: "FULL_TIME", location: "United States", salaryMin: null, salaryMax: null });
    expect(opportunity.closingDate?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    // Two zones' ranges are kept as stated, with no single range.
    expect(opportunity.salaryText).toContain("Zone 2");
    expect(opportunity.salaryText).toContain("Zone 3");
  });
});

describe("Himalayas (SMB Team): United States only", () => {
  it("normalizes the stated remote-hiring geography as the location and eligibility", async () => {
    const { opportunity } = await capture(page(jsonLd({
      title: "Senior Customer Success Manager", description: "<p>Grow SMB accounts.</p>", hiringOrganization: { name: "SMB Team" },
      jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "United States" }, employmentType: "FULL_TIME",
      baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 85000, maxValue: 90000, unitText: "YEAR" } },
    }), "<main><h1>Senior Customer Success Manager</h1><span>United States only</span></main>"), "https://himalayas.app/companies/smb-team/jobs/senior-customer-success-manager");
    expect(opportunity).toMatchObject({
      location: "Remote (United States)", remoteStatus: "REMOTE", residencyRequirement: "US_REQUIRED", residencyRegions: ["US"],
      salaryMin: 85000, salaryMax: 90000, currency: "USD", employmentType: "FULL_TIME", seniority: "SENIOR",
    });
    expect(unstatedEligibility(opportunity)).toEqual({ workAuthorizationRequirement: null, workAuthorizationRegions: [] });
  });
});

describe("Working Nomads (PeopleGrove): the page's job metadata items", () => {
  const body = `<main><h1>Customer Success Manager</h1><div class="job-company">PeopleGrove</div>
    <div class="job-meta"><span>USA</span><span>Full-time</span><span>Mid Level</span><span>$65k - $80k/year</span><span>Posted 1 week ago</span></div>
    <a class="apply-button" href="https://www.workingnomads.com/job/go/1953247/">Apply for this position</a>
    <div class="job-desc"><p>This is a U.S.-based, full-time remote role.</p><p>${"Partner with university customers on adoption. ".repeat(4)}</p></div></main>`;

  it("reads location, employment type, seniority, salary in USD, posting age and the apply link", async () => {
    const { opportunity, provenance } = await capture(page("", body, "Customer Success Manager - PeopleGrove - Working Nomads"), "https://www.workingnomads.com/jobs/customer-success-manager-peoplegrove");
    expect(opportunity).toMatchObject({
      // The page's "USA" and the posting's "U.S.-based" name the same
      // country, so they agree (the posting's own statement is kept).
      location: "U.S.", employmentType: "FULL_TIME", seniority: "MID", seniorityLabel: "Mid Level",
      salaryMin: 65000, salaryMax: 80000, currency: "USD", applicationUrl: "https://www.workingnomads.com/job/go/1953247/",
      remoteStatus: "REMOTE", residencyRequirement: "US_REQUIRED", residencyRegions: ["US"],
    });
    expect(opportunity.postingDate?.toISOString()).toBe(daysBefore(7));
    expect(markers(provenance, "postingDate")).toEqual(["pageContext:relative-posted-age"]);
    expect(markers(provenance, "currency")).toEqual(["compensationText:bare-dollar-as-usd"]);
    // Eligibility from the posting's own statement that the remote role is
    // U.S.-based, not from the "USA" location by itself.
    expect(markers(provenance, "residencyRequirement")).toEqual(["rawText:explicit-remote-base-statement"]);
  });
});

describe("Workday (ServiceTitan): the labelled requisition ID, and geographic salary bands", () => {
  it("reads JR115971 and keeps the two zones' bands as stated, with no single range", async () => {
    const { opportunity, provenance } = await capture(page(jsonLd({
      title: "Customer Success Manager", hiringOrganization: { name: "ServiceTitan" }, employmentType: "FULL_TIME", datePosted: "2026-10-20",
      jobLocation: { "@type": "Place", address: { addressLocality: "Glendale", addressRegion: "CA", addressCountry: "United States" } },
      description: "<p>Own a portfolio of contractors.</p><p>Pay range by geography:</p><p>Zone 1: $92,600 - $139,000 USD</p><p>Zone 2: $86,600 - $129,800 USD</p>",
    }), `<main><h1>Customer Success Manager</h1><div><dl><dt>job requisition id</dt><dd>JR115971</dd></dl></div></main>`), "https://servicetitan.wd1.myworkdayjobs.com/ServiceTitan/job/Glendale-CA/Customer-Success-Manager_JR115971");
    expect(opportunity.atsRequisitionId).toBe("JR115971");
    expect(markers(provenance, "atsRequisitionId")).toEqual(["pageContext:labelled-requisition-id"]);
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, currency: "USD", location: "Glendale, CA, United States" });
    // Each tier keeps the zone it is for; the Salary field shows them side by
    // side, never merged (October 27, 2026; previously Unknown).
    expect(opportunity.salaryText).toBe("Zone 1: $92,600 - $139,000 USD / Zone 2: $86,600 - $129,800 USD");
    expect(formatSalary(opportunity)).toBe("Zone 1: 92,600–139,000 USD · Zone 2: 86,600–129,800 USD");
  });
});

describe("Workable (PERSUIT): remote U.S. location, a preferred time zone, and the /apply/ page", () => {
  const html = page(jsonLd({
    title: "Customer Success Manager, North America", hiringOrganization: { name: "PERSUIT" }, jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: { "@type": "Country", name: "United States" }, datePosted: "2026-10-14", directApply: true,
    description: [
      "<p>This is a fully remote, U.S.-based role.</p>",
      "<p>Candidates in the Eastern, Central or Mountain time zones are preferred.</p>",
      "<p>Current valid U.S. work authorization is required. We are unable to sponsor visas.</p>",
      "<p>Base salary: $120,000 per year, plus variable compensation.</p>",
    ].join(""),
  }), `<main><h1>Customer Success Manager, North America</h1><a href="https://apply.workable.com/persuit/j/A1B2C3D4E5/apply/">Apply for this job</a></main>`);

  it("normalizes all three, and keeps what already worked", async () => {
    const { opportunity, provenance } = await capture(html, "https://apply.workable.com/persuit/j/A1B2C3D4E5/");
    expect(opportunity).toMatchObject({
      location: "Remote (United States)", remoteStatus: "REMOTE",
      timeZoneRequirements: "Candidates in the Eastern, Central or Mountain time zones are preferred.",
      applicationUrl: "https://apply.workable.com/persuit/j/A1B2C3D4E5/apply/",
      workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"], visaSponsorship: "NOT_AVAILABLE",
      residencyRequirement: "US_REQUIRED", salaryMin: 120000, salaryMax: 120000, currency: "USD", compensationBasis: "BASE",
    });
    expect(markers(provenance, "timeZoneRequirements")).toEqual(["rawText:explicit-time-zone-preference"]);
    expect(markers(provenance, "applicationUrl")).toEqual(["page:apply-link"]);
  });
});

describe("Wellfound (Instrumentl): an optional office, remote U.S. hiring and visa sponsorship", () => {
  const html = page(jsonLd({
    title: "Customer Success Manager", hiringOrganization: { name: "Instrumentl" }, jobLocationType: "TELECOMMUTE", datePosted: "2026-10-12",
    jobLocation: { "@type": "Place", address: { addressLocality: "Oakland", addressRegion: "CA", addressCountry: "US" } },
    applicantLocationRequirements: { "@type": "Country", name: "United States" }, employmentType: "FULL_TIME",
    baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 80000, maxValue: 110000, unitText: "YEAR" } },
    description: [
      "<p>We are fully distributed; our Oakland office is optional.</p>",
      "<p>Candidates must be based in the continental U.S., between Pacific and Eastern time zones.</p>",
      "<p>You have 4+ years of customer success experience.</p>",
    ].join(""),
  }), `<main><h1>Customer Success Manager</h1><div class="details"><div><span>Hires remotely in</span><span>United States</span></div>
    <div><span>Visa Sponsorship</span><span>Not Available</span></div><span>Posted 2 weeks ago</span></div></main>`);

  it("normalizes Remote (United States), U.S. eligibility and the sponsorship fact, and nothing more", async () => {
    const { opportunity, provenance } = await capture(html, "https://wellfound.com/jobs/3400001-customer-success-manager");
    expect(opportunity).toMatchObject({
      location: "Remote (United States)", remoteStatus: "REMOTE", residencyRequirement: "US_REQUIRED", residencyRegions: ["US"],
      visaSponsorship: "NOT_AVAILABLE", salaryMin: 80000, salaryMax: 110000, currency: "USD", employmentType: "FULL_TIME",
      // Not a narrow time-zone requirement: Pacific through Eastern is the
      // continental United States. "4+ years" is not a seniority.
      timeZoneRequirements: null, seniority: null, seniorityLabel: null,
      // Sponsorship is not a work-authorization requirement.
      workAuthorizationRequirement: null,
    });
    expect(opportunity.postingDate?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(markers(provenance, "visaSponsorship")).toEqual(["pageContext:labelled-sponsorship"]);
    expect(opportunity.location).not.toContain("Oakland");
  });
});

describe("LinkedIn (Serrala): the public job page's own facts, and regional pay tiers", () => {
  const html = page("", `<main><section class="top-card-layout">
      <h1 class="top-card-layout__title">Scaled Customer Success Manager, NA</h1>
      <a class="topcard__org-name-link">Serrala</a><span class="topcard__flavor topcard__flavor--bullet">Canada</span>
      <span class="posted-time-ago__text topcard__flavor--metadata">2 weeks ago</span>
      <div class="salary compensation__salary">$63,000.00/yr - $75,000.00/yr</div></section>
    <div class="description__text"><div class="show-more-less-html__markup">
      <p>Location: Chicago Office or Remote, North America (US &amp; Canada)</p>
      <p>Employment Type: Full-time/Permanent</p><p>Travel: approximately 5%</p>
      <p>Grow a scaled book of customers.</p>
      <p>Compensation:</p><p>U.S.: USD 63,000 - 75,000</p><p>Canada: CAD 88,000 - 110,000</p></div></div>
    <ul class="description__job-criteria-list">
      <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">Mid-Senior level</span></li>
      <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">Full-time</span></li>
    </ul></main>`, "Scaled Customer Success Manager, NA | Serrala | LinkedIn");

  it("resolves all six findings coherently", async () => {
    const { opportunity, provenance } = await capture(html, "https://www.linkedin.com/jobs/view/4300000001/");
    expect(opportunity).toMatchObject({
      // 1. The posting's fuller statement of the location, not "Canada".
      location: "Chicago Office or Remote, North America (US & Canada)",
      residencyRequirement: "NON_US", residencyRegions: ["US", "CA"],
      // 2. Both arrangements the posting offers, in its order; no single one.
      remoteStatus: null, workArrangements: ["ONSITE", "REMOTE"],
      // 3-4.
      employmentType: "FULL_TIME", seniority: null, seniorityLabel: "Mid-Senior level",
      // 6. Two regional tiers: no single range, no single currency; both kept.
      salaryMin: null, salaryMax: null, currency: null, compensationBasis: null,
      // Legitimately unstated.
      workAuthorizationRequirement: null, timeZoneRequirements: null,
    });
    // 5. Dated from the stated age, marked as such.
    expect(opportunity.postingDate?.toISOString()).toBe(daysBefore(14));
    expect(markers(provenance, "postingDate")).toEqual(["postingDate:relative-posted-age"]);
    // Each tier keeps its region and currency; the Salary field shows them
    // side by side, never merged (October 27, 2026; previously Unknown).
    expect(opportunity.salaryText).toBe("U.S.: USD 63,000 - 75,000 / Canada: CAD 88,000 - 110,000");
    expect(formatSalary(opportunity)).toBe("United States: 63,000–75,000 USD · Canada: 88,000–110,000 CAD");
    expect(formatWorkArrangements(opportunity)).toBe("On-site / Remote");
    expect(markers(provenance, "location")).toEqual(["rawText:labelled-location"]);
  });
});

describe("Welcome to the Jungle (AlphaSense): the page header's salary, office days and seniority", () => {
  const html = page(jsonLd({
    title: "Customer Success Manager (Corporate)", hiringOrganization: { name: "AlphaSense" }, employmentType: "FULL_TIME",
    datePosted: "2026-10-10", validThrough: "2026-12-10",
    jobLocation: [
      { "@type": "Place", address: { addressLocality: "New York", addressRegion: "NY", addressCountry: "US" } },
      { "@type": "Place", address: { addressLocality: "Chicago", addressRegion: "IL", addressCountry: "US" } },
    ],
    description: "<p>Partner with corporate customers on research workflows.</p>",
  }), `<main><h1>Customer Success Manager (Corporate)</h1><div class="job-metadata">
    <span><i aria-hidden="true"></i>$80K – $95K</span><span><i aria-hidden="true"></i>1 day a week in office</span>
    <span><i aria-hidden="true"></i>Junior and Mid level</span><span>Open for applications</span></div></main>`);

  it("normalizes $80k–$95k, HYBRID and the stated range label", async () => {
    const { opportunity } = await capture(html, "https://app.welcometothejungle.com/jobs/AbCdEf12");
    expect(opportunity).toMatchObject({
      salaryMin: 80000, salaryMax: 95000, currency: "USD", remoteStatus: "HYBRID",
      seniority: null, seniorityLabel: "Junior and Mid level",
      location: "New York, NY, US; Chicago, IL, US", employmentType: "FULL_TIME",
    });
    expect(opportunity.closingDate?.toISOString()).toBe("2026-12-10T00:00:00.000Z");
  });
});

describe("negative cases: the corrections never spread", () => {
  const facts = (text: string, extra: Partial<Parameters<typeof readJobTextFacts>[0]> = {}) => readJobTextFacts({ text, title: null, ...extra });

  it("no work authorization from geography, and no residency from sponsorship", async () => {
    const retrieved = await normalizer.normalize(buildRetrievedListing(
      { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
      { externalId: "n-1", title: "Customer Success Manager", company: "Nco", location: "Toronto, ON", description: "We are unable to sponsor visas for this role.", sourceUrl: "https://ats.example.test/n-1", applicationUrl: null, sourceItem: {} },
      { domain: "customer-success", discoveredAt: observedAt },
    ));
    expect(retrieved.opportunity).toMatchObject({ visaSponsorship: "NOT_AVAILABLE", residencyRequirement: null, workAuthorizationRequirement: null });
  });

  it("no time zone from ordinary geography; Pacific-to-Eastern is not a requirement", () => {
    expect(facts("This role is based in Denver, CO.").timeZoneRequirements).toBeNull();
    expect(facts("You must work between Pacific and Eastern time zones.").timeZoneRequirements).toBeNull();
    expect(facts("Must be available in Pacific, Mountain, Central or Eastern time.").timeZoneRequirements).toBeNull();
    // A real narrower requirement still counts.
    expect(facts("You must be able to work Eastern Time business hours.").timeZoneRequirements?.value).toBe("You must be able to work Eastern Time business hours.");
  });

  it("no USD for a bare $ without U.S. geography", () => {
    expect(parseCompensation("$80K – $95K", null, { location: "Toronto, ON" })).toMatchObject({ minimum: 80000, maximum: 95000, currency: null });
  });

  it("a labelled location replaces a source location only when it contains it and says more", () => {
    const location = (text: string, source: string) => facts(text, { location: source }).broaderLocation?.value ?? null;
    expect(location("Location: Chicago Office or Remote, North America (US & Canada)", "Canada")).toBe("Chicago Office or Remote, North America (US & Canada)");
    // A different place is a conflict, not a fuller statement.
    expect(location("Location: Remote, United States", "Canada")).toBeNull();
    // Prose is never one.
    expect(location("We hire across the US and Canada.", "Canada")).toBeNull();
    // The same place says nothing more.
    expect(location("Location: Canada", "Canada")).toBeNull();
  });

  it("one regional tier is never applied as the role's salary", async () => {
    const tiers = "Compensation:\nU.S.: USD 63,000 - 75,000\nCanada: CAD 88,000 - 110,000";
    expect(facts(tiers).compensation).toBeNull();
    expect(facts(tiers).compensationTiers).toMatchObject({ currency: null });
    // A base range and an OTE range are not regional tiers.
    expect(facts("Base salary: $100,000 - $120,000 per year.\nOTE: $160,000 - $180,000 per year.").compensationTiers).toBeNull();
  });

  it("no work arrangement or seniority from loose wording", () => {
    expect(facts("Up to 2 days a week in the office, if needed.").remoteStatus).toBeNull();
    expect(facts("You have 4+ years of experience.").seniorityLabel).toBeNull();
    expect(facts("Office or remote? Tell us in your cover letter.").remoteStatus).toBeNull();
  });

  it("a relative date is never read from job-description prose", () => {
    expect(facts("Posted 1 week ago", { observedAt }).postingDate).toBeNull();
    expect(facts("", { pageText: "Posted 1 week ago", observedAt }).postingDate?.value.toISOString()).toBe(daysBefore(7));
    expect(facts("", { pageText: "Posted 2 months ago", observedAt }).postingDate).toBeNull();
  });

  it("several stated arrangements are kept as options, in order; ambiguity and conflict stay Unknown", () => {
    const arrangements = (text: string) => {
      const read = facts(text);
      return { single: read.remoteStatus?.value ?? null, options: read.workArrangements?.value ?? null };
    };
    expect(arrangements("Location: Chicago Office or Remote")).toEqual({ single: null, options: ["ONSITE", "REMOTE"] });
    expect(arrangements("Workplace type: Remote or Hybrid")).toEqual({ single: null, options: ["REMOTE", "HYBRID"] });
    expect(arrangements("Workplace type: Hybrid or On-site")).toEqual({ single: null, options: ["HYBRID", "ONSITE"] });
    expect(arrangements("This is a remote or hybrid role.")).toEqual({ single: null, options: ["REMOTE", "HYBRID"] });
    // A single arrangement stated elsewhere that is one of the options agrees.
    expect(arrangements("Location: Chicago Office or Remote\nWorkplace type: Remote")).toEqual({ single: null, options: ["ONSITE", "REMOTE"] });
    // "and" states no clear options; two statements that disagree conflict.
    expect(arrangements("This is a remote and hybrid role.")).toEqual({ single: null, options: null });
    expect(arrangements("This role is fully remote.\nWorkplace type: Hybrid")).toEqual({ single: null, options: null });
    expect(arrangements("Workplace type: Hybrid or On-site\nThis role is fully remote.")).toEqual({ single: null, options: null });
    // One arrangement is still one.
    expect(arrangements("Workplace type: Remote")).toEqual({ single: "REMOTE", options: null });
    expect(formatWorkArrangements({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"] })).toBe("Hybrid");
    expect(formatWorkArrangements({ remoteStatus: null, workArrangements: [] })).toBe("Unknown");
  });

  it("an ordinary job or office location never creates eligibility", async () => {
    const office = await capture(page(jsonLd({
      title: "Customer Success Manager", description: "<p>Own renewals.</p>", hiringOrganization: { name: "Acme" }, jobLocationType: "TELECOMMUTE",
      jobLocation: { "@type": "Place", address: { addressCountry: "United States" } },
    }), "<main><h1>Customer Success Manager</h1></main>"), "https://jobs.example-ats.test/acme/1");
    expect(office.opportunity).toMatchObject({ location: "United States", remoteStatus: "REMOTE", residencyRequirement: null, workAuthorizationRequirement: null });
    const retrieved = await normalizer.normalize(buildRetrievedListing(
      { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
      { externalId: "loc-1", title: "Customer Success Manager", company: "Acme", location: "Australia", description: "Own renewals for enterprise customers.", sourceUrl: "https://ats.example.test/loc-1", applicationUrl: null, sourceItem: {}, structured: { workplaceType: "REMOTE" } },
      { domain: "customer-success", discoveredAt: observedAt },
    ));
    expect(retrieved.opportunity).toMatchObject({ location: "Australia", residencyRequirement: null, residencyRegions: [] });
    // "U.S.-based" for an on-site role names an office, not eligibility.
    const onsite = await createManualOpportunityNormalizer().normalize({
      source: "manual-input", sourceType: "MANUAL", sourceUrl: null, applicationUrl: null, domain: "customer-success", externalId: null, requisitionId: null,
      title: "Customer Success Manager", company: "Acme", location: null, description: "This is a U.S.-based, full-time on-site role.", salaryText: null,
      employmentType: null, postingDate: null, sourceMetadata: null, rawPayload: null, discoveredAt: observedAt,
    } as RawOpportunity);
    expect(onsite.opportunity.residencyRequirement).toBeNull();
  });

  it("ranges that do not say which place each is for are not tiers", () => {
    const unlabelled = facts("Salary: USD 63,000 - 75,000 per year.\nSalary: CAD 88,000 - 110,000 per year.");
    expect(unlabelled.compensationTiers).toBeNull();
    expect(unlabelled.compensation).toBeNull();
  });

  it("the Salary field shows only a normalized amount or range", () => {
    expect(formatSalary({ salaryMin: null, salaryMax: null, currency: null, compensationBasis: null, salaryText: "Competitive, plus equity" })).toBeNull();
    expect(formatSalary({ salaryMin: 80000, salaryMax: 95000, currency: "USD", compensationBasis: null, salaryText: "$80K – $95K" })).toBe("80,000–95,000 USD");
  });

  it("a job board's listing link is never an application URL without evidence", async () => {
    const { opportunity } = await capture(
      page("", `<main><h1>Customer Success Manager</h1><p>${"Own renewals for enterprise accounts. ".repeat(4)}</p><a href="https://example-board.test/jobs/1">View job</a></main>`),
      "https://example-board.test/jobs/1-csm",
    );
    expect(opportunity.applicationUrl).toBeNull();
  });
});
