import {
  createCustomerSuccessDomainData,
  requirementCategorySchema,
  requirementSchema,
  semanticReconstructionTransportSchema,
  createCustomerSuccessEvaluator,
  createProductionCustomerSuccessSemanticOperations,
} from "@ai-career/customer-success";
import {
  createEvaluationExecutor,
  createSemanticExecutor,
  type SemanticProviderRequest,
  type SemanticProviderTransport,
} from "@ai-career/evaluation";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCustomerSuccessFixtureTransport,
  customerSuccessTestPreferences,
} from "../fixtures/customer-success";
import { testSemanticPricing } from "../fixtures/semantic-pricing";
import {
  createNeutralEvaluationSubject,
  InMemoryEvaluationRepository,
} from "../support/in-memory-evaluation-repository";

// Semantic closure proof for the provider/application boundary: acceptance
// and every structured result are decided by structured provider fields, never
// by provider-authored wording. Each run goes through the production semantic
// executor and the real provider schemas with a deterministic fake provider.

type ProviderOutput = Record<string, unknown>;
type Mutation = (operationId: string, output: ProviderOutput) => ProviderOutput;

const jobDescription =
  "Remote United States. Salary $70,000-$90,000. Own onboarding, adoption, education, retention and business reviews. Account Management manages renewals. Requirements: Customer onboarding experience. Nonprofit fundraising experience preferred. Salesforce proficiency.";

const requirementEvidence = [
  ["jd-req-onboarding", "Customer onboarding experience."],
  ["jd-req-fundraising", "Nonprofit fundraising experience preferred."],
  ["jd-req-salesforce", "Salesforce proficiency."],
] as const;

function requirement(
  text: string,
  category: string,
  strength: string,
  reference: string,
) {
  return {
    requirement: text,
    category,
    strength,
    statedYears: null,
    statedYearsMaximum: null,
    statedYearsOpenEnded: false,
    experienceSpecificity: null,
    ...(category === "EXPERIENCE"
      ? { minimumExperienceSpecificity: "ANY_WORK_EXPERIENCE", requiresStartupExperience: false }
      : {}),
    evidenceReferences: [reference],
    ambiguity: { isAmbiguous: false, explanation: null },
    assessmentUnit: "INDEPENDENT_QUALIFICATION",
    compoundExplanation: null,
  };
}

// The shared fixture reconstructs no candidate requirements. Add three
// source-grounded requirements so Resume Match exercises dynamic requirement
// coverage, a direct match, a Genuine Gap, and an Unknown.
function withRequirements(output: ProviderOutput): ProviderOutput {
  return {
    ...output,
    evidence: [
      ...(output.evidence as unknown[]),
      ...requirementEvidence.map(([referenceId, sourceText]) => ({
        sourceIndex: 0,
        referenceId,
        claim: `The job lists the requirement: ${sourceText}`,
        sourceField: "requirements",
        sourceText,
        evidenceType: "requirement",
        origin: "EXPLICIT",
        evidenceLevel: "CONFIRMED",
      })),
    ],
    requirements: [
      requirement("Customer onboarding experience", "EXPERIENCE", "REQUIRED", "jd-req-onboarding"),
      requirement("Nonprofit fundraising experience", "INDUSTRY", "PREFERRED", "jd-req-fundraising"),
      requirement("Salesforce proficiency", "TOOL", "REQUIRED", "jd-req-salesforce"),
    ],
  };
}

function createSubject() {
  const subject = createNeutralEvaluationSubject();
  subject.opportunity.domain = "customer-success";
  subject.opportunity.title = "Customer Success Manager";
  subject.opportunity.companyName = "Example Technology";
  subject.opportunity.industry = "Software";
  subject.opportunity.jobDescription = jobDescription;
  subject.rawSources[0].rawDescription = jobDescription;
  subject.provenance[0].sourceText = jobDescription;
  subject.userProfile = {
    id: randomUUID(),
    version: 1,
    data: {
      label: "Synthetic closure profile",
      careerGoals: [{ id: "goal", statement: "Build a strategic Customer Success career." }],
      experience: [
        { id: "direct", statement: "Led customer onboarding, adoption, and education.", relationship: "DIRECT" },
        { id: "teaching", statement: "Customer education through teaching.", relationship: "TRANSFERABLE" },
      ],
      skills: [{ id: "skill", statement: "Education and analytics" }],
      transferableSkills: [{ id: "transfer", statement: "Process documentation" }],
      locationPreferences: null,
      compensationPreferences: null,
      workPreferences: null,
      companyPreferences: null,
      domainPreferences: null,
      // A structured limitation: the only kind of Genuine Gap proof.
      limitations: [
        { id: "gap", statement: "I have never worked in nonprofit fundraising and do not have fundraising experience.", category: "INDUSTRY", disclaimedExperienceSpecificity: null },
      ],
    },
  };
  return subject;
}

const defaultResumeMatch = {
  requirementClassifications: ["STRONG_MATCH", "GENUINE_GAP", "UNKNOWN"],
  matchedExperienceSpecificities: ["DIRECT_CUSTOMER_SUCCESS", "UNSUPPORTED", "UNKNOWN"],
  decisionImpacts: ["NON_DECISIVE", "MATERIAL_UNCERTAINTY", "NON_DECISIVE"],
};

