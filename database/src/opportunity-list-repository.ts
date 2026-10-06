import type { OpportunityLifecycleState } from "@ai-career/core";
import { getDatabaseClient } from "./client";

export const opportunityListDefaultLimit = 100;
export const opportunityListMaximumLimit = 200;

export interface OpportunityListItem {
  id: string;
  domain: string | null;
  status: string;
  title: string | null;
  companyName: string | null;
  location: string | null;
  salaryText: string | null;
  postingDate: Date | null;
  createdAt: Date;
  latestEvaluation: {
    id: string;
    status: string;
    decision: string | null;
    createdAt: Date;
    completedAt: Date | null;
  } | null;
}

export class PrismaOpportunityListRepository {
  private readonly database = getDatabaseClient();

  async listOpportunities(
    input: { limit?: number; statuses?: readonly OpportunityLifecycleState[] } = {},
  ): Promise<OpportunityListItem[]> {
    const limit = Math.min(
      Math.max(input.limit ?? opportunityListDefaultLimit, 1),
      opportunityListMaximumLimit,
    );
    const records = await this.database.opportunity.findMany({
      where: input.statuses ? { status: { in: [...input.statuses] } } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        domain: true,
        status: true,
        title: true,
        location: true,
        salaryText: true,
        postingDate: true,
        createdAt: true,
        company: { select: { name: true } },
        evaluations: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            status: true,
            createdAt: true,
            completedAt: true,
            task: { select: { status: true } },
            recommendation: { select: { decision: true } },
          },
        },
      },
    });

    return records.map((record) => {
      const evaluation = record.evaluations[0];
      return {
        id: record.id,
        domain: record.domain,
        status: record.status,
        title: record.title,
        companyName: record.company?.name ?? null,
        location: record.location,
        salaryText: record.salaryText,
        postingDate: record.postingDate,
        createdAt: record.createdAt,
        latestEvaluation: evaluation
          ? {
              id: evaluation.id,
              // Match the evaluation API: queue/task state is the user-visible status.
              status: evaluation.task?.status ?? evaluation.status,
              decision: evaluation.recommendation?.decision ?? null,
              createdAt: evaluation.createdAt,
              completedAt: evaluation.completedAt,
            }
          : null,
      };
    });
  }
}
