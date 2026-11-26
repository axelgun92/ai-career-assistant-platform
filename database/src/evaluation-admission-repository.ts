import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import { duplicateSpendLockKey } from "./duplicate-spend-lock";

// A live admission whose enqueue never happened (for example the process
// died) may be abandoned after this long. Age only permits abandonment;
// correctness comes from the conditional update, which can never abandon an
// admission that was already consumed by enqueueAdmitted().
export const admissionAbandonAfterMs = 10 * 60 * 1000;

export type AdmissionTransaction = Prisma.TransactionClient;

// One lock serializes every admit/resume decision: the read of active work
// and budget with the write of the admission, reservation, or deferral.
const admissionLockKey = Prisma.sql`hashtext('ai-career:evaluation-admission')`;

export class PrismaEvaluationAdmissionRepository {
  private readonly database = getDatabaseClient();

  async withAdmissionLock<T>(work: (transaction: AdmissionTransaction) => Promise<T>): Promise<T> {
    return this.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${admissionLockKey})::text`;
        return work(transaction);
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  }

  // Bulk admission (November 26, 2026): ONE transaction holding, in the
  // established order, the duplicate-spend lock and then the admission lock,
  // so the final duplicate and eligibility checks, the whole-batch capacity
  // check and every admission, reservation, evaluation and task commit
  // together (or roll back together). The duplicate-spend key is the one
  // the single path holds as a session lock; session and transaction
  // advisory locks on one key exclude each other, and both paths take the
  // duplicate lock before the admission lock, so they cannot deadlock.
  async withBatchAdmissionLocks<T>(work: (transaction: AdmissionTransaction) => Promise<T>): Promise<T> {
    return this.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${duplicateSpendLockKey.namespace}::int, ${duplicateSpendLockKey.key}::int)::text`;
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${admissionLockKey})::text`;
        return work(transaction);
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  }

  // Abandons live admissions older than the cutoff. A conditional update:
  // an admission consumed by enqueueAdmitted() is never matched.
  async abandonStale(input: { now: Date; opportunityId?: string; transaction?: AdmissionTransaction }) {
    const client = input.transaction ?? this.database;
    const result = await client.evaluationAdmission.updateMany({
      where: {
        evaluationId: null,
        abandonedAt: null,
        createdAt: { lt: new Date(input.now.getTime() - admissionAbandonAfterMs) },
        ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
      },
      data: { abandonedAt: input.now },
    });
    return result.count;
  }

  // Abandons one live admission (used when its enqueue failed). Returns
  // false when it was already consumed or abandoned.
  async abandon(admissionId: string, now: Date = new Date()): Promise<boolean> {
    const result = await this.database.evaluationAdmission.updateMany({
      where: { id: admissionId, evaluationId: null, abandonedAt: null },
      data: { abandonedAt: now },
    });
    return result.count === 1;
  }

  async findLiveForOpportunity(transaction: AdmissionTransaction, opportunityId: string) {
    return transaction.evaluationAdmission.findFirst({
      where: { opportunityId, evaluationId: null, abandonedAt: null },
      select: { id: true, createdAt: true },
    });
  }

  // Same rule as the pre-existing product guard: the opportunity's latest
  // evaluation is queued or running.
  async hasActiveEvaluation(transaction: AdmissionTransaction, opportunityId: string) {
    const latest = await transaction.evaluation.findFirst({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
      select: { status: true, task: { select: { status: true } } },
    });
    const status = latest?.task?.status ?? latest?.status;
    return status === "PENDING" || status === "RUNNING";
  }

  // The latest evaluation's status, read exactly as hasActiveEvaluation and
  // the single request path read it (newest by creation, the task's status
  // when it has one); null when the opportunity has none.
  async latestEvaluationStatus(transaction: AdmissionTransaction, opportunityId: string): Promise<string | null> {
    const latest = await transaction.evaluation.findFirst({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
      select: { status: true, task: { select: { status: true } } },
    });
    return latest ? (latest.task?.status ?? latest.status) : null;
  }

  async insert(
    transaction: AdmissionTransaction,
    input: {
      opportunityId: string;
      now: Date;
      reservation?: { amount: number; currency: string; enforced: boolean };
    },
  ) {
    return transaction.evaluationAdmission.create({
      data: {
        opportunityId: input.opportunityId,
        createdAt: input.now,
        ...(input.reservation
          ? {
              reservation: {
                create: {
                  amount: new Prisma.Decimal(input.reservation.amount.toFixed(12)),
                  currency: input.reservation.currency,
                  enforced: input.reservation.enforced,
                  createdAt: input.now,
                },
              },
            }
          : {}),
      },
      select: { id: true },
    });
  }
}
