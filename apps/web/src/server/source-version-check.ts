import {
  fieldProvenanceInputSchema,
  geographyName,
  normalizedOpportunitySchema,
  rawOpportunitySchema,
  type FieldProvenanceInput,
  type NormalizedOpportunity,
  type OpportunityNormalizer,
  type RawOpportunity,
} from "@ai-career/core";
import type { StoredOpportunityFacts, StoredSourceVersion, StoredSourceVersionRead } from "@ai-career/database";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import {
  employmentTypeLabel,
  formatResidency,
  formatSalary,
  formatWorkArrangements,
  formatWorkAuthorization,
  seniorityLabel,
} from "../components/opportunity-facts";

// Feature 14B original-JD retest (acceptance and debugging only): re-runs
// one stored source version's exact evidence through the current shared
// normalization and compares the result with the opportunity's stored
// facts. Pure: it reads nothing and writes nothing itself, never calls the
// evaluator, a provider or the network, and its result is only printed.

// The RawOpportunity the source version was normalized from, rebuilt from
// what its SourceRecord stores (every field ingestion persists).
export function storedRawOpportunity(version: StoredSourceVersion): RawOpportunity {
  const metadata = version.sourceMetadata;
  return rawOpportunitySchema.parse({
    source: version.source,
    sourceType: version.sourceType,
    sourceUrl: version.sourceUrl,
    applicationUrl: version.applicationUrl,
    domain: version.domain,
    externalId: version.externalId,
    requisitionId: version.requisitionId,
    title: version.rawTitle,
    company: version.rawCompany,
    location: version.rawLocation,
    description: version.rawDescription,
    salaryText: version.rawSalaryText,
    employmentType: version.rawEmploymentType,
    postingDate: version.rawPostingDate,
    sourceMetadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null,
    rawPayload: version.rawPayload ?? null,
    discoveredAt: version.discoveredAt,
    ...(version.retrievalType && version.sourceCategory && version.contentHash
      ? {
          retrieval: {
            retrievalType: version.retrievalType,
            sourceCategory: version.sourceCategory,
            retrievalSourceId: version.retrievalSourceId,
            retrievalRunId: version.retrievalRunId,
            contentHash: version.contentHash,
          },
        }
      : {}),
  });
}

// The normalizer production ingestion uses for this kind of version:
// retrieval and browser-extension captures go through the retrieved
// normalizer (createRetrievalIngestionService), manual entries through the
// manual one.
export function productionNormalizerFor(raw: RawOpportunity): { name: string; normalizer: OpportunityNormalizer } {
  return raw.retrieval
    ? { name: "createRetrievedOpportunityNormalizer", normalizer: createRetrievedOpportunityNormalizer() }
    : { name: "createManualOpportunityNormalizer", normalizer: createManualOpportunityNormalizer() };
}

export type SourceVersionRenormalization = {
  raw: RawOpportunity;
  normalizerName: string;
  opportunity: NormalizedOpportunity;
  provenance: FieldProvenanceInput[];
};

// The version's evidence through the current normalization, validated the
// same way ingestion validates it.
export async function renormalizeStoredSourceVersion(version: StoredSourceVersion): Promise<SourceVersionRenormalization> {
  const raw = storedRawOpportunity(version);
  const { name, normalizer } = productionNormalizerFor(raw);
  const normalized = await normalizer.normalize(raw);
  return {
    raw,
    normalizerName: name,
    opportunity: normalizedOpportunitySchema.parse(normalized.opportunity),
    provenance: fieldProvenanceInputSchema.array().parse(normalized.provenance),
  };
}

