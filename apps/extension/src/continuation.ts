// Continuous capture's page functions (November 15, 2026). Like the results
// reader (results.ts), each is serialized by chrome.scripting.executeScript
// and runs once in the search tab with one plain-JSON argument: no imports,
// no outside variables, no chrome.*, storage or network. They are the only
// code that acts on a results page, and only as the site itself offers:
// advanceResults presses the site's own "See more jobs" button and scrolls to
// the end of the list, as a person does; describeResultsPage only reads. Page
// navigation (Welcome to the Jungle's numbered pages) is done by the service
// worker through the search address's own page parameter, never by clicking.

export interface AdvanceInput {
  buttonSelector: string;
  endSelector: string;
  jobLink: string;
  // Only look: whether the end marker is shown (nothing is pressed or
  // scrolled).
  checkOnly?: boolean;
}

export interface AdvanceResult {
  action: "END" | "CLICKED" | "SCROLLED" | "CHECKED";
  diagnostics: {
    buttonPresent: boolean;
    buttonVisible: boolean;
    buttonDisabled: boolean;
    markerPresent: boolean;
    markerVisible: boolean;
    cardCount: number;
    headerCount: string | null;
  };
}

// "See more jobs" (LinkedIn's public search; real markup, November 15,
// 2026): when the site's end marker ("You've viewed all jobs for this
// search") is shown, the search is at its end and nothing is done.
// Otherwise the site's own button is pressed when it is there and enabled,
// and the page is scrolled to its last result (the way the site loads more
// as a person scrolls). The marker counts only when it is shown: it is in
// the page from the start, hidden.
export function advanceResults(input: AdvanceInput): AdvanceResult {
  const hasLayout = document.documentElement.getClientRects().length > 0;
  const shown = (element: Element | null): boolean => {
    if (!element) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (node.classList.contains("hidden") || node.hasAttribute("hidden")) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return !hasLayout || element.getClientRects().length > 0;
  };
  const marker = document.querySelector(input.endSelector);
  const button = document.querySelector(input.buttonSelector) as HTMLButtonElement | null;
  const jobLink = new RegExp(input.jobLink, "i");
  const links = [...document.querySelectorAll("a[href]")].filter((anchor) => {
    try {
      return jobLink.test(new URL(anchor.getAttribute("href") ?? "", location.href).toString());
    } catch {
      return false;
    }
  });
  const header = document.querySelector(".results-context-header__job-count");
  const diagnostics: AdvanceResult["diagnostics"] = {
    buttonPresent: button !== null,
    buttonVisible: shown(button),
    buttonDisabled: Boolean(button && (button.disabled || button.getAttribute("aria-disabled") === "true")),
    markerPresent: marker !== null,
    markerVisible: shown(marker),
    cardCount: links.length,
    headerCount: header ? (header.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null : null,
  };
  if (diagnostics.markerVisible) return { action: "END", diagnostics };
  if (input.checkOnly) return { action: "CHECKED", diagnostics };
  let action: AdvanceResult["action"] = "SCROLLED";
  if (button && !diagnostics.buttonDisabled) {
    button.click();
    action = "CLICKED";
  }
  const last = links.at(-1);
  if (last && typeof (last as HTMLElement).scrollIntoView === "function") (last as HTMLElement).scrollIntoView({ block: "end" });
  if (typeof window.scrollTo === "function") window.scrollTo(0, document.documentElement.scrollHeight);
  return { action, diagnostics };
}

export interface DescribeInput {
  pageParam: string;
  nextSelectors: string[];
  activePageSelectors: string[];
  paginationSelectors: string[];
  totalPattern: string | null;
  emptySelectors: string[];
}

export interface PageDescription {
  href: string;
  // The page the pagination marks as current, the highest page number it
  // links to, and its next-page control (absent, or disabled, on the last
  // page); null where the page shows none.
  activePage: number | null;
  highestPage: number | null;
  nextPresent: boolean;
  nextDisabled: boolean;
  nextPage: number | null;
  // A total number of jobs a results heading states ("123 jobs").
  total: number | null;
  // The site's own "no results" state is shown.
  empty: boolean;
  // A short, attribute-only summary of the pagination (for the run's
  // diagnostics: verifying the real markup at live acceptance).
  summary: string;
}

// Reads a numbered results page's pagination without acting on it.
export function describeResultsPage(input: DescribeInput): PageDescription {
  const hasLayout = document.documentElement.getClientRects().length > 0;
  const shown = (element: Element | null): boolean => {
    if (!element) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (node.hasAttribute("hidden")) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return !hasLayout || element.getClientRects().length > 0;
  };
  const pageOf = (href: string | null): number | null => {
    if (!href) return null;
    try {
      const value = new URL(href, location.href).searchParams.get(input.pageParam);
      return value && /^\d{1,5}$/.test(value) ? Number(value) : null;
    } catch {
      return null;
    }
  };
  const numbered = (element: Element) => {
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return /^\d{1,5}$/.test(text) ? Number(text) : pageOf(element.getAttribute("href"));
  };
  // The pagination: the first container (in the site's order of selectors)
  // that holds numbered page links or buttons.
  let pagination: Element | null = null;
  for (const selector of input.paginationSelectors) {
    pagination = [...document.querySelectorAll(selector)].find((candidate) => [...candidate.querySelectorAll("a, button")].some((control) => numbered(control) !== null)) ?? null;
    if (pagination) break;
  }
  const scope: ParentNode = pagination ?? document;
  let activePage: number | null = null;
  for (const selector of input.activePageSelectors) {
    const active = scope.querySelector(selector);
    if (active) {
      activePage = numbered(active);
      if (activePage !== null) break;
    }
  }
  const pageNumbers = pagination ? [...pagination.querySelectorAll("a, button")].map(numbered).filter((value): value is number => value !== null) : [];
  let next: Element | null = null;
  for (const selector of input.nextSelectors) {
    next = scope.querySelector(selector) ?? document.querySelector(selector);
    if (next) break;
  }
  const nextDisabled = Boolean(next && (next.hasAttribute("disabled") || next.getAttribute("aria-disabled") === "true" || !shown(next)));
  let total: number | null = null;
  if (input.totalPattern) {
    const pattern = new RegExp(input.totalPattern, "i");
    for (const element of [...document.querySelectorAll("h1, h2, h3, h4, p, span, div")]) {
      if (element.children.length > 2) continue;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length > 80) continue;
      const match = pattern.exec(text);
      if (match) {
        const value = Number(match[1]!.replace(/[^\d]/g, ""));
        if (Number.isFinite(value) && value > 0) {
          total = value;
          break;
        }
      }
    }
  }
  const empty = input.emptySelectors.some((selector) => [...document.querySelectorAll(selector)].some(shown));
  const describe = (element: Element) =>
    [
      element.tagName.toLowerCase(),
      ...["rel", "aria-label", "aria-current", "aria-disabled", "disabled", "data-testid"].flatMap((name) => (element.hasAttribute(name) ? [`${name}=${(element.getAttribute(name) ?? "").slice(0, 30)}`] : [])),
      `"${(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 12)}"`,
      ...(element.getAttribute("href") ? [`page=${pageOf(element.getAttribute("href")) ?? "-"}`] : []),
    ].join(" ");
  const summary = pagination
    ? [`${pagination.tagName.toLowerCase()}${pagination.getAttribute("aria-label") ? `[${pagination.getAttribute("aria-label")}]` : ""}`, ...[...pagination.querySelectorAll("a, button")].slice(0, 12).map(describe)].join(" | ").slice(0, 600)
    : "no pagination found";
  return {
    href: String(location.href).slice(0, 2048),
    activePage,
    highestPage: pageNumbers.length ? Math.max(...pageNumbers) : null,
    nextPresent: next !== null,
    nextDisabled,
    nextPage: next ? pageOf(next.getAttribute("href")) : null,
    total,
    empty,
    summary,
  };
}