async function runEvaluation(
  mutate?: Mutation,
  resumeMatch: Record<string, string[]> = defaultResumeMatch,
) {
  const subject = createSubject();
  const fixture = createCustomerSuccessFixtureTransport({
    resumeMatch: resumeMatch as never,
  });
  const requests: SemanticProviderRequest[] = [];
  const outputs = new Map<string, ProviderOutput>();
  const transport: SemanticProviderTransport = {
    async execute(request) {
      requests.push(request);
      const response = await fixture.execute(request);
      let output = JSON.parse(response.outputText) as ProviderOutput;
      if (request.operationId === "customer-success.jd-reconstruction") {
        output = withRequirements(output);
      }
      if (mutate) output = mutate(request.operationId, output);
      outputs.set(request.operationId, output);
      return { ...response, outputText: JSON.stringify(output) };
    },
  };
  const semantic = createSemanticExecutor({
    config: {
      apiKey: "fake-not-a-secret",
      model: testSemanticPricing.model,
      pricing: testSemanticPricing,
      maxOutputTokens: 12_000,
      timeoutMs: 1_000,
      retryLimit: 0,
      callBudget: 9,
    },
    recorder: { async record() {} },
    transport,
  });
  const { evaluation } = await createEvaluationExecutor(
    new InMemoryEvaluationRepository(subject),
  ).execute({
    opportunityId: subject.opportunity.id,
    userProfileId: subject.userProfile.id,
    evaluator: createCustomerSuccessEvaluator(),
    domainData: createCustomerSuccessDomainData({
      preferences: customerSuccessTestPreferences,
      semanticOperations: createProductionCustomerSuccessSemanticOperations(semantic),
    }),
  });
  return { evaluation, requests, outputs };
}

function stageData(
  evaluation: Awaited<ReturnType<typeof runEvaluation>>["evaluation"],
  stageId: string,
) {
  return evaluation.stageResults.find((stage) => stage.stageId === stageId)!
    .result!.data as Record<string, any>;
}

describe("complete offline evaluator with grounded requirements", () => {
  it("runs every stage through production schemas and finalizes deterministically", async () => {
    const { evaluation, requests } = await runEvaluation();
    expect(
      evaluation.status,
      JSON.stringify(evaluation.stageResults.find((stage) => stage.status !== "COMPLETED")),
    ).toBe("COMPLETED");
    expect(evaluation.stageResults.map((stage) => [stage.stageId, stage.status])).toEqual([
      ["hard-filters", "COMPLETED"],
      ["job-evaluation", "COMPLETED"],
      ["company-alignment", "COMPLETED"],
      ["organizational-maturity", "COMPLETED"],
      ["alex-fit", "COMPLETED"],
      ["burnout-risk", "COMPLETED"],
      ["resume-match", "COMPLETED"],
      ["opportunity-priority", "COMPLETED"],
      ["ghost-job-risk", "COMPLETED"],
    ]);
    expect(requests.map((request) => request.operationId)).toEqual([
      "customer-success.jd-reconstruction",
      "customer-success.job-evaluation",
      "customer-success.company-alignment",
      "customer-success.organizational-maturity",
      "customer-success.alex-fit",
      "customer-success.burnout-risk",
      "customer-success.resume-match",
      "customer-success.opportunity-priority",
    ]);
    const match = stageData(evaluation, "resume-match").match;
    expect(
      match.requirementAssessments.map(
        (assessment: { classification: string }) => assessment.classification,
      ),
    ).toEqual(["STRONG_MATCH", "GENUINE_GAP", "UNKNOWN", "UNKNOWN"]);
    const gap = match.requirementAssessments[1];
    expect(gap.profileEvidenceReferences).toEqual(["cs-profile-limitations-0"]);
    expect(gap.decisionImpact).toBe("MATERIAL_UNCERTAINTY");
    expect(evaluation.recommendation).not.toBeNull();
    const evidenceIds = new Set(evaluation.evidenceRecords.map((record) => record.referenceId));
    for (const reference of [
      ...match.scoreEvidenceReferences,
      ...match.requirementAssessments.flatMap(
        (assessment: { jdEvidenceReferences: string[]; profileEvidenceReferences: string[] }) => [
          ...assessment.jdEvidenceReferences,
          ...assessment.profileEvidenceReferences,
        ],
      ),
    ]) {
      expect(evidenceIds.has(reference) || reference.startsWith("cs-profile-")).toBe(true);
    }
  });
});

// Provider-authored narrative keys across all eight semantic stages. These are
// display-only: replacing them must not change acceptance or any structured
// field. Excluded on purpose: JD evidence sourceText (verbatim provenance
// checked against the source), identifiers, codes, and enums. JD requirement
// wording is rewritten separately (requirementWordingKeys) because it is also
// the exact-duplicate requirement identity.
const narrativeKeys = new Set([
  "alignmentSummary",
  "claim",
  "claimA",
  "claimB",
  "conclusion",
  "decisionImpactExplanation",
  "description",
  "explanation",
  "finding",
  "importanceExplanation",
  "interpretation",
  "materiality",
  "practicalSummary",
  "primaryWork",
  "recommendation",
  "scoreExplanation",
  "significance",
  "strategicValueSummary",
  "strengths",
  "summary",
  "supportedPortion",
  "unsupportedPortion",
]);

// JD Reconstruction requirement wording and its verbatim copies in Resume
// Match results. Legality comes only from structured requirement fields.
const requirementWordingKeys = new Set([
  "requirement",
  "experienceSpecificity",
  "requirementText",
  "requestedExperienceSpecificity",
]);

const adversarialWording = [
  "Unknown.",
  "Not established.",
  "Unclear and not demonstrated.",
  "Repeatability beyond this role was not established.",
  "Missing information; no evidence; cannot determine.",
  "Supported by [jd-999], [jd-0; jd-1] and profile-999.",
  "The candidate has direct SaaS Customer Success employment.",
];

