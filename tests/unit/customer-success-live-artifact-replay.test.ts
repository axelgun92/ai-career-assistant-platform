import {
  createResumeMatchProviderInputProjection,
  createSemanticOrganizationalMaturityTransportSchema,
  createSemanticResumeMatchTransportSchema,
  organizationalMaturityRelationshipCatalog,
  semanticOrganizationalMaturityFromTransport,
  semanticResumeMatchFromTransport,
  semanticResumeMatchJobEvidenceCatalog,
  semanticResumeMatchRequirementsForProvider,
  semanticReconstructionFromTransport as restoreSemanticReconstructionFromTransport,
  semanticReconstructionTransportSchema,
  requirementMapSchema,
  outdatedResumeMatchRequirementIndexes,
  reconcileRequirementMap,
  reconstructCustomerSuccessJob,
  resumeMatchBand,
} from "@ai-career/customer-success";
import { createCustomerSuccessRecommendation } from "../../domains/customer-success/src/recommendation/recommendation";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { alexandraNugentCustomerSuccessProfile } from "../../apps/web/src/server/profile-import/alexandra-nugent-customer-success-profile";
import { toRequirementStatementTransport } from "../fixtures/customer-success";

// Offline replay of preserved live checkpoint artifacts (request + raw
// response). The artifacts contain personal profile and job data, so they stay
// outside the repository: set LIVE_REPLAY_DIR to the checkpoint directory.
// Artifacts are read, never modified. Diagnostic isolation runs operate on
// in-memory copies and never count as acceptance.
const replayDirectory = process.env.LIVE_REPLAY_DIR;
const replayReport = process.env.LIVE_REPLAY_REPORT;

function artifact(suffix: string) {
  const name = readdirSync(replayDirectory!).find((file) => file.endsWith(suffix));
  if (!name) throw new Error(`Missing replay artifact ending in ${suffix}`);
  return JSON.parse(readFileSync(join(replayDirectory!, name), "utf8"));
}

function providerOutput(response: { output: Array<{ type: string; content?: Array<{ type: string; text: string }> }> }) {
  const message = response.output.find((item) => item.type === "message")!;
  return JSON.parse(message.content!.find((item) => item.type === "output_text")!.text);
}

function failure(run: () => unknown) {
  try {
    return { accepted: true as const, result: run() };
  } catch (error) {
    const value = error as { code?: string; message?: string; retryable?: boolean };
    return {
      accepted: false as const,
      code: value.code ?? (error instanceof z.ZodError ? "ZOD_ERROR" : "UNKNOWN"),
      message: value.message?.slice(0, 300),
      retryable: value.retryable,
    };
  }
}

const report: Record<string, unknown> = {};

