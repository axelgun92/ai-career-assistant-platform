import {
  resolveUserAction,
  systemLifecycleState,
  systemLifecycleStates,
  type OpportunityLifecycleState,
  type OpportunityUserAction,
  type SystemLifecycleState,
  type UserActionHistoryEntry,
} from "@ai-career/core";
import { getDatabaseClient } from "./client";

type Database = ReturnType<typeof getDatabaseClient>;
type Transaction = Parameters<Parameters<Database["$transaction"]>[0]>[0];
type Client = Database | Transaction;

export type UserActionResult =
  | { status: "APPLIED"; from: OpportunityLifecycleState; to: OpportunityLifecycleState }
  | { status: "NOT_FOUND" }
  | { status: "NOT_ALLOWED"; reason: string }
  | { status: "CONFLICT" };

export interface OpportunityLifecycleView {
  status: OpportunityLifecycleState;
  systemState: SystemLifecycleState;
  history: Array<UserActionHistoryEntry & { createdAt: Date }>;
}

const systemRank: Record<SystemLifecycleState, number> = {
  NORMALIZED: 0,
  EVALUATED: 1,
  RECOMMENDED: 2,
};

async function deriveSystemState(client: Client, opportunityId: string) {
  const [completed, recommended] = await Promise.all([
    client.evaluation.count({ where: { opportunityId, status: "COMPLETED" } }),
    client.recommendation.count({
      where: { opportunityId, evaluation: { status: "COMPLETED" } },
    }),
  ]);
  return systemLifecycleState({
    hasCompletedEvaluation: completed > 0,
    hasRecommendation: recommended > 0,
  });
}

async function loadHistory(client: Client, opportunityId: string) {
  return client.opportunityUserAction.findMany({
    where: { opportunityId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { action: true, fromStatus: true, toStatus: true, createdAt: true },
  });
}

// Product-owned lifecycle persistence. Core evaluation code never calls this;
// evaluations and automatic sync never write OpportunityUserAction rows.
export class PrismaOpportunityLifecycleRepository {
  private readonly database = getDatabaseClient();

  // Moves a system-state Opportunity forward to the state its persisted
  // evaluations support. Never touches user states and never downgrades.
  async syncSystemLifecycle(opportunityId: string): Promise<OpportunityLifecycleState | null> {
    const target = await deriveSystemState(this.database, opportunityId);
    const lower = systemLifecycleStates.filter(
      (state) => systemRank[state] < systemRank[target],
    );
    if (lower.length === 0) return null;
    const result = await this.database.opportunity.updateMany({
      where: { id: opportunityId, status: { in: lower } },
      data: { status: target },
    });
    return result.count === 1 ? target : null;
  }

  async syncSystemLifecycleForEvaluation(evaluationId: string) {
    const evaluation = await this.database.evaluation.findUnique({
      where: { id: evaluationId },
      select: { opportunityId: true },
    });
    return evaluation ? this.syncSystemLifecycle(evaluation.opportunityId) : null;
  }

  // Repairs Opportunities whose evaluation completed but whose sync did not
  // run (for example, a worker crash between completion and sync).
  async sweepSystemLifecycle(): Promise<number> {
    const recommended = await this.database.opportunity.updateMany({
      where: {
        status: { in: ["NORMALIZED", "EVALUATED"] },
        recommendations: { some: { evaluation: { status: "COMPLETED" } } },
      },
      data: { status: "RECOMMENDED" },
    });
    const evaluated = await this.database.opportunity.updateMany({
      where: {
        status: "NORMALIZED",
        evaluations: { some: { status: "COMPLETED" } },
      },
      data: { status: "EVALUATED" },
    });
    return recommended.count + evaluated.count;
  }

  async getLifecycleView(opportunityId: string): Promise<OpportunityLifecycleView | null> {
    const opportunity = await this.database.opportunity.findUnique({
      where: { id: opportunityId },
      select: { status: true },
    });
    if (!opportunity) return null;
    const [systemState, history] = await Promise.all([
      deriveSystemState(this.database, opportunityId),
      loadHistory(this.database, opportunityId),
    ]);
    return { status: opportunity.status, systemState, history };
  }

  // Resolves and applies one explicit user action: compare-and-set on the
  // current status plus its history row, in one transaction.
  async applyUserAction(input: {
    opportunityId: string;
    action: OpportunityUserAction;
  }): Promise<UserActionResult> {
    return this.database.$transaction(async (transaction) => {
      const opportunity = await transaction.opportunity.findUnique({
        where: { id: input.opportunityId },
        select: { status: true },
      });
      if (!opportunity) return { status: "NOT_FOUND" as const };
      const [history, currentSystemState] = await Promise.all([
        loadHistory(transaction, input.opportunityId),
        deriveSystemState(transaction, input.opportunityId),
      ]);
      const resolution = resolveUserAction({
        action: input.action,
        currentStatus: opportunity.status,
        history,
        currentSystemState,
      });
      if (!resolution.allowed) {
        return { status: "NOT_ALLOWED" as const, reason: resolution.reason };
      }
      const updated = await transaction.opportunity.updateMany({
        where: { id: input.opportunityId, status: opportunity.status },
        data: { status: resolution.to },
      });
      if (updated.count !== 1) return { status: "CONFLICT" as const };
      // Keep replay order strictly increasing even within one millisecond.
      const last = history.at(-1)?.createdAt.getTime() ?? 0;
      await transaction.opportunityUserAction.create({
        data: {
          opportunityId: input.opportunityId,
          action: input.action,
          fromStatus: opportunity.status,
          toStatus: resolution.to,
          createdAt: new Date(Math.max(Date.now(), last + 1)),
        },
      });
      return { status: "APPLIED" as const, from: opportunity.status, to: resolution.to };
    });
  }
}
