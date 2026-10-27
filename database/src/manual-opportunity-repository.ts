import {
  applicationUrlBasisOf,
  applicationUrlProvenance,
  compensationBasisValues,
  compensationTierSchema,
  workArrangementValues,
  offerAvailabilityValues,
  residencyRequirementValues,
  shouldReplaceApplicationLink,
  workAuthorizationRequirementValues,
  type ResidencyRequirement,
} from "@ai-career/core";
import type {
  DeduplicationOutcome,
  DuplicateCheckResult,
  DuplicateResolutionChoice,
  FieldProvenanceInput,
  ManualOpportunityDetail,
  ManualOpportunityRepository,
  NormalizedOpportunity,
  RawOpportunity,
  RetrievalIngestionRepository,
  RetrievedListingResult,
} from "@ai-career/core";
import {
  decideDuplicates,
  normalizeCompanyName,
  scopedListingId,
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
    listingIds: [scopedListingId(opportunity.source, opportunity.sourceType, opportunity.externalListingId)],
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
    sourceRecords: { include: { retrievalSource: { select: { name: true } } } };
    fieldProvenance: true;
  };
}>;

// Stored values outside the vocabulary read as Unknown.
export function residencyRequirement(value: string | null): ResidencyRequirement | null {
  return (residencyRequirementValues as readonly string[]).includes(value ?? "") ? (value as ResidencyRequirement) : null;
}

const inVocabulary = <T extends string>(values: readonly T[], value: string | null): T | null =>
  (values as readonly string[]).includes(value ?? "") ? (value as T) : null;

// The stated work arrangements as stored, read back with values outside the
// vocabulary left out.
export function storedWorkArrangements(values: readonly string[]): Array<(typeof workArrangementValues)[number]> {
  return values.filter((value): value is (typeof workArrangementValues)[number] => (workArrangementValues as readonly string[]).includes(value));
}

