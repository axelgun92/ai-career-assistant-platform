import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeWorkerError } from "./worker-errors";

// Persistent, structured diagnostics for the retrieval worker (November 6,
// 2026). The November 5 Mode B failure left only one console line: the
// error's code, with no message, transaction, timing, job or stage. These
// events are appended, one JSON object per line, to a local file the moment
// they happen (synchronously), so an exit or a crash never discards what was
// already written. Nothing is uploaded anywhere.
//
// Content: ids (session, batch, capture item, listing, opportunity), the
// site, the stage, decisions and counts, timings, and errors reduced to their
// class, codes, Prisma's fixed P2028 form and numbers, the transaction's name
// and a sanitized message (no credentials, tokens, cookies or connection
// strings; bounded in length). No page content and no personal data.
//
// Where: RETRIEVAL_WORKER_LOG_DIR (default ~/.ai-job-assistant/diagnostics),
// always outside the repository, in logs/retrieval-worker-<UTC date>.jsonl,
// directory 0700 and files 0600. Files older than
// RETRIEVAL_WORKER_LOG_RETENTION_DAYS (default 30) are removed when the worker
// starts. RETRIEVAL_WORKER_LOG_DIR=off turns the file off.

export type DiagnosticFields = Record<string, unknown>;

export interface WorkerDiagnostics {
  readonly sessionId: string;
  // The file events go to, or null when diagnostics are off or unwritable.
  readonly file: string | null;
  event(name: string, fields?: DiagnosticFields): void;
}

export const defaultDiagnosticsDirectory = path.join(os.homedir(), ".ai-job-assistant", "diagnostics");
export const diagnosticLogPattern = /^retrieval-worker-\d{4}-\d{2}-\d{2}\.jsonl$/;

// The real path of a folder that may not exist yet: its nearest existing
// ancestor resolved through symbolic links, with the rest appended.
function realTarget(directory: string): string {
  let existing = path.resolve(directory);
  const rest: string[] = [];
  while (!existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  try {
    return path.join(realpathSync(existing), ...rest);
  } catch {
    return path.resolve(directory);
  }
}
const inside = (target: string, root: string) => target === root || target.startsWith(`${root}${path.sep}`);

// A directory the diagnostics, page evidence or an evidence package may use:
// never the repository the worker runs from, nor anything inside any Git
// checkout (raw diagnostics are never committed), resolved through symbolic
// links, whatever folder the command was started from.
export function diagnosticsDirectoryProblem(directory: string, repository: string = process.cwd()): string | null {
  const target = realTarget(directory);
  if (inside(target, realTarget(repository)) || inside(path.resolve(directory), path.resolve(repository))) return "must be outside the repository";
  for (let folder = target; ; folder = path.dirname(folder)) {
    if (existsSync(path.join(folder, ".git"))) return "must be outside the repository";
    if (path.dirname(folder) === folder) return null;
  }
}

// Secrets removed from any text kept in diagnostics: credentials in URLs,
// key=value secrets (also inside longer names: PGPASSWORD=, access_token=),
// authorization schemes, provider API keys and JSON web tokens.
export function redactSecrets(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1<redacted>@")
    .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 <redacted>")
    .replace(/\b([\w.-]*(?:password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie|session(?:id)?|li_at|jsessionid|credential)[\w.-]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1$2<redacted>")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "<redacted-key>")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/g, "<redacted-key>")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<redacted-jwt>");
}
// A URL as diagnostics keep it: no credentials, query or fragment.
export function diagnosticUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return redactSecrets(url).split(/[?#]/)[0]!.slice(0, 500);
  }
}

// Error messages are kept only after removing anything that could be a
// secret, and only up to 600 characters.
export function sanitizeMessage(message: unknown): string | undefined {
  if (typeof message !== "string" || !message.trim()) return undefined;
  // An authorization scheme's credential goes before key=value secrets, so
  // "Authorization: Bearer <token>" never leaves the token behind.
  return redactSecrets(message)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

// An error as a diagnostic: its whitelisted fields (class, Prisma code, P2028
// form and numbers, transaction name, SQLSTATE, driver kind, errno) and a
// sanitized message.
export function diagnosticError(error: unknown): DiagnosticFields {
  const message = error && typeof error === "object" ? sanitizeMessage((error as { message?: unknown }).message) : sanitizeMessage(String(error));
  return { ...sanitizeWorkerError(error), ...(message ? { message } : {}) };
}

function prepare(value: unknown, depth = 0): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return diagnosticError(value);
  if (depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => prepare(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, key === "error" ? diagnosticError(entry) : prepare(entry, depth + 1)]));
  }
  if (typeof value === "string") return redactSecrets(value).slice(0, 2_000);
  return value;
}

