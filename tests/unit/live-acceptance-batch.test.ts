// Feature 14B live acceptance batch (October 29, 2026): each failure the
// latest full live round found, reproduced through the real path it failed
// on (the extension's page reader, the capture envelope, the server's
// capture mapping and the shared normalizer), with the negative cases that
// keep each correction from spreading. The pages are synthetic, modelled on
// each site's public layout and on the evidence Alex reported (the visible
// text quoted in the handoff); nothing reaches the network.
import { describe, expect, it } from "vitest";
import { createRetrievedOpportunityNormalizer, parseCompensation, readJobTextFacts } from "@ai-career/normalization";
import { formatSalary, formatWorkArrangements } from "../../apps/web/src/components/opportunity-facts";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";
import { runExtractor } from "../support/extension-pages";

const observedAt = new Date("2026-10-29T15:00:00.000Z");
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
const filler = (sentence: string, times = 6) => `<p>${sentence.repeat(times)}</p>`;
const facts = (text: string, extra: Partial<Parameters<typeof readJobTextFacts>[0]> = {}) => readJobTextFacts({ text, title: null, ...extra });

// ------------------------------------------------------- Greenhouse SafeBreach

describe("Greenhouse (SafeBreach): the qualified labelled location is kept", () => {
  const description = [
    "<p><strong>Locations (Remote):</strong> United States (East Coast)</p>",
    "<p>Own the post-sale relationship with enterprise security teams.</p>",
  ].join("");
  const url = "https://job-boards.greenhouse.io/safebreach/jobs/4600000001";

  it("a structured place written with the arrangement (\"Remote, United States\") is refined, not kept", async () => {
    const html = page(jsonLd({
      title: "Customer Success Manager", hiringOrganization: { name: "SafeBreach" }, datePosted: "2026-10-20", description,
      jobLocation: { "@type": "Place", address: { addressLocality: "Remote", addressCountry: "United States" } },
    }), "<main><h1>Customer Success Manager</h1></main>");
    const { raw, opportunity, provenance } = await capture(html, url);
    expect(raw.location).toBe("Remote, United States");
    expect(opportunity).toMatchObject({ location: "United States (East Coast)", remoteStatus: "REMOTE", timeZoneRequirements: null });
    expect(markers(provenance, "location")).toEqual(["rawText:labelled-location"]);
  });

  it("a remote role's stated hiring place is refined the same way", async () => {
    const html = page(jsonLd({
      title: "Customer Success Manager", hiringOrganization: { name: "SafeBreach" }, datePosted: "2026-10-20", description, jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: { "@type": "Country", name: "United States" },
    }), "<main><h1>Customer Success Manager</h1></main>");
    const { opportunity } = await capture(html, url);
    expect(opportunity).toMatchObject({ location: "United States (East Coast)", remoteStatus: "REMOTE", timeZoneRequirements: null });
    expect(opportunity).toMatchObject({ residencyRequirement: "US_REQUIRED" });
  });

  it("a labelled place that is not the stated one never replaces it", () => {
    expect(facts("Locations (Remote): Canada", { location: "Remote, United States" }).broaderLocation).toBeNull();
    expect(facts("Locations (Remote): Canada", { remoteLocations: ["United States"] }).broaderRemoteLocation).toBeNull();
  });
});

// ----------------------------------------------------------- Lever Bluesight

describe("Lever (Bluesight): the commitment category joined with other categories", () => {
  const lever = (categories: string[]) => page("", `<div class="content-wrapper posting-page"><div class="content"><div class="section-wrapper"><div class="posting-headline">
      <h2>Customer Success Manager</h2><div class="posting-categories">${categories.map((category) => `<div class="posting-category">${category}</div>`).join("")}</div></div>
      <a class="postings-btn" href="https://jobs.lever.co/bluesight/7a7a7a7a-0000-4000-8000-000000000002/apply">Apply for this job</a></div>
      <div class="section page-centered" data-qa="job-description">${filler("Partner with hospital pharmacy teams to drive adoption. ", 8)}</div></div></div>`);
  const url = "https://jobs.lever.co/bluesight/7a7a7a7a-0000-4000-8000-000000000002";

  it("\"Full Time - Remote - In-person meeting attendance required / Remote\" is full-time and remote", async () => {
    const { opportunity, provenance } = await capture(lever(["Customer Success /", "Full Time - Remote - In-person meeting attendance required /", "Remote"]), url);
    expect(opportunity).toMatchObject({ employmentType: "FULL_TIME", remoteStatus: "REMOTE" });
    expect(markers(provenance, "employmentType")).toEqual(["pageContext:stated-employment-type"]);
    expect(opportunity.applicationUrl).toBe(`${url}/apply`);
  });

  it("two employment types in one item state none; prose is never split", () => {
    expect(facts("", { pageText: "Full Time - Part Time - Remote" }).employmentType).toBeNull();
    expect(facts("We hire full time - and part time - staff for many roles in many places across the region.").employmentType).toBeNull();
  });
});