// The relationship conclusion is application-derived and pinned by the
// request-specific grammar, so it is not provider wording.
const applicationDerivedPaths = new Set([
  "ownershipAndCrossFunctionalDesign.crossFunctionalRelationships.conclusion",
]);

// Equal original strings map to equal adversarial strings and distinct ones
// stay distinct, so only the content of the wording changes.
function adversarialRewriter() {
  const rewritten = new Map<string, string>();
  return (original: string) => {
    let value = rewritten.get(original);
    if (value === undefined) {
      value = `${adversarialWording[rewritten.size % adversarialWording.length]} #${rewritten.size}`;
      rewritten.set(original, value);
    }
    return value;
  };
}

function rewriteNarrative(
  value: unknown,
  rewrite: (original: string) => string,
  path: string[] = [],
  keys: ReadonlySet<string> = narrativeKeys,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteNarrative(item, rewrite, path, keys));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const childPath = [...path, key];
      if (
        keys.has(key) &&
        !applicationDerivedPaths.has(childPath.join("."))
      ) {
        if (typeof child === "string") return [key, rewrite(child)];
        if (Array.isArray(child) && child.every((item) => typeof item === "string")) {
          return [key, child.map(rewrite)];
        }
      }
      return [key, rewriteNarrative(child, rewrite, childPath, keys)];
    }),
  );
}

// Each run builds a fresh subject, so persistence identities differ.
const runIdentityKeys = new Set([
  "id", "evaluationId", "opportunityId", "userProfileId", "stageResultId",
  "sourceRecordId", "provenanceId", "sourceReference",
  "createdAt", "updatedAt", "startedAt", "completedAt", "collectedAt",
]);

// Remove every narrative string (including upstream narrative copied into
// downstream results) so only structured semantics are compared.
function structuredView(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuredView);
  if (value instanceof Date) return "<date>";
  if (value === null || typeof value !== "object") return value;
  const isText = (child: unknown) =>
    typeof child === "string" ||
    (Array.isArray(child) && child.every((item) => typeof item === "string"));
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      runIdentityKeys.has(key) ||
      (narrativeKeys.has(key) && isText(child)) ||
      (requirementWordingKeys.has(key) && (child === null || isText(child)))
        ? "<excluded>"
        : structuredView(child),
    ]),
  );
}

describe("provider wording is display-only across every semantic stage", () => {
  it("keeps acceptance and every structured result identical when all narrative is adversarial", async () => {
    const baseline = await runEvaluation();
    let rewrites = 0;
    const rewrite = adversarialRewriter();
    const rewritten = await runEvaluation((_operationId, output) =>
      rewriteNarrative(output, (original) => {
        rewrites += 1;
        return rewrite(original);
      }, [], new Set([...narrativeKeys, "requirement", "experienceSpecificity"])) as ProviderOutput,
    );
    expect(rewrites).toBeGreaterThan(50);
    expect(
      rewritten.evaluation.status,
      JSON.stringify(rewritten.evaluation.stageResults.find((stage) => stage.status !== "COMPLETED")),
    ).toBe("COMPLETED");
    expect(rewritten.requests.map((request) => request.operationId)).toEqual(
      baseline.requests.map((request) => request.operationId),
    );
    expect(structuredView(rewritten.evaluation.stageResults.map((stage) => stage.result?.data)))
      .toEqual(structuredView(baseline.evaluation.stageResults.map((stage) => stage.result?.data)));
    expect(structuredView(rewritten.evaluation.recommendation))
      .toEqual(structuredView(baseline.evaluation.recommendation));
    // Prose survives verbatim as display text; it is neither policed nor repaired.
    expect(JSON.stringify(stageData(rewritten.evaluation, "organizational-maturity")))
      .toContain("Repeatability beyond this role was not established.");
    // A false employment claim in prose cannot create structured direct SaaS evidence.
    const match = stageData(rewritten.evaluation, "resume-match").match;
    expect(match.requirementAssessments.map((item: { classification: string }) => item.classification))
      .toEqual(["STRONG_MATCH", "GENUINE_GAP", "UNKNOWN", "UNKNOWN"]);
  });

  it("keeps the decision and every evidence reference when all narrative shares one identical wording", async () => {
    const baseline = await runEvaluation();
    const collapsed = await runEvaluation((_operationId, output) =>
      rewriteNarrative(output, () => "Not established.") as ProviderOutput,
    );
    expect(collapsed.evaluation.status).toBe("COMPLETED");
    expect(collapsed.evaluation.recommendation!.decision)
      .toBe(baseline.evaluation.recommendation!.decision);
    expect([...collapsed.evaluation.recommendation!.evidenceReferences].sort())
      .toEqual([...baseline.evaluation.recommendation!.evidenceReferences].sort());
    expect(structuredView(collapsed.evaluation.stageResults.map((stage) => stage.result?.data)))
      .toEqual(structuredView(baseline.evaluation.stageResults.map((stage) => stage.result?.data)));
  });
});

type Injection = {
  name: string;
  operationId: string;
  stageId: string;
  failureCode: string;
  inject: (output: Record<string, any>) => void;
};

const absenceQuote = "Renewals are owned by the Account Management team.";

