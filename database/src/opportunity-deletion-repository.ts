import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import { PrismaOpportunityTombstoneRepository, type ListingIdentity } from "./opportunity-tombstone-repository";

// Permanent deletion from Dismissed (November 22, 2026). Only an opportunity
// the user dismissed can be deleted, one at a time in its own transaction
// under the opportunity's row lock. It is refused (and nothing changes) for
// one with application history or with evaluation work still open.
//
// Before the opportunity is deleted:
// - its AI usage accounting (each semantic-operation attempt's tokens and
//   cost, and its evaluation admissions) is copied to the retained ledger,
//   with no job content, so budget, spend and usage totals stay the same;
// - fingerprints of its listing identities are recorded as a tombstone, so
//   automatic acquisition never captures it again;
// - its source records' content is cleared (the rows stay, unlinked, because
//   later observations reference earlier ones), its results-page capture
//   items are removed, and its posting-history ledger rows drop their title.
// Deleting it then removes, through the existing cascades, its evaluations,
// provenance, duplicate references on both sides, triage and lifecycle
// history. Analytics no longer count it.

export type OpportunityDeletionOutcome =
  | "DELETED"
  | "NOT_FOUND"
  | "NOT_DISMISSED"
  | "HAS_APPLICATION"
  | "EVALUATION_IN_PROGRESS";

export interface OpportunityDeletionResult {
  opportunityId: string;
  outcome: OpportunityDeletionOutcome;
}

type Transaction = Prisma.TransactionClient;

export class PrismaOpportunityDeletionRepository {
  private readonly database = getDatabaseClient();

  async dismissedCount(): Promise<number> {
    return this.database.opportunity.count({ where: { status: "REJECTED_BY_USER" } });
  }

  async dismissedIds(): Promise<string[]> {
    const rows = await this.database.opportunity.findMany({
      where: { status: "REJECTED_BY_USER" },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async deleteDismissed(opportunityId: string, at = new Date()): Promise<OpportunityDeletionResult> {
    return this.database.$transaction(
      async (transaction) => ({ opportunityId, outcome: await this.deleteInTransaction(transaction, opportunityId, at) }),
      { timeout: 30_000 },
    );
  }

  private async deleteInTransaction(transaction: Transaction, opportunityId: string, at: Date): Promise<OpportunityDeletionOutcome> {
    const rows = await transaction.$queryRaw<Array<{ status: string; canonicalUrl: string | null }>>`
      SELECT "status"::text AS "status", "canonicalUrl" FROM "Opportunity" WHERE "id" = ${opportunityId}::uuid FOR UPDATE`;
    const opportunity = rows[0];
    if (!opportunity) return "NOT_FOUND";
    if (opportunity.status !== "REJECTED_BY_USER") return "NOT_DISMISSED";
    if (await transaction.application.findUnique({ where: { opportunityId }, select: { id: true } })) return "HAS_APPLICATION";
    if (await this.hasOpenEvaluationWork(transaction, opportunityId)) return "EVALUATION_IN_PROGRESS";

    await this.retainUsage(transaction, opportunityId);

    const [sourceRecords, captureItems] = await Promise.all([
      transaction.sourceRecord.findMany({ where: { opportunityId }, select: { id: true, source: true, externalId: true, sourceUrl: true } }),
      transaction.pageCaptureItem.findMany({ where: { opportunityId }, select: { id: true, externalId: true, sourceUrl: true } }),
    ]);
    const identities: ListingIdentity[] = [
      ...sourceRecords.map((record) => ({ source: record.source, externalId: record.externalId, sourceUrl: record.sourceUrl })),
      ...captureItems.map((item) => ({ sourceUrl: item.sourceUrl, pageCaptureExternalId: item.externalId })),
      { sourceUrl: opportunity.canonicalUrl },
    ];
    await new PrismaOpportunityTombstoneRepository(transaction).record(identities, at);

    if (sourceRecords.length) {
      await transaction.sourceRecord.updateMany({
        where: { opportunityId },
        data: {
          sourceUrl: null,
          applicationUrl: null,
          requisitionId: null,
          rawTitle: null,
          rawCompany: null,
          rawLocation: null,
          rawDescription: null,
          rawSalaryText: null,
          rawEmploymentType: null,
          rawPostingDate: null,
          sourceMetadata: Prisma.DbNull,
          rawPayload: Prisma.DbNull,
          duplicateEvidence: Prisma.DbNull,
        },
      });
    }
    if (captureItems.length) await transaction.pageCaptureItem.deleteMany({ where: { opportunityId } });
    await transaction.retrievedListing.updateMany({ where: { opportunityId }, data: { title: null } });
    await transaction.opportunity.delete({ where: { id: opportunityId } });
    return "DELETED";
  }

  // An evaluation queued or running, an admission not yet consumed or
  // abandoned (its budget reservation may still hold), or a deferral that
  // would resume: deleting now would pull records from under the evaluation
  // worker or the budget, so it waits.
  private async hasOpenEvaluationWork(transaction: Transaction, opportunityId: string): Promise<boolean> {
    const [row] = await transaction.$queryRaw<Array<{ open: boolean }>>`
      SELECT (
        EXISTS (
          SELECT 1 FROM "Evaluation" e JOIN "EvaluationTask" t ON t."evaluationId" = e."id"
          WHERE e."opportunityId" = ${opportunityId}::uuid AND t."status" IN ('PENDING', 'RUNNING')
        )
        OR EXISTS (
          SELECT 1 FROM "EvaluationAdmission" a
          WHERE a."opportunityId" = ${opportunityId}::uuid AND a."abandonedAt" IS NULL AND a."evaluationId" IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM "DeferredEvaluation" d
          WHERE d."opportunityId" = ${opportunityId}::uuid AND d."status" = 'DEFERRED'
        )
      ) AS "open"`;
    return row?.open === true;
  }

  // The accounting fields only: no prompt, response, error text or job
  // content, and no link to the deleted opportunity.
  private async retainUsage(transaction: Transaction, opportunityId: string) {
    await transaction.$executeRaw`
      INSERT INTO "RetainedEvaluationUsage" (
        "id", "evaluationId", "domain", "jobSource", "sourceType", "source", "operationId", "provider", "model",
        "inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens", "totalTokens", "estimatedCost",
        "pricingConfigurationId", "createdAt"
      )
      SELECT a."id", a."evaluationId", a."domain", a."jobSource", o."sourceType"::text, o."source", a."operationId", a."provider", a."model",
        a."inputTokens", a."outputTokens", a."cachedInputTokens", a."reasoningTokens", a."totalTokens", a."estimatedCost",
        a."pricingConfigurationId", a."createdAt"
      FROM "SemanticOperationAttempt" a
      JOIN "Opportunity" o ON o."id" = a."opportunityId"
      WHERE a."opportunityId" = ${opportunityId}::uuid
      ON CONFLICT ("id") DO NOTHING`;
    await transaction.$executeRaw`
      INSERT INTO "RetainedEvaluationAdmission" ("id", "createdAt")
      SELECT ad."id", ad."createdAt" FROM "EvaluationAdmission" ad
      WHERE ad."opportunityId" = ${opportunityId}::uuid AND ad."abandonedAt" IS NULL
      ON CONFLICT ("id") DO NOTHING`;
  }
}
