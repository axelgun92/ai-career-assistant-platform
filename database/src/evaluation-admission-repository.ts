import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

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
