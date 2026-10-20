// The page reader. chrome.scripting.executeScript serializes this one
// function and runs it once in the active tab's isolated world, only after
// the user pressed "Read this page". It must stay self-contained: no
// imports, no outside variables, no arguments (so nothing from the extension,
// such as the pairing credential, ever enters the page), and no chrome.* or
// cookie access. It reads the DOM and returns plain job-posting fields; it
// never changes the page, inserts HTML, navigates, clicks or makes requests.
//
// Order: schema.org JobPosting data, then (LinkedIn only) a reader limited
// to LinkedIn's job-detail areas, then the user's selected text, then
// (everywhere except LinkedIn) a careful main-content reading. On LinkedIn
// nothing is read outside the job-detail areas and the user's selection, and
// only on a job page. A field the page does not state stays null.

export type PageExtractor = "structured-data" | "site:linkedin" | "selection" | "main-content";

export interface ExtractedPosting {
  title: string | null;
  description: string | null;
  company: string | null;
  location: string | null;
  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "YEAR" | "MONTH" | "WEEK" | "DAY" | "HOUR" | null;
  workplaceType: "REMOTE" | "HYBRID" | "ONSITE" | null;
  employmentType: string | null;
  postedAt: string | null;
  applicationUrl: string | null;
  siteJobId: string | null;
}

export interface PageExtraction {
  pageUrl: string;
  linkedIn: boolean;
  extractor: PageExtractor | null;
  posting: ExtractedPosting | null;
  // The user's selected text, offered as an alternative description.
  selection: { title: string | null; description: string } | null;
  notes: string[];
  problem: "LINKEDIN_NOT_JOB_PAGE" | "NO_JOB_CONTENT" | null;
}

