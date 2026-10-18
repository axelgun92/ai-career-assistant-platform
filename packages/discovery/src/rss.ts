import { decodeHtmlEntities } from "@ai-career/normalization";

// A minimal RSS 2.0 item reader (no dependency): each <item>'s direct child
// elements, by tag name, with CDATA unwrapped and XML entities decoded.
// Element values are returned as text; markup inside CDATA (an HTML
// description) is left for the caller to convert.

export interface RssItem {
  // Every value of each child element, in document order.
  fields: Record<string, string[]>;
}

export class RssParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RssParseError";
  }
}

function elementText(raw: string): string {
  const parts: string[] = [];
  let rest = raw;
  for (;;) {
    const start = rest.indexOf("<![CDATA[");
    if (start < 0) {
      parts.push(decodeHtmlEntities(rest));
      break;
    }
    parts.push(decodeHtmlEntities(rest.slice(0, start)));
    const end = rest.indexOf("]]>", start + 9);
    if (end < 0) throw new RssParseError("Unterminated CDATA section");
    parts.push(rest.slice(start + 9, end));
    rest = rest.slice(end + 3);
  }
  return parts.join("").trim();
}

export function parseRssItems(xml: string): RssItem[] {
  if (!/<rss\b|<channel\b/i.test(xml)) throw new RssParseError("Not an RSS document");
  const items: RssItem[] = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  for (const [, body] of xml.matchAll(itemPattern)) {
    const fields: Record<string, string[]> = {};
    // Direct children: <name attr...>value</name> or <name ... />.
    const childPattern = /<([A-Za-z_][\w.:-]*)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;
    for (const [, name, , value] of body!.matchAll(childPattern)) {
      (fields[name!] ??= []).push(value === undefined ? "" : elementText(value));
    }
    items.push({ fields });
  }
  return items;
}

export function rssField(item: RssItem, name: string): string | null {
  const value = item.fields[name]?.[0]?.trim();
  return value ? value : null;
}
