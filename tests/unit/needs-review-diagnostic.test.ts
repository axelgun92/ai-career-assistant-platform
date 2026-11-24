// The NEEDS_REVIEW diagnostic's classification rules (November 24, 2026),
// with a fake normalization: a possible current gap (the text mentions the
// subject, the normalization still misses it), B via another stored
// observation, a stale reason, a reason caused by the user's configuration,
// work authorization missing versus stated, the duplicate-evidence classes,
// and the command's arguments.
import { describe, expect, it } from "vitest";
import type { NormalizedOpportunity, PreEvaluatorTriageReason } from "@ai-career/core";
import type { StoredSourceVersion } from "@ai-career/database";
import { parseDiagnosticArguments } from "../../apps/web/src/server/needs-review-diagnostic-cli";
import { analyzeNeedsReview, pairClassOf, type ReviewCase, type ReviewContext } from "../../apps/web/src/server/needs-review-diagnostic";
import { customerSuccessTestPreferences } from "../fixtures/customer-success";

const context: ReviewContext = { activeProfile: { id: "p", version: 1, domainPreferences: { customerSuccess: customerSuccessTestPreferences } }, eligibility: null };
const long = "Own onboarding, adoption and renewals for SaaS customers. ".repeat(12);
const remoteUs = {
  salaryMin: 80000, salaryMax: 95000, currency: "USD", compensationBasis: null, residencyRequirement: "US_REQUIRED" as const, residencyRegions: ["US"],
  remoteStatus: "REMOTE", workArrangements: ["REMOTE" as const], location: "Remote - United States", workAuthorizationRequirement: null,
  workAuthorizationRegions: [], visaSponsorship: null, relocationSupport: null, employerOfRecordRegions: [],
};
const version = (id: string, description: string): StoredSourceVersion =>
  ({ id, rawTitle: "Customer Success Manager", rawLocation: "Remote - United States", rawSalaryText: null, rawDescription: description, sourceMetadata: {} }) as unknown as StoredSourceVersion;
const reason = (code: string): PreEvaluatorTriageReason => ({ code, fields: [], disposition: "NEEDS_REVIEW", message: code });
const item = (id: string, stored: ReviewCase["stored"], codes: string[], versions: Array<[string, string]>): ReviewCase => ({
  id, title: "Customer Success Manager", company: "Acme", status: "NORMALIZED", source: "browser-extension", sourceType: "BROWSER_EXTENSION",
  createdAt: new Date("2026-11-01T00:00:00Z"), site: "linkedin", method: "batch", readQuality: "COMPLETE",
  reasons: codes.map(reason), assessedProfileVersion: 1, stored,
  versions: versions.map(([versionId, text], index) => ({ id: versionId, source: "browser-extension", createdAt: new Date(), isFactsVersion: index === 0, version: version(versionId, text) })),
  duplicates: [],
});
// The fake normalization: each version's facts by its ID.
const normalized = (facts: Record<string, Partial<NormalizedOpportunity>>) => async (stored: StoredSourceVersion) =>
  ({ opportunity: { ...remoteUs, ...facts[stored.id] } as unknown as NormalizedOpportunity });

