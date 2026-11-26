// Continuous capture's page functions (November 15, 2026), run the way
// Chrome runs them: their source text, serialized and evaluated inside the
// page (a jsdom window) with one plain-JSON argument.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { pageCaptureSiteByKey, pageCaptureSearchIdentity, pageCapturePageNumber, pageCapturePageUrl } from "../../packages/core/src/page-capture";
import { advanceResults, describeResultsPage, type AdvanceResult, type PageDescription } from "../../apps/extension/src/continuation";
import { readResultCards, type ResultCardsReading } from "../../apps/extension/src/results";
import { cardKey } from "../../apps/extension/src/continuous-capture";
import f0 from "../fixtures/page-capture/linkedin-f0-cards.json";
import controls from "../fixtures/page-capture/linkedin-nov15-search-controls.json";
import { linkedInF0ResultsPage } from "../support/linkedin-guest-pages";

const linkedin = pageCaptureSiteByKey("linkedin")!;
const wttj = pageCaptureSiteByKey("welcome-to-the-jungle")!;
const searchUrl = "https://www.linkedin.com/jobs/search?keywords=Customer%20Success&location=New%20York";

function inPage<T>(html: string, url: string, source: string, input: unknown): { result: T; calls: string[] } {
  const window = new JSDOM(html, { url, runScripts: "outside-only" }).window;
  try {
    window.eval(`
      window.__calls = [];
      const record = (name) => function () { window.__calls.push(name); };
      window.scrollTo = record("scrollTo");
      window.scrollBy = record("scrollBy");
      window.open = record("open");
      window.fetch = record("fetch");
      Element.prototype.scrollIntoView = record("scrollIntoView");
      const click = HTMLElement.prototype.click;
      HTMLElement.prototype.click = function () { window.__calls.push("click:" + (this.className || this.tagName)); return click.call(this); };
    `);
    const result = window.eval(`(${source})(${JSON.stringify(input)})`) as T;
    return { result: JSON.parse(JSON.stringify(result)) as T, calls: [...(window.eval("window.__calls") as string[])] };
  } finally {
    window.close();
  }
}

// The real F0 cards, with the real November 15 controls after the list.
const page = (markerShown: boolean) =>
  linkedInF0ResultsPage(f0.cards as string[]).replace(
    "</ul></section>",
    `</ul>${markerShown ? controls.controls.replace(" hidden ", " ") : controls.controls}</section>${controls.header}`,
  );

describe("the results reader in a continuous run", () => {
  it("lists every loaded card's key and leaves out the ones already examined, before the cap; it still never scrolls or clicks", () => {
    const html = linkedInF0ResultsPage(f0.cards as string[]);
    const all = inPage<ResultCardsReading>(html, searchUrl, readResultCards.toString(), { ...linkedin.reader, maxCards: 200, continuous: true, excludeKeys: [] });
    expect(all.result.keys).toHaveLength(5);
    expect(all.result.cards).toHaveLength(5);
    const exclude = all.result.keys!.slice(0, 3);
    const rest = inPage<ResultCardsReading>(html, searchUrl, readResultCards.toString(), { ...linkedin.reader, maxCards: 200, continuous: true, excludeKeys: exclude });
    expect(rest.result.cards.map((card) => cardKey(card.url))).toEqual(all.result.keys!.slice(3));
    expect(rest.result.counts).toMatchObject({ loaded: 5, excluded: 3 });
    expect(rest.result.keys).toEqual(all.result.keys);
    expect([...all.calls, ...rest.calls]).toEqual([]);
    // Every card examined: nothing left, and still the page's keys.
    const none = inPage<ResultCardsReading>(html, searchUrl, readResultCards.toString(), { ...linkedin.reader, maxCards: 200, continuous: true, excludeKeys: all.result.keys });
    expect(none.result).toMatchObject({ cards: [], problem: null });
    // A single save keeps its cap of 25 and its shape.
    const single = inPage<ResultCardsReading>(html, searchUrl, readResultCards.toString(), { ...linkedin.reader, maxCards: 500 });
    expect(single.result.cards).toHaveLength(5);
    expect(single.result).not.toHaveProperty("keys");
  });
});

