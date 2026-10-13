import {
  contradictionDraftSchema,
  evidenceRecordDraftSchema,
} from "@ai-career/evidence";
import { z } from "zod";
import {
  assertSemanticEvidenceReferences,
  parseSemanticDomainResult,
  semanticContractViolation,
} from "./semantic-contract";

const requiredText = z.string().trim().min(1).regex(/\S/);
const optionalText = requiredText.nullable();
const evidenceReferences = z.array(requiredText);

export const responsibilityAreas = [
  "onboarding",
  "adoption",
  "engagement",
  "retention",
  "renewals",
  "expansion",
  "education",
  "enablement",
  "relationshipManagement",
  "support",
  "implementation",
  "projectManagement",
  "technicalTroubleshooting",
  "analytics",
  "customerInsights",
  "productFeedback",
  "executiveEngagement",
  "processDevelopment",
] as const;

export const responsibilityAreaSchema = z.enum(responsibilityAreas);

export const responsibilityProminenceSchema = z.enum([
  "PRIMARY",
  "SUBSTANTIAL",
  "SECONDARY",
  "OCCASIONAL",
  "ABSENT",
  "UNKNOWN",
]);

export const responsibilityOwnershipSchema = z.enum([
  "OWNS",
  "SHARES",
  "SUPPORTS",
  "COLLABORATES",
  "RECEIVES_HANDOFF",
  "HANDS_OFF",
  "UNKNOWN",
]);

export const responsibilityAssessmentSchema = z
  .object({
    prominence: responsibilityProminenceSchema,
    ownership: responsibilityOwnershipSchema,
    evidenceReferences,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.prominence !== "UNKNOWN" &&
      value.evidenceReferences.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known responsibility conclusions require evidence",
      });
    }
  });

