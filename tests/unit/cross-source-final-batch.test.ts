// Feature 14B final cross-source batch (October 27, 2026): every class of
// failure the final human retest found, reproduced through the real path it
// failed on (the extension's page reader, the capture envelope, the server's
// capture mapping and the shared normalizer), with the negative cases that
// keep each correction from spreading. The New Law Business Model case uses
// the posting's real text from the committed We Work Remotely fixture; the
// other pages are synthetic, modelled on each site's public layout and on
// the evidence Alex reported. Nothing reaches the network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawOpportunity } from "@ai-career/core";
import { buildRetrievedListing } from "@ai-career/discovery";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer, parseCompensation, readJobTextFacts } from "@ai-career/normalization";
import { formatSalary, formatWorkArrangements } from "../../apps/web/src/components/opportunity-facts";
import { buildCaptureEnvelope, type CaptureChoice } from "../../apps/extension/src/envelope";
import { evaluationLine } from "../../apps/extension/src/popup-view";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";
import { runExtractor } from "../support/extension-pages";

const observedAt = new Date("2026-10-27T15:00:00.000Z");
const normalizer = createRetrievedOpportunityNormalizer();

async function capture(html: string, url: string, options: { choice?: CaptureChoice; select?: string } = {}) {
  const extraction = runExtractor(html, url, options.select ? { select: options.select } : {});
  const envelope = buildCaptureEnvelope(extraction, options.choice ?? "page", { extensionVersion: "0.1.0", capturedAt: observedAt });
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
const daysBefore = (days: number) => new Date(Date.UTC(2026, 9, 27 - days)).toISOString();
const filler = (sentence: string, times = 6) => `<p>${sentence.repeat(times)}</p>`;
const ats = { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" } as const;
const retrieved = (fields: Partial<Parameters<typeof buildRetrievedListing>[1]> & { description: string }) =>
  normalizer.normalize(buildRetrievedListing(ats, {
    externalId: "x-1", title: "Customer Success Manager", company: "Acme", location: null, sourceUrl: "https://ats.example.test/x-1", applicationUrl: null, sourceItem: {}, ...fields,
  }, { domain: "customer-success", discoveredAt: observedAt }));

// ------------------------------------------------------------- currency

describe("bare $ with unambiguous U.S. context is USD; explicit currency always wins", () => {
  it("a U.S. work-authorization requirement is U.S. context (Healthie: NYC, OTE)", async () => {
    const { opportunity, provenance } = await retrieved({
      location: "NYC",
      description: "This is a full-time, NYC-Hybrid position.\nThe salary range is $105,000 - $155,000 per year (OTE) annually.\nU.S. work authorization is required.",
    });
    expect(opportunity).toMatchObject({ salaryMin: 105000, salaryMax: 155000, currency: "USD", compensationBasis: "OTE", workAuthorizationRequirement: "RIGHT_TO_WORK" });
    expect(markers(provenance, "currency")).toEqual(["compensationText:bare-dollar-as-usd"]);
  });

  it("an explicit U.S. eligibility statement is U.S. context (Mongoose: Midwest territory)", async () => {
    const { opportunity } = await retrieved({
      location: "Remote",
      description: "This role is open to candidates in the United States, covering our Midwest territory.\n$65,000 - $75,000 a year",
    });
    expect(opportunity).toMatchObject({ salaryMin: 65000, salaryMax: 75000, currency: "USD" });
  });

  it("a city alone, another country's authorization, or no geography leaves a bare $ Unknown", async () => {
    expect((await retrieved({ location: "NYC", description: "Salary: $105,000 - $155,000 per year." })).opportunity.currency).toBeNull();
    expect((await retrieved({ location: null, description: "Salary: $105,000 - $155,000 per year.\nCanadian work authorization is required." })).opportunity.currency).toBeNull();
    expect((await retrieved({ location: null, description: "Salary: CAD 105,000 - 155,000 per year.\nU.S. work authorization is required." })).opportunity.currency).toBe("CAD");
  });
});

// ------------------------------------------------------- Greenhouse SafeBreach

describe("Greenhouse (SafeBreach): a qualified labelled location, and remote stated in the posting", () => {
  const html = page(jsonLd({
    title: "Customer Success Manager", hiringOrganization: { name: "SafeBreach" }, datePosted: "2026-10-20",
    jobLocation: { "@type": "Place", address: { addressCountry: "United States" } },
    description: [
      "<p><strong>Locations (Remote):</strong> United States (East Coast)</p>",
      "<p>Own the post-sale relationship with enterprise security teams.</p>",
      "<p>The base salary range for this role is $120,000-140,000 per year.</p>",
      "<h3>Benefits</h3><ul><li>Fully remote work</li><li>Equity</li></ul>",
    ].join(""),
  }), "<main><h1>Customer Success Manager</h1></main>");

  it("keeps United States (East Coast), reads Remote, USD, and no time zone from the East Coast", async () => {
    const { opportunity, provenance } = await capture(html, "https://job-boards.greenhouse.io/safebreach/jobs/4600000001");
    expect(opportunity).toMatchObject({
      location: "United States (East Coast)", remoteStatus: "REMOTE", salaryMin: 120000, salaryMax: 140000, currency: "USD", timeZoneRequirements: null,
    });
    expect(markers(provenance, "location")).toEqual(["rawText:labelled-location"]);
  });

  it("a labelled location that only names how the role is worked is not a place", () => {
    const facts = (text: string, extra = {}) => readJobTextFacts({ text, title: null, ...extra });
    expect(facts("Location: Remote")).toMatchObject({ location: null, remoteStatus: { value: "REMOTE" } });
    expect(facts("Location: Remote - US")).toMatchObject({ location: { value: "Remote - US" }, remoteStatus: { value: "REMOTE" } });
    expect(facts("Location: Remote with up to 25% Regional Travel")).toMatchObject({ location: null, remoteStatus: { value: "REMOTE" } });
    // A different place never replaces the source's; the same place stated
    // more precisely does.
    expect(facts("Location: Canada", { location: "United States" }).broaderLocation).toBeNull();
    expect(facts("Location: United States (East Coast)", { location: "United States" }).broaderLocation?.value).toBe("United States (East Coast)");
  });
});

// ------------------------------------------------------------- Lever header

describe("Lever: the posting header's categories, written with separators", () => {
  // Lever titles the posting with an h2 and writes its categories with a
  // trailing separator depending on their order.
  const lever = (categories: string[]) => page(jsonLd({
    title: "Customer Success Manager", hiringOrganization: { name: "Bluesight" }, datePosted: "2026-10-15",
    description: `<p>${"Partner with hospital pharmacy teams to drive adoption. ".repeat(4)}</p><p>You will be based anywhere in the U.S.</p>`,
  }), `<div class="content-wrapper posting-page"><div class="content"><div class="section-wrapper"><div class="posting-headline">
      <h2>Customer Success Manager</h2><div class="posting-categories">${categories.map((category) => `<div class="posting-category">${category}</div>`).join("")}</div></div>
      <a class="postings-btn" href="https://jobs.lever.co/bluesight/7a7a7a7a-0000-4000-8000-000000000001/apply">Apply for this job</a></div>
      <div class="section page-centered" data-qa="job-description">${filler("Partner with hospital pharmacy teams to drive adoption. ", 8)}</div></div></div>`);
  const url = "https://jobs.lever.co/bluesight/7a7a7a7a-0000-4000-8000-000000000001";

  it("reads Full-time and Remote whatever separator each category carries", async () => {
    for (const categories of [
      ["Remote", "Customer Success /", "Full Time /", "Remote"],
      ["United States", "Customer Success –", "Full Time", "Remote /"],
      ["Remote /", "Full Time"],
    ]) {
      const { opportunity, extraction } = await capture(lever(categories), url);
      expect(extraction.pageText, categories.join(" ")).not.toBeNull();
      expect(opportunity, categories.join(" ")).toMatchObject({ employmentType: "FULL_TIME", remoteStatus: "REMOTE" });
      expect(opportunity.applicationUrl).toBe(`${url}/apply`);
    }
  });
});

// --------------------------------------------------------- SmartRecruiters

describe("SmartRecruiters: microdata salary, the posting's arrangement, and the I'm interested link", () => {
  const sr = (options: { salary?: boolean; description: string; apply?: string }) => page("", `<main><div itemscope itemtype="http://schema.org/JobPosting">
      <header class="job-header"><h1 itemprop="title">Customer Success Manager</h1>
        <span itemprop="hiringOrganization" itemscope itemtype="http://schema.org/Organization"><meta itemprop="name" content="QAD"></span>
        <span itemprop="jobLocation" itemscope itemtype="http://schema.org/Place"><span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
          <span itemprop="addressLocality">Atlanta</span>, <span itemprop="addressRegion">GA</span>, <span itemprop="addressCountry">United States</span></span></span>
        <span itemprop="employmentType">Full-time</span>
        ${options.salary ? `<span itemprop="baseSalary" itemscope itemtype="http://schema.org/MonetaryAmount"><meta itemprop="currency" content="USD">
          <span itemprop="value" itemscope itemtype="http://schema.org/QuantitativeValue"><meta itemprop="minValue" content="100000"><meta itemprop="maxValue" content="150000"><meta itemprop="unitText" content="YEAR"></span></span>` : ""}
        <a class="button js-oneclick" href="https://jobs.smartrecruiters.com/oneclick-ui/company/QAD/publication/1f2e3d4c?dcr_ci=QAD">${options.apply ?? "I’m interested"}</a></header>
      <div itemprop="description">${options.description}</div>
      <footer class="job-footer"><a href="https://jobs.smartrecruiters.com/oneclick-ui/company/QAD/publication/1f2e3d4c?dcr_ci=QAD&amp;source=bottom">${options.apply ?? "I’m interested"}</a></footer>
    </div></main>`);
  const url = "https://jobs.smartrecruiters.com/QAD/744000100000010-customer-success-manager";

  it("QAD: structured salary, Remote from the posting, and the application page", async () => {
    const { opportunity, provenance } = await capture(sr({ salary: true, description: "<p>Location: Remote with up to 25% Regional Travel</p><p>QAD is virtual-first: your primary work location is your home.</p>" }), url);
    expect(opportunity).toMatchObject({
      salaryMin: 100000, salaryMax: 150000, currency: "USD", employmentType: "FULL_TIME", remoteStatus: "REMOTE",
      location: "Atlanta, GA, United States",
      applicationUrl: "https://jobs.smartrecruiters.com/oneclick-ui/company/QAD/publication/1f2e3d4c?dcr_ci=QAD",
    });
    expect(markers(provenance, "salaryMin")).toEqual(["source.salaryMin"]);
    expect(markers(provenance, "applicationUrl")).toEqual(["page:apply-link"]);
  });

  it("ServiceNow: a labelled Flexible or Remote work persona keeps both arrangements", async () => {
    const { opportunity } = await capture(sr({ description: "<p>Work Persona: Flexible or Remote</p><p>Employees can work remotely.</p><p>The base salary range is $95,000 - $120,000 per year.</p>" }), url);
    expect(opportunity).toMatchObject({ remoteStatus: null, workArrangements: ["HYBRID", "REMOTE"], salaryMin: 95000, salaryMax: 120000 });
    expect(formatWorkArrangements(opportunity)).toBe("Hybrid / Remote");
    expect(opportunity.applicationUrl).not.toBeNull();
  });

  it("two apply links to different application pages are still ambiguous", async () => {
    const twoPages = sr({ description: "<p>Own renewals.</p>" }).replace("publication/1f2e3d4c?dcr_ci=QAD&amp;source=bottom", "publication/9a9a9a9a?dcr_ci=QAD");
    expect((await capture(twoPages, url)).opportunity.applicationUrl).toBeNull();
  });
});

// ---------------------------------------------------------------- Remote OK

describe("Remote OK: a shortened structured description, and a default worldwide place", () => {
  const fullDescription = [
    "<p>INNERGY is hiring a Customer Success Manager to guide woodworking shops through implementation and adoption.</p>",
    "<p>You will own onboarding for new customers, run training sessions, and turn feedback into product improvements.</p>",
    `<p>${"Partner with shop owners to measure outcomes and expand usage across their teams. ".repeat(10)}</p>`,
    "<h3>Requirements</h3><ul><li>3+ years in customer success for B2B SaaS</li><li>Manufacturing or construction software experience</li></ul>",
    "<h3>Benefits</h3><ul><li>Health, dental and vision</li><li>Paid time off</li></ul>",
  ].join("");
  const teaser = "<p>INNERGY is hiring a Customer Success Manager to guide woodworking shops through implementation and adoption.</p><p>You will own onboarding for new customers, run training sessions, and turn feedback into product improvements.</p><p>Apply now and work remotely at INNERGY</p>";
  const remoteOk = (location = "") => page(jsonLd({
    title: "Customer Success Manager", hiringOrganization: { name: "INNERGY" }, jobLocationType: "TELECOMMUTE", description: teaser,
    applicantLocationRequirements: { "@type": "Country", name: "Anywhere" }, datePosted: "2026-10-22",
    baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 70000, maxValue: 85000, unitText: "YEAR" } },
  }), `<h1>Remote Customer Success Jobs</h1><table id="jobsboard"><tr class="job"><td><h2>Customer Success Manager</h2><h3>INNERGY</h3>${location}</td></tr>
     <tr class="expand"><td><div class="description">${fullDescription}</div></td></tr>
     <tr class="job"><td><a href="/remote-jobs/other-1"><h2>Support Engineer</h2></a></td></tr></table>`);
  const url = "https://remoteok.com/remote-jobs/remote-customer-success-manager-innergy-1100002";

  it("keeps the full description the page shows, not the shortened copy", async () => {
    const { extraction, raw, opportunity } = await capture(remoteOk(), url);
    expect(raw.description).toContain("Manufacturing or construction software experience");
    expect(raw.description).toContain("Paid time off");
    expect(raw.description).not.toContain("Apply now and work remotely at INNERGY");
    expect(raw.description).not.toContain("Support Engineer");
    expect(extraction.notes.join(" ")).toContain("longer description");
    expect(opportunity).toMatchObject({ title: "Customer Success Manager", salaryMin: 70000, salaryMax: 85000, currency: "USD", remoteStatus: "REMOTE" });
  });

  it("a full structured description is kept as it is", async () => {
    const full = remoteOk().replace(JSON.stringify(teaser).slice(1, -1).replace(/</g, "\\u003c"), JSON.stringify(fullDescription).slice(1, -1).replace(/</g, "\\u003c"));
    const { extraction, raw } = await capture(full, url);
    expect(raw.description).toContain("Paid time off");
    expect(extraction.notes.join(" ")).not.toContain("longer description");
  });

  it("Renaissance: a stated location (IL) is never replaced by a default Anywhere", async () => {
    const { opportunity } = await capture(remoteOk("<div class=\"location\">Location: IL</div>"), url);
    expect(opportunity.location).toBe("IL");
    expect(opportunity).toMatchObject({ residencyRequirement: null, residencyRegions: [] });
    // With nothing else stated, the worldwide place is still the location.
    expect((await capture(remoteOk(), url)).opportunity.location).toBe("Remote (Anywhere)");
  });

  it("'Use my selected text instead' sends the selected text as the description", async () => {
    const { raw, extraction } = await capture(remoteOk(), url, { choice: "selection", select: ".description" });
    expect(extraction.selection?.description).toContain("Paid time off");
    expect(raw.description).toContain("Paid time off");
    expect(raw.sourceMetadata?.capture).toMatchObject({ extractor: "selection" });
    // The title is the posting's heading, not the board's own title.
    expect(raw.title).toBe("Customer Success Manager");
  });

  it("the popup says when the evaluation shown is of an earlier version", () => {
    expect(evaluationLine({ queueState: "COMPLETED", recommendation: { decision: "APPLY" }, evaluatedEarlierVersion: true }))
      .toBe("Evaluation completed. Recommendation: Apply. It evaluated an earlier version of this posting; request evaluation to evaluate the version saved now.");
    expect(evaluationLine({ queueState: "COMPLETED", recommendation: { decision: "APPLY" } })).toBe("Evaluation completed. Recommendation: Apply.");
  });
});

