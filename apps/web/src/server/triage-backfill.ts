import { createTitlePolicy, type TitlePolicyPatterns } from "@ai-career/core";
import { EvaluationApiError } from "./evaluation-errors";
import type { TriageAssessment } from "./evaluation-service";
import { defaultTitlePolicyPatterns } from "./title-policy-service";
import { backfillClassOf, type BackfillClass, type TriageCoverageRow } from "./triage-coverage-audit";

// One-time triage-only backfill (November 24, 2026; approved by Alex after the
// read-only audit). Candidates are exactly the audit's CANDIDATE class
// (`backfillClassOf`): customer-success, Active or Saved, never triaged, no
// evaluation and no open evaluation work, title inside the active target job
// titles. A dry run (the default) only lists them. With apply, each candidate
// is read again immediately before it is processed and skipped unless it is
// still a candidate and the active profile is the one the run started with;
// then the existing EvaluationService.assessTriage runs (the active profile,
// the deterministic triage gate, one PreEvaluatorTriage record). Nothing else
// is written: no evaluation request, admission, budget reservation, queued
// work or provider call, and lifecycle states, applications and duplicate
// relationships are not touched. A failure is recorded and the run goes on.

export interface TriageBackfillSnapshot {
  rows: readonly TriageCoverageRow[];
  activeProfile: { id: string; version: number } | null;
  titlePolicy: TitlePolicyPatterns | null;
}

export interface TriageBackfillDependencies {
  // Every opportunity's stored records, or one opportunity's (the recheck).
  read(opportunityId?: string): Promise<TriageBackfillSnapshot>;
  assess(opportunityId: string): Promise<TriageAssessment>;
  // The current triage record, read just before assessing.
  existing(opportunityId: string): Promise<unknown | null>;
}

export type TriageBackfillResult =
  | "EVALUATE"
  | "NEEDS_REVIEW"
  | "REJECT"
  | `SKIPPED:${Exclude<BackfillClass, "CANDIDATE">}`
  | "SKIPPED:NOT_FOUND"
  | "SKIPPED:PROFILE_CHANGED"
  | "NO_PROFILE"
  | `UNAVAILABLE:${string}`
  | "FAILED";

export interface TriageBackfillReport {
  mode: "DRY_RUN" | "APPLY";
  activeProfile: { id: string; version: number } | null;
  titlePolicy: "SAVED" | "DEFAULTS";
  total: number;
  classes: Partial<Record<BackfillClass, number>>;
  candidates: Array<{ id: string; title: string | null; status: string }>;
  // Apply only: one entry per candidate, in order, and the tallies.
  results: Array<{ id: string; title: string | null; result: TriageBackfillResult }>;
  outcomes: Partial<Record<TriageBackfillResult, number>>;
  // Why nothing was processed, when that is the case.
  refused: "NO_ACTIVE_PROFILE" | "CANDIDATE_COUNT_CHANGED" | null;
}

function classify(snapshot: TriageBackfillSnapshot) {
  const policy = createTitlePolicy(snapshot.titlePolicy ?? defaultTitlePolicyPatterns);
  const accepted = (title: string | null) => policy(title).verdict === "ACCEPTED";
  return snapshot.rows.map((row) => ({ row, kind: backfillClassOf(row, accepted) }));
}

