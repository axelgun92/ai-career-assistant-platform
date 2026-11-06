// Workstream B, Mode B live-round fixes (November 5, 2026): the offline
// contracts behind the LinkedIn/WTTJ live failures. Offline: no network,
// browser or database. Real-source wording from the E4 evidence is added to
// these tests when that evidence arrives; until then the cases are
// representative, not the postings' own words.
import { describe, expect, it } from "vitest";
import {
  isPageCaptureRefresh,
  pageCaptureIncompleteRefreshes,
  pageCaptureRefreshReason,
  pageCaptureSiteByKey,
  parseGeographyList,
  shouldReplaceApplicationLink,
  type ExtensionCapture,
} from "@ai-career/core";
import { createRetrievedOpportunityNormalizer, explicitArrangementOpen, explicitNoDeadline, explicitSalaryWithheld, parseResidency, readJobTextFacts } from "@ai-career/normalization";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing, genericCareersPage } from "../../apps/web/src/server/extension-capture";
import { formatResidencyEligibility, formatSalary, applicationUrlBasisNotes } from "../../apps/web/src/components/opportunity-facts";
import { refreshText } from "../../apps/web/src/components/extension/page-capture-labels";
import { runExtractor } from "../support/extension-pages";
import { linkedInGuestJobPage } from "../support/linkedin-guest-pages";

const capturedAt = new Date("2026-11-05T15:00:00.000Z");
const normalizer = createRetrievedOpportunityNormalizer();

function capture(html: string, url: string): ExtensionCapture {
  const built = buildCaptureEnvelope(runExtractor(html, url), "page", { extensionVersion: "0.3.0", capturedAt });
  if (!built.ok) throw new Error(built.problems.join("; "));
  return built.envelope;
}
async function normalized(html: string, url: string) {
  const { raw } = capturedListing(capture(html, url), { pairingId: "p", domain: "customer-success", receivedAt: capturedAt, method: "batch" });
  return { raw, ...(await normalizer.normalize(raw)) };
}

// ------------------------------------------------- application routes

describe("LinkedIn application route", () => {
  const url = "https://www.linkedin.com/jobs/view/4483410074";
  const page = (extra = "") =>
    linkedInGuestJobPage({
      id: "4483410074",
      title: "Customer Success Manager",
      company: "Critical Start",
      location: "Tallahassee, FL",
      descriptionHtml: "<p>Own onboarding and renewals for enterprise security customers. Learn more at https://www.criticalstart.com/careers/.</p>",
    }).replace("</h4>", `</h4>${extra}`);

  it("keeps the employer's own link the page states (LinkedIn's external-apply redirect)", async () => {
    const destination = "https://boards.greenhouse.io/criticalstart/jobs/123456";
    const { opportunity, provenance } = await normalized(
      page(`<code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/4483410074?url=${encodeURIComponent(destination)}&urlHash=abcd"--></code>`),
      url,
    );
    expect(opportunity.applicationUrl).toBe(destination);
    expect(provenance.find((row) => row.fieldName === "applicationUrl")?.sourceField).toBe("page:apply-link");
  });

  it("falls back to the job's own LinkedIn listing, labelled, when no employer link is on the page; never a careers page in the description", async () => {
    const { opportunity, provenance, raw } = await normalized(page(`<button class="sign-up-modal__outlet top-card-layout__cta">Apply</button>`), url);
    expect(opportunity.applicationUrl).toBe(url);
    expect(provenance.find((row) => row.fieldName === "applicationUrl")?.sourceField).toBe("listing:apply-on-site");
    expect(applicationUrlBasisNotes["listing:apply-on-site"]).toMatch(/^Apply on LinkedIn \(listing page\)/);
    // The fallback never changes the listing's content hash.
    const { raw: plain } = capturedListing(capture(page(), url), { pairingId: "p", domain: "customer-success", receivedAt: capturedAt });
    expect(raw.retrieval?.contentHash).toBe(plain.retrieval?.contentHash);
  });

  it("never takes a careers site's front page as the application link", async () => {
    for (const careers of ["https://www.criticalstart.com/careers/", "https://www.example.com/jobs", "https://careers.example.com/", "https://www.example.com/en/join-us"]) {
      expect(genericCareersPage(careers), careers).toBe(true);
    }
    for (const job of ["https://www.criticalstart.com/careers/customer-success-manager-123", "https://jobs.ashbyhq.com/beam-up/593b0a6b-32f9-4a7c-a8d7-5e8ecb845760", "https://servicetitan.wd1.myworkdayjobs.com/en-US/ServiceTitan/job/US-Remote/Customer-Success-Manager_JR115657-1"]) {
      expect(genericCareersPage(job), job).toBe(false);
    }
    const { opportunity } = await normalized(
      page(`<code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/4483410074?url=${encodeURIComponent("https://www.criticalstart.com/careers/")}&urlHash=abcd"--></code>`),
      url,
    );
    expect(opportunity.applicationUrl).toBe(url);
  });

  it("ranks the fallback below every real link, and never lets it replace one", () => {
    const base = { currentIsManual: false, currentCategory: "JOB_BOARD" as const, candidateCategory: "JOB_BOARD" as const };
    expect(shouldReplaceApplicationLink({ ...base, currentUrl: "https://employer.example/apply", candidateUrl: "https://www.linkedin.com/jobs/view/1", candidateIsFallback: true })).toBe(false);
    expect(shouldReplaceApplicationLink({ ...base, currentUrl: "https://www.linkedin.com/jobs/view/1", currentIsFallback: true, candidateUrl: "https://employer.example/apply" })).toBe(true);
    expect(shouldReplaceApplicationLink({ ...base, currentUrl: null, candidateUrl: "https://www.linkedin.com/jobs/view/1", candidateIsFallback: true })).toBe(true);
    // A link the user entered stays.
    expect(shouldReplaceApplicationLink({ ...base, currentIsManual: true, currentUrl: "https://mine.example", currentIsFallback: false, candidateUrl: "https://employer.example/apply" })).toBe(false);
  });
});

