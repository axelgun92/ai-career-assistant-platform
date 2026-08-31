import {
  burnoutRiskAffirmativeFactCatalog,
  burnoutRiskBand,
  burnoutRiskDataSchema,
  burnoutRiskSemanticInstructions,
  createProductionCustomerSuccessSemanticOperations,
  createSemanticBurnoutRiskTransportSchema,
  semanticBurnoutRiskFromAffirmativeTransport,
  semanticBurnoutRiskSchema,
  type SemanticBurnoutRisk,
} from "@ai-career/customer-success";
import type { EvidenceRecordDraft } from "@ai-career/evidence";
import type { SemanticExecutor } from "@ai-career/evaluation";
import { describe, expect, it, vi } from "vitest";
import { toBurnoutRiskProviderTransport } from "../fixtures/customer-success";

function evidence(referenceId: string, sourceText: string, changes: Partial<EvidenceRecordDraft> = {}): EvidenceRecordDraft {
  return {
    referenceId, claim: sourceText, sourceText, sourceType: "MANUAL",
    sourceReference: "synthetic-jd", sourceRecordId: null, provenanceId: null,
    sourceField: "jobDescription", criterionId: null, evidenceType: "JD_RECONSTRUCTION",
    origin: "EXPLICIT", evidenceLevel: "CONFIRMED", collectedAt: null, ...changes,
  };
}

const facts = [
  evidence("bounded", "Working hours are 9-5 with no after-hours or on-call duty."),
  evidence("travel", "Travel is limited to one optional annual company gathering."),
  evidence("implementation", "A dedicated Implementation team owns all technical implementations."),
  evidence("renewals", "Account Executives own renewals, not this role."),
  evidence("workload", "Each CSM has at most 30 accounts and a dedicated support rotation."),
  evidence("risk", "Own escalations on call every weekend while carrying a full customer portfolio."),
];

function domain(): SemanticBurnoutRisk {
  return {
    score: 52,
    scoreExplanation: "Affirmative workload demands and explicit boundaries inform a holistic assessment; unknown information is neutral.",
    scoreEvidenceReferences: ["bounded", "risk"], summary: "Supported demands coexist with explicit working-hour boundaries.",
    majorContributors: [{ finding: facts[5].sourceText!, evidenceReferences: ["risk"] }],
    positiveIndicators: [{ finding: facts[0].sourceText!, evidenceReferences: ["bounded"] }],
    unknowns: [{ code: "meeting-load", description: "Meeting load is not established.", materiality: "Completeness is limited, not a risk or mitigation.", evidenceReferences: [] }],
    evidenceReferences: ["bounded", "risk"], contradictions: [],
  };
}

