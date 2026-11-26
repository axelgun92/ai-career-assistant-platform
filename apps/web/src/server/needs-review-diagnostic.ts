import type { NormalizedOpportunity, PreEvaluatorTriageReason, UserWorkEligibility } from "@ai-career/core";
import { loadCustomerSuccessPreferencesFromProfile, triageCustomerSuccessOpportunity } from "@ai-career/customer-success";
import {
  readOnlyTransaction,
  readStoredSourceVersion,
  residencyRequirement,
  storedCompensationTiers,
  storedEligibilityFacts,
  storedWorkArrangements,
  type StoredOpportunityFacts,
  type StoredSourceVersion,
} from "@ai-career/database";
import { htmlToText, readPositionEvidence } from "@ai-career/normalization";
import type { createReadOnlyDatabaseClient } from "@ai-career/database";
import { renormalizeStoredSourceVersion } from "./source-version-check";

// NEEDS_REVIEW diagnostic (November 24, 2026; read-only). For every
// opportunity whose effective pre-evaluator triage outcome is NEEDS_REVIEW
// (automatic NEEDS_REVIEW, no manual decision) it explains each recorded
// reason from what is stored:
// - the stored reasons, grouped by field, combination, source and capture day;
// - every stored source version run again, in memory, through the current
//   normalization (the acceptance source-version check), and the same pure
//   triage run on the result: a reason that disappears was a historical
//   normalization problem (B), one another observation resolves is B via
//   another observation;
// - for a reason that remains: a missing-type reason with no field signal in
//   enough stored text is A (absent), one with a signal is a possible current
//   extraction gap to confirm by hand (never assumed), a value-present reason
//   is C (present but not decisive), too little stored text is D, and a
//   reason caused by the user's own configuration is CONFIG;
// - probable-duplicate pairs, from the deduplication evidence stored with
//   each reference, and whether the related record has a missing field.
// Nothing is written, re-normalized into the database, re-triaged into the
// database, fetched from a site or sent to a provider.

type Outcome = "EVALUATE" | "NEEDS_REVIEW" | "REJECT";
type Family = "salary" | "residency" | "workArrangement" | "workAuthorization" | "other";
type Kind = "MISSING" | "PRESENT_UNDECIDED" | "CONFIG";
export type ReasonClass = "STALE" | "B_CURRENT_NORMALIZATION" | "B_OTHER_OBSERVATION" | "CONFIG" | "D_EVIDENCE_INCOMPLETE" | "POSSIBLE_CURRENT_GAP" | "A_ABSENT" | "C_AMBIGUOUS";
type TriageFacts = Parameters<typeof triageCustomerSuccessOpportunity>[0]["opportunity"];

// Each triage reason's field family, whether it means "a fact is missing" or
// "a fact is present but does not decide", and the text signal searched for
// a missing fact. Unlisted codes count as present-but-undecided.
const reasonCatalog: Record<string, { family: Family; kind: Kind; signal?: Family }> = {
  "salary-unknown-salary": { family: "salary", kind: "MISSING", signal: "salary" },
  "salary-unknown-currency": { family: "salary", kind: "MISSING", signal: "salary" },
  "salary-unknown-residency": { family: "salary", kind: "MISSING", signal: "residency" },
  "salary-ote-not-confirmed-base": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "salary-conflicting-salary": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "salary-conflicting-residency": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "salary-us-review": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "salary-non-us-review": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "salary-non-us-conditional-review": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "salary-non-us-conditional-unknown": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "salary-non-us-lower-cost-review": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "salary-open-maximum-unknown": { family: "salary", kind: "PRESENT_UNDECIDED" },
  "residency-unknown": { family: "residency", kind: "MISSING", signal: "residency" },
  "residency-conflicting-or-incomplete": { family: "residency", kind: "PRESENT_UNDECIDED" },
  "residency-policy-unreadable": { family: "residency", kind: "CONFIG" },
  "work-arrangement-unknown": { family: "workArrangement", kind: "MISSING", signal: "workArrangement" },
  "work-arrangement-conflicting": { family: "workArrangement", kind: "PRESENT_UNDECIDED" },
  "work-authorization-needs-review": { family: "workAuthorization", kind: "PRESENT_UNDECIDED" },
  // Missing when the posting states no authorization fact at all (the job's
  // region is outside the user's); present-but-undecided otherwise.
  "work-authorization-unresolved": { family: "workAuthorization", kind: "MISSING", signal: "workAuthorization" },
  "work-eligibility-not-configured": { family: "workAuthorization", kind: "CONFIG" },
};

