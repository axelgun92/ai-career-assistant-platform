// The results-page reader ("Save jobs on this page", Mode B). Like the
// single-job reader (extract.ts, which this file does not use or change),
// chrome.scripting.executeScript serializes this one function and runs it
// once in the active tab, only after the user pressed the button. Its only
// argument is the site's reader spec: plain JSON data, no credential. It
// must stay self-contained: no imports, no outside variables, no chrome.*,
// cookies, storage or network. It reads the job cards already loaded in the
// page and returns plain fields; it never scrolls, pages, clicks, navigates,
// changes the page or inserts HTML. A card the page has not rendered yet (an
// empty placeholder in a long list) is skipped and counted, never invented.

export interface ResultCardReaderInput {
  jobLink: string;
  jobIdAttributes: string[];
  jobIdPattern: string | null;
  jobUrlTemplate: string | null;
  titleSelector: string | null;
  companySelector: string | null;
  locationSelector: string | null;
  postedSelector: string | null;
  excludeSelector: string | null;
  maxCards: number;
}

export interface ReadResultCard {
  url: string;
  title: string;
  siteJobId: string | null;
  company: string | null;
  location: string | null;
  postedText: string | null;
}

export interface ResultCardsReading {
  pageUrl: string;
  pageTitle: string | null;
  cards: ReadResultCard[];
  counts: { loaded: number; skippedUnloaded: number; overCap: number };
  problem: "FRICTION" | "NO_CARDS" | null;
  // A sign-in prompt the page shows over results that are still loaded and
  // readable: the cards are read, the prompt is left as it is (never
  // dismissed or used), and the user is told it is there.
  notice?: "SIGN_IN_PROMPT_SHOWN" | null;
}

