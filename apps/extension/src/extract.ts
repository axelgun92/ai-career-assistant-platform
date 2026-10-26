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
  closingDate: string | null;
  applicationUrl: string | null;
  applicationUrlBasis: ApplicationEvidenceBasis | null;
  siteJobId: string | null;
  // Where a remote role may be done from, as the page's structured data
  // names it (applicantLocationRequirements): place names, never an office.
  remoteLocations: string[];
  // A seniority label the page's own job metadata states, as stated.
  seniority: string | null;
}

// How the page shows where to apply (see the envelope's applicationUrlBasis).
export type ApplicationEvidenceBasis = "PAGE_APPLY_LINK" | "PAGE_APPLICATION_FORM" | "STRUCTURED_DIRECT_APPLY";

export interface PageExtraction {
  pageUrl: string;
  linkedIn: boolean;
  extractor: PageExtractor | null;
  posting: ExtractedPosting | null;
  // The user's selected text, offered as an alternative description.
  selection: { title: string | null; description: string } | null;
  // The document's title, as neutral page context for Core (which may read
  // the employer from it). Never sent from LinkedIn.
  pageTitle: string | null;
  // The job's bounded page content around a structured description or a
  // selection (for example a "Remote Type: Hybrid" row beside it), as plain
  // neutral context for Core, which reads only labelled values from it.
  // Never sent from LinkedIn, and null when the description already is the
  // page's main content.
  pageText: string | null;
  // Where to apply, as the page itself shows it (not on LinkedIn, whose
  // reader takes only the job's stated apply link): the page holds the
  // application form, its structured data says it is applied to directly,
  // or one explicit "Apply" link names a destination.
  application: { url: string | null; basis: ApplicationEvidenceBasis } | null;
  notes: string[];
  problem: "LINKEDIN_NOT_JOB_PAGE" | "NO_JOB_CONTENT" | null;
}

