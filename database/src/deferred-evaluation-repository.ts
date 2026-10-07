import type { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import type { AdmissionTransaction } from "./evaluation-admission-repository";

export type DeferredEvaluationStatus = "DEFERRED" | "RESUMED" | "CANCELLED";

export interface DeferredEvaluationRecord {
  id: string;
  opportunityId: string;
  opportunityTitle: string | null;
  companyName: string | null;
  opportunityStatus: string;
  domain: string;
  userProfileId: string | null;
  userProfileVersion: number | null;
  status: DeferredEvaluationStatus;
  reasonCode: string;
  reasonSnapshot: unknown;
  lastCheckedAt: Date;
  resumedEvaluationId: string | null;
  resumedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

const recordSelect = {
  id: true,
  opportunityId: true,
  domain: true,
  userProfileId: true,
  userProfileVersion: true,
  status: true,
  reasonCode: true,
  reasonSnapshot: true,
  lastCheckedAt: true,
  resumedAt: true,
  resumedAdmission: { select: { evaluationId: true } },
  cancelledAt: true,
  createdAt: true,
  opportunity: { select: { title: true, status: true, company: { select: { name: true } } } },
} as const;

type Row = Prisma.DeferredEvaluationGetPayload<{ select: typeof recordSelect }>;

function toRecord(row: Row): DeferredEvaluationRecord {
  const { opportunity, resumedAdmission, ...rest } = row;
  return {
    ...rest,
    resumedEvaluationId: resumedAdmission?.evaluationId ?? null,
    opportunityTitle: opportunity.title,
    companyName: opportunity.company?.name ?? null,
    opportunityStatus: opportunity.status,
  };
}

// The persistent backlog of evaluation requests that were deferred because
// budget was unavailable. Rows are kept as history after resume or cancel.
export class PrismaDeferredEvaluationRepository {
  private readonly database = getDatabaseClient();

  async create(
    transaction: AdmissionTransaction,
    input: {
      opportunityId: string;
      domain: string;
      userProfileId: string;
      userProfileVersion: number;
      reasonCode: string;
      reasonSnapshot: object;
      now: Date;
    },
  ): Promise<DeferredEvaluationRecord> {
    const row = await transaction.deferredEvaluation.create({
      data: {
        opportunityId: input.opportunityId,
        domain: input.domain,
        userProfileId: input.userProfileId,
        userProfileVersion: input.userProfileVersion,
        reasonCode: input.reasonCode,
        reasonSnapshot: input.reasonSnapshot as Prisma.InputJsonValue,
        lastCheckedAt: input.now,
        createdAt: input.now,
      },
      select: recordSelect,
    });
    return toRecord(row);
  }

  async findById(id: string, transaction?: AdmissionTransaction) {
    const row = await (transaction ?? this.database).deferredEvaluation.findUnique({
      where: { id },
      select: recordSelect,
    });
    return row ? toRecord(row) : null;
  }

  async findOpenForOpportunity(opportunityId: string, transaction?: AdmissionTransaction) {
    const row = await (transaction ?? this.database).deferredEvaluation.findFirst({
      where: { opportunityId, status: "DEFERRED" },
      orderBy: { createdAt: "asc" },
      select: recordSelect,
    });
    return row ? toRecord(row) : null;
  }

  async list(input: { status?: DeferredEvaluationStatus; limit?: number } = {}) {
    const rows = await this.database.deferredEvaluation.findMany({
      where: input.status ? { status: input.status } : {},
      orderBy: { createdAt: "asc" },
      take: input.limit ?? 200,
      select: recordSelect,
    });
    return rows.map(toRecord);
  }

  async countOpen(): Promise<number> {
    return this.database.deferredEvaluation.count({ where: { status: "DEFERRED" } });
  }

  // State changes are conditional on the row's current state, so a resume
  // and a cancel can never both apply.
  //
  // Resume is recorded under the admission lock together with the admission
  // that will run it. The evaluation is then derived through that admission,
  // which enqueueAdmitted() consumes atomically, so a crash after enqueue
  // never loses the link and never lets the request run twice.
  async markResuming(
    transaction: AdmissionTransaction,
    input: { id: string; admissionId: string; now: Date },
  ): Promise<boolean> {
    const result = await transaction.deferredEvaluation.updateMany({
      where: { id: input.id, status: "DEFERRED" },
      data: { status: "RESUMED", resumedAdmissionId: input.admissionId, resumedAt: input.now, lastCheckedAt: input.now },
    });
    return result.count === 1;
  }

  // The resume's enqueue failed: the request goes back to the backlog.
  async revertResume(admissionId: string): Promise<void> {
    await this.database.deferredEvaluation.updateMany({
      where: { resumedAdmissionId: admissionId, status: "RESUMED" },
      data: { status: "DEFERRED", resumedAdmissionId: null, resumedAt: null },
    });
  }

  // Resumes whose admission was abandoned (its enqueue never happened)
  // return to the backlog, so a deferred request is never lost.
  async reopenAbandonedResumes(transaction?: AdmissionTransaction): Promise<number> {
    const result = await (transaction ?? this.database).deferredEvaluation.updateMany({
      where: { status: "RESUMED", resumedAdmission: { abandonedAt: { not: null } } },
      data: { status: "DEFERRED", resumedAdmissionId: null, resumedAt: null },
    });
    return result.count;
  }

  async touchChecked(
    transaction: AdmissionTransaction,
    input: { id: string; reasonSnapshot: object; now: Date },
  ) {
    await transaction.deferredEvaluation.updateMany({
      where: { id: input.id, status: "DEFERRED" },
      data: { lastCheckedAt: input.now, reasonSnapshot: input.reasonSnapshot as Prisma.InputJsonValue },
    });
  }

  async cancel(id: string, now: Date = new Date()): Promise<boolean> {
    const result = await this.database.deferredEvaluation.updateMany({
      where: { id, status: "DEFERRED" },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    return result.count === 1;
  }
}