export const reasonInfo = (code: string) => reasonCatalog[code] ?? { family: "other" as Family, kind: "PRESENT_UNDECIDED" as Kind };

// Conservative field signals: a match only says the stored text mentions the
// subject, never what the requirement is.
const signals: Partial<Record<Family, RegExp>> = {
  salary: /(?:[$£€]\s?\d[\d,.]*\s?[kK]?\b|\b(?:USD|EUR|GBP|CAD|AUD|CHF)\s?\d[\d,.]*\s?[kK]?\b|\b\d[\d,.]*\s?[kK]?\s?(?:USD|EUR|GBP|CAD|AUD|CHF)\b)/,
  residency: /\b(?:must (?:reside|live|be located|be based)|resid(?:e|ent|ency|ing)|located in|based in|anywhere in|open to candidates in|within the (?:US|U\.S\.|United States|UK|EU|European Union)|(?:US|U\.S\.|USA|UK|EU|EMEA|LATAM|APAC|Canada)[- ](?:only|based|remote)|remote[,\s-]+(?:US|U\.S\.|USA|UK|EU|EMEA|Canada|United States))\b/i,
  workArrangement: /\b(?:remote|hybrid|on[- ]?site|in[- ]office|in the office|work from home|wfh|days? (?:a|per) week in)\b/i,
  workAuthorization: /\b(?:authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|visa|sponsor(?:ship)?|citizen(?:ship)?|green card|work permit|permanent resident)\b/i,
};

// Fewer characters of stored text than this cannot show a fact is absent.
export const minimumEvidenceCharacters = 400;

export interface ReviewVersion {
  id: string;
  source: string;
  createdAt: Date;
  isFactsVersion: boolean;
  version: StoredSourceVersion;
}

export interface ReviewDuplicate {
  relatedId: string;
  decision: string;
  confidence: number | null;
  resolution: string | null;
  evidence: {
    matchedOn?: string[];
    conflicts?: string[];
    sharedUrlKeys?: string[];
    sharedListingIds?: string[];
    sharedRequisitionIds?: string[];
    similarity?: { title: number; location: number; description: number } | null;
  } | null;
  relatedSource: string | null;
  relatedTriage: { outcome: Outcome; manualDecision: string | null; codes: string[] } | null;
  relatedFacts: TriageFacts | null;
}

export interface ReviewCase {
  id: string;
  title: string | null;
  company: string | null;
  status: string;
  source: string;
  sourceType: string | null;
  createdAt: Date;
  site: string | null;
  method: string | null;
  readQuality: string | null;
  reasons: PreEvaluatorTriageReason[];
  assessedProfileVersion: number | null;
  stored: TriageFacts;
  versions: ReviewVersion[];
  duplicates: ReviewDuplicate[];
}

export interface ReviewContext {
  activeProfile: { id: string; version: number; domainPreferences: unknown } | null;
  eligibility: UserWorkEligibility | null;
}

export type Renormalize = (version: StoredSourceVersion) => Promise<{ opportunity: NormalizedOpportunity }>;

// ---------------------------------------------------------------- reading

const decimal = (value: unknown): number | null => (value === null || value === undefined ? null : Number(String(value)));

// The position facts triage reads (November 25, 2026): the title, seniority,
// employment type, compensation tiers and the explicit position evidence in
// the title and description, as the triage service derives them. (Remote by
// exception is read from field provenance by the service; the diagnostic
// does not read provenance, so it never applies here.)
type PositionSource = {
  title?: string | null; seniority?: string | null; seniorityLabel?: string | null; employmentType?: string | null;
  compensationTiers?: unknown; jobDescription?: string | null;
};
export function positionFactsOf(source: PositionSource): Partial<TriageFacts> {
  return {
    title: source.title ?? null,
    seniority: (source.seniority ?? null) as TriageFacts["seniority"],
    seniorityLabel: source.seniorityLabel ?? null,
    employmentType: (source.employmentType ?? null) as TriageFacts["employmentType"],
    compensationTiers: storedCompensationTiers(source.compensationTiers ?? []),
    evidence: readPositionEvidence({ title: source.title ?? null, description: source.jobDescription ?? null }),
  };
}