const injections: Injection[] = [
  {
    name: "JD Reconstruction absence quote that is not verbatim source text",
    operationId: "customer-success.jd-reconstruction",
    stageId: "hard-filters",
    failureCode: "JD_RECONSTRUCTION_ABSENCE_INVALID",
    inject(output) {
      output.evidence.push({
        sourceIndex: 0, referenceId: "renewal-absence", claim: "Renewals are excluded.",
        sourceField: null, sourceText: absenceQuote, evidenceType: "responsibilityAbsence",
        origin: "EXPLICIT", evidenceLevel: "CONFIRMED",
      });
      const renewals = output.responsibilityMap.areas.find(
        (area: { area: string }) => area.area === "renewals",
      );
      Object.assign(renewals, {
        prominence: "ABSENT", absenceBasis: "EXPLICIT_EXCLUSION", evidenceReferences: ["renewal-absence"],
      });
    },
  },
  {
    name: "JD Reconstruction experience level on an INDUSTRY requirement",
    operationId: "customer-success.jd-reconstruction",
    stageId: "hard-filters",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      // Category binding: experience semantics exist only on EXPERIENCE.
      const industry = output.requirements.find(
        (requirement: { category: string }) => requirement.category === "INDUSTRY",
      );
      industry.requirement = "Experience working with nonprofit or SMB customers";
      industry.minimumExperienceSpecificity = "DIRECT_CUSTOMER_SUCCESS";
      industry.requiresStartupExperience = false;
    },
  },
  {
    name: "Organizational Maturity NOT_ESTABLISHED dimension with positive impact",
    operationId: "customer-success.organizational-maturity",
    stageId: "organizational-maturity",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      output.ownershipAndCrossFunctionalDesign.roleBoundaries = {
        evidenceState: "NOT_ESTABLISHED", conclusion: null, evidenceReferences: [],
        semanticImpact: { impact: "SUPPORTED_POSITIVE", finding: "Clear boundaries.", affirmativeEvidenceReferences: ["product-collaboration"] },
        unknowns: [{ code: "role-boundaries", description: "Role boundaries are not established.", materiality: null, evidenceReferences: [] }],
      };
    },
  },
  {
    name: "Organizational Maturity positive impact without affirmative evidence",
    operationId: "customer-success.organizational-maturity",
    stageId: "organizational-maturity",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      output.existingCustomerSuccessFunction.semanticImpact = {
        impact: "SUPPORTED_POSITIVE", finding: "An established function.", affirmativeEvidenceReferences: [],
      };
    },
  },
  {
    name: "Organizational Maturity impact evidence outside its assessment evidence",
    operationId: "customer-success.organizational-maturity",
    stageId: "organizational-maturity",
    failureCode: "ORGANIZATIONAL_MATURITY_IMPACT_EVIDENCE_INVALID",
    inject(output) {
      output.existingCustomerSuccessFunction.semanticImpact = {
        impact: "SUPPORTED_POSITIVE", finding: "An established function.", affirmativeEvidenceReferences: ["actual-work"],
      };
    },
  },
  {
    name: "Organizational Maturity unresolved evidence identity",
    operationId: "customer-success.organizational-maturity",
    stageId: "organizational-maturity",
    failureCode: "ORGANIZATIONAL_MATURITY_EVIDENCE_INVALID",
    inject(output) {
      output.scoreEvidenceReferences.push("not-a-real-evidence-id");
    },
  },
  {
    name: "Resume Match unresolved provider evidence identity",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      output.requirementAssessments[0].jdEvidence.evidenceAssignments[0].evidenceReference = "jd-999";
    },
  },
  {
    name: "Resume Match wrong-source evidence",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      output.requirementAssessments[0].jdEvidence.evidenceAssignments[0].evidenceReference = "profile-1";
    },
  },
  {
    name: "Resume Match cross-purpose reuse of one identity",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "RESUME_MATCH_EVIDENCE_INVALID",
    inject(output) {
      const assignments = output.requirementAssessments[0].jdEvidence.evidenceAssignments;
      assignments.push({ ...assignments[0], purpose: "DECISION_IMPACT" });
    },
  },
  {
    name: "Resume Match Genuine Gap proof from evidence that does not establish the gap",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      output.requirementAssessments[1].gapEvidence.evidenceAssignments[0].evidenceReference = "profile-1";
    },
  },
  {
    name: "Resume Match Genuine Gap with no gap proof",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      output.requirementAssessments[1].gapEvidence.evidenceAssignments = [];
    },
  },
  {
    name: "Resume Match reuses one limitation as a Genuine Gap for unrelated requirements",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      // Live 7149563 shape: the onboarding EXPERIENCE and Salesforce TOOL
      // requirements cite the one fundraising limitation as gap proof.
      const gap = output.requirementAssessments.find(
        (assessment: { classification: string }) => assessment.classification === "GENUINE_GAP",
      );
      output.requirementAssessments = output.requirementAssessments.map(
        (assessment: { requirementIndex: number; jdEvidence: unknown }) =>
          assessment.requirementIndex === 0 || assessment.requirementIndex === 2
            ? { ...structuredClone(gap), requirementIndex: assessment.requirementIndex, jdEvidence: assessment.jdEvidence }
            : assessment,
      );
    },
  },
  {
    name: "Resume Match decisive impact on a preferred requirement",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      output.requirementAssessments[1].decisionImpact = "DECISIVE_DISQUALIFIER";
    },
  },
  {
    name: "Resume Match transferable evidence for a specialized industry requirement",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    inject(output) {
      const { gapEvidence: _gapEvidence, ...gap } = output.requirementAssessments[1];
      output.requirementAssessments[1] = {
        ...gap, classification: "TRANSFERABLE_MATCH", matchedExperienceSpecificity: "TRANSFERABLE",
        decisionImpact: "NON_DECISIVE", experienceEvidenceBasis: "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE",
        profileEvidence: { evidenceAssignments: [{ evidenceReference: "profile-2", purpose: "ASSESSMENT_ONLY" }] },
      };
    },
  },
  {
    name: "Resume Match omits a dynamic requirement",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "RESUME_MATCH_AUTHORITATIVE_RESULT_INVALID",
    inject(output) {
      output.requirementAssessments.splice(2, 1);
    },
  },
  {
    name: "Resume Match repeats a requirement index",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "RESUME_MATCH_AUTHORITATIVE_RESULT_INVALID",
    inject(output) {
      output.requirementAssessments.push(structuredClone(output.requirementAssessments[2]));
    },
  },
  {
    name: "Resume Match seniority evidence outside the JD catalog",
    operationId: "customer-success.resume-match",
    stageId: "resume-match",
    failureCode: "RESUME_MATCH_EVIDENCE_INVALID",
    inject(output) {
      output.effectiveSeniority.actualResponsibilitySeniority.evidenceIndexes = [999];
    },
  },
];