describe.skipIf(!replayDirectory || !existsSync(replayDirectory))("live checkpoint artifact replay", () => {
  it("replays Organizational Maturity evaluation 8c77e46f through the production conversion path", () => {
    const request = artifact("call-04-organizational-maturity-request.json");
    const response = artifact("call-04-organizational-maturity-raw-response.json");
    expect(request.metadata.operation).toBe("customer-success.organizational-maturity");
    const context = JSON.parse(request.input).trustedStructuredContext;
    const catalog = organizationalMaturityRelationshipCatalog(
      context.ownershipMap,
      context.availableEvidence,
    );
    // Fidelity: request-time catalog and provider grammar are reproduced exactly.
    expect(catalog).toEqual(context.crossFunctionalRelationshipCatalog);
    const schema = createSemanticOrganizationalMaturityTransportSchema(
      context.responsibilityMap,
      catalog,
    );
    const currentSchema = z.toJSONSchema(schema, { unrepresentable: "any" });
    const output = providerOutput(response);
    const providerSchemaParse = schema.safeParse(output);
    const conversion = failure(() =>
      semanticOrganizationalMaturityFromTransport(
        providerSchemaParse.success ? providerSchemaParse.data : output,
        context.availableEvidence,
        context.responsibilityMap,
        catalog,
      ),
    );
    // The live rejection came only from the explanation sentence about
    // repeatability. An in-memory copy without that sentence must convert to
    // the identical structured result: the wording carries no semantics.
    const withoutRepeatability = structuredClone(output);
    withoutRepeatability.existingCustomerSuccessFunction.explanation =
      withoutRepeatability.existingCustomerSuccessFunction.explanation.replace(
        / The broader function's staffing.*$/,
        "",
      );
    const control = failure(() =>
      semanticOrganizationalMaturityFromTransport(
        withoutRepeatability,
        context.availableEvidence,
        context.responsibilityMap,
        catalog,
      ),
    );
    report.organizationalMaturity = {
      providerSchemaIdenticalToRequest:
        JSON.stringify(currentSchema) === JSON.stringify(request.text.format.schema),
      providerSchemaAccepted: providerSchemaParse.success,
      providerSchemaIssues: providerSchemaParse.success ? [] : providerSchemaParse.error.issues.slice(0, 10),
      conversion: { ...conversion, result: undefined },
      existingCustomerSuccessFunction: output.existingCustomerSuccessFunction,
    };
    expect(JSON.stringify(currentSchema)).toBe(JSON.stringify(request.text.format.schema));
    expect(providerSchemaParse.success).toBe(true);
    expect(output.existingCustomerSuccessFunction.explanation).toContain(
      "repeatability beyond this role are not established",
    );
    expect(conversion.accepted).toBe(true);
    expect(control.accepted).toBe(true);
    const structured = (value: unknown) => {
      const maturity = structuredClone(value) as Record<string, any>;
      delete maturity.existingCustomerSuccessFunction.explanation;
      return maturity;
    };
    expect(structured(conversion.result)).toEqual(structured(control.result));
    const maturity = conversion.result as { positiveSignals: unknown[]; unknowns: Array<{ code: string }> };
    expect(maturity.positiveSignals).toContainEqual({
      finding: output.existingCustomerSuccessFunction.semanticImpact.finding,
      evidenceReferences: output.existingCustomerSuccessFunction.semanticImpact.affirmativeEvidenceReferences,
    });
    expect(maturity.unknowns.map((unknown) => unknown.code)).toEqual(
      expect.arrayContaining(["cs-function-staffing-and-capacity", "cs-function-metrics"]),
    );
  });

  it("replays Resume Match evaluation cdb1dc32 through the production conversion path", () => {
    const request = artifact("call-07-resume-match-request.json");
    const response = artifact("call-07-resume-match-raw-response.json");
    expect(request.metadata.operation).toBe("customer-success.resume-match");
    const context = JSON.parse(request.input).trustedStructuredContext;
    // Request-time inventories in provider order. Real Core identities never
    // reached the provider, so each gets a distinct Core identity; restoration
    // then translates provider-local references exactly as in production.
    // They follow the real JD Reconstruction style (E1, E2, ...).
    const coreByProvider = new Map<string, string>(
      [...context.jdEvidenceCatalog, ...context.profileEvidenceCatalog].map(
        (entry: { evidenceReference: string }, index: number) => [entry.evidenceReference, `E${index + 1}`],
      ),
    );
    const core = (providerReference: string) => coreByProvider.get(providerReference)!;
    const availableEvidence = [
      ...context.jdEvidenceCatalog.map((entry: Record<string, any>) => ({
        referenceId: core(entry.evidenceReference),
        claim: entry.statement,
        sourceType: entry.sourceType,
        sourceField: entry.sourceField,
        sourceText: entry.sourceExcerpt ?? entry.statement,
        evidenceType: entry.evidenceType,
        origin: entry.origin,
        evidenceLevel: entry.evidenceLevel,
      })),
      ...context.profileEvidenceCatalog.map((entry: Record<string, any>) => ({
        referenceId: core(entry.evidenceReference),
        claim: entry.statement,
        sourceType: "USER_PROFILE",
        sourceField: entry.sourceField,
        sourceText: entry.sourceExcerpt ?? entry.statement,
        evidenceType: entry.evidenceType,
        origin: entry.origin,
        evidenceLevel: entry.evidenceLevel,
      })),
    ];
    const projection = createResumeMatchProviderInputProjection(availableEvidence);
    expect(projection.jdEvidenceCatalog).toEqual(context.jdEvidenceCatalog);
    expect(projection.profileEvidenceCatalog).toEqual(context.profileEvidenceCatalog);
    // Ambiguous requirements are withheld from the provider by design, so the
    // request omits their content. Their positions are known from the gaps in
    // requirementIndex; ambiguous placeholders keep the authoritative indexes.
    // An ambiguous requirement is never provider-assessed, so placeholder text
    // cannot influence validation of the provider output.
    const providerRequirements = context.requirementMap as Array<Record<string, any>>;
    const requirementCount = Math.max(...providerRequirements.map((item) => item.requirementIndex)) + 1;
    const ambiguousIndexes: number[] = [];
    const requirementMap = Array.from({ length: requirementCount }, (_, index) => {
      const provided = providerRequirements.find((item) => item.requirementIndex === index);
      if (provided) {
        const { requirementIndex: _requirementIndex, ...requirement } = provided;
        return {
          ...requirement,
          evidenceReferences: (requirement.evidenceReferences as string[]).map(core),
        };
      }
      ambiguousIndexes.push(index);
      return {
        requirement: `Withheld ambiguous requirement ${index}`,
        category: "CAPABILITY",
        strength: "AMBIGUOUS",
        statedYears: null,
        statedYearsMaximum: null,
        statedYearsOpenEnded: false,
        experienceSpecificity: null,
        evidenceReferences: [core(context.jdEvidenceCatalog[0].evidenceReference)],
        ambiguity: { isAmbiguous: true, explanation: "Withheld from the provider as ambiguous." },
      };
    });
    expect(
      semanticResumeMatchRequirementsForProvider(
        requirementMap,
        projection.providerReferenceByCoreReference,
      ),
    ).toEqual(providerRequirements);
    const jobEvidenceCatalog = semanticResumeMatchJobEvidenceCatalog(availableEvidence);
    const output = providerOutput(response);
    const currentSchema = createSemanticResumeMatchTransportSchema(
      projection.schemaEvidence,
      requirementMap,
    );
    const rawAgainstCurrentSchema = currentSchema.safeParse(output);
    const convert = (value: unknown) =>
      failure(() =>
        semanticResumeMatchFromTransport(
          value,
          requirementMap,
          availableEvidence,
          jobEvidenceCatalog,
          projection,
        ),
      );
    // Isolation diagnostics: production conversion stops at the first
    // violation. Each run keeps one original assessment and replaces the others
    // with structurally neutral UNKNOWN assessments so every assessment is
    // judged by the unchanged production code.
    const neutral = (assessment: Record<string, any>) => ({
      requirementIndex: assessment.requirementIndex,
      classification: "UNKNOWN",
      matchedExperienceSpecificity: "UNKNOWN",
      experienceEvidenceBasis: "UNKNOWN",
      importanceExplanation: "Replay isolation placeholder.",
      decisionImpact: "NON_DECISIVE",
      decisionImpactExplanation: "Replay isolation placeholder.",
      explanation: "Replay isolation placeholder.",
      supportedPortion: null,
      unsupportedPortion: null,
      jdEvidence: {
        decisionImpactReferences: [],
        assessmentOnlyReferences: providerRequirements.find(
          (item) => item.requirementIndex === assessment.requirementIndex,
        )!.evidenceReferences,
      },
      profileEvidence: { decisionImpactReferences: [], assessmentOnlyReferences: [] },
    });
    const assessments = output.requirementAssessments as Array<Record<string, any>>;
    const isolated = assessments.map((kept) => ({
      requirementIndex: kept.requirementIndex,
      classification: kept.classification,
      result: convert({
        ...output,
        requirementAssessments: assessments.map((assessment) =>
          assessment === kept ? assessment : neutral(assessment),
        ),
      }),
    }));
    const envelope = convert({ ...output, requirementAssessments: assessments.map(neutral) });
    const fullConversion = convert(output);
    const strip = (result: ReturnType<typeof convert>) => ({ ...result, result: undefined });
    // Normalization of the historical grouped output stops at the first gap
    // without a relevant structured limitation: this profile has none, and its
    // SaaS scope statement was an ordinary experience record.
    expect(fullConversion).toMatchObject({
      accepted: false,
      code: "RESUME_MATCH_EVIDENCE_INVALID",
      retryable: false,
      message: "Requirement 10 claims a Genuine Gap without a relevant profile limitation",
    });
    const unrelatedGaps = [10, 11, 15];
    expect(isolated.filter((item) => !item.result.accepted).map((item) => [item.requirementIndex, item.result.message]))
      .toEqual([
        [0, "Requirement 0 profile evidence contains duplicate evidence references (across decision-impact and assessment-only purposes)"],
        ...unrelatedGaps.map((index) => [index, `Requirement ${index} claims a Genuine Gap without a relevant profile limitation`]),
      ]);
    // Each rejected gap reused the SaaS scope statement profile-9 as proof for
    // a nonprofit, SMB or general customer-facing INDUSTRY requirement.
    for (const index of unrelatedGaps) {
      const assessment = assessments.find((item) => item.requirementIndex === index)!;
      expect([assessment.classification, requirementMap[index]!.category]).toEqual(["GENUINE_GAP", "INDUSTRY"]);
      expect(JSON.stringify(assessment.profileEvidence)).toContain('"profile-9"');
    }
    expect(envelope.accepted).toBe(true);
    // In combination, requirement 0's cross-purpose reuse and the three
    // unrelated gaps are the only blockers: every other assessment converts.
    const blockersNeutralized = convert({
      ...output,
      requirementAssessments: assessments.map((assessment) =>
        [0, ...unrelatedGaps].includes(assessment.requirementIndex) ? neutral(assessment) : assessment),
    });
    expect(blockersNeutralized.accepted).toBe(true);
    // Every narrative citation in the real output is translated for display;
    // none remains as a provider-local token and none decided acceptance.
    expect(JSON.stringify(envelope.result)).not.toMatch(/\b(?:jd|profile)-\d+\b/);
    expect((envelope.result as { summary: string }).summary).toMatch(/\[E\d+\]/);
    report.resumeMatch = {
      requestSchemaBytes: JSON.stringify(request.text.format.schema).length,
      currentSchemaBytes: JSON.stringify(z.toJSONSchema(currentSchema, { unrepresentable: "any" })).length,
      rawOutputAcceptedByCurrentProviderSchema: rawAgainstCurrentSchema.success,
      ambiguousPlaceholderIndexes: ambiguousIndexes,
      fullConversion: strip(fullConversion),
      envelopeWithNeutralAssessments: strip(envelope),
      isolated: isolated.map((item) => ({ ...item, result: strip(item.result) })),
    };
  });

  it("writes the replay report", () => {
    if (replayReport) writeFileSync(replayReport, JSON.stringify(report, null, 2));
    expect(Object.keys(report)).toEqual(expect.arrayContaining(["organizationalMaturity", "resumeMatch"]));
  });
});