// The labelled pay tiers as stored, read back; anything not in their shape
// reads as none.
export function storedCompensationTiers(value: unknown) {
  const parsed = compensationTierSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

// The compensation basis and work-authorization facts as stored, read back
// with values outside their vocabularies as Unknown.
export function storedEligibilityFacts(record: {
  compensationBasis: string | null;
  workAuthorizationRequirement: string | null;
  workAuthorizationRegions: string[];
  visaSponsorship: string | null;
  relocationSupport: string | null;
  employerOfRecordRegions: string[];
}) {
  return {
    compensationBasis: inVocabulary(compensationBasisValues, record.compensationBasis),
    workAuthorizationRequirement: inVocabulary(workAuthorizationRequirementValues, record.workAuthorizationRequirement),
    workAuthorizationRegions: record.workAuthorizationRegions,
    visaSponsorship: inVocabulary(offerAvailabilityValues, record.visaSponsorship),
    relocationSupport: inVocabulary(offerAvailabilityValues, record.relocationSupport),
    employerOfRecordRegions: record.employerOfRecordRegions,
  };
}

function provenanceView(provenance: OpportunityDetailRecord["fieldProvenance"][number]) {
  return {
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
  };
}

// The facts an opportunity's originating listing projects, by field
// provenance name: re-projected from each newer version of that listing
// (Core TDD §51, v1.15). Identity, links, lifecycle and first-seen facts are
// not part of it.
const projectedFields = [
  "title", "company.name", "location", "remoteStatus", "workArrangements", "employmentType", "seniority", "seniorityLabel", "department",
  "timeZoneRequirements", "residencyRequirement", "residencyRegions", "workAuthorizationRequirement",
  "workAuthorizationRegions", "visaSponsorship", "relocationSupport", "employerOfRecordRegions", "salaryText",
  "salaryMin", "salaryMax", "currency", "compensationBasis", "compensationTiers", "bonus", "postingDate", "closingDate", "jobDescription",
] as const;
type ProjectedField = (typeof projectedFields)[number];

// Fields the browser extension lets the user correct, by provenance name.
const userCorrectableFields: Record<string, ProjectedField> = {
  title: "title",
  company: "company.name",
  location: "location",
  description: "jobDescription",
};

// The source record that created an opportunity, and the current version of
// that listing: the latest record of the same source listing. A manual
// opportunity's own record, or one without a listing ID, is its own current
// version.
export async function originatingVersion(transaction: Transaction, opportunityId: string) {
  const origin = await transaction.sourceRecord.findFirst({
    where: { opportunityId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, source: true, sourceType: true, externalId: true },
  });
  if (!origin) return null;
  if (origin.sourceType === "MANUAL" || origin.externalId === null) return { origin, currentId: origin.id };
  const current = await transaction.sourceRecord.findFirst({
    where: { opportunityId, source: origin.source, externalId: origin.externalId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return { origin, currentId: current?.id ?? origin.id };
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
      seniorityLabel: record.seniorityLabel,
      location: record.location,
      remoteStatus: record.remoteStatus,
      workArrangements: storedWorkArrangements(record.workArrangements),
      timeZoneRequirements: record.timeZoneRequirements,
      residencyRequirement: residencyRequirement(record.residencyRequirement),
      residencyRegions: record.residencyRegions,
      ...storedEligibilityFacts(record),
      salaryMin: record.salaryMin?.toNumber() ?? null,
      salaryMax: record.salaryMax?.toNumber() ?? null,
      salaryText: record.salaryText,
      compensationTiers: storedCompensationTiers(record.compensationTiers),
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
      retrievalType: sourceRecord.retrievalType,
      sourceCategory: sourceRecord.sourceCategory,
      retrievalSourceId: sourceRecord.retrievalSourceId,
      retrievalSourceName: sourceRecord.retrievalSource?.name ?? null,
      retrievalRunId: sourceRecord.retrievalRunId,
      previousSourceRecordId: sourceRecord.previousSourceRecordId,
      discoveredAt: sourceRecord.discoveredAt,
      lastObservedAt: sourceRecord.lastObservedAt,
      normalizedAt: sourceRecord.normalizedAt,
      createdAt: sourceRecord.createdAt,
      updatedAt: sourceRecord.updatedAt,
    })),
    fieldProvenance: record.fieldProvenance.filter((provenance) => provenance.supersededAt === null).map(provenanceView),
    supersededProvenance: record.fieldProvenance
      .filter((provenance) => provenance.supersededAt !== null)
      .map((provenance) => ({ ...provenanceView(provenance), supersededAt: provenance.supersededAt! })),
  };
}

