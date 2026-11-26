import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { diagnosticLogPattern, diagnosticsDirectoryProblem } from "./worker-diagnostics";

// The failure evidence package (November 6, 2026): after a failed Mode B
// round, one command assembles everything needed to diagnose it into a new,
// local, access-restricted folder, without rerunning anything, contacting any
// site, starting an evaluation or making a paid call:
//   manifest.json          what was collected, from where, what is absent
//   capture-session.json   the capture session (the saved batch)
//   capture-items.json     its jobs: status, attempts, reasons, hand-off
//   source-records.json    the source versions of those jobs, including
//                          ones not linked to any job (opportunityId null)
//   opportunities.json     the jobs they produced and their triage outcome
//   timeline.json          every timestamped step, in order
//   worker-log.jsonl       the retrieval worker's diagnostics in the window
//   retrieval-summary.json the passes' reliability, from those diagnostics:
//                          jobs saved before any restriction, page and
//                          request totals, failed attempts, automatic
//                          recovery and elapsed time (November 8, 2026)
//   page-evidence/         the opt-in page evidence for these jobs, if any
// The database is read in one READ ONLY transaction on a read-only session,
// only a database whose name says test or acceptance (never the normal
// application database), and only the columns every applied migration since
// the capture session table (November 5, 2026) has.

type ReadTransaction = { $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> };
export type PackageReader = { read<T>(reads: (transaction: ReadTransaction) => Promise<T>): Promise<T> };

