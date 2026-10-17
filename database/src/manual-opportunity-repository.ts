import { residencyRequirementValues, type ResidencyRequirement } from "@ai-career/core";
import type {
  DeduplicationOutcome,
  DuplicateCheckResult,
  DuplicateResolutionChoice,
  FieldProvenanceInput,
  ManualOpportunityDetail,
  ManualOpportunityRepository,
  NormalizedOpportunity,
  RawOpportunity,
} from "@ai-career/core";
import {
  decideDuplicates,
  normalizeCompanyName,
  textTokens,
  type DuplicateDecisionResult,
  type DuplicateIdentity,
} from "@ai-career/deduplication";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import {
  containsPattern,
  findDuplicateCandidates,
  orientPair,
  referenceEvidence,
  summarizeMatch,
  type CandidateDetails,
} from "./duplicate-repository";

// Serializes captures: the duplicate decision, company reuse and the write
// it leads to happen as one step, so two simultaneous captures of the same
// listing (or a new company) cannot both create a record.
const captureLockKey = Prisma.sql`hashtext('ai-career:opportunity-capture')`;
// At most this many probable matches are recorded per capture.
const recordedProbableMatches = 3;

type Transaction = Prisma.TransactionClient;

function captureIdentity(opportunity: NormalizedOpportunity): DuplicateIdentity {
  return {
    companyName: opportunity.companyName,
    title: opportunity.title,
    location: opportunity.location,
    description: opportunity.jobDescription,
    urls: [opportunity.canonicalUrl, opportunity.applicationUrl],
    listingIds: [opportunity.externalListingId],
    requisitionIds: [opportunity.atsRequisitionId],
    salaryMin: opportunity.salaryMin,
    salaryMax: opportunity.salaryMax,
    currency: opportunity.currency,
  };
}

function summaries(decision: DuplicateDecisionResult, labels: CandidateDetails["labels"]) {
  return decision.matches.map((match) => summarizeMatch(match, labels.get(match.opportunityId)));
}

