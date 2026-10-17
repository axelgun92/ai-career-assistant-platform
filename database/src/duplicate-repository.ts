import {
  compareListings,
  decideDuplicates,
  listingIdKey,
  listingUrlPrefix,
  normalizeCompanyName,
  textTokens,
  type DuplicateCandidate,
  type DuplicateDecisionResult,
  type DuplicateIdentity,
  type DuplicateMatch,
} from "@ai-career/deduplication";
import type { DuplicateMatchSummary } from "@ai-career/core";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

export type DuplicateDatabaseClient = PrismaClient | Prisma.TransactionClient;

// A duplicate relationship as the product shows and enforces it: engine
// decisions persisted at capture or by the backfill, plus exact matches
// detected live for pairs that predate deduplication.
export interface DuplicateRelationship {
  otherOpportunityId: string;
  otherTitle: string | null;
  otherCompanyName: string | null;
  decision: "MATCH" | "PROBABLE_MATCH";
  confidence: number | null;
  matchedOn: string[];
  conflicts: string[];
  // DISTINCT when the user said the two are different jobs (reversible).
  resolution: "DISTINCT" | null;
  resolvedAt: Date | null;
  persisted: boolean;
}

export class DuplicateResolutionError extends Error {
  constructor(
    readonly code: "OPPORTUNITY_NOT_FOUND" | "DUPLICATE_PAIR_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "DuplicateResolutionError";
  }
}

interface CandidateRow {
  id: string;
  firstSeenAt: Date;
  title: string | null;
  location: string | null;
  jobDescription: string | null;
  canonicalUrl: string | null;
  applicationUrl: string | null;
  externalListingId: string | null;
  atsRequisitionId: string | null;
  salaryMin: Prisma.Decimal | null;
  salaryMax: Prisma.Decimal | null;
  currency: string | null;
  companyName: string | null;
}

export interface CandidateDetails {
  candidates: DuplicateCandidate[];
  labels: Map<string, { title: string | null; companyName: string | null }>;
}

const candidateLimit = 500;

// ILIKE pattern that matches the literal text anywhere.
export function containsPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

export function summarizeMatch(
  match: DuplicateMatch,
  label: { title: string | null; companyName: string | null } | undefined,
): DuplicateMatchSummary {
  return {
    opportunityId: match.opportunityId,
    decision: match.decision,
    confidence: match.confidence,
    matchedOn: match.evidence.matchedOn,
    conflicts: match.evidence.conflicts,
    title: label?.title ?? null,
    companyName: label?.companyName ?? null,
  };
}