describe("what the page holds besides readable cards (November 18, 2026)", () => {
  it("counts raw job links, lists the distinct jobs whose cards are not readable yet, and counts jobs only in excluded areas; the single save's output is unchanged", () => {
    const cards = f0.cards as string[];
    // A real card whose content has not rendered yet: its job link without a
    // title (LinkedIn fills appended cards in later).
    const unrendered = cards[0]!
      .replace(/\/jobs\/view\/[^"?]*?(\d{6,})/g, "/jobs/view/placeholder-4499999999")
      .replace(/<h3[\s\S]*?<\/h3>/g, "<h3></h3>")
      .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "")
      .replace(/(<a[^>]*base-card__full-link[^>]*>)[\s\S]*?(<\/a>)/, "$1$2");
    const related = `<section><h2>Similar jobs</h2><ul><li><a href="https://www.linkedin.com/jobs/view/similar-4488888888">Similar role</a></li></ul></section>`;
    const html = linkedInF0ResultsPage([...cards, unrendered]).replace("</main>", `${related}</main>`);
    const reading = inPage<ResultCardsReading>(html, searchUrl, readResultCards.toString(), { ...linkedin.reader, maxCards: 200, continuous: true, excludeKeys: [] }).result;
    expect(reading.keys).toHaveLength(5);
    expect(reading.pageJobs!.unreadableKeys).toEqual(["https://www.linkedin.com/jobs/view/4499999999"]);
    expect(reading.pageJobs!.excludedJobs).toBe(1);
    // Every job link counts once per link (cards may carry more than one).
    expect(reading.pageJobs!.rawLinks).toBeGreaterThanOrEqual(5 + 1 + 1);
    expect(reading.counts.skippedUnloaded).toBe(1);
    const single = inPage<ResultCardsReading>(html, searchUrl, readResultCards.toString(), { ...linkedin.reader, maxCards: 25 }).result;
    expect(single).not.toHaveProperty("pageJobs");
    expect(single.cards).toHaveLength(5);
  });
});

describe("LinkedIn's 'See more jobs' (the real November 15 controls)", () => {
  const input = { buttonSelector: (linkedin.continuation as { buttonSelector: string }).buttonSelector, endSelector: (linkedin.continuation as { endSelector: string }).endSelector, jobLink: linkedin.reader.jobLink };

  it("the fixture is the real markup: the button and the end marker, hidden until the end", () => {
    expect(controls.controls).toContain('<button aria-label="See more jobs" class="infinite-scroller__show-more-button"');
    expect(controls.controls).toMatch(/class="[^"]*\bhidden\b[^"]*see-more-jobs__viewed-all"/);
    expect(controls.controls).toContain("You&#39;ve viewed all jobs for this search");
    expect(controls.cardsOnFirstLoad).toBe(60);
  });

  it("presses the site's own button and scrolls to the last result while the end marker is hidden", () => {
    const { result, calls } = inPage<AdvanceResult>(page(false), searchUrl, advanceResults.toString(), input);
    expect(result.action).toBe("CLICKED");
    expect(result.diagnostics).toMatchObject({ buttonPresent: true, buttonDisabled: false, markerPresent: true, markerVisible: false, headerCount: "4,000+" });
    expect(calls).toEqual(["click:infinite-scroller__show-more-button", "scrollIntoView", "scrollTo"]);
  });

  it("reports the end, and does nothing, once the end marker is shown", () => {
    const { result, calls } = inPage<AdvanceResult>(page(true), searchUrl, advanceResults.toString(), input);
    expect(result.action).toBe("END");
    expect(result.diagnostics.markerVisible).toBe(true);
    expect(calls).toEqual([]);
  });

  it("only looks when asked to check", () => {
    const { result, calls } = inPage<AdvanceResult>(page(false), searchUrl, advanceResults.toString(), { ...input, checkOnly: true });
    expect(result.action).toBe("CHECKED");
    expect(calls).toEqual([]);
  });

  it("the F0 skeleton's button (no marker): pressed", () => {
    const { result } = inPage<AdvanceResult>(`<html><body>${(f0 as { listSkeleton: string }).listSkeleton}</body></html>`, searchUrl, advanceResults.toString(), input);
    expect(result).toMatchObject({ action: "CLICKED", diagnostics: { buttonPresent: true, markerPresent: false } });
  });
});

describe("numbered results pages (describeResultsPage)", () => {
  const spec = wttj.continuation as Extract<NonNullable<typeof wttj.continuation>, { kind: "pages" }>;
  const url = (page: number) => `https://www.welcometothejungle.com/en/jobs?query=customer%20success&page=${page}`;
  const nav = (current: number, last: number, { nextDisabled = false } = {}) =>
    `<nav aria-label="Pagination">${Array.from({ length: last }, (_unused, index) => index + 1)
      .map((number) => `<a href="/en/jobs?query=customer%20success&page=${number}"${number === current ? ' aria-current="page"' : ""}>${number}</a>`)
      .join("")}${current < last ? `<a rel="next" aria-label="Next page" href="/en/jobs?query=customer%20success&page=${current + 1}"${nextDisabled ? ' aria-disabled="true"' : ""}>›</a>` : ""}</nav>`;

  it("reads the active page, the highest page and the next control, without acting", () => {
    const { result, calls } = inPage<PageDescription>(`<html><body><h2>52 jobs</h2>${nav(3, 6)}</body></html>`, url(3), describeResultsPage.toString(), spec);
    expect(result).toMatchObject({ activePage: 3, highestPage: 6, nextPresent: true, nextDisabled: false, nextPage: 4, total: 52, empty: false });
    expect(result.summary).toMatch(/^nav\[Pagination\]/);
    expect(calls).toEqual([]);
  });

  it("on the last page: no next control", () => {
    const { result } = inPage<PageDescription>(`<html><body>${nav(6, 6)}</body></html>`, url(6), describeResultsPage.toString(), spec);
    expect(result).toMatchObject({ activePage: 6, highestPage: 6, nextPresent: false });
  });

  it("no pagination at all: nothing is claimed", () => {
    const { result } = inPage<PageDescription>("<html><body><ul><li>job</li></ul></body></html>", url(2), describeResultsPage.toString(), spec);
    expect(result).toMatchObject({ activePage: null, highestPage: null, nextPresent: false, total: null, summary: "no pagination found" });
  });
});

describe("a search's identity and pages", () => {
  it("LinkedIn's rewritten parameters and WTTJ's page number are not part of the search", () => {
    const base = pageCaptureSearchIdentity(searchUrl, linkedin.continuation!);
    expect(pageCaptureSearchIdentity(`${searchUrl}&currentJobId=4100000001&trk=public_jobs&position=3&pageNum=0`, linkedin.continuation!)).toBe(base);
    expect(pageCaptureSearchIdentity(`${searchUrl.replace("New%20York", "Boston")}`, linkedin.continuation!)).not.toBe(base);
    const first = "https://www.welcometothejungle.com/en/jobs?query=cs&page=1";
    expect(pageCaptureSearchIdentity(pageCapturePageUrl(first, "page", 4), wttj.continuation!)).toBe(pageCaptureSearchIdentity(first, wttj.continuation!));
    expect(pageCapturePageNumber("https://www.welcometothejungle.com/en/jobs?query=cs", "page")).toBe(1);
    expect(pageCapturePageNumber(pageCapturePageUrl(first, "page", 4), "page")).toBe(4);
  });
});