export interface PackageArguments {
  connectionString: string;
  database: string;
  databaseLabel: string;
  captureSession: string | "latest";
  site: string | null;
  out: string;
  logsDirectory: string | null;
  evidenceDirectory: string | null;
  windowMinutes: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The reliability of the worker's passes, from its diagnostics events (LinkedIn
// Option A, November 8, 2026): what the controlled live test records. Passes
// run one at a time, so each pass.start pairs with the next pass.end.
export interface RetrievalSummary {
  passes: Array<{
    site: unknown;
    startedAt: string | null;
    endedAt: string | null;
    elapsedMs: number | null;
    pageScripts: unknown;
    claimed: unknown;
    ingested: unknown;
    incomplete: unknown;
    awaitingDetails: unknown;
    unavailable: unknown;
    stopped: unknown;
    requests: unknown;
  }>;
  totals: {
    passes: number;
    jobsIngested: number;
    pagesOpened: number;
    documentRequests: number;
    sentRequests: number;
    blockedRequests: number;
    failedAttemptsCounted: number;
    incompletePages: number;
    restrictions: Array<{ at: string | null; site: unknown; reason: unknown; until: unknown }>;
    jobsIngestedBeforeFirstRestriction: number;
    passesStartedAfterFirstRestriction: number;
    interruptedJobsRecovered: number;
    firstPassStartedAt: string | null;
    lastPassEndedAt: string | null;
    elapsedMs: number | null;
  };
}

export function retrievalSummary(events: ReadonlyArray<Record<string, unknown>>): RetrievalSummary {
  const stamp = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const passes: RetrievalSummary["passes"] = [];
  let open: Record<string, unknown> | null = null;
  const restrictions: RetrievalSummary["totals"]["restrictions"] = [];
  let ingested = 0;
  let ingestedBeforeRestriction: number | null = null;
  let failed = 0;
  let recovered = 0;
  let passesAfterRestriction = 0;
  for (const event of events) {
    switch (event.event) {
      case "pass.start":
        open = event;
        if (restrictions.length) passesAfterRestriction += 1;
        break;
      case "pass.end": {
        const startedAt = stamp(open?.at);
        const endedAt = stamp(event.at);
        passes.push({
          site: event.site,
          startedAt,
          endedAt,
          elapsedMs: startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null,
          pageScripts: event.pageScripts ?? open?.pageScripts ?? null,
          claimed: event.claimed,
          ingested: event.ingested,
          incomplete: event.incomplete ?? null,
          awaitingDetails: event.awaitingDetails,
          unavailable: event.unavailable,
          stopped: event.stopped ?? null,
          requests: event.requests ?? null,
        });
        open = null;
        break;
      }
      case "job.ingested":
        ingested += 1;
        break;
      case "job.decision":
        if (event.decision === "ATTEMPT_COUNTED" || event.decision === "PROVISIONAL_FAILURE_COUNTED") failed += 1;
        break;
      case "site.stopped":
        if (ingestedBeforeRestriction === null) ingestedBeforeRestriction = ingested;
        restrictions.push({ at: stamp(event.at), site: event.site, reason: event.reason, until: event.until ?? null });
        break;
      case "recovery":
        recovered += count(event.interruptedJobsQueuedAgain);
        break;
    }
  }
  const sum = (key: "pages" | "documentRequests" | "sentRequests" | "blockedRequests") =>
    passes.reduce((total, pass) => total + count((pass.requests as Record<string, unknown> | null)?.[key]), 0);
  const firstPassStartedAt = passes.find((pass) => pass.startedAt)?.startedAt ?? null;
  const lastPassEndedAt = [...passes].reverse().find((pass) => pass.endedAt)?.endedAt ?? null;
  return {
    passes,
    totals: {
      passes: passes.length,
      jobsIngested: ingested,
      pagesOpened: sum("pages"),
      documentRequests: sum("documentRequests"),
      sentRequests: sum("sentRequests"),
      blockedRequests: sum("blockedRequests"),
      failedAttemptsCounted: failed,
      incompletePages: passes.reduce((total, pass) => total + count(pass.incomplete), 0),
      restrictions,
      jobsIngestedBeforeFirstRestriction: ingestedBeforeRestriction ?? ingested,
      passesStartedAfterFirstRestriction: passesAfterRestriction,
      interruptedJobsRecovered: recovered,
      firstPassStartedAt,
      lastPassEndedAt,
      elapsedMs: firstPassStartedAt && lastPassEndedAt ? Date.parse(lastPassEndedAt) - Date.parse(firstPassStartedAt) : null,
    },
  };
}

// Which databases a package may read: the isolated test database or the
// preserved acceptance database, and only the one DATABASE_URL names.
export function packageDatabaseProblem(expected: string, connectionString: string | undefined): string | null {
  if (!connectionString) return "DATABASE_URL is not set";
  let actual: string;
  try {
    actual = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  } catch {
    return "DATABASE_URL is not a valid database URL";
  }
  if (actual !== expected) return `DATABASE_URL points to database "${actual}", not "${expected}"`;
  if (!/(^|_)(test|acceptance)(_|$)/i.test(actual)) return `"${actual}" is not a test or acceptance database; the normal application database is never read`;
  return null;
}

export function parsePackageArguments(
  argv: string[],
  environment: Record<string, string | undefined>,
  repository: string = process.cwd(),
): { ok: true; value: PackageArguments } | { ok: false; problem: string } {
  const names = ["--database", "--capture-session", "--latest", "--site", "--out", "--logs-dir", "--evidence-dir", "--window-minutes"];
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (!names.includes(name)) return { ok: false, problem: `Unknown option ${name}` };
    if (name === "--latest") {
      values.set(name, "yes");
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) return { ok: false, problem: `${name} needs a value` };
    values.set(name, value);
    index += 1;
  }
  const database = values.get("--database");
  if (!database) return { ok: false, problem: "--database is required" };
  const problem = packageDatabaseProblem(database, environment.DATABASE_URL);
  if (problem) return { ok: false, problem: `${problem}. Nothing was read.` };
  const session = values.get("--capture-session");
  if (Boolean(session) === values.has("--latest")) return { ok: false, problem: "Give exactly one of --capture-session <id> or --latest" };
  if (session && !uuid.test(session)) return { ok: false, problem: "--capture-session must be a capture session ID" };
  const out = values.get("--out");
  if (!out) return { ok: false, problem: "--out <new folder outside the repository> is required" };
  const outProblem = diagnosticsDirectoryProblem(out, repository);
  if (outProblem) return { ok: false, problem: `--out ${outProblem}` };
  if (existsSync(out) && readdirSync(out).length) return { ok: false, problem: "--out must be a new or empty folder" };
  const window = Number(values.get("--window-minutes") ?? 120);
  const host = (() => {
    try {
      return new URL(environment.DATABASE_URL!).host;
    } catch {
      return "";
    }
  })();
  const configuredLogs = environment.RETRIEVAL_WORKER_LOG_DIR?.trim();
  const logs = values.get("--logs-dir") ?? (configuredLogs?.toLowerCase() === "off" ? null : configuredLogs || null);
  return {
    ok: true,
    value: {
      connectionString: environment.DATABASE_URL!,
      database,
      databaseLabel: `${database} on ${host}`,
      captureSession: session ? session.toLowerCase() : "latest",
      site: values.get("--site") ?? null,
      out: path.resolve(out),
      logsDirectory: logs,
      evidenceDirectory: values.get("--evidence-dir") ?? (environment.PAGE_CAPTURE_EVIDENCE_DIR?.trim() || null),
      windowMinutes: Number.isFinite(window) && window > 0 ? window : 120,
    },
  };
}