// ----------------------------------------------------------- SmartRecruiters

describe("SmartRecruiters (QAD, ServiceNow): the I'm interested buttons", () => {
  const publication = "https://jobs.smartrecruiters.com/oneclick-ui/company/QAD/publication/1f2e3d4c-0000-4000-8000-000000000003";
  const sr = (layout: "aside-and-sticky" | "buttons") => page("", `
      <header class="sticky-header"><div class="sticky-header__title">Customer Success Manager</div>
        ${layout === "buttons" ? `<button class="button" data-href="${publication}?dcr_ci=QAD">I’m interested</button>` : `<a class="button" href="${publication}?dcr_ci=QAD&amp;src=sticky">I’m interested</a>`}</header>
      <main><div itemscope itemtype="http://schema.org/JobPosting">
        <h1 itemprop="title">Customer Success Manager</h1>
        <span itemprop="hiringOrganization" itemscope itemtype="http://schema.org/Organization"><meta itemprop="name" content="QAD"></span>
        <div class="job-sections"><div itemprop="description">${filler("Own renewals for a manufacturing ERP portfolio. ")}</div>
        <aside class="job-sidebar"><a class="button" href="${publication}?dcr_ci=QAD&amp;src=sidebar">I'm interested</a><p>Share this job</p></aside></div>
      </div></main>
      <footer class="site-footer"><a href="${publication}?dcr_ci=QAD&amp;src=bottom">I’m interested</a><a href="/privacy">Privacy</a></footer>
      <footer class="site-footer"><p>© SmartRecruiters</p></footer>`);
  const url = "https://jobs.smartrecruiters.com/QAD/744000100000020-customer-success-manager";

  it("the same application page behind the sidebar, sticky header and bottom buttons is the application URL", async () => {
    const { opportunity, provenance } = await capture(sr("aside-and-sticky"), url);
    // (One destination: the first of its buttons, with its own parameters.)
    expect(opportunity.applicationUrl).toBe(`${publication}?dcr_ci=QAD&src=sticky`);
    expect(markers(provenance, "applicationUrl")).toEqual(["page:apply-link"]);
  });

  it("a button that carries its destination in an attribute counts", async () => {
    const { opportunity } = await capture(sr("buttons").replace(/<a class="button" href="[^"]*src=sidebar">I'm interested<\/a>/, ""), url);
    expect(new URL(opportunity.applicationUrl!).pathname).toBe(new URL(publication).pathname);
  });

  it("a site header that does not repeat this job never supplies its apply link", () => {
    const html = page("", `<header><a href="https://jobs.smartrecruiters.com/QAD/apply-general">Apply</a></header>
      <main><h1>Customer Success Manager</h1>${filler("Own renewals for a manufacturing ERP portfolio. ")}</main>`);
    expect(runExtractor(html, url).application).toBeNull();
  });
});

// ---------------------------------------------------------------- Remote OK

describe("Remote OK (INNERGY, Renaissance): the job's own Apply among other jobs' rows", () => {
  const row = (id: string, title: string, company: string) => `<tr class="job" data-id="${id}"><td class="company position">
      <a class="preventLink" href="/remote-jobs/${id}"><h2 itemprop="title">${title}</h2></a><h3>${company}</h3></td>
      <td class="source"><a class="button action-apply" href="/l/${id}">Apply</a></td></tr>`;
  const remoteOk = page(jsonLd({
    title: "Customer Success Manager", hiringOrganization: { name: "INNERGY" }, jobLocationType: "TELECOMMUTE", datePosted: "2026-10-22",
    description: `<p>${"INNERGY is hiring a Customer Success Manager to guide woodworking shops through adoption. ".repeat(3)}</p>`,
  }), `<h1>Remote Customer Success Jobs</h1><table id="jobsboard">
      <tr class="job" data-id="1100002"><td class="company position"><h2 itemprop="title">Customer Success Manager</h2><h3>INNERGY</h3></td>
        <td class="source"><a class="button action-apply" href="/l/1100002">Apply</a></td></tr>
      <tr class="expand"><td><div class="description">${filler("Partner with shop owners to measure outcomes. ")}<h3>Requirements</h3><ul><li>3+ years in customer success</li></ul>
        <a class="button action-apply" href="/l/1100002?ref=expand">Apply for this position</a></div></td></tr>
      ${row("1100003", "Customer Success Manager", "Renaissance")}${row("1100004", "Support Engineer", "Acme")}</table>`);
  const url = "https://remoteok.com/remote-jobs/remote-customer-success-manager-innergy-1100002";

  it("other postings' Apply buttons (even with the same title) do not make the job's own ambiguous", async () => {
    const { opportunity, provenance } = await capture(remoteOk, url);
    expect(opportunity.applicationUrl).toBe("https://remoteok.com/l/1100002");
    expect(markers(provenance, "applicationUrl")).toEqual(["page:apply-link"]);
  });

  it("two different destinations in the job's own content are still ambiguous", () => {
    const two = remoteOk.replace("/l/1100002?ref=expand", "/l/9999999");
    expect(runExtractor(two, url).application).toBeNull();
  });
});

// ------------------------------------------------------- We Work Remotely

describe("We Work Remotely: the job's sidebar, the zone tiers and the page-title company", () => {
  const wwr = (title: string, documentTitle: string, descriptionHtml: string, items: string[]) => page("", `<div class="lis-container">
      <div class="lis-container__header"><h1>${title}</h1></div>
      <div class="lis-container__job"><div class="lis-container__job__content">${descriptionHtml}</div>
      <aside class="lis-container__job__sidebar"><div class="lis-container__job__sidebar__job-about"><h4>About the job</h4><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></div>
        <div class="lis-container__job__sidebar__companyDetails"><a href="/company/acme">View company profile</a></div></aside></div></div>`, documentTitle);

  it("Dropbox: U.S. geography from the sidebar, and each zone's range under its own label", async () => {
    const { opportunity, provenance } = await capture(wwr("Customer Success Manager", "Customer Success Manager | Dropbox | We Work Remotely", [
      "<p>Dropbox is Virtual First, which means remote work is the primary experience for all employees.</p>",
      filler("Own onboarding and adoption for strategic customers. "),
      "<p>Total Rewards</p><p>The base salary ranges below are for this full-time position.</p>",
      "<p>US Zone 1</p><p>This role is not available in Zone 1</p><p>US Zone 2</p><p>$142,700—$193,100 USD</p><p>US Zone 3</p><p>$126,800—$171,600 USD</p>",
    ].join(""), ["Posted on <span>Oct 20, 2026</span>", "Job type <span>Full-Time</span>", "Region <span>USA Only</span>"]), "https://weworkremotely.com/remote-jobs/dropbox-customer-success-manager-2");
    expect(opportunity).toMatchObject({ location: "USA Only", remoteStatus: "REMOTE", employmentType: "FULL_TIME", salaryMin: null, salaryMax: null, currency: "USD" });
    expect(opportunity.compensationTiers).toEqual([
      { label: "US Zone 2", minimum: 142700, maximum: 193100, currency: "USD" },
      { label: "US Zone 3", minimum: 126800, maximum: 171600, currency: "USD" },
    ]);
    expect(formatSalary(opportunity)).toBe("US Zone 2: 142,700–193,100 USD · US Zone 3: 126,800–171,600 USD");
    expect(markers(provenance, "location")).toEqual(["pageContext:labelled-location"]);
  });

  it("New Law Business Model: the company from a \"<title> | <Company> | We Work Remotely\" page title", async () => {
    const { opportunity, provenance } = await capture(wwr("Solutions Engineer - Customer Success", "Solutions Engineer - Customer Success | New Law Business Model | We Work Remotely",
      `<p>For over 10 years, New Law Business Model (NLBM) has been on a mission to liberate lawyers.</p>${filler("Guide member firms through onboarding. ", 16)}`,
      ["Apply before <span>Nov 18, 2026</span>", "Job type <span>Full-Time</span>", "Region <span>Anywhere in the World</span>"]),
      "https://weworkremotely.com/remote-jobs/new-law-business-model-solutions-engineer-customer-success");
    expect(opportunity).toMatchObject({ companyName: "New Law Business Model", employmentType: "FULL_TIME" });
    expect(markers(provenance, "company.name")).toEqual(["pageContext:page-title-company"]);
    // A worldwide region is no location.
    expect(opportunity.location).toBeNull();
  });

  it("a side panel with one stray label, or of other jobs, is never read", () => {
    const html = page("", `<main><h1>Customer Success Manager</h1>${filler("Own renewals. ", 40)}</main>
      <aside><h4>Similar jobs</h4><ul><li>Job type Contract</li><li>Region Canada</li></ul></aside><aside>Location: Asideville</aside>`);
    const text = runExtractor(html, "https://weworkremotely.com/remote-jobs/x").pageText ?? "";
    expect(text).not.toContain("Asideville");
    expect(text).not.toContain("Contract");
  });
});

// --------------------------------------------------------------- Himalayas

describe("Himalayas: the sidebar's stated salary and job type, and the posting's work style", () => {
  const himalayas = (sidebar: string[], description: string, company = "SMB Team") => page(jsonLd({
    title: "Customer Success Manager", hiringOrganization: { name: company }, jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: { "@type": "Country", name: "United States" }, datePosted: "2026-10-20", description,
  }), `<main><article><h1>Customer Success Manager</h1>${filler("Help small businesses succeed with bookkeeping. ")}</article>
      <aside class="job-sidebar">${sidebar.map((item) => `<div>${item}</div>`).join("")}</aside></main>`);
  const url = "https://himalayas.app/companies/smb-team/jobs/customer-success-manager";

  it("SMB Team: $85K–$90K, the bonus apart, Full Time, and both work styles", async () => {
    const { opportunity, provenance } = await capture(himalayas(
      ["<span>Salary</span><span>$85K–$90K per year</span>", "<span>Job type</span><span>Full Time</span>", "<span>Experience level</span><span>Mid level</span>"],
      "<p>WORK STYLE – WFH or come to the office. The choice is yours!</p><p>The salary for this role is $85,000 - $90,000 with bonus potential up to $10,000.</p>",
    ), url);
    expect(opportunity).toMatchObject({
      salaryMin: 85000, salaryMax: 90000, currency: "USD", employmentType: "FULL_TIME", bonus: "bonus potential up to $10,000",
      remoteStatus: null, workArrangements: ["REMOTE", "ONSITE"], residencyRequirement: "US_REQUIRED",
    });
    expect(formatWorkArrangements(opportunity)).toBe("Remote / On-site");
    expect(markers(provenance, "workArrangements")).toEqual(["rawText:labelled-work-arrangement"]);
    expect(markers(provenance, "employmentType")).toEqual(["pageContext:labelled-employment-type"]);
  });

  it("Jobs for Humanity: a monthly range is kept as text, never annualized", async () => {
    const { opportunity } = await capture(himalayas(
      ["<span>Salary</span><span>$1,500–$3,000 per month</span>", "<span>Job type</span><span>Full Time</span>"],
      "<p>Support customers across our partner network.</p>", "Jobs for Humanity",
    ), url.replace("smb-team", "jobs-for-humanity"));
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, employmentType: "FULL_TIME" });
  });

  it("the source's single arrangement still wins when the posting offers none, or other ones", async () => {
    const { opportunity } = await capture(himalayas(["<span>Job type</span><span>Full Time</span>", "<span>Experience level</span><span>Mid level</span>"],
      "<p>Work Style: Hybrid or On-site</p><p>Help customers.</p>"), url);
    expect(opportunity).toMatchObject({ remoteStatus: "REMOTE", workArrangements: ["REMOTE"] });
  });

  it("a work style only counts when labelled; prose about home or the office is not one", () => {
    expect(facts("Some of us like to work from home or come to the office.")).toMatchObject({ workArrangements: null, remoteStatus: null });
    expect(facts("Work Style: WFH").remoteStatus?.value).toBe("REMOTE");
  });
});

