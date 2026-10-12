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
} from "@ai-career/customer-success";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { alexandraNugentCustomerSuccessProfile } from "../../apps/web/src/server/profile-import/alexandra-nugent-customer-success-profile";

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

// Live diagnostic 7149563 (JD Reconstruction v5 + Resume Match), uploaded
// under their original names with an optional upload prefix.
function namedArtifact(name: string) {
  const file = readdirSync(replayDirectory!).find((entry) => entry.replace(/^[0-9a-f]{8}-/, "") === name);
  return file ? JSON.parse(readFileSync(join(replayDirectory!, file), "utf8")) : undefined;
}

const has7149563 = Boolean(replayDirectory && existsSync(replayDirectory) &&
  ["exact-request.json", "raw-response.json", "catalogs.json", "jd-exact-request.json", "jd-raw-response.json"]
    .every((name) => namedArtifact(name) !== undefined));

// The experience levels the repaired JD Reconstruction authors for this job's
// EXPERIENCE requirements; the live v5 output carried a direct-work boolean.
const v6Levels: Record<number, string> = {
  0: "BROADER_CUSTOMER_FACING", // 2+ years of customer-facing work
  1: "DIRECT_SAAS_CUSTOMER_SUCCESS", // CS, onboarding or training in SaaS (ideal)
  10: "BROADER_CUSTOMER_FACING", // working with nonprofit or SMB customers
  12: "ANY_WORK_EXPERIENCE", // early-stage startup
  13: "ANY_WORK_EXPERIENCE", // working remotely
};

