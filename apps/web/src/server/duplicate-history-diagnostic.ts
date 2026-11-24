import { normalizationCorrectionsOf, readLocationGeography, type NormalizedOpportunity } from "@ai-career/core";
import {
  opportunityIdentity,
  readOnlyTransaction,
  readStoredSourceVersion,
  type createReadOnlyDatabaseClient,
} from "@ai-career/database";
import {
  compareListings,
  listingIdKey,
  listingIdScope,
  listingUrlKey,
  normalizeCompanyName,
  scopedListingId,
  textTokens,
  type DuplicateCandidate,
  type DuplicateMatch,
} from "@ai-career/deduplication";
import { htmlToText } from "@ai-career/normalization";
import { renormalizeStoredSourceVersion } from "./source-version-check";

// Historical duplicate investigation (November 24, 2026; read-only). Every
// stored DuplicateReference (MATCH and PROBABLE_MATCH; NO_MATCH rows only
// counted) is examined pair by pair from what is stored:
// - both opportunities' facts, identifiers from every source record, capture
//   history (versions, sites, reader revisions, read quality, normalization
//   corrections) and the documented change period each capture falls in;
// - the reference's own stored evidence (the engine version that recorded
//   it, matched and conflicting facts, similarity);
// - independent comparisons: shared or conflicting listing/requisition IDs
//   and URLs, company and title spelling, location, salary, employment type,
//   and the overlap of the stored job descriptions (word 5-shingles);
// - the current engine's verdict on the stored identities, and on each
//   side's stored evidence re-normalized in memory (the acceptance
//   source-version check).
// Each pair gets one of five classes by documented, identifier-first rules
// (never by the PROBABLE_MATCH label or a similarity threshold alone), with
// the evidence behind it; unresolved pairs name the evidence that is missing.
// Nothing is written, merged, re-normalized into the database or fetched.

export type PairClass = "CONFIRMED_SAME_POSTING" | "LIKELY_SAME_POSTING" | "CONFIRMED_DISTINCT" | "LIKELY_DISTINCT" | "STILL_UNRESOLVED";

// Documented change dates (CHANGELOG.md headings), used only to place a
// capture in a period. A checkout may have received a change later.
export const documentedChanges: Array<{ day: string; label: string }> = [
  { day: "2026-10-17", label: "Deduplication core-dedup-v1 (Features 1-10 gap closure)" },
  { day: "2026-10-18", label: "Feature 11A/11B retrieval; deduplication core-dedup-v2 (source-scoped listing IDs)" },
  { day: "2026-10-19", label: "Feature 14A LinkedIn browser-assisted retrieval" },
  { day: "2026-10-20", label: "Feature 14B browser-extension companion" },
  { day: "2026-10-23", label: "14B shared job-text fallback; current-version projection" },
  { day: "2026-10-25", label: "14B shared-normalization convergence" },
  { day: "2026-10-26", label: "14B cross-source correction (6536ef8)" },
  { day: "2026-10-27", label: "14B final cross-source batch; currency symbols" },
  { day: "2026-10-29", label: "14B live acceptance batch and round 2" },
  { day: "2026-11-03", label: "Mode B bounded results-page ingestion" },
  { day: "2026-11-04", label: "Mode B LinkedIn enabled; WTTJ P2" },
  { day: "2026-11-05", label: "Capture correctness; overlapping captures; triage at save" },
  { day: "2026-11-06", label: "Mode B live-round fixes; Rev 3" },
  { day: "2026-11-08", label: "LinkedIn Option A; D1 salary and capture parity" },
  { day: "2026-11-09", label: "LinkedIn P2028 fixes; diagnostic corrections" },
  { day: "2026-11-15", label: "Normalization fixes F1-F7; continuous Mode B" },
  { day: "2026-11-18", label: "Mode B acceptance follow-up" },
  { day: "2026-11-22", label: "Target job titles; opportunity management" },
];

export function periodOf(at: Date): string {
  const day = at.toISOString().slice(0, 10);
  const last = [...documentedChanges].reverse().find((change) => change.day <= day);
  return last ? `after ${last.day} (${last.label})` : "before 2026-10-17";
}

export interface HistoryVersion {
  id: string;
  source: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  applicationUrl: string | null;
  externalId: string | null;
  requisitionId: string | null;
  createdAt: Date;
  lastObservedAt: Date;
  site: string | null;
  method: string | null;
  readQuality: string | null;
  readerRevision: number | null;
  corrections: number;
  descriptionCharacters: number;
  isChangedVersion: boolean;
}

export interface HistorySide {
  id: string;
  title: string | null;
  company: string | null;
  status: string;
  source: string | null;
  sourceType: string | null;
  firstSeenAt: Date;
  canonicalUrl: string | null;
  applicationUrl: string | null;
  externalListingId: string | null;
  atsRequisitionId: string | null;
  location: string | null;
  residencyRegions: string[];
  workArrangements: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  employmentType: string | null;
  postingDate: Date | null;
  triage: string | null;
  evaluations: number;
  hasApplication: boolean;
  description: string;
  versions: HistoryVersion[];
  // The engine identity from the stored facts and every source record, and
  // from the facts version's evidence re-normalized now.
  identity: DuplicateCandidate | null;
  renormalizedIdentity: DuplicateCandidate | null;
}