// ----------------------------------------------------------------- Workday

describe("Workday (ServiceTitan): two zones stated in one statement", () => {
  const statement = "Pay Range: Zone 1 (CA, CT, DC, MD, MA, NJ, NY, VA, WA): $76,900 - $115,300 USD Zone 2 (All other U.S. locations): $71,800 - $107,800 USD";
  const workday = (descriptionHtml: string) => page("", `<main>
      <div data-automation-id="jobPostingHeader"><h2 data-automation-id="jobPostingHeader">Customer Success Manager</h2></div>
      <div class="details"><dl><dt>locations</dt><dd>US Remote</dd></dl><dl><dt>time type</dt><dd>Full time</dd></dl><dl><dt>job requisition id</dt><dd>JR115657</dd></dl></div>
      <div data-automation-id="jobPostingDescription">${descriptionHtml}</div></main>`, "ServiceTitan Careers");
  const url = "https://servicetitan.wd1.myworkdayjobs.com/ServiceTitan/job/US-CA-Remote/Customer-Success-Manager_JR115657";

  it("each zone keeps its range, places and currency; no single salary is taken", async () => {
    const { opportunity } = await capture(workday(`${filler("Own a portfolio of contractors. ")}<p>Able to work PST/MST hours.</p><p>${statement}</p>`), url);
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, currency: "USD", timeZoneRequirements: "Able to work PST/MST hours." });
    expect(opportunity.compensationTiers).toEqual([
      { label: "Zone 1 (CA, CT, DC, MD, MA, NJ, NY, VA, WA)", minimum: 76900, maximum: 115300, currency: "USD" },
      { label: "Zone 2 (All other U.S. locations)", minimum: 71800, maximum: 107800, currency: "USD" },
    ]);
    expect(formatSalary(opportunity)).toBe("Zone 1 (CA, CT, DC, MD, MA, NJ, NY, VA, WA): 76,900–115,300 USD · Zone 2 (All other U.S. locations): 71,800–107,800 USD");
  });

  it("the ranges may also come before their zones", () => {
    const tiers = facts("The pay range for this role is $76,900 - $115,300 USD in Zone 1 (CA, NY) and $71,800 - $107,800 USD in Zone 2 (all other U.S. locations).").compensationTiers;
    expect(tiers?.tiers.map((tier) => tier.label)).toEqual(["Zone 1 (CA, NY)", "Zone 2 (all other U.S. locations)"]);
  });

  it("a source salary text naming the zones is read the same way", async () => {
    const { buildRetrievedListing } = await import("@ai-career/discovery");
    const { opportunity } = await normalizer.normalize(buildRetrievedListing(
      { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
      { externalId: "x-2", title: "Customer Success Manager", company: "ServiceTitan", location: null, sourceUrl: "https://ats.example.test/x-2", applicationUrl: null, sourceItem: {}, description: "Own a portfolio.", salaryText: statement },
      { domain: "customer-success", discoveredAt: observedAt },
    ));
    expect(opportunity.compensationTiers.map((tier) => tier.minimum)).toEqual([76900, 71800]);
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, currency: "USD" });
  });

  it("ranges without zone labels, and base with OTE, stay ambiguous", () => {
    expect(facts("Salary: $76,900 - $115,300 USD or $71,800 - $107,800 USD").compensationTiers).toBeNull();
    expect(parseCompensation("Base $100,000 - $120,000, OTE $160,000 - $180,000")).toMatchObject({ minimum: null, maximum: null, amountsUnknownReason: "AMBIGUOUS_AMOUNTS" });
    expect(parseCompensation("$72k-$88k base + $10k bonus")).toMatchObject({ minimum: null, amountsUnknownReason: "AMBIGUOUS_AMOUNTS" });
    expect(parseCompensation("Base salary $80,000 - $100,000 plus commission; OTE $140,000")).toMatchObject({ minimum: null, amountsUnknownReason: "AMBIGUOUS_AMOUNTS" });
  });
});

