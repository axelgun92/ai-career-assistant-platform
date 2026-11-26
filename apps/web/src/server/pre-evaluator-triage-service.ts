import { createHash } from "node:crypto";
import {
  effectivePreEvaluatorTriageOutcome,
  type PreEvaluatorTriageManualDecision,
  type PreEvaluatorTriageReason,
} from "@ai-career/core";
import {
  customerSuccessTriageRulesVersion,
  loadCustomerSuccessPreferencesFromProfile,
  triageCustomerSuccessOpportunity,
} from "@ai-career/customer-success";
import { readPositionEvidence } from "@ai-career/normalization";
import {
  PrismaPreEvaluatorTriageRepository,
  type PreEvaluatorTriageRecord,
} from "@ai-career/database";

export interface PreEvaluatorTriageView {
  id: string;
  opportunityId: string;
  outcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT";
  automaticOutcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT";
  reasons: PreEvaluatorTriageReason[];
  manualDecision: PreEvaluatorTriageManualDecision | null;
  manuallyDecidedAt: Date | null;
  userProfileId: string | null;
  userProfileVersion: number | null;
  assessedAt: Date;
}

// What prompted an assessment (kept in the triage history).
export type TriageTrigger = "INITIAL" | "CAPTURE_CHANGED" | "PROFILE_CHANGED" | "USER_CORRECTION" | "RULES_CHANGED" | "INPUT_CHANGED";

export interface EvaluationTriageGate {
  assess(input: {
    opportunityId: string;
    domain: string;
    profile: { id: string; version: number };
    trigger?: TriageTrigger;
  }): Promise<PreEvaluatorTriageView>;
  // Whether the stored assessment no longer matches the current inputs
  // (facts, confirmed facts, profile, eligibility or rules), with the most
  // likely cause; null when there is no stored assessment.
  staleness?(input: { opportunityId: string; domain: string; profile: { id: string; version: number } }): Promise<TriageTrigger | "CURRENT" | null>;
  get(opportunityId: string): Promise<PreEvaluatorTriageView | null>;
  decide(input: {
    opportunityId: string;
    decision: PreEvaluatorTriageManualDecision;
  }): Promise<PreEvaluatorTriageView | null>;
}

function viewOf(record: PreEvaluatorTriageRecord): PreEvaluatorTriageView {
  return {
    id: record.id,
    opportunityId: record.opportunityId,
    outcome: effectivePreEvaluatorTriageOutcome(record),
    automaticOutcome: record.outcome,
    reasons: record.reasons,
    manualDecision: record.manualDecision,
    manuallyDecidedAt: record.manuallyDecidedAt,
    userProfileId: record.userProfileId,
    userProfileVersion: record.userProfileVersion,
    assessedAt: record.assessedAt,
  };
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createPreEvaluatorTriageService(dependencies: {
  repository: PrismaPreEvaluatorTriageRepository;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());
  // The assessment and its input fingerprint, from the stored facts with
  // the user's confirmed facts applied.
  async function prepare(input: { opportunityId: string; domain: string; profile: { id: string; version: number } }) {
    const loaded = await dependencies.repository.loadAssessmentInput(input.opportunityId, input.profile.id);
    if (!loaded || loaded.domain !== input.domain || input.domain !== "customer-success") {
      throw new Error("Pre-evaluator triage input is unavailable");
    }
    const preferences = loadCustomerSuccessPreferencesFromProfile(loaded.profile.domainPreferences);
    // The explicit position evidence in the listing's own title and stored
    // description (people-management duties, a full-time schedule); a
    // full-time schedule the user confirmed counts as stated.
    const evidence = readPositionEvidence({ title: loaded.opportunity.title, description: loaded.text });
    const opportunity = {
      ...loaded.opportunity,
      evidence: loaded.opportunity.fullTimeScheduleConfirmed
        ? { ...evidence, fullTimeSchedule: { sourceText: "Full-time schedule confirmed by you" } }
        : evidence,
    };
    const assessment = triageCustomerSuccessOpportunity({ opportunity, preferences, eligibility: loaded.eligibility });
    const inputFingerprint = fingerprint({
      rules: customerSuccessTriageRulesVersion,
      opportunity,
      preferences: { salary: preferences.salary, location: preferences.location, workArrangement: preferences.workArrangement },
      eligibility: loaded.eligibility,
      profile: input.profile,
    });
    return { assessment, inputFingerprint };
  }

  const gate: EvaluationTriageGate = {
    async assess(input) {
      const prepared = await prepare(input);
      const previous = await dependencies.repository.get(input.opportunityId);
      return viewOf(
        await dependencies.repository.saveAssessment({
          opportunityId: input.opportunityId,
          domain: input.domain,
          userProfileId: input.profile.id,
          userProfileVersion: input.profile.version,
          assessment: prepared.assessment,
          inputFingerprint: prepared.inputFingerprint,
          assessedAt: now(),
          trigger: input.trigger ?? (previous ? "INPUT_CHANGED" : "INITIAL"),
        }),
      );
    },
    async staleness(input) {
      const stored = await dependencies.repository.get(input.opportunityId);
      if (!stored) return null;
      const prepared = await prepare(input);
      if (stored.inputFingerprint === prepared.inputFingerprint) return "CURRENT";
      return stored.userProfileId !== input.profile.id || stored.userProfileVersion !== input.profile.version ? "PROFILE_CHANGED" : "INPUT_CHANGED";
    },
    async get(opportunityId) {
      const record = await dependencies.repository.get(opportunityId);
      return record ? viewOf(record) : null;
    },
    async decide(input) {
      const record = await dependencies.repository.decide({
        ...input,
        decidedAt: now(),
      });
      return record ? viewOf(record) : null;
    },
  };
  return {
    gate,
    async listNeedsReview() {
      return (await dependencies.repository.listNeedsReview()).map((record) => ({
        ...viewOf(record),
        opportunityTitle: record.opportunityTitle,
        opportunityStatus: record.opportunityStatus,
        companyName: record.companyName,
      }));
    },
  };
}

let service: ReturnType<typeof createPreEvaluatorTriageService> | undefined;

export function getPreEvaluatorTriageService() {
  service ??= createPreEvaluatorTriageService({
    repository: new PrismaPreEvaluatorTriageRepository(),
  });
  return service;
}
