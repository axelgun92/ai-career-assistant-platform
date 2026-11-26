import { normalizeCompanyName } from "@ai-career/deduplication";
import { getDatabaseClient } from "./client";
import { orientPair, PrismaDuplicateRepository, referenceEvidence } from "./duplicate-repository";

// At most this many probable matches are recorded per opportunity, as at
// capture.
const recordedProbableMatches = 3;

export interface DeduplicationBackfillReport {
  dryRun: boolean;
  companiesMissingNormalizedName: number;
  companiesNormalized: number;
  // Companies whose name has no letters or digits keep a NULL normalized name.
  companiesWithoutKey: number;
  opportunitiesScanned: number;
  duplicateReferencesMissing: number;
  duplicateReferencesCreated: number;
}

// `pnpm db:backfill-dedup` — an explicit, idempotent, additive backfill:
//   1. fills Company.normalizedName where it is NULL (never renames, merges,
//      deletes or re-links a company);
//   2. records DuplicateReference rows for duplicate pairs among existing
//      opportunities that have none yet (never changes an existing row, an
//      opportunity, its sources, evaluations or application).
// With dryRun nothing is written; the report shows what would be.
export async function backfillDeduplication(options: { dryRun: boolean }): Promise<DeduplicationBackfillReport> {
  const database = getDatabaseClient();
  const report: DeduplicationBackfillReport = {
    dryRun: options.dryRun,
    companiesMissingNormalizedName: 0,
    companiesNormalized: 0,
    companiesWithoutKey: 0,
    opportunitiesScanned: 0,
    duplicateReferencesMissing: 0,
    duplicateReferencesCreated: 0,
  };

  const companies = await database.company.findMany({
    where: { normalizedName: null },
    select: { id: true, name: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  report.companiesMissingNormalizedName = companies.length;
  for (const company of companies) {
    const key = normalizeCompanyName(company.name);
    if (!key) {
      report.companiesWithoutKey += 1;
      continue;
    }
    if (options.dryRun) continue;
    // Conditional: a value written meanwhile is never overwritten.
    const updated = await database.company.updateMany({
      where: { id: company.id, normalizedName: null },
      data: { normalizedName: key },
    });
    report.companiesNormalized += updated.count;
  }

  const duplicates = new PrismaDuplicateRepository();
  const opportunities = await database.opportunity.findMany({
    select: { id: true, firstSeenAt: true },
    orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
  });
  const seen = new Set<string>();
  for (const opportunity of opportunities) {
    report.opportunitiesScanned += 1;
    const live = await duplicates.liveDecision(opportunity.id);
    if (!live) continue;
    const exact = live.decision.matches.filter((match) => match.decision === "MATCH");
    const probable = live.decision.matches
      .filter((match) => match.decision === "PROBABLE_MATCH")
      .slice(0, recordedProbableMatches);
    for (const match of [...exact, ...probable]) {
      const pair = orientPair({ opportunityId: opportunity.id, firstSeenAt: opportunity.firstSeenAt }, match);
      const key = `${pair.opportunityId}:${pair.relatedOpportunityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = await database.duplicateReference.findUnique({
        where: { opportunityId_relatedOpportunityId: pair },
        select: { id: true },
      });
      if (existing) continue;
      report.duplicateReferencesMissing += 1;
      if (options.dryRun) continue;
      const created = await database.duplicateReference.createMany({
        data: [{
          ...pair,
          decision: match.decision,
          confidence: match.confidence,
          evidence: referenceEvidence(match, { recordedBy: "BACKFILL" }),
        }],
        skipDuplicates: true,
      });
      report.duplicateReferencesCreated += created.count;
    }
  }
  return report;
}
