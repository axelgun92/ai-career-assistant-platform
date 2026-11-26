/* global copy */
// F0 fixture export for Mode B (results-page capture) tests. NOT part of the
// product and never loaded by the extension or the app.
//
// How to use it, once per site (LinkedIn, Welcome to the Jungle / Otta):
//   1. Open a jobs results page in your normal Chrome.
//   2. Press F12, open the Console tab, paste this whole file (Chrome may ask
//      you to type "allow pasting" first) and press Enter.
//   3. The result is on your clipboard: paste it into the session or a file.
//
// What it reads, and nothing else: at most 5 job cards (each card is the
// smallest container around one job link), one card the page has not
// rendered yet if there is one, and the list's structure as tag and class
// names only (no text). It removes images, icons, scripts, styles, frames and
// forms; keeps only a few structural attributes; strips query strings from
// links; and blanks personal-state text (viewed, applied, saved, profile
// insights). It never reads the header, navigation, account menu, messages,
// feed, cookies or storage, makes no request and changes nothing on the page.
(() => {
  const jobLinks = {
    linkedin: /^https:\/\/(www\.)?linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?\d{5,20}/i,
    wttj: /^https:\/\/(www\.|app\.)?(welcometothejungle|otta)\.com\/(([a-z]{2}\/)?companies\/[^/]+\/jobs\/[^/?#]+|jobs\/[A-Za-z0-9_-]+)/i,
  };
  const site = /linkedin\.com$/i.test(location.hostname) ? "linkedin" : /(welcometothejungle|otta)\.com$/i.test(location.hostname) ? "wttj" : null;
  if (!site) return console.warn("Open a LinkedIn or Welcome to the Jungle / Otta results page first.");
  const keep = new Set(["class", "href", "data-job-id", "data-entity-urn", "data-occludable-job-id", "aria-hidden", "hidden", "role", "itemprop", "datetime"]);
  const personal = /^(viewed|applied|saved|promoted|easy apply|actively recruiting|be an early applicant|you(?:'|’)?re a top applicant.*|your profile matches.*|\d+ (?:connections?|school alumni|company alumni).*|.*\bworks? here)$/i;
  const outside = "header, nav, footer, [role=banner], [role=navigation], .global-nav, .msg-overlay-container, .feed-shared-update-v2";
  const id = (href) => href.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  const anchors = [...document.querySelectorAll("a[href]")].filter((a) => jobLinks[site].test(a.href) && !a.closest(outside));
  const identities = new Map();
  for (const anchor of anchors) identities.set(anchor, id(anchor.href));
  const count = (element) => new Set([...identities].filter(([anchor]) => element.contains(anchor)).map(([, key]) => key)).size;
  const cardOf = (anchor) => {
    let card = anchor;
    for (let parent = anchor.parentElement; parent && parent !== document.body && count(parent) === 1; parent = parent.parentElement) card = parent;
    return card;
  };
  const sanitize = (element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll("img, svg, picture, video, script, style, iframe, form, input, textarea, select, noscript").forEach((node) => node.remove());
    for (const node of [copy, ...copy.querySelectorAll("*")]) {
      for (const attribute of [...node.attributes]) {
        if (!keep.has(attribute.name)) node.removeAttribute(attribute.name);
        else if (attribute.name === "href") node.setAttribute("href", node.href ? id(new URL(attribute.value, location.href).toString()) : "");
      }
      if (node.children.length === 0 && personal.test((node.textContent || "").trim())) node.textContent = "";
    }
    return copy.outerHTML;
  };
  const cards = [];
  const seen = new Set();
  for (const anchor of anchors) {
    const key = identities.get(anchor);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(cardOf(anchor));
    if (cards.length === 5) break;
  }
  const placeholder = [...document.querySelectorAll("[data-occludable-job-id], [data-job-id]")].find(
    (node) => !node.closest(outside) && !node.querySelector("a[href]") && !(node.textContent || "").trim(),
  );
  // The list's structure: tag and class names only, a few levels deep.
  const skeleton = (element, depth) => {
    if (!element || depth > 6) return "";
    const classes = element.getAttribute("class") ? ` class="${element.getAttribute("class").replace(/"/g, "")}"` : "";
    const children = [...element.children].slice(0, 3).map((child) => skeleton(child, depth + 1)).join("");
    return `<${element.tagName.toLowerCase()}${classes}>${children}</${element.tagName.toLowerCase()}>`;
  };
  let list = cards[0] || null;
  while (list && cards.some((card) => !list.contains(card))) list = list.parentElement;
  const result = JSON.stringify(
    {
      site,
      page: location.origin + location.pathname,
      exportedAt: new Date().toISOString(),
      cardCount: cards.length,
      cards: cards.map(sanitize),
      placeholder: placeholder ? sanitize(placeholder) : null,
      listSkeleton: list ? skeleton(list.parentElement || list, 0) : null,
    },
    null,
    2,
  );
  copy(result);
  console.info(`Copied ${cards.length} job card(s)${placeholder ? " and 1 placeholder" : ""} to the clipboard. Paste it into the session or a file.`);
})();