export class PrismaManualOpportunityRepository
  implements ManualOpportunityRepository, RetrievalIngestionRepository
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
      retrievalType: rawOpportunity.retrieval?.retrievalType ?? null,
      sourceCategory: rawOpportunity.retrieval?.sourceCategory ?? null,
      retrievalSourceId: rawOpportunity.retrieval?.retrievalSourceId ?? null,
      retrievalRunId: rawOpportunity.retrieval?.retrievalRunId ?? null,
      contentHash: rawOpportunity.retrieval?.contentHash ?? null,
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
        const captured = await this.capture(transaction, { ...input, recordedBy: "CAPTURE" });
        return { opportunityId: captured.opportunityId, deduplication: captured.deduplication };
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  }

  // One retrieved listing, in the same capture transaction and lock as a
  // manual capture. A listing already stored from the same source (same
  // source listing ID) is a re-observation: unchanged content only moves
  // last-seen times; changed content adds a new source record linked to the
  // previous one, and every earlier record stays as it was. When the changed
  // listing is the one that created the opportunity, its new version also
  // re-projects the opportunity's current facts (reprojectCurrentFacts); a
  // changed copy from another source stays history only. Anything else goes
  // through the deduplication path. (Until the Feature 14B closeout the
  // opportunity was always left unchanged.)
  async ingestRetrievedListing(input: {
    rawOpportunity: RawOpportunity;
    opportunity: NormalizedOpportunity;
    provenance: FieldProvenanceInput[];
  }): Promise<RetrievedListingResult> {
    const raw = input.rawOpportunity;
    const retrieval = raw.retrieval;
    if (!retrieval) throw new Error("A retrieved listing must carry retrieval provenance");
    return this.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${captureLockKey})::text`;
        const previous = raw.externalId
          ? await transaction.sourceRecord.findFirst({
              where: { source: raw.source, externalId: raw.externalId, opportunityId: { not: null }, contentHash: { not: null } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { id: true, opportunityId: true, contentHash: true },
            })
          : null;
        if (previous?.opportunityId) {
          const opportunityId = previous.opportunityId;
          let sourceRecordId = previous.id;
          if (previous.contentHash === retrieval.contentHash) {
            await transaction.$executeRaw`
              UPDATE "SourceRecord" SET "lastObservedAt" = GREATEST("lastObservedAt", ${raw.discoveredAt}::timestamptz), "updatedAt" = now()
              WHERE "id" = ${previous.id}::uuid
            `;
          } else {
            const created = await transaction.sourceRecord.create({
              data: {
                ...this.sourceRecordData(raw),
                opportunityId,
                previousSourceRecordId: previous.id,
                normalizedAt: new Date(),
              },
              select: { id: true },
            });
            sourceRecordId = created.id;
            // A newer version of the listing that created the opportunity
            // re-projects its current facts; a changed copy from another
            // source stays history only.
            const origin = await originatingVersion(transaction, opportunityId);
            if (origin && origin.origin.sourceType !== "MANUAL" && origin.origin.source === raw.source && origin.origin.externalId === raw.externalId) {
              await this.reprojectCurrentFacts(transaction, {
                opportunityId,
                sourceRecordId: created.id,
                rawOpportunity: raw,
                opportunity: input.opportunity,
                provenance: input.provenance,
              });
              await this.reprojectApplicationLink(transaction, { opportunityId, sourceRecordId: created.id, rawOpportunity: raw, originSource: origin.origin.source });
            }
          }
          await transaction.$executeRaw`
            UPDATE "Opportunity" SET "lastSeenAt" = GREATEST("lastSeenAt", ${raw.discoveredAt}::timestamptz)
            WHERE "id" = ${opportunityId}::uuid
          `;
          return {
            outcome: previous.contentHash === retrieval.contentHash ? ("UNCHANGED" as const) : ("CHANGED" as const),
            opportunityId,
            sourceRecordId,
            decision: null,
          };
        }

        const captured = await this.capture(transaction, { ...input, duplicateResolution: null, recordedBy: "RETRIEVAL" });
        if (captured.deduplication.outcome === "ATTACHED") {
          await this.applyApplicationLinkPrecedence(transaction, {
            opportunityId: captured.opportunityId,
            sourceRecordId: captured.sourceRecordId,
            rawOpportunity: raw,
          });
        }
        return {
          outcome: captured.deduplication.outcome,
          opportunityId: captured.opportunityId,
          sourceRecordId: captured.sourceRecordId,
          decision: captured.deduplication.decision,
        };
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  }

  // Keeps a retrieved listing whose normalization failed, unlinked. The
  // same unnormalized content seen again only moves its last-observed time.
  async preserveUnnormalizedListing(rawOpportunity: RawOpportunity) {
    const hash = rawOpportunity.retrieval?.contentHash ?? null;
    return this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${captureLockKey})::text`;
      const existing =
        hash && rawOpportunity.externalId
          ? await transaction.sourceRecord.findFirst({
              where: { source: rawOpportunity.source, externalId: rawOpportunity.externalId, contentHash: hash, opportunityId: null },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { id: true, discoveredAt: true },
            })
          : null;
      if (existing) {
        await transaction.$executeRaw`
          UPDATE "SourceRecord" SET "lastObservedAt" = GREATEST("lastObservedAt", ${rawOpportunity.discoveredAt}::timestamptz), "updatedAt" = now()
          WHERE "id" = ${existing.id}::uuid
        `;
        return existing;
      }
      return transaction.sourceRecord.create({
        data: this.sourceRecordData(rawOpportunity),
        select: { id: true, discoveredAt: true },
      });
    });
  }

  // The capture path shared by manual capture and retrieval, inside the
  // caller's transaction (which holds the capture lock): the raw
  // SourceRecord first, then the duplicate decision and either attachment
  // to the existing opportunity or a new NORMALIZED opportunity.
  private async capture(
    transaction: Transaction,
    input: {
      rawOpportunity: RawOpportunity;
      opportunity: NormalizedOpportunity;
      provenance: FieldProvenanceInput[];
      duplicateResolution: DuplicateResolutionChoice | null;
      recordedBy: "CAPTURE" | "RETRIEVAL";
    },
  ): Promise<{ opportunityId: string; sourceRecordId: string; deduplication: DeduplicationOutcome }> {
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
        sourceRecordId: sourceRecord.id,
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
          evidence: referenceEvidence(match, { recordedBy: separate ? "CAPTURE_KEPT_SEPARATE" : input.recordedBy }),
          ...(separate ? { resolution: "DISTINCT" as const, resolvedAt: now } : {}),
        },
      });
    }

    return {
      opportunityId,
      sourceRecordId: sourceRecord.id,
      deduplication: {
        outcome: "CREATED" as const,
        decision: decision.decision,
        canonicalOpportunityId: decision.canonical?.opportunityId ?? null,
        matches,
      },
    };
  }

  // Canonical application link (Core TDD §15): when a retrieved source is
  // attached, its application link replaces the current one only if the
  // source has strictly higher precedence (employer ATS/careers, then job
  // board/marketplace, then aggregator). The change is recorded as field
  // provenance. A link the user entered manually is never replaced, nor is
  // one whose origin is not recorded.
  private async applyApplicationLinkPrecedence(
    transaction: Transaction,
    input: { opportunityId: string; sourceRecordId: string; rawOpportunity: RawOpportunity },
  ) {
    const candidateUrl = input.rawOpportunity.applicationUrl;
    const candidateCategory = input.rawOpportunity.retrieval?.sourceCategory;
    if (!candidateUrl || !candidateCategory) return;
    const opportunity = await transaction.opportunity.findUnique({
      where: { id: input.opportunityId },
      select: { applicationUrl: true },
    });
    if (!opportunity) return;
    const current = opportunity.applicationUrl
      ? await transaction.fieldProvenance.findFirst({
          where: { opportunityId: input.opportunityId, fieldName: "applicationUrl" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { sourceRecord: { select: { sourceType: true, sourceCategory: true } } },
        })
      : null;
    const replace = shouldReplaceApplicationLink({
      currentUrl: opportunity.applicationUrl,
      currentIsManual: Boolean(opportunity.applicationUrl) && (!current?.sourceRecord || current.sourceRecord.sourceType === "MANUAL"),
      currentCategory: current?.sourceRecord?.sourceCategory ?? null,
      candidateUrl,
      candidateCategory,
    });
    if (!replace) return;
    await transaction.opportunity.update({
      where: { id: input.opportunityId },
      data: { applicationUrl: candidateUrl },
    });
    await transaction.fieldProvenance.updateMany({
      where: { opportunityId: input.opportunityId, fieldName: "applicationUrl", supersededAt: null },
      data: { supersededAt: new Date() },
    });
    await transaction.fieldProvenance.create({
      data: {
        opportunityId: input.opportunityId,
        sourceRecordId: input.sourceRecordId,
        fieldName: "applicationUrl",
        ...applicationUrlProvenance(applicationUrlBasisOf(input.rawOpportunity.sourceMetadata)),
        normalizedValue: candidateUrl,
        sourceReference: `retrieval:${input.rawOpportunity.source}`,
        sourceText: candidateUrl,
        collectedAt: input.rawOpportunity.discoveredAt,
      },
    });
  }

  // The application link of a changed originating listing: its newest
  // version's link (or its absence) becomes current only when the current
  // link came from that listing, or there is none. A link the user entered,
  // or one from a higher-precedence attached source, is kept.
  private async reprojectApplicationLink(
    transaction: Transaction,
    input: { opportunityId: string; sourceRecordId: string; rawOpportunity: RawOpportunity; originSource: string },
  ) {
    const opportunity = await transaction.opportunity.findUnique({ where: { id: input.opportunityId }, select: { applicationUrl: true } });
    if (!opportunity) return;
    const next = input.rawOpportunity.applicationUrl;
    if (next === opportunity.applicationUrl) return;
    if (opportunity.applicationUrl) {
      const current = await transaction.fieldProvenance.findFirst({
        where: { opportunityId: input.opportunityId, fieldName: "applicationUrl", supersededAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { sourceRecord: { select: { source: true, sourceType: true } } },
      });
      if (!current?.sourceRecord || current.sourceRecord.sourceType === "MANUAL" || current.sourceRecord.source !== input.originSource) return;
    }
    await transaction.opportunity.update({ where: { id: input.opportunityId }, data: { applicationUrl: next } });
    await transaction.fieldProvenance.updateMany({
      where: { opportunityId: input.opportunityId, fieldName: "applicationUrl", supersededAt: null },
      data: { supersededAt: new Date() },
    });
    if (next) {
      await transaction.fieldProvenance.create({
        data: {
          opportunityId: input.opportunityId,
          sourceRecordId: input.sourceRecordId,
          fieldName: "applicationUrl",
          ...applicationUrlProvenance(applicationUrlBasisOf(input.rawOpportunity.sourceMetadata)),
          normalizedValue: next,
          sourceReference: `retrieval:${input.rawOpportunity.source}`,
          sourceText: next,
          collectedAt: input.rawOpportunity.discoveredAt,
        },
      });
    }
  }

  // Current-version projection (Core TDD §51, v1.15): the newest version of
  // the opportunity's originating listing, normalized by the shared
  // normalizer, becomes the opportunity's current source-derived facts. For
  // every projected field the current provenance is marked superseded (never
  // deleted, so earlier evaluations' evidence keeps its references) and the
  // new version's provenance becomes current; a fact the new version no
  // longer supports becomes Unknown. A value the user corrected stays, with
  // its provenance, unless this capture is itself the user's change to it.
  // Lifecycle, links, identity and first-seen facts are untouched, and
  // nothing is evaluated.
  private async reprojectCurrentFacts(
    transaction: Transaction,
    input: {
      opportunityId: string;
      sourceRecordId: string;
      rawOpportunity: RawOpportunity;
      opportunity: NormalizedOpportunity;
      provenance: FieldProvenanceInput[];
    },
  ) {
    const current = await transaction.fieldProvenance.findMany({
      where: { opportunityId: input.opportunityId, supersededAt: null },
      select: { fieldName: true, sourceField: true },
    });
    const correctedNow = new Set(
      (Array.isArray(input.rawOpportunity.sourceMetadata?.userCorrectedFields) ? input.rawOpportunity.sourceMetadata!.userCorrectedFields : [])
        .map((field) => userCorrectableFields[String(field)])
        .filter(Boolean),
    );
    const protectedFields = new Set(
      current
        .filter((row) => row.sourceField.startsWith("userCorrected:") && !correctedNow.has(row.fieldName as ProjectedField))
        .map((row) => row.fieldName),
    );
    const fields = projectedFields.filter((field) => !protectedFields.has(field));
    if (!fields.length) return;
    const next = input.opportunity;
    const values: Record<ProjectedField, () => Promise<Prisma.OpportunityUpdateInput>> = {
      title: async () => ({ title: next.title }),
      "company.name": async () => {
        const companyId = await resolveCompanyId(transaction, next.companyName);
        return { company: companyId ? { connect: { id: companyId } } : { disconnect: true } };
      },
      location: async () => ({ location: next.location }),
      remoteStatus: async () => ({ remoteStatus: next.remoteStatus }),
      workArrangements: async () => ({ workArrangements: next.workArrangements ?? [] }),
      employmentType: async () => ({ employmentType: next.employmentType }),
      seniority: async () => ({ seniority: next.seniority }),
      seniorityLabel: async () => ({ seniorityLabel: next.seniorityLabel ?? null }),
      department: async () => ({ department: next.department }),
      timeZoneRequirements: async () => ({ timeZoneRequirements: next.timeZoneRequirements }),
      residencyRequirement: async () => ({ residencyRequirement: next.residencyRequirement ?? null }),
      residencyRegions: async () => ({ residencyRegions: next.residencyRegions ?? [] }),
      workAuthorizationRequirement: async () => ({ workAuthorizationRequirement: next.workAuthorizationRequirement ?? null }),
      workAuthorizationRegions: async () => ({ workAuthorizationRegions: next.workAuthorizationRegions ?? [] }),
      visaSponsorship: async () => ({ visaSponsorship: next.visaSponsorship ?? null }),
      relocationSupport: async () => ({ relocationSupport: next.relocationSupport ?? null }),
      employerOfRecordRegions: async () => ({ employerOfRecordRegions: next.employerOfRecordRegions ?? [] }),
      compensationBasis: async () => ({ compensationBasis: next.compensationBasis ?? null }),
      compensationTiers: async () => ({ compensationTiers: asInputJson(next.compensationTiers ?? []) }),
      bonus: async () => ({ bonus: next.bonus }),
      salaryText: async () => ({ salaryText: next.salaryText }),
      salaryMin: async () => ({ salaryMin: next.salaryMin }),
      salaryMax: async () => ({ salaryMax: next.salaryMax }),
      currency: async () => ({ currency: next.currency }),
      postingDate: async () => ({ postingDate: next.postingDate }),
      closingDate: async () => ({ closingDate: next.closingDate }),
      jobDescription: async () => ({ jobDescription: next.jobDescription }),
    };
    let data: Prisma.OpportunityUpdateInput = {};
    for (const field of fields) data = { ...data, ...(await values[field]()) };
    await transaction.opportunity.update({ where: { id: input.opportunityId }, data });
    await transaction.fieldProvenance.updateMany({
      where: { opportunityId: input.opportunityId, fieldName: { in: [...fields] }, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    const rows = input.provenance.filter((row) => (fields as readonly string[]).includes(row.fieldName));
    if (rows.length) {
      await transaction.fieldProvenance.createMany({
        data: rows.map((provenance) => ({
          opportunityId: input.opportunityId,
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
        seniorityLabel: input.opportunity.seniorityLabel ?? null,
        location: input.opportunity.location,
        remoteStatus: input.opportunity.remoteStatus,
        workArrangements: input.opportunity.workArrangements ?? [],
        timeZoneRequirements: input.opportunity.timeZoneRequirements,
        residencyRequirement: input.opportunity.residencyRequirement ?? null,
        residencyRegions: input.opportunity.residencyRegions ?? [],
        workAuthorizationRequirement: input.opportunity.workAuthorizationRequirement ?? null,
        workAuthorizationRegions: input.opportunity.workAuthorizationRegions ?? [],
        visaSponsorship: input.opportunity.visaSponsorship ?? null,
        relocationSupport: input.opportunity.relocationSupport ?? null,
        employerOfRecordRegions: input.opportunity.employerOfRecordRegions ?? [],
        compensationBasis: input.opportunity.compensationBasis ?? null,
        compensationTiers: asInputJson(input.opportunity.compensationTiers ?? []),
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
        sourceRecords: { orderBy: { createdAt: "asc" }, include: { retrievalSource: { select: { name: true } } } },
        fieldProvenance: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async findOpportunityDetail(id: string) {
    const record = await this.findRecord(id);
    return record ? mapOpportunityDetail(record) : null;
  }
}
