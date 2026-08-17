import { getDatabaseClient } from "./client";

export class PrismaEvaluationQueryRepository {
  private readonly database = getDatabaseClient();

  async findOpportunityForEvaluation(opportunityId: string) {
    return this.database.opportunity.findUnique({
      where: { id: opportunityId },
      select: {
        id: true,
        domain: true,
        status: true,
        jobDescription: true,
        sourceRecords: {
          where: { rawDescription: { not: null } },
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  async resolveUserProfile(userProfileId: string | null) {
    return userProfileId
      ? this.database.userProfile.findUnique({
          where: { id: userProfileId },
          select: { id: true, version: true },
        })
      : this.database.userProfile.findFirst({
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          select: { id: true, version: true },
        });
  }

  async findLatestEvaluationId(input: {
    opportunityId: string;
    domain?: string | null;
  }) {
    const evaluation = await this.database.evaluation.findFirst({
      where: {
        opportunityId: input.opportunityId,
        ...(input.domain ? { domain: input.domain } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return evaluation?.id ?? null;
  }

  async listEvaluationHistory(input: {
    opportunityId: string;
    domain?: string | null;
  }) {
    return this.database.evaluation.findMany({
      where: {
        opportunityId: input.opportunityId,
        ...(input.domain ? { domain: input.domain } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        evaluationVersion: true,
        promptVersion: true,
        userProfileVersion: true,
        createdAt: true,
        completedAt: true,
        task: { select: { status: true } },
        recommendation: { select: { decision: true } },
      },
    });
  }
}
