// The one-time triage-only backfill (November 24, 2026) on the isolated test
// database: the audit's candidates only, the dry run writes nothing, apply
// needs the reviewed candidate count, each job is rechecked just before it is
// processed, the real assessTriage records EVALUATE / NEEDS_REVIEW / REJECT,
// and nothing else changes (no evaluation request, admission, deferral, task
// or AI attempt; lifecycle states, applications, duplicate relationships and
// existing or manual triage records kept). The backfill's reads are limited
// to this test's opportunities, so parallel test files are never touched. The
// command itself is run for its guards and a read-only dry run.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  createReadOnlyDatabaseClient,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaPreEvaluatorTriageRepository,
  readOnlyTransaction,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { runTriageBackfill, type TriageBackfillDependencies } from "../../apps/web/src/server/triage-backfill";
import { readTriageCoverage } from "../../apps/web/src/server/triage-coverage-audit";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";

const clock = { now: new Date("2026-11-24T09:00:00.000Z") };
const cleanup = createCleanup();
const run = randomUUID().slice(0, 8);
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] }).gate,
  triageGate: createPreEvaluatorTriageService({ repository: new PrismaPreEvaluatorTriageRepository(), now: () => clock.now }).gate,
});
const manual = createManualOpportunityService({ repository: new PrismaManualOpportunityRepository(), normalizer: createManualOpportunityNormalizer() });
const reader = createReadOnlyDatabaseClient(process.env.DATABASE_URL!);
const mine = new Set<string>();
let activeBefore: { userProfileId: string } | null = null;

async function opportunity(name: string, title: string, salary: string | null) {
  const detail = await manual.submit({
    title,
    company: `Backfill ${name} ${run}`,
    location: "Remote - United States",
    ...(salary ? { compensationText: salary } : {}),
    domain: "customer-success",
    rawText: [`${title} at a SaaS workflow platform.`, "Remote. Applicants must reside in the United States.", salary ? `Base salary ${salary}.` : "", "Own onboarding, adoption and renewals."].join("\n"),
  });
  mine.add(detail.opportunity.id);
  cleanup.opportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

// The real dependencies, with reads limited to this test's opportunities;
// `beforeRecheck` lets a test change a job between the start and its turn.
function dependencies(beforeRecheck?: (opportunityId: string) => Promise<void>): TriageBackfillDependencies {
  return {
    async read(opportunityId) {
      if (opportunityId) await beforeRecheck?.(opportunityId);
      const snapshot = await readOnlyTransaction(reader, (transaction) => readTriageCoverage(transaction, { opportunityId }));
      return { ...snapshot, rows: snapshot.rows.filter((row) => mine.has(row.id)) };
    },
    assess: (opportunityId) => evaluation.assessTriage(opportunityId),
    existing: (opportunityId) => evaluation.getTriage(opportunityId),
  };
}

async function snapshotOf(ids: string[]) {
  const where = { opportunityId: { in: ids } };
  return {
    opportunities: await database.opportunity.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }),
    applications: await database.application.findMany({ where, orderBy: { id: "asc" } }),
    duplicates: await database.duplicateReference.findMany({ where: { OR: [where, { relatedOpportunityId: { in: ids } }] }, orderBy: { id: "asc" } }),
    actions: await database.opportunityUserAction.count({ where }),
    evaluations: await database.evaluation.count({ where }),
    admissions: await database.evaluationAdmission.count({ where }),
    deferrals: await database.deferredEvaluation.count({ where }),
    tasks: await database.evaluationTask.count({ where: { evaluation: where } }),
    attempts: await database.semanticOperationAttempt.count({ where }),
  };
}

beforeEach(async () => {
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup);
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: profile.id }, update: { userProfileId: profile.id } });
});

afterEach(async () => {
  mine.clear();
  if (activeBefore) {
    await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: activeBefore.userProfileId }, update: { userProfileId: activeBefore.userProfileId } });
  }
  await cleanup.after();
  if (!activeBefore) await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
});

afterAll(async () => {
  await reader.$disconnect();
  await database.$disconnect();
});

