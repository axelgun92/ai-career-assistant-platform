import {
  budgetDecision,
  budgetPeriod,
  budgetSettingsSchema,
  roundMoney,
} from "@ai-career/core";
import {
  PrismaBudgetRepository,
  PrismaDeferredEvaluationRepository,
  PrismaEvaluationAdmissionRepository,
  type DeferredEvaluationRecord,
  type StoredBudgetSettings,
} from "@ai-career/database";
import { semanticExecutorConfigFromEnvironment } from "./semantic-execution-config";

// Product-level budget accounting and the admission gate that decides,
// before any paid evaluation starts, whether it may run now or must be
// deferred. Spend comes only from persisted attempt costs.

export interface BudgetSnapshot {
  period: string;
  periodStart: string;
  periodEnd: string;
  timeZone: string;
  amount: number;
  currency: string;
  enforced: boolean;
  knownSpent: number;
  held: number;
  available: number;
  reserve: number;
  unknownAttempts: number;
  otherCurrencyAttempts: number;
  checkedAt: string;
}

export type AdmitResult =
  | { outcome: "ADMITTED"; admissionId: string; budget: BudgetSnapshot | null }
  | { outcome: "ACTIVE" }
  | { outcome: "DEFERRAL_EXISTS"; deferralId: string }
  | { outcome: "DEFERRAL_NOT_OPEN" }
  | { outcome: "DEFERRED" | "STILL_DEFERRED"; deferral: DeferredEvaluationRecord; budget: BudgetSnapshot };

export interface EvaluationAdmissionGate {
  admit(input: {
    opportunityId: string;
    domain: string;
    profile: { id: string; version: number };
    resumeDeferralId?: string;
  }): Promise<AdmitResult>;
  // Releases an admission whose enqueue failed. A resume tied to it goes
  // back to the backlog.
  abandon(admissionId: string): Promise<void>;
  findOpenDeferral(opportunityId: string): Promise<DeferredEvaluationRecord | null>;
  getDeferral(id: string): Promise<DeferredEvaluationRecord | null>;
  cancelDeferral(id: string): Promise<boolean>;
  reservationForEvaluation(evaluationId: string): Promise<{ amount: number; currency: string } | null>;
}

export interface BudgetServiceDependencies {
  admissions?: PrismaEvaluationAdmissionRepository;
  budgets?: PrismaBudgetRepository;
  deferrals?: PrismaDeferredEvaluationRepository;
  now?: () => Date;
  // Currencies of the configured AI pricing; the budget must use one of
  // them so spend is never combined across currencies.
  pricingCurrencies?: () => readonly string[] | null;
}

function snapshot(
  settings: StoredBudgetSettings,
  period: ReturnType<typeof budgetPeriod>,
  ledger: { knownSpent: number; held: number; unknownAttempts: number; otherCurrencyAttempts: number },
  available: number,
  now: Date,
): BudgetSnapshot {
  return {
    period: period.label,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    timeZone: period.timeZone,
    amount: settings.amount,
    currency: settings.currency,
    enforced: settings.enforced,
    knownSpent: ledger.knownSpent,
    held: ledger.held,
    available,
    reserve: settings.reservePerEvaluation,
    unknownAttempts: ledger.unknownAttempts,
    otherCurrencyAttempts: ledger.otherCurrencyAttempts,
    checkedAt: now.toISOString(),
  };
}

export class BudgetServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = "BudgetServiceError";
  }
}

