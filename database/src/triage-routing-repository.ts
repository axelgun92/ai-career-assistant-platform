import { systemLifecycleStates } from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import { applyUserActionInTransaction, type AutomaticDismissalReason } from "./opportunity-lifecycle-repository";

// Triage-to-lifecycle routing (November 25, 2026): the one guarded writer
// that moves an opportunity to Dismissed by itself, for a triage REJECT or a
// title outside the target job titles. It is the existing DISMISS (status
// REJECTED_BY_USER, one OpportunityUserAction row marked with the reason),
// so Restore and Move to bring it back and nothing is deleted: triage,
// evaluations, sources and capture history stay as they are.
//
// It never moves an opportunity the user has decided anything about, or one
// with work in flight. Every check runs under the Opportunity row lock that
// application and lifecycle writes take.
export type AutomaticDismissalSkip =
  | "NOT_FOUND"
  | "ALREADY_DISMISSED"
  // Saved, Applied, Archived, Closed or not yet normalized.
  | "NOT_A_SYSTEM_STATE"
  | "APPLICATION_HISTORY"
  // Any earlier Save, Dismiss, Archive, Restore or Move by the user
  // (a restore of an automatic dismissal included).
  | "USER_LIFECYCLE_DECISION"
  | "MANUAL_TRIAGE_DECISION"
  | "EVALUATION_IN_PROGRESS"
  | "CONFLICT";

export type AutomaticDismissalResult =
  | { status: "DISMISSED"; reason: AutomaticDismissalReason; from: string }
  | { status: "SKIPPED"; skip: AutomaticDismissalSkip };

type Database = ReturnType<typeof getDatabaseClient>;
type Transaction = Parameters<Parameters<Database["$transaction"]>[0]>[0];

const routable = new Set<string>(systemLifecycleStates);

export interface AutomaticDismissalFacts {
  status: string;
  application: boolean;
  userAction: boolean;
  manualTriage: boolean;
  inFlight: boolean;
}

// The one rule, shared by the guarded writer and the read-only cleanup dry
// run, so both always agree.
export function automaticDismissalSkipFromFacts(facts: AutomaticDismissalFacts | null): AutomaticDismissalSkip | null {
  if (!facts) return "NOT_FOUND";
  if (facts.status === "REJECTED_BY_USER") return "ALREADY_DISMISSED";
  if (!routable.has(facts.status)) return "NOT_A_SYSTEM_STATE";
  if (facts.application) return "APPLICATION_HISTORY";
  if (facts.userAction) return "USER_LIFECYCLE_DECISION";
  if (facts.manualTriage) return "MANUAL_TRIAGE_DECISION";
  if (facts.inFlight) return "EVALUATION_IN_PROGRESS";
  return null;
}

// The facts for every opportunity (or one), in one read. Locks nothing.
export const automaticDismissalFactsSql = (opportunityId: string | null) => Prisma.sql`
  SELECT o."id"::text AS "id", o."title", o."status"::text AS "status",
    t."outcome"::text AS "triageOutcome", t."manualDecision"::text AS "manualDecision",
    EXISTS (SELECT 1 FROM "Application" a WHERE a."opportunityId" = o."id") AS "application",
    EXISTS (SELECT 1 FROM "OpportunityUserAction" u WHERE u."opportunityId" = o."id") AS "userAction",
    (t."manualDecision" IS NOT NULL) AS "manualTriage",
    (EXISTS (SELECT 1 FROM "Evaluation" e LEFT JOIN "EvaluationTask" k ON k."evaluationId" = e."id"
             WHERE e."opportunityId" = o."id" AND COALESCE(k."status", e."status") IN ('PENDING', 'RUNNING'))
     OR EXISTS (SELECT 1 FROM "EvaluationAdmission" m
                WHERE m."opportunityId" = o."id" AND m."evaluationId" IS NULL AND m."abandonedAt" IS NULL)
     OR EXISTS (SELECT 1 FROM "DeferredEvaluation" d WHERE d."opportunityId" = o."id" AND d."status" = 'DEFERRED')) AS "inFlight",
    (SELECT u."action"::text FROM "OpportunityUserAction" u WHERE u."opportunityId" = o."id"
       ORDER BY u."createdAt" DESC, u."id" DESC LIMIT 1) AS "lastAction",
    (SELECT u."automaticReason"::text FROM "OpportunityUserAction" u WHERE u."opportunityId" = o."id"
       ORDER BY u."createdAt" DESC, u."id" DESC LIMIT 1) AS "lastAutomaticReason"
  FROM "Opportunity" o
  LEFT JOIN "PreEvaluatorTriage" t ON t."opportunityId" = o."id"
  ${opportunityId ? Prisma.sql`WHERE o."id" = ${opportunityId}::uuid` : Prisma.empty}
  ORDER BY o."firstSeenAt" ASC, o."id" ASC
`;

export interface AutomaticDismissalRow extends AutomaticDismissalFacts {
  id: string;
  title: string | null;
  triageOutcome: string | null;
  manualDecision: string | null;
  lastAction: string | null;
  lastAutomaticReason: AutomaticDismissalReason | null;
}

export async function readAutomaticDismissalRows(client: { $queryRaw: Database["$queryRaw"] }, opportunityId: string | null = null) {
  return client.$queryRaw<AutomaticDismissalRow[]>(automaticDismissalFactsSql(opportunityId));
}

export async function automaticDismissalSkip(transaction: Transaction, opportunityId: string): Promise<AutomaticDismissalSkip | null> {
  // The row lock first, the facts after it.
  const locked = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id" FROM "Opportunity" WHERE "id" = ${opportunityId}::uuid FOR UPDATE`;
  if (!locked.length) return "NOT_FOUND";
  const [row] = await readAutomaticDismissalRows(transaction, opportunityId);
  return automaticDismissalSkipFromFacts(row ?? null);
}

export class PrismaTriageRoutingRepository {
  constructor(private readonly database: Database = getDatabaseClient()) {}

  async dismissAutomatically(input: { opportunityId: string; reason: AutomaticDismissalReason }): Promise<AutomaticDismissalResult> {
    return this.database.$transaction(async (transaction) => {
      const skip = await automaticDismissalSkip(transaction, input.opportunityId);
      if (skip) return { status: "SKIPPED" as const, skip };
      const applied = await applyUserActionInTransaction(transaction, {
        opportunityId: input.opportunityId,
        action: "DISMISS",
        automaticReason: input.reason,
      });
      if (applied.status !== "APPLIED") return { status: "SKIPPED" as const, skip: applied.status === "NOT_FOUND" ? "NOT_FOUND" as const : "CONFLICT" as const };
      return { status: "DISMISSED" as const, reason: input.reason, from: applied.from };
    });
  }

  // The latest lifecycle action, when the app took it itself.
  async automaticDismissal(opportunityId: string): Promise<{ reason: AutomaticDismissalReason; at: Date } | null> {
    const latest = await this.database.opportunityUserAction.findFirst({
      where: { opportunityId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { action: true, automaticReason: true, createdAt: true },
    });
    return latest?.action === "DISMISS" && latest.automaticReason ? { reason: latest.automaticReason, at: latest.createdAt } : null;
  }
}