// -------------------------------------------------------- LinkedIn Serrala

describe("LinkedIn (Serrala): the posted age and the employer's apply link", () => {
  const destination = "https://careers.serrala.com/jobs/scaled-csm-na?source=linkedin";
  const externalApply = `https://www.linkedin.com/jobs/view/externalApply/4300000002?url=${encodeURIComponent(destination)}&amp;urlHash=AbCd`;
  const url = "https://www.linkedin.com/jobs/view/4300000002/";
  const description = "<p>Grow a scaled book of customers across North America.</p><p>Compensation:</p><p>United States: USD 63,000-75,000</p><p>Canada: CAD 88,000-110,000</p>";

  it("public page with structured data: the top card's \"12 hours ago\" and Apply link still count", async () => {
    const html = page(jsonLd({ title: "Scaled Customer Success Manager, NA", hiringOrganization: { name: "Serrala" }, description, employmentType: "FULL_TIME" }),
      `<main><section class="top-card-layout"><h1 class="top-card-layout__title">Scaled Customer Success Manager, NA</h1>
        <a class="topcard__org-name-link">Serrala</a><span class="topcard__flavor topcard__flavor--bullet">Canada</span>
        <span class="posted-time-ago__text">12 hours ago</span>
        <a class="top-card-layout__cta top-card-layout__cta--primary apply-button" href="${externalApply}">Apply</a></section>
        <div class="description__text"><div class="show-more-less-html__markup">${description}</div></div></main>`, "Scaled Customer Success Manager, NA | Serrala | LinkedIn");
    const { extraction, opportunity, provenance } = await capture(html, url);
    expect(extraction.extractor).toBe("structured-data");
    expect(opportunity.postingDate?.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(markers(provenance, "postingDate")).toEqual(["postingDate:relative-posted-age"]);
    expect(opportunity.applicationUrl).toBe(destination);
  });

  it("signed-in view: the age inside the top card's description row, and an off-site Apply link", async () => {
    const html = page("", `<main><div class="job-details-jobs-unified-top-card">
        <div class="job-details-jobs-unified-top-card__job-title"><h1>Scaled Customer Success Manager, NA</h1></div>
        <div class="job-details-jobs-unified-top-card__company-name"><a>Serrala</a></div>
        <div class="job-details-jobs-unified-top-card__tertiary-description-container"><span class="tvm__text">Canada</span><span> · </span><span class="tvm__text">12 hours ago</span><span> · </span><span class="tvm__text">Over 100 applicants</span></div>
        <div class="jobs-apply-button--top-card"><a class="jobs-apply-button" href="${destination}">Apply</a></div></div>
        <div id="job-details">${description}</div></main>`, "Scaled Customer Success Manager, NA | Serrala | LinkedIn");
    const { extraction, opportunity } = await capture(html, url);
    expect(extraction.extractor).toBe("site:linkedin");
    expect(opportunity.postingDate?.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(opportunity.applicationUrl).toBe(destination);
    expect(opportunity).toMatchObject({ companyName: "Serrala", location: "Canada" });
  });

  it("Easy Apply stays on LinkedIn: no application URL is invented", async () => {
    const html = page("", `<main><div class="job-details-jobs-unified-top-card">
        <div class="job-details-jobs-unified-top-card__job-title"><h1>Scaled Customer Success Manager, NA</h1></div>
        <div class="jobs-apply-button--top-card"><a class="jobs-apply-button" href="https://www.linkedin.com/jobs/view/4300000002/apply/">Easy Apply</a></div></div>
        <div id="job-details">${description}</div></main>`);
    expect((await capture(html, url)).opportunity.applicationUrl).toBeNull();
  });
});

// ------------------------------------------------- Welcome to the Jungle

describe("Welcome to the Jungle (AlphaSense): the structured dates", () => {
  const html = page(jsonLd({
    title: "Customer Success Manager (Corporate)", hiringOrganization: { name: "AlphaSense" }, employmentType: "FULL_TIME",
    datePosted: "2025-10-03T02:01:34.000Z", validThrough: "2026-11-12T02:01:34.000Z",
    jobLocation: { "@type": "Place", address: { addressLocality: "New York", addressCountry: "US" } },
    description: "<p>Partner with corporate customers on research workflows.</p>",
  }), "<main><h1>Customer Success Manager (Corporate)</h1></main>");

  it("validThrough is a rolling expiry there, not a closing date; datePosted is kept as stated", async () => {
    const { raw, opportunity, provenance } = await capture(html, "https://app.welcometothejungle.com/jobs/AbCdEf34");
    expect(opportunity.closingDate).toBeNull();
    expect(JSON.stringify(raw)).not.toContain("2026-11-12");
    expect(opportunity.postingDate?.toISOString()).toBe("2025-10-03T02:01:34.000Z");
    expect(markers(provenance, "postingDate")).toEqual(["postingDate"]);
  });

  it("other sites' validThrough is still the closing date", async () => {
    const { opportunity } = await capture(html, "https://careers.example.test/jobs/alphasense-csm");
    expect(opportunity.closingDate?.toISOString()).toBe("2026-11-12T02:01:34.000Z");
  });
});

// -------------------------------------------- shared reader: label forms

describe("shared reader: label separators and place forms", () => {
  it("a spaced dash separates a label from its value; a hyphenated word does not", () => {
    expect(facts("Location – Boston, MA").location?.value).toBe("Boston, MA");
    expect(facts("Location-based pricing is a plus.").location).toBeNull();
  });

  it("\"Only US\" and \"Anywhere in the US\" name the U.S.; \"Anywhere in the World\" names no place", () => {
    expect(facts("", { pageText: "Anywhere in the US" }).location?.value).toBe("Anywhere in the US");
    expect(facts("", { pageText: "Only US" }).location?.value).toBe("Only US");
    expect(facts("", { pageText: "Anywhere in the World" }).location).toBeNull();
  });
});