export function readResultCards(input: ResultCardReaderInput): ResultCardsReading {
  const limits = { title: 300, short: 200, posted: 80, url: 2048, siteJobId: 100 };
  const pageUrl = String(location.href).slice(0, limits.url);
  const clean = (value: string | null | undefined, max: number): string | null => {
    if (!value) return null;
    const text = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, max) : null;
  };
  const pageTitle = clean(document.title, limits.title);
  const none = (problem: ResultCardsReading["problem"]): ResultCardsReading => ({
    pageUrl,
    pageTitle,
    cards: [],
    counts: { loaded: 0, skippedUnloaded: 0, overCap: 0 },
    problem,
  });

  // A sign-in wall, checkpoint or shown challenge in place of the results:
  // read nothing. A sign-in prompt shown over results that are still loaded
  // does not stop the read: the loaded cards are read and the prompt is left
  // untouched; only a prompt with no readable card behind it is FRICTION.
  // Only what the page shows counts (November 5, 2026 evidence, LinkedIn
  // logged out): the invisible reCAPTCHA badge (.grecaptcha-badge,
  // display:none, on every state of the page) and the hidden Apply/Save
  // sign-in modals are always in the page, and never stop a read; a
  // "LinkedIn is better on the app" promotion is not a sign-in prompt.
  if (/\/(authwall|login|signup|checkpoint|challenge|uas\/login|captcha)(\/|\?|$)/i.test(location.pathname)) return none("FRICTION");
  // With a layout engine (Chrome), an element with no box is not shown;
  // without one, only the style rules are checked.
  const hasLayout = document.documentElement.getClientRects().length > 0;
  const shown = (element: Element): boolean => {
    if (element.closest("[hidden], [aria-hidden=true], [inert]")) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    if (!hasLayout) return true;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const challenge = [...document.querySelectorAll('iframe[src*="captcha" i], iframe[src*="challenge" i], [id*="captcha" i], [class*="captcha" i], form[action*="checkpoint" i]')].some(
    (element) => !element.closest(".grecaptcha-badge") && shown(element),
  );
  if (challenge) return none("FRICTION");
  // A shown dialog or modal of a real size whose own shown controls ask the
  // user to sign in or join ("Sign in to view more jobs": Continue with
  // Google, Sign in with Email, Join now), or that shows a password field.
  const signInWords = /^(?:sign in|log in|login|join now|join linkedin|continue with google|continue with apple|sign in with (?:email|google|apple)|sign in to (?:view|see|continue)\b.*)$/i;
  // A page-wide wrapper (the body, or anything holding the page's main
  // content, such as a "modal-open" class) is never the prompt itself.
  const signInPrompts = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal" i]')].filter((dialog) => {
    if (dialog === document.body || dialog === document.documentElement || dialog.querySelector("main, [role=main]")) return false;
    if (!shown(dialog)) return false;
    if (hasLayout) {
      const box = dialog.getBoundingClientRect();
      if (box.width < 200 || box.height < 150) return false;
    }
    if ([...dialog.querySelectorAll('input[type="password" i]')].some(shown)) return true;
    return [...dialog.querySelectorAll("button, a, [role=button], h1, h2, h3")].some(
      (control) => shown(control) && signInWords.test((control.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
  });

  const jobLink = new RegExp(input.jobLink, "i");
  const jobIdPattern = input.jobIdPattern ? new RegExp(input.jobIdPattern, "i") : null;
  const excluded = [
    "header",
    "nav",
    "footer",
    "aside",
    "[role=banner]",
    "[role=contentinfo]",
    "[role=complementary]",
    "[role=navigation]",
    "[hidden]",
    '[aria-hidden="true"]',
    input.excludeSelector,
  ]
    .filter(Boolean)
    .join(", ");
  // Lists of other jobs a page shows beside the results ("Similar jobs",
  // "People also viewed") are not results.
  const relatedHeading =
    /^(?:(?:related|similar|recommended|recent|latest|more|other)(?:\s+(?:open|remote))?\s+(?:jobs|roles|positions|openings|listings)(?:\s+(?:at|from|like|for you)\b.*)?|you may also like|people also viewed|jobs you may be interested in)$/i;
  const relatedSections: Element[] = [];
  for (const heading of [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")]) {
    if (relatedHeading.test(clean(heading.textContent, 200) ?? "") && heading.parentElement) relatedSections.push(heading.parentElement);
  }
  // Nothing inside a shown sign-in prompt is a result card.
  const isExcluded = (element: Element) =>
    Boolean(element.closest(excluded)) ||
    relatedSections.some((section) => section.contains(element)) ||
    signInPrompts.some((prompt) => prompt.contains(element));

  // Rendering: with a layout engine (Chrome), a card with no box is not shown.
  // Without one (no element has a box), only the style rules are checked
  // (hasLayout, above).
  const isRendered = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return !hasLayout || element.getClientRects().length > 0;
  };

  const absolute = (value: string | null): string | null => {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  };

  // Every element that identifies one job: a link to its detail page, or an
  // element carrying its job ID. The identity is the job ID when the site's
  // pattern gives one, otherwise the link without its query and fragment.
  interface Marker {
    node: Element;
    key: string;
    url: string;
    siteJobId: string | null;
    link: Element | null;
  }
  const markers: Marker[] = [];
  const idFromUrl = (url: string) => {
    const match = jobLink.exec(url);
    if (!match) return null;
    const groups = match.slice(1).filter((group) => group && /^\d{5,20}$/.test(group));
    return groups.length ? groups[groups.length - 1]! : null;
  };
  // One key per job: its canonical address (the site's job URL for its ID
  // when the site has one, otherwise the link without query or fragment).
  const keyOf = (url: string) => url.split(/[?#]/)[0]!.replace(/\/+$/, "").toLowerCase();
  const fromTemplate = (id: string) => (input.jobUrlTemplate ? input.jobUrlTemplate.replace("{id}", encodeURIComponent(id)) : null);
  for (const anchor of [...document.querySelectorAll("a[href]")]) {
    const url = absolute(anchor.getAttribute("href"));
    if (!url || !jobLink.test(url)) continue;
    const siteJobId = idFromUrl(url);
    const canonical = (siteJobId && fromTemplate(siteJobId)) || url;
    markers.push({ node: anchor, key: keyOf(canonical), url, siteJobId, link: anchor });
  }
  if (jobIdPattern && input.jobUrlTemplate) {
    for (const attribute of input.jobIdAttributes) {
      for (const node of [...document.querySelectorAll(`[${attribute}]`)]) {
        const match = jobIdPattern.exec(node.getAttribute(attribute) ?? "");
        const id = match?.[1];
        if (!id) continue;
        const url = fromTemplate(id)!;
        markers.push({ node, key: keyOf(url), url, siteJobId: id, link: null });
      }
    }
  }

  // A card is the largest container around a marker that holds no other
  // job: fields are read only inside it, so two cards never mix.
  const keysWithin = (element: Element) => {
    const keys = new Set<string>();
    for (const marker of markers) if (element === marker.node || element.contains(marker.node)) keys.add(marker.key);
    return keys.size;
  };
  const cardOf = (node: Element) => {
    let card = node;
    for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (keysWithin(parent) !== 1) break;
      card = parent;
    }
    return card;
  };
  const textIn = (card: Element, selector: string | null, except: Element | null): string | null => {
    if (!selector) return null;
    for (const element of [...card.querySelectorAll(selector)]) {
      if (except && (element === except || except.contains(element))) continue;
      const textValue = clean(element.textContent, limits.short);
      if (textValue) return textValue;
    }
    return null;
  };

  const byKey = new Map<string, Marker[]>();
  for (const marker of markers) byKey.set(marker.key, [...(byKey.get(marker.key) ?? []), marker]);

  interface Found {
    card: Element;
    read: ReadResultCard;
  }
  const found: Found[] = [];
  let skippedUnloaded = 0;
  for (const group of byKey.values()) {
    const anchorMarker = group.find((marker) => marker.link) ?? null;
    const first = group[0]!;
    if (group.every((marker) => isExcluded(marker.node))) continue;
    const card = cardOf(anchorMarker?.node ?? first.node);
    if (isExcluded(card)) continue;
    const titleElement = input.titleSelector ? card.querySelector(input.titleSelector) : null;
    const title =
      clean(titleElement?.textContent, limits.title) ??
      clean(anchorMarker?.link?.textContent, limits.title) ??
      clean(card.querySelector("h1, h2, h3, h4, [role=heading]")?.textContent, limits.title);
    // Not rendered yet, or hidden: not a loaded card.
    if (!title || !isRendered(card)) {
      skippedUnloaded += 1;
      continue;
    }
    const siteJobId = group.find((marker) => marker.siteJobId)?.siteJobId ?? null;
    const url = (input.jobUrlTemplate && siteJobId ? input.jobUrlTemplate.replace("{id}", encodeURIComponent(siteJobId)) : (anchorMarker ?? first).url).slice(0, limits.url);
    found.push({
      card,
      read: {
        url,
        title,
        siteJobId: siteJobId ? siteJobId.slice(0, limits.siteJobId) : null,
        company: textIn(card, input.companySelector, titleElement),
        location: textIn(card, input.locationSelector, titleElement),
        postedText: clean(textIn(card, input.postedSelector, titleElement), limits.posted),
      },
    });
  }
  // Document order, as the page shows them.
  found.sort((left, right) => (left.card.compareDocumentPosition(right.card) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const maxCards = Math.max(1, Math.min(25, Math.floor(input.maxCards)));
  const cards = found.slice(0, maxCards).map((item) => item.read);
  if (!cards.length) {
    // A sign-in prompt with no readable card behind it stands in for the
    // results: that is the friction to report.
    const empty = none(signInPrompts.length ? "FRICTION" : "NO_CARDS");
    empty.counts.skippedUnloaded = skippedUnloaded;
    return empty;
  }
  return {
    pageUrl,
    pageTitle,
    cards,
    counts: { loaded: found.length, skippedUnloaded, overCap: Math.max(0, found.length - cards.length) },
    problem: null,
    notice: signInPrompts.length ? "SIGN_IN_PROMPT_SHOWN" : null,
  };
}
