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

  // Resolution order for new evaluations: an explicit profile ID, then the
  // version the user activated for the domain, then the pre-existing
  // newest-profile fallback (only when nothing was ever activated). The
  // resolved ID is pinned on the evaluation at enqueue and never rebound.
  async resolveUserProfile(userProfileId: string | null, domain?: string | null) {
    if (userProfileId) {
      return this.database.userProfile.findUnique({
        where: { id: userProfileId },
        select: { id: true, version: true },
      });
    }
    if (domain) {
      const active = await this.database.activeUserProfile.findUnique({
        where: { domain },
        select: { userProfile: { select: { id: true, version: true } } },
      });
      if (active) return active.userProfile;
    }
    return this.database.userProfile.findFirst({
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