export const responsibilityMapSchema = z
  .object({
    areas: z.record(responsibilityAreaSchema, responsibilityAssessmentSchema),
    other: z.array(
      z
        .object({
          responsibility: requiredText,
          prominence: responsibilityProminenceSchema,
          ownership: responsibilityOwnershipSchema,
          evidenceReferences: evidenceReferences.min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const requirementStrengthSchema = z.enum([
  "REQUIRED",
  "PREFERRED",
  "IDEAL",
  "NICE_TO_HAVE",
  "AMBIGUOUS",
]);

export const requirementCategorySchema = z.enum([
  "EXPERIENCE",
  "CAPABILITY",
  "TOOL",
  "INDUSTRY",
  "EDUCATION",
  "CERTIFICATION",
  "TECHNICAL_KNOWLEDGE",
  "LANGUAGE",
  "LOCATION",
  "TRAVEL",
]);

// The Customer Success experience ladder, most specific first. Resume Match
// profile labels and specificity values use the same ladder.
export const customerSuccessExperienceLadder = [
  "DIRECT_SAAS_CUSTOMER_SUCCESS",
  "DIRECT_CUSTOMER_SUCCESS",
  "RELATED_CUSTOMER_RELATIONSHIP",
  "BROADER_CUSTOMER_FACING",
] as const;

// The least specific experience that satisfies an EXPERIENCE requirement:
// a ladder rung, or ANY_WORK_EXPERIENCE when the requirement's subject is not
// a Customer Success level (remote work, a customer segment, company stage).
export const requirementExperienceLevelSchema = z.enum([
  ...customerSuccessExperienceLadder,
  "ANY_WORK_EXPERIENCE",
]);

export type RequirementExperienceLevel = z.infer<
  typeof requirementExperienceLevelSchema
>;

// Identifies evidence authored by JD Reconstruction, as opposed to
// deterministically extracted job facts.
export const jdReconstructionCriterionId = "jd-reconstruction";
// Identifies deterministically extracted candidate-requirement lines.
export const deterministicRequirementCriterionId = "candidate-requirement";

// The source statement a JD Reconstruction requirement was decomposed from.
// Every qualification of one statement shares its single evidence record and
// the strengths and experience levels the statement was declared to express.
// Absent only in historical maps and deterministic requirements.
export const requirementSourceStatementSchema = z
  .object({
    statementIndex: z.number().int().nonnegative(),
    statementStrengths: z.array(requirementStrengthSchema).min(1),
    statementExperienceLevels: z.array(requirementExperienceLevelSchema),
  })
  .strict();

export const requirementSchema = z
  .object({
    requirement: requiredText,
    category: requirementCategorySchema,
    strength: requirementStrengthSchema,
    statedYears: z.number().nonnegative().nullable(),
    statedYearsMaximum: z.number().nonnegative().nullable(),
    statedYearsOpenEnded: z.boolean(),
    experienceSpecificity: optionalText,
    // Structured experience semantics authored by JD Reconstruction and
    // consumed by Resume Match legality. Absent only in historical maps, which
    // carry no experience-level semantics; wording is never consulted instead.
    minimumExperienceSpecificity: requirementExperienceLevelSchema.optional(),
    requiresStartupExperience: z.boolean().optional(),
    // Historical JD Reconstruction key, still readable in persisted results.
    // It carries no semantics and is never authored.
    requiresDirectWorkExperience: z.boolean().optional(),
    evidenceReferences: evidenceReferences.min(1),
    ambiguity: z
      .object({
        isAmbiguous: z.boolean(),
        explanation: optionalText,
      })
      .strict(),
    sourceStatement: requirementSourceStatementSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    // Statement-derived requirements carry structural ambiguity and a strength
    // and level their statement declared. Historical maps stay readable.
    if (value.sourceStatement !== undefined) {
      if (value.ambiguity.isAmbiguous !== (value.strength === "AMBIGUOUS")) {
        context.addIssue({
          code: "custom",
          path: ["ambiguity", "isAmbiguous"],
          message: "Requirement ambiguity is derived from an AMBIGUOUS strength",
        });
      }
      if (!value.sourceStatement.statementStrengths.includes(value.strength)) {
        context.addIssue({
          code: "custom",
          path: ["strength"],
          message: "Requirement strength must be one its source statement expresses",
        });
      }
      if (
        value.category === "EXPERIENCE" &&
        (value.minimumExperienceSpecificity === undefined ||
          !value.sourceStatement.statementExperienceLevels.includes(
            value.minimumExperienceSpecificity,
          ))
      ) {
        context.addIssue({
          code: "custom",
          path: ["minimumExperienceSpecificity"],
          message: "Requirement experience level must be one its source statement expresses",
        });
      }
    }
    if (
      value.statedYears !== null &&
      value.statedYearsMaximum !== null &&
      value.statedYearsMaximum < value.statedYears
    ) {
      context.addIssue({
        code: "custom",
        path: ["statedYearsMaximum"],
        message: "The maximum stated years cannot be below the minimum",
      });
    }
    // Experience semantics belong to EXPERIENCE requirements only. INDUSTRY
    // requirements already carry direct-specialization legality by category.
    if (
      value.category !== "EXPERIENCE" &&
      (value.minimumExperienceSpecificity !== undefined ||
        value.requiresDirectWorkExperience === true ||
        value.requiresStartupExperience === true)
    ) {
      context.addIssue({
        code: "custom",
        path: ["category"],
        message: "Only EXPERIENCE requirements can carry specialization semantics",
      });
    }
  });

function sameMembers(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

// The qualifications of one source statement must together express exactly
// the strengths and experience levels the statement declares: neither an
// unexpressed declaration (a lost qualification) nor an undeclared value.
type StatementMember = Pick<
  z.infer<typeof requirementSchema>,
  | "category"
  | "strength"
  | "minimumExperienceSpecificity"
  | "evidenceReferences"
  | "sourceStatement"
>;

export function requirementStatementViolations(
  requirements: ReadonlyArray<StatementMember>,
) {
  const statements = new Map<number, StatementMember[]>();
  for (const requirement of requirements) {
    if (requirement.sourceStatement === undefined) continue;
    const members = statements.get(requirement.sourceStatement.statementIndex) ?? [];
    members.push(requirement);
    statements.set(requirement.sourceStatement.statementIndex, members);
  }
  const violations: string[] = [];
  for (const [statementIndex, members] of statements) {
    const declared = members[0]!.sourceStatement!;
    const evidence = JSON.stringify(members[0]!.evidenceReferences);
    if (
      members.some(
        (member) =>
          JSON.stringify(member.sourceStatement) !== JSON.stringify(declared) ||
          JSON.stringify(member.evidenceReferences) !== evidence,
      )
    ) {
      violations.push(
        `Statement ${statementIndex} qualifications disagree on their source statement`,
      );
      continue;
    }
    if (
      !sameMembers(
        declared.statementStrengths,
        [...new Set(members.map((member) => member.strength))],
      )
    ) {
      violations.push(
        `Statement ${statementIndex} qualification strengths do not correspond to its statement strengths`,
      );
    }
    if (
      !sameMembers(
        declared.statementExperienceLevels,
        [
          ...new Set(
            members.flatMap((member) =>
              member.category === "EXPERIENCE" &&
              member.minimumExperienceSpecificity !== undefined
                ? [member.minimumExperienceSpecificity]
                : [],
            ),
          ),
        ],
      )
    ) {
      violations.push(
        `Statement ${statementIndex} qualification experience levels do not correspond to its statement experience levels`,
      );
    }
  }
  return violations;
}

export const requirementMapSchema = z
  .array(requirementSchema)
  .superRefine((requirements, context) => {
    for (const message of requirementStatementViolations(requirements)) {
      context.addIssue({ code: "custom", message });
    }
  });

export const ownershipFunctions = [
  "customerSuccess",
  "sales",
  "support",
  "product",
  "implementation",
  "education",
  "community",
  "marketing",
  "projectManagement",
] as const;

export const ownershipFunctionSchema = z.enum(ownershipFunctions);

export const crossFunctionalOwnershipSchema = z.enum([
  "OWNS",
  "SHARES",
  "COLLABORATES",
  "HANDS_OFF_TO",
  "RECEIVES_FROM",
  "UNCLEAR_BOUNDARIES",
]);

const ownershipFunctionAssessmentSchema = z
  .object({
    relationship: crossFunctionalOwnershipSchema,
    evidenceReferences: evidenceReferences.min(1),
  })
  .strict();

export const ownershipMapSchema = z
  .object({
    functions: z.partialRecord(
      ownershipFunctionSchema,
      ownershipFunctionAssessmentSchema,
    ),
  })
  .strict();

export const roleClassificationSchema = z.enum([
  "CORE_CS",
  "CS_ADJACENT",
  "SUPPORT_HEAVY",
  "SALES_HEAVY",
  "IMPLEMENTATION_HEAVY",
  "TECHNICAL_CS",
  "UNRELATED",
]);

export const locationFactsSchema = z
  .object({
    countryRestrictions: z.array(requiredText),
    remoteStatus: z.enum(["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"]),
    timeZoneRequirements: z.array(requiredText),
    internationalEligibility: z.enum([
      "EXPLICITLY_ALLOWED",
      "EXPLICITLY_NOT_ALLOWED",
      "UNKNOWN",
    ]),
    visaSponsorship: z.enum(["AVAILABLE", "NOT_AVAILABLE", "UNKNOWN"]),
    relocation: z.enum(["AVAILABLE", "REQUIRED", "NOT_AVAILABLE", "UNKNOWN"]),
    eor: z.enum(["AVAILABLE", "NOT_AVAILABLE", "UNKNOWN"]),
    evidenceReferences,
  })
  .strict();

export const salaryFactsSchema = z
  .object({
    minimum: z.number().nonnegative().nullable(),
    maximum: z.number().nonnegative().nullable(),
    currency: optionalText,
    disclosure: z.enum(["DISCLOSED", "COMPETITIVE", "UNDISCLOSED"]),
    evidenceReferences,
  })
  .strict();

export const travelFactsSchema = z
  .object({
    statedPercentage: z.number().min(0).max(100).nullable(),
    frequency: optionalText,
    mandatory: z.boolean().nullable(),
    scope: z.enum(["DOMESTIC", "INTERNATIONAL", "BOTH", "UNKNOWN"]),
    purpose: z.enum([
      "CUSTOMER_ONSITE",
      "COMPANY_EVENT",
      "CONFERENCE",
      "FIELD_TRAVEL",
      "NONE",
      "OTHER",
      "UNKNOWN",
    ]),
    evidenceReferences,
  })
  .strict();

export const semanticReconstructionSchema = z
  .object({
    responsibilityMap: responsibilityMapSchema,
    requirements: requirementMapSchema,
    ownershipMap: ownershipMapSchema,
    roleMetadata: z
      .object({
        actualRoleClassification: roleClassificationSchema,
        evidenceReferences: evidenceReferences.min(1),
      })
      .strict(),
    evidence: z.array(evidenceRecordDraftSchema),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

const knownResponsibilityProminences = [
  "PRIMARY",
  "SUBSTANTIAL",
  "SECONDARY",
  "OCCASIONAL",
] as const;

const transportResponsibilityAreaEntrySchema = z.union([
  z
    .object({
      area: responsibilityAreaSchema,
      prominence: z.enum(knownResponsibilityProminences),
      ownership: responsibilityOwnershipSchema,
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      area: responsibilityAreaSchema,
      prominence: z.literal("ABSENT"),
      ownership: responsibilityOwnershipSchema,
      absenceBasis: z.literal("EXPLICIT_EXCLUSION"),
      evidenceReferences: evidenceReferences.min(1),
    })
    .strict(),
  z
    .object({
      area: responsibilityAreaSchema,
      prominence: z.literal("UNKNOWN"),
      ownership: responsibilityOwnershipSchema,
      evidenceReferences,
    })
    .strict(),
]);

const transportResponsibilityAreasSchema = z
  .array(transportResponsibilityAreaEntrySchema)
  .length(responsibilityAreas.length);

const transportOwnershipFunctionsSchema = z
  .array(
    z
      .object({
        function: ownershipFunctionSchema,
        relationship: crossFunctionalOwnershipSchema,
        evidenceReferences: evidenceReferences.min(1),
      })
      .strict(),
  )
  .max(ownershipFunctions.length);

export const requirementSpecializationDescriptions = {
  minimumExperienceSpecificity:
    "The least specific experience that satisfies this requirement. DIRECT_SAAS_CUSTOMER_SUCCESS: Customer Success employment in SaaS. DIRECT_CUSTOMER_SUCCESS: Customer Success employment. RELATED_CUSTOMER_RELATIONSHIP: customer-relationship or account roles. BROADER_CUSTOMER_FACING: any customer-facing work. ANY_WORK_EXPERIENCE: the subject is not a Customer Success level, such as remote work, a customer segment, or company stage.",
  requiresStartupExperience:
    "True only if this requirement demands startup or early-stage company experience.",
} as const;

// Shared fields are named definitions so the category-bound union below does
// not repeat them in every branch of the provider schema.
const transportRequirementYears = z.number().nonnegative().nullable().meta({ id: "requirementYears" });
const transportMinimumExperienceSpecificity = requirementExperienceLevelSchema
  .describe(requirementSpecializationDescriptions.minimumExperienceSpecificity)
  .meta({ id: "requirementMinimumExperienceSpecificity" });

// Ambiguity is derived from strength: only an AMBIGUOUS strength can carry an
// (display-only) explanation, and an explicit strength cannot be ambiguous.
const transportQualificationStrength = z
  .union([
    z.object({ strength: requirementStrengthSchema.exclude(["AMBIGUOUS"]) }).strict(),
    z
      .object({
        strength: z.literal("AMBIGUOUS"),
        ambiguityExplanation: requiredText,
      })
      .strict(),
  ])
  .meta({ id: "qualificationStrength" });

const transportRequirementSharedShape = {
  requirement: requiredText.meta({ id: "requirementText" }),
  strengthAssessment: transportQualificationStrength,
  statedYears: transportRequirementYears,
  statedYearsMaximum: transportRequirementYears,
  statedYearsOpenEnded: z.boolean(),
  experienceSpecificity: optionalText.meta({ id: "requirementSpecificity" }),
};


// Only EXPERIENCE requirements can express experience semantics; other
// categories have no such fields, so the provider cannot author them there.
const transportRequirementCategoryShapes = [
  {
    category: requirementCategorySchema.exclude(["EXPERIENCE"]).meta({ id: "nonExperienceRequirementCategory" }),
  },
  {
    category: z.literal("EXPERIENCE"),
    minimumExperienceSpecificity: transportMinimumExperienceSpecificity,
    requiresStartupExperience: z
      .boolean()
      .describe(requirementSpecializationDescriptions.requiresStartupExperience),
  },
] as const;

const transportRequirementUnitShapes = [
  {
    assessmentUnit: z.literal("INDEPENDENT_QUALIFICATION"),
    compoundExplanation: z.null(),
  },
  {
    assessmentUnit: z.literal("SINGLE_COMPOUND_CONCEPT"),
    compoundExplanation: requiredText,
  },
] as const;

const { requirement: transportRequirementText, ...transportRequirementDetailShape } =
  transportRequirementSharedShape;

const transportRequirementVariants = transportRequirementCategoryShapes.flatMap(
  (categoryShape) =>
    transportRequirementUnitShapes.map((unitShape) =>
      z.object({
        requirement: transportRequirementText,
        ...categoryShape,
        ...transportRequirementDetailShape,
        ...unitShape,
      }).strict(),
    ),
);

const transportQualificationSchema = z.union([
  transportRequirementVariants[0]!,
  transportRequirementVariants[1]!,
  ...transportRequirementVariants.slice(2),
]);

export const requirementStatementDescriptions = {
  evidenceReference:
    "The one evidence record whose sourceText quotes this source statement verbatim.",
  statementStrengths:
    "Every requirement strength the statement expresses, each once.",
  statementExperienceLevels:
    "Every minimumExperienceSpecificity used by this statement's EXPERIENCE qualifications, each once.",
  qualifications:
    "The statement's atomic qualifications. Each distinct strength or experience level needs its own qualification.",
} as const;

// One source statement (a bullet or sentence) decomposed into atomic
// qualifications. The application flattens statements into the Requirement Map.
const transportRequirementStatementSchema = z
  .object({
    evidenceReference: requiredText.describe(
      requirementStatementDescriptions.evidenceReference,
    ),
    statementStrengths: z
      .array(requirementStrengthSchema)
      .min(1)
      .describe(requirementStatementDescriptions.statementStrengths),
    statementExperienceLevels: z
      .array(requirementExperienceLevelSchema)
      .describe(requirementStatementDescriptions.statementExperienceLevels),
    qualifications: z
      .array(transportQualificationSchema)
      .min(1)
      .describe(requirementStatementDescriptions.qualifications),
  })
  .strict();

const transportEvidenceRecordDraftSchema = z
  .object({
    sourceIndex: z.literal(0),
    referenceId: requiredText,
    claim: requiredText,
    sourceField: optionalText,
    sourceText: optionalText,
    evidenceType: requiredText,
    origin: evidenceRecordDraftSchema.shape.origin,
    evidenceLevel: evidenceRecordDraftSchema.shape.evidenceLevel,
  })
  .strict();

export const semanticReconstructionEvidenceSourceSchema = z
  .object({
    sourceIndex: z.literal(0),
    sourceType: requiredText,
    sourceRecordId: z.uuid().nullable(),
    provenanceId: z.uuid().nullable(),
    sourceReference: optionalText,
    collectedAt: z.coerce.date().nullable(),
    sourceContent: requiredText,
  })
  .strict()
  .superRefine((source, context) => {
    if (
      source.sourceRecordId === null &&
      source.provenanceId === null &&
      source.sourceReference === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceReference"],
        message:
          "JD Reconstruction evidence source requires a canonical source locator",
      });
    }
  });

const transportContradictionDraftSchema = z
  .object({
    ...contradictionDraftSchema.shape,
    claimA: requiredText,
    claimB: requiredText,
    interpretation: requiredText,
    relevantField: optionalText,
    significance: optionalText,
    evidenceReferencesA: evidenceReferences.min(1),
    evidenceReferencesB: evidenceReferences.min(1),
  })
  .strict();

export const semanticReconstructionTransportSchema = z
  .object({
    responsibilityMap: z
      .object({
        areas: transportResponsibilityAreasSchema,
        other: responsibilityMapSchema.shape.other,
      })
      .strict(),
    requirementStatements: z.array(transportRequirementStatementSchema),
    ownershipMap: z
      .object({
        functions: transportOwnershipFunctionsSchema,
      })
      .strict(),
    roleMetadata: semanticReconstructionSchema.shape.roleMetadata,
    evidence: z.array(transportEvidenceRecordDraftSchema),
    contradictions: z.array(transportContradictionDraftSchema),
  })
  .strict();

export type SemanticReconstructionTransport = z.infer<
  typeof semanticReconstructionTransportSchema
>;
export type SemanticReconstructionEvidenceSource = z.infer<
  typeof semanticReconstructionEvidenceSourceSchema
>;
export type SemanticReconstruction = z.infer<
  typeof semanticReconstructionSchema
>;

// Whitespace- and case-insensitive identity of a quoted source span.
export function normalizeSourceSpan(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function semanticReconstructionFromTransport(
  input: unknown,
  evidenceSourceInput: unknown,
): SemanticReconstruction {
  const transport = semanticReconstructionTransportSchema.parse(input);
  const evidenceSource = parseSemanticDomainResult({
    schema: semanticReconstructionEvidenceSourceSchema,
    value: evidenceSourceInput,
    code: "JD_RECONSTRUCTION_SOURCE_INVALID",
    message: "JD Reconstruction evidence source could not be restored",
  });
  const evidenceReferenceIds = transport.evidence.map(
    (evidence) => evidence.referenceId,
  );
  if (new Set(evidenceReferenceIds).size !== evidenceReferenceIds.length) {
    semanticContractViolation(
      "JD_RECONSTRUCTION_IDENTITY_INVALID",
      "JD Reconstruction contains a repeated evidence identity",
    );
  }
  const evidenceByReference = new Map(
    transport.evidence.map((evidence) => [evidence.referenceId, evidence]),
  );
  const normalizedSourceContent = normalizeSourceSpan(
    evidenceSource.sourceContent,
  );
  for (const assessment of transport.responsibilityMap.areas) {
    if (assessment.prominence !== "ABSENT") continue;
    // The grammar requires absenceBasis EXPLICIT_EXCLUSION. Acceptance then
    // depends on typed evidence and verbatim source grounding, not on whether
    // the quoted source happens to use particular exclusion vocabulary.
    const validAbsenceEvidence = assessment.evidenceReferences.every(
      (reference) => {
        const evidenceRecord = evidenceByReference.get(reference);
        if (
          !evidenceRecord ||
          evidenceRecord.evidenceType !== "responsibilityAbsence" ||
          evidenceRecord.origin !== "EXPLICIT" ||
          evidenceRecord.evidenceLevel !== "CONFIRMED" ||
          evidenceRecord.sourceText === null
        ) {
          return false;
        }
        return normalizedSourceContent.includes(
          normalizeSourceSpan(evidenceRecord.sourceText),
        );
      },
    );
    if (!validAbsenceEvidence) {
      semanticContractViolation(
        "JD_RECONSTRUCTION_ABSENCE_INVALID",
        "JD Reconstruction requires explicit source-grounded evidence for an absent responsibility",
      );
    }
  }
  // Each source statement cites one evidence record quoting it verbatim.
  // Only requirement evidence is grounded here; responsibility evidence may
  // paraphrase, except for an explicit absence (checked above).
  const statementQuotes = transport.requirementStatements.map(
    (statement, statementIndex) => {
      const evidenceRecord = evidenceByReference.get(statement.evidenceReference);
      if (
        !evidenceRecord ||
        evidenceRecord.sourceText === null ||
        !normalizedSourceContent.includes(
          normalizeSourceSpan(evidenceRecord.sourceText),
        )
      ) {
        semanticContractViolation(
          "JD_RECONSTRUCTION_REQUIREMENT_GROUNDING_INVALID",
          `JD Reconstruction requirement statement ${statementIndex} is not quoted verbatim from the job description`,
        );
      }
      return normalizeSourceSpan(evidenceRecord.sourceText);
    },
  );
  if (
    new Set(statementQuotes).size !== statementQuotes.length ||
    new Set(
      transport.requirementStatements.map(
        (statement) => statement.evidenceReference,
      ),
    ).size !== statementQuotes.length
  ) {
    semanticContractViolation(
      "JD_RECONSTRUCTION_STATEMENT_IDENTITY_INVALID",
      "JD Reconstruction contains a repeated requirement statement",
    );
  }
  for (const [statementIndex, statement] of transport.requirementStatements.entries()) {
    const qualificationTexts = statement.qualifications.map((qualification) =>
      normalizeSourceSpan(qualification.requirement),
    );
    if (new Set(qualificationTexts).size !== qualificationTexts.length) {
      semanticContractViolation(
        "JD_RECONSTRUCTION_REQUIREMENT_IDENTITY_INVALID",
        `JD Reconstruction statement ${statementIndex} repeats a qualification`,
      );
    }
  }
  const normalizedRequirements = transport.requirementStatements.flatMap(
    (statement) =>
      statement.qualifications.map((qualification) =>
        normalizeSourceSpan(qualification.requirement),
      ),
  );
  if (new Set(normalizedRequirements).size !== normalizedRequirements.length) {
    semanticContractViolation(
      "JD_RECONSTRUCTION_REQUIREMENT_IDENTITY_INVALID",
      "JD Reconstruction contains a repeated requirement identity",
    );
  }
  // Flatten statements into the Requirement Map. Ambiguity is derived from
  // strength; the provider authors only a display explanation.
  const requirements = transport.requirementStatements.flatMap(
    (
      {
        evidenceReference,
        statementStrengths,
        statementExperienceLevels,
        qualifications,
      },
      statementIndex,
    ) =>
      qualifications.map(
        ({
          assessmentUnit: _assessmentUnit,
          compoundExplanation: _compoundExplanation,
          strengthAssessment,
          ...qualification
        }) => ({
          requiresStartupExperience: false,
          ...qualification,
          strength: strengthAssessment.strength,
          evidenceReferences: [evidenceReference],
          ambiguity: {
            isAmbiguous: strengthAssessment.strength === "AMBIGUOUS",
            explanation:
              "ambiguityExplanation" in strengthAssessment
                ? strengthAssessment.ambiguityExplanation
                : null,
          },
          sourceStatement: {
            statementIndex,
            statementStrengths,
            statementExperienceLevels,
          },
        }),
      ),
  );
  const statementViolations = requirementStatementViolations(requirements);
  if (statementViolations.length > 0) {
    semanticContractViolation(
      "JD_RECONSTRUCTION_STATEMENT_INVALID",
      `JD Reconstruction requirement statements are inconsistent: ${statementViolations[0]!}`,
    );
  }
  const evidence = transport.evidence.map(
    ({ sourceIndex, ...semanticEvidence }) => {
      if (sourceIndex !== evidenceSource.sourceIndex) {
        semanticContractViolation(
          "JD_RECONSTRUCTION_SOURCE_INVALID",
          "JD Reconstruction evidence references an unavailable source",
        );
      }
      return {
        ...semanticEvidence,
        criterionId: jdReconstructionCriterionId,
        sourceType: evidenceSource.sourceType,
        sourceRecordId: evidenceSource.sourceRecordId,
        provenanceId: evidenceSource.provenanceId,
        sourceReference: evidenceSource.sourceReference,
        collectedAt: evidenceSource.collectedAt,
      };
    },
  );
  const uniqueAreas = new Set(
    transport.responsibilityMap.areas.map((entry) => entry.area),
  );
  if (uniqueAreas.size !== responsibilityAreas.length) {
    semanticContractViolation(
      "JD_RECONSTRUCTION_IDENTITY_INVALID",
      "JD Reconstruction must contain every responsibility area exactly once",
    );
  }
  const uniqueFunctions = new Set(
    transport.ownershipMap.functions.map((entry) => entry.function),
  );
  if (uniqueFunctions.size !== transport.ownershipMap.functions.length) {
    semanticContractViolation(
      "JD_RECONSTRUCTION_IDENTITY_INVALID",
      "JD Reconstruction contains a repeated ownership function",
    );
  }
  const areas = Object.fromEntries(
    transport.responsibilityMap.areas.map(
      ({ area, ...assessment }) => [
        area,
        assessment.prominence === "ABSENT"
          ? {
              prominence: assessment.prominence,
              ownership: assessment.ownership,
              evidenceReferences: assessment.evidenceReferences,
            }
          : assessment,
      ],
    ),
  );
  const functions = Object.fromEntries(
    transport.ownershipMap.functions.map(
      ({ function: functionName, ...assessment }) => [functionName, assessment],
    ),
  );

  const result = parseSemanticDomainResult({
    schema: semanticReconstructionSchema,
    value: {
      ...(({ requirementStatements: _statements, ...rest }) => rest)(transport),
      responsibilityMap: {
        areas,
        other: transport.responsibilityMap.other,
      },
      ownershipMap: { functions },
      requirements,
      evidence,
    },
    code: "JD_RECONSTRUCTION_DOMAIN_INVALID",
    message: "JD Reconstruction violated the domain contract",
  });
  assertSemanticEvidenceReferences({
    references: [
      ...result.roleMetadata.evidenceReferences,
      ...Object.values(result.responsibilityMap.areas).flatMap(
        (assessment) => assessment.evidenceReferences,
      ),
      ...result.responsibilityMap.other.flatMap(
        (assessment) => assessment.evidenceReferences,
      ),
      ...result.requirements.flatMap(
        (requirement) => requirement.evidenceReferences,
      ),
      ...Object.values(result.ownershipMap.functions).flatMap(
        (assessment) => assessment.evidenceReferences,
      ),
      ...result.contradictions.flatMap((contradiction) => [
        ...contradiction.evidenceReferencesA,
        ...contradiction.evidenceReferencesB,
      ]),
    ],
    availableEvidence: result.evidence,
    code: "JD_RECONSTRUCTION_EVIDENCE_INVALID",
    message: "JD Reconstruction references unavailable evidence",
  });
  return result;
}

export const customerSuccessJdReconstructionSchema = semanticReconstructionSchema
  .extend({
    location: locationFactsSchema,
    salary: salaryFactsSchema,
    travel: travelFactsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const known = new Set(value.evidence.map((item) => item.referenceId));
    const references: string[] = [
      ...value.roleMetadata.evidenceReferences,
      ...value.location.evidenceReferences,
      ...value.salary.evidenceReferences,
      ...value.travel.evidenceReferences,
      ...Object.values(value.responsibilityMap.areas).flatMap(
        (item) => item.evidenceReferences,
      ),
      ...value.responsibilityMap.other.flatMap(
        (item) => item.evidenceReferences,
      ),
      ...value.requirements.flatMap((item) => item.evidenceReferences),
      ...Object.values(value.ownershipMap.functions).flatMap(
        (item) => item.evidenceReferences,
      ),
      ...value.contradictions.flatMap((item) => [
        ...item.evidenceReferencesA,
        ...item.evidenceReferencesB,
      ]),
    ];
    for (const reference of references) {
      if (!known.has(reference)) {
        context.addIssue({
          code: "custom",
          path: ["evidence"],
          message: `Unknown evidence reference: ${reference}`,
        });
      }
    }
  });

export type CustomerSuccessJdReconstruction = z.infer<
  typeof customerSuccessJdReconstructionSchema
>;