describe("structural failure injection through the production executor", () => {
  it.each(injections)("fails closed: $name", async (injection) => {
    const { evaluation, requests } = await runEvaluation((operationId, output) => {
      if (operationId !== injection.operationId) return output;
      const corrupted = structuredClone(output) as Record<string, any>;
      injection.inject(corrupted);
      return corrupted;
    });
    expect(evaluation.status).toBe("FAILED");
    const failed = evaluation.stageResults.find((stage) => stage.status === "FAILED")!;
    expect(failed.stageId).toBe(injection.stageId);
    expect(failed.failureCode).toBe(injection.failureCode);
    if (injection.failureCode !== "STRUCTURED_OUTPUT_INVALID") {
      expect(failed.retryable).toBe(false);
    }
    expect(requests.at(-1)!.operationId).toBe(injection.operationId);
    expect(requests.filter((request) => request.operationId === injection.operationId)).toHaveLength(1);
  });
});

// Shape of the live failure in evaluation 8c77e46f: Existing CS Function
// PARTIALLY_ESTABLISHED with SUPPORTED_POSITIVE impact and contextual Unknowns
// for staffing/capacity and operating metrics/governance, while the display
// explanation also mentions repeatability with no matching Unknown record.
function liveFailureShape(explanation: string, extraUnknowns: unknown[] = []) {
  return (operationId: string, output: ProviderOutput) => {
    if (operationId !== "customer-success.organizational-maturity") return output;
    return {
      ...output,
      existingCustomerSuccessFunction: {
        classification: "PARTIALLY_ESTABLISHED",
        explanation,
        evidenceReferences: ["cs-function", "actual-work"],
        semanticImpact: {
          impact: "SUPPORTED_POSITIVE",
          finding: "A Customer Success function owns onboarding, adoption, and retention work.",
          affirmativeEvidenceReferences: ["cs-function"],
        },
        unknowns: [
          { code: "cs-staffing-capacity", description: "Team staffing and capacity are not described.", materiality: "Limits completeness only.", evidenceReferences: [] },
          { code: "cs-operating-metrics", description: "Operating metrics and governance are not described.", materiality: "Limits completeness only.", evidenceReferences: [] },
          ...extraUnknowns,
        ],
      },
    };
  };
}

describe("latest Organizational Maturity live-failure shape", () => {
  it("converts on structure alone; the repeatability wording neither rejects nor creates semantics", async () => {
    const withClause = await runEvaluation(liveFailureShape(
      "A CS function exists with defined lifecycle work; repeatability beyond this role was not established.",
    ));
    const withoutClause = await runEvaluation(liveFailureShape(
      "A CS function exists with defined lifecycle work.",
    ));
    for (const run of [withClause, withoutClause]) {
      expect(
        run.evaluation.status,
        JSON.stringify(run.evaluation.stageResults.find((stage) => stage.status !== "COMPLETED")),
      ).toBe("COMPLETED");
    }
    const maturity = stageData(withClause.evaluation, "organizational-maturity").maturity;
    expect(maturity.existingCustomerSuccessFunction.explanation).toContain(
      "repeatability beyond this role was not established",
    );
    expect(maturity.positiveSignals).toContainEqual({
      finding: "A Customer Success function owns onboarding, adoption, and retention work.",
      evidenceReferences: ["cs-function"],
    });
    expect(maturity.unknowns.map((unknown: { code: string }) => unknown.code)).not.toContain(
      "cs-repeatability",
    );
    expect(structuredView(withClause.evaluation.stageResults.map((stage) => stage.result?.data)))
      .toEqual(structuredView(withoutClause.evaluation.stageResults.map((stage) => stage.result?.data)));
  });

  it("carries an unresolved sub-detail semantically only when it is a contextual Unknown record", async () => {
    const withoutUnknown = await runEvaluation(liveFailureShape(
      "A CS function exists with defined lifecycle work.",
    ));
    const run = await runEvaluation(liveFailureShape(
      "A CS function exists with defined lifecycle work.",
      [{ code: "cs-repeatability", description: "Repeatability beyond this role is not established.", materiality: "Limits completeness only.", evidenceReferences: [] }],
    ));
    expect(run.evaluation.status).toBe("COMPLETED");
    const maturity = stageData(run.evaluation, "organizational-maturity").maturity;
    expect(maturity.unknowns.map((unknown: { code: string }) => unknown.code)).toContain("cs-repeatability");
    expect(maturity.positiveSignals).toContainEqual({
      finding: "A Customer Success function owns onboarding, adoption, and retention work.",
      evidenceReferences: ["cs-function"],
    });
    expect(maturity.score).toBe(
      (withoutUnknown.evaluation.stageResults.find((stage) => stage.stageId === "organizational-maturity")!
        .result!.data as { maturity: { score: number } }).maturity.score,
    );
  });
});