export function extractJobPosting(): PageExtraction {
  const limits = { title: 300, description: 50_000, short: 200, employmentType: 50, postedAt: 40, siteJobId: 100, url: 2048 };
  const notes: string[] = [];

  const line = (value: unknown, max: number): string | null => {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const text = String(value).replace(/\s+/g, " ").trim();
    return text ? text.slice(0, max) : null;
  };
  const block = (value: string): string =>
    value
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const capDescription = (value: string | null): string | null => {
    if (!value) return null;
    if (value.length <= limits.description) return value;
    notes.push("Description shortened to 50,000 characters");
    return value.slice(0, limits.description);
  };

  // Text of an element with block boundaries as line breaks, read from a
  // copy without scripts, styles, forms and navigation.
  const removedInCopies = "script, style, noscript, template, svg, iframe, object, embed, form, button, input, select, textarea, nav, [role=navigation], [aria-hidden=true]";
  const textOf = (element: Element, extraRemoved = ""): string => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll(extraRemoved ? `${removedInCopies}, ${extraRemoved}` : removedInCopies).forEach((node) => node.remove());
    copy.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    copy.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, ul, ol, dl, dt, dd, blockquote, pre").forEach((node) => {
      node.append("\n");
    });
    return block(copy.textContent ?? "");
  };
  // HTML from structured data, read as inert text: a parsed document has no
  // browsing context, so nothing in it runs or loads.
  const htmlText = (value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = new DOMParser().parseFromString(value, "text/html");
    return parsed.body ? textOf(parsed.body) || null : null;
  };
  const httpUrl = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value.trim());
      return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= limits.url ? url.href : null;
    } catch {
      return null;
    }
  };
  const empty = (): ExtractedPosting => ({
    title: null,
    description: null,
    company: null,
    location: null,
    salaryText: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    workplaceType: null,
    employmentType: null,
    postedAt: null,
    applicationUrl: null,
    siteJobId: null,
  });

  const pageUrl = location.href;
  const host = location.hostname.toLowerCase();
  const linkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");
  const linkedInJobId = (() => {
    if (!linkedIn) return null;
    const view = /^\/jobs\/view\/(?:[^/]*-)?(\d{5,20})\/?$/.exec(location.pathname);
    if (view) return view[1]!;
    const current = new URLSearchParams(location.search).get("currentJobId");
    return location.pathname.startsWith("/jobs/") && current && /^\d{5,20}$/.test(current) ? current : null;
  })();
  if (linkedIn && !linkedInJobId) {
    return { pageUrl, linkedIn, extractor: null, posting: null, selection: null, notes, problem: "LINKEDIN_NOT_JOB_PAGE" };
  }

  // 1. schema.org JobPosting (JSON-LD). Only the posting's own fields are
  //    read from it.
  const structured = (): ExtractedPosting | null => {
    const postings: Record<string, unknown>[] = [];
    const visit = (node: unknown, depth: number) => {
      if (depth > 4 || !node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((item) => visit(item, depth + 1));
      const record = node as Record<string, unknown>;
      const type = record["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) postings.push(record);
      if (record["@graph"]) visit(record["@graph"], depth + 1);
    };
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        visit(JSON.parse(script.textContent ?? ""), 0);
      } catch {
        // Malformed structured data is ignored.
      }
    });
    for (const posting of postings) {
      const title = line(posting.title, limits.title);
      const description = capDescription(htmlText(posting.description));
      if (!title || !description) continue;
      const result = empty();
      result.title = title;
      result.description = description;
      const organization = posting.hiringOrganization;
      result.company = line(typeof organization === "object" && organization ? (organization as Record<string, unknown>).name : organization, limits.short);
      const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : [];
      const placeNames = places.flatMap((place) => {
        const address = place && typeof place === "object" ? (place as Record<string, unknown>).address : null;
        if (!address || typeof address !== "object") return [];
        const parts = address as Record<string, unknown>;
        const country = parts.addressCountry && typeof parts.addressCountry === "object" ? (parts.addressCountry as Record<string, unknown>).name : parts.addressCountry;
        const name = [parts.addressLocality, parts.addressRegion, country].map((part) => line(part, limits.short)).filter(Boolean).join(", ");
        return name ? [name] : [];
      });
      result.location = line(placeNames.join("; "), limits.short);
      const locationTypes = [posting.jobLocationType].flat().map((value) => String(value ?? "").toUpperCase());
      if (locationTypes.includes("TELECOMMUTE")) result.workplaceType = "REMOTE";
      result.employmentType = line([posting.employmentType].flat().filter((value) => typeof value === "string").join(", "), limits.employmentType);
      result.postedAt = line(posting.datePosted, limits.postedAt);
      const identifier = posting.identifier;
      const id = line(identifier && typeof identifier === "object" ? (identifier as Record<string, unknown>).value : identifier, limits.siteJobId);
      result.siteJobId = id && !/\s/.test(id) ? id : null;
      const salary = posting.baseSalary && typeof posting.baseSalary === "object" ? (posting.baseSalary as Record<string, unknown>) : null;
      if (salary) {
        const value = salary.value && typeof salary.value === "object" ? (salary.value as Record<string, unknown>) : { value: salary.value };
        const amount = (raw: unknown) => {
          const number = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[,\s]/g, "")) : NaN;
          return Number.isFinite(number) && number >= 0 ? number : null;
        };
        const single = amount(value.value);
        result.salaryMin = amount(value.minValue) ?? single;
        result.salaryMax = amount(value.maxValue) ?? single;
        const currency = line(salary.currency, 3);
        result.salaryCurrency = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null;
        const unit = String(value.unitText ?? salary.unitText ?? "").toUpperCase();
        result.salaryPeriod = unit === "YEAR" || unit === "MONTH" || unit === "WEEK" || unit === "DAY" || unit === "HOUR" ? unit : null;
      }
      if (linkedInJobId) result.siteJobId = linkedInJobId;
      return result;
    }
    return null;
  };

  // 2. LinkedIn: only LinkedIn's job-detail areas (the job's top card and
  //    its description), never the rest of the page.
  const firstText = (selectors: string[], max: number): string | null => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = element ? line(element.textContent, max) : null;
      if (text) return text;
    }
    return null;
  };
  const linkedInTitleSelectors = [
    ".job-details-jobs-unified-top-card__job-title h1",
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    ".top-card-layout__title",
    ".topcard__title",
  ];
  const linkedInReader = (): ExtractedPosting | null => {
    const title = firstText(linkedInTitleSelectors, limits.title);
    const descriptionElement = [
      "#job-details",
      ".jobs-description__content .jobs-box__html-content",
      ".jobs-description-content__text",
      ".jobs-description__content",
      ".show-more-less-html__markup",
      ".description__text",
    ]
      .map((selector) => document.querySelector(selector))
      .find((element) => element && line(element.textContent, 1));
    const description = descriptionElement ? capDescription(textOf(descriptionElement) || null) : null;
    if (!title || !description) return null;
    const result = empty();
    result.title = title;
    result.description = description;
    result.company = firstText(
      [
        ".job-details-jobs-unified-top-card__company-name a",
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name",
        ".topcard__org-name-link",
      ],
      limits.short,
    );
    result.location = firstText(
      [
        ".job-details-jobs-unified-top-card__tertiary-description-container .tvm__text",
        ".job-details-jobs-unified-top-card__bullet",
        ".jobs-unified-top-card__bullet",
        ".topcard__flavor--bullet",
      ],
      limits.short,
    );
    result.salaryText = firstText([".compensation__salary", ".salary.compensation__salary"], limits.short);
    // The public job page states an employer's own apply link here; Easy
    // Apply has none, and none is invented.
    const applyCode = document.querySelector("code#applyUrl");
    const applyComment = applyCode ? [...applyCode.childNodes].find((node) => node.nodeType === Node.COMMENT_NODE)?.nodeValue ?? "" : "";
    const applyMatch = /url=([^&"]+)/.exec(applyComment);
    if (applyMatch) {
      try {
        result.applicationUrl = httpUrl(decodeURIComponent(applyMatch[1]!));
      } catch {
        result.applicationUrl = null;
      }
    }
    result.siteJobId = linkedInJobId;
    return result;
  };

  // 3. The user's selection, if any.
  const selectionText = (() => {
    const selected = window.getSelection()?.toString() ?? "";
    const text = block(selected);
    return text.length >= 20 ? text.slice(0, limits.description) : null;
  })();
  const pageTitle = (): string | null => {
    const fromHeading = linkedIn ? firstText(linkedInTitleSelectors, limits.title) : firstText(["main h1", "[role=main] h1", "article h1", "h1"], limits.title);
    if (fromHeading) return fromHeading;
    // A document title without a notification count; on LinkedIn ("Title |
    // Company | LinkedIn") only its first part.
    const title = document.title.replace(/^\(\d+\)\s*/, "");
    return line(linkedIn ? title.split(" | ")[0] : title, limits.title);
  };
  const selection = selectionText ? { title: pageTitle(), description: selectionText } : null;

  // 4. Everywhere but LinkedIn: the page's main content, without its
  //    navigation, header, footer and side panels.
  const mainContent = (): ExtractedPosting | null => {
    if (linkedIn) return null;
    const root = document.querySelector("main") ?? document.querySelector("[role=main]") ?? document.querySelector("article");
    if (!root) return null;
    const description = capDescription(textOf(root, "header, footer, aside, [role=banner], [role=contentinfo], [role=complementary]") || null);
    if (!description || description.length < 100) return null;
    const result = empty();
    result.title = pageTitle();
    result.description = description;
    if (!result.title) return null;
    notes.push("Read from the page's main content; company and location were not detected");
    return result;
  };

  const fromStructured = structured();
  if (fromStructured) return { pageUrl, linkedIn, extractor: "structured-data", posting: fromStructured, selection, notes, problem: null };
  if (linkedIn) {
    const fromReader = linkedInReader();
    if (fromReader) return { pageUrl, linkedIn, extractor: "site:linkedin", posting: fromReader, selection, notes, problem: null };
  }
  if (selection && selection.title) {
    const result = empty();
    result.title = selection.title;
    result.description = selection.description;
    if (linkedInJobId) result.siteJobId = linkedInJobId;
    return { pageUrl, linkedIn, extractor: "selection", posting: result, selection: null, notes, problem: null };
  }
  const fromMain = mainContent();
  if (fromMain) return { pageUrl, linkedIn, extractor: "main-content", posting: fromMain, selection, notes, problem: null };
  return { pageUrl, linkedIn, extractor: null, posting: null, selection, notes, problem: "NO_JOB_CONTENT" };
}
