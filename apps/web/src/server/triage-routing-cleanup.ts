import type {
  AutomaticDismissalReason,
  AutomaticDismissalResult,
  AutomaticDismissalRow,
  AutomaticDismissalSkip,
} from "@ai-career/database";
import { automaticDismissalSkipFromFacts } from "@ai-career/database";
import type { TitlePolicy } from "@ai-career/core";
import { opportunityViews } from "./opportunity-query";
import { automaticDismissalReason } from "./triage-routing";

// The one-time historical cleanup (November 25, 2026): the triage-to-
// lifecycle routing applied to jobs saved before it existed. Every job whose
// effective triage is REJECT, or whose title is outside the target job
// titles, goes to Dismissed through the same guarded writer automatic
// acquisition uses, with the same exclusions: application history, any
// lifecycle decision of the user's, a manual triage decision, evaluation
// work in flight. Nothing is deleted and every move is reversible (Restore,
// Move to, or --restore with the manifest the apply wrote).

export interface HistoricalRoutingCandidate {
  id: string;
  title: string | null;
  status: string;
  reason: AutomaticDismissalReason;
  // REJECT and outside the target job titles at once.
  both: boolean;
}

export interface HistoricalRoutingPlan {
  total: number;
  byStatus: Record<string, number>;
  activeNow: number;
  dismissedNow: number;
  matched: { reject: number; outsideTitles: number; overlap: number };
  candidates: HistoricalRoutingCandidate[];
  skipped: Partial<Record<AutomaticDismissalSkip, HistoricalRoutingCandidate[]>>;
  // Already moved by this routing earlier (re-running changes nothing).
  alreadyRouted: number;
  projected: { active: number; dismissed: number; total: number };
}

const activeStatuses = new Set<string>(opportunityViews.active.statuses);

export function planHistoricalRouting(rows: readonly AutomaticDismissalRow[], policy: TitlePolicy): HistoricalRoutingPlan {
  const byStatus: Record<string, number> = {};
  const skipped: HistoricalRoutingPlan["skipped"] = {};
  const candidates: HistoricalRoutingCandidate[] = [];
  let reject = 0;
  let outsideTitles = 0;
  let overlap = 0;
  let alreadyRouted = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    const effective = row.manualDecision ?? row.triageOutcome;
    const titleAccepted = policy(row.title).verdict === "ACCEPTED";
    const isReject = effective === "REJECT";
    const reason = automaticDismissalReason({ triageOutcome: effective, titleAccepted });
    if (!reason) continue;
    if (isReject) reject += 1;
    if (!titleAccepted) outsideTitles += 1;
    if (isReject && !titleAccepted) overlap += 1;
    const candidate = { id: row.id, title: row.title, status: row.status, reason, both: isReject && !titleAccepted };
    if (row.status === "REJECTED_BY_USER" && row.lastAction === "DISMISS" && row.lastAutomaticReason) {
      alreadyRouted += 1;
      continue;
    }
    const skip = automaticDismissalSkipFromFacts(row);
    if (skip) (skipped[skip] ??= []).push(candidate);
    else candidates.push(candidate);
  }
  const activeNow = rows.filter((row) => activeStatuses.has(row.status)).length;
  const dismissedNow = byStatus.REJECTED_BY_USER ?? 0;
  const movedFromActive = candidates.filter((candidate) => activeStatuses.has(candidate.status)).length;
  return {
    total: rows.length,
    byStatus,
    activeNow,
    dismissedNow,
    matched: { reject, outsideTitles, overlap },
    candidates,
    skipped,
    alreadyRouted,
    projected: { active: activeNow - movedFromActive, dismissed: dismissedNow + candidates.length, total: rows.length },
  };
}

const reasonLabel: Record<AutomaticDismissalReason, string> = {
  TRIAGE_REJECT: "triage REJECT",
  OUTSIDE_TARGET_TITLES: "outside target titles",
};

