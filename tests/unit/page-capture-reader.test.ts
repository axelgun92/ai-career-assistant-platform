// Mode B: the extension's results-page reader on synthetic pages, run as
// Chrome runs it (serialized, evaluated in the page, the site's spec as its
// only argument). Covers loaded-only reading, the 25-card cap, placeholders
// and hidden cards, excluded areas and related-job lists, card/field
// isolation, duplicates, sign-in or challenge pages, and that the reader
// never scrolls, clicks, opens windows, navigates or makes requests.
import { describe, expect, it } from "vitest";
import { readResultCards } from "../../apps/extension/src/results";
import { linkedInResultsPage, runResultsReader, testSiteResultsPage, wttjResultsPage } from "../support/page-capture-pages";

const linkedInSearch = "https://www.linkedin.com/jobs/search/?keywords=customer%20success&currentJobId=8888888888";

describe("the results-page reader", () => {
  it("is one self-contained function taking only the site spec, with no storage, cookie, network, click, scroll or navigation access", () => {
    const source = readResultCards.toString();
    expect(readResultCards.length).toBe(1);
    for (const forbidden of ["chrome.", "document.cookie", "fetch(", "XMLHttpRequest", "sendBeacon", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "localStorage", "sessionStorage", "indexedDB", ".click(", "scroll", "location.assign", "location.replace", "location.href =", "window.open", ".submit("]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("reads LinkedIn's loaded job cards with their own fields, and nothing from the header, detail pane, recommendations or messages", () => {
    const result = runResultsReader(
      linkedInResultsPage([
        { id: "4100000001", title: "Customer Success Manager", company: "Northwind", location: "Austin, TX (Remote)", posted: "3 days ago" },
        { id: "4100000002", title: "Senior CSM", company: "Contoso", location: "United States (Remote)", posted: "1 week ago" },
      ]),
      linkedInSearch,
      "linkedin",
    );
    expect(result.problem).toBeNull();
    expect(result.cards).toEqual([
      { url: "https://www.linkedin.com/jobs/view/4100000001", title: "Customer Success Manager", siteJobId: "4100000001", company: "Northwind", location: "Austin, TX (Remote)", postedText: "3 days ago" },
      { url: "https://www.linkedin.com/jobs/view/4100000002", title: "Senior CSM", siteJobId: "4100000002", company: "Contoso", location: "United States (Remote)", postedText: "1 week ago" },
    ]);
    const text = JSON.stringify(result.cards);
    for (const decoy of ["9999999999", "8888888888", "7777777777", "6666666666", "Alex Example", "Private detail", "Viewed"]) expect(text).not.toContain(decoy);
    expect(result.calls).toEqual([]);
  });

  it("skips cards the page has not rendered yet and hidden cards, and counts them, never inventing one", () => {
    const result = runResultsReader(
      linkedInResultsPage([{ id: "4100000001" }, { id: "4100000002", unloaded: true }, { id: "4100000003", hidden: true }, { id: "4100000004" }]),
      linkedInSearch,
      "linkedin",
    );
    expect(result.cards.map((card) => card.siteJobId)).toEqual(["4100000001", "4100000004"]);
    expect(result.counts).toEqual({ loaded: 2, skippedUnloaded: 2, overCap: 0 });
  });

  it("reads at most 25 cards, in page order, and reports how many more were loaded", () => {
    const cards = Array.from({ length: 31 }, (_, index) => ({ id: String(4200000000 + index) }));
    const result = runResultsReader(linkedInResultsPage(cards), linkedInSearch, "linkedin");
    expect(result.cards).toHaveLength(25);
    expect(result.cards[0]!.siteJobId).toBe("4200000000");
    expect(result.cards[24]!.siteJobId).toBe("4200000024");
    expect(result.counts).toEqual({ loaded: 31, skippedUnloaded: 0, overCap: 6 });
    expect(result.calls).toEqual([]);
  });

  it("reads Welcome to the Jungle cards through the generic reading, leaving unstated fields Unknown, and not the similar-jobs block", () => {
    const result = runResultsReader(wttjResultsPage([{ id: "1" }, { id: "2", title: "Customer Success Lead" }]), "https://www.welcometothejungle.com/en/jobs?query=customer%20success", "welcome-to-the-jungle");
    expect(result.cards.map(({ url, title, company, location, postedText, siteJobId }) => ({ url, title, company, location, postedText, siteJobId }))).toEqual([
      { url: "https://www.welcometothejungle.com/en/companies/acme-1/jobs/customer-success-manager_paris-1?q=abc&o=1", title: "Customer Success Manager 1", company: null, location: null, postedText: null, siteJobId: null },
      { url: "https://www.welcometothejungle.com/en/companies/acme-2/jobs/customer-success-manager_paris-2?q=abc&o=1", title: "Customer Success Lead", company: null, location: null, postedText: null, siteJobId: null },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/similar-role|nav-job/);
  });

  it("keeps each card's fields inside its own card when cards sit side by side", () => {
    const result = runResultsReader(
      testSiteResultsPage([
        { id: "a1", title: "CSM One", company: "First Co", location: "Remote", posted: "today" },
        { id: "b2", title: "CSM Two", company: "Second Co", location: "Berlin", posted: "yesterday" },
      ]),
      "https://jobs.e2e.invalid/search",
      "e2e-results",
    );
    expect(result.cards).toEqual([
      { url: "https://jobs.e2e.invalid/jobs/a1", title: "CSM One", siteJobId: "a1", company: "First Co", location: "Remote", postedText: "today" },
      { url: "https://jobs.e2e.invalid/jobs/b2", title: "CSM Two", siteJobId: "b2", company: "Second Co", location: "Berlin", postedText: "yesterday" },
    ]);
  });

  it("reads one card per job when the same job is linked more than once", () => {
    const page = linkedInResultsPage([{ id: "4100000001" }]).replace(
      "</ul></div>",
      `<li data-occludable-job-id="4100000001"><a href="/jobs/view/customer-success-4100000001/">Customer Success Manager (repeat)</a></li></ul></div>`,
    );
    const result = runResultsReader(page, linkedInSearch, "linkedin");
    expect(result.cards.map((card) => card.siteJobId)).toEqual(["4100000001"]);
  });

  it("reads nothing from a sign-in, checkpoint or challenge page", () => {
    expect(runResultsReader(linkedInResultsPage([{ id: "4100000001" }]), "https://www.linkedin.com/authwall?trk=x", "linkedin").problem).toBe("FRICTION");
    const captcha = linkedInResultsPage([{ id: "4100000001" }]).replace("<main", '<iframe src="https://example.com/captcha"></iframe><main');
    const result = runResultsReader(captcha, linkedInSearch, "linkedin");
    expect(result.problem).toBe("FRICTION");
    expect(result.cards).toEqual([]);
  });

  it("says when no loaded job card is found", () => {
    const result = runResultsReader(linkedInResultsPage([{ id: "4100000001", unloaded: true }]), linkedInSearch, "linkedin");
    expect(result.problem).toBe("NO_CARDS");
    expect(result.counts.skippedUnloaded).toBe(1);
  });

  it("keeps hostile card text inert", () => {
    const result = runResultsReader(
      testSiteResultsPage([{ id: "x1", title: "<img src=x onerror=alert(1)> CSM", company: "Evil\u0000Co" }]),
      "https://jobs.e2e.invalid/search",
      "e2e-results",
    );
    expect(result.cards[0]!.title).toBe("<img src=x onerror=alert(1)> CSM");
    expect(result.cards[0]!.company).toBe("EvilCo");
  });
});