// Permanent JD Reconstruction replay corpus for the Instrumentl posting: v3
// (call-01), v5 and v6 (jd-exact-request / jd-raw-response, told apart by the
// grammar they carry), plus the 7149563 Resume Match request, raw response and
// catalogs. Uploads keep their original names behind an optional 8-hex prefix.
function namedArtifacts(name: string) {
  if (!replayDirectory || !existsSync(replayDirectory)) return [];
  return readdirSync(replayDirectory)
    .filter((entry) => entry.replace(/^[0-9a-f]{8}-/, "") === name)
    .map((file) => JSON.parse(readFileSync(join(replayDirectory, file), "utf8")));
}

function jdCorpus() {
  const requests = namedArtifacts("jd-exact-request.json");
  const outputs = namedArtifacts("jd-raw-response.json").map(providerOutput);
  const v6Request = (request: any) =>
    JSON.stringify(request.text.format.schema).includes("requirementMinimumExperienceSpecificity");
  const v6Output = (output: any) =>
    output.requirements.some((requirement: object) => "minimumExperienceSpecificity" in requirement);
  const v3Request = namedArtifacts("call-01-jd-reconstruction-request.json")[0];
  const v3Response = namedArtifacts("call-01-jd-reconstruction-raw-response.json")[0];
  const corpus = {
    v3: v3Request && v3Response ? { request: v3Request, output: providerOutput(v3Response) } : undefined,
    v5: { request: requests.find((request) => !v6Request(request)), output: outputs.find((output) => !v6Output(output)) },
    v6: { request: requests.find(v6Request), output: outputs.find(v6Output) },
  };
  return corpus.v3 && corpus.v5.request && corpus.v5.output && corpus.v6.request && corpus.v6.output
    ? corpus as { [version in "v3" | "v5" | "v6"]: { request: any; output: any } }
    : undefined;
}

const corpus = jdCorpus();
const has7149563 = Boolean(corpus) &&
  ["exact-request.json", "raw-response.json", "catalogs.json"].every((name) => namedArtifacts(name).length === 1);

