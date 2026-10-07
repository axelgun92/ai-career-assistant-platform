// Classifies errors that escape a worker iteration (claiming, recording a
// result, recovery, the lifecycle sweep, or the lock connection). Evaluation
// failures never reach here: runOnce persists them as failed tasks.
//
// Only whitelisted, non-sensitive fields are ever logged: error class names,
// Prisma codes, driver error kinds, SQLSTATE codes and errno codes. Messages,
// stacks, hosts, connection strings, keys and provider data are never read.

export type WorkerErrorClass = "transient" | "fatal";

export interface SanitizedWorkerError {
  name: string;
  prismaCode?: string;
  kind?: string;
  sqlState?: string;
  errno?: string;
}

const transientPrismaCodes = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"]);
const transientDriverKinds = new Set([
  "DatabaseNotReachable",
  "ConnectionClosed",
  "SocketTimeout",
  "TooManyConnections",
  "TransactionWriteConflict",
]);
const transientSqlStates = new Set(["57P01", "57P02", "57P03", "53300", "40001", "40P01"]);
const transientErrno = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"]);

const safeToken = (value: unknown, pattern: RegExp) =>
  typeof value === "string" && pattern.test(value) ? value : undefined;

const namePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function readFields(error: unknown): SanitizedWorkerError {
  const fields: SanitizedWorkerError = { name: "UnknownError" };
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const value = current as Record<string, unknown>;
    if (depth === 0) fields.name = safeToken(value.name, namePattern) ?? (current instanceof Error ? "Error" : "UnknownError");
    const code = value.code;
    fields.prismaCode ??= safeToken(code, /^P\d{4}$/) ?? safeToken(value.errorCode, /^P\d{4}$/);
    fields.errno ??= safeToken(code, /^E[A-Z_]{2,30}$/);
    if (!/^P\d{4}$/.test(String(code))) fields.sqlState ??= safeToken(code, /^[0-9A-Z]{5}$/);
    const meta = value.meta as { driverAdapterError?: { cause?: Record<string, unknown> } } | undefined;
    const cause = meta?.driverAdapterError?.cause;
    if (cause) {
      fields.kind ??= safeToken(cause.kind, namePattern);
      fields.sqlState ??= safeToken(cause.code, /^[0-9A-Z]{5}$/) ?? safeToken(cause.originalCode, /^[0-9A-Z]{5}$/);
    }
    current = value.cause;
  }
  return fields;
}

export function sanitizeWorkerError(error: unknown): SanitizedWorkerError {
  const fields = readFields(error);
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as SanitizedWorkerError;
}

export function classifyWorkerError(error: unknown): WorkerErrorClass {
  const fields = readFields(error);
  if (fields.name === "PrismaClientInitializationError") return "transient";
  if (fields.prismaCode && transientPrismaCodes.has(fields.prismaCode)) return "transient";
  if (fields.kind && transientDriverKinds.has(fields.kind)) return "transient";
  if (fields.sqlState && (fields.sqlState.startsWith("08") || transientSqlStates.has(fields.sqlState))) return "transient";
  if (fields.errno && transientErrno.has(fields.errno)) return "transient";
  return "fatal";
}

export function formatWorkerError(error: unknown): string {
  return Object.entries(sanitizeWorkerError(error))
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}