// Candidate lookup: a superset of every opportunity the engine could match
// (same normalized company, listing/requisition ID, or a URL containing the
// subject's host and path), read with every source record's identifiers.
export async function findDuplicateCandidates(
  client: DuplicateDatabaseClient,
  subject: DuplicateIdentity,
  excludeOpportunityId: string | null = null,
): Promise<CandidateDetails> {
  const companyKey = normalizeCompanyName(subject.companyName);
  const firstCompanyWord = companyKey ? textTokens(companyKey)[0] ?? null : null;
  const listingIds = unique(subject.listingIds.map(listingIdKey));
  const requisitionIds = unique(subject.requisitionIds.map(listingIdKey));
  const urlPatterns = unique(subject.urls.map(listingUrlPrefix)).map(containsPattern);
  const conditions: Prisma.Sql[] = [];
  if (companyKey) {
    conditions.push(Prisma.sql`c."normalizedName" = ${companyKey}`);
    // Companies not yet backfilled are compared by the engine itself.
    if (firstCompanyWord) {
      conditions.push(Prisma.sql`(c."normalizedName" IS NULL AND c."name" ILIKE ${containsPattern(firstCompanyWord)})`);
    }
  }
  const idMatch = (column: Prisma.Sql, values: string[]) =>
    Prisma.sql`lower(btrim(${column})) = ANY(${values}::text[])`;
  const urlMatch = (column: Prisma.Sql) => Prisma.sql`${column} ILIKE ANY(${urlPatterns}::text[])`;
  if (listingIds.length) conditions.push(idMatch(Prisma.sql`o."externalListingId"`, listingIds));
  if (requisitionIds.length) conditions.push(idMatch(Prisma.sql`o."atsRequisitionId"`, requisitionIds));
  if (urlPatterns.length) {
    conditions.push(urlMatch(Prisma.sql`o."canonicalUrl"`), urlMatch(Prisma.sql`o."applicationUrl"`));
  }
  const sourceConditions: Prisma.Sql[] = [];
  if (listingIds.length) sourceConditions.push(idMatch(Prisma.sql`s."externalId"`, listingIds));
  if (requisitionIds.length) sourceConditions.push(idMatch(Prisma.sql`s."requisitionId"`, requisitionIds));
  if (urlPatterns.length) sourceConditions.push(urlMatch(Prisma.sql`s."sourceUrl"`), urlMatch(Prisma.sql`s."applicationUrl"`));
  if (sourceConditions.length) {
    conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SourceRecord" s WHERE s."opportunityId" = o."id" AND (${Prisma.join(sourceConditions, " OR ")}))`);
  }
  if (!conditions.length) return { candidates: [], labels: new Map() };

  const rows = await client.$queryRaw<CandidateRow[]>`
    SELECT o."id", o."firstSeenAt", o."title", o."location", o."jobDescription", o."canonicalUrl",
           o."applicationUrl", o."externalListingId", o."atsRequisitionId", o."salaryMin", o."salaryMax",
           o."currency", c."name" AS "companyName"
    FROM "Opportunity" o
    LEFT JOIN "Company" c ON c."id" = o."companyId"
    WHERE (${Prisma.join(conditions, " OR ")})
      ${excludeOpportunityId ? Prisma.sql`AND o."id" <> ${excludeOpportunityId}::uuid` : Prisma.empty}
    ORDER BY o."firstSeenAt" ASC, o."id" ASC
    LIMIT ${candidateLimit}
  `;
  return candidatesFromRows(client, rows);
}

async function candidatesFromRows(client: DuplicateDatabaseClient, rows: CandidateRow[]): Promise<CandidateDetails> {
  const sources = rows.length
    ? await client.sourceRecord.findMany({
        where: { opportunityId: { in: rows.map((row) => row.id) } },
        select: { opportunityId: true, sourceUrl: true, applicationUrl: true, externalId: true, requisitionId: true },
      })
    : [];
  const labels = new Map<string, { title: string | null; companyName: string | null }>();
  const candidates = rows.map((row): DuplicateCandidate => {
    labels.set(row.id, { title: row.title, companyName: row.companyName });
    const own = sources.filter((source) => source.opportunityId === row.id);
    return {
      opportunityId: row.id,
      firstSeenAt: row.firstSeenAt,
      companyName: row.companyName,
      title: row.title,
      location: row.location,
      description: row.jobDescription,
      urls: [row.canonicalUrl, row.applicationUrl, ...own.flatMap((source) => [source.sourceUrl, source.applicationUrl])],
      listingIds: [row.externalListingId, ...own.map((source) => source.externalId)],
      requisitionIds: [row.atsRequisitionId, ...own.map((source) => source.requisitionId)],
      salaryMin: row.salaryMin === null ? null : Number(row.salaryMin),
      salaryMax: row.salaryMax === null ? null : Number(row.salaryMax),
      currency: row.currency,
    };
  });
  return { candidates, labels };
}

// The identity of a persisted opportunity, with every source record.
export async function opportunityIdentity(
  client: DuplicateDatabaseClient,
  opportunityId: string,
): Promise<DuplicateCandidate | null> {
  const rows = await client.$queryRaw<CandidateRow[]>`
    SELECT o."id", o."firstSeenAt", o."title", o."location", o."jobDescription", o."canonicalUrl",
           o."applicationUrl", o."externalListingId", o."atsRequisitionId", o."salaryMin", o."salaryMax",
           o."currency", c."name" AS "companyName"
    FROM "Opportunity" o LEFT JOIN "Company" c ON c."id" = o."companyId"
    WHERE o."id" = ${opportunityId}::uuid
  `;
  const { candidates } = await candidatesFromRows(client, rows);
  return candidates[0] ?? null;
}