export function removeExpired(directory: string, retentionDays: number, now: Date): string[] {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const removed: string[] = [];
  for (const name of readdirSync(directory)) {
    if (!diagnosticLogPattern.test(name)) continue;
    const file = path.join(directory, name);
    try {
      if (statSync(file).mtimeMs < cutoff) {
        unlinkSync(file);
        removed.push(name);
      }
    } catch {
      // Best effort.
    }
  }
  return removed;
}

export function createWorkerDiagnostics(input: {
  // The diagnostics root; null turns the file off (events go nowhere).
  directory: string | null;
  retentionDays?: number;
  now?: () => Date;
  sessionId?: string;
  warn?: (message: string) => void;
}): WorkerDiagnostics {
  const now = input.now ?? (() => new Date());
  const sessionId = input.sessionId ?? randomUUID();
  let logs: string | null = null;
  if (input.directory) {
    const problem = diagnosticsDirectoryProblem(input.directory);
    if (problem) {
      input.warn?.(`diagnostics directory ${problem}; persistent diagnostics are off`);
    } else {
      try {
        logs = path.join(path.resolve(input.directory), "logs");
        mkdirSync(logs, { recursive: true, mode: 0o700 });
        chmodSync(logs, 0o700);
        removeExpired(logs, input.retentionDays ?? 30, now());
      } catch {
        input.warn?.("the diagnostics directory could not be prepared; persistent diagnostics are off");
        logs = null;
      }
    }
  }
  let warned = false;
  // Each file is made owner-only once per process, even one that already
  // existed with wider permissions.
  const restricted = new Set<string>();
  const fileFor = (at: Date) => (logs ? path.join(logs, `retrieval-worker-${at.toISOString().slice(0, 10)}.jsonl`) : null);
  return {
    sessionId,
    get file() {
      return fileFor(now());
    },
    event(name, fields = {}) {
      const at = now();
      const file = fileFor(at);
      if (!file) return;
      try {
        const line = JSON.stringify({ at: at.toISOString(), session: sessionId, pid: process.pid, event: name, ...(prepare(fields) as DiagnosticFields) });
        appendFileSync(file, `${line}\n`, { mode: 0o600 });
        if (!restricted.has(file)) {
          chmodSync(file, 0o600);
          restricted.add(file);
        }
      } catch {
        // Diagnostics never stop the worker.
        if (!warned) input.warn?.("a diagnostics event could not be written");
        warned = true;
      }
    },
  };
}

// Diagnostics from the environment: RETRIEVAL_WORKER_LOG_DIR (or the
// default), RETRIEVAL_WORKER_LOG_RETENTION_DAYS (default 30).
export function workerDiagnosticsFromEnvironment(environment: Record<string, string | undefined>, warn?: (message: string) => void): WorkerDiagnostics {
  const configured = environment.RETRIEVAL_WORKER_LOG_DIR?.trim();
  const directory = configured?.toLowerCase() === "off" ? null : configured || defaultDiagnosticsDirectory;
  const days = Number(environment.RETRIEVAL_WORKER_LOG_RETENTION_DAYS ?? 30);
  return createWorkerDiagnostics({ directory, retentionDays: Number.isFinite(days) && days > 0 ? days : 30, ...(warn ? { warn } : {}) });
}

// The checked-out commit, read from .git without running git (null when
// unavailable). Recorded in worker.start so evidence names the code it came from.
export function gitHead(repository: string = process.cwd()): { sha: string | null; branch: string | null } {
  for (let directory = path.resolve(repository); ; directory = path.dirname(directory)) {
    try {
      const head = readFileSync(path.join(directory, ".git", "HEAD"), "utf8").trim();
      if (!head.startsWith("ref: ")) return { sha: head || null, branch: null };
      const ref = head.slice(5);
      let sha: string | null = null;
      try {
        sha = readFileSync(path.join(directory, ".git", ref), "utf8").trim() || null;
      } catch {
        const packed = (() => {
          try {
            return readFileSync(path.join(directory, ".git", "packed-refs"), "utf8");
          } catch {
            return "";
          }
        })();
        sha = packed.split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
      }
      return { sha, branch: ref.replace(/^refs\/heads\//, "") };
    } catch {
      if (path.dirname(directory) === directory) return { sha: null, branch: null };
    }
  }
}

// Removes page-evidence session folders (named by worker session) older than
// the retention period, or all of them; other names are never touched.
// Returns the folders removed.
export function removeEvidenceSessions(root: string, options: { retentionDays: number; now: Date; all?: boolean }): string[] {
  const removed: string[] = [];
  const cutoff = options.now.getTime() - options.retentionDays * 86_400_000;
  for (const name of readdirSync(root)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name)) continue;
    const folder = path.join(root, name);
    const stat = statSync(folder);
    if (stat.isDirectory() && (options.all || stat.mtimeMs < cutoff)) {
      rmSync(folder, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}