describe("JD Reconstruction absence evidence", () => {
  it("accepts a typed, verbatim-grounded explicit exclusion regardless of its exclusion vocabulary", async () => {
    const quote = "Account Management manages renewals.";
    const run = await runEvaluation((operationId, output) => {
      if (operationId !== "customer-success.jd-reconstruction") return output;
      const changed = structuredClone(output) as Record<string, any>;
      changed.evidence.push({
        sourceIndex: 0, referenceId: "renewal-absence", claim: "Renewals are outside this role.",
        sourceField: null, sourceText: quote, evidenceType: "responsibilityAbsence",
        origin: "EXPLICIT", evidenceLevel: "CONFIRMED",
      });
      Object.assign(
        changed.responsibilityMap.areas.find((area: { area: string }) => area.area === "renewals"),
        { prominence: "ABSENT", absenceBasis: "EXPLICIT_EXCLUSION", evidenceReferences: ["renewal-absence"] },
      );
      return changed;
    });
    expect(
      run.evaluation.status,
      JSON.stringify(run.evaluation.stageResults.find((stage) => stage.status !== "COMPLETED")),
    ).toBe("COMPLETED");
  });
});

// Regression guard: no acceptance decision may depend on provider wording.
// Every text operation in Customer Success evaluator source is pinned to its
// enclosing top-level declaration with a reason. Adding a regex, keyword,
// token-overlap or other wording check anywhere else fails here and must be
// replaced with a structured provider field or deterministic derivation.
type TextDependency =
  | "SOURCE_TEXT" // deterministic parsing of job-source facts, not provider output
  | "PROVENANCE" // verbatim grounding of a quoted source excerpt
  | "IDENTITY" // exact-duplicate identity of an authoritative key
  | "DISPLAY" // presentation-only rewriting that never decides acceptance
  | "IDENTIFIER" // application identifiers or diagnostic messages
  | "USER_PROFILE_TEXT"; // the candidate's own authoritative profile statements, never provider output

const allowedTextDependencies: Record<string, { lines: number; kind: TextDependency; reason: string }> = {
  "evaluation/hard-filters.ts#salaryResult": { lines: 2, kind: "SOURCE_TEXT", reason: "country normalization of deterministically extracted location facts" },
  "evaluation/hard-filters.ts#locationResult": { lines: 3, kind: "SOURCE_TEXT", reason: "country normalization of deterministically extracted location facts" },
  "evaluation/hard-filters.ts#travelResult": { lines: 1, kind: "SOURCE_TEXT", reason: "travel frequency extracted deterministically from the job source" },
  "evaluation/resume-match.ts#assertReferenceSources": { lines: 1, kind: "IDENTIFIER", reason: "diagnostic message formatting" },
  "recommendation/recommendation.ts#createCustomerSuccessRecommendation": { lines: 1, kind: "IDENTIFIER", reason: "Unknown code prefix, an application identifier" },
  "schemas/maps.ts#semanticReconstructionFromTransport": { lines: 5, kind: "PROVENANCE", reason: "whitespace/case normalization for verbatim source grounding and exact requirement identity" },
  "schemas/resume-match.ts#restoreProviderNarrativeCitations": { lines: 4, kind: "DISPLAY", reason: "translates resolvable narrative citations; never rejects" },
  "schemas/resume-match.ts#createResumeMatchProviderInputProjection": { lines: 1, kind: "USER_PROFILE_TEXT", reason: "startup-experience flag for the candidate's own profile statements" },
  "schemas/resume-match.ts#supportsStartupSpecialization": { lines: 1, kind: "USER_PROFILE_TEXT", reason: "startup-experience evidence in the candidate's own profile statements" },
};

function textOperationsBySymbol(root: string) {
  const textOperation =
    /\.(?:test|match|matchAll|search|split|replace|replaceAll|toLowerCase|toUpperCase|startsWith|endsWith|localeCompare)\(|new RegExp\(/;
  const declaration = /^(?:export )?(?:async )?(?:function|const|let) (\w+)/;
  const found: Record<string, number> = {};
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const file = relative(root, path).replaceAll("\\", "/");
      // Deterministic extraction of explicit facts from the job source itself.
      if (file === "extraction/explicit-facts.ts") continue;
      let symbol = "<module>";
      for (const line of readFileSync(path, "utf8").split("\n")) {
        symbol = declaration.exec(line)?.[1] ?? symbol;
        if (textOperation.test(line)) {
          const key = `${file}#${symbol}`;
          found[key] = (found[key] ?? 0) + 1;
        }
      }
    }
  };
  visit(root);
  return found;
}

