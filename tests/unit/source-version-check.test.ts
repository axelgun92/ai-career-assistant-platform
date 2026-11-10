// The Feature 14B source-version check, without a database: it rebuilds a
// stored version exactly as ingestion persisted it, uses the normalizer
// production uses for it, and its command refuses anything but the named
// database.
import { describe, expect, it } from "vitest";
import { rawOpportunitySchema, type RawOpportunity } from "@ai-career/core";
import type { StoredSourceVersion } from "@ai-career/database";
import { buildRetrievedListing } from "@ai-career/discovery";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { parseCheckArguments } from "../../apps/web/src/server/source-version-check-cli";
import { productionNormalizerFor, renormalizeStoredSourceVersion, storedRawOpportunity } from "../../apps/web/src/server/source-version-check";

// What PrismaManualOpportunityRepository stores for a RawOpportunity
// (sourceRecordData), read back as the reader selects it.
function asStored(raw: RawOpportunity): StoredSourceVersion {
  const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    id: "00000000-0000-4000-8000-000000000001",
    opportunityId: null,
    source: raw.source,
    sourceType: raw.sourceType,
    sourceUrl: raw.sourceUrl,
    applicationUrl: raw.applicationUrl,
    externalId: raw.externalId,
    requisitionId: raw.requisitionId,
    rawTitle: raw.title,
    rawCompany: raw.company,
    rawLocation: raw.location,
    rawDescription: raw.description,
    rawSalaryText: raw.salaryText,
    rawEmploymentType: raw.employmentType,
    rawPostingDate: raw.postingDate,
    sourceMetadata: raw.sourceMetadata === null ? null : json(raw.sourceMetadata),
    rawPayload: raw.rawPayload === null ? null : json(raw.rawPayload),
    retrievalType: raw.retrieval?.retrievalType ?? null,
    sourceCategory: raw.retrieval?.sourceCategory ?? null,
    retrievalSourceId: raw.retrieval?.retrievalSourceId ?? null,
    retrievalRunId: raw.retrieval?.retrievalRunId ?? null,
    contentHash: raw.retrieval?.contentHash ?? null,
    previousSourceRecordId: null,
    discoveredAt: raw.discoveredAt,
    lastObservedAt: raw.discoveredAt,
    createdAt: raw.discoveredAt,
    domain: raw.domain,
  } as StoredSourceVersion;
}