export function triageFactsOf(stored: Pick<StoredOpportunityFacts,
  "salaryMin" | "salaryMax" | "currency" | "compensationBasis" | "residencyRequirement" | "residencyRegions" | "remoteStatus" | "workArrangements" |
  "location" | "workAuthorizationRequirement" | "workAuthorizationRegions" | "visaSponsorship" | "relocationSupport" | "employerOfRecordRegions"> & PositionSource): TriageFacts {
  return {
    ...positionFactsOf(stored),
    salaryMin: decimal(stored.salaryMin),
    salaryMax: decimal(stored.salaryMax),
    currency: stored.currency,
    residencyRequirement: residencyRequirement(stored.residencyRequirement),
    residencyRegions: stored.residencyRegions,
    remoteStatus: stored.remoteStatus,
    workArrangements: storedWorkArrangements(stored.workArrangements),
    location: stored.location,
    ...storedEligibilityFacts(stored),
  };
}

type ReadOnlyClient = Pick<ReturnType<typeof createReadOnlyDatabaseClient>, "$transaction">;
type SummaryRow = {
  id: string; title: string | null; company: string | null; status: string; source: string; sourceType: string | null; createdAt: Date;
  site: string | null; method: string | null; readQuality: string | null; reasons: unknown; assessedProfileVersion: number | null;
};

// Every effective NEEDS_REVIEW opportunity with its stored facts, source
// versions and probable-duplicate references, through read-only transactions.
export async function readNeedsReviewCases(
  client: ReadOnlyClient,
  options: { limitTo?: ReadonlySet<string> } = {},
): Promise<{ cases: ReviewCase[]; context: ReviewContext }> {
  const { rows, context } = await readOnlyTransaction(client, async (transaction) => {
    const rows = await transaction.$queryRaw<SummaryRow[]>`
      SELECT o."id", o."title", c."name" AS "company", o."status"::text AS "status", o."source", o."sourceType"::text AS "sourceType", o."createdAt",
        (SELECT s."sourceMetadata"->'capture'->>'site' FROM "SourceRecord" s WHERE s."opportunityId" = o."id" ORDER BY s."createdAt" ASC LIMIT 1) AS "site",
        (SELECT s."sourceMetadata"->'capture'->>'method' FROM "SourceRecord" s WHERE s."opportunityId" = o."id" ORDER BY s."createdAt" ASC LIMIT 1) AS "method",
        (SELECT s."sourceMetadata"->'capture'->>'readQuality' FROM "SourceRecord" s WHERE s."opportunityId" = o."id" ORDER BY s."createdAt" DESC LIMIT 1) AS "readQuality",
        t."reasons", t."userProfileVersion" AS "assessedProfileVersion"
      FROM "PreEvaluatorTriage" t
      JOIN "Opportunity" o ON o."id" = t."opportunityId"
      LEFT JOIN "Company" c ON c."id" = o."companyId"
      WHERE t."outcome" = 'NEEDS_REVIEW' AND t."manualDecision" IS NULL
      ORDER BY o."createdAt" ASC, o."id" ASC`;
    const [profile] = await transaction.$queryRaw<Array<{ id: string; version: number; domainPreferences: unknown }>>`
      SELECT p."id", p."version", p."domainPreferences" FROM "ActiveUserProfile" a JOIN "UserProfile" p ON p."id" = a."userProfileId" WHERE a."domain" = 'customer-success'`;
    const [eligibility] = await transaction.$queryRaw<Array<{ authorizedRegions: string[]; citizenshipRegions: string[] }>>`
      SELECT "authorizedRegions", "citizenshipRegions" FROM "UserEligibility" WHERE "id" = 'user'`;
    return {
      rows,
      context: {
        activeProfile: profile ? { id: profile.id, version: Number(profile.version), domainPreferences: profile.domainPreferences } : null,
        eligibility: eligibility ? { authorizedRegions: eligibility.authorizedRegions, citizenshipRegions: eligibility.citizenshipRegions } : null,
      } satisfies ReviewContext,
    };
  });
  const cases: ReviewCase[] = [];
  for (const row of rows) {
    if (options.limitTo && !options.limitTo.has(row.id)) continue;
    const latest = await readStoredSourceVersion(client, { opportunityId: row.id });
    if (!latest?.opportunity) continue;
    const factsVersionId = latest.currentFactsVersionId ?? latest.version.id;
    const versions: ReviewVersion[] = [];
    for (const summary of latest.versions) {
      const read = summary.id === latest.version.id ? latest : await readStoredSourceVersion(client, { sourceRecordId: summary.id });
      if (read) versions.push({ id: summary.id, source: summary.source, createdAt: summary.createdAt, isFactsVersion: summary.id === factsVersionId, version: read.version });
    }
    if (!versions.some((version) => version.isFactsVersion) && versions[0]) versions[0].isFactsVersion = true;
    const duplicates = await readOnlyTransaction(client, async (transaction) => {
      const references = await transaction.duplicateReference.findMany({
        where: { decision: { not: "NO_MATCH" }, OR: [{ opportunityId: row.id }, { relatedOpportunityId: row.id }] },
        select: { opportunityId: true, relatedOpportunityId: true, decision: true, confidence: true, resolution: true, evidence: true },
      });
      const result: ReviewDuplicate[] = [];
      for (const reference of references) {
        const relatedId = reference.opportunityId === row.id ? reference.relatedOpportunityId : reference.opportunityId;
        const related = await transaction.opportunity.findUnique({
          where: { id: relatedId },
          select: {
            source: true, salaryMin: true, salaryMax: true, currency: true, compensationBasis: true, residencyRequirement: true, residencyRegions: true,
            remoteStatus: true, workArrangements: true, location: true, workAuthorizationRequirement: true, workAuthorizationRegions: true,
            visaSponsorship: true, relocationSupport: true, employerOfRecordRegions: true,
            title: true, seniority: true, seniorityLabel: true, employmentType: true, compensationTiers: true, jobDescription: true,
            preEvaluatorTriage: { select: { outcome: true, manualDecision: true, reasons: true } },
          },
        });
        const triage = related?.preEvaluatorTriage ?? null;
        result.push({
          relatedId,
          decision: reference.decision,
          confidence: decimal(reference.confidence),
          resolution: reference.resolution,
          evidence: (reference.evidence ?? null) as ReviewDuplicate["evidence"],
          relatedSource: related?.source ?? null,
          relatedTriage: triage
            ? { outcome: triage.outcome as Outcome, manualDecision: triage.manualDecision, codes: Array.isArray(triage.reasons) ? (triage.reasons as Array<{ code: string }>).map((reason) => reason.code) : [] }
            : null,
          relatedFacts: related ? triageFactsOf(related) : null,
        });
      }
      return result;
    });
    cases.push({
      id: row.id, title: row.title, company: row.company, status: row.status, source: row.source, sourceType: row.sourceType,
      createdAt: new Date(row.createdAt), site: row.site, method: row.method, readQuality: row.readQuality,
      reasons: Array.isArray(row.reasons) ? (row.reasons as PreEvaluatorTriageReason[]) : [],
      assessedProfileVersion: row.assessedProfileVersion === null ? null : Number(row.assessedProfileVersion),
      stored: triageFactsOf(latest.opportunity),
      versions,
      duplicates,
    });
  }
  return { cases, context };
}