// The experience levels and startup flags JD Reconstruction now authors for
// this posting's EXPERIENCE qualifications, by v3/v5 requirement position
// (v6 authored its own). v3 categorized position 10 as INDUSTRY.
const instrumentlLevels: Record<number, string> = {
  0: "BROADER_CUSTOMER_FACING", // 2+ years of customer-facing work (required)
  1: "DIRECT_SAAS_CUSTOMER_SUCCESS", // CS, onboarding or training in SaaS (ideal)
  10: "BROADER_CUSTOMER_FACING", // working with nonprofit or SMB customers
  12: "ANY_WORK_EXPERIENCE", // early-stage startup
  13: "ANY_WORK_EXPERIENCE", // working remotely
};

function sourceOf(request: any) {
  const input = JSON.parse(request.input);
  return {
    sourceIndex: 0,
    sourceType: "MANUAL",
    sourceRecordId: input.trustedStructuredContext.sourceRecordId ?? null,
    provenanceId: input.trustedStructuredContext.provenanceId ?? null,
    sourceReference: "manual-submission",
    collectedAt: null,
    sourceContent: input.untrustedSourceContent as string,
  };
}

const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

// Re-expresses a historical output in the statement grammar without changing
// any provider judgment: requirements quoting one source span become one
// statement citing its first evidence record; levels are added where the
// historical grammar had none; authored ambiguity is dropped (it is derived).
function asStatements(output: any, overrides: Record<number, Record<string, unknown>> = {}) {
  const evidence = new Map((output.evidence as any[]).map((item) => [item.referenceId, item]));
  const firstReferenceByQuote = new Map<string, string>();
  const requirements = (output.requirements as any[]).map((requirement, index) => {
    const quote = normalized(evidence.get(requirement.evidenceReferences[0])!.sourceText);
    if (!firstReferenceByQuote.has(quote)) firstReferenceByQuote.set(quote, requirement.evidenceReferences[0]);
    const { requiresDirectWorkExperience: _historical, ...current } = requirement;
    return {
      ...current,
      ...(requirement.category === "EXPERIENCE" ? {
        minimumExperienceSpecificity: requirement.minimumExperienceSpecificity ?? instrumentlLevels[index],
        requiresStartupExperience: requirement.requiresStartupExperience ?? index === 12,
      } : {}),
      evidenceReferences: [firstReferenceByQuote.get(quote)!],
      ...overrides[index],
    };
  });
  const { requirements: _requirements, ...sections } = output;
  return { ...sections, requirementStatements: toRequirementStatementTransport(requirements as never) };
}

// The v6 provider merged the mixed-strength bullet into one REQUIRED
// qualification and marked it ambiguous. Truthfully split, it is the REQUIRED
// tenure plus the IDEAL SaaS Customer Success experience.
function v6Split(output: any) {
  const [merged, ...rest] = output.requirements as any[];
  return {
    ...output,
    requirements: [
      { ...merged, requirement: "2+ years of customer-facing work experience", experienceSpecificity: "Customer-facing work experience" },
      { ...merged, requirement: "Customer Success, Onboarding, or Training experience in a SaaS environment",
        strength: "IDEAL", statedYears: null, statedYearsMaximum: null, statedYearsOpenEnded: false,
        experienceSpecificity: "Customer Success, Onboarding, or Training in SaaS",
        minimumExperienceSpecificity: "DIRECT_SAAS_CUSTOMER_SUCCESS" },
      ...rest,
    ],
  };
}

// The production JD assembly (semantic reconstruction + deterministic facts +
// reconciliation), driven by a restored semantic result.
async function assembled(restored: unknown, source: ReturnType<typeof sourceOf>) {
  return reconstructCustomerSuccessJob({
    opportunity: {
      id: "replay", jobDescription: source.sourceContent, title: null, companyName: null, sourceType: "MANUAL",
      salaryText: null, salaryMin: null, salaryMax: null, currency: null, location: null,
    },
    rawSources: [{ id: source.sourceRecordId, sourceType: "MANUAL", sourceUrl: null, rawDescription: source.sourceContent }],
    provenance: [{ id: source.provenanceId, fieldName: "jobDescription", sourceReference: "manual-submission" }],
    domainData: { semanticOperations: { reconstructJobDescription: async () => restored } },
  } as never);
}

// A historical persisted map: the raw output converted under its own contract
// (no statement provenance), followed by the unreconciled deterministic lines.
function historicalMap(output: any, deterministic: { requirements: unknown[]; evidence: unknown[] }) {
  return {
    requirements: [
      ...(output.requirements as any[]).map(({ assessmentUnit: _unit, compoundExplanation: _explanation, ...requirement }) =>
        ({ requiresStartupExperience: false, ...requirement })),
      ...deterministic.requirements,
    ],
    evidence: [
      ...(output.evidence as any[]).map(({ sourceIndex: _index, ...item }) => ({ ...item, criterionId: "jd-reconstruction" })),
      ...deterministic.evidence,
    ],
  };
}