export function createBudgetService(dependencies: BudgetServiceDependencies = {}) {
  const admissions = dependencies.admissions ?? new PrismaEvaluationAdmissionRepository();
  const budgets = dependencies.budgets ?? new PrismaBudgetRepository();
  const deferrals = dependencies.deferrals ?? new PrismaDeferredEvaluationRepository();
  const now = dependencies.now ?? (() => new Date());

  // Releases admissions whose enqueue never happened and returns their
  // resumed requests to the backlog. Conditional updates only: a consumed
  // admission is never touched.
  async function recover(at: Date, transaction?: Parameters<typeof admissions.abandonStale>[0]["transaction"]) {
    await admissions.abandonStale({ now: at, transaction });
    await deferrals.reopenAbandonedResumes(transaction);
  }

  const gate: EvaluationAdmissionGate = {
    async admit(input) {
      const at = now();
      return admissions.withAdmissionLock(async (transaction): Promise<AdmitResult> => {
        await recover(at, transaction);
        // Order matters. A live admission becomes consumed in the same commit
        // that creates its Evaluation, so: if this first read still sees it
        // live, the request is blocked; if it no longer does, that commit has
        // happened and the second read is guaranteed to see the evaluation.
        // (Reading the evaluation first could miss both across that commit.)
        if (
          (await admissions.findLiveForOpportunity(transaction, input.opportunityId)) ||
          (await admissions.hasActiveEvaluation(transaction, input.opportunityId))
        ) {
          return { outcome: "ACTIVE" };
        }
        const open = await deferrals.findOpenForOpportunity(input.opportunityId, transaction);
        if (input.resumeDeferralId) {
          if (!open || open.id !== input.resumeDeferralId) return { outcome: "DEFERRAL_NOT_OPEN" };
        } else if (open) {
          return { outcome: "DEFERRAL_EXISTS", deferralId: open.id };
        }

        const admitWith = async (reservation: Parameters<typeof admissions.insert>[1]["reservation"]) => {
          const admission = await admissions.insert(transaction, {
            opportunityId: input.opportunityId,
            now: at,
            reservation,
          });
          if (input.resumeDeferralId) {
            await deferrals.markResuming(transaction, { id: input.resumeDeferralId, admissionId: admission.id, now: at });
          }
          return admission.id;
        };

        const settings = await budgets.getSettings(transaction);
        if (!settings) {
          // No budget configured: unrestricted, with no monetary reservation.
          return { outcome: "ADMITTED", admissionId: await admitWith(undefined), budget: null };
        }

        const period = budgetPeriod(at, settings.timeZone);
        const ledger = await budgets.periodLedger({ period, currency: settings.currency, transaction });
        const decision = budgetDecision({
          amount: settings.amount,
          knownSpent: ledger.knownSpent,
          held: ledger.held,
          reserve: settings.reservePerEvaluation,
          enforced: settings.enforced,
        });
        const budget = snapshot(settings, period, ledger, decision.available, at);

        if (decision.allowed) {
          const admissionId = await admitWith({
            amount: settings.reservePerEvaluation,
            currency: settings.currency,
            enforced: settings.enforced,
          });
          return { outcome: "ADMITTED", admissionId, budget };
        }

        const reasonSnapshot = budget;
        if (input.resumeDeferralId) {
          await deferrals.touchChecked(transaction, { id: input.resumeDeferralId, reasonSnapshot, now: at });
          const deferral = await deferrals.findById(input.resumeDeferralId, transaction);
          return { outcome: "STILL_DEFERRED", deferral: deferral!, budget };
        }
        const deferral = await deferrals.create(transaction, {
          opportunityId: input.opportunityId,
          domain: input.domain,
          userProfileId: input.profile.id,
          userProfileVersion: input.profile.version,
          reasonCode: "BUDGET_UNAVAILABLE",
          reasonSnapshot,
          now: at,
        });
        return { outcome: "DEFERRED", deferral, budget };
      });
    },

    async abandon(admissionId) {
      await admissions.abandon(admissionId, now());
      await deferrals.revertResume(admissionId);
    },

    async findOpenDeferral(opportunityId) {
      await recover(now());
      return deferrals.findOpenForOpportunity(opportunityId);
    },

    async getDeferral(id) {
      await recover(now());
      return deferrals.findById(id);
    },

    cancelDeferral: (id) => deferrals.cancel(id, now()),
    reservationForEvaluation: (evaluationId) => budgets.reservationForEvaluation(evaluationId),
  };

  return {
    gate,

    async status() {
      const at = now();
      await recover(at);
      const [settings, openDeferrals] = await Promise.all([budgets.getSettings(), deferrals.countOpen()]);
      if (!settings) return { configured: false as const, openDeferrals };
      const period = budgetPeriod(at, settings.timeZone);
      const [ledger, recent] = await Promise.all([
        budgets.periodLedger({ period, currency: settings.currency }),
        budgets.recentEvaluationCosts({ currency: settings.currency, limit: 10 }),
      ]);
      const remaining = roundMoney(settings.amount - ledger.knownSpent - ledger.held);
      return {
        configured: true as const,
        openDeferrals,
        settings: {
          amount: settings.amount,
          currency: settings.currency,
          timeZone: settings.timeZone,
          enforced: settings.enforced,
          reservePerEvaluation: settings.reservePerEvaluation,
          periodType: settings.periodType,
        },
        period: {
          label: period.label,
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          timeZone: period.timeZone,
        },
        knownSpent: ledger.knownSpent,
        held: ledger.held,
        heldEvaluations: ledger.holds.length,
        remaining,
        unknownAttempts: ledger.unknownAttempts,
        otherCurrencyAttempts: ledger.otherCurrencyAttempts,
        recentCosts: recent.length
          ? {
              count: recent.length,
              max: Math.max(...recent),
              average: roundMoney(recent.reduce((total, cost) => total + cost, 0) / recent.length),
            }
          : null,
      };
    },

    async updateSettings(body: unknown) {
      const parsed = budgetSettingsSchema.safeParse(body);
      if (!parsed.success) {
        throw new BudgetServiceError(
          "BUDGET_INVALID",
          "The budget settings are invalid",
          400,
          parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        );
      }
      const currencies = dependencies.pricingCurrencies?.() ?? null;
      if (currencies && currencies.length && !currencies.includes(parsed.data.currency)) {
        throw new BudgetServiceError("BUDGET_INVALID", "The budget settings are invalid", 400, [
          {
            path: "currency",
            message: `AI costs are priced in ${currencies.join(", ")}; the budget must use ${currencies.length === 1 ? "that currency" : "one of those currencies"}`,
          },
        ]);
      }
      // Changing or disabling the budget never rewrites usage or cost records.
      await budgets.saveSettings(parsed.data);
      return this.status();
    },

    async removeBudget() {
      await budgets.deleteSettings();
      return this.status();
    },

    listDeferred: async (status?: "DEFERRED" | "RESUMED" | "CANCELLED") => {
      await recover(now());
      return deferrals.list({ status });
    },
  };
}

