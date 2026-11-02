import {
  preEvaluatorTriageReasonSchema,
  type PreEvaluatorTriageAssessment,
  type PreEvaluatorTriageManualDecision,
  type PreEvaluatorTriageOutcome,
  type PreEvaluatorTriageReason,
} from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import {
  residencyRequirement,
  storedEligibilityFacts,
  storedWorkArrangements,
} from "./manual-opportunity-repository";

const reasonsSchema = preEvaluatorTriageReasonSchema.array();

export interface PreEvaluatorTriageRecord {
  id: string;
  opportunityId: string;
  domain: string;
  userProfileId: string | null;
  userProfileVersion: number | null;
  outcome: PreEvaluatorTriageOutcome;
  reasons: PreEvaluatorTriageReason[];
  inputFingerprint: string;
  manualDecision: PreEvaluatorTriageManualDecision | null;
  manuallyDecidedAt: Date | null;
  assessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function recordOf(row: {
  id: string;
  opportunityId: string;
  domain: string;
  userProfileId: string | null;
  userProfileVersion: number | null;
  outcome: string;
  reasons: unknown;
  inputFingerprint: string;
  manualDecision: string | null;
  manuallyDecidedAt: Date | null;
  assessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): PreEvaluatorTriageRecord {
  return {
    ...row,
    outcome: row.outcome as PreEvaluatorTriageOutcome,
    reasons: reasonsSchema.parse(row.reasons),
    manualDecision: row.manualDecision as PreEvaluatorTriageManualDecision | null,
  };
}

export class PrismaPreEvaluatorTriageRepository {
  private readonly database = getDatabaseClient();

  async loadAssessmentInput(opportunityId: string, userProfileId: string) {
    const [opportunity, profile, eligibility] = await Promise.all([
      this.database.opportunity.findUnique({
        where: { id: opportunityId },
        select: {
          id: true,
          domain: true,
          salaryMin: true,
          salaryMax: true,
          currency: true,
          compensationBasis: true,
          residencyRequirement: true,
          residencyRegions: true,
          remoteStatus: true,
          workArrangements: true,
          location: true,
          workAuthorizationRequirement: true,
          workAuthorizationRegions: true,
          visaSponsorship: true,
          relocationSupport: true,
          employerOfRecordRegions: true,
        },
      }),
      this.database.userProfile.findUnique({
        where: { id: userProfileId },
        select: { id: true, version: true, domainPreferences: true },
      }),
      this.database.userEligibility.findUnique({ where: { id: "user" } }),
    ]);
    if (!opportunity || !profile) return null;
    return {
      opportunity: {
        salaryMin: opportunity.salaryMin?.toNumber() ?? null,
        salaryMax: opportunity.salaryMax?.toNumber() ?? null,
        currency: opportunity.currency,
        residencyRequirement: residencyRequirement(opportunity.residencyRequirement),
        residencyRegions: opportunity.residencyRegions,
        remoteStatus: opportunity.remoteStatus,
        workArrangements: storedWorkArrangements(opportunity.workArrangements),
        location: opportunity.location,
        ...storedEligibilityFacts(opportunity),
      },
      domain: opportunity.domain,
      profile,
      eligibility: eligibility
        ? {
            authorizedRegions: eligibility.authorizedRegions,
            citizenshipRegions: eligibility.citizenshipRegions,
          }
        : null,
    };
  }

  async saveAssessment(input: {
    opportunityId: string;
    domain: string;
    userProfileId: string;
    userProfileVersion: number;
    assessment: PreEvaluatorTriageAssessment;
    inputFingerprint: string;
    assessedAt: Date;
  }): Promise<PreEvaluatorTriageRecord> {
    const data = {
      domain: input.domain,
      userProfileId: input.userProfileId,
      userProfileVersion: input.userProfileVersion,
      outcome: input.assessment.outcome,
      reasons: input.assessment.reasons as Prisma.InputJsonValue,
      inputFingerprint: input.inputFingerprint,
      assessedAt: input.assessedAt,
    };
    const row = await this.database.preEvaluatorTriage.upsert({
      where: { opportunityId: input.opportunityId },
      create: { opportunityId: input.opportunityId, ...data },
      // Deliberately do not update manualDecision or manuallyDecidedAt. A
      // later observation may refresh the automatic assessment, but never
      // silently erases Alex's explicit decision.
      update: data,
    });
    return recordOf(row);
  }

  async get(opportunityId: string): Promise<PreEvaluatorTriageRecord | null> {
    const row = await this.database.preEvaluatorTriage.findUnique({ where: { opportunityId } });
    return row ? recordOf(row) : null;
  }

  async decide(input: {
    opportunityId: string;
    decision: PreEvaluatorTriageManualDecision;
    decidedAt: Date;
  }): Promise<PreEvaluatorTriageRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.preEvaluatorTriage.updateMany({
        where: {
          opportunityId: input.opportunityId,
          outcome: "NEEDS_REVIEW",
          manualDecision: null,
        },
        data: {
          manualDecision: input.decision,
          manuallyDecidedAt: input.decidedAt,
        },
      });
      if (changed.count !== 1) return null;
      return recordOf(
        await transaction.preEvaluatorTriage.findUniqueOrThrow({
          where: { opportunityId: input.opportunityId },
        }),
      );
    });
  }

  async listNeedsReview() {
    const rows = await this.database.preEvaluatorTriage.findMany({
      where: { outcome: "NEEDS_REVIEW", manualDecision: null },
      orderBy: [{ assessedAt: "asc" }, { id: "asc" }],
      include: {
        opportunity: {
          select: {
            title: true,
            status: true,
            company: { select: { name: true } },
          },
        },
      },
    });
    return rows.map((row) => ({
      ...recordOf(row),
      opportunityTitle: row.opportunity.title,
      opportunityStatus: row.opportunity.status,
      companyName: row.opportunity.company?.name ?? null,
    }));
  }
}
