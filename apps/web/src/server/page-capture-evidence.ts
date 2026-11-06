import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { diagnosticsDirectoryProblem, removeEvidenceSessions } from "./worker-diagnostics";

// Opt-in page evidence for Mode B detail reads (November 6, 2026). The
// November 5 LinkedIn reads kept no page: whether the logged-out page carried
// an employer apply link could not be established afterwards. When
// PAGE_CAPTURE_EVIDENCE_DIR is set for a controlled run (never by default),
// each job read by the retrieval worker leaves, in
// <dir>/<worker session>/:
//   <item id>.rendered.html   the page as rendered when it was read
//   <item id>.served.html     the page as the site sent it (when available)
//   <item id>.json            ids, status, timings, the apply-link evidence
//                             found (code#applyUrl, apply links and buttons),
//                             which route the application link took
//                             (employer/ATS link from the rendered or the sent
//                             page, or the LinkedIn listing fallback), the
//                             fields read or missing, and any error.
// The directory must be outside the repository and any Git checkout; it is
// created 0700 and its files 0600. Page HTML can hold personal or session
// data: keep the directory local, never commit or upload it, and delete it
// after review. Session folders older than
// PAGE_CAPTURE_EVIDENCE_RETENTION_DAYS (default 7) are removed when the worker
// starts with the variable set; `pnpm diagnostics:cleanup` removes them at any
// time. Nothing is sent anywhere.

export interface ApplyEvidence {
  codeApplyUrl: { present: boolean; url: string | null };
  links: Array<{ text: string; href: string; tracking: string | null }>;
  buttons: Array<{ text: string; tracking: string | null; className: string }>;
}

// What a page shows about where to apply, as found in the document (bounded).
export function applyEvidence(document: Document): ApplyEvidence {
  const text = (value: string | null | undefined, limit = 120) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  const code = document.querySelector("code#applyUrl");
  const comment = code ? [...code.childNodes].find((node) => node.nodeType === 8)?.nodeValue ?? "" : "";
  let codeUrl: string | null = null;
  const encoded = /url=([^&"]+)/.exec(comment)?.[1];
  if (encoded) {
    try {
      codeUrl = decodeURIComponent(encoded).slice(0, 2_000);
    } catch {
      codeUrl = null;
    }
  }
  const mentionsApply = (element: Element) => /\bapply\b/i.test(`${element.textContent ?? ""} ${element.getAttribute("class") ?? ""} ${element.getAttribute("data-tracking-control-name") ?? ""}`);
  const links = [...document.querySelectorAll("a[href]")].filter(mentionsApply).slice(0, 10).map((anchor) => ({
    text: text(anchor.textContent),
    href: (anchor.getAttribute("href") ?? "").slice(0, 2_000),
    tracking: anchor.getAttribute("data-tracking-control-name"),
  }));
  const buttons = [...document.querySelectorAll("button")].filter(mentionsApply).slice(0, 10).map((button) => ({
    text: text(button.textContent),
    tracking: button.getAttribute("data-tracking-control-name"),
    className: text(button.getAttribute("class"), 200),
  }));
  return { codeApplyUrl: { present: Boolean(code), url: codeUrl }, links, buttons };
}

export interface PageEvidenceRecord {
  site: string;
  itemId: string;
  listingId: string | null;
  batchId: string | null;
  url: string;
  status?: number | null;
  finalUrl?: string | null;
  elapsedMs?: number;
  html?: string | null;
  servedHtml?: string | null;
  apply?: { rendered: ApplyEvidence | null; served: ApplyEvidence | null; route: "EMPLOYER_LINK_RENDERED" | "EMPLOYER_LINK_SERVED" | "LISTING_FALLBACK" | "NONE" | null; applicationUrl: string | null };
  fields?: { observed: string[]; missing: string[] };
  outcome?: string;
  error?: Record<string, unknown> | null;
}

export interface PageCaptureEvidence {
  readonly directory: string | null;
  record(entry: PageEvidenceRecord): void;
}

const disabled: PageCaptureEvidence = { directory: null, record: () => undefined };

export function createPageCaptureEvidence(input: {
  directory: string | null | undefined;
  sessionId: string;
  retentionDays?: number;
  now?: () => Date;
  warn?: (message: string) => void;
}): PageCaptureEvidence {
  if (!input.directory) return disabled;
  const problem = diagnosticsDirectoryProblem(input.directory);
  if (problem) {
    input.warn?.(`PAGE_CAPTURE_EVIDENCE_DIR ${problem}; page evidence is off`);
    return disabled;
  }
  const root = path.resolve(input.directory);
  const session = path.join(root, input.sessionId);
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    removeEvidenceSessions(root, { retentionDays: input.retentionDays ?? 7, now: (input.now ?? (() => new Date()))() });
    mkdirSync(session, { recursive: true, mode: 0o700 });
    chmodSync(session, 0o700);
  } catch {
    input.warn?.("the page evidence directory could not be prepared; page evidence is off");
    return disabled;
  }
  const write = (file: string, content: string) => writeFileSync(path.join(session, file), content, { mode: 0o600 });
  return {
    directory: session,
    record(entry) {
      try {
        if (entry.html) write(`${entry.itemId}.rendered.html`, entry.html);
        if (entry.servedHtml) write(`${entry.itemId}.served.html`, entry.servedHtml);
        const { html, servedHtml, ...summary } = entry;
        write(
          `${entry.itemId}.json`,
          `${JSON.stringify({ ...summary, recordedAt: new Date().toISOString(), renderedHtmlSaved: Boolean(html), servedHtmlSaved: Boolean(servedHtml) }, null, 2)}\n`,
        );
      } catch {
        input.warn?.(`page evidence for job ${entry.itemId} could not be written`);
      }
    },
  };
}