export interface HistoryReference {
  id: string;
  decision: string;
  confidence: number | null;
  resolution: string | null;
  createdAt: Date;
  evidence: Record<string, unknown> | null;
  later: string;
  earlier: string;
}

type ReadOnlyClient = ReturnType<typeof createReadOnlyDatabaseClient>;

const decimal = (value: unknown): number | null => (value === null || value === undefined ? null : Number(String(value)));
const plain = (value: string | null | undefined): string => (value ? (/<[a-z][\s\S]*>/i.test(value) ? htmlToText(value) ?? "" : value) : "");

// Every stored reference and both sides' stored history, in read-only
// transactions; the in-memory re-normalization reads nothing more.
export async function readDuplicateHistory(
  client: ReadOnlyClient,
  options: { limitTo?: ReadonlySet<string> } = {},
): Promise<{ references: HistoryReference[]; noMatchReferences: number; sides: Map<string, HistorySide> }> {
  const { references, noMatchReferences } = await readOnlyTransaction(client, async (transaction) => {
    const rows = await transaction.duplicateReference.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, opportunityId: true, relatedOpportunityId: true, decision: true, confidence: true, resolution: true, createdAt: true, evidence: true },
    });
    const mine = rows.filter((row) => !options.limitTo || (options.limitTo.has(row.opportunityId) && options.limitTo.has(row.relatedOpportunityId)));
    return {
      noMatchReferences: mine.filter((row) => row.decision === "NO_MATCH").length,
      references: mine
        .filter((row) => row.decision !== "NO_MATCH")
        .map((row): HistoryReference => ({
          id: row.id,
          decision: row.decision,
          confidence: decimal(row.confidence),
          resolution: row.resolution,
          createdAt: row.createdAt,
          evidence: row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence) ? (row.evidence as Record<string, unknown>) : null,
          later: row.opportunityId,
          earlier: row.relatedOpportunityId,
        })),
    };
  });
  const ids = [...new Set(references.flatMap((reference) => [reference.later, reference.earlier]))];
  const sides = new Map<string, HistorySide>();
  for (const id of ids) {
    const side = await readOnlyTransaction(client, async (transaction) => {
      const opportunity = await transaction.opportunity.findUnique({
        where: { id },
        select: {
          id: true, title: true, status: true, source: true, sourceType: true, firstSeenAt: true, canonicalUrl: true, applicationUrl: true,
          externalListingId: true, atsRequisitionId: true, location: true, residencyRegions: true, workArrangements: true, salaryMin: true,
          salaryMax: true, currency: true, employmentType: true, postingDate: true, jobDescription: true,
          company: { select: { name: true } },
          preEvaluatorTriage: { select: { outcome: true, manualDecision: true } },
          application: { select: { id: true } },
          _count: { select: { evaluations: true } },
        },
      });
      if (!opportunity) return null;
      const records = await transaction.sourceRecord.findMany({
        where: { opportunityId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, source: true, sourceType: true, sourceUrl: true, applicationUrl: true, externalId: true, requisitionId: true, createdAt: true,
          lastObservedAt: true, sourceMetadata: true, rawDescription: true, previousSourceRecordId: true,
        },
      });
      const identity = await opportunityIdentity(transaction, id);
      const capture = (metadata: unknown) => {
        const value = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).capture : null;
        return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      };
      return {
        id,
        title: opportunity.title,
        company: opportunity.company?.name ?? null,
        status: opportunity.status,
        source: opportunity.source,
        sourceType: opportunity.sourceType,
        firstSeenAt: opportunity.firstSeenAt,
        canonicalUrl: opportunity.canonicalUrl,
        applicationUrl: opportunity.applicationUrl,
        externalListingId: opportunity.externalListingId,
        atsRequisitionId: opportunity.atsRequisitionId,
        location: opportunity.location,
        residencyRegions: opportunity.residencyRegions,
        workArrangements: opportunity.workArrangements,
        salaryMin: decimal(opportunity.salaryMin),
        salaryMax: decimal(opportunity.salaryMax),
        currency: opportunity.currency,
        employmentType: opportunity.employmentType,
        postingDate: opportunity.postingDate,
        triage: opportunity.preEvaluatorTriage ? (opportunity.preEvaluatorTriage.manualDecision ?? opportunity.preEvaluatorTriage.outcome) : null,
        evaluations: opportunity._count.evaluations,
        hasApplication: opportunity.application !== null,
        description: plain(opportunity.jobDescription),
        versions: records.map((record): HistoryVersion => {
          const meta = capture(record.sourceMetadata);
          return {
            id: record.id,
            source: record.source,
            sourceType: record.sourceType,
            sourceUrl: record.sourceUrl,
            applicationUrl: record.applicationUrl,
            externalId: record.externalId,
            requisitionId: record.requisitionId,
            createdAt: record.createdAt,
            lastObservedAt: record.lastObservedAt,
            site: typeof meta.site === "string" ? meta.site : null,
            method: typeof meta.method === "string" ? meta.method : null,
            readQuality: typeof meta.readQuality === "string" ? meta.readQuality : null,
            readerRevision: typeof meta.readerRevision === "number" ? meta.readerRevision : null,
            corrections: (normalizationCorrectionsOf(record.sourceMetadata) ?? []).length,
            descriptionCharacters: plain(record.rawDescription).length,
            isChangedVersion: record.previousSourceRecordId !== null,
          };
        }),
        identity,
        renormalizedIdentity: null as DuplicateCandidate | null,
      } satisfies HistorySide;
    });
    if (!side) continue;
    // The facts version's stored evidence through the current normalization.
    try {
      const read = await readStoredSourceVersion(client, { opportunityId: id });
      const factsVersion = read?.currentFactsVersionId && read.currentFactsVersionId !== read.version.id
        ? await readStoredSourceVersion(client, { sourceRecordId: read.currentFactsVersionId })
        : read;
      if (factsVersion && side.identity) {
        const { opportunity } = await renormalizeStoredSourceVersion(factsVersion.version);
        side.renormalizedIdentity = renormalizedIdentity(opportunity, side.identity);
      }
    } catch {
      side.renormalizedIdentity = null;
    }
    sides.set(id, side);
  }
  return { references, noMatchReferences, sides };
}