describe.skipIf(!corpus)("JD Reconstruction replay corpus v3, v5, v6", () => {
  it("rejects every historical output shape and grounds every requirement quote verbatim", () => {
    for (const version of ["v3", "v5", "v6"] as const) {
      const { request, output } = corpus![version];
      expect(semanticReconstructionTransportSchema.safeParse(output).success, version).toBe(false);
      // The historical grammar differs from the current one.
      expect(JSON.stringify(request.text.format.schema)).not.toBe(
        JSON.stringify(z.toJSONSchema(semanticReconstructionTransportSchema, { unrepresentable: "any" })));
      const source = normalized(sourceOf(request).sourceContent);
      const evidence = new Map((output.evidence as any[]).map((item) => [item.referenceId, item]));
      for (const requirement of output.requirements as any[]) {
        expect(source.includes(normalized(evidence.get(requirement.evidenceReferences[0])!.sourceText)), version).toBe(true);
      }
      // Historical maps stay readable for history and display.
      expect(requirementMapSchema.safeParse(historicalMap(output, { requirements: [], evidence: [] }).requirements).success).toBe(true);
    }
    // Authored ambiguity on explicit strengths, which no longer exists.
    const ambiguousExplicit = (version: "v3" | "v5" | "v6") => (corpus![version].output.requirements as any[])
      .flatMap((requirement, index) => requirement.ambiguity.isAmbiguous && requirement.strength !== "AMBIGUOUS" ? [index] : []);
    expect([ambiguousExplicit("v3"), ambiguousExplicit("v5"), ambiguousExplicit("v6")]).toEqual([[1, 8], [], [0]]);
  });

  it("converts each version's judgments in the statement grammar and rejects the v6 merge", async () => {
    const results: Record<string, unknown> = {};
    for (const version of ["v3", "v5", "v6"] as const) {
      const { request, output } = corpus![version];
      const source = sourceOf(request);
      // A literal one-statement-per-record re-expression of v3/v5 quotes one
      // span twice; the statement identity check rejects it.
      if (version !== "v6") {
        const literal = { ...asStatements(output), requirementStatements: toRequirementStatementTransport(
          (output.requirements as any[]).map((requirement, index) => ({ ...requirement,
            ...(requirement.category === "EXPERIENCE" ? { minimumExperienceSpecificity: instrumentlLevels[index] } : {}) })) as never) };
        expect(() => restoreSemanticReconstructionFromTransport(literal, source)).toThrowError(
          expect.objectContaining({ code: "JD_RECONSTRUCTION_STATEMENT_IDENTITY_INVALID", retryable: false }));
      }
      const transport = asStatements(version === "v6" ? v6Split(output) : output);
      expect(semanticReconstructionTransportSchema.safeParse(transport).success, version).toBe(true);
      const restored = restoreSemanticReconstructionFromTransport(transport, source);
      // The mixed-strength bullet is one statement with two qualifications.
      expect(restored.requirements.slice(0, 2).map((requirement) => [requirement.strength, requirement.minimumExperienceSpecificity,
        requirement.ambiguity.isAmbiguous, requirement.sourceStatement])).toEqual([
        ["REQUIRED", "BROADER_CUSTOMER_FACING", false, { statementIndex: 0, statementStrengths: ["REQUIRED", "IDEAL"],
          statementExperienceLevels: ["BROADER_CUSTOMER_FACING", "DIRECT_SAAS_CUSTOMER_SUCCESS"] }],
        ["IDEAL", "DIRECT_SAAS_CUSTOMER_SUCCESS", false, { statementIndex: 0, statementStrengths: ["REQUIRED", "IDEAL"],
          statementExperienceLevels: ["BROADER_CUSTOMER_FACING", "DIRECT_SAAS_CUSTOMER_SUCCESS"] }],
      ]);
      // Ambiguity is structural: no explicit strength is ambiguous.
      expect(restored.requirements.filter((requirement) => requirement.ambiguity.isAmbiguous)).toEqual([]);
      const reconstruction = await assembled(restored, source);
      const texts = reconstruction.requirements.map((requirement) => normalized(requirement.requirement));
      // Label-only headings are gone, the covered deterministic composite is
      // reconciled into its statement, and nothing is duplicated.
      expect(texts).not.toContain("required");
      expect(texts).not.toContain("nice to have");
      expect(new Set(texts).size).toBe(texts.length);
      expect(reconstruction.requirements).toHaveLength(14);
      expect(reconstruction.requirements.every((requirement) => requirement.sourceStatement !== undefined)).toBe(true);
      expect(reconstruction.evidence.some((item) => item.criterionId === "candidate-requirement")).toBe(false);
      // Every REQUIRED entry is assessable: none is withheld as ambiguous.
      expect(reconstruction.requirements.filter((requirement) => requirement.strength === "REQUIRED")).toHaveLength(version === "v3" ? 9 : 9);
      // Legitimate deterministic job facts are untouched.
      expect([reconstruction.salary.minimum, reconstruction.salary.maximum, reconstruction.salary.disclosure]).toEqual([70_000, 85_000, "DISCLOSED"]);
      // Unchanged deterministic location parsing (the live 7149563 facts).
      expect([reconstruction.location.remoteStatus, reconstruction.evidence.find((item) => item.referenceId === "location-facts")?.sourceText])
        .toEqual(["UNKNOWN", "Experience working remotely"]);
      expect([reconstruction.travel.frequency, reconstruction.travel.purpose]).toEqual(["annual", "COMPANY_EVENT"]);
      // A new execution accepts this map; reconciliation is idempotent.
      expect(outdatedResumeMatchRequirementIndexes(reconstruction)).toEqual([]);
      expect(reconcileRequirementMap(reconstruction)).toEqual({ requirements: reconstruction.requirements, evidence: reconstruction.evidence });
      // The historical persisted map (no statement provenance, unreconciled
      // deterministic lines) stays readable but a new execution fails closed.
      const deterministic = await assembled({ ...restored, requirements: [] }, source);
      const history = historicalMap(output, {
        requirements: deterministic.requirements, evidence: deterministic.evidence });
      expect(requirementMapSchema.safeParse(history.requirements).success).toBe(true);
      expect(outdatedResumeMatchRequirementIndexes(history)).toEqual(
        (output.requirements as unknown[]).map((_, index) => index));
      results[version] = {
        historicalRequirements: history.requirements.length,
        deterministicFloorWithoutStatements: deterministic.requirements.map((requirement) => [requirement.requirement, requirement.category, requirement.strength]),
        reconciledRequirements: reconstruction.requirements.length,
      };
    }
    // v6 as authored: one REQUIRED qualification for a statement that
    // declares REQUIRED and IDEAL is a mixed-strength merge and fails closed.
    const { request, output } = corpus!.v6;
    const merged = asStatements(output);
    merged.requirementStatements[0]!.statementStrengths = ["REQUIRED", "IDEAL"];
    merged.requirementStatements[0]!.statementExperienceLevels = ["BROADER_CUSTOMER_FACING", "DIRECT_SAAS_CUSTOMER_SUCCESS"];
    expect(() => restoreSemanticReconstructionFromTransport(merged, sourceOf(request))).toThrowError(
      expect.objectContaining({ code: "JD_RECONSTRUCTION_STATEMENT_INVALID", retryable: false }));
    // The v6 merge with its authored ambiguity is not even expressible.
    expect(semanticReconstructionTransportSchema.safeParse({ ...merged, requirementStatements: [{
      ...merged.requirementStatements[0]!, qualifications: [{ ...merged.requirementStatements[0]!.qualifications[0]!,
        strengthAssessment: { strength: "REQUIRED", ambiguityExplanation: output.requirements[0].ambiguity.explanation } }] },
    ...merged.requirementStatements.slice(1)] }).success).toBe(false);
    report.jdCorpus = results;
    if (replayReport) writeFileSync(replayReport, JSON.stringify(report, null, 2));
  });
});