describe("the NEEDS_REVIEW diagnostic's classification", () => {
  it("flags a reason whose subject the stored text mentions as a possible current gap, never as a defect", async () => {
    const stored = { ...remoteUs, salaryMin: null, salaryMax: null, currency: null };
    const [finding] = await analyzeNeedsReview(
      [item("gap", stored, ["salary-unknown-salary"], [["v1", `${long} Pay: $80k to $95k depending on experience.`]])],
      context,
      normalized({ v1: { salaryMin: null, salaryMax: null, currency: null } }),
    );
    expect(finding!.reasons[0]).toMatchObject({ classification: "POSSIBLE_CURRENT_GAP" });
    expect(finding!.reasons[0]!.evidence).toContain("$80k");
    expect(finding!.signature).toBe("GAP?");
  });

  it("counts a reason another stored observation resolves as B (other observation), and names that version", async () => {
    const stored = { ...remoteUs, salaryMin: null, salaryMax: null, currency: null };
    const [finding] = await analyzeNeedsReview(
      [item("other", stored, ["salary-unknown-salary"], [["facts", long], ["later", `${long} Base salary $80,000-$95,000.`]])],
      context,
      normalized({ facts: { salaryMin: null, salaryMax: null, currency: null }, later: {} }),
    );
    expect(finding!.reasons[0]).toMatchObject({ classification: "B_OTHER_OBSERVATION", evidenceVersionId: "later" });
    expect(finding!.currentOutcome).toBe("NEEDS_REVIEW");
    expect(finding!.signature).toBe("RESOLVED_REASONS_BUT_OTHER_REVIEW");
  });

  it("marks a reason the stored facts no longer give as STALE, and one caused by configuration as CONFIG", async () => {
    const findings = await analyzeNeedsReview(
      [
        item("stale", remoteUs, ["salary-unknown-salary"], [["s1", long]]),
        item("config", { ...remoteUs, workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"] }, ["work-eligibility-not-configured"], [["c1", long]]),
      ],
      context,
      normalized({ c1: { workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"] } }),
    );
    expect(findings[0]!.reasons[0]!.classification).toBe("STALE");
    expect(findings[0]!.storedReproduces).toBe(false);
    expect(findings[1]!.reasons[0]!.classification).toBe("CONFIG");
  });

  it("treats unresolved work authorization as missing only when the posting states no authorization fact", async () => {
    const eligible: ReviewContext = { ...context, eligibility: { authorizedRegions: ["GB"], citizenshipRegions: ["GB"] } };
    const findings = await analyzeNeedsReview(
      [
        item("silent", remoteUs, ["work-authorization-unresolved"], [["a1", long]]),
        item("sponsor", { ...remoteUs, visaSponsorship: "AVAILABLE" }, ["work-authorization-unresolved"], [["a2", long]]),
      ],
      eligible,
      normalized({ a2: { visaSponsorship: "AVAILABLE" } }),
    );
    expect(findings[0]!.reasons[0]).toMatchObject({ kind: "MISSING", classification: "A_ABSENT" });
    expect(findings[1]!.reasons[0]).toMatchObject({ kind: "PRESENT_UNDECIDED", classification: "C_AMBIGUOUS" });
  });
});

describe("probable-duplicate evidence", () => {
  const base = { matchedOn: ["title"], conflicts: [], sharedUrlKeys: [], sharedListingIds: [], sharedRequisitionIds: [] };
  it("uses the stored evidence and stated thresholds, never the decision alone", () => {
    expect(pairClassOf(null)).toBe("UNCERTAIN");
    expect(pairClassOf({ ...base, sharedRequisitionIds: ["R1"] })).toBe("SAME_POSTING_LIKELY");
    expect(pairClassOf({ ...base, similarity: { title: 1, location: 0.95, description: 0.92 } })).toBe("SAME_POSTING_LIKELY");
    expect(pairClassOf({ ...base, conflicts: ["location"], similarity: { title: 1, location: 0.2, description: 0.95 } })).toBe("DISTINCT_LIKELY");
    expect(pairClassOf({ ...base, similarity: { title: 1, location: 1, description: 0.3 } })).toBe("DISTINCT_LIKELY");
    expect(pairClassOf({ ...base, similarity: { title: 1, location: 1, description: 0.7 } })).toBe("UNCERTAIN");
  });
});

describe("the command's arguments", () => {
  const environment = { DATABASE_URL: "postgresql://user:secret@localhost:5432/ai_career_assistant_acceptance" };
  it("requires the database DATABASE_URL names, and never echoes the URL", () => {
    expect(parseDiagnosticArguments(["--database", "ai_career_assistant_acceptance"], environment)).toMatchObject({ ok: true, examples: 3, jsonFile: null });
    const wrong = parseDiagnosticArguments(["--database", "other"], environment);
    expect(wrong).toEqual({ ok: false, problem: 'DATABASE_URL points to database "ai_career_assistant_acceptance", not "other". Nothing was read.' });
    expect(JSON.stringify(wrong)).not.toContain("secret");
    expect(parseDiagnosticArguments([], environment)).toEqual({ ok: false, problem: "--database is required" });
    expect(parseDiagnosticArguments(["--database", "ai_career_assistant_acceptance", "--examples", "11"], environment)).toMatchObject({ ok: false });
    expect(parseDiagnosticArguments(["--database", "ai_career_assistant_acceptance", "--json"], environment)).toEqual({ ok: false, problem: "--json needs a value" });
    expect(parseDiagnosticArguments(["--database", "ai_career_assistant_acceptance", "--json", "/tmp/x.json", "--examples", "5"], environment)).toMatchObject({ ok: true, examples: 5, jsonFile: "/tmp/x.json" });
  });
});