describe("regression guard against provider-wording gates", () => {
  it("allows text operations only where they are pinned and justified", () => {
    const found = textOperationsBySymbol(
      join(process.cwd(), "domains/customer-success/src"),
    );
    expect(found).toEqual(
      Object.fromEntries(
        Object.entries(allowedTextDependencies).map(([key, { lines }]) => [key, lines]),
      ),
    );
  });

  it("keeps Organizational Maturity, Job Evaluation, Company Alignment, Alex Fit, Burnout Risk and Opportunity Priority free of text operations", () => {
    const found = textOperationsBySymbol(
      join(process.cwd(), "domains/customer-success/src"),
    );
    for (const file of [
      "schemas/organizational-maturity.ts",
      "schemas/results.ts",
      "schemas/company-alignment.ts",
      "schemas/alex-fit.ts",
      "schemas/burnout-risk.ts",
      "schemas/opportunity-priority.ts",
      "evaluation/organizational-maturity.ts",
      "evaluation/job-evaluation.ts",
      "evaluation/company-alignment.ts",
      "evaluation/alex-fit.ts",
      "evaluation/burnout-risk.ts",
      "evaluation/opportunity-priority.ts",
    ]) {
      expect(Object.keys(found).filter((key) => key.startsWith(`${file}#`))).toEqual([]);
    }
  });
});


// Requirement-level mutation of the JD Reconstruction provider output, applied
// only to the three grounded requirements this suite adds.
function withRequirementChanges(
  change: (requirement: Record<string, any>) => void,
): Mutation {
  return (operationId, output) => {
    if (operationId !== "customer-success.jd-reconstruction") return output;
    const changed = structuredClone(output) as Record<string, any>;
    for (const requirement of changed.requirements) {
      if (String(requirement.evidenceReferences[0]).startsWith("jd-req-")) change(requirement);
    }
    return changed;
  };
}

const transferableFirstRequirement = {
  requirementClassifications: ["TRANSFERABLE_MATCH", "GENUINE_GAP", "UNKNOWN"],
  matchedExperienceSpecificities: ["TRANSFERABLE", "UNSUPPORTED", "UNKNOWN"],
  decisionImpacts: ["NON_DECISIVE", "MATERIAL_UNCERTAINTY", "NON_DECISIVE"],
};

describe("direct-work and startup legality is structured, never worded", () => {
  it("keeps legality identical when requirement wording says direct and startup but the structured fields do not", async () => {
    for (const resumeMatch of [defaultResumeMatch, transferableFirstRequirement]) {
      const baseline = await runEvaluation(undefined, resumeMatch);
      const reworded = await runEvaluation(
        withRequirementChanges((requirement) => {
          requirement.requirement = `Direct employment at an early-stage startup: ${requirement.requirement}`;
          requirement.experienceSpecificity = "Direct startup work experience";
        }),
        resumeMatch,
      );
      expect(baseline.evaluation.status).toBe("COMPLETED");
      expect(
        reworded.evaluation.status,
        JSON.stringify(reworded.evaluation.stageResults.find((stage) => stage.status !== "COMPLETED")),
      ).toBe("COMPLETED");
      expect(structuredView(reworded.evaluation.stageResults.map((stage) => stage.result?.data)))
        .toEqual(structuredView(baseline.evaluation.stageResults.map((stage) => stage.result?.data)));
      expect(reworded.requests.find((request) => request.operationId === "customer-success.resume-match")!.jsonSchema)
        .toEqual(baseline.requests.find((request) => request.operationId === "customer-success.resume-match")!.jsonSchema);
    }
  });

  it("changes legality when only the structured experience level changes", async () => {
    const markOnboardingDirect = withRequirementChanges((requirement) => {
      if (requirement.requirement === "Customer onboarding experience") {
        requirement.minimumExperienceSpecificity = "DIRECT_CUSTOMER_SUCCESS";
      }
    });
    const transferable = await runEvaluation(undefined, transferableFirstRequirement);
    expect(transferable.evaluation.status).toBe("COMPLETED");
    const direct = await runEvaluation(markOnboardingDirect, transferableFirstRequirement);
    expect(direct.evaluation.status).toBe("FAILED");
    const failed = direct.evaluation.stageResults.find((stage) => stage.status === "FAILED")!;
    expect([failed.stageId, failed.failureCode]).toEqual(["resume-match", "STRUCTURED_OUTPUT_INVALID"]);
    // Direct evidence still satisfies the direct Customer Success level.
    expect((await runEvaluation(markOnboardingDirect)).evaluation.status).toBe("COMPLETED");
  });

  it("changes legality when only the structured startup field changes", async () => {
    const markOnboardingStartup = withRequirementChanges((requirement) => {
      if (requirement.requirement === "Customer onboarding experience") {
        requirement.requiresStartupExperience = true;
      }
    });
    const startup = await runEvaluation(markOnboardingStartup);
    expect(startup.evaluation.status).toBe("FAILED");
    const failed = startup.evaluation.stageResults.find((stage) => stage.status === "FAILED")!;
    expect([failed.stageId, failed.failureCode]).toEqual(["resume-match", "STRUCTURED_OUTPUT_INVALID"]);
    // Without startup-specific profile evidence the requirement must stay Unknown.
    const unknown = await runEvaluation(markOnboardingStartup, {
      requirementClassifications: ["UNKNOWN", "GENUINE_GAP", "UNKNOWN"],
      matchedExperienceSpecificities: ["UNKNOWN", "UNSUPPORTED", "UNKNOWN"],
      decisionImpacts: ["NON_DECISIVE", "MATERIAL_UNCERTAINTY", "NON_DECISIVE"],
    });
    expect(
      unknown.evaluation.status,
      JSON.stringify(unknown.evaluation.stageResults.find((stage) => stage.status !== "COMPLETED")),
    ).toBe("COMPLETED");
  });
});