// The identity the current pipeline would build from the re-normalized
// facts, with every stored source record's identifiers kept.
function renormalizedIdentity(opportunity: NormalizedOpportunity, stored: DuplicateCandidate): DuplicateCandidate {
  return {
    ...stored,
    companyName: opportunity.companyName ?? stored.companyName,
    title: opportunity.title ?? stored.title,
    location: opportunity.location ?? stored.location,
    description: opportunity.jobDescription ?? stored.description,
    urls: [opportunity.canonicalUrl, opportunity.applicationUrl, ...stored.urls],
    listingIds: [scopedListingId(opportunity.source, opportunity.sourceType, opportunity.externalListingId), ...stored.listingIds],
    requisitionIds: [opportunity.atsRequisitionId, ...stored.requisitionIds],
    salaryMin: decimal(opportunity.salaryMin),
    salaryMax: decimal(opportunity.salaryMax),
    currency: opportunity.currency ?? null,
  };
}

// ---------------------------------------------------------------- comparison

const shingles = (text: string, size = 5) => {
  const words = textTokens(text);
  const set = new Set<string>();
  for (let index = 0; index + size <= words.length; index += 1) set.add(words.slice(index, index + size).join(" "));
  return set;
};

export function descriptionOverlap(left: string, right: string): { jaccard: number; containment: number } | null {
  const a = shingles(left);
  const b = shingles(right);
  if (!a.size || !b.size) return null;
  const shared = [...a].filter((value) => b.has(value)).length;
  const round = (value: number) => Math.round(value * 100) / 100;
  return { jaccard: round(shared / (a.size + b.size - shared)), containment: round(shared / Math.min(a.size, b.size)) };
}

const seniorityWords = new Set(["senior", "sr", "junior", "jr", "lead", "principal", "staff", "associate", "head", "director", "vp", "vice", "president", "chief", "intern", "i", "ii", "iii", "iv", "1", "2", "3", "4", "entry", "mid", "level"]);

// Minimum description length (characters) for a description to show what a
// posting says or omits.
export const completeDescriptionCharacters = 400;

const keys = (values: readonly (string | null)[], key: (value: string | null) => string | null) =>
  new Set(values.map(key).filter((value): value is string => value !== null));
const intersect = (left: Set<string>, right: Set<string>) => [...left].filter((value) => right.has(value)).sort();

export interface PairComparison {
  sameCompany: boolean;
  companySpelling: "IDENTICAL" | "NORMALIZED_EQUAL" | "DIFFERENT" | "UNKNOWN";
  title: "IDENTICAL" | "NORMALIZED_EQUAL" | "SENIORITY_DIFFERS" | "DIFFERENT" | "UNKNOWN";
  titleSimilarity: number;
  sharedUrls: string[];
  sharedListingIds: string[];
  sharedRequisitionIds: string[];
  conflictingListingIds: boolean;
  conflictingRequisitionIds: boolean;
  location: "SAME" | "COMPATIBLE" | "DIFFERS" | "ONE_MISSING" | "BOTH_MISSING";
  salary: "SAME" | "OVERLAP" | "CONFLICT" | "ONE_MISSING" | "BOTH_MISSING";
  employmentType: "SAME" | "DIFFERS" | "ONE_MISSING" | "BOTH_MISSING";
  description: { jaccard: number; containment: number } | null;
  descriptionCharacters: [number, number];
  incomplete: Array<"later" | "earlier">;
  daysApart: number;
  sameSite: boolean;
  complementary: string[];
  currentEngine: { decision: string; matchedOn: string[]; conflicts: string[] } | null;
  currentPipeline: { decision: string; matchedOn: string[]; conflicts: string[] } | null;
}

const tokenSet = (value: string | null) => new Set(textTokens(value));
const regionsOf = (side: HistorySide) =>
  new Set(side.residencyRegions.length ? side.residencyRegions : readLocationGeography(side.location).codes);