const skipLabel: Record<AutomaticDismissalSkip, string> = {
  NOT_FOUND: "no longer exists",
  ALREADY_DISMISSED: "already in Dismissed (moved by you)",
  NOT_A_SYSTEM_STATE: "Saved, Applied, Archived, Closed or not normalized",
  APPLICATION_HISTORY: "has application history",
  USER_LIFECYCLE_DECISION: "you saved, moved or restored it before",
  MANUAL_TRIAGE_DECISION: "has your manual triage decision",
  EVALUATION_IN_PROGRESS: "an evaluation is in progress or deferred",
  CONFLICT: "changed while being moved",
};

export function formatHistoricalRoutingPlan(plan: HistoricalRoutingPlan, options: { listCandidates: boolean }): string {
  const lines = [
    "Historical triage routing — dry run (read-only; nothing was changed)",
    "",
    `Opportunities: ${plan.total} (Active ${plan.activeNow}, Dismissed ${plan.dismissedNow})`,
    `By status: ${Object.entries(plan.byStatus).sort().map(([status, count]) => `${status} ${count}`).join(", ")}`,
    "",
    `Matched: triage REJECT ${plan.matched.reject}, outside target titles ${plan.matched.outsideTitles}, both ${plan.matched.overlap} (counted once, as REJECT)`,
    `Would move to Dismissed: ${plan.candidates.length}` +
      ` (${plan.candidates.filter((candidate) => candidate.reason === "TRIAGE_REJECT").length} REJECT,` +
      ` ${plan.candidates.filter((candidate) => candidate.reason === "OUTSIDE_TARGET_TITLES").length} outside target titles)`,
    `Already moved by this routing earlier: ${plan.alreadyRouted}`,
  ];
  const skipped = Object.entries(plan.skipped) as Array<[AutomaticDismissalSkip, HistoricalRoutingCandidate[]]>;
  lines.push(`Left where they are: ${skipped.reduce((sum, [, items]) => sum + items.length, 0)}`);
  for (const [skip, items] of skipped) {
    lines.push(`  ${skipLabel[skip]}: ${items.length}`);
    for (const item of items) lines.push(`    ${item.id}  ${item.status}  ${reasonLabel[item.reason]}  ${item.title ?? "(no title)"}`);
  }
  lines.push("", `After applying: Active ${plan.projected.active}, Dismissed ${plan.projected.dismissed}, total ${plan.projected.total} (nothing is deleted)`);
  if (options.listCandidates) {
    lines.push("", "Would move:");
    for (const item of plan.candidates) lines.push(`  ${item.id}  ${item.status}  ${reasonLabel[item.reason]}${item.both ? " (also outside target titles)" : ""}  ${item.title ?? "(no title)"}`);
  }
  return lines.join("\n");
}

export interface HistoricalRoutingManifest {
  kind: "historical-triage-routing";
  version: 1;
  database: string;
  appliedAt: string;
  moved: Array<{ id: string; from: string; reason: AutomaticDismissalReason; title: string | null }>;
}

export async function applyHistoricalRouting(
  plan: HistoricalRoutingPlan,
  dismiss: (input: { opportunityId: string; reason: AutomaticDismissalReason }) => Promise<AutomaticDismissalResult>,
  onResult?: (candidate: HistoricalRoutingCandidate, result: AutomaticDismissalResult) => void,
): Promise<{ moved: HistoricalRoutingManifest["moved"]; skipped: Array<{ id: string; skip: AutomaticDismissalSkip }> }> {
  const moved: HistoricalRoutingManifest["moved"] = [];
  const skipped: Array<{ id: string; skip: AutomaticDismissalSkip }> = [];
  // One opportunity per guarded transaction, rechecked under its row lock.
  for (const candidate of plan.candidates) {
    const result = await dismiss({ opportunityId: candidate.id, reason: candidate.reason });
    onResult?.(candidate, result);
    if (result.status === "DISMISSED") moved.push({ id: candidate.id, from: result.from, reason: result.reason, title: candidate.title });
    else skipped.push({ id: candidate.id, skip: result.skip });
  }
  return { moved, skipped };
}