export type BudgetService = ReturnType<typeof createBudgetService>;

let budgetService: BudgetService | undefined;

export function getBudgetService(): BudgetService {
  budgetService ??= createBudgetService({
    pricingCurrencies: () => {
      try {
        const config = semanticExecutorConfigFromEnvironment();
        return [...new Set([config.pricing, ...(config.pricingConfigurations ?? [])].map((item) => item.currency))];
      } catch {
        return null;
      }
    },
  });
  return budgetService;
}

function errorResponse(error: unknown) {
  if (error instanceof BudgetServiceError) {
    return Response.json(
      { error: error.message, code: error.code, ...(error.issues.length ? { issues: error.issues } : {}) },
      { status: error.status },
    );
  }
  console.error("Budget request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return Response.json({ error: "The budget request could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
}

export function createBudgetApiHandlers(service: BudgetService) {
  return {
    async get() {
      try {
        return Response.json(await service.status());
      } catch (error) {
        return errorResponse(error);
      }
    },
    async put(request: Request) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 });
      }
      try {
        return Response.json(await service.updateSettings(body));
      } catch (error) {
        return errorResponse(error);
      }
    },
    async delete() {
      try {
        return Response.json(await service.removeBudget());
      } catch (error) {
        return errorResponse(error);
      }
    },
    async listDeferred(request: Request) {
      const status = new URL(request.url).searchParams.get("status");
      if (status !== null && !["DEFERRED", "RESUMED", "CANCELLED"].includes(status)) {
        return Response.json({ error: "Unknown deferred status", code: "REQUEST_INVALID" }, { status: 400 });
      }
      try {
        return Response.json({
          deferred: await service.listDeferred((status ?? undefined) as "DEFERRED" | "RESUMED" | "CANCELLED" | undefined),
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