function verdict(match: DuplicateMatch | null) {
  return match ? { decision: match.decision, matchedOn: match.evidence.matchedOn, conflicts: match.evidence.conflicts } : { decision: "NO_MATCH", matchedOn: [], conflicts: [] };
}

export function comparePair(later: HistorySide, earlier: HistorySide): PairComparison {
  const companyA = normalizeCompanyName(later.company);
  const companyB = normalizeCompanyName(earlier.company);
  const titleA = textTokens(later.title);
  const titleB = textTokens(earlier.title);
  const titleDifference = [...titleA.filter((word) => !titleB.includes(word)), ...titleB.filter((word) => !titleA.includes(word))];
  const titleUnion = new Set([...titleA, ...titleB]);
  const titleSimilarity = titleUnion.size ? Math.round(((titleA.filter((word) => titleB.includes(word)).length) / titleUnion.size) * 100) / 100 : 0;
  const urlsA = keys([later.canonicalUrl, later.applicationUrl, ...later.versions.flatMap((v) => [v.sourceUrl, v.applicationUrl])], listingUrlKey);
  const urlsB = keys([earlier.canonicalUrl, earlier.applicationUrl, ...earlier.versions.flatMap((v) => [v.sourceUrl, v.applicationUrl])], listingUrlKey);
  const listingA = keys([scopedListingId(later.source, later.sourceType, later.externalListingId), ...later.versions.map((v) => scopedListingId(v.source, v.sourceType, v.externalId))], listingIdKey);
  const listingB = keys([scopedListingId(earlier.source, earlier.sourceType, earlier.externalListingId), ...earlier.versions.map((v) => scopedListingId(v.source, v.sourceType, v.externalId))], listingIdKey);
  const requisitionA = keys([later.atsRequisitionId, ...later.versions.map((v) => v.requisitionId)], listingIdKey);
  const requisitionB = keys([earlier.atsRequisitionId, ...earlier.versions.map((v) => v.requisitionId)], listingIdKey);
  const sharedListingIds = intersect(listingA, listingB);
  const sharedRequisitionIds = intersect(requisitionA, requisitionB);
  const scopesB = new Set([...listingB].map(listingIdScope));
  const sameCompany = companyA !== null && companyA === companyB;
  const regionsA = regionsOf(later);
  const regionsB = regionsOf(earlier);
  const location: PairComparison["location"] = !later.location && !earlier.location ? "BOTH_MISSING"
    : !later.location || !earlier.location ? "ONE_MISSING"
    : [...tokenSet(later.location)].join(" ") === [...tokenSet(earlier.location)].join(" ") ? "SAME"
    : regionsA.size && regionsB.size && !intersect(regionsA, regionsB).length ? "DIFFERS"
    : regionsA.size && regionsB.size ? "COMPATIBLE"
    : "DIFFERS";
  const low = (side: HistorySide) => side.salaryMin ?? side.salaryMax;
  const high = (side: HistorySide) => side.salaryMax ?? side.salaryMin;
  const salaryKnown = (side: HistorySide) => low(side) !== null && side.currency !== null;
  const salary: PairComparison["salary"] = !salaryKnown(later) && !salaryKnown(earlier) ? "BOTH_MISSING"
    : !salaryKnown(later) || !salaryKnown(earlier) ? "ONE_MISSING"
    : later.currency !== earlier.currency ? "CONFLICT"
    : low(later) === low(earlier) && high(later) === high(earlier) ? "SAME"
    : high(later)! < low(earlier)! || high(earlier)! < low(later)! ? "CONFLICT"
    : "OVERLAP";
  const employmentType: PairComparison["employmentType"] = !later.employmentType && !earlier.employmentType ? "BOTH_MISSING"
    : !later.employmentType || !earlier.employmentType ? "ONE_MISSING"
    : later.employmentType === earlier.employmentType ? "SAME" : "DIFFERS";
  const bestText = (side: HistorySide) => side.description;
  const description = descriptionOverlap(bestText(later), bestText(earlier));
  const incomplete: PairComparison["incomplete"] = [];
  // Too short to show what the posting says or omits. (A partial browser
  // read lacks page context, not necessarily text; each version's read
  // quality is listed in the pair detail.)
  if (later.description.length < completeDescriptionCharacters) incomplete.push("later");
  if (earlier.description.length < completeDescriptionCharacters) incomplete.push("earlier");
  const sites = (side: HistorySide) => new Set(side.versions.map((v) => v.site ?? v.source));
  const complementary: string[] = [];
  const has = (label: string, a: boolean, b: boolean) => {
    if (a !== b) complementary.push(`${label}: only the ${a ? "later" : "earlier"} copy`);
  };
  has("salary", salaryKnown(later), salaryKnown(earlier));
  has("location", Boolean(later.location), Boolean(earlier.location));
  has("residency regions", later.residencyRegions.length > 0, earlier.residencyRegions.length > 0);
  has("work arrangement", later.workArrangements.length > 0, earlier.workArrangements.length > 0);
  has("employment type", Boolean(later.employmentType), Boolean(earlier.employmentType));
  has("requisition ID", requisitionA.size > 0, requisitionB.size > 0);
  has("application URL", Boolean(later.applicationUrl), Boolean(earlier.applicationUrl));
  has(`complete description (${completeDescriptionCharacters}+ characters)`, !incomplete.includes("later"), !incomplete.includes("earlier"));
  return {
    sameCompany,
    companySpelling: !later.company || !earlier.company ? "UNKNOWN" : later.company === earlier.company ? "IDENTICAL" : sameCompany ? "NORMALIZED_EQUAL" : "DIFFERENT",
    title: !titleA.length || !titleB.length ? "UNKNOWN"
      : later.title === earlier.title ? "IDENTICAL"
      : titleDifference.length === 0 ? "NORMALIZED_EQUAL"
      : titleDifference.every((word) => seniorityWords.has(word)) ? "SENIORITY_DIFFERS"
      : "DIFFERENT",
    titleSimilarity,
    sharedUrls: intersect(urlsA, urlsB),
    sharedListingIds,
    sharedRequisitionIds,
    conflictingListingIds: sameCompany && sharedListingIds.length === 0 && [...listingA].some((key) => scopesB.has(listingIdScope(key))),
    conflictingRequisitionIds: sameCompany && requisitionA.size > 0 && requisitionB.size > 0 && sharedRequisitionIds.length === 0,
    location,
    salary,
    employmentType,
    description,
    descriptionCharacters: [later.description.length, earlier.description.length],
    incomplete,
    daysApart: Math.round(Math.abs(later.firstSeenAt.getTime() - earlier.firstSeenAt.getTime()) / 86_400_000 * 10) / 10,
    sameSite: [...sites(later)].some((site) => sites(earlier).has(site)),
    complementary,
    currentEngine: later.identity && earlier.identity ? verdict(compareListings(later.identity, earlier.identity)) : null,
    currentPipeline: later.renormalizedIdentity && earlier.renormalizedIdentity ? verdict(compareListings(later.renormalizedIdentity, { ...earlier.renormalizedIdentity, opportunityId: earlier.id })) : null,
  };
}

