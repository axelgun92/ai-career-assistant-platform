import type { MarketEvaluationFact, MarketOpportunityFact, MarketRequirementFact, MarketTierFact } from "@ai-career/core";
import { getDatabaseClient } from "./client";
import { noLongerListedCondition } from "./opportunity-list-repository";

// Job-Market Analytics read model (feature 16). Read-only: every query is a
// SELECT over persisted opportunities, source records, evaluations,
// recommendations, deferrals and duplicate references. It writes nothing,
// stores no aggregate, and never calls a provider. Metrics are derived by the
// pure Core module (market-analytics.ts).
//
// Evaluated facts are read from Evaluation.domainResult by JSON path, as
// stored, never re-run or reinterpreted: hardFilters.role.classification,
// companyAlignment.alignment.customerSegment.classification and the job-side
// JD Reconstruction requirements (hardFilters.reconstruction.requirements).
// A requirement set's version is the prompt version of the evaluation's
// successful JD Reconstruction call.

export const jdReconstructionOperationId = "customer-success.jd-reconstruction";

// Every source type except the user's own captures is automated retrieval.
// An opportunity is in the automated sample only when its originating
// listing (the earliest SourceRecord by createdAt, id: the platform's origin
// rule) was automated; a job the user captured first stays user-collected
// even if automated retrieval lists it later.
const userCollectedSourceTypes = ["MANUAL", "BROWSER_EXTENSION"];

type OpportunityRow = Omit<MarketOpportunityFact, "evaluations" | "compensationTiers" | "noLongerListed"> & {
  compensationTiers: unknown;
  noLongerListed: boolean | null;
};

type EvaluationRow = Omit<MarketEvaluationFact, "requirements"> & { opportunityId: string; requirements: unknown };

const finiteOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

// Stored tiers as written by normalization; anything malformed is skipped.
export function readStoredTiers(value: unknown): MarketTierFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tier) => {
    if (!tier || typeof tier !== "object") return [];
    const entry = tier as Record<string, unknown>;
    const label = textOrNull(entry.label);
    if (!label) return [];
    return [{ label, minimum: finiteOrNull(entry.minimum), maximum: finiteOrNull(entry.maximum), currency: textOrNull(entry.currency) }];
  });
}

// Stored reconstruction requirements; null when the result has none.
export function readStoredRequirements(value: unknown): MarketRequirementFact[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const requirement = textOrNull(entry.requirement);
    const category = textOrNull(entry.category);
    const strength = textOrNull(entry.strength);
    if (!requirement || !category || !strength) return [];
    return [
      {
        requirement,
        category,
        strength,
        statedYears: finiteOrNull(entry.statedYears),
        statedYearsMaximum: finiteOrNull(entry.statedYearsMaximum),
        statedYearsOpenEnded: entry.statedYearsOpenEnded === true,
      },
    ];
  });
}

export class PrismaMarketAnalyticsRepository {
  private readonly database = getDatabaseClient();

  async facts(): Promise<MarketOpportunityFact[]> {
    const [opportunities, evaluations] = await Promise.all([
      this.database.$queryRaw<OpportunityRow[]>`
        SELECT o."id", o."title", o."status"::text AS status, o."firstSeenAt",
               COALESCE((SELECT sr."sourceType"::text NOT IN (${userCollectedSourceTypes[0]}, ${userCollectedSourceTypes[1]})
                 FROM "SourceRecord" sr WHERE sr."opportunityId" = o."id"
                 ORDER BY sr."createdAt" ASC, sr."id" ASC LIMIT 1), false) AS automated,
               o."seniority", o."seniorityLabel", o."location", o."remoteStatus", o."workArrangements",
               o."residencyRequirement", o."residencyRegions", o."workAuthorizationRequirement", o."workAuthorizationRegions",
               o."visaSponsorship", o."relocationSupport", o."employerOfRecordRegions", o."timeZoneRequirements",
               o."salaryMin"::float8 AS "salaryMin", o."salaryMax"::float8 AS "salaryMax", o."currency", o."compensationBasis",
               o."compensationTiers",
               (SELECT d."reasonCode" FROM "DeferredEvaluation" d
                 WHERE d."opportunityId" = o."id" AND d."status" = 'DEFERRED'
                 ORDER BY d."createdAt" DESC, d."id" DESC LIMIT 1) AS "openDeferralReason",
               -- The newer side of an unresolved probable pair, so one pair counts once.
               EXISTS (SELECT 1 FROM "DuplicateReference" dr
                 WHERE dr."decision" = 'PROBABLE_MATCH' AND dr."resolution" IS NULL
                   AND dr."opportunityId" = o."id") AS "probableUnresolved",
               ${noLongerListedCondition} AS "noLongerListed"
        FROM "Opportunity" o
        ORDER BY o."firstSeenAt" ASC, o."id" ASC
      `,
      this.database.$queryRaw<EvaluationRow[]>`
        SELECT e."id", e."opportunityId", e."status"::text AS status, e."createdAt", e."completedAt", r."decision",
               e."domainResult" #>> '{hardFilters,role,classification}' AS "roleClassification",
               e."domainResult" #>> '{companyAlignment,alignment,customerSegment,classification}' AS "customerSegment",
               CASE WHEN e."status" = 'COMPLETED' THEN e."domainResult" #> '{hardFilters,reconstruction,requirements}' END AS requirements,
               (SELECT a."promptVersion" FROM "SemanticOperationAttempt" a
                 WHERE a."evaluationId" = e."id" AND a."operationId" = ${jdReconstructionOperationId} AND a."status" = 'SUCCESS'
                 ORDER BY a."createdAt" DESC, a."attempt" DESC LIMIT 1) AS "reconstructionVersion"
        FROM "Evaluation" e LEFT JOIN "Recommendation" r ON r."evaluationId" = e."id"
        ORDER BY e."createdAt" ASC, e."id" ASC
      `,
    ]);

    const byOpportunity = new Map<string, MarketEvaluationFact[]>();
    for (const { opportunityId, requirements, ...row } of evaluations) {
      const list = byOpportunity.get(opportunityId) ?? [];
      list.push({ ...row, requirements: readStoredRequirements(requirements) });
      byOpportunity.set(opportunityId, list);
    }
    return opportunities.map((row) => ({
      ...row,
      workArrangements: row.workArrangements ?? [],
      residencyRegions: row.residencyRegions ?? [],
      workAuthorizationRegions: row.workAuthorizationRegions ?? [],
      employerOfRecordRegions: row.employerOfRecordRegions ?? [],
      compensationTiers: readStoredTiers(row.compensationTiers),
      evaluations: byOpportunity.get(row.id) ?? [],
      noLongerListed: Boolean(row.noLongerListed),
    }));
  }
}