export function extractJobPosting(): PageExtraction {
  const limits = { title: 300, description: 50_000, pageText: 20_000, short: 200, employmentType: 50, postedAt: 40, siteJobId: 100, url: 2048 };
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
  // A list of other jobs ("Related Jobs", "Similar roles", "More jobs from
  // …") is never part of this job: the heading and what it introduces are
  // left out (its own container, or, when that container also holds the
  // job's title, everything after the heading in it).
  const otherJobsHeading =
    /^(?:(?:related|similar|recommended|recent|latest|more|other)(?:\s+(?:open|remote))?\s+(?:jobs|roles|positions|openings|listings)(?:\s+(?:at|from|like|for you)\b.*)?|you may also like|people also viewed)$/i;
  const withoutOtherJobs = (copy: Element) => {
    for (const heading of [...copy.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")]) {
      const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
      // (A copy is not in the document: containment, not isConnected.)
      if (!copy.contains(heading) || text.length > 60 || !otherJobsHeading.test(text)) continue;
      const container = heading.parentElement;
      if (!container || container === copy || container.querySelector("h1")) {
        let next = heading.nextElementSibling;
        while (next) {
          const after = next.nextElementSibling;
          next.remove();
          next = after;
        }
        heading.remove();
      } else {
        container.remove();
      }
    }
  };
  // `lines`: every visible item on its own line (page context, where a label
  // and its value are often separate inline elements: "Visa Sponsorship"
  // "Not Available").
  const textOf = (element: Element, extraRemoved = "", lines = false): string => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll(extraRemoved ? `${removedInCopies}, ${extraRemoved}` : removedInCopies).forEach((node) => node.remove());
    withoutOtherJobs(copy);
    copy.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    copy.querySelectorAll(lines ? "*" : "p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, ul, ol, dl, dt, dd, blockquote, pre").forEach((node) => {
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
    closingDate: null,
    applicationUrl: null,
    applicationUrlBasis: null,
    siteJobId: null,
    remoteLocations: [],
    seniority: null,
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
    return { pageUrl, linkedIn, extractor: null, posting: null, selection: null, pageTitle: null, pageText: null, application: null, notes, problem: "LINKEDIN_NOT_JOB_PAGE" };
  }
  // The tab's title without a notification count. It is not interpreted
  // here: Core decides what, if anything, it states.
  const documentTitle = linkedIn ? null : line(document.title.replace(/^\(\d+\)\s*/, ""), limits.title);

  // 1. schema.org JobPosting (JSON-LD). Only the posting's own fields are
  //    read from it.
  let directApply = false;
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
    // A posting with its own description is preferred over one without.
    let partial: ExtractedPosting | null = null;
    for (const posting of postings) {
      const title = line(posting.title, limits.title);
      // Structured data without a description still states the posting's
      // own fields; the description is then read from the page's main
      // content (below).
      const description = capDescription(htmlText(posting.description));
      if (!title) continue;
      const result = empty();
      result.title = title;
      result.description = description;
      const organization = posting.hiringOrganization;
      result.company = line(typeof organization === "object" && organization ? (organization as Record<string, unknown>).name : organization, limits.short);
      const named = (value: unknown): string | null => {
        if (typeof value === "string") return line(value, limits.short);
        if (!value || typeof value !== "object") return null;
        const record = value as Record<string, unknown>;
        return line(record.name, limits.short) ?? named(record.addressCountry) ?? named(record.address);
      };
      const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : [];
      const readPlaces = places.flatMap((place) => {
        const address = place && typeof place === "object" ? (place as Record<string, unknown>).address : null;
        if (!address || typeof address !== "object") return [];
        const parts = address as Record<string, unknown>;
        const country = parts.addressCountry && typeof parts.addressCountry === "object" ? (parts.addressCountry as Record<string, unknown>).name : parts.addressCountry;
        const name = [parts.addressLocality, parts.addressRegion, country].map((part) => line(part, limits.short)).filter(Boolean).join(", ");
        return name ? [{ name, office: Boolean(line(parts.addressLocality, limits.short) || line(parts.streetAddress, limits.short)) }] : [];
      });
      const locationTypes = [posting.jobLocationType].flat().map((value) => String(value ?? "").toUpperCase());
      const remote = locationTypes.includes("TELECOMMUTE");
      if (remote) result.workplaceType = "REMOTE";
      // A remote posting's jobLocation with a street or city is an office
      // (schema.org: where the business is), not where the role is done;
      // a country or region alone still is the role's place.
      result.location = line(readPlaces.filter((place) => !remote || !place.office).map((place) => place.name).join("; "), limits.short);
      const requirements = [posting.applicantLocationRequirements].flat().map(named).filter((name): name is string => Boolean(name));
      result.remoteLocations = [...new Set(requirements)].slice(0, 10);
      result.employmentType = line([posting.employmentType].flat().filter((value) => typeof value === "string").join(", "), limits.employmentType);
      result.postedAt = line(posting.datePosted, limits.postedAt);
      result.closingDate = line(posting.validThrough, limits.postedAt);
      directApply = posting.directApply === true || posting.directApply === "true";
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
      if (result.description) return result;
      partial ??= result;
    }
    return partial;
  };

  // 1b. schema.org JobPosting as microdata (itemprop attributes in the page,
  //     as some ATS pages publish it): the same posting fields.
  const microdata = (): ExtractedPosting | null => {
    const scope = document.querySelector('[itemscope][itemtype*="schema.org/JobPosting" i]');
    if (!scope) return null;
    const value = (element: Element | null): string | null => {
      if (!element) return null;
      const content = element.getAttribute("content") ?? (element.tagName === "TIME" ? element.getAttribute("datetime") : null);
      return line(content ?? element.textContent, limits.short);
    };
    const property = (root: Element, name: string) => root.querySelector(`[itemprop~="${name}"]`);
    const title = value(property(scope, "title"));
    if (!title) return null;
    const result = empty();
    result.title = title;
    const descriptionElement = property(scope, "description");
    result.description = descriptionElement ? capDescription(textOf(descriptionElement) || null) : null;
    const organization = property(scope, "hiringOrganization");
    result.company = organization ? value(property(organization, "name")) ?? value(organization) : null;
    const placeNames = [...scope.querySelectorAll('[itemprop~="jobLocation"]')].flatMap((place) => {
      const name = ["addressLocality", "addressRegion", "addressCountry"].map((part) => value(property(place, part))).filter(Boolean).join(", ");
      return name ? [name] : [];
    });
    const remote = /telecommute/i.test(value(property(scope, "jobLocationType")) ?? "");
    if (remote) result.workplaceType = "REMOTE";
    result.location = remote ? null : line(placeNames.join("; "), limits.short);
    result.employmentType = line(value(property(scope, "employmentType")), limits.employmentType);
    result.postedAt = line(value(property(scope, "datePosted")), limits.postedAt);
    result.closingDate = line(value(property(scope, "validThrough")), limits.postedAt);
    const requirements = [...scope.querySelectorAll('[itemprop~="applicantLocationRequirements"]')]
      .map((element) => value(property(element, "name")) ?? value(element))
      .filter((name): name is string => Boolean(name));
    result.remoteLocations = [...new Set(requirements)].slice(0, 10);
    return result;
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
    // The job's own criteria list ("Seniority level", "Employment type"), as
    // the public job page shows it and the automated LinkedIn reader reads
    // it, and the posting's stated age ("2 weeks ago").
    for (const item of document.querySelectorAll(".description__job-criteria-item")) {
      const label = line(item.querySelector(".description__job-criteria-subheader, h3")?.textContent, limits.short)?.toLowerCase();
      const value = line(item.querySelector(".description__job-criteria-text, span")?.textContent, limits.short);
      if (!label || !value) continue;
      if (label === "seniority level") result.seniority = value;
      if (label === "employment type") result.employmentType = line(value, limits.employmentType);
    }
    result.postedAt = firstText([".posted-time-ago__text", ".jobs-unified-top-card__posted-date"], limits.postedAt);
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
      if (result.applicationUrl) result.applicationUrlBasis = "PAGE_APPLY_LINK";
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
  //    navigation, header, footer, side panels and lists of other jobs.
  const sideParts = "header, footer, aside, [role=banner], [role=contentinfo], [role=complementary]";
  const widgets = ["similar", "related", "recommend", "more-jobs", "other-jobs", "share", "social", "newsletter", "cookie", "consent", "promo", "advert"]
    .flatMap((word) => [`[class*="${word}" i]`, `[id*="${word}" i]`, `[aria-label*="${word}" i]`])
    .join(", ");
  // The job's own container: <main> (or role=main); otherwise the <article>
  // that holds the job's title (a page's first <article> may be another
  // job's card); otherwise the nearest container of the title that holds
  // substantial text, never the whole body.
  const mainRoot = (): Element | null => {
    const main = document.querySelector("main") ?? document.querySelector("[role=main]");
    if (main) return main;
    const heading = document.querySelector("h1");
    const articles = [...document.querySelectorAll("article")];
    const own = heading ? articles.find((article) => article.contains(heading)) : articles.length === 1 ? articles[0] : undefined;
    if (own) return own;
    let element = heading?.parentElement ?? null;
    while (element && element !== document.body) {
      if ((element.textContent ?? "").trim().length >= 500) return element;
      element = element.parentElement;
    }
    return null;
  };
  const mainContent = (): ExtractedPosting | null => {
    if (linkedIn) return null;
    const root = mainRoot();
    if (!root) return null;
    const description = capDescription(textOf(root, `${sideParts}, ${widgets}`) || null);
    if (!description || description.length < 100) return null;
    const result = empty();
    result.title = pageTitle();
    result.description = description;
    if (!result.title) return null;
    return result;
  };

  // Page context: the job's bounded content (its container, as above),
  //    without navigation, header, footer, side panels, forms, lists of other
  //    jobs, and recommendation, related-job, sharing, newsletter and cookie
  //    widgets; one visible item per line, plain text only; not on LinkedIn.
  //    Core reads only labelled values and whole job-metadata items from it.
  const pageContext = (): string | null => {
    if (linkedIn) return null;
    const root = mainRoot();
    if (!root) return null;
    const text = textOf(root, `${sideParts}, ${widgets}`, true);
    if (!text) return null;
    if (text.length > limits.pageText) notes.push("Page context shortened to 20,000 characters");
    return text.slice(0, limits.pageText);
  };

  // Where to apply, everywhere but LinkedIn. Only explicit evidence counts:
  //  - an application form on this page: a form with a résumé/CV upload, or
  //    with name and email fields and an upload, and a submit or apply
  //    control (search, sign-in and newsletter forms have neither);
  //  - otherwise one explicit apply link to another address, outside
  //    navigation, header, footer, side panels and related-job widgets: a
  //    link whose whole text is an apply phrase, or a link to this posting's
  //    own application page ("…/apply", "…/application"); two different
  //    destinations are ambiguous, and none is taken;
  //  - otherwise the posting's structured data saying it is applied to
  //    directly (that flag never outranks a stated application page).
  const controlText = (element: Element): string =>
    (element instanceof HTMLInputElement ? element.value : element.textContent ?? "").replace(/\s+/g, " ").trim();
  const fieldKey = (element: Element): string =>
    ["name", "id", "autocomplete", "aria-label", "accept"].map((name) => element.getAttribute(name) ?? "").join(" ");
  const applicationForm = (): boolean =>
    [...document.querySelectorAll("form")].some((form) => {
      const uploads = [...form.querySelectorAll('input[type="file" i]')];
      if (!uploads.length) return false;
      const fields = [...form.querySelectorAll("input")].map(fieldKey);
      const resume = uploads.some((upload) => /resume|résumé|curriculum|\bcv\b/i.test(`${fieldKey(upload)} ${upload.closest("label, div, fieldset")?.textContent ?? ""}`));
      const person = fields.filter((key) => /first.?name|last.?name|given-name|family-name|full.?name|e-?mail/i.test(key)).length >= 2;
      const submit = [...form.querySelectorAll('button, input[type="submit" i]')].some((control) => /submit|apply/i.test(controlText(control)));
      return (resume || person) && submit;
    });
  const applyLink = (): string | null => {
    const excluded = `nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [role=complementary], ${widgets}`;
    const here = new URL(pageUrl);
    const targets = new Set<string>();
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (anchor.closest(excluded)) continue;
      const target = httpUrl((anchor as HTMLAnchorElement).href);
      if (!target) continue;
      const url = new URL(target);
      // A link within this page (#apply) leads to no other destination.
      if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search) continue;
      const phrase = controlText(anchor).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const stated = /^(?:apply|apply now|apply here|apply for (?:this )?(?:job|position|role)|apply to (?:this )?(?:job|position|role)|apply on (?:the )?(?:company|employer)(?:'s)? (?:site|website)|apply on (?:their )?website|submit (?:an |your )?application|i'm interested|i am interested)$/i.test(phrase);
      const trimmed = (path: string) => path.replace(/\/+$/, "");
      const ownApplicationPage = url.origin === here.origin && /^\/(?:apply|application)$/i.test(trimmed(url.pathname).slice(trimmed(here.pathname).length)) &&
        trimmed(url.pathname).startsWith(trimmed(here.pathname));
      if (!stated && !ownApplicationPage) continue;
      url.hash = "";
      targets.add(url.href);
    }
    return targets.size === 1 ? [...targets][0]! : null;
  };
  const fromMain = mainContent();
  // Structured data whose own description is missing takes the page's main
  // content as its description (its other fields are still the posting's).
  const fromStructured = ((): ExtractedPosting | null => {
    const posting = structured() ?? microdata();
    if (!posting) return null;
    if (posting.description) return posting;
    if (linkedIn || !fromMain?.description) return null;
    return { ...posting, description: fromMain.description };
  })();
  const application = ((): PageExtraction["application"] => {
    if (linkedIn) return null;
    if (applicationForm()) return { url: null, basis: "PAGE_APPLICATION_FORM" };
    const link = applyLink();
    if (link) return { url: link, basis: "PAGE_APPLY_LINK" };
    return directApply ? { url: null, basis: "STRUCTURED_DIRECT_APPLY" } : null;
  })();
  // The page's own evidence of where to apply, on a posting that states none.
  const withApplication = (posting: ExtractedPosting): ExtractedPosting =>
    application && !posting.applicationUrlBasis ? { ...posting, applicationUrl: application.url, applicationUrlBasis: application.basis } : posting;
  if (fromStructured) {
    return { pageUrl, linkedIn, extractor: "structured-data", posting: withApplication(fromStructured), selection, pageTitle: documentTitle, pageText: pageContext(), application, notes, problem: null };
  }
  if (linkedIn) {
    const fromReader = linkedInReader();
    if (fromReader) return { pageUrl, linkedIn, extractor: "site:linkedin", posting: fromReader, selection, pageTitle: documentTitle, pageText: null, application, notes, problem: null };
  }
  if (selection && selection.title) {
    const result = empty();
    result.title = selection.title;
    result.description = selection.description;
    if (linkedInJobId) result.siteJobId = linkedInJobId;
    return { pageUrl, linkedIn, extractor: "selection", posting: withApplication(result), selection: null, pageTitle: documentTitle, pageText: pageContext(), application, notes, problem: null };
  }
  // The page context still goes with a main-content description: it carries
  // the job's metadata items one per line, which the description's running
  // text does not.
  if (fromMain) notes.push("Read from the page's main content; company and location were not detected");
  if (fromMain) return { pageUrl, linkedIn, extractor: "main-content", posting: withApplication(fromMain), selection, pageTitle: documentTitle, pageText: pageContext(), application, notes, problem: null };
  return { pageUrl, linkedIn, extractor: null, posting: null, selection, pageTitle: documentTitle, pageText: selection ? pageContext() : null, application, notes, problem: "NO_JOB_CONTENT" };
}
