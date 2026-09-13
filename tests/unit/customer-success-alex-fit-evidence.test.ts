import {
  alexFitDataSchema,
  alexFitEvidenceCatalog,
  createSemanticAlexFitTransportSchema,
  customerSuccessAlexFitPromptVersion,
  semanticAlexFitFromIndexedTransport,
  semanticAlexFitFromTransport,
  semanticAlexFitSchema,
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
  createProductionCustomerSuccessSemanticOperations,
  type SemanticAlexFit,
} from "@ai-career/customer-success";
import { createEvaluationExecutor, createSemanticExecutor, StageExecutionError, type SemanticProviderRequest } from "@ai-career/evaluation";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createCustomerSuccessFixtureTransport, customerSuccessTestPreferences, toAlexFitProviderTransport } from "../fixtures/customer-success";
import { testSemanticPricing } from "../fixtures/semantic-pricing";
import { createNeutralEvaluationSubject, InMemoryEvaluationRepository } from "../support/in-memory-evaluation-repository";

const evidence = [
  { referenceId: "jd-1", sourceType: "MANUAL" },
  { referenceId: "profile-1", sourceType: "USER_PROFILE" },
  { referenceId: "company-fact", sourceType: "MANUAL" },
  { referenceId: "job-fact", sourceType: "MANUAL" },
  { referenceId: "maturity-fact", sourceType: "MANUAL" },
];

function domain(): SemanticAlexFit {
  const finding = { finding: "Supported assessment", evidenceReferences: ["jd-1", "profile-1"] };
  return {
    classification: "GOOD", summary: "Transferable fit, not literal SaaS account ownership.",
    experienceAlignment: { relationship: "TRANSFERABLE", explanation: "Teaching is transferable, not direct SaaS work.", evidenceReferences: ["jd-1", "profile-1"] },
    workingStyleAlignment: [{ area: "education", alignment: "SUPPORTED", explanation: "Supported", evidenceReferences: ["jd-1"] }],
    careerStrategyAlignment: { conclusion: "A supported bridge", evidenceReferences: ["job-fact", "profile-1"] },
    strongestMatches: [finding], partialMatches: [finding], concerns: [finding], strategicValue: [finding],
    unknowns: [{ code: "business-model", description: "Not established", materiality: "Limits confidence, not negative evidence", evidenceReferences: [] }],
    evidenceReferences: evidence.map(e => e.referenceId),
    contradictions: [{ claimA: "First claim", claimB: "Conflicting claim", interpretation: "Unresolved", relevantField: "scope", significance: "Review", evidenceReferencesA: ["job-fact"], evidenceReferencesB: ["maturity-fact"] }],
  };
}
const schema = () => createSemanticAlexFitTransportSchema(evidence);
const provider = () => schema().parse(toAlexFitProviderTransport(domain(), alexFitEvidenceCatalog(evidence)));

function indexArrays(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((item, index) => indexArrays(item, [...path, index]));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => /^evidenceIndexes(?:A|B)?$/.test(key) ? [[...path, key]] : indexArrays(child, [...path, key]));
}
function set(value: unknown, path: (string | number)[], replacement: unknown) {
  let target = value as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[path.at(-1)!] = replacement;
}
function expectNonretryable(run: () => unknown, code = "ALEX_FIT_EVIDENCE_INVALID") {
  try { run(); throw new Error("Expected failure"); }
  catch (error) { expect(error).toBeInstanceOf(StageExecutionError); expect(error).toMatchObject({ code, retryable: false }); }
}

