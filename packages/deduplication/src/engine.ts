import { normalizeCompanyName, textTokens } from "./company-name";
import { listingIdKey, listingUrlKey } from "./listing-identity";

export const deduplicationEngineVersion = "core-dedup-v1";

export type DuplicateDecision = "MATCH" | "PROBABLE_MATCH" | "NO_MATCH";

// What the engine compares. Every identifier list may hold values from all
// of an opportunity's source records.
export interface DuplicateIdentity {
  companyName: string | null;
  title: string | null;
  location: string | null;
  description: string | null;
  urls: readonly (string | null)[];
  listingIds: readonly (string | null)[];
  requisitionIds: readonly (string | null)[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
}

export interface DuplicateCandidate extends DuplicateIdentity {
  opportunityId: string;
  firstSeenAt: Date;
}

export interface DuplicateEvidence {
  engineVersion: string;
  matchedOn: string[];
  conflicts: string[];
  sharedUrlKeys: string[];
  sharedListingIds: string[];
  sharedRequisitionIds: string[];
  companyKey: string | null;
  similarity: { title: number; location: number; description: number; salaryPenalty: number } | null;
}

export interface DuplicateMatch {
  opportunityId: string;
  decision: Exclude<DuplicateDecision, "NO_MATCH">;
  confidence: number;
  firstSeenAt: Date;
  evidence: DuplicateEvidence;
}

export interface DuplicateDecisionResult {
  decision: DuplicateDecision;
  // The opportunity an exact duplicate belongs to: the earliest-seen MATCH.
  canonical: DuplicateMatch | null;
  // Every MATCH (earliest first), then PROBABLE_MATCH by confidence.
  matches: DuplicateMatch[];
}

export const probableMatchThreshold = 0.6;
const weights = { title: 0.5, location: 0.2, description: 0.3 } as const;
const salaryPenalty = 0.1;
// Confidence for a shared exact identifier whose other facts conflict.
const conflictedIdentifierConfidence = 0.8;
const companylessIdentifierConfidence = 0.7;

function keys(values: readonly (string | null)[], key: (value: string | null) => string | null) {
  return new Set(values.map(key).filter((value): value is string => value !== null));
}

function shared(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => right.has(value)).sort();
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / (a.size + b.size - intersection);
}

const significant = (value: string | null) => textTokens(value).filter((word) => word.length >= 3);
const round = (value: number) => Math.round(value * 10_000) / 10_000;

function rangesConflict(left: DuplicateIdentity, right: DuplicateIdentity): boolean {
  if (!left.currency || left.currency !== right.currency) return false;
  const leftLow = left.salaryMin ?? left.salaryMax;
  const leftHigh = left.salaryMax ?? left.salaryMin;
  const rightLow = right.salaryMin ?? right.salaryMax;
  const rightHigh = right.salaryMax ?? right.salaryMin;
  if (leftLow === null || leftHigh === null || rightLow === null || rightHigh === null) return false;
  return leftHigh < rightLow || rightHigh < leftLow;
}