// ------------------------------------------------- residency exclusions

describe("residency exclusions", () => {
  const fifteen =
    "Alaska, California, Hawaii, Louisiana, Mississippi, Montana, New Hampshire, North Dakota, Oregon, Pennsylvania, Rhode Island, Vermont, Washington, West Virginia, and Wyoming";
  const codes = ["US-AK", "US-CA", "US-HI", "US-LA", "US-MS", "US-MT", "US-NH", "US-ND", "US-OR", "US-PA", "US-RI", "US-VT", "US-WA", "US-WV", "US-WY"];

  it("reads a list to its end: 'Oregon' is not 'or'", () => {
    expect(parseGeographyList("Montana, Oregon, Pennsylvania")).toEqual(["US-MT", "US-OR", "US-PA"]);
    expect(parseGeographyList("Texas, or Florida")).toEqual(["US-TX", "US-FL"]);
  });

  it("reads the three explicit forms, keeping the residency rule they qualify", () => {
    const withRule = parseResidency({ location: null, rawText: `Candidates must reside in the United States, excluding residents of ${fifteen}.`, remote: true });
    expect(withRule).toMatchObject({ requirement: "US_REQUIRED", regions: ["US"], exclusions: codes, unknownReason: null });
    const notEligible = parseResidency({ location: null, rawText: `Candidates residing in ${fifteen} are not eligible for this role.`, remote: true });
    expect(notEligible.exclusions).toEqual(codes);
    const unable = parseResidency({ location: null, rawText: "We are unable to hire candidates in the following states: Alaska, California, Hawaii.", remote: true });
    expect(unable.exclusions).toEqual(["US-AK", "US-CA", "US-HI"]);
  });

  it("reads nothing it cannot read completely: a lone ambiguous name, or an unknown item, leaves the sentence as before", () => {
    expect(parseResidency({ location: null, rawText: "Remote within the US except Washington.", remote: true }).exclusions).toEqual([]);
    const partial = parseResidency({ location: null, rawText: "Candidates must reside in the United States, excluding residents of Alaska and Narnia.", remote: true });
    expect(partial.exclusions).toEqual([]);
    expect(partial.unknownReason).toBe("QUALIFIED_STATEMENT");
    // A statement with no exclusion is unchanged.
    expect(parseResidency({ location: null, rawText: "Applicants must reside in the United States.", remote: true })).toMatchObject({ requirement: "US_REQUIRED", exclusions: [] });
  });

  it("shows the exclusions with the rule, and never as work authorization", () => {
    expect(formatResidencyEligibility("US_REQUIRED", ["US"], ["US-AK", "US-CA"])).toBe("U.S. residence required, excluding: Alaska, California");
    expect(formatResidencyEligibility(null, [], ["US-AK"])).toBe("Not eligible: Alaska");
    expect(formatResidencyEligibility("US_REQUIRED", ["US"], [])).toBe("U.S. residence required");
    expect(formatResidencyEligibility(null, [], [])).toBeNull();
  });
});

// ------------------------------------------------- regional salary