// ---------------------------------------------------------------- analysis

// The stored text a reviewer would read for one version, as plain text.
export function versionText(version: StoredSourceVersion): string {
  const metadata = version.sourceMetadata && typeof version.sourceMetadata === "object" && !Array.isArray(version.sourceMetadata)
    ? (version.sourceMetadata as Record<string, unknown>)
    : {};
  const description = version.rawDescription ?? "";
  const plain = /<[a-z][\s\S]*>/i.test(description) ? htmlToText(description) : description;
  return [version.rawTitle, version.rawLocation, version.rawSalaryText, plain, typeof metadata.pageText === "string" ? metadata.pageText : null]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
}

function snippet(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  if (!match) return null;
  const start = Math.max(0, match.index - 100);
  const end = Math.min(text.length, match.index + match[0].length + 100);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

const familyFields: Record<Family, (facts: TriageFacts) => Record<string, unknown>> = {
  salary: (f) => ({ salaryMin: f.salaryMin, salaryMax: f.salaryMax, currency: f.currency, compensationBasis: f.compensationBasis }),
  residency: (f) => ({ residencyRequirement: f.residencyRequirement, residencyRegions: f.residencyRegions, location: f.location }),
  workArrangement: (f) => ({ remoteStatus: f.remoteStatus, workArrangements: f.workArrangements }),
  workAuthorization: (f) => ({
    workAuthorizationRequirement: f.workAuthorizationRequirement, workAuthorizationRegions: f.workAuthorizationRegions,
    visaSponsorship: f.visaSponsorship, relocationSupport: f.relocationSupport, employerOfRecordRegions: f.employerOfRecordRegions, location: f.location,
  }),
  other: () => ({}),
};

// Whether a record's facts state the field a missing-type reason lacks.
function hasField(family: Family, facts: TriageFacts): boolean {
  if (family === "salary") return facts.salaryMin !== null || facts.salaryMax !== null;
  if (family === "residency") return facts.residencyRequirement !== null;
  if (family === "workArrangement") return facts.remoteStatus !== null || facts.workArrangements.length > 0;
  if (family === "workAuthorization") {
    return facts.workAuthorizationRequirement !== null || facts.visaSponsorship !== null || facts.relocationSupport !== null || facts.employerOfRecordRegions.length > 0;
  }
  return false;
}

export interface ReasonFinding {
  code: string;
  family: Family;
  kind: Kind;
  classification: ReasonClass;
  // Current normalization of the facts version: what replaced the reason.
  replacedBy: string[];
  storedValues: Record<string, unknown>;
  currentValues: Record<string, unknown> | null;
  evidence: string | null;
  evidenceVersionId: string | null;
}

export interface CaseFinding {
  id: string;
  title: string | null;
  company: string | null;
  source: string;
  site: string | null;
  method: string | null;
  readQuality: string | null;
  createdDay: string;
  codes: string[];
  storedReproduces: boolean;
  currentOutcome: Outcome | null;
  currentCodes: string[];
  renormalizationFailed: boolean;
  textCharacters: number;
  reasons: ReasonFinding[];
  signature: string;
  duplicates: Array<{
    relatedId: string;
    decision: string;
    resolution: string | null;
    pairClass: "SAME_POSTING_LIKELY" | "DISTINCT_LIKELY" | "UNCERTAIN";
    sameSource: boolean;
    relatedOutcome: string | null;
    sharedCodes: string[];
    relatedHasMissingField: Family[];
    similarity: { title: number; location: number; description: number } | null;
    conflicts: string[];
  }>;
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

// The pair's nature from the deduplication evidence stored with it (stated
// thresholds; PROBABLE_MATCH alone is never taken as proof).
export function pairClassOf(evidence: ReviewDuplicate["evidence"]): CaseFinding["duplicates"][number]["pairClass"] {
  if (!evidence) return "UNCERTAIN";
  const shared = (evidence.sharedUrlKeys?.length ?? 0) + (evidence.sharedListingIds?.length ?? 0) + (evidence.sharedRequisitionIds?.length ?? 0);
  const similarity = evidence.similarity ?? null;
  if ((evidence.conflicts?.length ?? 0) > 0) return "DISTINCT_LIKELY";
  if (shared > 0) return "SAME_POSTING_LIKELY";
  if (similarity && similarity.description >= 0.9 && similarity.title >= 0.9 && similarity.location >= 0.9) return "SAME_POSTING_LIKELY";
  if (similarity && similarity.description < 0.5) return "DISTINCT_LIKELY";
  return "UNCERTAIN";
}

export async function analyzeNeedsReview(
  cases: readonly ReviewCase[],
  context: ReviewContext,
  renormalize: Renormalize = renormalizeStoredSourceVersion,
): Promise<CaseFinding[]> {
  const preferences = context.activeProfile ? loadCustomerSuccessPreferencesFromProfile(context.activeProfile.domainPreferences) : null;
  const triage = (facts: TriageFacts) =>
    preferences ? triageCustomerSuccessOpportunity({ opportunity: facts, preferences, eligibility: context.eligibility }) : null;
  const findings: CaseFinding[] = [];
  for (const item of cases) {
    const codes = sorted(item.reasons.map((reason) => reason.code));
    const storedNow = triage(item.stored);
    const storedNowCodes = new Set(storedNow?.reasons.map((reason) => reason.code) ?? codes);
    const storedReproduces = storedNow !== null && storedNow.outcome === "NEEDS_REVIEW" && sorted(storedNowCodes).join() === codes.join();
    // Each version through the current normalization, then triage.
    const current: Array<{ version: ReviewVersion; facts: TriageFacts; codes: Set<string>; outcome: Outcome } | null> = [];
    let renormalizationFailed = false;
    for (const version of item.versions) {
      try {
        const { opportunity } = await renormalize(version.version);
        const facts: TriageFacts = {
          ...positionFactsOf(opportunity),
          salaryMin: decimal(opportunity.salaryMin), salaryMax: decimal(opportunity.salaryMax), currency: opportunity.currency,
          compensationBasis: opportunity.compensationBasis ?? null, residencyRequirement: opportunity.residencyRequirement ?? null,
          residencyRegions: opportunity.residencyRegions ?? [], remoteStatus: opportunity.remoteStatus ?? null,
          workArrangements: opportunity.workArrangements ?? [], location: opportunity.location ?? null,
          workAuthorizationRequirement: opportunity.workAuthorizationRequirement ?? null, workAuthorizationRegions: opportunity.workAuthorizationRegions ?? [],
          visaSponsorship: opportunity.visaSponsorship ?? null, relocationSupport: opportunity.relocationSupport ?? null,
          employerOfRecordRegions: opportunity.employerOfRecordRegions ?? [],
        };
        const result = triage(facts);
        current.push(result ? { version, facts, codes: new Set(result.reasons.map((reason) => reason.code)), outcome: result.outcome } : null);
      } catch {
        renormalizationFailed = true;
        current.push(null);
      }
    }
    const primaryIndex = Math.max(0, item.versions.findIndex((version) => version.isFactsVersion));
    const primary = current[primaryIndex] ?? null;
    const texts = item.versions.map((version) => versionText(version.version));
    const primaryText = texts[primaryIndex] ?? "";
    const reasons: ReasonFinding[] = codes.map((code) => {
      const info = reasonInfo(code);
      const family = info.family;
      const kind = code === "work-authorization-unresolved" && hasField("workAuthorization", item.stored) ? "PRESENT_UNDECIDED" : info.kind;
      const familyCodes = (set: Set<string>) => [...set].filter((other) => reasonInfo(other).family === family && other !== code);
      let classification: ReasonClass;
      let evidence: string | null = null;
      let evidenceVersionId: string | null = null;
      const other = current.findIndex((entry, index) => index !== primaryIndex && entry !== null && !entry.codes.has(code));
      if (!storedNowCodes.has(code)) classification = "STALE";
      else if (primary && !primary.codes.has(code)) classification = "B_CURRENT_NORMALIZATION";
      else if (other >= 0) {
        classification = "B_OTHER_OBSERVATION";
        evidenceVersionId = item.versions[other]!.id;
      } else if (kind === "CONFIG") classification = "CONFIG";
      else if (primaryText.length < minimumEvidenceCharacters) classification = "D_EVIDENCE_INCOMPLETE";
      else if (kind === "MISSING") {
        const pattern = signals[info.signal ?? family];
        evidence = pattern ? snippet(primaryText, pattern) : null;
        classification = evidence ? "POSSIBLE_CURRENT_GAP" : "A_ABSENT";
      } else classification = "C_AMBIGUOUS";
      if (classification === "B_CURRENT_NORMALIZATION" || classification === "C_AMBIGUOUS") {
        const pattern = signals[info.signal ?? family];
        evidence = pattern ? snippet(primaryText, pattern) : null;
      }
      return {
        code, family, kind, classification,
        replacedBy: primary ? familyCodes(primary.codes) : [],
        storedValues: familyFields[family](item.stored),
        currentValues: primary ? familyFields[family](primary.facts) : null,
        evidence,
        evidenceVersionId: evidenceVersionId ?? (evidence ? item.versions[primaryIndex]?.id ?? null : null),
      };
    });
    const missingFamilies = [...new Set(reasons.filter((reason) => reason.kind === "MISSING").map((reason) => reasonInfo(reason.code).signal ?? reason.family))];
    const remaining = sorted(reasons.filter((reason) => !reason.classification.startsWith("B_") && reason.classification !== "STALE").map((reason) => shortClass[reason.classification]));
    const signature = primary && primary.outcome !== "NEEDS_REVIEW"
      ? `OUTCOME_CHANGES_TO_${primary.outcome}`
      : remaining.length ? remaining.join("+") : "RESOLVED_REASONS_BUT_OTHER_REVIEW";
    findings.push({
      id: item.id, title: item.title, company: item.company, source: item.source, site: item.site, method: item.method, readQuality: item.readQuality,
      createdDay: item.createdAt.toISOString().slice(0, 10),
      codes, storedReproduces,
      currentOutcome: primary?.outcome ?? null,
      currentCodes: primary ? sorted(primary.codes) : [],
      renormalizationFailed,
      textCharacters: primaryText.length,
      reasons,
      signature,
      duplicates: item.duplicates.map((duplicate) => ({
        relatedId: duplicate.relatedId,
        decision: duplicate.decision,
        resolution: duplicate.resolution,
        pairClass: pairClassOf(duplicate.evidence),
        sameSource: duplicate.relatedSource === item.source,
        relatedOutcome: duplicate.relatedTriage ? (duplicate.relatedTriage.manualDecision ?? duplicate.relatedTriage.outcome) : null,
        sharedCodes: duplicate.relatedTriage ? codes.filter((code) => duplicate.relatedTriage!.codes.includes(code)) : [],
        relatedHasMissingField: duplicate.relatedFacts ? missingFamilies.filter((family) => hasField(family, duplicate.relatedFacts!)) : [],
        similarity: duplicate.evidence?.similarity ?? null,
        conflicts: duplicate.evidence?.conflicts ?? [],
      })),
    });
  }
  return findings;
}

const shortClass: Record<ReasonClass, string> = {
  STALE: "STALE",
  B_CURRENT_NORMALIZATION: "B",
  B_OTHER_OBSERVATION: "B-other",
  CONFIG: "CONFIG",
  D_EVIDENCE_INCOMPLETE: "D",
  POSSIBLE_CURRENT_GAP: "GAP?",
  A_ABSENT: "A",
  C_AMBIGUOUS: "C",
};

// ---------------------------------------------------------------- report

const count = <K extends string>(values: Iterable<K>) => {
  const counts = new Map<K, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(([a, left], [b, right]) => right - left || a.localeCompare(b));
};

const classLegend: Array<[ReasonClass, string]> = [
  ["B_CURRENT_NORMALIZATION", "B: the current normalization of the same stored evidence no longer gives this reason (historical normalization)"],
  ["B_OTHER_OBSERVATION", "B (other observation): another stored source version of the job resolves it under the current normalization"],
  ["POSSIBLE_CURRENT_GAP", "Possible current gap: still missing, but the stored text mentions the subject (confirm by hand; may well be A)"],
  ["A_ABSENT", "A: missing, and no mention in enough stored text (NEEDS_REVIEW likely correct)"],
  ["C_AMBIGUOUS", "C: a value is present but does not decide the requirement (NEEDS_REVIEW likely correct)"],
  ["D_EVIDENCE_INCOMPLETE", `D: under ${minimumEvidenceCharacters} characters of stored text; cannot be judged`],
  ["CONFIG", "CONFIG: caused by the user's own configuration (work eligibility or location policy), not the posting"],
  ["STALE", "STALE: the stored facts no longer give this reason (the record or policy changed after triage)"],
];

export function formatNeedsReviewReport(input: {
  database: string;
  context: ReviewContext;
  findings: readonly CaseFinding[];
  examples: number;
}): string {
  const { findings } = input;
  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);
  const row = (label: string, value: number, total = findings.length) => `    ${label}: ${value}${total ? ` (${Math.round((value / total) * 100)}%)` : ""}`;
  push(
    "NEEDS_REVIEW diagnostic (read-only: nothing was written, fetched or sent to a provider)",
    `Database: ${input.database}`,
    `Active profile: ${input.context.activeProfile ? `version ${input.context.activeProfile.version}` : "none (current re-triage skipped)"}; work eligibility: ${input.context.eligibility ? "configured" : "not configured"}`,
    `NEEDS_REVIEW opportunities (automatic NEEDS_REVIEW, no manual decision): ${findings.length}`,
    `  stored facts re-triaged now reproduce the recorded reasons: ${findings.filter((item) => item.storedReproduces).length} of ${findings.length}`,
    `  stored evidence re-normalized in memory: ${findings.filter((item) => !item.renormalizationFailed).length} of ${findings.length} without error`,
    "",
    "1. Recorded reasons (each opportunity counted once per reason; one opportunity can have several)",
  );
  for (const [code, value] of count(findings.flatMap((item) => item.codes))) {
    const info = reasonInfo(code);
    push(`${row(code, value)}  [${info.family}; ${info.kind === "MISSING" ? "fact missing" : info.kind === "CONFIG" ? "configuration" : "fact present, undecided"}]`);
  }
  push("  Reasons per opportunity:");
  for (const [size, value] of count(findings.map((item) => `${item.codes.length} reason(s)`))) push(row(size, value));
  push("  Most common combinations:");
  for (const [combination, value] of count(findings.map((item) => item.codes.join(" + "))).slice(0, 10)) push(row(combination, value));
  push("", "2. By source and capture (each opportunity once)", "  Source / site / capture method:");
  for (const [key, value] of count(findings.map((item) => `${item.source} / ${item.site ?? "-"} / ${item.method ?? "-"}`))) push(row(key, value));
  push("  Latest read quality:");
  for (const [key, value] of count(findings.map((item) => item.readQuality ?? "(not a browser capture)"))) push(row(key, value));
  push("  Capture day (first saved):");
  for (const [key, value] of count(findings.map((item) => item.createdDay)).sort(([a], [b]) => a.localeCompare(b))) push(row(key, value));
  push("  Reason by source (source: code count):");
  for (const [source] of count(findings.map((item) => item.source))) {
    const inSource = findings.filter((item) => item.source === source);
    push(`    ${source} (${inSource.length}): ${count(inSource.flatMap((item) => item.codes)).map(([code, value]) => `${code} ${value}`).join(", ")}`);
  }
  push("", "3. Classification", "  Legend:");
  for (const [, text] of classLegend) push(`    ${text}`);
  push("  Per reason (overlapping: an opportunity with several reasons appears once per reason):");
  const reasonClasses = findings.flatMap((item) => item.reasons.map((reason) => `${reason.code} → ${shortClass[reason.classification]}`));
  for (const [key, value] of count(reasonClasses)) push(`    ${key}: ${value}`);
  push("  Per opportunity (mutually exclusive; reconciles to the total):");
  const signatures = count(findings.map((item) => item.signature));
  for (const [key, value] of signatures) push(row(key, value));
  push(`    total: ${signatures.reduce((sum, [, value]) => sum + value, 0)}`);
  push("  Under the current normalization of the stored evidence, the triage outcome would be:");
  for (const [key, value] of count(findings.map((item) => item.currentOutcome ?? "(not computed)"))) push(row(key, value));

  push("", "4. Probable duplicates");
  const withPairs = findings.filter((item) => item.duplicates.length > 0);
  const open = withPairs.filter((item) => item.duplicates.some((pair) => pair.resolution === null));
  push(`  NEEDS_REVIEW opportunities in any duplicate reference: ${withPairs.length}; with an unresolved one: ${open.length}`);
  const pairs = new Map<string, CaseFinding["duplicates"][number] & { ids: string }>();
  for (const item of findings) for (const pair of item.duplicates) pairs.set([item.id, pair.relatedId].sort().join(":"), { ...pair, ids: [item.id, pair.relatedId].sort().join(":") });
  push(`  Distinct references touching them: ${pairs.size}`);
  push("  Reference class (from the stored deduplication evidence; thresholds: shared URL/listing/requisition ID or title, location and description similarity >= 0.9 → same posting likely; any stated conflict or description similarity < 0.5 → distinct likely; otherwise uncertain):");
  for (const [key, value] of count([...pairs.values()].map((pair) => `${pair.decision} ${pair.resolution ?? "unresolved"} ${pair.pairClass} ${pair.sameSource ? "same source" : "different sources"}`))) push(`    ${key}: ${value}`);
  const allPairs = findings.flatMap((item) => item.duplicates.map((pair) => ({ item, pair })));
  push(`  Related record also NEEDS_REVIEW: ${allPairs.filter(({ pair }) => pair.relatedOutcome === "NEEDS_REVIEW").length} of ${allPairs.length} links; shares at least one reason code: ${allPairs.filter(({ pair }) => pair.sharedCodes.length > 0).length}`);
  push(`  Related record has a field this opportunity is missing: ${allPairs.filter(({ pair }) => pair.relatedHasMissingField.length > 0).length} links (${count(allPairs.flatMap(({ pair }) => pair.relatedHasMissingField)).map(([key, value]) => `${key} ${value}`).join(", ") || "none"})`);

  push("", `5. Examples (up to ${input.examples} per class)`);
  for (const [classification, text] of classLegend) {
    const examples = findings.flatMap((item) => item.reasons.filter((reason) => reason.classification === classification).map((reason) => ({ item, reason }))).slice(0, input.examples);
    if (!examples.length) continue;
    push(`  ${text.split(":")[0]}:`);
    for (const { item, reason } of examples) {
      push(
        `    ${item.id}  ${item.title ?? "(no title)"} — ${item.company ?? "Unknown company"}  [${item.source}${item.site ? `/${item.site}` : ""}, ${item.createdDay}, ${item.textCharacters} chars stored]`,
        `      reason: ${reason.code}`,
        `      stored:  ${JSON.stringify(reason.storedValues)}`,
        `      current: ${reason.currentValues ? JSON.stringify(reason.currentValues) : "(not computed)"}${reason.replacedBy.length ? `; now gives ${reason.replacedBy.join(", ")}` : ""}`,
        `      evidence: ${reason.evidence ? `"${reason.evidence}"` : "no field mention found in the stored text"}${reason.evidenceVersionId ? ` (source version ${reason.evidenceVersionId})` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
