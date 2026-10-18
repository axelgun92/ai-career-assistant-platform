// Deterministic HTML-to-text conversion for retrieved job descriptions.
// The raw HTML is always kept on the source record; this text is what the
// product shows and the evaluator reads as the description. Block elements
// become line breaks, list items become "- " lines, script and style are
// dropped, entities are decoded and whitespace is collapsed. Input that is
// HTML escaped once more (Greenhouse returns "&lt;p&gt;...") is unescaped
// first.

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  deg: "°",
  times: "×",
  divide: "÷",
  laquo: "«",
  raquo: "»",
  iexcl: "¡",
  iquest: "¿",
  shy: "",
  zwnj: "",
  zwj: "",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  szlig: "ß",
  Agrave: "À",
  Aacute: "Á",
  Auml: "Ä",
  Ccedil: "Ç",
  Eacute: "É",
  Ntilde: "Ñ",
  Ouml: "Ö",
  Uuml: "Ü",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entity;
      return String.fromCodePoint(code);
    }
    return namedEntities[body] ?? entity;
  });
}

const blockTags =
  "p|div|section|article|header|footer|main|aside|nav|h[1-6]|ul|ol|dl|dt|dd|table|thead|tbody|tfoot|tr|blockquote|pre|figure|figcaption|hr|address|details|summary";
const blockBoundary = new RegExp(`<\\/?(?:${blockTags})\\b[^>]*>`, "gi");

// True when the markup arrives HTML escaped (no real tags, escaped ones).
function isEscapedHtml(value: string): boolean {
  return !/<\/?[a-z][^>]*>/i.test(value) && /&lt;\/?[a-z][a-z0-9]*(?:\s|&gt;|\/)/i.test(value);
}

export function htmlToText(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;
  let value = isEscapedHtml(html) ? decodeHtmlEntities(html) : html;
  value = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\r\n?/g, "\n")
    // Source line breaks inside markup are formatting, not content.
    .replace(/\n/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "")
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, " ")
    .replace(blockBoundary, "\n\n")
    .replace(/<[^>]*>/g, "");
  value = decodeHtmlEntities(value)
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b\ufeff]/g, "");
  const lines = value.split("\n").map((line) => line.replace(/[ \t\f\v]+/g, " ").trim());
  // A list marker with nothing after it is dropped; blank runs collapse to
  // one blank line.
  const text = lines
    .filter((line) => line !== "-")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length ? text : null;
}
