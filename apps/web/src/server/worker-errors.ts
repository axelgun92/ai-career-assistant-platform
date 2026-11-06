// Classifies errors that escape a worker iteration (claiming, recording a
// result, recovery, the lifecycle sweep, or the lock connection). Evaluation
// failures never reach here: runOnce persists them as failed tasks.
//
// Only whitelisted, non-sensitive fields are ever logged: error class names,
// Prisma codes, driver error kinds, SQLSTATE codes and errno codes, plus, for
// a P2028 only, which of Prisma's two fixed sentences it was and the numbers
// in it. No other message text, stacks, hosts, connection strings, keys or
// provider data are ever read.

export type WorkerErrorClass = "transient" | "fatal";

export interface SanitizedWorkerError {
  name: string;
  prismaCode?: string;
  kind?: string;
  sqlState?: string;
  errno?: string;
  // P2028 (an interactive transaction's own failure): which of Prisma's two
  // fixed forms it was, with the numbers Prisma states (no data). November 5,
  // 2026: the Mode B worker exited on a P2028 whose form was not recorded.
  transactionError?: "start-timeout" | "expired";
  timeoutMs?: string;
  elapsedMs?: string;
  // The capture transaction it happened in, when the repository names it.
  transaction?: string;
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
    if (fields.prismaCode === "P2028" && !fields.transactionError && typeof value.message === "string") {
      // Only Prisma's own fixed wording is read, and only its numbers kept.
      if (/Unable to start a transaction in the given time/.test(value.message)) fields.transactionError = "start-timeout";
      const expired = /expired transaction\. The timeout for this transaction was (\d{1,9}) ms, however (\d{1,9}) ms passed/.exec(value.message);
      if (expired) {
        fields.transactionError = "expired";
        fields.timeoutMs = expired[1];
        fields.elapsedMs = expired[2];
      }
    }
    fields.transaction ??= safeToken(value.captureTransaction, namePattern);
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

// The retrieval worker only (November 6, 2026): its capture transactions
// also fail transiently with P2028 (a transaction that could not start in
// time or outlived its timeout) and SQLSTATE 55P03 (the capture lock's
// lock_timeout). Both are retried with backoff there, never a reason to stop
// that worker. The evaluation worker keeps classifyWorkerError unchanged.
const retrievalTransientPrismaCodes = new Set(["P2028"]);
const retrievalTransientSqlStates = new Set(["55P03"]);
export function classifyRetrievalWorkerError(error: unknown): WorkerErrorClass {
  if (classifyWorkerError(error) === "transient") return "transient";
  const fields = readFields(error);
  if (fields.prismaCode && retrievalTransientPrismaCodes.has(fields.prismaCode)) return "transient";
  if (fields.sqlState && retrievalTransientSqlStates.has(fields.sqlState)) return "transient";
  return "fatal";
}

// What a database failure means for the one job whose ingestion raised it
// (the Mode B acquisition pass, November 5, 2026):
// - CONTENTION: the capture lock or a row was busy (lock_timeout, a
//   serialization failure or deadlock). Nobody's fault: the job is retried
//   later, uncounted.
// - TRANSIENT: a timing or connection failure (P2028, connection loss, pool
//   exhaustion). Either this job's work or the database itself: the pass
//   decides which from the next ingestion or a lock probe.
// - PERMANENT: the job's own data was refused (a constraint, a value too
//   long, a validation error). That job's failure, counted.
// - UNKNOWN: anything else (a programming error); not a job outcome.
export type JobDatabaseFailure = "CONTENTION" | "TRANSIENT" | "PERMANENT" | "UNKNOWN";

const contentionPrismaCodes = new Set(["P2034"]);
const contentionSqlStates = new Set(["55P03", "40001", "40P01"]);
const permanentPrismaCodes = new Set(["P2000", "P2002", "P2003", "P2004", "P2005", "P2006", "P2007", "P2011", "P2012", "P2013", "P2014", "P2019", "P2020", "P2023", "P2025"]);

export function classifyJobDatabaseFailure(error: unknown): JobDatabaseFailure {
  const fields = readFields(error);
  if ((fields.prismaCode && contentionPrismaCodes.has(fields.prismaCode)) || (fields.sqlState && contentionSqlStates.has(fields.sqlState))) return "CONTENTION";
  if (fields.kind === "TransactionWriteConflict") return "CONTENTION";
  if (fields.name === "PrismaClientValidationError") return "PERMANENT";
  if (fields.prismaCode && permanentPrismaCodes.has(fields.prismaCode)) return "PERMANENT";
  if (classifyRetrievalWorkerError(error) === "transient") return "TRANSIENT";
  return "UNKNOWN";
}

export function formatWorkerError(error: unknown): string {
  return Object.entries(sanitizeWorkerError(error))
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}
