import {
  StructuredOutputValidationError,
  defineEvaluationStage,
} from "@ai-career/evaluation";
import type { EvidenceRecordDraft } from "@ai-career/evidence";
import type { CustomerSuccessDomainData } from "../evaluator";
import { createCustomerSuccessProfileContext } from "../profile/user-profile";
import { alexFitDataSchema } from "../schemas/alex-fit";
import { burnoutRiskDataSchema } from "../schemas/burnout-risk";
import { companyAlignmentDataSchema } from "../schemas/company-alignment";
import { organizationalMaturityDataSchema } from "../schemas/organizational-maturity";
import {
  resumeMatchDataSchema,
  semanticResumeMatchSchema,
  type ResumeMatchData,
} from "../schemas/resume-match";
import {
  hardFiltersDataSchema,
  jobEvaluationDataSchema,
} from "../schemas/results";

export function resumeMatchBand(score: number) {
  if (score <= 19) return "VERY_LOW" as const;
  if (score <= 39) return "LOW" as const;
  if (score <= 59) return "MIXED_MODERATE" as const;
  if (score <= 79) return "GOOD_HIGH" as const;
  return "VERY_STRONG_VERY_HIGH" as const;
}

function notEvaluated(reason: string) {
  const data = resumeMatchDataSchema.parse({ evaluated: false, reason });
  return {
    classification: "NOT_EVALUATED",
    data,
    evidence: [],
    findings: [reason],
    strengths: [],
    concerns: [reason],
    unknowns: [],
    contradictions: [],
    confidence: null,
    completeness: "INSUFFICIENT" as const,
  };
}

function assertReferenceSources(input: {
  references: string[];
  knownEvidence: Map<string, EvidenceRecordDraft>;
  expected: "JD" | "PROFILE";
  label: string;
}) {
  const invalid = input.references.filter((reference) => {
    const evidence = input.knownEvidence.get(reference);
    return input.expected === "PROFILE"
      ? evidence?.sourceType !== "USER_PROFILE"
      : evidence?.sourceType === "USER_PROFILE";
  });
  if (invalid.length > 0) {
    throw new StructuredOutputValidationError(
      `${input.label} contains invalid ${input.expected.toLowerCase()} evidence: ${invalid.join(", ")}`,
    );
  }
}