type Facts = {
  title: string | null;
  companyName: string | null;
  location: string | null;
  remoteStatus: string | null;
  workArrangements: string[];
  employmentType: string | null;
  seniority: string | null;
  seniorityLabel: string | null;
  timeZoneRequirements: string | null;
  residencyRequirement: string | null;
  residencyRegions: string[];
  workAuthorizationRequirement: string | null;
  workAuthorizationRegions: string[];
  visaSponsorship: string | null;
  relocationSupport: string | null;
  employerOfRecordRegions: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string | null;
  compensationBasis: string | null;
  currency: string | null;
  compensationNotes: string | null;
  postingDate: Date | null;
  closingDate: Date | null;
  canonicalUrl: string | null;
  applicationUrl: string | null;
  externalListingId: string | null;
  atsRequisitionId: string | null;
  jobDescription: string | null;
};

const decimal = (value: unknown): number | null => (value === null || value === undefined ? null : Number(String(value)));

function storedFacts(stored: StoredOpportunityFacts): Facts {
  return {
    ...stored,
    companyName: stored.company?.name ?? null,
    salaryMin: decimal(stored.salaryMin),
    salaryMax: decimal(stored.salaryMax),
  };
}

function normalizedFacts(opportunity: NormalizedOpportunity): Facts {
  return {
    ...opportunity,
    seniorityLabel: opportunity.seniorityLabel ?? null,
    workArrangements: opportunity.workArrangements ?? [],
    salaryMin: decimal(opportunity.salaryMin),
    salaryMax: decimal(opportunity.salaryMax),
  };
}

const unknown = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? "Unknown" : value);
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const oneLine = (value: string | null) => (value ? value.replace(/\s+/g, " ").trim() : null);

// Each compared fact as the product shows it (the same display helpers as
// the opportunity page), with the provenance fields it is recorded under.
const rows: Array<{ label: string; show: (facts: Facts) => string | null; provenance: string[] }> = [
  { label: "Title", show: (f) => f.title, provenance: ["title"] },
  { label: "Company", show: (f) => f.companyName, provenance: ["company.name"] },
  { label: "Location", show: (f) => f.location, provenance: ["location"] },
  { label: "Work arrangement", show: (f) => formatWorkArrangements(f), provenance: ["remoteStatus", "workArrangements"] },
  { label: "Employment type", show: (f) => (f.employmentType ? employmentTypeLabel(f.employmentType) : null), provenance: ["employmentType"] },
  { label: "Seniority", show: (f) => (f.seniority ? seniorityLabel(f.seniority) : null), provenance: ["seniority"] },
  { label: "Seniority label (as stated)", show: (f) => f.seniorityLabel, provenance: ["seniorityLabel"] },
  { label: "Time zone", show: (f) => f.timeZoneRequirements, provenance: ["timeZoneRequirements"] },
  { label: "Location eligibility", show: (f) => (f.residencyRequirement ? formatResidency(f.residencyRequirement, f.residencyRegions) : null), provenance: ["residencyRequirement", "residencyRegions"] },
  { label: "Work authorization", show: (f) => formatWorkAuthorization(f, geographyName), provenance: ["workAuthorizationRequirement", "workAuthorizationRegions", "visaSponsorship", "relocationSupport", "employerOfRecordRegions"] },
  { label: "Salary (as shown)", show: (f) => formatSalary(f), provenance: ["salaryMin", "salaryMax", "currency", "compensationBasis"] },
  { label: "Salary minimum", show: (f) => (f.salaryMin === null ? null : String(f.salaryMin)), provenance: ["salaryMin"] },
  { label: "Salary maximum", show: (f) => (f.salaryMax === null ? null : String(f.salaryMax)), provenance: ["salaryMax"] },
  { label: "Currency", show: (f) => f.currency, provenance: ["currency"] },
  { label: "Compensation basis", show: (f) => f.compensationBasis, provenance: ["compensationBasis"] },
  { label: "Compensation text", show: (f) => oneLine(f.salaryText), provenance: ["salaryText"] },
  { label: "Compensation notes", show: (f) => oneLine(f.compensationNotes), provenance: ["compensationNotes"] },
  { label: "Posting date", show: (f) => day(f.postingDate), provenance: ["postingDate"] },
  { label: "Closing date", show: (f) => day(f.closingDate), provenance: ["closingDate"] },
  { label: "Posting URL", show: (f) => f.canonicalUrl, provenance: ["canonicalUrl"] },
  { label: "Application URL", show: (f) => f.applicationUrl, provenance: ["applicationUrl"] },
  { label: "Listing ID", show: (f) => f.externalListingId, provenance: ["externalListingId"] },
  { label: "Requisition ID", show: (f) => f.atsRequisitionId, provenance: ["atsRequisitionId"] },
  { label: "Description length", show: (f) => (f.jobDescription ? `${f.jobDescription.length} characters` : null), provenance: ["jobDescription"] },
];

