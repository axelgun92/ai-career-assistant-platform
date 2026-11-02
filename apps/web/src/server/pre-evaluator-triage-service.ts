import { createHash } from "node:crypto";
import {
  effectivePreEvaluatorTriageOutcome,
  type PreEvaluatorTriageManualDecision,
  type PreEvaluatorTriageReason,
} from "@ai-career/core";
import {
  loadCustomerSuccessPreferencesFromProfile,
  triageCustomerSuccessOpportunity,
} from "@ai-career/customer-success";
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

export interface EvaluationTriageGate {
  assess(input: {
    opportunityId: string;
    domain: string;
    profile: { id: string; version: number };
  }): Promise<PreEvaluatorTriageView>;
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
  const gate: EvaluationTriageGate = {
    async assess(input) {
      const loaded = await dependencies.repository.loadAssessmentInput(
        input.opportunityId,
        input.profile.id,
      );
      if (!loaded || loaded.domain !== input.domain || input.domain !== "customer-success") {
        throw new Error("Pre-evaluator triage input is unavailable");
      }
      const preferences = loadCustomerSuccessPreferencesFromProfile(
        loaded.profile.domainPreferences,
      );
      const assessment = triageCustomerSuccessOpportunity({
        opportunity: loaded.opportunity,
        preferences,
        eligibility: loaded.eligibility,
      });
      return viewOf(
        await dependencies.repository.saveAssessment({
          opportunityId: input.opportunityId,
          domain: input.domain,
          userProfileId: input.profile.id,
          userProfileVersion: input.profile.version,
          assessment,
          inputFingerprint: fingerprint({
            opportunity: loaded.opportunity,
            preferences: {
              salary: preferences.salary,
              location: preferences.location,
              workArrangement: preferences.workArrangement,
            },
            eligibility: loaded.eligibility,
            profile: input.profile,
          }),
          assessedAt: now(),
        }),
      );
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
