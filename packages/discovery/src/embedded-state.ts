// Reads application state a page embeds as JSON in a script element (for
// example Next.js's <script id="__NEXT_DATA__" type="application/json">).
// Public-HTML adapters parse this verified state rather than the page's
// visual markup, which changes far more often. The document itself has
// already passed the transport's size limit.

export function readJsonScript(html: string, id: string): unknown | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`<script\\b[^>]*\\bid=["']${escaped}["'][^>]*>([\\s\\S]*?)</script\\s*>`, "i").exec(html);
  if (!tag || !/\btype=["']application\/json["']/i.test(tag[0].slice(0, tag[0].indexOf(">") + 1))) return null;
  try {
    return JSON.parse(tag[1]!) as unknown;
  } catch {
    return null;
  }
}
