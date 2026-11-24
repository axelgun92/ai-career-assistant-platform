// The NEEDS_REVIEW diagnostic (November 24, 2026) on the isolated test
// database: effective NEEDS_REVIEW jobs only (a manual decision excludes
// one), each recorded reason classified from the stored evidence (B when the
// current normalization of the same stored text resolves it, A when the
// field is absent from enough text, C when a value is present but undecided,
// D when too little text is stored), probable duplicates read from their
// stored evidence, and nothing written. Reads are limited to this test's
// opportunities, so parallel test files are never touched. The command's
// guards are checked too.
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
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { analyzeNeedsReview, formatNeedsReviewReport, readNeedsReviewCases } from "../../apps/web/src/server/needs-review-diagnostic";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
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

const duties = [
  "Own onboarding, adoption and renewals for a portfolio of mid-market SaaS customers.",
  "Run quarterly business reviews, build success plans and partner with Sales and Support on expansion.",
  "Track health scores, lead escalations and turn customer feedback into product requests.",
  "You bring three or more years in customer success or account management at a B2B software company.",
  "You write clearly, run a calm meeting and enjoy teaching customers to get value from the product.",
  "This is a fully remote role. Applicants must reside in the United States.",
].join("\n");

async function opportunity(name: string, rawText: string, salary: string | null) {
  const detail = await manual.submit({
    title: "Customer Success Manager",
    company: `Diagnostic ${name} ${run}`,
    location: "Remote - United States",
    ...(salary ? { compensationText: salary } : {}),
    domain: "customer-success",
    rawText,
  });
  mine.add(detail.opportunity.id);
  cleanup.opportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

async function triage(id: string) {
  const assessed = await evaluation.assessTriage(id);
  if (assessed.status !== "ASSESSED") throw new Error(`not triaged: ${assessed.status}`);
  return assessed.triage;
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

async function tableCounts() {
  return {
    triage: await database.preEvaluatorTriage.count(),
    opportunities: await database.opportunity.count(),
    sourceRecords: await database.sourceRecord.count(),
    provenance: await database.fieldProvenance.count(),
    duplicates: await database.duplicateReference.count(),
    evaluations: await database.evaluation.count(),
    admissions: await database.evaluationAdmission.count(),
  };
}

describe("the NEEDS_REVIEW diagnostic", () => {
  it("classifies each recorded reason from the stored evidence, reads duplicates from their stored evidence, and writes nothing", async () => {
    const ids = {
      // The stored text states the salary; the stored facts lost it (as an
      // older normalization could have left them).
      historical: await opportunity("historical", `${duties}\nBase salary $72,000-$88,000 per year.`, "$72,000-$88,000"),
      absent: await opportunity("absent", duties, null),
      band: await opportunity("band", `${duties}\nBase salary $57,000-$59,000 per year.`, "$57,000-$59,000"),
      short: await opportunity("short", "Customer Success Manager. Remote.", null),
      decided: await opportunity("decided", duties, null),
    };
    await database.opportunity.update({ where: { id: ids.historical }, data: { salaryMin: null, salaryMax: null, currency: null, salaryText: null } });
    for (const id of Object.values(ids)) await triage(id);
    expect((await database.preEvaluatorTriage.findUniqueOrThrow({ where: { opportunityId: ids.historical } })).outcome).toBe("NEEDS_REVIEW");
    // A manual decision takes the job out of NEEDS_REVIEW.
    await database.preEvaluatorTriage.update({ where: { opportunityId: ids.decided }, data: { manualDecision: "REJECT", manuallyDecidedAt: new Date() } });
    // A probable duplicate whose related job states the salary this one lacks.
    await database.duplicateReference.create({
      data: {
        opportunityId: ids.absent, relatedOpportunityId: ids.band, decision: "PROBABLE_MATCH", confidence: 0.7,
        evidence: { engineVersion: "test", matchedOn: ["title", "company"], conflicts: [], sharedUrlKeys: [], sharedListingIds: [], sharedRequisitionIds: [], companyKey: null, similarity: { title: 1, location: 1, description: 0.8, salaryPenalty: 0 } },
      },
    });

    const before = await tableCounts();
    const { cases, context } = await readNeedsReviewCases(reader, { limitTo: mine });
    const findings = await analyzeNeedsReview(cases, context);
    expect(new Set(findings.map((finding) => finding.id))).toEqual(new Set([ids.historical, ids.absent, ids.band, ids.short]));
    const of = (id: string) => findings.find((finding) => finding.id === id)!;
    const salaryReason = (id: string) => of(id).reasons.find((reason) => reason.family === "salary")!;

    // B: the current normalization of the same stored text gives the salary,
    // and the job would be EVALUATE.
    expect(salaryReason(ids.historical)).toMatchObject({ code: "salary-unknown-salary", classification: "B_CURRENT_NORMALIZATION", storedValues: { salaryMin: null }, currentValues: { salaryMin: 72000, salaryMax: 88000, currency: "USD" } });
    expect(of(ids.historical)).toMatchObject({ storedReproduces: true, currentOutcome: "EVALUATE", signature: "OUTCOME_CHANGES_TO_EVALUATE" });
    // A: no salary anywhere in enough stored text.
    expect(salaryReason(ids.absent)).toMatchObject({ code: "salary-unknown-salary", classification: "A_ABSENT", evidence: null });
    expect(of(ids.absent).signature).toBe("A");
    // C: a salary in the U.S. review band.
    expect(salaryReason(ids.band)).toMatchObject({ code: "salary-us-review", classification: "C_AMBIGUOUS", storedValues: { salaryMin: 57000, salaryMax: 59000 } });
    expect(salaryReason(ids.band).evidence).toContain("$57,000-$59,000");
    // D: too little stored text to judge.
    expect(of(ids.short).reasons.every((reason) => reason.classification === "D_EVIDENCE_INCOMPLETE")).toBe(true);
    expect(of(ids.short).signature).toBe("D");
    // The duplicate link, from its stored evidence.
    expect(of(ids.absent).duplicates).toEqual([
      expect.objectContaining({ relatedId: ids.band, decision: "PROBABLE_MATCH", resolution: null, pairClass: "UNCERTAIN", relatedOutcome: "NEEDS_REVIEW", relatedHasMissingField: ["salary"], sameSource: true }),
    ]);

    const report = formatNeedsReviewReport({ database: "ai_career_assistant_test", context, findings, examples: 2 });
    expect(report).toContain("NEEDS_REVIEW opportunities (automatic NEEDS_REVIEW, no manual decision): 4");
    expect(report).toContain("    total: 4");
    expect(report).toContain("OUTCOME_CHANGES_TO_EVALUATE: 1");
    expect(report).toContain("salary-unknown-salary → B: 1");
    expect(report).toContain("Related record has a field this opportunity is missing: 1 links (salary 1)");
    // Nothing was written.
    expect(await tableCounts()).toEqual(before);
  });
});

describe("the triage:review-diagnostic command", () => {
  const execFileAsync = promisify(execFile);
  const cli = path.resolve("apps/web/src/server/needs-review-diagnostic-cli.ts");
  const tsx = path.resolve("node_modules/.bin/tsx");
  const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  const command = (args: string[]) =>
    execFileAsync(tsx, [cli, ...args], { env: { ...process.env }, timeout: 120_000 }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: "" }),
      (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
    );

  it("refuses another database, unknown options and a bad --examples, and runs read-only otherwise", async () => {
    const wrong = await command(["--database", "ai_career_assistant_acceptance"]);
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain(`DATABASE_URL points to database "${databaseName}", not "ai_career_assistant_acceptance". Nothing was read.`);
    expect((await command(["--database", databaseName, "--apply", "x"])).stderr).toContain("Unknown option --apply");
    expect((await command(["--database", databaseName, "--examples", "50"])).stderr).toContain("--examples takes a whole number from 0 to 10");
    const before = await tableCounts();
    const ran = await command(["--database", databaseName, "--examples", "0"]);
    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain("NEEDS_REVIEW diagnostic (read-only: nothing was written, fetched or sent to a provider)");
    expect(ran.stdout).not.toContain("postgresql://");
    expect(await tableCounts()).toEqual(before);
  }, 240_000);
});