export function createResumeMatchStage() {
  return defineEvaluationStage<CustomerSuccessDomainData, ResumeMatchData>({
    id: "resume-match",
    version: "cs-resume-match-v1",
    ruleVersion: "cs-rules-v1.1",
    promptVersion: "cs-resume-match-v1",
    onFailure: "STOP",
    maxAttempts: 2,
    invalidOutputRetryable: true,
    dataSchema: resumeMatchDataSchema,
    async evaluate(context) {
      const stageData = (stageId: string) =>
        context.previousStageResults.find((stage) => stage.stageId === stageId)
          ?.result?.data;
      const hardFilters = hardFiltersDataSchema.parse(stageData("hard-filters"));
      const jobEvaluation = jobEvaluationDataSchema.parse(
        stageData("job-evaluation"),
      );
      const companyAlignment = companyAlignmentDataSchema.parse(
        stageData("company-alignment"),
      );
      const organizationalMaturity = organizationalMaturityDataSchema.parse(
        stageData("organizational-maturity"),
      );
      const alexFit = alexFitDataSchema.parse(stageData("alex-fit"));
      const burnoutRisk = burnoutRiskDataSchema.parse(stageData("burnout-risk"));

      if (
        hardFilters.overall === "FAIL" ||
        !jobEvaluation.evaluated ||
        !companyAlignment.evaluated ||
        !organizationalMaturity.evaluated ||
        !alexFit.evaluated ||
        !burnoutRisk.evaluated
      ) {
        return notEvaluated(
          "Resume Match was not performed because substantive evaluation did not continue.",
        );
      }
      if (!context.userProfile) {
        return notEvaluated(
          "Resume Match was not performed because no versioned user profile was supplied.",
        );
      }

      const reconstruction =
        context.domainData.reconstruction ?? hardFilters.reconstruction;
      context.domainData.reconstruction = reconstruction;
      const profile =
        context.domainData.userProfile ??
        createCustomerSuccessProfileContext(context.userProfile);
      context.domainData.userProfile = profile;
      const availableEvidence = [...reconstruction.evidence, ...profile.evidence];
      const knownEvidence = new Map(
        availableEvidence.map((item) => [item.referenceId, item]),
      );
      const match = semanticResumeMatchSchema.parse(
        await context.domainData.semanticOperations.evaluateResumeMatch({
          responsibilityMap: reconstruction.responsibilityMap,
          requirementMap: reconstruction.requirements,
          ownershipMap: reconstruction.ownershipMap,
          roleMetadata: reconstruction.roleMetadata,
          jobEvaluation,
          companyAlignment,
          organizationalMaturity,
          alexFit,
          burnoutRisk,
          userProfile: profile,
          preferences: {
            fitPreferences: context.domainData.preferences.fitPreferences,
            careerStrategy: context.domainData.preferences.careerStrategy,
          },
          availableEvidence,
        }),
      );

      const seenRequirementIndexes = new Set<number>();
      for (const assessment of match.requirementAssessments) {
        const requirement = reconstruction.requirements[assessment.requirementIndex];
        if (!requirement) {
          throw new StructuredOutputValidationError(
            `Resume Match references nonexistent requirement index ${assessment.requirementIndex}`,
          );
        }
        if (seenRequirementIndexes.has(assessment.requirementIndex)) {
          throw new StructuredOutputValidationError(
            `Resume Match repeats requirement index ${assessment.requirementIndex}`,
          );
        }
        seenRequirementIndexes.add(assessment.requirementIndex);
        if (
          assessment.requirementText !== requirement.requirement ||
          assessment.category !== requirement.category ||
          assessment.strength !== requirement.strength ||
          assessment.statedYears !== requirement.statedYears ||
          assessment.statedYearsMaximum !== requirement.statedYearsMaximum ||
          assessment.statedYearsOpenEnded !== requirement.statedYearsOpenEnded ||
          assessment.requestedExperienceSpecificity !==
            requirement.experienceSpecificity ||
          assessment.isAmbiguous !== requirement.ambiguity.isAmbiguous ||
          assessment.ambiguityExplanation !== requirement.ambiguity.explanation
        ) {
          throw new StructuredOutputValidationError(
            `Resume Match altered structured requirement ${assessment.requirementIndex}`,
          );
        }
        if (
          !assessment.jdEvidenceReferences.some((reference) =>
            requirement.evidenceReferences.includes(reference),
          )
        ) {
          throw new StructuredOutputValidationError(
            `Requirement ${assessment.requirementIndex} is not connected to its JD evidence`,
          );
        }
        if (
          requirement.ambiguity.isAmbiguous &&
          assessment.classification !== "UNKNOWN"
        ) {
          throw new StructuredOutputValidationError(
            `Ambiguous requirement ${assessment.requirementIndex} must remain Unknown`,
          );
        }
        assertReferenceSources({
          references: assessment.jdEvidenceReferences,
          knownEvidence,
          expected: "JD",
          label: `Requirement ${assessment.requirementIndex}`,
        });
        assertReferenceSources({
          references: assessment.profileEvidenceReferences,
          knownEvidence,
          expected: "PROFILE",
          label: `Requirement ${assessment.requirementIndex}`,
        });
      }
      const omittedRequiredRequirements = reconstruction.requirements
        .map((requirement, index) => ({ requirement, index }))
        .filter(
          ({ requirement, index }) =>
            requirement.strength === "REQUIRED" &&
            !seenRequirementIndexes.has(index),
        )
        .map(({ index }) => index);
      if (omittedRequiredRequirements.length > 0) {
        throw new StructuredOutputValidationError(
          `Resume Match omitted required requirement indexes: ${omittedRequiredRequirements.join(", ")}`,
        );
      }

      const requirementIndexes = [
        ...match.effectiveSeniority.statedYears.requirementIndexes,
        ...match.effectiveSeniority.requirementStrength.requirementIndexes,
        ...match.effectiveSeniority.experienceSpecificity.requirementIndexes,
      ];
      if (
        requirementIndexes.some(
          (index) => reconstruction.requirements[index] === undefined,
        )
      ) {
        throw new StructuredOutputValidationError(
          "Effective Seniority references a nonexistent requirement",
        );
      }

      const references = new Set([
        ...match.scoreEvidenceReferences,
        ...match.evidenceReferences,
        ...match.requirementAssessments.flatMap((item) => [
          ...item.jdEvidenceReferences,
          ...item.profileEvidenceReferences,
        ]),
        ...match.effectiveSeniority.statedYears.evidenceReferences,
        ...match.effectiveSeniority.requirementStrength.evidenceReferences,
        ...match.effectiveSeniority.experienceSpecificity.evidenceReferences,
        ...match.effectiveSeniority.actualResponsibilitySeniority.evidenceReferences,
        ...match.effectiveSeniority.actualResponsibilitySeniority.signals.flatMap(
          (item) => item.evidenceReferences,
        ),
        ...match.effectiveSeniority.evidenceReferences,
        ...match.strongStrengths.flatMap((item) => item.evidenceReferences),
        ...match.partialMatches.flatMap((item) => item.evidenceReferences),
        ...match.genuineGaps.flatMap((item) => item.evidenceReferences),
        ...match.unknowns.flatMap((item) => item.evidenceReferences),
        ...match.positioningRecommendations.flatMap(
          (item) => item.evidenceReferences,
        ),
        ...match.contradictions.flatMap((item) => [
          ...item.evidenceReferencesA,
          ...item.evidenceReferencesB,
        ]),
      ]);
      const missing = [...references].filter(
        (reference) => !knownEvidence.has(reference),
      );
      if (missing.length > 0) {
        throw new StructuredOutputValidationError(
          `Resume Match references unknown evidence: ${missing.join(", ")}`,
        );
      }

      const hasJdEvidence = (items: string[]) =>
        items.some(
          (reference) => knownEvidence.get(reference)?.sourceType !== "USER_PROFILE",
        );
      const hasProfileEvidence = (items: string[]) =>
        items.some(
          (reference) => knownEvidence.get(reference)?.sourceType === "USER_PROFILE",
        );
      if (
        !hasJdEvidence(match.scoreEvidenceReferences) ||
        !hasProfileEvidence(match.scoreEvidenceReferences)
      ) {
        throw new StructuredOutputValidationError(
          "The Resume Match score requires both JD and user-profile evidence",
        );
      }
      if (
        !hasJdEvidence(match.effectiveSeniority.evidenceReferences) ||
        !hasProfileEvidence(match.effectiveSeniority.evidenceReferences)
      ) {
        throw new StructuredOutputValidationError(
          "Effective Seniority requires both JD and user-profile evidence",
        );
      }
      for (const recommendation of match.positioningRecommendations) {
        if (
          !hasJdEvidence(recommendation.evidenceReferences) ||
          !hasProfileEvidence(recommendation.evidenceReferences)
        ) {
          throw new StructuredOutputValidationError(
            "Resume-positioning recommendations require both JD and user-profile evidence",
          );
        }
      }

      const band = resumeMatchBand(match.score);
      const data = resumeMatchDataSchema.parse({ evaluated: true, band, match });
      const selectedEvidence = [...references].map(
        (reference) => knownEvidence.get(reference)!,
      );
      return {
        classification: band,
        data,
        evidence: selectedEvidence,
        findings: [
          match.summary,
          match.scoreExplanation,
          match.effectiveSeniority.explanation,
        ],
        strengths: match.strongStrengths.map((item) => item.finding),
        concerns: match.genuineGaps.map((item) => item.finding),
        unknowns: match.unknowns.map(({ code, description, materiality }) => ({
          code,
          description,
          materiality,
        })),
        contradictions: match.contradictions,
        confidence:
          match.contradictions.length > 0 ? "CONFLICTING" : "STRONG_EVIDENCE",
        completeness: match.unknowns.length > 0 ? "PARTIAL" : "COMPLETE",
      };
    },
  });
}
