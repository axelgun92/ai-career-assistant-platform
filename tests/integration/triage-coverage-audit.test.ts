// The triage coverage audit (November 22, 2026) on the isolated test
// database: stored triage rows, hand-off outcomes and evaluations decide each
// opportunity's category (never its dashboard view), each opportunity is
// counted once per dimension, backfill candidates follow the target job
// titles, and the audit's session cannot write.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createManualOpportunityService } from "@ai-career/core";
import { createReadOnlyDatabaseClient, getDatabaseClient, PrismaManualOpportunityRepository, readOnlyTransaction } from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { buildTriageCoverageReport, readTriageCoverage } from "../../apps/web/src/server/triage-coverage-audit";

const database = getDatabaseClient();
const run = randomUUID().slice(0, 8);
const manual = createManualOpportunityService({ repository: new PrismaManualOpportunityRepository(), normalizer: createManualOpportunityNormalizer() });
const created: string[] = [];

async function opportunity(title: string) {
  const detail = await manual.submit({ rawText: `${title}\nAudit ${run}\nRemote in the United States.`, title, company: `Audit ${run}`, domain: "customer-success" });
  created.push(detail.opportunity.id);
  return detail.opportunity.id;
}

async function triage(opportunityId: string, outcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT", manualDecision: "EVALUATE" | "REJECT" | null = null) {
  await database.preEvaluatorTriage.create({
    data: { opportunityId, domain: "customer-success", outcome, reasons: [], inputFingerprint: "audit", assessedAt: new Date(), manualDecision, manuallyDecidedAt: manualDecision ? new Date() : null },
  });
}

afterEach(async () => {
  const ids = created.splice(0);
  await database.pageCaptureItem.deleteMany({ where: { opportunityId: { in: ids } } });
  await database.sourceRecord.deleteMany({ where: { opportunityId: { in: ids } } });
  const companies = await database.opportunity.findMany({ where: { id: { in: ids } }, select: { companyId: true } });
  await database.opportunity.deleteMany({ where: { id: { in: ids } } });
  await database.company.deleteMany({ where: { id: { in: companies.flatMap((row) => (row.companyId ? [row.companyId] : [])) } } });
});

afterAll(() => database.$disconnect());

describe("the triage coverage audit", () => {
  it("counts each opportunity once from its stored records and classifies backfill candidates by the target job titles", async () => {
    const evaluate = await opportunity("Customer Success Manager");
    await triage(evaluate, "EVALUATE");
    const review = await opportunity("Onboarding Specialist");
    await triage(review, "NEEDS_REVIEW");
    const decided = await opportunity("Customer Education Specialist");
    await triage(decided, "NEEDS_REVIEW", "EVALUATE");
    const rejected = await opportunity("Implementation Specialist");
    await triage(rejected, "REJECT");
    const candidate = await opportunity("Client Success Lead");
    const offTitle = await opportunity("Payroll Support Representative");
    const dismissed = await opportunity("Customer Success Associate");
    await database.opportunity.update({ where: { id: dismissed }, data: { status: "REJECTED_BY_USER" } });
    const evaluated = await opportunity("Customer Success Director");
    await database.evaluation.create({ data: { opportunityId: evaluated, domain: "customer-success", status: "COMPLETED", evaluationVersion: "a", domainVersion: "a", ruleVersion: "a" } });
    const handoff = await opportunity("Customer Onboarding Manager");
    const pairing = await database.extensionPairing.create({ data: { label: `Audit ${run}`, tokenHash: randomUUID(), tokenHint: "test" } });
    await database.pageCaptureItem.create({
      data: {
        site: "e2e-results", host: "jobs.e2e.invalid", externalId: `e2e-results:audit-${run}`, sourceUrl: `https://jobs.e2e.invalid/jobs/audit-${run}`,
        title: "Customer Onboarding Manager", resultsPageUrl: "https://jobs.e2e.invalid/search", firstSeenAt: new Date(), lastSeenAt: new Date(),
        lastBatchId: randomUUID(), pairingId: pairing.id, status: "INGESTED", opportunityId: handoff, handoffOutcome: "FAILED:USER_PROFILE_NOT_FOUND", handedOffAt: new Date(),
      },
    });

    const client = createReadOnlyDatabaseClient(process.env.DATABASE_URL!);
    try {
      const read = await readOnlyTransaction(client, (transaction) => readTriageCoverage(transaction));
      const mine = new Set(created);
      const report = buildTriageCoverageReport({ ...read, rows: read.rows.filter((row) => mine.has(row.id)) });
      expect(report.total).toBe(9);
      expect(report.triageStates).toEqual({ EVALUATE: 1, NEEDS_REVIEW: 1, MANUAL_EVALUATE: 1, REJECT: 1, NEVER_ASSESSED: 5 });
      expect(report.manualDecisions).toBe(1);
      expect(report.evaluationStates).toMatchObject({ COMPLETED: 1, NONE: 8 });
      expect(report.handoffs.failed).toEqual({ "FAILED:USER_PROFILE_NOT_FOUND": 1 });
      expect(report.missingAssessmentReasons).toMatchObject({
        "Results-page capture hand-off refused: USER_PROFILE_NOT_FOUND": 1,
        "Added manually: triage runs only when an evaluation is requested": 4,
      });
      expect(report.backfill).toEqual({ ALREADY_ASSESSED: 4, CANDIDATE: 2, OUTSIDE_TARGET_TITLES: 1, USER_ACTED: 1, ALREADY_EVALUATED: 1 });
      expect(new Set(report.backfillCandidateIds)).toEqual(new Set([candidate, handoff]));
      expect(report.backfillCandidateIds).not.toContain(offTitle);
      // The audit's session cannot write.
      await expect(
        readOnlyTransaction(client, (transaction) => transaction.$executeRaw`UPDATE "Opportunity" SET "title" = 'x' WHERE "id" = ${candidate}::uuid`),
      ).rejects.toThrow();
      expect((await database.opportunity.findUnique({ where: { id: candidate }, select: { title: true } }))!.title).toBe("Client Success Lead");
    } finally {
      await client.$disconnect();
      await database.pageCaptureItem.deleteMany({ where: { pairingId: pairing.id } });
      await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
    }
  });
});