const retrieved = buildRetrievedListing(
  { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
  {
    externalId: "csm-1", title: "Customer Success Manager", company: "Rangeco", location: "Office or Remote",
    description: "Own enterprise accounts. The salary range is $105,000 - $155,000 per year (OTE). U.S. work authorization is required. Posted 2 weeks ago.",
    sourceUrl: "https://ats.example.test/csm-1", applicationUrl: null, sourceItem: { id: "csm-1" },
    postingDate: "2 weeks ago",
    sourceFacts: { seniority: ["Mid-Senior level"], remoteLocations: ["United States"] },
  },
  { domain: "customer-success", discoveredAt: new Date("2026-10-20T09:00:00.000Z") },
);

const manual = rawOpportunitySchema.parse({
  source: "manual", sourceType: "MANUAL", sourceUrl: null, applicationUrl: null, domain: "customer-success",
  externalId: null, requisitionId: null, title: "Customer Success Manager", company: "Manualco", location: null,
  description: "Hybrid role in Denver. Base salary $90,000 - $110,000 per year.", salaryText: null, employmentType: null,
  postingDate: null, sourceMetadata: null, rawPayload: null, discoveredAt: new Date("2026-10-21T09:00:00.000Z"),
});

describe("stored source version → normalization input", () => {
  it("rebuilds the RawOpportunity ingestion normalized, field for field", () => {
    expect(storedRawOpportunity(asStored(retrieved))).toEqual(rawOpportunitySchema.parse(retrieved));
    expect(storedRawOpportunity(asStored(manual))).toEqual(manual);
  });

  it("uses the normalizer production uses: retrieved for retrieval and extension versions, manual for manual entries", () => {
    expect(productionNormalizerFor(retrieved).name).toBe("createRetrievedOpportunityNormalizer");
    expect(productionNormalizerFor(manual).name).toBe("createManualOpportunityNormalizer");
  });

  it("gives exactly what the production normalizer gives for the original input", async () => {
    const fromStored = await renormalizeStoredSourceVersion(asStored(retrieved));
    const direct = await createRetrievedOpportunityNormalizer().normalize(rawOpportunitySchema.parse(retrieved));
    expect(fromStored.opportunity).toEqual(direct.opportunity);
    expect(fromStored.provenance).toEqual(direct.provenance);
    expect(fromStored.opportunity).toMatchObject({ compensationBasis: "OTE", location: "Remote (United States)", seniorityLabel: "Mid-Senior level", workAuthorizationRequirement: "RIGHT_TO_WORK" });

    const manualStored = await renormalizeStoredSourceVersion(asStored(manual));
    const manualDirect = await createManualOpportunityNormalizer().normalize(manual);
    expect(manualStored.opportunity).toEqual(manualDirect.opportunity);
    expect(manualStored.provenance).toEqual(manualDirect.provenance);
  });

  it("dates a relative posted age from when the version was observed, not from today", async () => {
    const result = await renormalizeStoredSourceVersion(asStored(retrieved));
    expect(result.opportunity.postingDate?.toISOString().slice(0, 10)).toBe("2026-10-06");
  });
});

describe("acceptance:check-source-version arguments", () => {
  const env = { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_career_assistant_acceptance?schema=public" };
  const id = "3f2b6c1e-8d4a-4b8e-9c3f-0a1b2c3d4e5f";

  it("takes the opportunity page URL (or ID) or a source version ID", () => {
    expect(parseCheckArguments(["--database", "ai_career_assistant_acceptance", "--opportunity", `http://localhost:3000/opportunities/${id}`], env))
      .toMatchObject({ ok: true, database: "ai_career_assistant_acceptance on localhost:5432", selector: { opportunityId: id } });
    expect(parseCheckArguments(["--database", "ai_career_assistant_acceptance", "--opportunity", id.toUpperCase()], env)).toMatchObject({ ok: true, selector: { opportunityId: id } });
    expect(parseCheckArguments(["--database", "ai_career_assistant_acceptance", "--source-record", id], env)).toMatchObject({ ok: true, selector: { sourceRecordId: id } });
  });

  it("refuses before reading anything unless DATABASE_URL names the database given", () => {
    expect(parseCheckArguments(["--database", "ai_career_assistant", "--opportunity", id], env))
      .toEqual({ ok: false, problem: 'DATABASE_URL points to database "ai_career_assistant_acceptance", not "ai_career_assistant". Nothing was read.' });
    expect(parseCheckArguments(["--opportunity", id], env)).toEqual({ ok: false, problem: "--database is required" });
    expect(parseCheckArguments(["--database", "ai_career_assistant_acceptance", "--opportunity", id], {})).toEqual({ ok: false, problem: "DATABASE_URL is not set" });
  });

  it("needs exactly one ID and no unknown options", () => {
    expect(parseCheckArguments(["--database", "ai_career_assistant_acceptance"], env)).toMatchObject({ ok: false });
    expect(parseCheckArguments(["--database", "ai_career_assistant_acceptance", "--opportunity", id, "--source-record", id], env)).toMatchObject({ ok: false });
    expect(parseCheckArguments(["--database", "ai_career_assistant_acceptance", "--opportunity", "not-an-id"], env)).toMatchObject({ ok: false });
    expect(parseCheckArguments(["--database", "ai_career_assistant_acceptance", "--write", "yes"], env)).toMatchObject({ ok: false, problem: "Unknown option --write" });
  });
});