export interface PairFinding {
  reference: HistoryReference;
  later: HistorySide;
  earlier: HistorySide;
  comparison: PairComparison;
  classification: PairClass;
  // "same job captured again", "different versions of one posting",
  // "separate vacancy", or "unresolved".
  nature: string;
  evidence: string[];
  missing: string[];
}

// The five classes, identifier evidence first, then conflicts, then text.
export function classifyPair(later: HistorySide, earlier: HistorySide, comparison: PairComparison): Omit<PairFinding, "reference" | "later" | "earlier" | "comparison"> {
  const c = comparison;
  const evidence: string[] = [];
  const missing: string[] = [];
  const text = c.description;
  const bothComplete = c.incomplete.length === 0;
  const versionDifferences = [
    ...(c.salary === "OVERLAP" || c.salary === "CONFLICT" ? ["salary"] : []),
    ...(text && text.jaccard < 0.95 ? ["description"] : []),
    ...(c.title === "NORMALIZED_EQUAL" ? ["title formatting"] : []),
    ...(c.location === "COMPATIBLE" ? ["location wording"] : []),
  ];
  const sameNature = () => (versionDifferences.length ? `different versions of one posting (${versionDifferences.join(", ")} differ)` : "the same job captured again");
  const textLine = text ? `description overlap ${text.containment} containment / ${text.jaccard} Jaccard (${c.descriptionCharacters[0]} vs ${c.descriptionCharacters[1]} characters)` : "no comparable descriptions";
  if (!c.sameCompany) {
    missing.push("the same employer (company names differ or are unknown)");
    evidence.push(`company spelling ${c.companySpelling}: "${later.company ?? "?"}" vs "${earlier.company ?? "?"}"`);
  }
  // 1. The employer's or the source's own identifier.
  if (c.sameCompany && (c.sharedListingIds.length || c.sharedRequisitionIds.length)) {
    evidence.push(`shared ${c.sharedListingIds.length ? `listing ID ${c.sharedListingIds.join(", ")}` : `requisition ID ${c.sharedRequisitionIds.join(", ")}`} at the same company`);
    return { classification: "CONFIRMED_SAME_POSTING", nature: sameNature(), evidence, missing: [] };
  }
  if (c.sameCompany && c.sharedUrls.length && c.title !== "DIFFERENT" && c.title !== "SENIORITY_DIFFERS") {
    evidence.push(`shared listing URL ${c.sharedUrls[0]} with the same company and title`);
    return { classification: "CONFIRMED_SAME_POSTING", nature: sameNature(), evidence, missing: [] };
  }
  if (c.conflictingRequisitionIds) {
    evidence.push("different requisition IDs at the same company (the employer's own identifiers)");
    return { classification: "CONFIRMED_DISTINCT", nature: "separate vacancies (different requisitions)", evidence, missing: [] };
  }
  // 2. Facts that cannot both be true of one posting.
  const hardConflicts = [
    ...(c.location === "DIFFERS" ? [`location "${later.location}" vs "${earlier.location}"`] : []),
    ...(c.salary === "CONFLICT" ? ["non-overlapping salary ranges"] : []),
    ...(c.employmentType === "DIFFERS" ? [`employment type ${later.employmentType} vs ${earlier.employmentType}`] : []),
    ...(c.title === "SENIORITY_DIFFERS" || c.title === "DIFFERENT" ? [`title "${later.title}" vs "${earlier.title}"`] : []),
  ];
  if (c.sameCompany && hardConflicts.length) {
    evidence.push(...hardConflicts.map((conflict) => `conflict: ${conflict}`), textLine);
    if (c.conflictingListingIds) evidence.push("different listing IDs from the same source");
    const strong = c.conflictingListingIds || (bothComplete && text !== null && text.containment < 0.6) || hardConflicts.length >= 2;
    return {
      classification: strong ? "CONFIRMED_DISTINCT" : "LIKELY_DISTINCT",
      nature: c.location === "DIFFERS" ? "separate vacancies (different locations)" : "separate vacancies",
      evidence,
      missing: strong ? [] : ["a requisition or listing identifier to confirm"],
    };
  }
  // 3. The posting text itself.
  if (c.sameCompany && text && c.title !== "UNKNOWN") {
    if (bothComplete && text.containment < 0.5) {
      evidence.push(textLine, "both descriptions complete");
      return { classification: c.conflictingListingIds ? "CONFIRMED_DISTINCT" : "LIKELY_DISTINCT", nature: "separate vacancies (different job text)", evidence, missing: c.conflictingListingIds ? [] : ["a requisition or listing identifier to confirm"] };
    }
    if (text.containment >= 0.85) {
      evidence.push(textLine, `title ${c.title}`, `location ${c.location}`, `salary ${c.salary}`);
      if (c.conflictingListingIds) evidence.push("different listing IDs from the same source (a repost, or a second opening with the same text)");
      return {
        classification: "LIKELY_SAME_POSTING",
        nature: c.conflictingListingIds ? "the same posting text under two listing IDs (repost or second opening)" : sameNature(),
        evidence,
        missing: ["a shared listing or requisition identifier to confirm"],
      };
    }
  }
  // 4. Not enough stored evidence.
  evidence.push(textLine, `title ${c.title} (${c.titleSimilarity})`, `location ${c.location}`, `salary ${c.salary}`);
  if (!text && !c.incomplete.length) missing.push("a comparable description on both sides (one has fewer than five words)");
  if (c.incomplete.length) missing.push(`a complete description (${c.incomplete.join(" and ")} copy incomplete)`);
  if (text && text.containment >= 0.5 && text.containment < 0.85) missing.push("a decisive text match (partial overlap)");
  if (!c.sharedListingIds.length && !c.sharedRequisitionIds.length && !c.conflictingListingIds && !c.conflictingRequisitionIds) {
    missing.push("any listing or requisition identifier shared by, or conflicting between, the two copies");
  }
  if (c.location === "ONE_MISSING" || c.location === "BOTH_MISSING") missing.push("a location on both copies");
  return { classification: "STILL_UNRESOLVED", nature: "unresolved", evidence, missing };
}