describe("country salary tiers and the primary range", () => {
  const juniper = "The base salary range for this role is $86,000 - $95,000 USD in the U.S. and $77,000 - $85,000 CAD in Canada.";
  const testPage = (description: string, location: string) =>
    `<!doctype html><html><head><title>CSM</title><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Customer Success Manager", hiringOrganization: { name: "Juniper Square" }, description, jobLocation: { address: { addressLocality: location } } })}</script></head><body><main><h1>Customer Success Manager</h1></main></body></html>`;

  it("reads country-labelled ranges in one sentence as tiers, each in its own currency, never combined", () => {
    expect(readJobTextFacts({ text: juniper } as never).compensationTiers?.tiers.map((tier) => tier.label)).toEqual(["United States", "Canada"]);
  });

  it("makes the U.S. tier the role's range only when the posting's evidence names the U.S. alone", async () => {
    const usOnly = await normalized(testPage(`<p>Own a book of customers.</p><p>${juniper}</p>`, "Denver, CO, United States"), "https://careers.example.test/jobs/1");
    expect(usOnly.opportunity).toMatchObject({ salaryMin: 86000, salaryMax: 95000, currency: "USD" });
    expect(usOnly.opportunity.compensationTiers.map((tier) => [tier.label, tier.currency])).toEqual([["United States", "USD"], ["Canada", "CAD"]]);
    expect(usOnly.provenance.find((row) => row.fieldName === "salaryMin")?.sourceField).toBe("rawText:compensation-tier-primary");
    // The posting opens Canada too: no primary.
    const both = await normalized(testPage(`<p>We hire across the United States and Canada.</p><p>${juniper}</p>`, "Denver, CO, United States"), "https://careers.example.test/jobs/2");
    expect(both.opportunity).toMatchObject({ salaryMin: null, salaryMax: null });
    expect(both.opportunity.compensationTiers).toHaveLength(2);
    expect(formatSalary(both.opportunity)).toBe("United States: 86,000–95,000 USD · Canada: 77,000–85,000 CAD");
  });

  it("reads 'Canadian base salary' as Canada's tier", async () => {
    const result = await normalized(testPage("<p>Own a book.</p><p>U.S. base salary: $86,000 - $95,000 USD</p><p>Canadian base salary: $77,000 - $85,000 CAD</p>", "Denver, CO, United States"), "https://careers.example.test/jobs/3");
    expect(result.opportunity.compensationTiers.map((tier) => tier.label)).toEqual(["United States", "Canada"]);
  });

  it("never picks a primary among zones of one country", async () => {
    const zones = "The pay range for this role is $76,900 - $115,300 USD in Zone 1 (CA, NY) and $71,800 - $107,800 USD in Zone 2 (all other U.S. locations).";
    const result = await normalized(testPage(`<p>Remote.</p><p>${zones}</p>`, "Remote, United States"), "https://careers.example.test/jobs/4");
    expect(result.opportunity).toMatchObject({ salaryMin: null, salaryMax: null });
    expect(result.opportunity.compensationTiers).toHaveLength(2);
  });
});

// ------------------------------------------------- explicit withdrawal

describe("explicit withdrawal evidence", () => {
  it("recognizes only explicit no-deadline statements", () => {
    expect(explicitNoDeadline("Applications are accepted on a rolling basis.")).toMatch(/rolling basis/);
    expect(explicitNoDeadline("This position is open until filled.")).toMatch(/open until filled/);
    expect(explicitNoDeadline("There is no application deadline for this role.")).toMatch(/no application deadline/);
    expect(explicitNoDeadline("Remote: Not specified")).toBeNull();
    expect(explicitNoDeadline("Deadline: Unknown")).toBeNull();
    expect(explicitNoDeadline("Apply by November 20, 2026.")).toBeNull();
  });

  it("recognizes only explicit statements that pay is withheld", () => {
    expect(explicitSalaryWithheld("Salary: not disclosed.")).toBe("Salary: not disclosed");
    expect(explicitSalaryWithheld("Compensation is confidential and discussed at offer stage.")).toMatch(/Compensation is confidential/);
    expect(explicitSalaryWithheld("We do not publicly disclose salary ranges.")).toMatch(/do not publicly disclose salary/);
    expect(explicitSalaryWithheld("The base salary range is undisclosed.")).toMatch(/undisclosed/);
    // Template labels, vague pay words and absence are never withdrawals.
    for (const text of ["Salary: Not specified", "Salary: Unknown", "Competitive salary and equity.", "Salary negotiable, DOE.", "Compensation: N/A", "", null]) {
      expect(explicitSalaryWithheld(text), String(text)).toBeNull();
    }
    // An unrelated "confidential" or "not disclosed" is not about pay.
    expect(explicitSalaryWithheld("Customer data is confidential. Pricing is not disclosed to partners.")).toBeNull();
  });

  it("recognizes only explicit statements that the work arrangement is undecided", () => {
    expect(explicitArrangementOpen("Work arrangement: to be determined.")).toBe("Work arrangement: to be determined");
    expect(explicitArrangementOpen("Remote eligibility is TBD for this team.")).toMatch(/Remote eligibility is TBD/);
    expect(explicitArrangementOpen("Whether this role is remote or hybrid will be decided with the hiring manager.")).toMatch(/will be decided/);
    for (const text of ["Remote: Not specified", "Remote: Unknown", "Location: TBD", "Start date to be determined.", "Hybrid.", "", null]) {
      expect(explicitArrangementOpen(text), String(text)).toBeNull();
    }
  });
});

