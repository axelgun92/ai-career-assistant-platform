import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";

// Read-only access to a stored source version for acceptance and debugging
// (Feature 14B original-JD retest). Nothing here writes: every read runs in
// a READ ONLY transaction, and the acceptance check's own client also opens
// every session read-only, so PostgreSQL itself refuses any write.

type ReadClient = Pick<PrismaClient, "$transaction">;
type ReadTransaction = Prisma.TransactionClient;

// A client whose every session is read-only (default_transaction_read_only).
// For acceptance tooling only; the application uses getDatabaseClient().
export function createReadOnlyDatabaseClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString, options: "-c default_transaction_read_only=on" });
  return new PrismaClient({ adapter });
}

// Runs the reads in one READ ONLY transaction: PostgreSQL rejects any
// insert, update or delete attempted inside it.
export function readOnlyTransaction<T>(client: ReadClient, reads: (transaction: ReadTransaction) => Promise<T>): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return reads(transaction);
  });
}

const sourceVersionSelect = {
  id: true,
  opportunityId: true,
  source: true,
  sourceType: true,
  sourceUrl: true,
  applicationUrl: true,
  externalId: true,
  requisitionId: true,
  rawTitle: true,
  rawCompany: true,
  rawLocation: true,
  rawDescription: true,
  rawSalaryText: true,
  rawEmploymentType: true,
  rawPostingDate: true,
  sourceMetadata: true,
  rawPayload: true,
  retrievalType: true,
  sourceCategory: true,
  retrievalSourceId: true,
  retrievalRunId: true,
  contentHash: true,
  previousSourceRecordId: true,
  discoveredAt: true,
  lastObservedAt: true,
  createdAt: true,
} satisfies Prisma.SourceRecordSelect;

export type StoredSourceVersion = Prisma.SourceRecordGetPayload<{ select: typeof sourceVersionSelect }> & {
  // The domain the version was normalized for, as its own provenance states
  // it (else the opportunity's).
  domain: string | null;
};

const storedFactsSelect = {
  id: true,
  domain: true,
  title: true,
  company: { select: { name: true } },
  location: true,
  remoteStatus: true,
  workArrangements: true,
  employmentType: true,
  seniority: true,
  seniorityLabel: true,
  timeZoneRequirements: true,
  residencyRequirement: true,
  residencyRegions: true,
  workAuthorizationRequirement: true,
  workAuthorizationRegions: true,
  visaSponsorship: true,
  relocationSupport: true,
  employerOfRecordRegions: true,
  salaryMin: true,
  salaryMax: true,
  salaryText: true,
  compensationBasis: true,
  compensationTiers: true,
  bonus: true,
  currency: true,
  compensationNotes: true,
  postingDate: true,
  closingDate: true,
  canonicalUrl: true,
  applicationUrl: true,
  externalListingId: true,
  atsRequisitionId: true,
  jobDescription: true,
} satisfies Prisma.OpportunitySelect;

export type StoredOpportunityFacts = Prisma.OpportunityGetPayload<{ select: typeof storedFactsSelect }>;

export type SourceVersionSummary = {
  id: string;
  source: string;
  externalId: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  lastObservedAt: Date;
};

export type StoredSourceVersionRead = {
  version: StoredSourceVersion;
  // The opportunity as stored now (its current facts), when the version
  // belongs to one.
  opportunity: StoredOpportunityFacts | null;
  // The source version the opportunity's current title was projected from.
  currentFactsVersionId: string | null;
  // Every source version of the opportunity, most recently observed first.
  versions: SourceVersionSummary[];
};

export type SourceVersionSelector = { sourceRecordId: string } | { opportunityId: string };

// The stored source version (by its ID, or the opportunity's most recently
// observed one: the version a recapture that reported "Nothing changed"
// just observed again), with the opportunity's current stored facts.
// Null when nothing matches.
export function readStoredSourceVersion(client: ReadClient, selector: SourceVersionSelector): Promise<StoredSourceVersionRead | null> {
  return readOnlyTransaction(client, async (transaction) => {
    let opportunityId: string | null;
    if ("sourceRecordId" in selector) {
      const record = await transaction.sourceRecord.findUnique({ where: { id: selector.sourceRecordId }, select: { opportunityId: true } });
      if (!record) return null;
      opportunityId = record.opportunityId;
    } else {
      opportunityId = selector.opportunityId;
    }
    const versions: SourceVersionSummary[] = opportunityId
      ? await transaction.sourceRecord.findMany({
          where: { opportunityId },
          orderBy: [{ lastObservedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          select: { id: true, source: true, externalId: true, sourceUrl: true, createdAt: true, lastObservedAt: true },
        })
      : [];
    const versionId = "sourceRecordId" in selector ? selector.sourceRecordId : versions[0]?.id;
    if (!versionId) return null;
    const version = await transaction.sourceRecord.findUnique({ where: { id: versionId }, select: sourceVersionSelect });
    if (!version) return null;
    const opportunity = opportunityId
      ? await transaction.opportunity.findUnique({ where: { id: opportunityId }, select: storedFactsSelect })
      : null;
    const domainRow = await transaction.fieldProvenance.findFirst({
      where: { sourceRecordId: version.id, fieldName: "domain" },
      orderBy: { createdAt: "asc" },
      select: { sourceText: true },
    });
    const currentTitle = opportunityId
      ? await transaction.fieldProvenance.findFirst({
          where: { opportunityId, fieldName: "title", supersededAt: null, sourceRecordId: { not: null } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { sourceRecordId: true },
        })
      : null;
    return {
      version: { ...version, domain: domainRow?.sourceText ?? opportunity?.domain ?? null },
      opportunity,
      currentFactsVersionId: currentTitle?.sourceRecordId ?? null,
      versions,
    };
  });
}