describe("the triage-only backfill", () => {
  it("dry-runs by default, then triages only rechecked candidates with assessTriage and changes nothing else", async () => {
    const ids = {
      evaluate: await opportunity("evaluate", "Customer Success Manager", "$72,000-$88,000"),
      review: await opportunity("review", "Onboarding Specialist", null),
      reject: await opportunity("reject", "Customer Education Specialist", "$45,000-$50,000"),
      saved: await opportunity("saved", "Client Success Lead", "$72,000-$88,000"),
      late: await opportunity("late", "Customer Success Associate", null),
      assessed: await opportunity("assessed", "Customer Success Director", null),
      offTitle: await opportunity("off", "Payroll Support Representative", "$72,000-$88,000"),
      dismissed: await opportunity("dismissed", "Customer Success Specialist", null),
      evaluated: await opportunity("evaluated", "Customer Onboarding Manager", null),
    };
    // A saved job with a planned application, and a possible duplicate pair.
    await database.opportunity.update({ where: { id: ids.saved }, data: { status: "SAVED" } });
    await database.application.create({ data: { opportunityId: ids.saved, stage: "PLANNED" } });
    await database.duplicateReference.create({ data: { opportunityId: ids.evaluate, relatedOpportunityId: ids.saved, decision: "PROBABLE_MATCH", confidence: 0.8 } });
    // Not candidates: assessed with a manual decision, dismissed, evaluated.
    await database.preEvaluatorTriage.create({
      data: { opportunityId: ids.assessed, domain: "customer-success", outcome: "NEEDS_REVIEW", reasons: [], inputFingerprint: "earlier", assessedAt: new Date("2026-11-01T00:00:00Z"), manualDecision: "REJECT", manuallyDecidedAt: new Date("2026-11-02T00:00:00Z") },
    });
    await database.opportunity.update({ where: { id: ids.dismissed }, data: { status: "REJECTED_BY_USER" } });
    await database.evaluation.create({ data: { opportunityId: ids.evaluated, domain: "customer-success", status: "COMPLETED", evaluationVersion: "a", domainVersion: "a", ruleVersion: "a" } });
    const all = Object.values(ids);
    const assessedBefore = await database.preEvaluatorTriage.findUniqueOrThrow({ where: { opportunityId: ids.assessed } });

    // Dry run: the candidates are listed and nothing is written.
    const before = await snapshotOf(all);
    const dry = await runTriageBackfill(dependencies(), { apply: false });
    expect(dry).toMatchObject({ mode: "DRY_RUN", refused: null, total: 9, results: [] });
    expect(dry.classes).toEqual({ CANDIDATE: 5, ALREADY_ASSESSED: 1, OUTSIDE_TARGET_TITLES: 1, USER_ACTED: 1, ALREADY_EVALUATED: 1 });
    expect(new Set(dry.candidates.map((candidate) => candidate.id))).toEqual(new Set([ids.evaluate, ids.review, ids.reject, ids.saved, ids.late]));
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: { in: all } } })).toBe(1);
    expect(await snapshotOf(all)).toEqual(before);

    // Apply needs the reviewed count: anything else writes nothing.
    for (const expectedCandidates of [undefined, 4, 6]) {
      const refused = await runTriageBackfill(dependencies(), { apply: true, ...(expectedCandidates === undefined ? {} : { expectedCandidates }) });
      expect(refused).toMatchObject({ mode: "APPLY", refused: "CANDIDATE_COUNT_CHANGED", results: [] });
    }
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: { in: all } } })).toBe(1);

    // Apply: the user dismisses one job while the run is under way; its
    // recheck skips it.
    const applied = await runTriageBackfill(
      dependencies(async (opportunityId) => {
        if (opportunityId === ids.late) await database.opportunity.update({ where: { id: ids.late }, data: { status: "REJECTED_BY_USER" } });
      }),
      { apply: true, expectedCandidates: 5 },
    );
    expect(applied.refused).toBeNull();
    expect(Object.fromEntries(applied.results.map((entry) => [entry.id, entry.result]))).toEqual({
      [ids.evaluate]: "EVALUATE",
      [ids.saved]: "EVALUATE",
      [ids.review]: "NEEDS_REVIEW",
      [ids.reject]: "REJECT",
      [ids.late]: "SKIPPED:USER_ACTED",
    });
    expect(applied.outcomes).toEqual({ EVALUATE: 2, NEEDS_REVIEW: 1, REJECT: 1, "SKIPPED:USER_ACTED": 1 });

    // One triage record per processed job, with the active profile.
    const triage = await database.preEvaluatorTriage.findMany({ where: { opportunityId: { in: all } } });
    expect(Object.fromEntries(triage.map((row) => [row.opportunityId, row.outcome]))).toEqual({
      [ids.evaluate]: "EVALUATE", [ids.saved]: "EVALUATE", [ids.review]: "NEEDS_REVIEW", [ids.reject]: "REJECT", [ids.assessed]: "NEEDS_REVIEW",
    });
    const active = await database.activeUserProfile.findUniqueOrThrow({ where: { domain: "customer-success" } });
    for (const row of triage.filter((entry) => entry.opportunityId !== ids.assessed)) {
      expect(row).toMatchObject({ userProfileId: active.userProfileId, userProfileVersion: 1, manualDecision: null });
    }
    // The existing assessment and its manual decision are untouched.
    expect(await database.preEvaluatorTriage.findUniqueOrThrow({ where: { opportunityId: ids.assessed } })).toEqual(assessedBefore);

    // Nothing else changed: no evaluation request, admission, deferral, task
    // or AI attempt; lifecycle states (but the user's own dismissal),
    // applications, duplicate relationships and lifecycle history kept.
    const after = await snapshotOf(all);
    expect({ ...after, opportunities: after.opportunities.filter((row) => row.id !== ids.late) })
      .toEqual({ ...before, opportunities: before.opportunities.filter((row) => row.id !== ids.late) });

    // Run again: nothing is left to do.
    const again = await runTriageBackfill(dependencies(), { apply: false });
    expect(again.candidates).toEqual([]);
    expect(again.classes).toMatchObject({ ALREADY_ASSESSED: 5, USER_ACTED: 2 });
  });

  it("refuses without an active profile and writes nothing", async () => {
    const id = await opportunity("noprofile", "Customer Success Manager", "$72,000-$88,000");
    await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
    const report = await runTriageBackfill(dependencies(), { apply: true, expectedCandidates: 1 });
    expect(report).toMatchObject({ refused: "NO_ACTIVE_PROFILE", results: [], candidates: [{ id }] });
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: id } })).toBe(0);
  });
});

