import type { DeferredEvaluationRecord } from "@ai-career/database";
import type { BudgetSnapshotView, DeferralView } from "./types";

function asSnapshot(value: unknown): BudgetSnapshotView | null {
  if (value === null || typeof value !== "object") return null;
  const snapshot = value as Partial<BudgetSnapshotView>;
  return typeof snapshot.amount === "number" && typeof snapshot.currency === "string"
    ? (snapshot as BudgetSnapshotView)
    : null;
}

// Server-side mapping of a persisted deferral to a serializable view.
export function toDeferralView(record: DeferredEvaluationRecord): DeferralView {
  return {
    id: record.id,
    opportunityId: record.opportunityId,
    opportunityTitle: record.opportunityTitle,
    companyName: record.companyName,
    opportunityStatus: record.opportunityStatus,
    status: record.status,
    reasonCode: record.reasonCode,
    snapshot: asSnapshot(record.reasonSnapshot),
    userProfileId: record.userProfileId,
    userProfileVersion: record.userProfileVersion,
    createdAt: record.createdAt.toISOString(),
    lastCheckedAt: record.lastCheckedAt.toISOString(),
    resumedAt: record.resumedAt?.toISOString() ?? null,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
    resumedEvaluationId: record.resumedEvaluationId,
  };
}