// The company an opportunity links to: the oldest Company whose normalized
// name matches (including companies not yet backfilled, compared here
// without being changed), or a new one. Stored names are never rewritten.
export async function resolveCompanyId(transaction: Transaction, name: string | null): Promise<string | null> {
  if (!name) return null;
  const key = normalizeCompanyName(name);
  if (key) {
    const firstWord = textTokens(key)[0]!;
    const rows = await transaction.$queryRaw<Array<{ id: string; name: string; normalizedName: string | null }>>`
      SELECT "id", "name", "normalizedName" FROM "Company"
      WHERE "normalizedName" = ${key}
         OR ("normalizedName" IS NULL AND "name" ILIKE ${containsPattern(firstWord)})
      ORDER BY "createdAt" ASC, "id" ASC
    `;
    const existing = rows.find((row) => (row.normalizedName ?? normalizeCompanyName(row.name)) === key);
    if (existing) return existing.id;
  }
  const created = await transaction.company.create({
    data: { name, normalizedName: key },
    select: { id: true },
  });
  return created.id;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type OpportunityDetailRecord = Prisma.OpportunityGetPayload<{
  include: {
    company: true;
    sourceRecords: true;
    fieldProvenance: true;
  };
}>;

// Stored values outside the vocabulary read as Unknown.
export function residencyRequirement(value: string | null): ResidencyRequirement | null {
  return (residencyRequirementValues as readonly string[]).includes(value ?? "") ? (value as ResidencyRequirement) : null;
}

function mapOpportunityDetail(
  record: OpportunityDetailRecord,
): ManualOpportunityDetail {
  return {
    opportunity: {
      id: record.id,
      domain: record.domain,
      externalListingId: record.externalListingId,
      atsRequisitionId: record.atsRequisitionId,
      canonicalUrl: record.canonicalUrl,
      applicationUrl: record.applicationUrl,
      originalSource: record.originalSource,
      discoveredAt: record.discoveredAt,
      sourceUpdatedAt: record.sourceUpdatedAt,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      companyName: record.company?.name ?? null,
      brand: record.company?.brand ?? null,
      parentCompany: null,
      industry: record.company?.industry ?? null,
      headquarters: record.company?.headquarters ?? null,
      companySize: record.company?.companySize ?? null,
      title: record.title,
      department: record.department,
      employmentType: record.employmentType,
      seniority: record.seniority,
      location: record.location,
      remoteStatus: record.remoteStatus,
      timeZoneRequirements: record.timeZoneRequirements,
      residencyRequirement: residencyRequirement(record.residencyRequirement),
      residencyRegions: record.residencyRegions,
      salaryMin: record.salaryMin?.toNumber() ?? null,
      salaryMax: record.salaryMax?.toNumber() ?? null,
      salaryText: record.salaryText,
      bonus: record.bonus,
      equity: record.equity,
      currency: record.currency,
      compensationNotes: record.compensationNotes,
      postingDate: record.postingDate,
      closingDate: record.closingDate,
      source: record.source,
      sourceType: record.sourceType,
      atsPlatform: record.atsPlatform,
      jobDescription: record.jobDescription,
      responsibilities: record.responsibilities,
      requirements: record.requirements,
      benefits: record.benefits,
      additionalNotes: record.additionalNotes,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    sourceRecords: record.sourceRecords.map((sourceRecord) => ({
      id: sourceRecord.id,
      source: sourceRecord.source,
      sourceType: sourceRecord.sourceType,
      sourceUrl: sourceRecord.sourceUrl,
      applicationUrl: sourceRecord.applicationUrl,
      externalId: sourceRecord.externalId,
      requisitionId: sourceRecord.requisitionId,
      rawTitle: sourceRecord.rawTitle,
      rawCompany: sourceRecord.rawCompany,
      rawLocation: sourceRecord.rawLocation,
      rawDescription: sourceRecord.rawDescription,
      rawSalaryText: sourceRecord.rawSalaryText,
      rawEmploymentType: sourceRecord.rawEmploymentType,
      rawPostingDate: sourceRecord.rawPostingDate,
      sourceMetadata: sourceRecord.sourceMetadata,
      rawPayload: sourceRecord.rawPayload,
      duplicateDecision: sourceRecord.duplicateDecision,
      duplicateEvidence: sourceRecord.duplicateEvidence,
      discoveredAt: sourceRecord.discoveredAt,
      lastObservedAt: sourceRecord.lastObservedAt,
      normalizedAt: sourceRecord.normalizedAt,
      createdAt: sourceRecord.createdAt,
      updatedAt: sourceRecord.updatedAt,
    })),
    fieldProvenance: record.fieldProvenance.map((provenance) => ({
      id: provenance.id,
      sourceRecordId: provenance.sourceRecordId,
      fieldName: provenance.fieldName,
      sourceField: provenance.sourceField,
      kind: provenance.kind,
      normalizedValue: provenance.normalizedValue,
      sourceReference: provenance.sourceReference,
      sourceText: provenance.sourceText,
      collectedAt: provenance.collectedAt,
      createdAt: provenance.createdAt,
    })),
  };
}

export class PrismaManualOpportunityRepository
  implements ManualOpportunityRepository
{
  private readonly database = getDatabaseClient();

  async createManualSourceRecord(rawOpportunity: RawOpportunity) {
    return this.database.sourceRecord.create({
      data: this.sourceRecordData(rawOpportunity),
      select: { id: true, discoveredAt: true },
    });
  }

  private sourceRecordData(rawOpportunity: RawOpportunity) {
    return {
      source: rawOpportunity.source,
      sourceType: rawOpportunity.sourceType,
      sourceUrl: rawOpportunity.sourceUrl,
      applicationUrl: rawOpportunity.applicationUrl,
      externalId: rawOpportunity.externalId,
      requisitionId: rawOpportunity.requisitionId,
      rawTitle: rawOpportunity.title,
      rawCompany: rawOpportunity.company,
      rawLocation: rawOpportunity.location,
      rawDescription: rawOpportunity.description,
      rawSalaryText: rawOpportunity.salaryText,
      rawEmploymentType: rawOpportunity.employmentType,
      rawPostingDate: rawOpportunity.postingDate,
      sourceMetadata:
        rawOpportunity.sourceMetadata === null ? undefined : asInputJson(rawOpportunity.sourceMetadata),
      rawPayload: rawOpportunity.rawPayload === null ? undefined : asInputJson(rawOpportunity.rawPayload),
      discoveredAt: rawOpportunity.discoveredAt,
      lastObservedAt: rawOpportunity.discoveredAt,
    } satisfies Prisma.SourceRecordUncheckedCreateInput;
  }

  async checkDuplicates(input: {
    rawOpportunity: RawOpportunity;
    opportunity: NormalizedOpportunity;
  }): Promise<DuplicateCheckResult> {
    const details = await findDuplicateCandidates(this.database, captureIdentity(input.opportunity));
    const decision = decideDuplicates(captureIdentity(input.opportunity), details.candidates);
    return {
      decision: decision.decision,
      canonicalOpportunityId: decision.canonical?.opportunityId ?? null,
      matches: summaries(decision, details.labels),
    };
  }

  async ingestManualOpportunity(input: {
    rawOpportunity: RawOpportunity;
    opportunity: NormalizedOpportunity;
    provenance: FieldProvenanceInput[];
    duplicateResolution: DuplicateResolutionChoice | null;
  }): Promise<{ opportunityId: string; deduplication: DeduplicationOutcome }> {
    return this.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${captureLockKey})::text`;
        // The raw capture is written first, exactly as submitted.
        const sourceRecord = await transaction.sourceRecord.create({
          data: this.sourceRecordData(input.rawOpportunity),
          select: { id: true },
        });
        const identity = captureIdentity(input.opportunity);
        const details = await findDuplicateCandidates(transaction, identity);
        const decision = decideDuplicates(identity, details.candidates);
        const matches = summaries(decision, details.labels);
        const now = new Date();

        if (decision.canonical && input.duplicateResolution !== "SEPARATE") {
          // Exact duplicate: keep the existing opportunity and add this
          // capture as another of its sources. Its fields, lifecycle,
          // evaluations and application are not changed.
          const canonical = decision.canonical;
          await transaction.$queryRaw`SELECT "id" FROM "Opportunity" WHERE "id" = ${canonical.opportunityId}::uuid FOR UPDATE`;
          await transaction.sourceRecord.update({
            where: { id: sourceRecord.id },
            data: {
              opportunityId: canonical.opportunityId,
              normalizedAt: now,
              duplicateDecision: "MATCH",
              duplicateEvidence: referenceEvidence(canonical, { confidence: canonical.confidence, decidedAt: now.toISOString() }),
            },
          });
          await transaction.$executeRaw`
            UPDATE "Opportunity" SET "lastSeenAt" = GREATEST("lastSeenAt", ${input.rawOpportunity.discoveredAt}::timestamptz)
            WHERE "id" = ${canonical.opportunityId}::uuid
          `;
          return {
            opportunityId: canonical.opportunityId,
            deduplication: {
              outcome: "ATTACHED" as const,
              decision: decision.decision,
              canonicalOpportunityId: canonical.opportunityId,
              matches,
            },
          };
        }

        const opportunityId = await this.createNormalizedOpportunity(transaction, {
          sourceRecordId: sourceRecord.id,
          opportunity: input.opportunity,
          provenance: input.provenance,
          normalizedAt: now,
        });

        // Relationships to record: an exact duplicate the user kept separate
        // (stored as DISTINCT, reversible) and the strongest probable matches.
        const recorded = [
          ...(decision.canonical ? [decision.canonical] : []),
          ...decision.matches.filter((match) => match.decision === "PROBABLE_MATCH").slice(0, recordedProbableMatches),
        ];
        for (const match of recorded) {
          const separate = match === decision.canonical;
          await transaction.duplicateReference.create({
            data: {
              ...orientPair({ opportunityId, firstSeenAt: input.opportunity.firstSeenAt }, match),
              decision: match.decision,
              confidence: match.confidence,
              evidence: referenceEvidence(match, { recordedBy: separate ? "CAPTURE_KEPT_SEPARATE" : "CAPTURE" }),
              ...(separate ? { resolution: "DISTINCT" as const, resolvedAt: now } : {}),
            },
          });
        }

        return {
          opportunityId,
          deduplication: {
            outcome: "CREATED" as const,
            decision: decision.decision,
            canonicalOpportunityId: decision.canonical?.opportunityId ?? null,
            matches,
          },
        };
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  }

  // Creates the opportunity in DISCOVERED, its field provenance and the
  // source link, then moves it to NORMALIZED, inside the caller's
  // transaction.
  private async createNormalizedOpportunity(
    transaction: Transaction,
    input: {
      sourceRecordId: string;
      opportunity: NormalizedOpportunity;
      provenance: FieldProvenanceInput[];
      normalizedAt: Date;
    },
  ): Promise<string> {
    const companyId = await resolveCompanyId(transaction, input.opportunity.companyName);
    const opportunity = await transaction.opportunity.create({
      data: {
        domain: input.opportunity.domain,
        externalListingId: input.opportunity.externalListingId,
        atsRequisitionId: input.opportunity.atsRequisitionId,
        canonicalUrl: input.opportunity.canonicalUrl,
        applicationUrl: input.opportunity.applicationUrl,
        originalSource: input.opportunity.originalSource,
        discoveredAt: input.opportunity.discoveredAt,
        sourceUpdatedAt: input.opportunity.sourceUpdatedAt,
        firstSeenAt: input.opportunity.firstSeenAt,
        lastSeenAt: input.opportunity.lastSeenAt,
        companyId,
        title: input.opportunity.title,
        department: input.opportunity.department,
        employmentType: input.opportunity.employmentType,
        seniority: input.opportunity.seniority,
        location: input.opportunity.location,
        remoteStatus: input.opportunity.remoteStatus,
        timeZoneRequirements: input.opportunity.timeZoneRequirements,
        residencyRequirement: input.opportunity.residencyRequirement ?? null,
        residencyRegions: input.opportunity.residencyRegions ?? [],
        salaryMin: input.opportunity.salaryMin,
        salaryMax: input.opportunity.salaryMax,
        salaryText: input.opportunity.salaryText,
        bonus: input.opportunity.bonus,
        equity: input.opportunity.equity,
        currency: input.opportunity.currency,
        compensationNotes: input.opportunity.compensationNotes,
        postingDate: input.opportunity.postingDate,
        closingDate: input.opportunity.closingDate,
        source: input.opportunity.source,
        sourceType: input.opportunity.sourceType,
        atsPlatform: input.opportunity.atsPlatform,
        jobDescription: input.opportunity.jobDescription,
        responsibilities: input.opportunity.responsibilities,
        requirements: input.opportunity.requirements,
        benefits: input.opportunity.benefits,
        additionalNotes: input.opportunity.additionalNotes,
        status: "DISCOVERED",
      },
      select: { id: true },
    });

    if (input.provenance.length > 0) {
      await transaction.fieldProvenance.createMany({
        data: input.provenance.map((provenance) => ({
          opportunityId: opportunity.id,
          sourceRecordId: input.sourceRecordId,
          fieldName: provenance.fieldName,
          sourceField: provenance.sourceField,
          kind: provenance.kind,
          normalizedValue: asInputJson(provenance.normalizedValue),
          sourceReference: provenance.sourceReference,
          sourceText: provenance.sourceText,
          collectedAt: provenance.collectedAt,
        })),
      });
    }

    await transaction.sourceRecord.update({
      where: { id: input.sourceRecordId },
      data: { opportunityId: opportunity.id, normalizedAt: input.normalizedAt },
    });

    const transitioned = await transaction.opportunity.updateMany({
      where: { id: opportunity.id, status: "DISCOVERED" },
      data: { status: "NORMALIZED" },
    });
    if (transitioned.count !== 1) {
      throw new Error("Opportunity lifecycle transition DISCOVERED -> NORMALIZED was rejected");
    }
    return opportunity.id;
  }

  private findRecord(id: string) {
    return this.database.opportunity.findUnique({
      where: { id },
      include: {
        company: true,
        sourceRecords: { orderBy: { createdAt: "asc" } },
        fieldProvenance: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async findOpportunityDetail(id: string) {
    const record = await this.findRecord(id);
    return record ? mapOpportunityDetail(record) : null;
  }
}