describe("Alex Fit request-bound evidence indexes", () => {
  const paths = indexArrays(provider());
  it.each(paths.map(path => [path.join("."), path] as const))("rejects every invalid reference class at %s", (_name, path) => {
    for (const invalid of ["business-model", "product-category", "engineering-bridge-scope", "international-employment", "job-evaluation", "CORE_CS", "roleBoundaries", "GOOD_HIGH", "requirement-0", "education", "Customer Success", "arbitrary", "jd-1", "0", -1, 5, 1.5, null]) {
      const value = provider(); set(value, path, [invalid]);
      expect(schema().safeParse(value).success).toBe(false);
      expectNonretryable(() => semanticAlexFitFromIndexedTransport(value, evidence));
    }
  });
  it.each(paths.map(path => [path.join("."), path] as const))("restores JD, profile and supported upstream source evidence at %s", (_name, path) => {
    const value = provider(); set(value, path, [0, 1, 2, 3, 4]);
    const restored = semanticAlexFitFromIndexedTransport(value, evidence);
    const domainPath = path.map(key => typeof key === "string" ? key.replace("evidenceIndexes", "evidenceReferences") : key);
    let actual: unknown = restored;
    for (const key of domainPath) actual = (actual as Record<string | number, unknown>)[key];
    expect(actual).toEqual(evidence.map(e => e.referenceId));
  });
  it("keeps an identity-exact domain round trip including Unknowns and contradictions", () => {
    expect(semanticAlexFitFromIndexedTransport(provider(), evidence)).toEqual(domain());
    expect(alexFitDataSchema.parse(JSON.parse(JSON.stringify({ evaluated: true, fit: domain() })))).toEqual({ evaluated: true, fit: domain() });
    expect(semanticAlexFitFromTransport(domain(), evidence)).toEqual(domain());
    expect(semanticAlexFitSchema.parse(domain())).toEqual(domain());
  });
  it.each(["business-model", "product-category", "engineering-bridge-scope", "international-employment"])("reproduces the saved redundant Unknown-code failure without silently repairing %s", (code) => {
    const failed = domain();
    failed.careerStrategyAlignment.evidenceReferences.push(code);
    expect(semanticAlexFitSchema.safeParse(failed).success).toBe(true);
    expectNonretryable(() => semanticAlexFitFromTransport(failed, evidence));
    expect(failed.careerStrategyAlignment.evidenceReferences).toContain(code);
    // An explicitly reviewed offline projection may remove only this extra
    // invalid citation; no production fallback guesses substitute evidence.
    const projected = structuredClone(failed);
    projected.careerStrategyAlignment.evidenceReferences.pop();
    const restored = semanticAlexFitFromIndexedTransport(toAlexFitProviderTransport(projected, alexFitEvidenceCatalog(evidence)), evidence);
    expect(restored).toEqual(domain());
  });
  it("preserves duplicates in citations and deterministic catalog order", () => {
    const value = provider(); value.evidenceIndexes = [1, 0, 1];
    expect(semanticAlexFitFromIndexedTransport(value, evidence).evidenceReferences).toEqual(["profile-1", "jd-1", "profile-1"]);
    expect(alexFitEvidenceCatalog(evidence)).toEqual(alexFitEvidenceCatalog(evidence));
    expect(alexFitEvidenceCatalog([...evidence].reverse())[0]).toMatchObject({ evidenceIndex: 0, referenceId: "maturity-fact" });
  });
  it("rejects empty and ambiguous catalogs nonretryably before semantic execution", async () => {
    for (const invalid of [[], [evidence[0], evidence[0]], [{ referenceId: " ", sourceType: "MANUAL" }]]) {
      expectNonretryable(() => createSemanticAlexFitTransportSchema(invalid), "ALEX_FIT_EVIDENCE_CATALOG_INVALID");
      const execute = vi.fn();
      const operations = createProductionCustomerSuccessSemanticOperations({ execute } as never);
      await expect(operations.evaluateAlexFit({ availableEvidence: invalid } as never)).rejects.toMatchObject({ retryable: false });
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it("keeps existing evidence cardinality for supported and Unknown branches", () => {
    const value = provider();
    value.experienceAlignment = { relationship: "UNKNOWN", explanation: "Unclear", evidenceIndexes: [] };
    value.workingStyleAlignment = [{ area: "workload", alignment: "UNKNOWN", explanation: "Not established", evidenceIndexes: [] }];
    expect(semanticAlexFitFromIndexedTransport(value, evidence).experienceAlignment.evidenceReferences).toEqual([]);
    value.experienceAlignment = { relationship: "DIRECT", explanation: "Unsupported claim", evidenceIndexes: [] };
    expect(schema().safeParse(value).success).toBe(false);
    expect(schema().safeParse({ ...provider(), evidenceIndexes: [] }).success).toBe(false);
  });
  it("exposes Unknowns as context, not fabricated catalog evidence", async () => {
    const unknown = domain().unknowns[0];
    const execute = vi.fn(async () => provider());
    const operations = createProductionCustomerSuccessSemanticOperations({ execute } as never);
    const result = await operations.evaluateAlexFit({ availableEvidence: evidence, companyAlignment: { unknowns: [unknown] }, preferences: {} } as never);
    expect(result).toEqual(domain());
    const operation = execute.mock.calls[0] as unknown as [ { trustedContext: Record<string, unknown>; promptVersion: string } ];
    expect(operation[0].trustedContext.companyAlignment).toEqual({ unknowns: [unknown] });
    expect(operation[0].trustedContext.availableEvidence).toBeUndefined();
    expect(operation[0].trustedContext.availableEvidenceCatalog).toEqual(alexFitEvidenceCatalog(evidence));
    expect(operation[0].promptVersion).toBe(customerSuccessAlexFitPromptVersion);
    expect(JSON.stringify(alexFitEvidenceCatalog(evidence))).not.toContain("business-model");
  });
  it("constrains the actual generated JSON Schema, not only Zod runtime parsing", () => {
    const json = z.toJSONSchema(schema(), { unrepresentable: "any" });
    const serialized = JSON.stringify(json);
    expect(json.type).toBe("object"); expect(serialized).not.toContain('"evidenceReferences');
    function check(node: unknown, key = "") {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(n => check(n)); return; }
      const value = node as Record<string, unknown>;
      if (/^evidenceIndexes(?:A|B)?$/.test(key)) expect(value.items).toMatchObject({ type: "integer", minimum: 0, maximum: 4 });
      if (value.type === "object") { expect(value.additionalProperties).toBe(false); expect(value.required).toEqual(Object.keys(value.properties as object)); }
      for (const forbidden of ["allOf", "oneOf", "not", "if", "then", "else", "dependentRequired", "dependentSchemas", "propertyNames"]) expect(value).not.toHaveProperty(forbidden);
      for (const [child, item] of Object.entries(value)) check(item, child);
    }
    check(json);
  });
});

describe("Alex Fit complete production stage and downstream fake flow", () => {
  it("uses the real provider conversion, complete stage and unchanged downstream/public result shape", async () => {
    const subject = createNeutralEvaluationSubject();
    subject.opportunity.domain = "customer-success";
    subject.opportunity.title = "Customer Success Manager";
    subject.opportunity.companyName = "Example Technology";
    subject.opportunity.industry = "Software";
    subject.opportunity.jobDescription = "Remote United States. Salary $70,000-$90,000. Own onboarding, adoption, education, retention and business reviews.";
    subject.rawSources[0].rawDescription = subject.opportunity.jobDescription;
    subject.provenance[0].sourceText = subject.opportunity.jobDescription;
    subject.userProfile = { id: randomUUID(), version: 1, data: {
      label: "Synthetic profile", careerGoals: [{ id: "g", statement: "Build a software career" }],
      experience: [{ id: "e", statement: "Customer education through teaching, not SaaS account ownership", relationship: "TRANSFERABLE" }],
      skills: [{ id: "s", statement: "Education and analytics" }], transferableSkills: [{ id: "t", statement: "Process documentation" }],
      locationPreferences: null, compensationPreferences: null, workPreferences: null, companyPreferences: null, domainPreferences: null,
    } };
    const requests: SemanticProviderRequest[] = [];
    const fake = createCustomerSuccessFixtureTransport();
    const semantic = createSemanticExecutor({ config: { apiKey: "fake-not-a-secret", model: testSemanticPricing.model, pricing: testSemanticPricing, maxOutputTokens: 12000, timeoutMs: 1000, retryLimit: 0, callBudget: 9 },
      recorder: { async record() {} }, transport: { async execute(request) { requests.push(request); return fake.execute(request); } } });
    const repo = new InMemoryEvaluationRepository(subject);
    const { evaluation: snapshot, domainResult } = await createEvaluationExecutor(repo).execute({ opportunityId: subject.opportunity.id, userProfileId: subject.userProfile.id,
      evaluator: createCustomerSuccessEvaluator(), domainData: createCustomerSuccessDomainData({ preferences: customerSuccessTestPreferences, semanticOperations: createProductionCustomerSuccessSemanticOperations(semantic) }) });
    expect(
      snapshot.status,
      JSON.stringify(snapshot.stageResults.find((stage) => stage.status === "FAILED")),
    ).toBe("COMPLETED");
    expect(snapshot.stageResults).toHaveLength(9);
    expect(snapshot.stageResults.every(s => s.status === "COMPLETED")).toBe(true);
    const alex = snapshot.stageResults.find(s => s.stageId === "alex-fit")!;
    expect(alexFitDataSchema.safeParse(alex.result!.data).success).toBe(true);
    expect(JSON.stringify(alex.result!.data)).not.toContain("evidenceIndexes");
    const payload = JSON.parse(requests.find(r => r.operationId === "customer-success.alex-fit")!.input).trustedStructuredContext;
    expect(payload.availableEvidenceCatalog.some((e: { sourceType: string }) => e.sourceType === "USER_PROFILE")).toBe(true);
    for (const id of ["customer-success.burnout-risk", "customer-success.opportunity-priority"]) {
      const prior = JSON.parse(requests.find(r => r.operationId === id)!.input).trustedStructuredContext.alexFit;
      expect(prior).toEqual(alex.result!.data);
    }
    const resumePrior = JSON.parse(
      requests.find(
        (request) => request.operationId === "customer-success.resume-match",
      )!.input,
    ).trustedStructuredContext.alexFit;
    expect(resumePrior).toMatchObject({
      evaluated: true,
      fit: {
        classification: (alex.result!.data as { fit: { classification: string } }).fit
          .classification,
      },
    });
    expect(JSON.stringify(resumePrior)).not.toContain("actual-work");
    expect(JSON.stringify(resumePrior)).toContain("jd-0");
    expect(domainResult?.alexFit).toEqual(alex.result!.data);
    expect(snapshot.recommendation).not.toBeNull();
    expect(requests.filter(r => r.operationId === "customer-success.alex-fit")).toHaveLength(1);
  });
});