// ------------------------------------------------------- We Work Remotely

// The New Law Business Model posting, from the committed WWR fixture (the
// real feed text), as its job page shows it.
function nlbmDescriptionHtml(): string {
  const rss = readFileSync("tests/fixtures/sources/we-work-remotely/response.rss", "utf8");
  const item = rss.split("<item>").find((entry) => entry.includes("new-law-business-model"))!;
  const description = /<description>([\s\S]*?)<\/description>/.exec(item)![1]!;
  return description.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

describe("We Work Remotely: the sidebar's job items, and the posting's own facts", () => {
  const sidebar = (items: string[]) =>
    `<div class="lis-container__job__sidebar"><h4>About the job</h4><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></div>`;
  const wwr = (company: string, title: string, descriptionHtml: string, items: string[]) => page("", `<div class="lis-container">
      <div class="lis-container__header"><h1>${title}</h1><span>${company}</span></div>
      <div class="lis-container__job"><div class="lis-container__job__content">${descriptionHtml}</div>${sidebar(items)}</div></div>`, `${company}: ${title} | We Work Remotely`);

  it("New Law Business Model: company, full-time, remote, the annualized range and the Pacific overlap", async () => {
    const { opportunity, provenance } = await capture(
      wwr("New Law Business Model", "Solutions Engineer - Customer Success", nlbmDescriptionHtml(), ["Apply before <span>Nov 18, 2026</span>", "Job type <span>Full-Time</span>", "Region <span>Anywhere in the World</span>"]),
      "https://weworkremotely.com/remote-jobs/new-law-business-model-solutions-engineer-customer-success",
    );
    expect(opportunity).toMatchObject({
      companyName: "New Law Business Model", employmentType: "FULL_TIME", remoteStatus: "REMOTE", salaryMin: 85000, salaryMax: 95000,
      timeZoneRequirements: "Requires minimum (4) hours core schedule to overlap with Pacific Time (e.g., 9:00 AM – 1:00 PM PT)",
    });
    // No U.S. geography is stated, so the bare $ stays Unknown.
    expect(opportunity.currency).toBeNull();
    expect(opportunity.closingDate?.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(markers(provenance, "company.name")).toEqual(["pageContext:page-title-company"]);
  });

  it("Dropbox: U.S. geography, Virtual First as remote, and the zones' ranges side by side", async () => {
    const { opportunity } = await capture(wwr("Dropbox", "Customer Success Manager", [
      "<p>Dropbox is Virtual First, which means remote work is the primary experience for all employees.</p>",
      "<p>US Zone 2 salary range: $120,000 - $160,000 per year.</p><p>US Zone 3 salary range: $108,000 - $144,000 per year.</p>",
      filler("Own onboarding and adoption for strategic customers. "),
    ].join(""), ["Job type <span>Full-Time</span>", "Countries <span>United States</span>"]), "https://weworkremotely.com/remote-jobs/dropbox-customer-success-manager");
    expect(opportunity).toMatchObject({ location: "United States", remoteStatus: "REMOTE", employmentType: "FULL_TIME", salaryMin: null, salaryMax: null });
    expect(opportunity.compensationTiers).toEqual([
      { label: "US Zone 2", minimum: 120000, maximum: 160000, currency: "USD" },
      { label: "US Zone 3", minimum: 108000, maximum: 144000, currency: "USD" },
    ]);
    expect(formatSalary(opportunity)).toBe("US Zone 2: 120,000–160,000 USD · US Zone 3: 108,000–144,000 USD");
  });

  it("hourly pay without an annual equivalent is still not a salary", () => {
    expect(parseCompensation("Pay Rate: $8,000 - $9,000 per month")).toMatchObject({ minimum: null, maximum: null, amountsUnknownReason: "NON_ANNUAL_PERIOD" });
    expect(parseCompensation("Pay Rate: $40.87–$45.67 ($85,000 – $95,000 / annualized)")).toMatchObject({ minimum: 85000, maximum: 95000 });
    expect(parseCompensation("$8,000/month ($96,000/year)")).toMatchObject({ minimum: 96000, maximum: 96000 });
  });
});

// --------------------------------------------------------------- Himalayas

describe("Himalayas: the stated salary, rounded in the header and exact in the posting", () => {
  const himalayas = (header: string, description: string) => page(jsonLd({
    title: "Customer Success Manager", hiringOrganization: { name: "Samsara" }, jobLocationType: "TELECOMMUTE", employmentType: "FULL_TIME",
    applicantLocationRequirements: { "@type": "Country", name: "United States" }, datePosted: "2026-10-20", validThrough: "2026-11-20", description,
  }), `<main><h1>Customer Success Manager</h1><div class="job-meta">${header}</div></main>`);
  const url = "https://himalayas.app/companies/samsara/jobs/customer-success-manager";

  it("Samsara: the exact annual base range over its rounded restatement", async () => {
    const { opportunity } = await capture(himalayas("<span>Salary:$88K–$118K per year</span>", "<p>Annual Base Salary $88,089.75—$118,440 USD</p><p>Help fleets succeed.</p>"), url);
    expect(opportunity).toMatchObject({ salaryMin: 88089.75, salaryMax: 118440, currency: "USD", compensationBasis: "BASE", location: "Remote (United States)" });
  });

  it("SMB Team: the range, with the bonus kept separately", async () => {
    const { opportunity, provenance } = await capture(himalayas("<span>$85K–$90K per year</span>", "<p>The base salary for this role is $85,000–$90,000.</p><p>Bonus potential up to $10,000 annually.</p>"), url);
    expect(opportunity).toMatchObject({ salaryMin: 85000, salaryMax: 90000, currency: "USD", bonus: "Bonus potential up to $10,000 annually." });
    expect(markers(provenance, "bonus")).toEqual(["rawText:explicit-variable-pay-statement"]);
  });

  it("two genuinely different ranges still conflict", () => {
    const facts = (text: string) => readJobTextFacts({ text, title: null });
    expect(facts("Salary: $88K–$118K per year.\nAnnual base salary $92,000—$130,000 USD.").compensation).toBeNull();
    expect(facts("Salary: $88K–$118K per year.\nAnnual base salary $88,500—$118,200 USD.").compensation?.value).toBe("Annual base salary $88,500—$118,200 USD.");
  });
});

// ----------------------------------------------------------- Working Nomads

describe("Working Nomads: the posting's location statement and listed time zones", () => {
  const nomads = (company: string, items: string[], description: string) => page("", `<main><h1>Customer Success Manager</h1><div class="job-company">${company}</div>
      <div class="job-meta">${items.map((item) => `<span>${item}</span>`).join("")}</div>
      <a class="apply-button" href="https://www.workingnomads.com/job/go/1953300/">Apply for this position</a>
      <div class="job-desc">${description}${filler("Partner with customers on adoption. ", 4)}</div></main>`, `Customer Success Manager - ${company} - Working Nomads`);

  it("PeopleGrove: USA with Location: Remote is a remote U.S. role in USD", async () => {
    const { opportunity } = await capture(nomads("PeopleGrove", ["USA", "Full-time", "Mid Level", "$65k-$80k per year"],
      "<p>Location: Remote</p><p>This is a US-based full-time role.</p>"), "https://www.workingnomads.com/jobs/customer-success-manager-peoplegrove-2");
    // ("US-based" in the posting and the page's "USA" agree: one country.)
    expect(opportunity).toMatchObject({ location: "US", remoteStatus: "REMOTE", employmentType: "FULL_TIME", salaryMin: 65000, salaryMax: 80000, currency: "USD" });
  });

  it("Hostaway: EST or CST is kept as stated, both zones", async () => {
    const { opportunity } = await capture(nomads("Hostaway", ["USA", "Full-time", "Mid Level"],
      "<p>Candidates must be located in the U.S. and able to work EST or CST hours.</p>"), "https://www.workingnomads.com/jobs/customer-success-manager-hostaway");
    expect(opportunity.timeZoneRequirements).toBe("Candidates must be located in the U.S. and able to work EST or CST hours.");
    expect(opportunity).toMatchObject({ location: "USA", remoteStatus: null });
  });
});

// ----------------------------------------------------------------- Workday

describe("Workday: the posting's own title, requisition ID, dates and zone bands", () => {
  const workday = (description: string, details: Array<[string, string]>) => page("", `<header class="site"><h1>Thomson Reuters Careers</h1></header><main>
      <div data-automation-id="jobPostingHeader"><h2 data-automation-id="jobPostingHeader">Customer Success Manager - Global Trade</h2></div>
      <div class="details">${details.map(([label, value]) => `<div><dl><dt>${label}</dt><dd>${value}</dd></dl></div>`).join("")}</div>
      <div data-automation-id="jobPostingDescription">${description}</div></main>`, "Careers at Thomson Reuters");
  const url = "https://thomsonreuters.wd5.myworkdayjobs.com/External_Career_Site/job/Remote/Customer-Success-Manager_JREQ204486";

  it("Thomson Reuters: title, requisition ID, posted age and closing date", async () => {
    const { opportunity, provenance } = await capture(workday(
      `<p>End Date: December 31, 2026</p>${filler("Help trade teams adopt our platform. ")}<p>This job posting will close 12/31/2026.</p><p>The salary range is $106,400 - $197,600 USD per year.</p>`,
      [["locations", "Remote - United States"], ["time type", "Full time"], ["posted on", "Posted 11 Days Ago"], ["job requisition id", "JREQ204486"]],
    ), url);
    expect(opportunity).toMatchObject({ title: "Customer Success Manager - Global Trade", atsRequisitionId: "JREQ204486", salaryMin: 106400, salaryMax: 197600, currency: "USD" });
    expect(opportunity.postingDate?.toISOString()).toBe(daysBefore(11));
    expect(opportunity.closingDate?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(markers(provenance, "atsRequisitionId")[0]).toMatch(/:labelled-requisition-id$/);
  });

  it("ServiceTitan: the zone bands are kept with their labels, never merged", async () => {
    const { opportunity } = await capture(workday(
      `${filler("Own a portfolio of contractors. ")}<p>Pay range by geography:</p><p>Zone 1: $92,600 - $139,000 USD</p><p>Zone 2: $86,600 - $129,800 USD</p><p>Able to work PST/MST hours.</p>`,
      [["time type", "Full time"], ["job requisition id", "JR115657"]],
    ).replace("Customer Success Manager - Global Trade", "Customer Success Manager"), url.replace("JREQ204486", "JR115657"));
    expect(opportunity.title).toBe("Customer Success Manager");
    expect(opportunity.atsRequisitionId).toBe("JR115657");
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null });
    expect(formatSalary(opportunity)).toBe("Zone 1: 92,600–139,000 USD · Zone 2: 86,600–129,800 USD");
    expect(opportunity.timeZoneRequirements).toBe("Able to work PST/MST hours.");
  });

  it("a careers site's own title never titles a posting", async () => {
    const { extraction } = await capture(workday(filler("Help trade teams adopt our platform. "), []), url);
    expect(extraction.posting?.title).toBe("Customer Success Manager - Global Trade");
  });
});

// ----------------------------------------------------- LinkedIn and WTTJ

describe("LinkedIn (Serrala) and Welcome to the Jungle (AlphaSense): stated salaries", () => {
  it("Serrala: the U.S. and Canada ranges, each with its own currency", async () => {
    const { opportunity } = await capture(page("", `<main><section class="top-card-layout">
        <h1 class="top-card-layout__title">Scaled Customer Success Manager, NA</h1><a class="topcard__org-name-link">Serrala</a>
        <span class="topcard__flavor topcard__flavor--bullet">Canada</span></section>
      <div class="description__text"><div class="show-more-less-html__markup">
        <p>Location: Chicago Office or Remote, North America (US &amp; Canada)</p><p>Grow a scaled book of customers.</p>
        <p>Compensation:</p><p>United States: USD 63,000-75,000</p><p>Canada: CAD 88,000-110,000</p></div></div></main>`, "Scaled Customer Success Manager, NA | Serrala | LinkedIn"),
      "https://www.linkedin.com/jobs/view/4300000002/");
    expect(opportunity.compensationTiers).toEqual([
      { label: "United States", minimum: 63000, maximum: 75000, currency: "USD" },
      { label: "Canada", minimum: 88000, maximum: 110000, currency: "CAD" },
    ]);
    expect(formatSalary(opportunity)).toBe("United States: 63,000–75,000 USD · Canada: 88,000–110,000 CAD");
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, currency: null, workArrangements: ["ONSITE", "REMOTE"] });
  });

  it("AlphaSense: $80-95k split across the page's elements is one range, in USD", async () => {
    const { opportunity, provenance } = await capture(page(jsonLd({
      title: "Customer Success Manager (Corporate)", hiringOrganization: { name: "AlphaSense" }, employmentType: "FULL_TIME", validThrough: "2026-11-10",
      jobLocation: [{ "@type": "Place", address: { addressLocality: "New York", addressCountry: "US" } }, { "@type": "Place", address: { addressLocality: "Chicago", addressCountry: "US" } }],
      description: "<p>Partner with corporate customers on research workflows.</p>",
    }), `<main><h1>Customer Success Manager (Corporate)</h1><div class="job-metadata"><span><i aria-hidden="true"></i><span>$80</span>-95k</span>
      <span>Hybrid</span><span>Junior and Mid level</span></div></main>`), "https://app.welcometothejungle.com/jobs/AbCdEf34");
    expect(opportunity).toMatchObject({ salaryMin: 80000, salaryMax: 95000, currency: "USD", location: "New York, US; Chicago, US" });
    expect(provenance.find((row) => row.fieldName === "salaryText")?.sourceText).toBe("$80-95k");
  });

  it("a range's dangling end is never a salary by itself", () => {
    expect(readJobTextFacts({ text: "", title: null, pageText: "Hybrid\n-95k\nJunior and Mid level" }).compensation).toBeNull();
  });
});