// Pair orientation for DuplicateReference: the later-seen opportunity
// points at the earlier one (ties by id), so each pair has one row.
export function orientPair(
  left: { opportunityId: string; firstSeenAt: Date },
  right: { opportunityId: string; firstSeenAt: Date },
) {
  const leftFirst =
    left.firstSeenAt.getTime() - right.firstSeenAt.getTime() || left.opportunityId.localeCompare(right.opportunityId);
  return leftFirst <= 0
    ? { opportunityId: right.opportunityId, relatedOpportunityId: left.opportunityId }
    : { opportunityId: left.opportunityId, relatedOpportunityId: right.opportunityId };
}

export function referenceEvidence(match: DuplicateMatch, extra: Record<string, unknown> = {}) {
  return { ...match.evidence, ...extra } as unknown as Prisma.InputJsonValue;
}

export class PrismaDuplicateRepository {
  private readonly database = getDatabaseClient();

  // The live engine decision for a persisted opportunity against every
  // other opportunity.
  async liveDecision(
    opportunityId: string,
    client: DuplicateDatabaseClient = this.database,
  ): Promise<{ identity: DuplicateCandidate; decision: DuplicateDecisionResult; labels: CandidateDetails["labels"] } | null> {
    const identity = await opportunityIdentity(client, opportunityId);
    if (!identity) return null;
    const { candidates, labels } = await findDuplicateCandidates(client, identity, opportunityId);
    return { identity, decision: decideDuplicates(identity, candidates), labels };
  }