type Row = Record<string, unknown>;

// The reads, all inside one READ ONLY transaction.
export async function readPackageRows(reader: PackageReader, selection: { captureSession: string | "latest"; site: string | null }) {
  return reader.read(async (transaction) => {
    const sessions = selection.captureSession === "latest"
      ? await transaction.$queryRawUnsafe<Row[]>(
          `SELECT "id", "site", "pageUrl", "pageTitle", "receivedAt", "itemIds", "counts", "createdAt" FROM "PageCaptureSession"
           ${selection.site ? `WHERE "site" = $1` : ""} ORDER BY "receivedAt" DESC LIMIT 1`,
          ...(selection.site ? [selection.site] : []),
        )
      : await transaction.$queryRawUnsafe<Row[]>(
          `SELECT "id", "site", "pageUrl", "pageTitle", "receivedAt", "itemIds", "counts", "createdAt" FROM "PageCaptureSession" WHERE "id" = $1::uuid`,
          selection.captureSession,
        );
    const session = sessions[0] ?? null;
    if (!session) return { session: null, items: [], sourceRecords: [], opportunities: [] };
    const items = await transaction.$queryRawUnsafe<Row[]>(
      `SELECT "id", "site", "externalId", "siteJobId", "sourceUrl", "title", "company", "location", "firstSeenAt", "lastSeenAt", "sightings",
              "lastBatchId", "status", "attempts", "lastAttemptAt", "nextAttemptAt", "lastReason", "opportunityId", "handoffOutcome", "handedOffAt",
              "createdAt", "updatedAt"
       FROM "PageCaptureItem" WHERE "id" = ANY($1::uuid[]) ORDER BY "firstSeenAt", "id"`,
      session.itemIds,
    );
    const externalIds = items.map((item) => item.externalId as string);
    const opportunityIds = [...new Set(items.map((item) => item.opportunityId).filter((id): id is string => typeof id === "string"))];
    const sourceRecords = await transaction.$queryRawUnsafe<Row[]>(
      `SELECT "id", "opportunityId", "source", "sourceType", "sourceUrl", "applicationUrl", "externalId", "requisitionId", "contentHash",
              "previousSourceRecordId", "duplicateDecision", "discoveredAt", "lastObservedAt", "normalizedAt", "createdAt", "updatedAt",
              length(coalesce("rawDescription", '')) AS "descriptionChars",
              "sourceMetadata"->'capture'->'readerRevision' AS "readerRevision",
              "sourceMetadata"->'capture'->'readQuality' AS "readQuality",
              "sourceMetadata"->'capture'->'extractor' AS "extractor"
       FROM "SourceRecord" WHERE "externalId" = ANY($1::text[]) OR "opportunityId" = ANY($2::uuid[]) ORDER BY "createdAt", "id"`,
      externalIds,
      opportunityIds,
    );
    const opportunities = await transaction.$queryRawUnsafe<Row[]>(
      `SELECT o."id", o."title", c."name" AS "company", o."location", o."status", o."source", o."externalListingId", o."canonicalUrl",
              o."applicationUrl", o."remoteStatus", o."salaryText", o."closingDate", o."createdAt", o."updatedAt",
              t."outcome" AS "triageOutcome", t."assessedAt" AS "triageAssessedAt", (t."userProfileId" IS NOT NULL) AS "triagedWithProfile",
              (SELECT count(*)::int FROM "SourceRecord" s WHERE s."opportunityId" = o."id") AS "sourceRecordCount"
       FROM "Opportunity" o LEFT JOIN "Company" c ON c."id" = o."companyId" LEFT JOIN "PreEvaluatorTriage" t ON t."opportunityId" = o."id"
       WHERE o."id" = ANY($1::uuid[]) ORDER BY o."createdAt", o."id"`,
      opportunityIds,
    );
    return { session, items, sourceRecords, opportunities };
  });
}