describe("the triage:backfill command", () => {
  const execFileAsync = promisify(execFile);
  const cli = path.resolve("apps/web/src/server/triage-backfill-cli.ts");
  const tsx = path.resolve("node_modules/.bin/tsx");
  const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  const command = (args: string[]) =>
    execFileAsync(tsx, [cli, ...args], { env: { ...process.env }, timeout: 120_000 }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: "" }),
      (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
    );

  it("refuses a --database that is not the one DATABASE_URL names, and options it does not know", async () => {
    const wrong = await command(["--database", "ai_career_assistant_acceptance"]);
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain(`does not match the database DATABASE_URL points to (${databaseName})`);
    const unknown = await command(["--database", databaseName, "--yes"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Unknown option --yes");
    const stray = await command(["--database", databaseName, "--expect", "3"]);
    expect(stray.code).toBe(1);
    expect(stray.stderr).toContain("--expect takes a whole number and goes with --apply");
  }, 180_000);

  it("dry-runs by default (read-only), and --apply without --expect writes nothing", async () => {
    const id = await opportunity("cli", "Customer Success Manager", "$72,000-$88,000");
    const dry = await command(["--database", databaseName]);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain("Mode: DRY RUN (nothing written)");
    expect(dry.stdout).toContain(id);
    expect(dry.stdout).toMatch(/To apply: add --apply --expect \d+/);
    const refused = await command(["--database", databaseName, "--apply"]);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toMatch(/Refused: --apply needs --expect \d+/);
    expect(await database.preEvaluatorTriage.count({ where: { opportunityId: id } })).toBe(0);
  }, 180_000);
});