  // Persisted references in either direction, merged with live exact
  // matches that have no row yet (pairs that predate deduplication).
  async relationships(
    opportunityId: string,
    client: DuplicateDatabaseClient = this.database,
  ): Promise<DuplicateRelationship[]> {
    // Sequential: the client may be one transaction's single connection.
    const live = await this.liveDecision(opportunityId, client);
    const rows = await client.duplicateReference.findMany({
      where: { OR: [{ opportunityId }, { relatedOpportunityId: opportunityId }] },
      include: {
        opportunity: { select: { id: true, title: true, company: { select: { name: true } } } },
        relatedOpportunity: { select: { id: true, title: true, company: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const relationships = new Map<string, DuplicateRelationship>();
    for (const row of rows) {
      if (row.decision === "NO_MATCH") continue;
      const other = row.opportunityId === opportunityId ? row.relatedOpportunity : row.opportunity;
      const evidence = (row.evidence ?? {}) as { matchedOn?: string[]; conflicts?: string[] };
      relationships.set(other.id, {
        otherOpportunityId: other.id,
        otherTitle: other.title,
        otherCompanyName: other.company?.name ?? null,
        decision: row.decision,
        confidence: row.confidence === null ? null : Number(row.confidence),
        matchedOn: evidence.matchedOn ?? [],
        conflicts: evidence.conflicts ?? [],
        resolution: row.resolution,
        resolvedAt: row.resolvedAt,
        persisted: true,
      });
    }
    for (const match of live?.decision.matches ?? []) {
      const existing = relationships.get(match.opportunityId);
      // A live exact match outranks a stored probable one for enforcement,
      // but the stored row (and its resolution) is kept.
      if (existing) {
        if (match.decision === "MATCH" && existing.decision !== "MATCH") {
          relationships.set(match.opportunityId, { ...existing, decision: "MATCH", confidence: 1, matchedOn: match.evidence.matchedOn, conflicts: [] });
        }
        continue;
      }
      if (match.decision !== "MATCH") continue;
      const label = live!.labels.get(match.opportunityId);
      relationships.set(match.opportunityId, {
        otherOpportunityId: match.opportunityId,
        otherTitle: label?.title ?? null,
        otherCompanyName: label?.companyName ?? null,
        decision: "MATCH",
        confidence: match.confidence,
        matchedOn: match.evidence.matchedOn,
        conflicts: match.evidence.conflicts,
        resolution: null,
        resolvedAt: null,
        persisted: false,
      });
    }
    return [...relationships.values()].sort(
      (left, right) =>
        Number(right.decision === "MATCH") - Number(left.decision === "MATCH") ||
        (right.confidence ?? 0) - (left.confidence ?? 0) ||
        left.otherOpportunityId.localeCompare(right.otherOpportunityId),
    );
  }

  // Marks a detected pair as different jobs (DISTINCT) or reopens it
  // (null). A pair without a stored row is stored with the engine's live
  // decision. Nothing else about either opportunity changes.
  async resolve(input: {
    opportunityId: string;
    otherOpportunityId: string;
    resolution: "DISTINCT" | null;
    now?: Date;
  }): Promise<DuplicateRelationship> {
    const now = input.now ?? new Date();
    await this.database.$transaction(async (transaction) => {
      const subject = await opportunityIdentity(transaction, input.opportunityId);
      const other = await opportunityIdentity(transaction, input.otherOpportunityId);
      if (!subject || !other || input.opportunityId === input.otherOpportunityId) {
        throw new DuplicateResolutionError("OPPORTUNITY_NOT_FOUND", "Opportunity not found");
      }
      const pair = orientPair(subject, other);
      const existing = await transaction.duplicateReference.findUnique({
        where: { opportunityId_relatedOpportunityId: pair },
      });
      const resolution = input.resolution
        ? { resolution: input.resolution, resolvedAt: now }
        : { resolution: null, resolvedAt: null };
      if (existing && existing.decision !== "NO_MATCH") {
        await transaction.duplicateReference.update({ where: { id: existing.id }, data: resolution });
      } else {
        const newer = pair.opportunityId === subject.opportunityId ? subject : other;
        const older = newer === subject ? other : subject;
        const match = compareListings(newer, older);
        if (!match) {
          throw new DuplicateResolutionError("DUPLICATE_PAIR_NOT_FOUND", "These opportunities are not detected as duplicates");
        }
        await transaction.duplicateReference.create({
          data: {
            ...pair,
            decision: match.decision,
            confidence: match.confidence,
            evidence: referenceEvidence(match, { recordedBy: "USER_RESOLUTION" }),
            ...resolution,
          },
        });
      }
    });
    // Read after the commit, outside the transaction's single connection.
    const [relationship] = (await this.relationships(input.opportunityId)).filter(
      (item) => item.otherOpportunityId === input.otherOpportunityId,
    );
    return relationship!;
  }

  // The duplicate-spend check behind every paid evaluation request and
  // deferred resume: an opportunity that has never completed an evaluation
  // may not start one while an unresolved exact duplicate already has a
  // completed or active evaluation, a live admission, or an open deferred
  // request. Returns that twin, or null.
  async blockingTwin(
    opportunityId: string,
    client: DuplicateDatabaseClient = this.database,
  ): Promise<{ opportunityId: string; title: string | null; companyName: string | null } | null> {
    const ownCompleted = await client.evaluation.count({ where: { opportunityId, status: "COMPLETED" } });
    if (ownCompleted > 0) return null;
    const twins = (await this.relationships(opportunityId, client)).filter(
      (relationship) => relationship.decision === "MATCH" && relationship.resolution === null,
    );
    for (const twin of twins) {
      const [spend] = await client.$queryRaw<Array<{ spend: boolean }>>`
        SELECT (
          EXISTS (SELECT 1 FROM "Evaluation" e LEFT JOIN "EvaluationTask" t ON t."evaluationId" = e."id"
                  WHERE e."opportunityId" = ${twin.otherOpportunityId}::uuid
                    AND (e."status" = 'COMPLETED' OR COALESCE(t."status", e."status") IN ('PENDING', 'RUNNING')))
          OR EXISTS (SELECT 1 FROM "EvaluationAdmission" a
                     WHERE a."opportunityId" = ${twin.otherOpportunityId}::uuid
                       AND a."evaluationId" IS NULL AND a."abandonedAt" IS NULL)
          OR EXISTS (SELECT 1 FROM "DeferredEvaluation" d
                     WHERE d."opportunityId" = ${twin.otherOpportunityId}::uuid AND d."status" = 'DEFERRED')
        ) AS "spend"
      `;
      if (spend?.spend) {
        return { opportunityId: twin.otherOpportunityId, title: twin.otherTitle, companyName: twin.otherCompanyName };
      }
    }
    return null;
  }
}