const json = (value: unknown) =>
  `${JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? Number(entry) : entry), 2)}\n`;
const time = (value: unknown) => (value instanceof Date ? value : typeof value === "string" ? new Date(value) : null);

export interface PackageResult {
  out: string;
  manifest: Record<string, unknown>;
}

export async function assembleDiagnosticsPackage(
  input: PackageArguments,
  reader: PackageReader,
  context: { gitSha: string | null; gitBranch: string | null; pageReaderRevision: number; environmentNames: string[]; now?: () => Date },
): Promise<PackageResult> {
  const now = (context.now ?? (() => new Date()))();
  const rows = await readPackageRows(reader, { captureSession: input.captureSession, site: input.site });
  mkdirSync(input.out, { recursive: true, mode: 0o700 });
  // Owner-only even when --out named an existing empty folder.
  chmodSync(input.out, 0o700);
  const write = (name: string, content: string) => writeFileSync(path.join(input.out, name), content, { mode: 0o600 });
  const files: Record<string, { present: boolean; count?: number; note?: string }> = {};

  if (!rows.session) {
    files["capture-session.json"] = { present: false, note: "no capture session matched" };
  } else {
    write("capture-session.json", json(rows.session));
    files["capture-session.json"] = { present: true };
    write("capture-items.json", json(rows.items));
    files["capture-items.json"] = { present: true, count: rows.items.length };
    const linked = new Set(rows.items.map((item) => item.opportunityId));
    const records = rows.sourceRecords.map((record) => ({ ...record, linkedToCapturedJob: record.opportunityId !== null && linked.has(record.opportunityId), orphan: record.opportunityId === null }));
    write("source-records.json", json(records));
    files["source-records.json"] = { present: true, count: records.length };
    write("opportunities.json", json(rows.opportunities));
    files["opportunities.json"] = { present: true, count: rows.opportunities.length };
  }

  // The window: from the session's arrival (less a margin) to its jobs'
  // latest step (plus a margin), bounded by now.
  const stamps = [rows.session?.receivedAt, ...rows.items.flatMap((item) => [item.lastAttemptAt, item.handedOffAt, item.updatedAt])]
    .map(time)
    .filter((value): value is Date => Boolean(value));
  const margin = input.windowMinutes * 60_000;
  const from = stamps.length ? new Date(Math.min(...stamps.map((stamp) => stamp.getTime())) - margin) : new Date(now.getTime() - margin);
  const to = new Date(Math.min(now.getTime(), (stamps.length ? Math.max(...stamps.map((stamp) => stamp.getTime())) : now.getTime()) + margin));

  // Worker diagnostics lines in the window.
  const itemIds = new Set(rows.items.map((item) => item.id as string));
  const logEvents: Array<Record<string, unknown>> = [];
  const logsRoot = input.logsDirectory ? path.join(path.resolve(input.logsDirectory), "logs") : null;
  if (logsRoot && existsSync(logsRoot)) {
    for (const name of readdirSync(logsRoot).filter((file) => diagnosticLogPattern.test(file)).sort()) {
      for (const line of readFileSync(path.join(logsRoot, name), "utf8").split("\n")) {
        if (!line.trim()) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const at = time(event.at);
        if (at && at >= from && at <= to) logEvents.push(event);
      }
    }
    write("worker-log.jsonl", logEvents.map((event) => JSON.stringify(event)).join("\n") + (logEvents.length ? "\n" : ""));
    files["worker-log.jsonl"] = { present: logEvents.length > 0, count: logEvents.length, ...(logEvents.length ? {} : { note: "no diagnostics events in the window" }) };
    const summary = retrievalSummary(logEvents);
    write("retrieval-summary.json", json(summary));
    files["retrieval-summary.json"] = { present: summary.passes.length > 0, count: summary.passes.length, ...(summary.passes.length ? {} : { note: "no worker pass in the window" }) };
  } else {
    files["worker-log.jsonl"] = { present: false, note: logsRoot ? `no diagnostics found under ${logsRoot}` : "diagnostics directory not given (RETRIEVAL_WORKER_LOG_DIR or --logs-dir)" };
    files["retrieval-summary.json"] = { present: false, note: "no worker diagnostics to summarize" };
  }

  // Page evidence files for these jobs, from any worker session folder.
  let copied = 0;
  if (input.evidenceDirectory && existsSync(input.evidenceDirectory)) {
    const root = path.resolve(input.evidenceDirectory);
    for (const folder of readdirSync(root)) {
      const directory = path.join(root, folder);
      if (!uuid.test(folder) || !statSync(directory).isDirectory()) continue;
      for (const file of readdirSync(directory)) {
        const itemId = file.split(".")[0] ?? "";
        if (!itemIds.has(itemId)) continue;
        const target = path.join(input.out, "page-evidence", folder);
        mkdirSync(path.join(input.out, "page-evidence"), { recursive: true, mode: 0o700 });
        mkdirSync(target, { recursive: true, mode: 0o700 });
        copyFileSync(path.join(directory, file), path.join(target, file));
        chmodSync(path.join(target, file), 0o600);
        copied += 1;
      }
    }
    files["page-evidence/"] = { present: copied > 0, count: copied, ...(copied ? {} : { note: "no page evidence for these jobs (capture was not enabled for that run)" }) };
  } else {
    files["page-evidence/"] = { present: false, note: "page evidence not enabled or not given (PAGE_CAPTURE_EVIDENCE_DIR or --evidence-dir)" };
  }

  // One timeline from the database steps and the worker events.
  const timeline: Array<{ at: string; source: string; what: string; itemId?: string; fields?: Record<string, unknown> }> = [];
  const add = (at: unknown, source: string, what: string, extra: { itemId?: string; fields?: Record<string, unknown> } = {}) => {
    const date = time(at);
    if (date) timeline.push({ at: date.toISOString(), source, what, ...extra });
  };
  if (rows.session) add(rows.session.receivedAt, "database", "capture session received", { fields: { counts: rows.session.counts } });
  for (const item of rows.items) {
    const itemId = item.id as string;
    add(item.firstSeenAt, "database", "job first seen", { itemId, fields: { externalId: item.externalId } });
    add(item.lastAttemptAt, "database", "job last attempted", { itemId, fields: { status: item.status, attempts: item.attempts, lastReason: item.lastReason } });
    add(item.handedOffAt, "database", "job handed to triage", { itemId, fields: { handoffOutcome: item.handoffOutcome } });
  }
  for (const record of rows.sourceRecords) add(record.createdAt, "database", "source record created", { fields: { id: record.id, externalId: record.externalId, opportunityId: record.opportunityId } });
  for (const opportunity of rows.opportunities) add(opportunity.createdAt, "database", "job created", { fields: { opportunityId: opportunity.id } });
  for (const event of logEvents) {
    const { at, event: name, ...fields } = event;
    add(at, "worker", String(name), { ...(typeof fields.itemId === "string" ? { itemId: fields.itemId } : {}), fields });
  }
  timeline.sort((left, right) => left.at.localeCompare(right.at));
  write("timeline.json", json(timeline));
  files["timeline.json"] = { present: true, count: timeline.length };

  const manifest = {
    createdAt: now.toISOString(),
    purpose: "Mode B failure evidence package (read-only; nothing was rerun, no site contacted, no evaluation, no paid call)",
    database: input.databaseLabel,
    readOnly: "one READ ONLY transaction on a read-only session",
    selection: { captureSession: rows.session?.id ?? null, requested: input.captureSession, site: rows.session?.site ?? input.site },
    window: { from: from.toISOString(), to: to.toISOString() },
    git: { sha: context.gitSha, branch: context.gitBranch },
    pageReaderRevision: context.pageReaderRevision,
    environment: { node: process.version, platform: process.platform, variablesSet: context.environmentNames },
    sources: { logsDirectory: logsRoot, evidenceDirectory: input.evidenceDirectory ? path.resolve(input.evidenceDirectory) : null },
    files,
    handling: "May contain job and page data. Keep local, never commit or upload, delete after review.",
  };
  write("manifest.json", json(manifest));
  return { out: input.out, manifest };
}
