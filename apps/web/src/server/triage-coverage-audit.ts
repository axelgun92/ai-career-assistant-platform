import { createTitlePolicy, type TitlePolicyPatterns } from "@ai-career/core";
import type { readOnlyTransaction } from "@ai-career/database";
import { defaultTitlePolicyPatterns } from "./title-policy-service";

// Triage coverage audit (November 22, 2026): which saved opportunities have
// really been through the deterministic pre-evaluator triage, which have
// not and why, and which are candidates for a triage-only backfill. It reads
// the stored records themselves (triage rows, hand-off outcomes,
// evaluations, admissions, deferrals) and never infers anything from the
// dashboard's lifecycle views. Read-only: run inside a READ ONLY transaction;
// nothing is assessed, requested or changed.

export interface TriageCoverageRow {
  id: string;
  status: string;
  domain: string | null;
  title: string | null;
  sourceType: string | null;
  captureMethod: string | null;
  automaticOutcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT" | null;
  manualDecision: "EVALUATE" | "REJECT" | null;
  triageProfileId: string | null;
  triageProfileVersion: number | null;
  completedEvaluations: number;
  activeEvaluations: number;
  failedEvaluations: number;
  openAdmissions: number;
  openDeferrals: number;
  paidAttempts: number;
  handoffOutcome: string | null;
  captureItems: number;
  hasApplication: boolean;
  duplicateDecision: "MATCH" | "PROBABLE_MATCH" | "DISTINCT" | null;
}

export type TriageState = "MANUAL_EVALUATE" | "MANUAL_REJECT" | "EVALUATE" | "NEEDS_REVIEW" | "REJECT" | "NEVER_ASSESSED";
export type EvaluationState = "COMPLETED" | "IN_PROGRESS" | "DEFERRED" | "FAILED_ONLY" | "NONE";
export type BackfillClass =
  | "ALREADY_ASSESSED"
  | "CANDIDATE"
  | "OUTSIDE_TARGET_TITLES"
  | "ALREADY_EVALUATED"
  | "EVALUATION_IN_PROGRESS"
  | "USER_ACTED"
  | "CANNOT_ASSESS";

export const systemStates = new Set(["NORMALIZED", "EVALUATED", "RECOMMENDED"]);

export function triageStateOf(row: TriageCoverageRow): TriageState {
  if (row.manualDecision === "EVALUATE") return "MANUAL_EVALUATE";
  if (row.manualDecision === "REJECT") return "MANUAL_REJECT";
  return row.automaticOutcome ?? "NEVER_ASSESSED";
}

export function evaluationStateOf(row: TriageCoverageRow): EvaluationState {
  if (row.completedEvaluations > 0) return "COMPLETED";
  if (row.activeEvaluations > 0 || row.openAdmissions > 0) return "IN_PROGRESS";
  if (row.openDeferrals > 0) return "DEFERRED";
  if (row.failedEvaluations > 0) return "FAILED_ONLY";
  return "NONE";
}

// Why an opportunity has no triage record, from what is stored (first match).
export function missingAssessmentReason(row: TriageCoverageRow): string {
  if (row.status === "DISCOVERED") return "Never normalized (DISCOVERED placeholder)";
  if (row.domain !== "customer-success") return "Not a Customer Success opportunity";
  if (row.handoffOutcome?.startsWith("FAILED:")) return `Results-page capture hand-off refused: ${row.handoffOutcome.slice("FAILED:".length)}`;
  if (row.handoffOutcome === "NOT_SENT:OUTSIDE_ROLE_FAMILIES") return "Results-page capture: title outside the role families (November 18 gate), not handed off";
  if (row.captureItems > 0 && row.handoffOutcome === null) return "Results-page capture: saved without a hand-off (a refresh or a capture before hand-offs existed)";
  if (row.captureItems > 0) return `Results-page capture: hand-off ${row.handoffOutcome} left no triage record`;
  if (row.sourceType === "BROWSER_EXTENSION") return "Single Capture: no active profile at save, or saved before triage at save (November 5)";
  if (row.sourceType === "MANUAL") return "Added manually: triage runs only when an evaluation is requested";
  // Configured sources triage new jobs from November 23, 2026; an earlier
  // job, or one stored with no active profile, has no record.
  return "Configured source retrieval: retrieved before automatic triage (November 23), or with no active profile";
}

