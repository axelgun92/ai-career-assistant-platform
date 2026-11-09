import {
  applicationUrlBasisOf,
  listingPageFallbackSourceField,
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
import { beginCaptureTiming, type CaptureTimingHandle } from "./capture-timing";
import { namedTransaction } from "./transaction-diagnostics";
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
// Every transaction that takes the capture lock uses the same options
// (November 5, 2026: two of them ran on Prisma's 2 s / 5 s defaults while
// waiting on the same lock). The lock itself is waited for at most
// captureLockWaitMs, inside the transaction's timeout, so a busy lock is
// reported as such (SQLSTATE 55P03, lock_not_available) instead of as the
// transaction's own expiry (P2028).
const captureTransactionOptions = { maxWait: 15_000, timeout: 30_000 } as const;
const captureLockWaitMs = 20_000;
// The capture-lock transactions' limits, as the worker's diagnostics report
// them with a failure.
export const captureTransactionSettings = { ...captureTransactionOptions, lockTimeoutMs: captureLockWaitMs } as const;
async function takeCaptureLock(transaction: Transaction) {
  await transaction.$queryRaw`SELECT set_config('lock_timeout', ${`${captureLockWaitMs}ms`}, true)`;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${captureLockKey})::text`;
}
// P2028 fix F2 (approved November 9, 2026): once the capture lock is held,
// every later statement of the transaction is limited, so one stalled
// statement fails on its own (SQLSTATE 57014) before the whole transaction
// expires (P2028). Set only after the lock: the lock wait keeps its own
// lock_timeout and its contention meaning (55P03), and does not count. The
// limit is 10 s, or less when the transaction has less time left (2 s
// margin), never below 1 s. Transaction-local (set_config(…, true)): it ends
// with the transaction, whatever its outcome.
export const captureStatementTimeoutMs = 10_000;
const captureStatementMarginMs = 2_000;
export function captureStatementTimeoutFor(elapsedInTransactionMs: number): number {
  const remaining = captureTransactionOptions.timeout - elapsedInTransactionMs - captureStatementMarginMs;
  return Math.max(1_000, Math.min(captureStatementTimeoutMs, Math.floor(remaining)));
}
// The names of the transactions that take the capture lock (a 57014 is a
// capture statement timeout only from one of these).
export const captureLockTransactionNames = ["ingestManualOpportunity", "ingestRetrievedListing", "probeCaptureLock", "preserveUnnormalizedListing"] as const;
type CaptureLockTransactionName = (typeof captureLockTransactionNames)[number];

// One capture-lock transaction: its options, the capture lock, the
// statement timeout armed after the lock, per-step timing (F1; recorded only
// when the caller set a recorder) and, on failure, the transaction's name
// and the armed statement timeout attached to the error (no data).
async function captureLockTransaction<T>(
  database: ReturnType<typeof getDatabaseClient>,
  name: CaptureLockTransactionName,
  body: (transaction: Transaction, timing: CaptureTimingHandle) => Promise<T>,
): Promise<T> {
  const timing = beginCaptureTiming(name);
  let armedStatementTimeoutMs: number | null = null;
  try {
    const result = await namedTransaction(name, () =>
      database.$transaction(async (transaction) => {
        timing.bodyStarted();
        const bodyStartedAt = Date.now();
        await timing.step("capture-lock", () => takeCaptureLock(transaction));
        const statementTimeoutMs = captureStatementTimeoutFor(Date.now() - bodyStartedAt);
        await timing.step("statement-timeout", () => transaction.$queryRaw`SELECT set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)`);
        armedStatementTimeoutMs = statementTimeoutMs;
        timing.statementTimeout(statementTimeoutMs);
        const value = await body(transaction, timing);
        timing.bodyEnded();
        return value;
      }, captureTransactionOptions),
    );
    timing.settled("ok");
    return result;
  } catch (error) {
    timing.settled("error");
    if (error && typeof error === "object" && armedStatementTimeoutMs !== null) Object.assign(error, { captureStatementTimeoutMs: armedStatementTimeoutMs });
    throw error;
  }
}
// A capture transaction's failure names the transaction (logged by the
// worker; no data): see transaction-diagnostics.ts.
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
// A browser-extension read's own time, reader revision and completeness, as
// its capture metadata states them (null for any other source).
function extensionReadOf(raw: RawOpportunity): { at: string; readerRevision: number; readQuality: string | null } | null {
  if (raw.sourceType !== "BROWSER_EXTENSION") return null;
  const capture = raw.sourceMetadata?.capture as Record<string, unknown> | undefined;
  if (!capture || typeof capture !== "object") return null;
  const at = typeof capture.capturedAt === "string" && !Number.isNaN(Date.parse(capture.capturedAt)) ? capture.capturedAt : raw.discoveredAt.toISOString();
  return {
    at,
    readerRevision: typeof capture.readerRevision === "number" ? capture.readerRevision : 0,
    readQuality: typeof capture.readQuality === "string" ? capture.readQuality : null,
  };
}

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
  "timeZoneRequirements", "residencyRequirement", "residencyRegions", "residencyExclusions", "workAuthorizationRequirement",
  "workAuthorizationRegions", "visaSponsorship", "relocationSupport", "employerOfRecordRegions", "salaryText",
  "salaryMin", "salaryMax", "currency", "compensationBasis", "compensationTiers", "bonus", "postingDate", "closingDate", "jobDescription",
] as const;
type ProjectedField = (typeof projectedFields)[number];
// Facts that change together on a re-read (November 5, 2026): a salary is its
// bounds, currency, basis, tiers and text; an arrangement its status and
// options; residency its rule, places and exclusions; work authorization its
// rule and places. Any other field is a group of its own.
const projectionGroups: ReadonlyArray<readonly ProjectedField[]> = [
  ["salaryMin", "salaryMax", "currency", "compensationBasis", "compensationTiers", "salaryText"],
  ["remoteStatus", "workArrangements"],
  ["residencyRequirement", "residencyRegions", "residencyExclusions"],
  ["workAuthorizationRequirement", "workAuthorizationRegions"],
];

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
      residencyExclusions: record.residencyExclusions ?? [],
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

// Whether a saved fact already equals what the current normalization states
// (D1): compared as values, so a repeat re-read writes nothing. Amounts as
// numbers, dates by instant, lists and tiers by content, the company by its
// normalized name.
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))) : item,
  );
function sameFact(
  field: ProjectedField,
  saved: Prisma.OpportunityGetPayload<{ include: { company: { select: { name: true } } } }>,
  next: NormalizedOpportunity,
): boolean {
  const stated = next as unknown as Record<string, unknown>;
  switch (field) {
    case "company.name": {
      const left = saved.company?.name ?? null;
      const right = next.companyName ?? null;
      return left === right || (left !== null && right !== null && normalizeCompanyName(left) === normalizeCompanyName(right));
    }
    case "salaryMin":
    case "salaryMax":
      return (saved[field]?.toNumber() ?? null) === ((stated[field] as number | null | undefined) ?? null);
    case "postingDate":
    case "closingDate": {
      const right = stated[field] as Date | string | null | undefined;
      return (saved[field]?.getTime() ?? null) === (right ? new Date(right).getTime() : null);
    }
    case "compensationTiers":
      return canonicalJson(storedCompensationTiers(saved.compensationTiers)) === canonicalJson(next.compensationTiers ?? []);
    default: {
      const left = (saved as unknown as Record<string, unknown>)[field];
      const right = stated[field];
      if (Array.isArray(left) || Array.isArray(right)) return canonicalJson(left ?? []) === canonicalJson(right ?? []);
      return (left ?? null) === (right ?? null);
    }
  }
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
    return captureLockTransaction(this.database, "ingestManualOpportunity", async (transaction, timing) => {
      const captured = await this.capture(transaction, { ...input, recordedBy: "CAPTURE" }, timing);
      return { opportunityId: captured.opportunityId, deduplication: captured.deduplication };
    });
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
    return captureLockTransaction(this.database, "ingestRetrievedListing",
      async (transaction, timing) => {
        const previous = raw.externalId
          ? await timing.step("lookup", () => transaction.sourceRecord.findFirst({
              where: { source: raw.source, externalId: raw.externalId, opportunityId: { not: null }, contentHash: { not: null } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { id: true, opportunityId: true, contentHash: true },
            }))
          : null;
        if (previous?.opportunityId) {
          const opportunityId = previous.opportunityId;
          let sourceRecordId = previous.id;
          let normalizationCorrected: string[] = [];
          if (previous.contentHash === retrieval.contentHash) {
            await timing.step("last-observed", () => transaction.$executeRaw`
              UPDATE "SourceRecord" SET "lastObservedAt" = GREATEST("lastObservedAt", ${raw.discoveredAt}::timestamptz), "updatedAt" = now()
              WHERE "id" = ${previous.id}::uuid
            `);
            // A browser-extension read that found this same version records
            // when it read it, with which reader and how completely
            // ("lastRead", additive; the stored evidence is unchanged), so
            // selective re-observation does not read it again on every save
            // (November 6, 2026).
            const lastRead = extensionReadOf(raw);
            if (lastRead) {
              await timing.step("last-read", () => transaction.$executeRaw`
                UPDATE "SourceRecord" SET "sourceMetadata" = jsonb_set(COALESCE("sourceMetadata", '{}'::jsonb), '{lastRead}', ${JSON.stringify(lastRead)}::jsonb)
                WHERE "id" = ${previous.id}::uuid
              `);
              // D1 (approved November 8, 2026): a browser-extension re-read
              // (Single Capture or a Mode B refresh) of the listing that
              // created the opportunity is normalized again by the current
              // rules even though the posting is unchanged. Saved facts the
              // current reading of the same evidence states differently are
              // corrected, from the same source version (no new version),
              // under the same evidence rules as a changed posting: only
              // stated values, user corrections and other sources' evidence
              // kept, nothing cleared for not being read. Facts that already
              // agree are not written again, so a repeat re-read changes
              // nothing. Nothing is evaluated.
              const origin = await timing.step("origin", () => originatingVersion(transaction, opportunityId));
              if (origin && origin.origin.sourceType !== "MANUAL" && origin.origin.source === raw.source && origin.origin.externalId === raw.externalId && origin.currentId === previous.id) {
                normalizationCorrected = await timing.step("reprojection", () => this.reprojectCurrentFacts(transaction, {
                  opportunityId,
                  sourceRecordId: previous.id,
                  rawOpportunity: raw,
                  opportunity: input.opportunity,
                  provenance: input.provenance,
                  correction: true,
                }));
                if (await timing.step("application-link", () => this.reprojectApplicationLink(transaction, { opportunityId, sourceRecordId: previous.id, rawOpportunity: raw, originSource: origin.origin.source }))) {
                  normalizationCorrected.push("applicationUrl");
                }
                if (normalizationCorrected.length) {
                  // The correction event, on the version whose evidence it
                  // re-read (additive; the stored evidence is unchanged).
                  const event = { at: new Date().toISOString(), observedAt: raw.discoveredAt.toISOString(), readerRevision: lastRead.readerRevision, fields: normalizationCorrected };
                  await timing.step("correction-event", () => transaction.$executeRaw`
                    UPDATE "SourceRecord" SET "sourceMetadata" = jsonb_set(
                      "sourceMetadata", '{normalizationCorrections}',
                      COALESCE("sourceMetadata"->'normalizationCorrections', '[]'::jsonb) || ${JSON.stringify([event])}::jsonb
                    ), "normalizedAt" = now()
                    WHERE "id" = ${previous.id}::uuid
                  `);
                }
              }
            }
          } else {
            const created = await timing.step("source-version", () => transaction.sourceRecord.create({
              data: {
                ...this.sourceRecordData(raw),
                opportunityId,
                previousSourceRecordId: previous.id,
                normalizedAt: new Date(),
              },
              select: { id: true },
            }));
            sourceRecordId = created.id;
            // A newer version of the listing that created the opportunity
            // re-projects its current facts; a changed copy from another
            // source stays history only.
            const origin = await timing.step("origin", () => originatingVersion(transaction, opportunityId));
            if (origin && origin.origin.sourceType !== "MANUAL" && origin.origin.source === raw.source && origin.origin.externalId === raw.externalId) {
              await timing.step("reprojection", () => this.reprojectCurrentFacts(transaction, {
                opportunityId,
                sourceRecordId: created.id,
                rawOpportunity: raw,
                opportunity: input.opportunity,
                provenance: input.provenance,
              }));
              await timing.step("application-link", () => this.reprojectApplicationLink(transaction, { opportunityId, sourceRecordId: created.id, rawOpportunity: raw, originSource: origin.origin.source }));
            }
          }
          await timing.step("last-seen", () => transaction.$executeRaw`
            UPDATE "Opportunity" SET "lastSeenAt" = GREATEST("lastSeenAt", ${raw.discoveredAt}::timestamptz)
            WHERE "id" = ${opportunityId}::uuid
          `);
          return {
            outcome: previous.contentHash === retrieval.contentHash ? ("UNCHANGED" as const) : ("CHANGED" as const),
            opportunityId,
            sourceRecordId,
            decision: null,
            ...(normalizationCorrected.length ? { normalizationCorrected } : {}),
          };
        }

        const captured = await this.capture(transaction, { ...input, duplicateResolution: null, recordedBy: "RETRIEVAL" }, timing);
        if (captured.deduplication.outcome === "ATTACHED") {
          await timing.step("application-link", () => this.applyApplicationLinkPrecedence(transaction, {
            opportunityId: captured.opportunityId,
            sourceRecordId: captured.sourceRecordId,
            rawOpportunity: raw,
          }));
        }
        return {
          outcome: captured.deduplication.outcome,
          opportunityId: captured.opportunityId,
          sourceRecordId: captured.sourceRecordId,
          decision: captured.deduplication.decision,
        };
      },
    );
  }

  // The capture path's health, without capturing anything: one transaction
  // that takes the capture lock with the same options and commits. Used by
  // the Mode B worker to tell a job-specific failure from a database or lock
  // that is unavailable (November 5, 2026).
  async probeCaptureLock(): Promise<void> {
    await captureLockTransaction(this.database, "probeCaptureLock", async () => undefined);
  }

  // Keeps a retrieved listing whose normalization failed, unlinked. The
  // same unnormalized content seen again only moves its last-observed time.
  async preserveUnnormalizedListing(rawOpportunity: RawOpportunity) {
    const hash = rawOpportunity.retrieval?.contentHash ?? null;
    return captureLockTransaction(this.database, "preserveUnnormalizedListing", async (transaction) => {
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
    timing: CaptureTimingHandle,
  ): Promise<{ opportunityId: string; sourceRecordId: string; deduplication: DeduplicationOutcome }> {
    // The raw capture is written first, exactly as submitted.
    const sourceRecord = await timing.step("source-record", () => transaction.sourceRecord.create({
      data: this.sourceRecordData(input.rawOpportunity),
      select: { id: true },
    }));
    const identity = captureIdentity(input.opportunity);
    const details = await timing.step("candidates", () => findDuplicateCandidates(transaction, identity));
    const { decision, matches } = await timing.step("scoring", () => {
      const decided = decideDuplicates(identity, details.candidates);
      return { decision: decided, matches: summaries(decided, details.labels) };
    });
    const now = new Date();

    if (decision.canonical && input.duplicateResolution !== "SEPARATE") {
      // Exact duplicate: keep the existing opportunity and add this
      // capture as another of its sources. Its fields, lifecycle,
      // evaluations and application are not changed.
      const canonical = decision.canonical;
      await timing.step("attach", async () => {
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
      });
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
    }, timing);

    // Relationships to record: an exact duplicate the user kept separate
    // (stored as DISTINCT, reversible) and the strongest probable matches.
    const recorded = [
      ...(decision.canonical ? [decision.canonical] : []),
      ...decision.matches.filter((match) => match.decision === "PROBABLE_MATCH").slice(0, recordedProbableMatches),
    ];
    for (const match of recorded) {
      const separate = match === decision.canonical;
      await timing.step("duplicate-links", () => transaction.duplicateReference.create({
        data: {
          ...orientPair({ opportunityId, firstSeenAt: input.opportunity.firstSeenAt }, match),
          decision: match.decision,
          confidence: match.confidence,
          evidence: referenceEvidence(match, { recordedBy: separate ? "CAPTURE_KEPT_SEPARATE" : input.recordedBy }),
          ...(separate ? { resolution: "DISTINCT" as const, resolvedAt: now } : {}),
        },
      }));
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
          select: { sourceField: true, sourceRecord: { select: { sourceType: true, sourceCategory: true } } },
        })
      : null;
    const replace = shouldReplaceApplicationLink({
      currentUrl: opportunity.applicationUrl,
      currentIsManual: Boolean(opportunity.applicationUrl) && (!current?.sourceRecord || current.sourceRecord.sourceType === "MANUAL"),
      currentCategory: current?.sourceRecord?.sourceCategory ?? null,
      candidateUrl,
      candidateCategory,
      currentIsFallback: current?.sourceField === listingPageFallbackSourceField,
      candidateIsFallback: applicationUrlBasisOf(input.rawOpportunity.sourceMetadata) === "LISTING_PAGE_FALLBACK",
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
  ): Promise<boolean> {
    const opportunity = await transaction.opportunity.findUnique({ where: { id: input.opportunityId }, select: { applicationUrl: true } });
    if (!opportunity) return false;
    const next = input.rawOpportunity.applicationUrl;
    if (next === opportunity.applicationUrl) return false;
    // A browser-extension re-read that found no link never clears one (a
    // read can miss it); a LinkedIn-listing fallback never replaces a real
    // link (November 5, 2026).
    if (!next && input.rawOpportunity.sourceType === "BROWSER_EXTENSION") return false;
    const nextIsFallback = applicationUrlBasisOf(input.rawOpportunity.sourceMetadata) === "LISTING_PAGE_FALLBACK";
    if (opportunity.applicationUrl) {
      const current = await transaction.fieldProvenance.findFirst({
        where: { opportunityId: input.opportunityId, fieldName: "applicationUrl", supersededAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { sourceField: true, sourceRecord: { select: { source: true, sourceType: true } } },
      });
      if (!current?.sourceRecord || current.sourceRecord.sourceType === "MANUAL" || current.sourceRecord.source !== input.originSource) return false;
      if (nextIsFallback && current.sourceField !== listingPageFallbackSourceField) return false;
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
    return true;
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
      // D1: the same source version normalized again; only fact groups whose
      // value differs from the saved one are written, and a fact currently
      // backed by another source's evidence is kept.
      correction?: boolean;
    },
  ): Promise<string[]> {
    const current = await transaction.fieldProvenance.findMany({
      where: { opportunityId: input.opportunityId, supersededAt: null },
      select: { fieldName: true, sourceField: true, sourceRecord: { select: { source: true, externalId: true, sourceType: true } } },
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
    const next = input.opportunity;
    // Browser-extension re-reads (Mode A and B alike; November 5, 2026): a
    // read's completeness varies with rendering and timing, so only evidence
    // changes a saved fact. Per field group, a value the new read states
    // replaces the group; a group it does not state keeps its value and
    // provenance (a complete page alone is never evidence of withdrawal); a
    // group is cleared only on an explicit withdrawal the normalizer
    // recognized in the posting's own words ("explicit-withdrawal:<field>").
    // Groups change as a unit, never mixing old and new values. API sources
    // keep the earlier re-projection, which replaces every field.
    const evidenceOnly = input.rawOpportunity.sourceType === "BROWSER_EXTENSION";
    const withdrawn = new Set(input.provenance.filter((row) => row.sourceField.startsWith("explicit-withdrawal:")).map((row) => row.fieldName));
    const stated = (field: ProjectedField): boolean => {
      const value = field === "company.name" ? next.companyName : (next as Record<string, unknown>)[field];
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
    };
    const groupOf = (field: ProjectedField): readonly ProjectedField[] => projectionGroups.find((group) => group.includes(field)) ?? [field];
    // A salary replaces a saved one only as a complete statement: a range
    // with its currency, or tiers. A read that states only part of a salary
    // (a currency, a sentence with no amounts, amounts with no currency)
    // never overwrites saved amounts, currency, basis or tiers (November 6,
    // 2026); it may fill a salary group that holds no amounts yet.
    const salaryGroup = projectionGroups[0]!;
    const completeSalary = (((next.salaryMin ?? null) !== null || (next.salaryMax ?? null) !== null) && Boolean(next.currency)) || (next.compensationTiers?.length ?? 0) > 0;
    let keepSavedSalary = false;
    if (evidenceOnly && !completeSalary && !salaryGroup.some((member) => withdrawn.has(member)) && salaryGroup.some(stated)) {
      const saved = await transaction.opportunity.findUnique({
        where: { id: input.opportunityId },
        select: { salaryMin: true, salaryMax: true, compensationTiers: true },
      });
      keepSavedSalary = Boolean(saved && (saved.salaryMin !== null || saved.salaryMax !== null || (Array.isArray(saved.compensationTiers) && saved.compensationTiers.length > 0)));
    }
    let fields: ProjectedField[] = projectedFields.filter(
      (field) =>
        !protectedFields.has(field) &&
        !(keepSavedSalary && salaryGroup.includes(field)) &&
        (!evidenceOnly || groupOf(field).some(stated) || groupOf(field).some((member) => withdrawn.has(member))),
    );
    if (input.correction) {
      // Another source's evidence (a fact whose current provenance cites a
      // different listing) is never replaced by a re-reading of this one.
      const otherSource = new Set(
        current
          .filter((row) => row.sourceRecord && (row.sourceRecord.source !== input.rawOpportunity.source || row.sourceRecord.externalId !== input.rawOpportunity.externalId))
          .map((row) => row.fieldName),
      );
      const saved = await transaction.opportunity.findUnique({ where: { id: input.opportunityId }, include: { company: { select: { name: true } } } });
      if (!saved) return [];
      // A posting date computed from a stated age ("2 weeks ago") depends on
      // when the page was read, not on how it is read: a later re-read of the
      // same posting never corrects it (the first read's date stays).
      if (input.provenance.some((row) => row.fieldName === "postingDate" && row.sourceField.endsWith("relative-posted-age"))) otherSource.add("postingDate");
      const differs = (field: ProjectedField) => !sameFact(field, saved, next);
      fields = fields.filter((field) => !groupOf(field).some((member) => otherSource.has(member) || protectedFields.has(member)) && groupOf(field).some(differs));
    }
    if (!fields.length) return [];
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
      residencyExclusions: async () => ({ residencyExclusions: next.residencyExclusions ?? [] }),
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
    return [...fields];
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
    timing: CaptureTimingHandle,
  ): Promise<string> {
    const companyId = await timing.step("company", () => resolveCompanyId(transaction, input.opportunity.companyName));
    const opportunity = await timing.step("opportunity", () => transaction.opportunity.create({
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
        residencyExclusions: input.opportunity.residencyExclusions ?? [],
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
    }));

    if (input.provenance.length > 0) {
      await timing.step("provenance", () => transaction.fieldProvenance.createMany({
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
      }));
    }

    const transitioned = await timing.step("opportunity", async () => {
      await transaction.sourceRecord.update({
        where: { id: input.sourceRecordId },
        data: { opportunityId: opportunity.id, normalizedAt: input.normalizedAt },
      });
      return transaction.opportunity.updateMany({
        where: { id: opportunity.id, status: "DISCOVERED" },
        data: { status: "NORMALIZED" },
      });
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
        // First record first, by (createdAt, id) as originatingVersion ("Found via").
        sourceRecords: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { retrievalSource: { select: { name: true } } } },
        fieldProvenance: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async findOpportunityDetail(id: string) {
    const record = await this.findRecord(id);
    return record ? mapOpportunityDetail(record) : null;
  }
}