export function compareListings(
  subject: DuplicateIdentity,
  candidate: DuplicateCandidate,
): DuplicateMatch | null {
  const sharedUrlKeys = shared(keys(subject.urls, listingUrlKey), keys(candidate.urls, listingUrlKey));
  const subjectListingIds = keys(subject.listingIds, listingIdKey);
  const candidateListingIds = keys(candidate.listingIds, listingIdKey);
  const sharedListingIds = shared(subjectListingIds, candidateListingIds);
  const sharedRequisitionIds = shared(
    keys(subject.requisitionIds, listingIdKey),
    keys(candidate.requisitionIds, listingIdKey),
  );
  const subjectCompany = normalizeCompanyName(subject.companyName);
  const candidateCompany = normalizeCompanyName(candidate.companyName);
  const companiesKnown = subjectCompany !== null && candidateCompany !== null;
  const sameCompany = companiesKnown && subjectCompany === candidateCompany;
  const subjectTitle = textTokens(subject.title).join(" ");
  const candidateTitle = textTokens(candidate.title).join(" ");
  const titleConflict = Boolean(subjectTitle && candidateTitle && subjectTitle !== candidateTitle);
  const listingIdConflict =
    sameCompany && subjectListingIds.size > 0 && candidateListingIds.size > 0 && sharedListingIds.length === 0;
  const base = {
    engineVersion: deduplicationEngineVersion,
    sharedUrlKeys,
    sharedListingIds,
    sharedRequisitionIds,
    companyKey: sameCompany ? subjectCompany : null,
  };
  const result = (
    decision: DuplicateMatch["decision"],
    confidence: number,
    matchedOn: string[],
    conflicts: string[],
    similarity: DuplicateEvidence["similarity"] = null,
  ): DuplicateMatch => ({
    opportunityId: candidate.opportunityId,
    decision,
    confidence: round(confidence),
    firstSeenAt: candidate.firstSeenAt,
    evidence: { ...base, matchedOn, conflicts, similarity },
  });

  // A listing or requisition ID identifies a job only within one company.
  const sharedIds = [
    ...(sharedListingIds.length ? ["listingId"] : []),
    ...(sharedRequisitionIds.length ? ["requisitionId"] : []),
  ];
  if (sharedIds.length && sameCompany) return result("MATCH", 1, [...sharedIds, "company"], []);

  if (sharedUrlKeys.length) {
    const conflicts = [
      ...(companiesKnown && !sameCompany ? ["company"] : []),
      ...(titleConflict ? ["title"] : []),
      ...(listingIdConflict ? ["listingId"] : []),
    ];
    // The same URL with a different title is typical of a generic careers
    // page pasted for two jobs: a warning, never an automatic attach.
    return conflicts.length
      ? result("PROBABLE_MATCH", conflictedIdentifierConfidence, ["url"], conflicts)
      : result("MATCH", 1, ["url"], []);
  }

  if (sharedIds.length) {
    // IDs collide across companies; without both companies it is a warning.
    return companiesKnown ? null : result("PROBABLE_MATCH", companylessIdentifierConfidence, sharedIds, ["company-unknown"]);
  }

  if (!sameCompany) return null;
  const title = subjectTitle && candidateTitle ? jaccard(subjectTitle.split(" "), candidateTitle.split(" ")) : 0;
  const location =
    subject.location && candidate.location
      ? jaccard(textTokens(subject.location), textTokens(candidate.location))
      : subject.location || candidate.location
        ? 0
        : 0.5;
  const description = jaccard(significant(subject.description), significant(candidate.description));
  const penalty = rangesConflict(subject, candidate) ? salaryPenalty : 0;
  const confidence =
    weights.title * title + weights.location * location + weights.description * description - penalty;
  if (confidence < probableMatchThreshold) return null;
  return result("PROBABLE_MATCH", Math.min(confidence, 0.99), ["company", "title", "location", "description"], penalty ? ["salary"] : [], {
    title: round(title),
    location: round(location),
    description: round(description),
    salaryPenalty: penalty,
  });
}

function earliest(left: DuplicateMatch, right: DuplicateMatch) {
  return left.firstSeenAt.getTime() - right.firstSeenAt.getTime() || left.opportunityId.localeCompare(right.opportunityId);
}

export function decideDuplicates(
  subject: DuplicateIdentity,
  candidates: readonly DuplicateCandidate[],
): DuplicateDecisionResult {
  const matches = candidates
    .map((candidate) => compareListings(subject, candidate))
    .filter((match): match is DuplicateMatch => match !== null);
  const exact = matches.filter((match) => match.decision === "MATCH").sort(earliest);
  const probable = matches
    .filter((match) => match.decision === "PROBABLE_MATCH")
    .sort((left, right) => right.confidence - left.confidence || earliest(left, right));
  return {
    decision: exact.length ? "MATCH" : probable.length ? "PROBABLE_MATCH" : "NO_MATCH",
    canonical: exact[0] ?? null,
    matches: [...exact, ...probable],
  };
}