describe.skipIf(!has7149563)("live diagnostic 7149563 replay", () => {
  it("replays JD Reconstruction and Resume Match through the repaired production path", () => {
    const jdRequest = namedArtifact("jd-exact-request.json");
    const jdOutput = providerOutput(namedArtifact("jd-raw-response.json"));
    const request = namedArtifact("exact-request.json");
    const output = providerOutput(namedArtifact("raw-response.json"));
    const catalogs = namedArtifact("catalogs.json");
    const context = JSON.parse(request.input).trustedStructuredContext;

    // A. Live v5 values, then the in-place contract repair of the same output.
    const v5 = jdOutput.requirements as Array<Record<string, any>>;
    expect([v5[0]!.requiresDirectWorkExperience, v5[1]!.requiresDirectWorkExperience, v5[13]!.requiresDirectWorkExperience])
      .toEqual([true, false, false]);
    expect(semanticReconstructionTransportSchema.safeParse(jdOutput).success).toBe(false);
    // The persisted v5 map stays readable for history and display.
    expect(requirementMapSchema.safeParse(v5.map(({ assessmentUnit: _unit, compoundExplanation: _explanation, ...requirement }) =>
      ({ requiresStartupExperience: false, ...requirement }))).success).toBe(true);
    const repairedJd = {
      ...jdOutput,
      requirements: v5.map(({ requiresDirectWorkExperience: _v5, ...requirement }, index) =>
        requirement.category === "EXPERIENCE"
          ? { ...requirement, minimumExperienceSpecificity: v6Levels[index] }
          : requirement),
    };
    const jdContext = JSON.parse(jdRequest.input);
    const reconstruction = restoreSemanticReconstructionFromTransport(repairedJd, {
      sourceIndex: 0,
      sourceType: "MANUAL",
      sourceRecordId: jdContext.trustedStructuredContext.sourceRecordId,
      provenanceId: jdContext.trustedStructuredContext.provenanceId,
      sourceReference: "manual-submission",
      collectedAt: null,
      sourceContent: jdContext.untrustedSourceContent,
    });
    expect(reconstruction.requirements.map((requirement) => [requirement.requirement, requirement.category, requirement.strength]))
      .toEqual((context.requirementMap as Array<Record<string, any>>).slice(0, 14)
        .map((requirement) => [requirement.requirement, requirement.category, requirement.strength]));

    // B. Resume Match with the exact provider catalogs.
    const core = (reference: string) => catalogs.coreByProvider[reference] as string;
    const requirementMap = (context.requirementMap as Array<Record<string, any>>).map(
      ({ requirementIndex, requiresDirectWorkExperience: _v5, ...requirement }) => ({
        ...requirement,
        ...(requirement.category === "EXPERIENCE" ? { minimumExperienceSpecificity: v6Levels[requirementIndex] } : {}),
        evidenceReferences: (requirement.evidenceReferences as string[]).map(core),
      }),
    );
    expect(requirementMap.every((requirement) =>
      requirement.category !== "EXPERIENCE" || requirement.minimumExperienceSpecificity !== undefined)).toBe(true);
    const liveEvidence = catalogs.evidence as Array<Record<string, any>>;
    const saasScopeReference = core("profile-9");
    // The same profile after migration: its scope boundary is the canonical
    // structured limitation, with its factual statement only.
    const canonical = alexandraNugentCustomerSuccessProfile.limitations![0]!;
    const asLimitation = (evidence: Record<string, any>, statement: string) => ({
      ...evidence, evidenceType: "PROFILE_LIMITATION", claim: statement, sourceText: statement,
      limitation: { category: canonical.category, disclaimedExperienceSpecificity: canonical.disclaimedExperienceSpecificity },
    });
    const migratedEvidence = liveEvidence.map((evidence) => evidence.referenceId === saasScopeReference
      ? asLimitation(evidence, canonical.statement)
      : evidence);
    expect(canonical.statement).not.toMatch(/must remain|genuine gaps/i);
    const assessments = output.requirementAssessments as Array<Record<string, any>>;
    const neutral = (assessment: Record<string, any>) => ({
      requirementIndex: assessment.requirementIndex,
      classification: "UNKNOWN",
      matchedExperienceSpecificity: "UNKNOWN",
      experienceEvidenceBasis: "UNKNOWN",
      importanceExplanation: assessment.importanceExplanation,
      decisionImpact: "NON_DECISIVE",
      decisionImpactExplanation: assessment.decisionImpactExplanation,
      explanation: assessment.explanation,
      supportedPortion: null,
      unsupportedPortion: null,
      jdEvidence: { evidenceAssignments: assessment.jdEvidence.evidenceAssignments.map(
        (assignment: Record<string, string>) => ({ ...assignment, purpose: "ASSESSMENT_ONLY" })) },
      profileEvidence: { evidenceAssignments: [] },
    });
    const replaced = (replacements: Record<number, Record<string, unknown>>) => ({
      ...output,
      requirementAssessments: assessments.map((assessment) => {
        const replacement = replacements[assessment.requirementIndex];
        return replacement === undefined ? neutral(assessment) : { ...neutral(assessment), ...replacement };
      }),
    });
    const keep = (indexes: number[]) => ({
      ...output,
      requirementAssessments: assessments.map((assessment) =>
        indexes.includes(assessment.requirementIndex) ? assessment : neutral(assessment)),
    });
    const profile = (references: string[], purpose = "ASSESSMENT_ONLY") =>
      ({ evidenceAssignments: references.map((evidenceReference) => ({ evidenceReference, purpose })) });
    const liveGaps = [0, 1, 5, 7, 13, 15];
    expect(assessments.filter((assessment) => assessment.classification === "GENUINE_GAP")
      .map((assessment) => assessment.requirementIndex)).toEqual(liveGaps);
    // The semantically correct alternatives, each the live explanation's own
    // claim expressed truthfully in structure.
    const corrected: Record<number, Record<string, unknown>> = {
      0: { classification: "STRONG_MATCH", matchedExperienceSpecificity: "RELATED_CUSTOMER_RELATIONSHIP",
        experienceEvidenceBasis: "DIRECT_OR_RELATED_WORK_EXPERIENCE", profileEvidence: profile(["profile-6"]) },
      1: { classification: "PARTIAL_MATCH", matchedExperienceSpecificity: "BROADER_CUSTOMER_FACING",
        experienceEvidenceBasis: "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", profileEvidence: profile(["profile-4", "profile-5"]),
        supportedPortion: assessments[1]!.supportedPortion, unsupportedPortion: assessments[1]!.unsupportedPortion },
      5: { classification: "STRONG_MATCH", matchedExperienceSpecificity: "RELATED_CUSTOMER_RELATIONSHIP",
        experienceEvidenceBasis: "DIRECT_OR_RELATED_WORK_EXPERIENCE", profileEvidence: profile(["profile-6"]) },
      7: { classification: "STRONG_MATCH", matchedExperienceSpecificity: "REQUIREMENT_SPECIFIC",
        experienceEvidenceBasis: "REQUIREMENT_RELEVANT_SKILL_OR_KNOWLEDGE", profileEvidence: profile(["profile-24"]) },
      13: { classification: "STRONG_MATCH", matchedExperienceSpecificity: "REQUIREMENT_SPECIFIC",
        experienceEvidenceBasis: "BROADER_OR_TRANSFERABLE_WORK_EXPERIENCE", profileEvidence: profile(["profile-7"]) },
    };
    const results: Record<string, unknown> = {};
    for (const [mode, evidence] of [["exactProfile", liveEvidence], ["migratedProfile", migratedEvidence]] as const) {
      const projection = createResumeMatchProviderInputProjection(evidence as never);
      const unchangedCatalogs = mode === "exactProfile";
      if (unchangedCatalogs) {
        expect(projection.profileEvidenceCatalog).toEqual(context.profileEvidenceCatalog);
        expect(projection.jdEvidenceCatalog).toEqual(context.jdEvidenceCatalog);
      }
      const providerRequirements = semanticResumeMatchRequirementsForProvider(requirementMap, projection.providerReferenceByCoreReference);
      expect(providerRequirements.map(({ minimumExperienceSpecificity: _level, ...requirement }) => requirement))
        .toEqual((context.requirementMap as Array<Record<string, any>>).map(({ requiresDirectWorkExperience: _v5, ...requirement }) => requirement));
      const schema = createSemanticResumeMatchTransportSchema(projection.schemaEvidence, requirementMap as never);
      const jobEvidenceCatalog = semanticResumeMatchJobEvidenceCatalog(evidence as never);
      const convert = (value: unknown) => failure(() => semanticResumeMatchFromTransport(
        value, requirementMap as never, evidence as never, jobEvidenceCatalog, projection));
      const accepts = (value: unknown) => schema.safeParse(value).success && convert(value).accepted;

      // The exact live output is rejected; each live gap is judged alone.
      expect(convert(output).accepted).toBe(false);
      expect(convert(replaced({})).accepted).toBe(true);
      const isolated = Object.fromEntries(liveGaps.map((index) => [index, accepts(keep([index]))]));
      // Only requirement 1 may carry the SaaS limitation, and only once it is
      // a structured limitation; it remains free to be the truthful partial.
      expect(isolated).toEqual({ 0: false, 1: mode === "migratedProfile", 5: false, 7: false, 13: false, 15: false });
      for (const index of [0, 1, 5, 7, 13]) {
        expect(accepts(replaced({ [index]: corrected[index]! })), `${mode} corrected ${index}`).toBe(true);
      }
      // Requirement 15 (deterministic INDUSTRY composite) stays Unknown: no
      // limitation is relevant to it and INDUSTRY legality is unchanged.
      expect(accepts(replaced({ 15: { classification: "PARTIAL_MATCH", matchedExperienceSpecificity: "RELATED_CUSTOMER_RELATIONSHIP",
        experienceEvidenceBasis: "DIRECT_OR_RELATED_WORK_EXPERIENCE", profileEvidence: profile(["profile-6"]),
        supportedPortion: "Customer-facing work.", unsupportedPortion: "SaaS Customer Success." } }))).toBe(false);
      // Off-ladder labels are not available for ladder requirements.
      expect(accepts(replaced({ 0: { ...corrected[0]!, matchedExperienceSpecificity: "REQUIREMENT_SPECIFIC" } }))).toBe(false);
      // The whole corrected result converts end to end with positive matches.
      const whole = replaced(corrected);
      expect(schema.safeParse(whole).success).toBe(true);
      const domain = semanticResumeMatchFromTransport(whole, requirementMap as never, evidence as never, jobEvidenceCatalog, projection);
      expect(domain.requirementAssessments.filter((assessment) =>
        ["STRONG_MATCH", "PARTIAL_MATCH", "TRANSFERABLE_MATCH"].includes(assessment.classification))
        .map((assessment) => assessment.requirementIndex)).toEqual([0, 1, 5, 7, 13]);
      expect(domain.genuineGaps).toEqual([]);
      results[mode] = {
        schemaBytes: JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" })).length,
        gapEvidenceVariants: (JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" })).match(/"gapEvidence"/g) ?? []).length,
        isolatedLiveGapsAccepted: isolated,
      };
    }
    // Wording invariance: the live statement, including its classification
    // guidance, yields the identical grammar and acceptance as the cleaned one.
    const liveWordingEvidence = liveEvidence.map((evidence) => evidence.referenceId === saasScopeReference
      ? asLimitation(evidence, evidence.claim as string)
      : evidence);
    expect(liveWordingEvidence.find((evidence) => evidence.referenceId === saasScopeReference)!.claim).toMatch(/must remain/);
    const grammar = (evidence: Array<Record<string, any>>) => z.toJSONSchema(createSemanticResumeMatchTransportSchema(
      createResumeMatchProviderInputProjection(evidence as never).schemaEvidence, requirementMap as never), { unrepresentable: "any" });
    expect(grammar(liveWordingEvidence)).toEqual(grammar(migratedEvidence));
    // With the migrated profile, the relevant SaaS gap on requirement 1 also converts.
    const migratedProjection = createResumeMatchProviderInputProjection(migratedEvidence as never);
    const saasGap = semanticResumeMatchFromTransport(
      { ...output, requirementAssessments: assessments.map((assessment) =>
        assessment.requirementIndex === 1 ? assessment : { ...neutral(assessment), ...corrected[assessment.requirementIndex] }) },
      requirementMap as never, migratedEvidence as never, semanticResumeMatchJobEvidenceCatalog(migratedEvidence as never), migratedProjection);
    expect(saasGap.requirementAssessments[1]).toMatchObject({ classification: "GENUINE_GAP", profileEvidenceReferences: [saasScopeReference, core("profile-4")] });
    report.resumeMatch7149563 = {
      requestSchemaBytes: JSON.stringify(request.text.format.schema).length,
      jdV5DirectFlags: Object.fromEntries(v5.map((requirement, index) => [index, requirement.requiresDirectWorkExperience]).filter(([, value]) => value !== undefined)),
      ...results,
    };
    if (replayReport) writeFileSync(replayReport, JSON.stringify(report, null, 2));
  });
});