export async function analyzeDuplicateHistory(read: Awaited<ReturnType<typeof readDuplicateHistory>>): Promise<PairFinding[]> {
  const findings: PairFinding[] = [];
  for (const reference of read.references) {
    const later = read.sides.get(reference.later);
    const earlier = read.sides.get(reference.earlier);
    if (!later || !earlier) continue;
    const comparison = comparePair(later, earlier);
    findings.push({ reference, later, earlier, comparison, ...classifyPair(later, earlier, comparison) });
  }
  return findings;
}

// Opportunities joined by CONFIRMED or LIKELY same-posting pairs.
export function sameVacancyClusters(findings: readonly PairFinding[], include: ReadonlySet<PairClass>): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id) ?? id;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  for (const finding of findings) {
    if (!include.has(finding.classification)) continue;
    const a = find(finding.later.id);
    const b = find(finding.earlier.id);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const id of new Set(findings.filter((finding) => include.has(finding.classification)).flatMap((finding) => [finding.later.id, finding.earlier.id]))) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()].map((group) => group.sort()).sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------- report

const tally = (values: Iterable<string>) => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(([a, left], [b, right]) => right - left || a.localeCompare(b));
};

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "?");

function sideLines(label: string, side: HistorySide): string[] {
  const versions = side.versions.map((version) =>
    `${day(version.createdAt)} ${version.site ?? version.source}${version.method ? `/${version.method}` : ""}${version.readQuality ? ` ${version.readQuality}` : ""}${version.readerRevision !== null ? ` r${version.readerRevision}` : ""}${version.isChangedVersion ? " changed" : ""}${version.corrections ? ` corrections ${version.corrections}` : ""} id ${version.externalId ?? "-"} ${version.descriptionCharacters} chars`,
  );
  return [
    `  ${label}: ${side.id}  "${side.title ?? "?"}" — "${side.company ?? "?"}"  [${side.status}; triage ${side.triage ?? "none"}; evaluations ${side.evaluations}${side.hasApplication ? "; application" : ""}]`,
    `    first seen ${day(side.firstSeenAt)} ${periodOf(side.firstSeenAt)}; posted ${day(side.postingDate)}`,
    `    location "${side.location ?? "?"}"; regions ${side.residencyRegions.join(",") || "-"}; arrangement ${side.workArrangements.join(",") || "-"}; salary ${side.salaryMin ?? "?"}-${side.salaryMax ?? "?"} ${side.currency ?? ""}; employment ${side.employmentType ?? "?"}`,
    `    URL ${side.canonicalUrl ?? "-"}; apply ${side.applicationUrl ?? "-"}; listing ${side.externalListingId ?? "-"}; requisition ${side.atsRequisitionId ?? "-"}; description ${side.description.length} chars`,
    `    versions (${side.versions.length}): ${versions.join(" | ")}`,
  ];
}