describe("Burnout Risk affirmative source-fact boundary", () => {
  it.each([
    "working hours", "travel", "implementation ownership", "renewal ownership",
    "support burden", "staffing/capacity", "customer volume", "account load",
    "meeting load", "time-zone burden", "handoffs", "role boundaries",
    "multiple-job scope", "technical responsibility", "after-hours/on-call",
  ])("keeps Unknown %s outside both scoring and mitigation evidence", (dimension) => {
    const missing = evidence("missing", `${dimension} is not established.`, { evidenceLevel: "UNKNOWN" });
    const available = [...facts, missing];
    expect(burnoutRiskAffirmativeFactCatalog(available).some(fact => fact.evidenceReference === "missing")).toBe(false);
    const schema = createSemanticBurnoutRiskTransportSchema(available);
    const transport = toBurnoutRiskProviderTransport(domain(), available);
    transport.positiveIndicators[0].factIndexes = [facts.length];
    expect(schema.safeParse(transport).success).toBe(false);
    transport.positiveIndicators[0].factIndexes = [];
    expect(schema.safeParse(transport).success).toBe(false);
    const score = toBurnoutRiskProviderTransport(domain(), available);
    score.scoreFactIndexes = [facts.length];
    expect(schema.safeParse(score).success).toBe(false);
    const result = semanticBurnoutRiskFromAffirmativeTransport(toBurnoutRiskProviderTransport(domain(), available), available);
    expect(result.score).toBe(52);
    expect(result.unknowns).toEqual(domain().unknowns);
  });

  it.each(["UNKNOWN", "NOT_ESTABLISHED"])("does not treat %s as supported absence", evidenceState => {
    const value = toBurnoutRiskProviderTransport(domain(), facts);
    expect(createSemanticBurnoutRiskTransportSchema(facts).safeParse({
      ...value, positiveIndicators: [{ ...value.positiveIndicators[0], evidenceState }],
    }).success).toBe(false);
    expect(createSemanticBurnoutRiskTransportSchema(facts).safeParse({
      ...value, majorContributors: [{ ...value.majorContributors[0], evidenceState }],
    }).success).toBe(false);
  });

  it.each([0, 1, 2, 3, 4])("preserves affirmative limits/ownership/coverage fact %i as possible mitigation", index => {
    const value = toBurnoutRiskProviderTransport(domain(), facts);
    value.positiveIndicators = [{ finding: facts[index].sourceText!, effect: "SUPPORTED_MITIGATION", evidenceState: "SUPPORTED_PRESENT", factIndexes: [index] }];
    const result = semanticBurnoutRiskFromAffirmativeTransport(value, facts);
    expect(result.positiveIndicators).toEqual([{ finding: facts[index].sourceText, evidenceReferences: [facts[index].referenceId] }]);
  });

  it("preserves explicit absence, supported risks, contradictions and the historical result shape", () => {
    const original = domain();
    original.contradictions = [{ claimA: "Hours are bounded.", claimB: "Weekend on-call is required.", interpretation: "The expectations conflict.", relevantField: "workingHours", significance: "MATERIAL", evidenceReferencesA: ["bounded"], evidenceReferencesB: ["risk"] }];
    const value = toBurnoutRiskProviderTransport(original, facts);
    const result = semanticBurnoutRiskFromAffirmativeTransport({
      ...value, positiveIndicators: [{ ...value.positiveIndicators[0], evidenceState: "SUPPORTED_ABSENT" }],
    }, facts);
    expect(result).toEqual(original);
    expect(semanticBurnoutRiskSchema.parse(JSON.parse(JSON.stringify(original)))).toEqual(original);
    expect(burnoutRiskDataSchema.parse({ evaluated: true, classification: burnoutRiskBand(result.score), risk: result }).risk).toEqual(original);
    expect(JSON.stringify(result)).not.toMatch(/factIndexes|evidenceState|SUPPORTED_MITIGATION/);
  });

  it.each([-1, 0.5, 999, "bounded"])("rejects invalid fact identity %s", index => {
    const value = toBurnoutRiskProviderTransport(domain(), facts);
    expect(() => semanticBurnoutRiskFromAffirmativeTransport({ ...value, scoreFactIndexes: [index] }, facts)).toThrow();
  });

  it("rejects duplicated citations and source identifiers without merging or inventing evidence", () => {
    expect(() => burnoutRiskAffirmativeFactCatalog([...facts, facts[0]])).toThrow();
    const value = toBurnoutRiskProviderTransport(domain(), facts);
    for (const invalid of [
      { ...value, scoreFactIndexes: [0, 0] },
      { ...value, positiveIndicators: [{ ...value.positiveIndicators[0], factIndexes: [0, 0] }] },
    ]) expect(() => semanticBurnoutRiskFromAffirmativeTransport(invalid, facts)).toThrow();
  });

  it("does not promote possible, inferred, conflicting, profile-only, or sourceless records to affirmative facts", () => {
    const excluded = [
      evidence("possible", "Possible overload", { evidenceLevel: "POSSIBLE" }),
      evidence("conflict", "Conflicting hours", { evidenceLevel: "CONFLICTING" }),
      evidence("inferred", "Travel was not mentioned", { origin: "INFERRED" }),
      evidence("derived", "No mention of renewal ownership", { origin: "DERIVED" }),
      evidence("profile", "Prefers low travel", { sourceType: "USER_PROFILE" }),
      evidence("no-source", "No working hours found", { sourceText: null }),
    ];
    expect(burnoutRiskAffirmativeFactCatalog(excluded)).toEqual([]);
    expect(() => createSemanticBurnoutRiskTransportSchema(excluded)).toThrow();
  });

  it("fails an empty catalog before the executor and preserves the no-provider guarantee", async () => {
    const execute = vi.fn();
    const operations = createProductionCustomerSuccessSemanticOperations({ execute } as unknown as SemanticExecutor);
    await expect(operations.evaluateBurnoutRisk({ availableEvidence: [] } as never)).rejects.toMatchObject({ code: "BURNOUT_RISK_FACT_CATALOG_EMPTY", retryable: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([[0, "VERY_LOW"], [19, "VERY_LOW"], [20, "LOW"], [39, "LOW"], [40, "MIXED_MODERATE"], [59, "MIXED_MODERATE"], [60, "HIGH"], [79, "HIGH"], [80, "VERY_HIGH"], [100, "VERY_HIGH"]] as const)("preserves score %i and band %s", (score, band) => {
    const original = { ...domain(), score };
    expect(semanticBurnoutRiskFromAffirmativeTransport(toBurnoutRiskProviderTransport(original, facts), facts).score).toBe(score);
    expect(burnoutRiskBand(score)).toBe(band);
  });

  it("makes score and narrative Unknown neutrality explicit without a scoring formula", () => {
    expect(burnoutRiskSemanticInstructions).toContain("not a reason to increase or decrease the score");
    expect(burnoutRiskSemanticInstructions).toContain("NOT_ESTABLISHED is not SUPPORTED_ABSENT");
    expect(burnoutRiskSemanticInstructions).toContain("Summary and scoreExplanation must obey the same rule");
    expect(burnoutRiskSemanticInstructions).toContain("no weights, additive points, keyword counts, or new thresholds");
  });
});