// Each moved job, read back: in Dismissed, its latest action this routing's
// dismissal with the same reason.
export function verifyManifest(manifest: HistoricalRoutingManifest, rows: readonly AutomaticDismissalRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const problems: Array<{ id: string; problem: string }> = [];
  for (const entry of manifest.moved) {
    const row = byId.get(entry.id);
    if (!row) problems.push({ id: entry.id, problem: "no longer exists" });
    else if (row.status !== "REJECTED_BY_USER") problems.push({ id: entry.id, problem: `status is ${row.status}, not Dismissed` });
    else if (row.lastAction !== "DISMISS" || row.lastAutomaticReason !== entry.reason) problems.push({ id: entry.id, problem: "its latest action is not this routing's dismissal" });
  }
  return { checked: manifest.moved.length, verified: manifest.moved.length - problems.length, problems };
}

export function parseManifest(text: string): HistoricalRoutingManifest {
  const parsed = JSON.parse(text) as Partial<HistoricalRoutingManifest>;
  if (parsed.kind !== "historical-triage-routing" || parsed.version !== 1 || !Array.isArray(parsed.moved) || typeof parsed.database !== "string") {
    throw new Error("not a historical triage routing manifest");
  }
  return parsed as HistoricalRoutingManifest;
}

export type HistoricalRoutingArguments =
  | { ok: true; database: string; mode: "dry-run"; list: boolean }
  | { ok: true; database: string; mode: "apply"; expect: number; manifest: string }
  | { ok: true; database: string; mode: "verify" | "restore"; manifest: string; expect?: number }
  | { ok: false; problem: string };

export const historicalRoutingUsage = [
  "Usage: pnpm triage:route-historical --database <database name> [--list]",
  "       pnpm triage:route-historical --database <name> --apply --expect <count from the dry run> --manifest <file to write>",
  "       pnpm triage:route-historical --database <name> --verify <manifest>",
  "       pnpm triage:route-historical --database <name> --restore <manifest> --expect <moved count>",
].join("\n");

// The connection string is never echoed.
export function parseHistoricalRoutingArguments(args: readonly string[], environment: NodeJS.ProcessEnv): HistoricalRoutingArguments {
  const withValue = new Set(["--database", "--expect", "--manifest", "--verify", "--restore"]);
  const flags = new Set([...withValue, "--apply", "--list"]);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!flags.has(arg)) return { ok: false, problem: `Unknown option ${arg}` };
    if (withValue.has(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, problem: `${arg} needs a value` };
      values.set(arg, value);
      index += 1;
    } else values.set(arg, "");
  }
  const url = environment.DATABASE_URL;
  const database = values.get("--database");
  if (!url || !database) return { ok: false, problem: "DATABASE_URL and --database are required" };
  let named: string;
  try {
    named = new URL(url).pathname.replace(/^\//, "");
  } catch {
    return { ok: false, problem: "DATABASE_URL is not a valid connection URL" };
  }
  if (named !== database) return { ok: false, problem: `--database ${database} does not match the database DATABASE_URL points to (${named})` };
  const expectText = values.get("--expect");
  const expect = expectText !== undefined && /^\d+$/.test(expectText) ? Number(expectText) : undefined;
  if (expectText !== undefined && expect === undefined) return { ok: false, problem: "--expect takes a whole number" };
  const modes = ["--apply", "--verify", "--restore"].filter((flag) => values.has(flag));
  if (modes.length > 1) return { ok: false, problem: "Use one of --apply, --verify and --restore" };
  if (values.has("--apply")) {
    const manifest = values.get("--manifest");
    if (expect === undefined || !manifest) return { ok: false, problem: "--apply needs --expect <count from the dry run> and --manifest <file to write>" };
    return { ok: true, database, mode: "apply", expect, manifest };
  }
  if (values.has("--verify")) return { ok: true, database, mode: "verify", manifest: values.get("--verify")! };
  if (values.has("--restore")) {
    if (expect === undefined) return { ok: false, problem: "--restore needs --expect <moved count in the manifest>" };
    return { ok: true, database, mode: "restore", manifest: values.get("--restore")!, expect };
  }
  if (expect !== undefined || values.has("--manifest")) return { ok: false, problem: "--expect and --manifest go with --apply or --restore" };
  return { ok: true, database, mode: "dry-run", list: values.has("--list") };
}
