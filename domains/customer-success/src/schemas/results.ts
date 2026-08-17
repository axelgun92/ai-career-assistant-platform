import { contradictionDraftSchema } from "@ai-career/evidence";
import { z } from "zod";
import {
  customerSuccessJdReconstructionSchema,
  roleClassificationSchema,
} from "./maps";
import { companyAlignmentDataSchema } from "./company-alignment";
import { organizationalMaturityDataSchema } from "./organizational-maturity";
import { alexFitDataSchema } from "./alex-fit";
import { burnoutRiskDataSchema } from "./burnout-risk";
import { resumeMatchDataSchema } from "./resume-match";
import { opportunityPriorityDataSchema } from "./opportunity-priority";
import { ghostJobRiskDataSchema } from "./ghost-job-risk";
import { customerSuccessRecommendationSchema } from "./recommendation";
import {
  companyAlignmentUnknownSchema,
  supportedAlignmentFindingSchema,
} from "./company-alignment";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.nullable();

export const hardFilterResultSchema = z.enum([
  "PASS",
  "REVIEW",
  "FAIL",
  "UNKNOWN",
]);

const criterionResultSchema = z
  .object({
    result: hardFilterResultSchema,
    explanation: requiredText,
    evidenceReferences: z.array(requiredText),
  })
  .strict();

export const hardFiltersDataSchema = z
  .object({
    overall: z.enum(["PASS", "REVIEW", "FAIL"]),
    role: criterionResultSchema.extend({
      classification: roleClassificationSchema,
    }),
    salary: criterionResultSchema,
    location: criterionResultSchema,
    workArrangement: criterionResultSchema,
    travel: criterionResultSchema,
    reconstruction: customerSuccessJdReconstructionSchema,
  })
  .strict();

export const strategicBridgeValueSchema = z.enum([
  "HIGH",
  "MODERATE",
  "LOW",
  "UNKNOWN",
]);

const jobDimensionSchema = z
  .object({
    conclusion: optionalText,
    evidenceReferences: z.array(requiredText),
    unknown: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.unknown && value.evidenceReferences.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Known job-evaluation conclusions require evidence",
      });
    }
  });

export const semanticJobEvaluationSchema = z
  .object({
    practicalSummary: requiredText,
    primaryWork: z.array(requiredText),
    customerLifecycleInvolvement: jobDimensionSchema,
    customerOwnership: jobDimensionSchema,
    strategicResponsibility: jobDimensionSchema,
    technicalExposure: jobDimensionSchema,
    commercialResponsibility: jobDimensionSchema,
    crossFunctionalInvolvement: jobDimensionSchema,
    businessImpact: jobDimensionSchema,
    strategicBridgeValue: z
      .object({
        classification: strategicBridgeValueSchema,
        explanation: requiredText,
        evidenceReferences: z.array(requiredText),
      })
      .strict(),
    evidenceReferences: z.array(requiredText).min(1),
    strengths: z.array(requiredText),
    concerns: z.array(requiredText),
    unknowns: z.array(
      z
        .object({
          code: requiredText.regex(/^[a-z][a-z0-9-]*$/),
          description: requiredText,
          materiality: optionalText,
        })
        .strict(),
    ),
    contradictions: z.array(contradictionDraftSchema),
  })
  .strict();

export const jobEvaluationDataSchema = z.discriminatedUnion("evaluated", [
  z
    .object({
      evaluated: z.literal(false),
      reason: requiredText,
    })
    .strict(),
  z
    .object({
      evaluated: z.literal(true),
      roleClassification: roleClassificationSchema,
      evaluation: semanticJobEvaluationSchema,
    })
    .strict(),
]);

export const customerSuccessMilestoneFourResultSchema = z
  .object({
    hardFilters: hardFiltersDataSchema,
    jobEvaluation: jobEvaluationDataSchema,
  })
  .strict();

export const customerSuccessMilestoneFiveResultSchema =
  customerSuccessMilestoneFourResultSchema
    .extend({
      companyAlignment: companyAlignmentDataSchema,
      organizationalMaturity: organizationalMaturityDataSchema,
    })
    .strict();

export const customerSuccessMilestoneSixResultSchema =
  customerSuccessMilestoneFiveResultSchema
    .extend({
      alexFit: alexFitDataSchema,
      burnoutRisk: burnoutRiskDataSchema,
    })
    .strict();

export const customerSuccessMilestoneSevenResultSchema =
  customerSuccessMilestoneSixResultSchema
    .extend({
      resumeMatch: resumeMatchDataSchema,
    })
    .strict();

export const customerSuccessMilestoneEightResultSchema =
  customerSuccessMilestoneSevenResultSchema
    .extend({
      opportunityPriority: opportunityPriorityDataSchema,
      ghostJobRisk: ghostJobRiskDataSchema,
      recommendation: customerSuccessRecommendationSchema,
      strengths: z.array(supportedAlignmentFindingSchema),
      concerns: z.array(supportedAlignmentFindingSchema),
      unknowns: z.array(companyAlignmentUnknownSchema),
      contradictions: z.array(contradictionDraftSchema),
      evidenceReferences: z.array(requiredText).min(1),
    })
    .strict();

export type HardFiltersData = z.infer<typeof hardFiltersDataSchema>;
export type SemanticJobEvaluation = z.infer<
  typeof semanticJobEvaluationSchema
>;
export type JobEvaluationData = z.infer<typeof jobEvaluationDataSchema>;
export type CustomerSuccessMilestoneFourResult = z.infer<
  typeof customerSuccessMilestoneFourResultSchema
>;
export type CustomerSuccessMilestoneFiveResult = z.infer<
  typeof customerSuccessMilestoneFiveResultSchema
>;
export type CustomerSuccessMilestoneSixResult = z.infer<
  typeof customerSuccessMilestoneSixResultSchema
>;
export type CustomerSuccessMilestoneSevenResult = z.infer<
  typeof customerSuccessMilestoneSevenResultSchema
>;
export type CustomerSuccessMilestoneEightResult = z.infer<
  typeof customerSuccessMilestoneEightResultSchema
>;
