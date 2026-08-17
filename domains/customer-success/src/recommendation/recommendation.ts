import { StructuredOutputValidationError } from "@ai-career/evaluation";
import type { EvidenceRecordDraft } from "@ai-career/evidence";
import type { AlexFitData } from "../schemas/alex-fit";
import type { BurnoutRiskData } from "../schemas/burnout-risk";
import type {
  CompanyAlignmentData,
  SemanticCompanyAlignment,
} from "../schemas/company-alignment";
import type { GhostJobRiskData } from "../schemas/ghost-job-risk";
import type { OrganizationalMaturityData } from "../schemas/organizational-maturity";
import type { OpportunityPriorityData } from "../schemas/opportunity-priority";
import {
  customerSuccessRecommendationSchema,
  type CustomerSuccessRecommendation,
} from "../schemas/recommendation";
import type { ResumeMatchData } from "../schemas/resume-match";
import type { HardFiltersData, JobEvaluationData } from "../schemas/results";

type SupportedFinding = SemanticCompanyAlignment["strategicAdvantages"][number];
type SupportedUnknown = SemanticCompanyAlignment["unknowns"][number];

export interface CustomerSuccessRecommendationInput {
  hardFilters: HardFiltersData;
  jobEvaluation: JobEvaluationData;
  companyAlignment: CompanyAlignmentData;
  organizationalMaturity: OrganizationalMaturityData;
  alexFit: AlexFitData;
  burnoutRisk: BurnoutRiskData;
  resumeMatch: ResumeMatchData;
  opportunityPriority: OpportunityPriorityData;
  ghostJobRisk: GhostJobRiskData;
  availableEvidence: EvidenceRecordDraft[];
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function supported(
  finding: string,
  evidenceReferences: string[],
): SupportedFinding | null {
  return evidenceReferences.length > 0
    ? { finding, evidenceReferences: [...new Set(evidenceReferences)] }
    : null;
}

export function createCustomerSuccessRecommendation(
  input: CustomerSuccessRecommendationInput,
): {
  recommendation: CustomerSuccessRecommendation;
  strengths: SupportedFinding[];
  concerns: SupportedFinding[];
  unknowns: SupportedUnknown[];
  contradictions: CustomerSuccessRecommendation["contradictions"];
  evidenceReferences: string[];
} {
  const strengths: SupportedFinding[] = [];
  const concerns: SupportedFinding[] = [];
  const unknowns: SupportedUnknown[] = [];
  const contradictions: CustomerSuccessRecommendation["contradictions"] = [];

  for (const criterion of [
    input.hardFilters.role,
    input.hardFilters.salary,
    input.hardFilters.location,
    input.hardFilters.workArrangement,
    input.hardFilters.travel,
  ]) {
    const finding = supported(criterion.explanation, criterion.evidenceReferences);
    if (finding && criterion.result === "PASS") strengths.push(finding);
    if (finding && ["FAIL", "REVIEW"].includes(criterion.result)) {
      concerns.push(finding);
    }
    if (criterion.result === "UNKNOWN") {
      unknowns.push({
        code: `hard-filter-${criterion === input.hardFilters.salary ? "salary" : criterion === input.hardFilters.location ? "location" : criterion === input.hardFilters.workArrangement ? "work-arrangement" : criterion === input.hardFilters.travel ? "travel" : "role"}-unknown`,
        description: criterion.explanation,
        materiality: "A hard-filter decision remains unresolved.",
        evidenceReferences: criterion.evidenceReferences,
      });
    }
  }

  if (input.jobEvaluation.evaluated) {
    const evaluation = input.jobEvaluation.evaluation;
    strengths.push(
      ...evaluation.strengths
        .map((item) =>
          supported(item, evaluation.evidenceReferences),
        )
        .filter((item): item is SupportedFinding => item !== null),
    );
    concerns.push(
      ...evaluation.concerns
        .map((item) =>
          supported(item, evaluation.evidenceReferences),
        )
        .filter((item): item is SupportedFinding => item !== null),
    );
    unknowns.push(
      ...evaluation.unknowns.map((item) => ({
        ...item,
        evidenceReferences: [],
      })),
    );
    contradictions.push(...evaluation.contradictions);
  }
  if (input.companyAlignment.evaluated) {
    strengths.push(...input.companyAlignment.alignment.strategicAdvantages);
    concerns.push(...input.companyAlignment.alignment.potentialConcerns);
    unknowns.push(...input.companyAlignment.alignment.unknowns);
    contradictions.push(...input.companyAlignment.alignment.contradictions);
  }
  if (input.organizationalMaturity.evaluated) {
    strengths.push(...input.organizationalMaturity.maturity.positiveSignals);
    concerns.push(...input.organizationalMaturity.maturity.weakSignals);
    unknowns.push(...input.organizationalMaturity.maturity.unknowns);
    contradictions.push(...input.organizationalMaturity.maturity.contradictions);
  }
  if (input.alexFit.evaluated) {
    strengths.push(
      ...input.alexFit.fit.strongestMatches,
      ...input.alexFit.fit.strategicValue,
    );
    concerns.push(...input.alexFit.fit.concerns);
    unknowns.push(...input.alexFit.fit.unknowns);
    contradictions.push(...input.alexFit.fit.contradictions);
  }
  if (input.burnoutRisk.evaluated) {
    strengths.push(...input.burnoutRisk.risk.positiveIndicators);
    concerns.push(...input.burnoutRisk.risk.majorContributors);
    unknowns.push(...input.burnoutRisk.risk.unknowns);
    contradictions.push(...input.burnoutRisk.risk.contradictions);
  }
  if (input.resumeMatch.evaluated) {
    strengths.push(...input.resumeMatch.match.strongStrengths);
    concerns.push(
      ...input.resumeMatch.match.partialMatches,
      ...input.resumeMatch.match.genuineGaps,
    );
    unknowns.push(...input.resumeMatch.match.unknowns);
    contradictions.push(...input.resumeMatch.match.contradictions);
  }
  if (input.opportunityPriority.evaluated) {
    strengths.push(...input.opportunityPriority.priority.reasonsForPrioritization);
    concerns.push(
      ...input.opportunityPriority.priority.reasonsForReducedPriority,
    );
    unknowns.push(...input.opportunityPriority.priority.unknowns);
    if (input.opportunityPriority.timing.classification === "UNKNOWN") {
      unknowns.push({
        code: "posting-age-unknown",
        description: input.opportunityPriority.timing.explanation,
        materiality: "Application timing cannot be calibrated from age.",
        evidenceReferences:
          input.opportunityPriority.timing.evidenceReferences,
      });
    }
    contradictions.push(...input.opportunityPriority.priority.contradictions);
  }
  if (input.ghostJobRisk.evaluated) {
    unknowns.push(...input.ghostJobRisk.risk.unknowns);
    contradictions.push(...input.ghostJobRisk.risk.contradictions);
    const ghostFinding = supported(
      input.ghostJobRisk.risk.interpretation,
      input.ghostJobRisk.risk.evidenceReferences,
    );
    if (ghostFinding && input.ghostJobRisk.risk.classification === "LOW") {
      strengths.push(ghostFinding);
    } else if (
      ghostFinding &&
      ["POSSIBLE", "ELEVATED", "HIGH"].includes(
        input.ghostJobRisk.risk.classification,
      )
    ) {
      concerns.push(ghostFinding);
    }
  }

  const skipReasons: string[] = [];
  const reviewReasons: string[] = [];
  const decisionRelevantUnknowns: SupportedUnknown[] = [];
  if (input.hardFilters.overall === "FAIL") {
    skipReasons.push("A deterministic hard filter failed.");
  }
  if (input.hardFilters.role.classification === "UNRELATED") {
    skipReasons.push("The reconstructed actual work is unrelated to Customer Success.");
  }
  if (input.resumeMatch.evaluated) {
    const resumeMatch = input.resumeMatch.match;
    const requiredGaps =
      resumeMatch.requirementAssessments.filter(
        (item) =>
          item.strength === "REQUIRED" &&
          item.classification === "GENUINE_GAP",
      );
    const contradictedGapIndexes = new Set(
      requiredGaps
        .filter((gap) => {
          const gapReferences = new Set([
            ...gap.jdEvidenceReferences,
            ...gap.profileEvidenceReferences,
          ]);
          return resumeMatch.contradictions.some((contradiction) =>
            [
              ...contradiction.evidenceReferencesA,
              ...contradiction.evidenceReferencesB,
            ].some((reference) => gapReferences.has(reference)),
          );
        })
        .map((gap) => gap.requirementIndex),
    );
    if (
      resumeMatch.effectiveSeniority.effectiveLevelFit ===
      "ABOVE_LEVEL"
    ) {
      skipReasons.push("Effective Seniority is Above Level.");
    }
    if (
      requiredGaps.some(
        (item) =>
          item.decisionImpact === "DECISIVE_DISQUALIFIER" &&
          !contradictedGapIndexes.has(item.requirementIndex),
      )
    ) {
      skipReasons.push(
        "A required, genuinely unsupported qualification is established by evidence as a decisive disqualifier.",
      );
    }
    if (
      requiredGaps.some(
        (item) =>
          item.decisionImpact === "MATERIAL_UNCERTAINTY" ||
          contradictedGapIndexes.has(item.requirementIndex),
      )
    ) {
      reviewReasons.push(
        "A required Genuine Gap has materially unresolved applicability or decision importance.",
      );
    }
    if (resumeMatch.contradictions.length > 0) {
      reviewReasons.push("Effective-seniority evidence contains a material contradiction.");
    }
  }
  if (input.burnoutRisk.evaluated) {
    if (input.burnoutRisk.classification === "VERY_HIGH") {
      skipReasons.push("The combined role design has Very High burnout risk.");
    } else if (input.burnoutRisk.classification === "HIGH") {
      reviewReasons.push("The role has High burnout risk that requires review.");
    }
  }
  if (input.hardFilters.overall === "REVIEW") {
    reviewReasons.push("One or more hard-filter criteria require review or clarification.");
    decisionRelevantUnknowns.push(
      ...unknowns.filter((item) => item.code.startsWith("hard-filter-")),
    );
  }
  if (input.alexFit.evaluated && input.alexFit.fit.classification === "LOW") {
    reviewReasons.push("The holistic Alex Fit assessment is Low and needs a deliberate decision.");
  }
  if (
    input.ghostJobRisk.evaluated &&
    ["POSSIBLE", "ELEVATED", "HIGH"].includes(
      input.ghostJobRisk.risk.classification,
    )
  ) {
    reviewReasons.push("Available posting-history evidence raises an unresolved hiring-activity concern.");
  }

  const recommendation =
    skipReasons.length > 0
      ? "SKIP"
      : reviewReasons.length > 0
        ? "REVIEW"
        : "APPLY";
  const precedenceReasons =
    recommendation === "SKIP"
      ? skipReasons
      : recommendation === "REVIEW"
        ? reviewReasons
        : [
            "Hard filters pass, the role remains substantively aligned, effective level is eligible, and no severe evidenced disqualifier is present.",
          ];
  const uniqueStrengths = uniqueBy(strengths, (item) => item.finding);
  const uniqueConcerns = uniqueBy(concerns, (item) => item.finding);
  const uniqueUnknowns = uniqueBy(unknowns, (item) => item.code);
  const uniqueContradictions = uniqueBy(
    contradictions,
    (item) => `${item.relevantField}:${item.claimA}:${item.claimB}`,
  );
  const evidenceReferences = [
    ...new Set([
      ...uniqueStrengths.flatMap((item) => item.evidenceReferences),
      ...uniqueConcerns.flatMap((item) => item.evidenceReferences),
      ...uniqueUnknowns.flatMap((item) => item.evidenceReferences),
      ...uniqueContradictions.flatMap((item) => [
        ...item.evidenceReferencesA,
        ...item.evidenceReferencesB,
      ]),
      ...input.hardFilters.role.evidenceReferences,
    ]),
  ];
  const knownEvidence = new Set(
    input.availableEvidence.map((item) => item.referenceId),
  );
  const missing = evidenceReferences.filter(
    (reference) => !knownEvidence.has(reference),
  );
  if (missing.length > 0) {
    throw new StructuredOutputValidationError(
      `Final recommendation references unknown evidence: ${missing.join(", ")}`,
    );
  }

  const parsedRecommendation = customerSuccessRecommendationSchema.parse({
    recommendation,
    summary:
      recommendation === "APPLY"
        ? "Apply: the validated evidence supports proceeding without a hard disqualifier or unresolved decisive risk."
        : recommendation === "REVIEW"
          ? "Review: the opportunity remains potentially viable, but a decision-relevant issue requires clarification or judgment."
          : "Skip: deterministic precedence identified a hard failure or explicit major disqualifier that positive soft evidence cannot override.",
    majorStrengths: uniqueStrengths,
    majorConcerns: uniqueConcerns,
    decisionRelevantUnknowns: uniqueBy(
      decisionRelevantUnknowns,
      (item) => item.code,
    ),
    contradictions: uniqueContradictions,
    evidenceReferences,
    precedenceReasons,
    stageReferences: [
      "hard-filters",
      "job-evaluation",
      "company-alignment",
      "organizational-maturity",
      "alex-fit",
      "burnout-risk",
      "resume-match",
      "opportunity-priority",
      "ghost-job-risk",
    ],
  });
  return {
    recommendation: parsedRecommendation,
    strengths: uniqueStrengths,
    concerns: uniqueConcerns,
    unknowns: uniqueUnknowns,
    contradictions: uniqueContradictions,
    evidenceReferences,
  };
}