export async function runTriageBackfill(
  dependencies: TriageBackfillDependencies,
  options: { apply: boolean; expectedCandidates?: number; onResult?: (entry: TriageBackfillReport["results"][number]) => void },
): Promise<TriageBackfillReport> {
  const start = await dependencies.read();
  const classified = classify(start);
  const classes: Partial<Record<BackfillClass, number>> = {};
  for (const { kind } of classified) classes[kind] = (classes[kind] ?? 0) + 1;
  const candidates = classified.filter((item) => item.kind === "CANDIDATE").map(({ row }) => ({ id: row.id, title: row.title, status: row.status }));
  const report: TriageBackfillReport = {
    mode: options.apply ? "APPLY" : "DRY_RUN",
    activeProfile: start.activeProfile,
    titlePolicy: start.titlePolicy ? "SAVED" : "DEFAULTS",
    total: start.rows.length,
    classes,
    candidates,
    results: [],
    outcomes: {},
    refused: null,
  };
  if (!start.activeProfile) return { ...report, refused: "NO_ACTIVE_PROFILE" };
  if (!options.apply) return report;
  // Apply processes exactly the set the user reviewed in the dry run.
  if (options.expectedCandidates === undefined || options.expectedCandidates !== candidates.length) {
    return { ...report, refused: "CANDIDATE_COUNT_CHANGED" };
  }
  const record = (id: string, title: string | null, result: TriageBackfillResult) => {
    const entry = { id, title, result };
    report.results.push(entry);
    report.outcomes[result] = (report.outcomes[result] ?? 0) + 1;
    options.onResult?.(entry);
  };
  for (const candidate of candidates) {
    try {
      // Recheck immediately before processing.
      const now = await dependencies.read(candidate.id);
      const [current] = classify(now);
      if (!current) {
        record(candidate.id, candidate.title, "SKIPPED:NOT_FOUND");
        continue;
      }
      if (current.kind !== "CANDIDATE") {
        record(candidate.id, current.row.title, `SKIPPED:${current.kind}`);
        continue;
      }
      if (now.activeProfile?.id !== start.activeProfile.id || now.activeProfile.version !== start.activeProfile.version) {
        record(candidate.id, current.row.title, "SKIPPED:PROFILE_CHANGED");
        continue;
      }
      // An assessment written in the meantime (another capture) is kept.
      if (await dependencies.existing(candidate.id)) {
        record(candidate.id, current.row.title, "SKIPPED:ALREADY_ASSESSED");
        continue;
      }
      const assessment = await dependencies.assess(candidate.id);
      record(
        candidate.id,
        current.row.title,
        assessment.status === "ASSESSED" ? assessment.triage.outcome :
          assessment.status === "NO_PROFILE" ? "NO_PROFILE" : `UNAVAILABLE:${assessment.reason}`,
      );
    } catch (error) {
      record(candidate.id, candidate.title, error instanceof EvaluationApiError ? `UNAVAILABLE:${error.code}` : "FAILED");
    }
  }
  return report;
}

export function formatTriageBackfillReport(report: TriageBackfillReport): string {
  const lines: string[] = [];
  const list = (counts: Record<string, number | undefined>) =>
    Object.entries(counts).sort(([, left], [, right]) => (right ?? 0) - (left ?? 0)).map(([key, value]) => `    ${key}: ${value}`);
  lines.push(`Mode: ${report.mode === "APPLY" ? "APPLY (writes triage records only)" : "DRY RUN (nothing written)"}`);
  lines.push(`Opportunities: ${report.total}`);
  lines.push(`Active profile: ${report.activeProfile ? `version ${report.activeProfile.version}` : "none"}; target job titles: ${report.titlePolicy.toLowerCase()}`);
  lines.push("Backfill classes:", ...list(report.classes));
  lines.push(`Candidates: ${report.candidates.length}`);
  if (report.refused === "NO_ACTIVE_PROFILE") lines.push("Refused: no active User Profile; nothing can be triaged.");
  if (report.refused === "CANDIDATE_COUNT_CHANGED") {
    lines.push(`Refused: --apply needs --expect ${report.candidates.length} (the current candidate count, as the dry run shows). Nothing was written.`);
  }
  if (report.mode === "DRY_RUN" && !report.refused) {
    for (const candidate of report.candidates) lines.push(`    ${candidate.id}  ${candidate.status}  ${candidate.title ?? "(no title)"}`);
    lines.push(`To apply: add --apply --expect ${report.candidates.length}`);
  }
  if (report.mode === "APPLY" && !report.refused) lines.push("Results:", ...list(report.outcomes));
  return lines.join("\n");
}
