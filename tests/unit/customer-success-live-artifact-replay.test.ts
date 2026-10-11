import {
  createResumeMatchProviderInputProjection,
  createSemanticOrganizationalMaturityTransportSchema,
  createSemanticResumeMatchTransportSchema,
  organizationalMaturityRelationshipCatalog,
  semanticOrganizationalMaturityFromTransport,
  semanticResumeMatchFromTransport,
  semanticResumeMatchJobEvidenceCatalog,
  semanticResumeMatchRequirementsForProvider,
} from "@ai-career/customer-success";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

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
    expect(fullConversion).toMatchObject({
      accepted: false,
      code: "RESUME_MATCH_EVIDENCE_INVALID",
      retryable: false,
      message: expect.stringContaining(
        "Requirement 0 profile evidence contains duplicate evidence references (across decision-impact and assessment-only purposes)",
      ),
    });
    expect(isolated.filter((item) => !item.result.accepted).map((item) => item.requirementIndex)).toEqual([0]);
    expect(envelope.accepted).toBe(true);
    // In combination, the cross-purpose reuse in requirement 0 is the only
    // remaining blocker: every other provider-authored assessment converts.
    const onlyRequirementZeroNeutralized = convert({
      ...output,
      requirementAssessments: assessments.map((assessment) =>
        assessment.requirementIndex === 0 ? neutral(assessment) : assessment),
    });
    expect(onlyRequirementZeroNeutralized.accepted).toBe(true);
    const gaps = (onlyRequirementZeroNeutralized.result as {
      requirementAssessments: Array<{ requirementIndex: number; classification: string; profileEvidenceReferences: string[] }>;
    }).requirementAssessments.filter((assessment) => assessment.classification === "GENUINE_GAP");
    expect(gaps.map((gap) => gap.requirementIndex)).toEqual([10, 11, 15]);
    // Each gap cites the affirmative limitation statement profile-9 as proof.
    for (const gap of gaps) expect(gap.profileEvidenceReferences).toContain(core("profile-9"));
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
    expect(Object.keys(report)).toEqual(["organizationalMaturity", "resumeMatch"]);
  });
});