describe("specialization semantics are bound to EXPERIENCE requirements", () => {
  const transportRequirement = (category: string, specialization?: Record<string, unknown>) => ({
    requirement: "Experience working with nonprofit or SMB customers",
    category,
    ...specialization,
    strength: "NICE_TO_HAVE",
    statedYears: null,
    statedYearsMaximum: null,
    statedYearsOpenEnded: false,
    experienceSpecificity: "Nonprofit or SMB customers",
    evidenceReferences: ["jd-req-onboarding"],
    ambiguity: { isAmbiguous: false, explanation: null },
    assessmentUnit: "INDEPENDENT_QUALIFICATION",
    compoundExplanation: null,
  });
  const requirementsSchema = semanticReconstructionTransportSchema.shape.requirements;

  it("rejects either specialization field on every non-EXPERIENCE category in the provider grammar", () => {
    for (const category of requirementCategorySchema.options.filter((value) => value !== "EXPERIENCE")) {
      expect(requirementsSchema.safeParse([transportRequirement(category)]).success).toBe(true);
      for (const specialization of [
        { minimumExperienceSpecificity: "DIRECT_CUSTOMER_SUCCESS", requiresStartupExperience: false },
        { minimumExperienceSpecificity: "ANY_WORK_EXPERIENCE", requiresStartupExperience: true },
        { minimumExperienceSpecificity: "ANY_WORK_EXPERIENCE", requiresStartupExperience: false },
        // The retired direct-work field is not part of the grammar at all.
        { requiresDirectWorkExperience: false, requiresStartupExperience: false },
      ]) {
        expect(requirementsSchema.safeParse([transportRequirement(category, specialization)]).success).toBe(false);
      }
    }
  });

  it("requires both specialization fields on EXPERIENCE requirements", () => {
    expect(requirementsSchema.safeParse([transportRequirement("EXPERIENCE")]).success).toBe(false);
    expect(requirementsSchema.safeParse([
      transportRequirement("EXPERIENCE", { minimumExperienceSpecificity: "BROADER_CUSTOMER_FACING", requiresStartupExperience: false }),
    ]).success).toBe(true);
    expect(requirementsSchema.safeParse([
      transportRequirement("EXPERIENCE", { requiresDirectWorkExperience: true, requiresStartupExperience: false }),
    ]).success).toBe(false);
  });

  it("rejects persisted non-EXPERIENCE requirements that claim specialization", () => {
    const { assessmentUnit: _unit, compoundExplanation: _explanation, ...domain } = transportRequirement("INDUSTRY");
    expect(requirementSchema.safeParse(domain).success).toBe(true);
    expect(requirementSchema.safeParse({ ...domain, requiresDirectWorkExperience: false, requiresStartupExperience: false }).success).toBe(true);
    expect(requirementSchema.safeParse({ ...domain, requiresDirectWorkExperience: true }).success).toBe(false);
    expect(requirementSchema.safeParse({ ...domain, requiresStartupExperience: true }).success).toBe(false);
    expect(requirementSchema.safeParse({ ...domain, category: "EXPERIENCE", requiresDirectWorkExperience: true }).success).toBe(true);
    expect(requirementSchema.safeParse({ ...domain, minimumExperienceSpecificity: "ANY_WORK_EXPERIENCE" }).success).toBe(false);
    expect(requirementSchema.safeParse({ ...domain, category: "EXPERIENCE", minimumExperienceSpecificity: "ANY_WORK_EXPERIENCE" }).success).toBe(true);
  });

  it("converts non-EXPERIENCE requirements without specialization and keeps EXPERIENCE values", async () => {
    const { evaluation, outputs } = await runEvaluation();
    const provided = outputs.get("customer-success.jd-reconstruction")!.requirements as Array<Record<string, unknown>>;
    expect(provided.filter((requirement) => requirement.category !== "EXPERIENCE")
      .some((requirement) => "minimumExperienceSpecificity" in requirement)).toBe(false);
    const reconstruction = stageData(evaluation, "hard-filters").reconstruction as {
      requirements: Array<{ category: string; evidenceReferences: string[]; minimumExperienceSpecificity?: string; requiresDirectWorkExperience?: boolean; requiresStartupExperience?: boolean }>;
    };
    for (const requirement of reconstruction.requirements) {
      expect(requirement.requiresDirectWorkExperience).toBeUndefined();
      if (requirement.category === "EXPERIENCE") {
        // Deterministically extracted requirements assert no experience level.
        expect(typeof requirement.minimumExperienceSpecificity).toBe(
          requirement.evidenceReferences[0]!.startsWith("jd-req-") ? "string" : "undefined",
        );
      } else {
        expect([requirement.minimumExperienceSpecificity, requirement.requiresStartupExperience]).toEqual([undefined, false]);
      }
    }
    expect(reconstruction.requirements.some((requirement) => requirement.category === "INDUSTRY")).toBe(true);
  });

  it("keeps INDUSTRY direct-specialization legality through category, not the flag", async () => {
    // A transferable match for the INDUSTRY requirement stays rejected even
    // though INDUSTRY requirements no longer carry the direct-work field.
    const transferableIndustry = await runEvaluation(undefined, {
      requirementClassifications: ["STRONG_MATCH", "TRANSFERABLE_MATCH", "UNKNOWN"],
      matchedExperienceSpecificities: ["DIRECT_CUSTOMER_SUCCESS", "TRANSFERABLE", "UNKNOWN"],
      decisionImpacts: ["NON_DECISIVE", "NON_DECISIVE", "NON_DECISIVE"],
    });
    expect(transferableIndustry.evaluation.status).toBe("FAILED");
    const failed = transferableIndustry.evaluation.stageResults.find((stage) => stage.status === "FAILED")!;
    expect([failed.stageId, failed.failureCode]).toEqual(["resume-match", "STRUCTURED_OUTPUT_INVALID"]);
  });
});
