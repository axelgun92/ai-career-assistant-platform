import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultDiagnosticsDirectory, removeEvidenceSessions, removeExpired } from "./worker-diagnostics";

// pnpm diagnostics:cleanup — applies the retention of the retrieval worker's
// diagnostics and page evidence now, without starting the worker (the worker
// applies it only when it starts, and to page evidence only while
// PAGE_CAPTURE_EVIDENCE_DIR is set). Deletes only files and folders these
// tools create: retrieval-worker-<date>.jsonl logs and worker-session
// folders of page evidence. Evidence packages are separate folders you
// delete yourself.
//   --logs-dir <dir>          diagnostics root (default RETRIEVAL_WORKER_LOG_DIR, else ~/.ai-job-assistant/diagnostics)
//   --evidence-dir <dir>      page evidence root (default PAGE_CAPTURE_EVIDENCE_DIR)
//   --all-evidence            delete every page-evidence session folder, whatever its age
// Retention: RETRIEVAL_WORKER_LOG_RETENTION_DAYS (30) and PAGE_CAPTURE_EVIDENCE_RETENTION_DAYS (7).

const days = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function parseCleanupArguments(argv: string[], environment: Record<string, string | undefined>) {
  const values = new Map<string, string>();
  let allEvidence = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--all-evidence") {
      allEvidence = true;
      continue;
    }
    if (!["--logs-dir", "--evidence-dir"].includes(name)) return { ok: false as const, problem: `Unknown option ${name}` };
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) return { ok: false as const, problem: `${name} needs a value` };
    values.set(name, value);
    index += 1;
  }
  const configuredLogs = environment.RETRIEVAL_WORKER_LOG_DIR?.trim();
  const logs = values.get("--logs-dir") ?? (configuredLogs?.toLowerCase() === "off" ? null : configuredLogs || defaultDiagnosticsDirectory);
  return {
    ok: true as const,
    logs,
    logDays: days(environment.RETRIEVAL_WORKER_LOG_RETENTION_DAYS, 30),
    evidence: values.get("--evidence-dir") ?? (environment.PAGE_CAPTURE_EVIDENCE_DIR?.trim() || null),
    evidenceDays: days(environment.PAGE_CAPTURE_EVIDENCE_RETENTION_DAYS, 7),
    allEvidence,
  };
}

export function cleanDiagnostics(input: { logs: string | null; logDays: number; evidence: string | null; evidenceDays: number; allEvidence: boolean; now?: Date }) {
  const now = input.now ?? new Date();
  const logsFolder = input.logs ? path.join(path.resolve(input.logs), "logs") : null;
  const logs = logsFolder && existsSync(logsFolder) ? removeExpired(logsFolder, input.logDays, now) : [];
  const evidence = input.evidence && existsSync(input.evidence)
    ? removeEvidenceSessions(path.resolve(input.evidence), { retentionDays: input.evidenceDays, now, all: input.allEvidence })
    : [];
  return { logsFolder, logs, evidence };
}

function main() {
  const parsed = parseCleanupArguments(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(parsed.problem);
    process.exitCode = 1;
    return;
  }
  const result = cleanDiagnostics(parsed);
  console.info(`Diagnostics logs: ${result.logsFolder ?? "off"}; removed ${result.logs.length} file(s) older than ${parsed.logDays} day(s).`);
  console.info(
    parsed.evidence
      ? `Page evidence: ${path.resolve(parsed.evidence)}; removed ${result.evidence.length} session folder(s)${parsed.allEvidence ? " (all)" : ` older than ${parsed.evidenceDays} day(s)`}.`
      : "Page evidence: no folder given (PAGE_CAPTURE_EVIDENCE_DIR or --evidence-dir); nothing removed.",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