describe.skipIf(!has7149563)("live diagnostic 7149563 Resume Match replay", () => {
  it("reaches the golden outcomes on the reconciled statement map and keeps downstream inputs consistent", async () => {
    const request = namedArtifacts("exact-request.json")[0];
    const output = providerOutput(namedArtifacts("raw-response.json")[0]);
    const catalogs = namedArtifacts("catalogs.json")[0];
    const context = JSON.parse(request.input).trustedStructuredContext;
    const core = (reference: string) => catalogs.coreByProvider[reference] as string;
    // The live map had 17 entries: 14 semantic, the "Required" and "Nice to
    // Have" headings (14, 16) and the deterministic composite (15).
    const liveMap = context.requirementMap as Array<Record<string, any>>;
    expect(liveMap.map((requirement) => requirement.requirement).filter((text: string) =>
      ["Required", "Nice to Have"].includes(text))).toEqual(["Required", "Nice to Have"]);
    expect(liveMap).toHaveLength(17);

    // The map the repaired JD path produces from the same v5 judgments.
    const reconstruction = await assembled(
      restoreSemanticReconstructionFromTransport(asStatements(corpus!.v5.output), sourceOf(corpus!.v5.request)),
      sourceOf(corpus!.v5.request),
    );
    const requirementMap = reconstruction.requirements;
    expect(requirementMap.map((requirement) => [requirement.requirement, requirement.category, requirement.strength]))
      .toEqual(liveMap.slice(0, 14).map((requirement) => [requirement.requirement, requirement.category, requirement.strength]));
    // Its evidence identities are the live Core identities (E1-E25).
    expect(requirementMap.map((requirement) => requirement.evidenceReferences[0])).toEqual(
      ["E12", "E12", ...liveMap.slice(2, 14).map((requirement) => core(requirement.evidenceReferences[0]))]);

    const liveEvidence = catalogs.evidence as Array<Record<string, any>>;
    const saasScopeReference = core("profile-9");
    const canonical = alexandraNugentCustomerSuccessProfile.limitations![0]!;
    const migratedEvidence = liveEvidence.map((evidence) => evidence.referenceId === saasScopeReference
      ? { ...evidence, evidenceType: "PROFILE_LIMITATION", claim: canonical.statement, sourceText: canonical.statement,
          limitation: { category: canonical.category, disclaimedExperienceSpecificity: canonical.disclaimedExperienceSpecificity } }
      : evidence);
    const assessments = (output.requirementAssessments as Array<Record<string, any>>)
      .filter((assessment) => assessment.requirementIndex < 14);
    const live = (index: number) => assessments.find((assessment) => assessment.requirementIndex === index)!;
    const profile = (references: string[]) =>
      ({ evidenceAssignments: references.map((evidenceReference) => ({ evidenceReference, purpose: "ASSESSMENT_ONLY" })) });
    const jd = (index: number) => ({ evidenceAssignments: [{
      evidenceReference: index === 1 ? "jd-11" : live(index).jdEvidence.evidenceAssignments[0].evidenceReference,
      purpose: "ASSESSMENT_ONLY" }] });
    const assessment = (index: number, fields: Record<string, unknown>) => ({
      requirementIndex: index,
      importanceExplanation: live(index).importanceExplanation,
      decisionImpact: "NON_DECISIVE",
      decisionImpactExplanation: live(index).decisionImpactExplanation,
      explanation: live(index).explanation,
      supportedPortion: null,
      unsupportedPortion: null,
      jdEvidence: jd(index),
      ...fields,
    });
    const unknown = (index: number) => assessment(index, { classification: "UNKNOWN", matchedExperienceSpecificity: "UNKNOWN",
      experienceEvidenceBasis: "UNKNOWN", profileEvidence: profile([]) });
    const partial = (index: number, specificity: string, basis: string, references: string[]) => assessment(index, {
      classification: "PARTIAL_MATCH", matchedExperienceSpecificity: specificity, experienceEvidenceBasis: basis,
      profileEvidence: profile(references), supportedPortion: live(index).supportedPortion, unsupportedPortion: live(index).unsupportedPortion });
    const strong = (index: number, specificity: string, basis: string, references: string[]) => assessment(index, {
      classification: "STRONG_MATCH", matchedExperienceSpecificity: specificity, experienceEvidenceBasis: basis, profileEvidence: profile(references) });
    // The truthful structured form of the live output's own explanations.
    const golden: Record<number, Record<string, unknown>> = {
      0: strong(0, "RELATED_CUSTOMER_RELATIONSHIP", "DIRECT_OR_RELATED_WORK_EXPERIENCE", ["profile-6"]), // tenure
      1: partial(1, "BROADER_CUSTOMER_FACING", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-4", "profile-5"]), // SaaS CS
      2: partial(2, "TRANSFERABLE", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-18"]),
      3: partial(3, "TRANSFERABLE", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-17"]),
      4: partial(4, "TRANSFERABLE", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-5"]),
      5: strong(5, "RELATED_CUSTOMER_RELATIONSHIP", "DIRECT_OR_RELATED_WORK_EXPERIENCE", ["profile-6"]), // empathy
      6: partial(6, "TRANSFERABLE", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-7", "profile-23"]),
      7: strong(7, "REQUIREMENT_SPECIFIC", "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE", ["profile-24"]), // process improvement
      8: partial(8, "REQUIREMENT_SPECIFIC", "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE", ["profile-10"]),
      9: partial(9, "TRANSFERABLE", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-19"]),
      10: unknown(10),
      11: unknown(11),
      12: unknown(12),
      13: strong(13, "REQUIREMENT_SPECIFIC", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-7"]), // remote work
    };
    const withAssessments = (replacements: Record<number, Record<string, unknown>>) => {
      const value = structuredClone(output);
      value.requirementAssessments = Array.from({ length: 14 }, (_, index) => replacements[index] ?? golden[index]);
      // Effective Seniority may cite only requirements that still exist.
      for (const dimension of ["statedYears", "requirementStrength", "experienceSpecificity"]) {
        value.effectiveSeniority[dimension].requirementIndexes =
          value.effectiveSeniority[dimension].requirementIndexes.filter((index: number) => index < 14);
      }
      return value;
    };
    const results: Record<string, unknown> = {};
    for (const [mode, evidence] of [["exactProfile", liveEvidence], ["migratedProfile", migratedEvidence]] as const) {
      const projection = createResumeMatchProviderInputProjection(evidence as never);
      if (mode === "exactProfile") {
        expect(projection.profileEvidenceCatalog).toEqual(context.profileEvidenceCatalog);
        expect(projection.jdEvidenceCatalog).toEqual(context.jdEvidenceCatalog);
      }
      const schema = createSemanticResumeMatchTransportSchema(projection.schemaEvidence, requirementMap);
      const jobEvidenceCatalog = semanticResumeMatchJobEvidenceCatalog(evidence as never);
      const convert = (value: unknown) => failure(() => semanticResumeMatchFromTransport(
        value, requirementMap, evidence as never, jobEvidenceCatalog, projection));
      const accepts = (value: unknown) => schema.safeParse(value).success && convert(value).accepted;
      expect(auditOpenAiProviderSchemaViolations(schema)).toEqual([]);

      // Golden outcomes convert end to end.
      const golden7149563 = withAssessments({});
      expect(schema.safeParse(golden7149563).success, mode).toBe(true);
      const match = convert(golden7149563);
      expect(match.accepted, JSON.stringify(match)).toBe(true);
      const domain = match.result as ReturnType<typeof semanticResumeMatchFromTransport>;
      const byClass = (classification: string) => domain.requirementAssessments
        .filter((item) => item.classification === classification).map((item) => item.requirementIndex);
      expect(byClass("STRONG_MATCH")).toEqual([0, 5, 7, 13]);
      expect(byClass("PARTIAL_MATCH")).toEqual([1, 2, 3, 4, 6, 8, 9]);
      expect(byClass("UNKNOWN")).toEqual([10, 11, 12]);
      expect(byClass("GENUINE_GAP")).toEqual([]);
      expect(domain.requirementAssessments.filter((item) => item.classification === "UNKNOWN")
        .every((item) => item.supportedPortion === null && item.unsupportedPortion === null)).toBe(true);
      // Every REQUIRED entry is assessed by the provider; none is withheld.
      expect(domain.requirementAssessments.filter((item) => item.strength === "REQUIRED" && item.isAmbiguous)).toEqual([]);

      // The live shapes no longer pass: Unknowns carrying partial content,
      // and the false gaps on tenure, empathy, process improvement and remote.
      for (const index of [2, 3, 4, 6, 8, 9]) {
        expect(live(index).classification).toBe("UNKNOWN");
        expect(live(index).supportedPortion).not.toBeNull();
        expect(accepts(withAssessments({ [index]: { ...unknown(index), supportedPortion: live(index).supportedPortion,
          unsupportedPortion: live(index).unsupportedPortion } })), `${mode} unknown-with-portions ${index}`).toBe(false);
      }
      for (const index of [0, 5, 7, 13]) {
        expect(accepts(withAssessments({ [index]: { ...live(index), jdEvidence: jd(index) } })), `${mode} false gap ${index}`).toBe(false);
      }
      // The SaaS Customer Success requirement may be a relevant gap only with
      // the migrated structured limitation, and then never decisively (IDEAL).
      const saasGap = { ...live(1), jdEvidence: jd(1), decisionImpact: "NON_DECISIVE" };
      expect(accepts(withAssessments({ 1: saasGap })), `${mode} SaaS gap`).toBe(mode === "migratedProfile");
      // No other requirement can carry the SaaS limitation as gap proof.
      for (const index of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
        expect(accepts(withAssessments({ [index]: { ...live(1), requirementIndex: index, jdEvidence: jd(index), decisionImpact: "NON_DECISIVE" } })),
          `${mode} SaaS limitation on ${index}`).toBe(false);
      }
      // INDUSTRY can express a truthful positive from actual work records,
      // never from certifications; this profile has no nonprofit-development
      // work, so the truthful outcome stays Unknown.
      expect(schema.safeParse(withAssessments({ 11: strong(11, "REQUIREMENT_SPECIFIC", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-5"]) })).success).toBe(true);
      expect(schema.safeParse(withAssessments({ 11: strong(11, "REQUIREMENT_SPECIFIC", "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE", ["profile-11"]) })).success).toBe(false);
      // Startup without startup evidence stays Unknown.
      expect(accepts(withAssessments({ 12: strong(12, "REQUIREMENT_SPECIFIC", "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", ["profile-7"]) }))).toBe(false);

      // Downstream: Resume Match findings and score inputs, Opportunity
      // Priority inputs, and the Final Recommendation decision and reasons.
      const resumeMatch = { evaluated: true as const, match: domain, band: resumeMatchBand(domain.score) };
      const recommendation = (data: typeof resumeMatch) => createCustomerSuccessRecommendation({
        hardFilters: { overall: "PASS", role: { classification: "CORE_CS", result: "PASS", explanation: "Eligible.", evidenceReferences: [] },
          salary: { result: "PASS", explanation: "Pass.", evidenceReferences: [] }, location: { result: "PASS", explanation: "Pass.", evidenceReferences: [] },
          workArrangement: { result: "PASS", explanation: "Pass.", evidenceReferences: [] }, travel: { result: "PASS", explanation: "Pass.", evidenceReferences: [] } },
        jobEvaluation: { evaluated: false, reason: "Isolated." }, companyAlignment: { evaluated: false, reason: "Isolated." },
        organizationalMaturity: { evaluated: false, reason: "Isolated." }, alexFit: { evaluated: false, reason: "Isolated." },
        burnoutRisk: { evaluated: false, reason: "Isolated." }, resumeMatch: data,
        opportunityPriority: { evaluated: false, reason: "Isolated." }, ghostJobRisk: { evaluated: false, reason: "Isolated." },
        availableEvidence: evidence as never,
      } as never);
      const decision = recommendation(resumeMatch);
      expect(domain.genuineGaps).toEqual([]);
      expect(domain.score).toBe(output.score);
      expect([decision.recommendation.recommendation, decision.recommendation.precedenceReasons]).toEqual(
        domain.effectiveSeniority.effectiveLevelFit === "ABOVE_LEVEL"
          ? ["SKIP", ["Effective Seniority is Above Level."]]
          : domain.contradictions.length > 0
            ? ["REVIEW", ["Effective-seniority evidence contains a material contradiction."]]
            : ["APPLY", ["Hard filters pass, the role remains substantively aligned, effective level is eligible, and no severe evidenced disqualifier is present."]]);
      // The live output made REQUIRED requirements 0, 5 and 7 non-decisive
      // Genuine Gaps: no precedence reason, but false major concerns. Now the
      // concerns are the partial matches, and no gap finding remains.
      expect([0, 5, 7].map((index) => [live(index).classification, live(index).decisionImpact, liveMap[index]!.strength]))
        .toEqual([0, 5, 7].map(() => ["GENUINE_GAP", "NON_DECISIVE", "REQUIRED"]));
      expect(decision.concerns).toEqual(domain.partialMatches);
      results[mode] = {
        schemaBytes: JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" })).length,
        classifications: Object.fromEntries(domain.requirementAssessments.map((item) => [item.requirementIndex, item.classification])),
        score: domain.score,
        band: resumeMatch.band,
        effectiveLevelFit: domain.effectiveSeniority.effectiveLevelFit,
        recommendation: decision.recommendation.recommendation,
        precedenceReasons: decision.recommendation.precedenceReasons,
        liveGapDecisionImpacts: Object.fromEntries([0, 1, 5, 7, 13].map((index) => [index, live(index).decisionImpact])),
        opportunityPriorityResumeMatchInput: { evaluated: true, score: domain.score, band: resumeMatch.band,
          requirementCount: domain.requirementAssessments.length, genuineGaps: domain.genuineGaps.length },
      };
    }
    // Wording invariance: the live limitation statement, including its
    // classification guidance, yields the identical grammar as the factual one.
    const liveWordingEvidence = migratedEvidence.map((evidence) => evidence.referenceId === saasScopeReference
      ? { ...evidence, claim: liveEvidence.find((item) => item.referenceId === saasScopeReference)!.claim,
          sourceText: liveEvidence.find((item) => item.referenceId === saasScopeReference)!.sourceText }
      : evidence);
    expect(liveWordingEvidence.find((evidence) => evidence.referenceId === saasScopeReference)!.claim).toMatch(/must remain/);
    const grammar = (evidence: Array<Record<string, any>>) => z.toJSONSchema(createSemanticResumeMatchTransportSchema(
      createResumeMatchProviderInputProjection(evidence as never).schemaEvidence, requirementMap), { unrepresentable: "any" });
    expect(grammar(liveWordingEvidence)).toEqual(grammar(migratedEvidence));
    report.resumeMatch7149563 = { requestSchemaBytes: JSON.stringify(request.text.format.schema).length, ...results };
    if (replayReport) writeFileSync(replayReport, JSON.stringify(report, null, 2));
  });
});

function auditOpenAiProviderSchemaViolations(schema: z.ZodType) {
  const json = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" }));
  return ["oneOf", "allOf", "\"not\"", "if", "propertyNames"].filter((keyword) => json.includes(`"${keyword.replaceAll("\"", "")}":`));
}