// ------------------------------------------------- selective refresh

describe("selective re-observation policy", () => {
  const policy = pageCaptureSiteByKey("linkedin")!.refresh;
  const now = new Date("2026-11-06T12:00:00.000Z");
  const read = (overrides: Partial<{ readerRevision: number; readQuality: "COMPLETE" | "PARTIAL" | null; lastReadAt: Date }> = {}) => ({
    readerRevision: 1,
    readQuality: "COMPLETE" as const,
    lastReadAt: new Date(now.getTime() - 60_000),
    ...overrides,
  });
  const reason = (latestRead: ReturnType<typeof read>, extra: Partial<{ hasApplicationRoute: boolean; hasDescription: boolean; incompleteRefreshes: number }> = {}) =>
    pageCaptureRefreshReason({ policy, latestRead, hasApplicationRoute: true, hasDescription: true, incompleteRefreshes: 0, now, ...extra });

  it("reads a record made by an older reader again (the November 4–5 records), whatever its age", () => {
    expect(policy).toEqual({ minReaderRevision: 1, incompleteRefreshAfterHours: 24, maxIncompleteRefreshes: 3, staleAfterDays: 14 });
    expect(reason(read({ readerRevision: 0 }))).toBe("OUTDATED_READER");
  });

  it("reads an incomplete record again only after the interval, at most three times in a row", () => {
    expect(reason(read({ readQuality: "PARTIAL" }))).toBeNull();
    const dayOld = read({ readQuality: "PARTIAL", lastReadAt: new Date(now.getTime() - 24 * 3_600_000) });
    expect(reason(dayOld)).toBe("INCOMPLETE");
    expect(reason(read({ lastReadAt: dayOld.lastReadAt }), { hasApplicationRoute: false })).toBe("INCOMPLETE");
    expect(reason(dayOld, { incompleteRefreshes: 3 })).toBeNull();
  });

  it("reads a stale record again after 14 days, and a complete recent one never", () => {
    expect(reason(read({ lastReadAt: new Date(now.getTime() - 14 * 86_400_000) }))).toBe("STALE");
    expect(reason(read({ lastReadAt: new Date(now.getTime() - 13 * 86_400_000) }))).toBeNull();
  });

  it("keeps its state in the job's lastReason, and labels each ending without claiming a change it did not make", () => {
    expect(isPageCaptureRefresh("REFRESH:2")).toBe(true);
    expect(isPageCaptureRefresh("REFRESHED:CHANGED:0")).toBe(false);
    expect(pageCaptureIncompleteRefreshes("REFRESHED:UNCHANGED:2")).toBe(2);
    expect(pageCaptureIncompleteRefreshes("REFRESH_FAILED:1")).toBe(1);
    expect(pageCaptureIncompleteRefreshes(null)).toBe(0);
    expect(refreshText("REFRESH:0")).toBe("Reading again to update");
    expect(refreshText("REFRESHED:CHANGED:0")).toBe("Updated from a new read");
    expect(refreshText("REFRESHED:UNCHANGED:1")).toBe("Read again: no change");
    expect(refreshText("REFRESH_UNAVAILABLE:0")).toMatch(/saved job is unchanged/);
    // Dated only by the recorded time its page was opened; never invented.
    expect(refreshText("REFRESH_UNAVAILABLE:0", "2026-11-06T15:04:00.000Z")).toBe("Read again on 2026-11-06: the listing was no longer available; the saved job is unchanged");
    expect(refreshText("REFRESH_UNAVAILABLE:0", null)).toBe("Read again: the listing is no longer available; the saved job is unchanged");
    expect(refreshText("REFRESH_UNAVAILABLE:0", "not a date")).toBe("Read again: the listing is no longer available; the saved job is unchanged");
    expect(refreshText("REFRESH_DEFERRED:0")).toMatch(/restricted access; the saved job is unchanged/);
    expect(refreshText("REFRESH_FAILED:0")).toMatch(/saved job is unchanged/);
    expect(refreshText("UNREADABLE")).toBeNull();
  });
});