export function formatDuplicateHistoryReport(input: {
  database: string;
  findings: readonly PairFinding[];
  noMatchReferences: number;
  pairDetail: boolean;
}): string {
  const { findings } = input;
  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);
  const opportunities = new Set(findings.flatMap((finding) => [finding.later.id, finding.earlier.id]));
  // The audit's count: opportunities whose strongest reference is PROBABLE_MATCH.
  const strongest = new Map<string, string>();
  for (const finding of findings) {
    for (const id of [finding.later.id, finding.earlier.id]) {
      if (strongest.get(id) !== "MATCH") strongest.set(id, finding.reference.decision);
    }
  }
  push(
    "Historical duplicate investigation (read-only: nothing was written, merged, fetched or sent to a provider)",
    `Database: ${input.database}`,
    "",
    "1. Reconciliation",
    `  Stored duplicate references examined (MATCH and PROBABLE_MATCH): ${findings.length}`,
    ...tally(findings.map((finding) => `${finding.reference.decision}${finding.reference.resolution ? ` (resolved ${finding.reference.resolution})` : " (unresolved)"}`)).map(([key, value]) => `    ${key}: ${value}`),
    `  NO_MATCH references (kept-separate records; not examined): ${input.noMatchReferences}`,
    `  Distinct opportunities involved: ${opportunities.size}`,
    `  Opportunities whose strongest reference is PROBABLE_MATCH (the triage audit's "PROBABLE_MATCH" count is this number of opportunities, not of relationships): ${[...strongest.values()].filter((value) => value === "PROBABLE_MATCH").length}`,
    `  Opportunities whose strongest reference is MATCH: ${[...strongest.values()].filter((value) => value === "MATCH").length}`,
    `  References per opportunity: ${tally([...opportunities].map((id) => `${findings.filter((finding) => finding.later.id === id || finding.earlier.id === id).length}`)).map(([key, value]) => `${key} ref(s): ${value}`).join("; ")}`,
    `  Recorded by engine: ${tally(findings.map((finding) => String(finding.reference.evidence?.engineVersion ?? "unknown"))).map(([key, value]) => `${key} ${value}`).join(", ")}; recorded as: ${tally(findings.map((finding) => String(finding.reference.evidence?.recordedBy ?? "capture"))).map(([key, value]) => `${key} ${value}`).join(", ")}`,
    "",
    "2. Classification (each relationship once)",
  );
  for (const classification of ["CONFIRMED_SAME_POSTING", "LIKELY_SAME_POSTING", "CONFIRMED_DISTINCT", "LIKELY_DISTINCT", "STILL_UNRESOLVED"] as const) {
    push(`    ${classification}: ${findings.filter((finding) => finding.classification === classification).length}`);
  }
  push("  By nature:", ...tally(findings.map((finding) => `${finding.classification} — ${finding.nature}`)).map(([key, value]) => `    ${key}: ${value}`));
  push("  What unresolved relationships lack:", ...tally(findings.filter((finding) => finding.classification === "STILL_UNRESOLVED").flatMap((finding) => finding.missing)).map(([key, value]) => `    ${key}: ${value}`));
  const confirmed = sameVacancyClusters(findings, new Set(["CONFIRMED_SAME_POSTING"]));
  const supported = sameVacancyClusters(findings, new Set(["CONFIRMED_SAME_POSTING", "LIKELY_SAME_POSTING"]));
  const redundant = (clusters: string[][]) => clusters.reduce((sum, cluster) => sum + cluster.length - 1, 0);
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const vacancies = (clusters: string[][]) =>
    `${plural(clusters.length, "vacancy", "vacancies")} held by ${plural(clusters.reduce((sum, cluster) => sum + cluster.length, 0), "opportunity", "opportunities")} (${plural(redundant(clusters), "extra copy", "extra copies")})`;
  const probable = findings.filter((finding) => finding.reference.decision === "PROBABLE_MATCH");
  push(
    "",
    "3. Repeated captures of one vacancy (opportunities counted once, through clusters)",
    `  Confirmed: ${vacancies(confirmed)}`,
    `  Confirmed or likely: ${vacancies(supported)}`,
    `  Cluster sizes (confirmed or likely): ${tally(supported.map((cluster) => `${cluster.length}`)).map(([key, value]) => `${key} copies: ${value}`).join("; ") || "none"}`,
    "",
    "4. History",
    "  Capture period of the later copy (documented change dates; a checkout may have received a change later):",
    ...tally(findings.map((finding) => `${finding.classification}: ${periodOf(finding.later.firstSeenAt)}`)).map(([key, value]) => `    ${key}: ${value}`),
    "  Same site captured both copies:",
    ...tally(findings.map((finding) => `${finding.classification}: ${finding.comparison.sameSite ? "same site" : "different sites"}`)).map(([key, value]) => `    ${key}: ${value}`),
    "  An incomplete copy (stored description under 400 characters):",
    ...tally(findings.map((finding) => `${finding.classification}: ${finding.comparison.incomplete.length ? `${finding.comparison.incomplete.join("+")} incomplete` : "both complete"}`)).map(([key, value]) => `    ${key}: ${value}`),
    `  Recorded as PROBABLE_MATCH but MATCH for the current engine: ${probable.filter((finding) => finding.comparison.currentEngine?.decision === "MATCH").length} on the stored identities, ${probable.filter((finding) => finding.comparison.currentPipeline?.decision === "MATCH").length} on the re-normalized evidence (of ${probable.length})`,
    "  Current engine on the stored identities (each side's facts and every source record's IDs and URLs):",
    ...tally(findings.map((finding) => `${finding.classification}: ${finding.comparison.currentEngine?.decision ?? "(not computed)"}`)).map(([key, value]) => `    ${key}: ${value}`),
    "  Current engine on the stored evidence re-normalized now (would the current pipeline still keep them apart?):",
    ...tally(findings.map((finding) => `${finding.classification}: ${finding.comparison.currentPipeline?.decision ?? "(not computed)"}`)).map(([key, value]) => `    ${key}: ${value}`),
    "",
    "5. Complementary information (a fact only one copy holds), same-posting pairs only:",
    ...tally(findings.filter((finding) => finding.classification.endsWith("SAME_POSTING")).flatMap((finding) => finding.comparison.complementary)).map(([key, value]) => `    ${key}: ${value}`),
    "",
    "6. Possible current deduplication defects (identifier evidence the current engine would still not treat as a MATCH):",
  );
  const defects = findings.filter((finding) => finding.classification === "CONFIRMED_SAME_POSTING" && finding.comparison.currentEngine?.decision !== "MATCH");
  push(`    ${defects.length}${defects.length ? "" : " (none)"}`);
  for (const finding of defects) {
    push(`    ${finding.reference.id}: ${finding.evidence.join("; ")}; current engine ${finding.comparison.currentEngine?.decision ?? "?"} conflicts ${finding.comparison.currentEngine?.conflicts.join(",") || "-"}`);
  }
  if (input.pairDetail) {
    push("", "7. Pair-by-pair comparison (later copy first; ordered by class)");
    const order: PairClass[] = ["CONFIRMED_SAME_POSTING", "LIKELY_SAME_POSTING", "STILL_UNRESOLVED", "LIKELY_DISTINCT", "CONFIRMED_DISTINCT"];
    const sorted = [...findings].sort((a, b) => order.indexOf(a.classification) - order.indexOf(b.classification) || a.reference.createdAt.getTime() - b.reference.createdAt.getTime());
    sorted.forEach((finding, index) => {
      const c = finding.comparison;
      const stored = finding.reference.evidence ?? {};
      push(
        "",
        `#${index + 1} ${finding.classification} — ${finding.nature}`,
        `  reference ${finding.reference.id}: ${finding.reference.decision} ${finding.reference.confidence ?? "?"} ${finding.reference.resolution ?? "unresolved"}; recorded ${day(finding.reference.createdAt)} by ${String(stored.engineVersion ?? "?")}${stored.recordedBy ? ` (${String(stored.recordedBy)})` : ""}; matched on ${(stored.matchedOn as string[] | undefined)?.join(",") || "-"}; conflicts ${(stored.conflicts as string[] | undefined)?.join(",") || "-"}`,
        ...sideLines("later  ", finding.later),
        ...sideLines("earlier", finding.earlier),
        `  compare: company ${c.companySpelling}; title ${c.title} (${c.titleSimilarity}); location ${c.location}; salary ${c.salary}; employment ${c.employmentType}; ${c.description ? `description ${c.description.containment}/${c.description.jaccard}` : "no description pair"}; ${c.daysApart} days apart; ${c.sameSite ? "same site" : "different sites"}`,
        `  identifiers: shared URL ${c.sharedUrls.join(",") || "-"}; shared listing ${c.sharedListingIds.join(",") || "-"}; shared requisition ${c.sharedRequisitionIds.join(",") || "-"}; conflicting listing IDs ${c.conflictingListingIds ? "yes" : "no"}; conflicting requisitions ${c.conflictingRequisitionIds ? "yes" : "no"}`,
        `  current engine: stored ${c.currentEngine?.decision ?? "?"}${c.currentEngine?.conflicts.length ? ` (conflicts ${c.currentEngine.conflicts.join(",")})` : ""}; re-normalized ${c.currentPipeline?.decision ?? "?"}${c.currentPipeline?.conflicts.length ? ` (conflicts ${c.currentPipeline.conflicts.join(",")})` : ""}`,
        `  evidence: ${finding.evidence.join("; ")}`,
        ...(finding.missing.length ? [`  missing: ${finding.missing.join("; ")}`] : []),
        ...(c.complementary.length ? [`  complementary: ${c.complementary.join("; ")}`] : []),
      );
    });
  }
  return lines.join("\n");
}