export type SourceVersionComparisonRow = {
  label: string;
  stored: string;
  current: string;
  differs: boolean;
  // The provenance markers the current normalization records for the fact.
  markers: string[];
};

export function compareWithStoredFacts(stored: StoredOpportunityFacts | null, result: SourceVersionRenormalization): SourceVersionComparisonRow[] {
  const before = stored ? storedFacts(stored) : null;
  const after = normalizedFacts(result.opportunity);
  return rows.map((row) => {
    const storedValue = before ? unknown(row.show(before)) : "(no opportunity)";
    const currentValue = unknown(row.show(after));
    const markers = [...new Set(result.provenance.filter((entry) => row.provenance.includes(entry.fieldName)).map((entry) => entry.sourceField))];
    return { label: row.label, stored: storedValue, current: currentValue, differs: before !== null && storedValue !== currentValue, markers };
  });
}

// The plain-text report the acceptance command prints.
export function formatSourceVersionCheck(input: {
  database: string;
  read: StoredSourceVersionRead;
  result: SourceVersionRenormalization;
}): string {
  const { read, result } = input;
  const comparison = compareWithStoredFacts(read.opportunity, result);
  const lines = [
    "Feature 14B source-version check (read-only: nothing was written)",
    `Database:        ${input.database}`,
    `Opportunity:     ${read.opportunity?.id ?? "(none: this version was never normalized into an opportunity)"}`,
    `Source version:  ${read.version.id}`,
    `  source:        ${read.version.source}`,
    `  page:          ${read.version.sourceUrl ?? "Unknown"}`,
    `  first saved:   ${read.version.createdAt.toISOString()}`,
    `  last observed: ${read.version.lastObservedAt.toISOString()}`,
    `Normalizer:      ${result.normalizerName} (the production Feature 14B path, current code)`,
  ];
  if (read.opportunity && read.currentFactsVersionId && read.currentFactsVersionId !== read.version.id) {
    lines.push(`Note: the stored facts were projected from another source version (${read.currentFactsVersionId}).`);
  }
  lines.push(
    "",
    "STORED NOW = what the app shows today (normalized when the version was saved).",
    "CURRENT    = the same stored evidence through the current normalization.",
    "",
  );
  for (const row of comparison) {
    lines.push(`${row.differs ? "*" : " "} ${row.label}`);
    lines.push(`    stored now: ${row.stored}`);
    lines.push(`    current:    ${row.current}${row.markers.length ? `   [${row.markers.join(", ")}]` : ""}`);
  }
  const changed = comparison.filter((row) => row.differs).length;
  lines.push(
    "",
    read.opportunity
      ? changed
        ? `${changed} fact(s) marked * differ: the current normalization reads this stored evidence differently from the stored record.`
        : "No differences: the current normalization reads this stored evidence the same way as the stored record."
      : "No stored opportunity to compare with.",
    "Nothing in the database was changed. The app keeps showing the stored values until the posting itself changes.",
  );
  if (read.versions.length > 1) {
    lines.push("", "Other source versions of this opportunity (use --source-record <id> to check one):");
    for (const version of read.versions) {
      if (version.id === read.version.id) continue;
      lines.push(`  ${version.id}  ${version.source}  last observed ${version.lastObservedAt.toISOString()}  ${version.sourceUrl ?? ""}`.trimEnd());
    }
  }
  return lines.join("\n");
}
