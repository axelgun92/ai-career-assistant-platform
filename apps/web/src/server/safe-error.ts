// Safe server diagnostics for a failed read (November 25, 2026): what kind of
// error it was, without anything sensitive. The name, a known error code
// (Prisma P…, PostgreSQL SQLSTATE, Node E…), a short message with connection
// strings, credentials, e-mail addresses, quoted values and long digit runs
// removed, and the chained causes, at most three deep. Never the error's
// data, query parameters, job text or stack.

export interface SafeErrorDetails {
  errorName: string;
  errorCode?: string;
  // A PostgreSQL SQLSTATE a Prisma error carries (for example 57P01).
  databaseCode?: string;
  errorMessage?: string;
  cause?: SafeErrorDetails;
}

// Quoted text kept as is: an identifier or call (`prisma.$queryRaw()`) or a
// SQLSTATE code. Every other quoted value is redacted.
const safeQuoted = /^[A-Za-z_$][\w.$]*(\(\))?$|^[0-9A-Z]{5}$/;

const maximumMessageLength = 240;

// Prisma's "Invalid `call` invocation in <file>:<line>" messages quote the
// calling source lines; only the call and the closing explanation are kept.
function withoutPrismaSourceExcerpt(message: string): string {
  const invocation = /Invalid `([^`]+)` invocation in\b/.exec(message);
  if (!invocation) return message;
  const paragraphs = message.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const explanation = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1]! : "";
  return `Invalid \`${invocation[1]}\` invocation${explanation ? `: ${explanation}` : ""}`;
}

export function redactErrorMessage(message: string): string {
  return withoutPrismaSourceExcerpt(message)
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/gi, "[url]")
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[key]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/"([^"\n]{0,400})"|'([^'\n]{0,400})'|`([^`\n]{0,400})`/g, (quoted: string, ...groups: Array<string | undefined>) =>
      safeQuoted.test(groups.slice(0, 3).find((group) => group !== undefined) ?? "") ? quoted : "[value]")
    .replace(/\d{6,}/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumMessageLength);
}

function codeOf(error: Record<string, unknown>): string | undefined {
  const code = error.code ?? error.errorCode;
  return typeof code === "string" && /^[A-Z0-9_]{2,40}$/i.test(code) ? code : undefined;
}

export function safeErrorDetails(error: unknown, depth = 0): SafeErrorDetails {
  if (!(error instanceof Error)) {
    return { errorName: error === null ? "null" : typeof error === "object" ? "NonErrorObject" : `Non-error ${typeof error}` };
  }
  const record = error as unknown as Record<string, unknown>;
  const code = codeOf(record);
  const meta = record.meta && typeof record.meta === "object" ? (record.meta as Record<string, unknown>) : {};
  const databaseCode = typeof meta.code === "string" && /^[0-9A-Z]{5}$/.test(meta.code) ? meta.code : undefined;
  const message = redactErrorMessage(error.message ?? "");
  const cause = depth < 3 && record.cause !== undefined ? safeErrorDetails(record.cause, depth + 1) : undefined;
  return {
    errorName: error.name || "Error",
    ...(code ? { errorCode: code } : {}),
    ...(databaseCode ? { databaseCode } : {}),
    ...(message ? { errorMessage: message } : {}),
    ...(cause ? { cause } : {}),
  };
}

// The dashboard's request context, by filter names only: never the search
// text, company or other values a user typed.
export function dashboardQueryContext(query: {
  view: string;
  page: number;
  pageSize: number;
  sort: string;
  q: string;
  titles?: string;
  triage?: string;
}): Record<string, string | number | boolean | string[]> {
  const activeFilters = Object.entries(query as Record<string, unknown>)
    .filter(([key, value]) => !["view", "page", "pageSize", "sort", "q", "titles", "triage"].includes(key) && (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== ""))
    .map(([key]) => key)
    .sort();
  return {
    view: query.view,
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    searched: query.q.length > 0,
    ...(query.titles ? { titles: query.titles } : {}),
    ...(query.triage ? { triage: query.triage } : {}),
    filters: activeFilters,
  };
}