// ------------------------------------------------- shared reader negatives

describe("negative cases: no speculative inference", () => {
  const facts = (text: string, extra: Partial<Parameters<typeof readJobTextFacts>[0]> = {}) => readJobTextFacts({ text, title: null, ...extra });

  it("no time zone from geography, and multiple stated zones kept as stated", () => {
    expect(facts("This role is open to candidates on the East Coast.").timeZoneRequirements).toBeNull();
    expect(facts("Our team is based in Chicago and New York.").timeZoneRequirements).toBeNull();
    expect(facts("You must be available to work 9–5 ET.").timeZoneRequirements?.value).toBe("You must be available to work 9–5 ET.");
    expect(facts("You must work EST or CST hours.").timeZoneRequirements?.value).toBe("You must work EST or CST hours.");
  });

  it("no seniority from years of experience; stated labels kept", () => {
    expect(facts("You have 5+ years of experience in customer success.").seniorityLabel).toBeNull();
    expect(facts("", { pageText: "Mid-Senior level" }).seniorityLabel?.value).toBe("Mid-Senior level");
  });

  it("sponsorship never implies work authorization", () => {
    expect(facts("", { pageText: "Visa Sponsorship\nNot Available" })).toMatchObject({ visaSponsorship: { value: "NOT_AVAILABLE" }, workAuthorization: null });
  });

  it("colon-less labels are read only in page metadata, and only when the value is one", () => {
    expect(facts("Job type Full-Time").employmentType).toBeNull();
    expect(facts("", { pageText: "Job type Full-Time" }).employmentType?.value).toBe("FULL_TIME");
    expect(facts("", { pageText: "Region Enterprise accounts" }).location).toBeNull();
    expect(facts("", { pageText: "Region United States" }).location?.value).toBe("United States");
  });

  it("variable pay alone is never a salary; a range with a bonus clause still is", () => {
    expect(facts("Bonus potential up to $10,000 annually.")).toMatchObject({ compensation: null, bonus: { value: "Bonus potential up to $10,000 annually." } });
    expect(facts("The salary is $85,000–$90,000 per year plus a bonus of up to $10,000.").compensation?.value).toBe("The salary is $85,000–$90,000 per year plus a bonus of up to $10,000.");
  });

  it("an employment line with anything but its classification is not read", () => {
    expect(facts("Full-Time, Non-Exempt (W2) 40 Hours / Week").employmentType?.value).toBe("FULL_TIME");
    expect(facts("Full-time, if you can relocate to Denver").employmentType).toBeNull();
  });

  it("Flexible counts only as a labelled work-arrangement value", () => {
    expect(facts("We offer flexible or remote options to everyone.").workArrangements).toBeNull();
    expect(facts("Work Persona: Flexible or Remote").workArrangements?.value).toEqual(["HYBRID", "REMOTE"]);
  });

  it("manual entry reads the same new facts", async () => {
    const manual = await createManualOpportunityNormalizer().normalize({
      source: "manual-input", sourceType: "MANUAL", sourceUrl: null, applicationUrl: null, domain: "customer-success", externalId: null, requisitionId: null,
      title: "Customer Success Manager", company: "Acme", location: null, salaryText: null, employmentType: null, postingDate: null,
      description: "Pay range by geography:\nZone 1: $92,600 - $139,000 USD\nZone 2: $86,600 - $129,800 USD\nBonus potential up to $10,000 annually.",
      sourceMetadata: null, rawPayload: null, discoveredAt: observedAt,
    } as RawOpportunity);
    expect(manual.opportunity.compensationTiers).toEqual([
      { label: "Zone 1", minimum: 92600, maximum: 139000, currency: "USD" },
      { label: "Zone 2", minimum: 86600, maximum: 129800, currency: "USD" },
    ]);
    expect(manual.opportunity.bonus).toBe("Bonus potential up to $10,000 annually.");
  });
});
