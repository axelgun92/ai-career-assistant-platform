import {
  applyConfirmedFacts,
  compensationTierSchema,
  preEvaluatorTriageReasonSchema,
  type PreEvaluatorTriageAssessment,
  type PreEvaluatorTriageManualDecision,
  type PreEvaluatorTriageOutcome,
  type PreEvaluatorTriageReason,
} from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import { activeConfirmedFacts } from "./confirmed-fact-repository";
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
    const [opportunity, profile, eligibility, confirmed] = await Promise.all([
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
          // November 25, 2026: the position facts and compensation tiers the
          // opportunity page shows, and the listing's own text for the
          // explicit position evidence.
          title: true,
          seniority: true,
          seniorityLabel: true,
          employmentType: true,
          compensationTiers: true,
          jobDescription: true,
          responsibilities: true,
          requirements: true,
          fieldProvenance: {
            where: { fieldName: "remoteStatus", supersededAt: null, normalizedValue: { equals: "REMOTE_BY_EXCEPTION" } },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.database.userProfile.findUnique({
        where: { id: userProfileId },
        select: { id: true, version: true, domainPreferences: true },
      }),
      this.database.userEligibility.findUnique({ where: { id: "user" } }),
      activeConfirmedFacts(this.database, opportunityId),
    ]);
    if (!opportunity || !profile) return null;
    // The captured, normalized facts with the user's confirmed facts applied
    // (November 25, 2026): the same facts the opportunity page shows.
    const captured = {
        salaryMin: opportunity.salaryMin?.toNumber() ?? null,
        salaryMax: opportunity.salaryMax?.toNumber() ?? null,
        currency: opportunity.currency,
        residencyRequirement: residencyRequirement(opportunity.residencyRequirement),
        residencyRegions: opportunity.residencyRegions,
        remoteStatus: opportunity.remoteStatus,
        workArrangements: storedWorkArrangements(opportunity.workArrangements),
        location: opportunity.location,
        ...storedEligibilityFacts(opportunity),
        title: opportunity.title,
        seniority: opportunity.seniority,
        seniorityLabel: opportunity.seniorityLabel,
        employmentType: opportunity.employmentType,
        compensationTiers: compensationTierSchema.array().catch([]).parse(opportunity.compensationTiers),
        remoteByException: opportunity.fieldProvenance.length > 0,
        fullTimeScheduleConfirmed: false,
    };
    return {
      opportunity: applyConfirmedFacts(captured, confirmed),
      captured,
      confirmed: confirmed.map((fact) => ({ fieldName: fact.fieldName, value: fact.value })),
      // The complete stored description, read for explicit position
      // evidence (never shown or stored by triage itself).
      text: [opportunity.jobDescription, opportunity.responsibilities, opportunity.requirements].filter(Boolean).join("\n\n"),
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
    // What prompted this assessment, kept in the history (November 25).
    trigger?: string;
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
    const row = await this.database.$transaction(async (transaction) => {
      const previous = await transaction.preEvaluatorTriage.findUnique({
        where: { opportunityId: input.opportunityId },
        select: { outcome: true, inputFingerprint: true },
      });
      const saved = await transaction.preEvaluatorTriage.upsert({
        where: { opportunityId: input.opportunityId },
        create: { opportunityId: input.opportunityId, ...data },
        // Deliberately do not update manualDecision or manuallyDecidedAt. A
        // later observation may refresh the automatic assessment, but never
        // silently erases Alex's explicit decision.
        update: data,
      });
      // Every assessment is kept, never overwritten (November 25, 2026); a
      // repeat with the same inputs and outcome adds nothing.
      if (previous && previous.inputFingerprint === input.inputFingerprint && previous.outcome === input.assessment.outcome) return saved;
      await transaction.preEvaluatorTriageHistory.create({
        data: {
          opportunityId: input.opportunityId,
          outcome: input.assessment.outcome,
          reasons: input.assessment.reasons as Prisma.InputJsonValue,
          inputFingerprint: input.inputFingerprint,
          userProfileId: input.userProfileId,
          userProfileVersion: input.userProfileVersion,
          trigger: input.trigger ?? "INITIAL",
          assessedAt: input.assessedAt,
        },
      });
      return saved;
    });
    return recordOf(row);
  }

  // Every assessment of an opportunity, oldest first.
  async history(opportunityId: string) {
    const rows = await this.database.preEvaluatorTriageHistory.findMany({
      where: { opportunityId },
      orderBy: [{ assessedAt: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      outcome: row.outcome as PreEvaluatorTriageOutcome,
      reasons: reasonsSchema.parse(row.reasons),
      trigger: row.trigger,
      userProfileVersion: row.userProfileVersion,
      assessedAt: row.assessedAt,
    }));
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
    // The Needs Review queue holds jobs still in Active only (November 25,
    // 2026): a job moved to Dismissed, Archived or Applied keeps its triage
    // result in its history but is no longer waiting for a decision.
    const rows = await this.database.preEvaluatorTriage.findMany({
      where: { outcome: "NEEDS_REVIEW", manualDecision: null, opportunity: { status: { in: ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"] } } },
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
