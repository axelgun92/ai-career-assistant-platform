import { z } from "zod";

// A deterministic admission decision made before any evaluator task, budget
// reservation, or provider call exists. This is deliberately separate from
// the evaluator's Apply / Review / Skip recommendation.
export const preEvaluatorTriageOutcomeSchema = z.enum([
  "EVALUATE",
  "NEEDS_REVIEW",
  "REJECT",
]);

export const preEvaluatorTriageManualDecisionSchema = z.enum([
  "EVALUATE",
  "REJECT",
]);

export const preEvaluatorTriageReasonSchema = z.object({
  code: z.string().trim().min(1),
  fields: z.array(z.string().trim().min(1)).min(1),
  disposition: z.enum(["NEEDS_REVIEW", "REJECT"]),
  message: z.string().trim().min(1),
});

export const preEvaluatorTriageAssessmentSchema = z.object({
  outcome: preEvaluatorTriageOutcomeSchema,
  reasons: z.array(preEvaluatorTriageReasonSchema),
});

export type PreEvaluatorTriageOutcome = z.infer<typeof preEvaluatorTriageOutcomeSchema>;
export type PreEvaluatorTriageManualDecision = z.infer<typeof preEvaluatorTriageManualDecisionSchema>;
export type PreEvaluatorTriageReason = z.infer<typeof preEvaluatorTriageReasonSchema>;
export type PreEvaluatorTriageAssessment = z.infer<typeof preEvaluatorTriageAssessmentSchema>;

export function effectivePreEvaluatorTriageOutcome(input: {
  outcome: PreEvaluatorTriageOutcome;
  manualDecision: PreEvaluatorTriageManualDecision | null;
}): PreEvaluatorTriageOutcome {
  return input.manualDecision ?? input.outcome;
}