export function backfillClassOf(row: TriageCoverageRow, accepted: (title: string | null) => boolean): BackfillClass {
  if (row.automaticOutcome) return "ALREADY_ASSESSED";
  if (row.status === "DISCOVERED" || row.domain !== "customer-success") return "CANNOT_ASSESS";
  if (!systemStates.has(row.status) && row.status !== "SAVED") return "USER_ACTED";
  if (row.completedEvaluations > 0) return "ALREADY_EVALUATED";
  if (row.activeEvaluations > 0 || row.openAdmissions > 0 || row.openDeferrals > 0) return "EVALUATION_IN_PROGRESS";
  if (!accepted(row.title)) return "OUTSIDE_TARGET_TITLES";
  return "CANDIDATE";
}

const tally = <K extends string>(values: K[]) => {
  const counts: Partial<Record<K, number>> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

export interface TriageCoverageReport {
  total: number;
  preEvaluationReviewView: number;
  activeProfile: { id: string; version: number } | null;
  titlePolicy: "SAVED" | "DEFAULTS";
  triageStates: Partial<Record<TriageState, number>>;
  triageStatesInPreEvaluationReview: Partial<Record<TriageState, number>>;
  manualDecisions: number;
  assessedWithOtherProfileVersion: number;
  evaluationStates: Partial<Record<EvaluationState, number>>;
  paidOpportunities: number;
  handoffs: { failed: Record<string, number>; outsideRoleFamilies: number; other: Record<string, number>; none: number };
  missingAssessmentReasons: Record<string, number>;
  backfill: Partial<Record<BackfillClass, number>>;
  backfillCandidateIds: string[];
  duplicates: { match: number; probableMatch: number };
  crossTab: Record<string, Partial<Record<EvaluationState, number>>>;
}

export function buildTriageCoverageReport(input: {
  rows: readonly TriageCoverageRow[];
  activeProfile: { id: string; version: number } | null;
  titlePolicy: TitlePolicyPatterns | null;
}): TriageCoverageReport {
  const policy = createTitlePolicy(input.titlePolicy ?? defaultTitlePolicyPatterns);
  const accepted = (title: string | null) => policy(title).verdict === "ACCEPTED";
  const rows = input.rows;
  const review = rows.filter((row) => systemStates.has(row.status));
  const failed: Record<string, number> = {};
  const other: Record<string, number> = {};
  let outsideRoleFamilies = 0;
  let none = 0;
  for (const row of rows) {
    if (!row.handoffOutcome) none += row.captureItems > 0 ? 0 : 1;
    else if (row.handoffOutcome.startsWith("FAILED:")) failed[row.handoffOutcome] = (failed[row.handoffOutcome] ?? 0) + 1;
    else if (row.handoffOutcome === "NOT_SENT:OUTSIDE_ROLE_FAMILIES") outsideRoleFamilies += 1;
    else other[row.handoffOutcome] = (other[row.handoffOutcome] ?? 0) + 1;
  }
  const crossTab: TriageCoverageReport["crossTab"] = {};
  for (const row of rows) {
    const state = triageStateOf(row);
    crossTab[state] ??= {};
    const evaluation = evaluationStateOf(row);
    crossTab[state]![evaluation] = (crossTab[state]![evaluation] ?? 0) + 1;
  }
  const classes = rows.map((row) => ({ row, kind: backfillClassOf(row, accepted) }));
  return {
    total: rows.length,
    preEvaluationReviewView: review.length,
    activeProfile: input.activeProfile,
    titlePolicy: input.titlePolicy ? "SAVED" : "DEFAULTS",
    triageStates: tally(rows.map(triageStateOf)),
    triageStatesInPreEvaluationReview: tally(review.map(triageStateOf)),
    manualDecisions: rows.filter((row) => row.manualDecision !== null).length,
    assessedWithOtherProfileVersion: input.activeProfile
      ? rows.filter((row) => row.automaticOutcome && (row.triageProfileId !== input.activeProfile!.id || row.triageProfileVersion !== input.activeProfile!.version)).length
      : 0,
    evaluationStates: tally(rows.map(evaluationStateOf)),
    paidOpportunities: rows.filter((row) => row.paidAttempts > 0).length,
    handoffs: { failed, outsideRoleFamilies, other, none },
    missingAssessmentReasons: tally(rows.filter((row) => !row.automaticOutcome).map(missingAssessmentReason)) as Record<string, number>,
    backfill: tally(classes.map((item) => item.kind)),
    backfillCandidateIds: classes.filter((item) => item.kind === "CANDIDATE").map((item) => item.row.id),
    duplicates: {
      match: rows.filter((row) => row.duplicateDecision === "MATCH").length,
      probableMatch: rows.filter((row) => row.duplicateDecision === "PROBABLE_MATCH").length,
    },
    crossTab,
  };
}

// The stored records, one row per opportunity, in plain SQL that also runs on
// a database without the November 22 migration. With an opportunity ID, only
// that opportunity's row (the triage backfill's recheck before each job).
type ReadTransaction = Parameters<Parameters<typeof readOnlyTransaction>[1]>[0];

export async function readTriageCoverage(transaction: ReadTransaction, options: { opportunityId?: string } = {}) {
  const only = options.opportunityId ?? null;
  const rows = await transaction.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      o."id", o."status"::text AS "status", o."domain", o."title", o."sourceType"::text AS "sourceType",
      (SELECT s."sourceMetadata"->'capture'->>'method' FROM "SourceRecord" s WHERE s."opportunityId" = o."id" ORDER BY s."createdAt" DESC LIMIT 1) AS "captureMethod",
      t."outcome"::text AS "automaticOutcome", t."manualDecision"::text AS "manualDecision",
      t."userProfileId" AS "triageProfileId", t."userProfileVersion" AS "triageProfileVersion",
      (SELECT COUNT(*) FROM "Evaluation" e WHERE e."opportunityId" = o."id" AND e."status" = 'COMPLETED')::int AS "completedEvaluations",
      (SELECT COUNT(*) FROM "Evaluation" e WHERE e."opportunityId" = o."id" AND e."status" IN ('PENDING', 'RUNNING'))::int AS "activeEvaluations",
      (SELECT COUNT(*) FROM "Evaluation" e WHERE e."opportunityId" = o."id" AND e."status" = 'FAILED')::int AS "failedEvaluations",
      (SELECT COUNT(*) FROM "EvaluationAdmission" a WHERE a."opportunityId" = o."id" AND a."abandonedAt" IS NULL AND a."evaluationId" IS NULL)::int AS "openAdmissions",
      (SELECT COUNT(*) FROM "DeferredEvaluation" d WHERE d."opportunityId" = o."id" AND d."status" = 'DEFERRED')::int AS "openDeferrals",
      (SELECT COUNT(*) FROM "SemanticOperationAttempt" p WHERE p."opportunityId" = o."id")::int AS "paidAttempts",
      (SELECT i."handoffOutcome" FROM "PageCaptureItem" i WHERE i."opportunityId" = o."id" AND i."handoffOutcome" IS NOT NULL ORDER BY i."handedOffAt" DESC NULLS LAST LIMIT 1) AS "handoffOutcome",
      (SELECT COUNT(*) FROM "PageCaptureItem" i WHERE i."opportunityId" = o."id")::int AS "captureItems",
      EXISTS (SELECT 1 FROM "Application" ap WHERE ap."opportunityId" = o."id") AS "hasApplication",
      (SELECT r."decision"::text FROM "DuplicateReference" r WHERE r."opportunityId" = o."id" OR r."relatedOpportunityId" = o."id"
        ORDER BY CASE r."decision"::text WHEN 'MATCH' THEN 0 WHEN 'PROBABLE_MATCH' THEN 1 ELSE 2 END LIMIT 1) AS "duplicateDecision"
    FROM "Opportunity" o
    LEFT JOIN "PreEvaluatorTriage" t ON t."opportunityId" = o."id"
    WHERE (${only}::uuid IS NULL OR o."id" = ${only}::uuid)
    ORDER BY o."discoveredAt" ASC, o."id" ASC`;
  const [active] = await transaction.$queryRaw<Array<{ id: string; version: number }>>`
    SELECT p."id", p."version" FROM "ActiveUserProfile" a JOIN "UserProfile" p ON p."id" = a."userProfileId" WHERE a."domain" = 'customer-success'`;
  // The saved target job titles exist only after the November 22 migration;
  // without them the defaults apply, as in the app.
  let titlePolicy: TitlePolicyPatterns | null = null;
  const [exists] = await transaction.$queryRawUnsafe<Array<{ table: string | null }>>(`SELECT to_regclass('"TitlePolicySetting"')::text AS "table"`);
  if (exists?.table) {
    const [saved] = await transaction.$queryRaw<Array<{ acceptedPatterns: string[]; excludedPatterns: string[] }>>`
      SELECT "acceptedPatterns", "excludedPatterns" FROM "TitlePolicySetting" WHERE "domain" = 'customer-success'`;
    if (saved) titlePolicy = { accepted: saved.acceptedPatterns, excluded: saved.excludedPatterns };
  }
  return {
    rows: rows as unknown as TriageCoverageRow[],
    activeProfile: active ? { id: active.id, version: Number(active.version) } : null,
    titlePolicy,
  };
}

export function formatTriageCoverageReport(report: TriageCoverageReport): string {
  const lines: string[] = [];
  const list = (counts: Record<string, number | undefined>) =>
    Object.entries(counts)
      .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
      .map(([key, value]) => `    ${key}: ${value}`);
  lines.push(`Opportunities: ${report.total} (Pre-Evaluation Review view, system states: ${report.preEvaluationReviewView})`);
  lines.push(`Active profile: ${report.activeProfile ? `version ${report.activeProfile.version}` : "none"}; target job titles: ${report.titlePolicy.toLowerCase()}`);
  lines.push("Triage state (each opportunity once; manual decisions take precedence):", ...list(report.triageStates));
  lines.push("  of which in the Pre-Evaluation Review view:", ...list(report.triageStatesInPreEvaluationReview));
  lines.push(`Manual triage decisions: ${report.manualDecisions}`);
  lines.push(`Assessed with a profile other than the active version: ${report.assessedWithOtherProfileVersion}`);
  lines.push("Evaluation state (each opportunity once):", ...list(report.evaluationStates));
  lines.push(`Opportunities with recorded AI usage (paid attempts): ${report.paidOpportunities}`);
  lines.push("Results-page capture hand-offs:");
  lines.push(...list(report.handoffs.failed), `    NOT_SENT:OUTSIDE_ROLE_FAMILIES: ${report.handoffs.outsideRoleFamilies}`, ...list(report.handoffs.other));
  lines.push(`    (no results-page capture: ${report.handoffs.none})`);
  lines.push("Why opportunities have no triage record:", ...list(report.missingAssessmentReasons));
  lines.push("Triage-only backfill classes:", ...list(report.backfill));
  lines.push(`Duplicates: MATCH ${report.duplicates.match}, PROBABLE_MATCH ${report.duplicates.probableMatch}`);
  lines.push("Triage state x evaluation state:");
  for (const [state, counts] of Object.entries(report.crossTab)) {
    lines.push(`    ${state}: ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(", ")}`);
  }
  return lines.join("\n");
}
