import {
  aiBudgetLimitReason,
  usageLimitReachedReason,
  batchCapacity,
  budgetDecision,
  budgetPeriod,
  budgetSettingsSchema,
  capacityEstimate,
  outputTokenPotential,
  roundMoney,
  throughputLimitsReached,
  volumeWindows,
  warningState,
  worstCaseOutputTokens,
  type BatchLimitShortfall,
  type BudgetPeriod,
  type UsageLimit,
} from "@ai-career/core";
import {
  PrismaBudgetRepository,
  PrismaDeferredEvaluationRepository,
  PrismaEvaluationAdmissionRepository,
  type AdmissionTransaction,
  type DeferredEvaluationRecord,
  type StoredBudgetSettings,
} from "@ai-career/database";
import { customerSuccessSemanticOperationIds } from "@ai-career/customer-success";
import { semanticExecutorConfigFromEnvironment } from "./semantic-execution-config";

// Domains the evaluation worker can execute.
export const executableEvaluationDomains = ["customer-success"] as const;

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
  // Throughput limits and their usage when checked; absent on snapshots
  // recorded before these limits existed.
  limits?: LimitSnapshot;
}

export interface LimitSnapshot {
  enforced: boolean;
  // What prevented the evaluation from starting (empty when admitted).
  reached: UsageLimit[];
  daily: { limit: number | null; used: number; window: string; resetsAt: string };
  weekly: { limit: number | null; used: number; window: string; resetsAt: string };
  outputTokens: { limit: number | null; used: number; unreportedAttempts: number };
}

// Deferral reason codes: the monthly AI dollar budget (AI_BUDGET_LIMIT), or
// a non-dollar usage limit only (USAGE_LIMIT_REACHED).
export const budgetDeferralReason = aiBudgetLimitReason;
export const usageLimitDeferralReason = usageLimitReachedReason;

export type AdmitResult =
  | {
      outcome: "ADMITTED";
      admissionId: string;
      budget: BudgetSnapshot | null;
      // The user's per-evaluation paid-call allowance, if configured.
      evaluationCallLimit: number | null;
    }
  | { outcome: "ACTIVE" }
  | { outcome: "DEFERRAL_EXISTS"; deferralId: string }
  | { outcome: "DEFERRAL_NOT_OPEN" }
  | { outcome: "DEFERRED" | "STILL_DEFERRED"; deferral: DeferredEvaluationRecord; budget: BudgetSnapshot };

// Bulk admission (November 26, 2026): why a selected job cannot be admitted
// with the batch right now. Never a judgement on the job.
export type BatchIneligibleReason =
  | "NOT_FOUND"
  | "NOT_EVALUABLE"
  | "NOT_NORMALIZED"
  | "SOURCE_CONTENT_MISSING"
  | "DOMAIN_UNSUPPORTED"
  | "PROFILE_UNUSABLE"
  | "TRIAGE_NEEDS_REVIEW"
  | "TRIAGE_REJECTED"
  | "ALREADY_ACTIVE"
  | "ALREADY_EVALUATED"
  | "DEFERRED"
  | "DUPLICATE_OF_EVALUATED"
  | "SAME_LISTING_SELECTED";

export interface BatchExecutionBasis {
  // The deployment's per-evaluation call budget and per-call output maxima
  // (the default and every operation route), for the output-token worst case.
  callBudget: number;
  maxOutputTokens: number;
  operationMaximums: readonly number[];
}

export type AdmitBatchResult =
  | { outcome: "READY"; count: number; reservation: { perEvaluation: number; total: number; currency: string } | null }
  | { outcome: "QUEUED"; queued: Array<{ opportunityId: string; evaluationId: string; taskId: string }> }
  | { outcome: "INELIGIBLE"; items: Array<{ opportunityId: string; reason: BatchIneligibleReason }> }
  | { outcome: "LIMITS_EXCEEDED"; shortfalls: BatchLimitShortfall[] };

export interface AdmitBatchInput {
  opportunityIds: readonly string[];
  mode: "PREFLIGHT" | "SUBMIT";
  execution: BatchExecutionBasis;
  // Further checks under the locks, on the same transaction (duplicate
  // spend): the selected jobs that may not be admitted, with why.
  check(transaction: AdmissionTransaction, opportunityIds: readonly string[]): Promise<Array<{ opportunityId: string; reason: BatchIneligibleReason }>>;
  // Creates the evaluation and task for one admitted job and consumes its
  // admission, on the same transaction.
  enqueue(
    transaction: AdmissionTransaction,
    item: { opportunityId: string; admissionId: string; evaluationCallLimit: number | null },
  ): Promise<{ evaluationId: string; id: string }>;
  // Test hook: runs after every check and write, before the commit.
  beforeCommit?: () => Promise<void>;
}

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
  // All-or-nothing admission of several jobs (bulk evaluation). Optional so
  // gates without a database can omit it.
  admitBatch?(input: AdmitBatchInput): Promise<AdmitBatchResult>;
}

// Per-call output maximum and call budget recorded on an evaluation, or the
// given fallbacks when its metadata predates them.
function recordedExecution(metadata: unknown, fallback: BatchExecutionBasis) {
  const record = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const callBudget = typeof record.semanticCallBudget === "number" && record.semanticCallBudget > 0 ? record.semanticCallBudget : fallback.callBudget;
  const maxOutputTokens = typeof record.maxOutputTokens === "number" && record.maxOutputTokens > 0 ? record.maxOutputTokens : fallback.maxOutputTokens;
  const operations = record.semanticOperationExecutionPolicy && typeof record.semanticOperationExecutionPolicy === "object"
    ? Object.values(record.semanticOperationExecutionPolicy as Record<string, unknown>)
    : [];
  const operationMaximums = operations
    .map((operation) => (operation && typeof operation === "object" ? (operation as { maximumOutputTokens?: unknown }).maximumOutputTokens : null))
    .filter((value): value is number => typeof value === "number" && value > 0);
  const perCall = Math.max(maxOutputTokens, ...(operationMaximums.length ? operationMaximums : fallback.operationMaximums));
  return { callBudget, perCall };
}

// The output-token potential committed in a monthly budget window, read
// from persisted rows (see outputTokenPotential: each provider call counted
// once, reported usage replacing its estimate, unused potential released when
// an evaluation completes, fails permanently, is deleted or its admission is
// abandoned). Evaluations queued before a settings change keep the call
// budget and per-call maximum recorded with them.
export async function committedOutputTokenPotential(input: {
  budgets: Pick<PrismaBudgetRepository, "outputTokenCommitments">;
  period: BudgetPeriod;
  execution: BatchExecutionBasis;
  perEvaluation: number;
  transaction?: AdmissionTransaction;
}) {
  const commitments = await input.budgets.outputTokenCommitments({ period: input.period, transaction: input.transaction });
  return outputTokenPotential({
    reportedOutputTokens: commitments.reportedOutputTokens,
    unreportedCalls: commitments.unreportedAttempts.map((attempt) => ({
      maximumOutputTokens: recordedExecution(attempt.executionMetadata, input.execution).perCall,
    })),
    activeEvaluations: commitments.activeEvaluations.map((evaluation) => {
      const recorded = recordedExecution(evaluation.executionMetadata, input.execution);
      return { callBudget: recorded.callBudget, callsMade: evaluation.callsMade, maximumOutputTokens: recorded.perCall };
    }),
    liveAdmissions: commitments.liveAdmissions,
    worstCasePerEvaluation: input.perEvaluation,
  });
}

export interface BudgetServiceDependencies {
  admissions?: PrismaEvaluationAdmissionRepository;
  budgets?: PrismaBudgetRepository;
  deferrals?: PrismaDeferredEvaluationRepository;
  now?: () => Date;
  // Currencies of the configured AI pricing; the budget must use one of
  // them so spend is never combined across currencies.
  pricingCurrencies?: () => readonly string[] | null;
  // Bounds for the per-evaluation paid-call allowance: the deployment
  // maximum and the evaluator's minimum for a normal evaluation. Null when
  // AI evaluation is not configured.
  callLimitBounds?: () => { minimum: number; maximum: number } | null;
  // The active execution basis for estimates (never credentials).
  executionBasis?: () => { policyVersion: string | null; pricingVersions: string[]; currency: string } | null;
  // Domains the worker can evaluate, for eligibility counts.
  executableDomains?: readonly string[];
}

function snapshot(
  settings: StoredBudgetSettings,
  period: ReturnType<typeof budgetPeriod>,
  ledger: { knownSpent: number; held: number; unknownAttempts: number; otherCurrencyAttempts: number },
  available: number,
  now: Date,
  limits?: LimitSnapshot,
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
    ...(limits ? { limits } : {}),
  };
}

function limitSnapshot(
  settings: StoredBudgetSettings,
  windows: ReturnType<typeof volumeWindows>,
  usage: Awaited<ReturnType<PrismaBudgetRepository["throughputUsage"]>>,
  reached: UsageLimit[],
): LimitSnapshot {
  return {
    enforced: settings.enforced,
    reached,
    daily: {
      limit: settings.dailyEvaluationLimit,
      used: usage.dailyEvaluations,
      window: windows.day.label,
      resetsAt: windows.day.end.toISOString(),
    },
    weekly: {
      limit: settings.weeklyEvaluationLimit,
      used: usage.weeklyEvaluations,
      window: windows.week.label,
      resetsAt: windows.week.end.toISOString(),
    },
    outputTokens: {
      limit: settings.monthlyOutputTokenLimit,
      used: usage.outputTokens,
      unreportedAttempts: usage.attemptsWithoutOutputTokens,
    },
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
          return { outcome: "ADMITTED", admissionId: await admitWith(undefined), budget: null, evaluationCallLimit: null };
        }

        // Every configured limit is checked under the same lock, against
        // persisted rows only, so concurrent requests cannot overshoot them
        // and restarts never reset them.
        const period = budgetPeriod(at, settings.timeZone);
        const windows = volumeWindows(at, settings.timeZone);
        const [ledger, usage] = await Promise.all([
          budgets.periodLedger({ period, currency: settings.currency, transaction }),
          budgets.throughputUsage({ day: windows.day, week: windows.week, period, transaction }),
        ]);
        const decision = budgetDecision({
          amount: settings.amount,
          knownSpent: ledger.knownSpent,
          held: ledger.held,
          reserve: settings.reservePerEvaluation,
          enforced: settings.enforced,
        });
        const reached: UsageLimit[] = [
          ...(decision.allowed ? [] : ["BUDGET" as const]),
          ...(settings.enforced ? throughputLimitsReached(settings, usage) : []),
        ];
        const budget = snapshot(
          settings, period, ledger, decision.available, at, limitSnapshot(settings, windows, usage, reached),
        );

        if (reached.length === 0) {
          const admissionId = await admitWith({
            amount: settings.reservePerEvaluation,
            currency: settings.currency,
            enforced: settings.enforced,
          });
          return { outcome: "ADMITTED", admissionId, budget, evaluationCallLimit: settings.evaluationCallLimit };
        }

        // An operational deferral, never a failure or a judgement on the
        // opportunity. The reason names the monetary budget when it is one
        // of the limits reached.
        const reasonCode = reached.includes("BUDGET") ? budgetDeferralReason : usageLimitDeferralReason;
        const reasonSnapshot = budget;
        if (input.resumeDeferralId) {
          await deferrals.touchChecked(transaction, { id: input.resumeDeferralId, reasonSnapshot, reasonCode, now: at });
          const deferral = await deferrals.findById(input.resumeDeferralId, transaction);
          return { outcome: "STILL_DEFERRED", deferral: deferral!, budget };
        }
        const deferral = await deferrals.create(transaction, {
          opportunityId: input.opportunityId,
          domain: input.domain,
          userProfileId: input.profile.id,
          userProfileVersion: input.profile.version,
          reasonCode,
          reasonSnapshot,
          now: at,
        });
        return { outcome: "DEFERRED", deferral, budget };
      });
    },

    // Bulk admission (November 26, 2026). One transaction holds the
    // duplicate-spend lock and then the admission lock (the established
    // order): every final check, the whole-batch capacity check and, for a
    // submit, every admission, reservation, evaluation and task are one
    // commit, or nothing. A preflight runs the same checks and writes
    // nothing (beyond the usual release of stale admissions). Never creates
    // a deferral: a batch that does not fit is refused, with every reason.
    async admitBatch(input) {
      const at = now();
      return admissions.withBatchAdmissionLocks(async (transaction): Promise<AdmitBatchResult> => {
        await recover(at, transaction);
        const ineligible: Array<{ opportunityId: string; reason: BatchIneligibleReason }> = [];
        for (const opportunityId of input.opportunityIds) {
          // The same order as single admission (a live admission is read
          // before the evaluation it becomes).
          if (await admissions.findLiveForOpportunity(transaction, opportunityId)) {
            ineligible.push({ opportunityId, reason: "ALREADY_ACTIVE" });
            continue;
          }
          const latest = await admissions.latestEvaluationStatus(transaction, opportunityId);
          if (latest === "PENDING" || latest === "RUNNING") {
            ineligible.push({ opportunityId, reason: "ALREADY_ACTIVE" });
            continue;
          }
          if (latest === "COMPLETED") {
            ineligible.push({ opportunityId, reason: "ALREADY_EVALUATED" });
            continue;
          }
          if (await deferrals.findOpenForOpportunity(opportunityId, transaction)) {
            ineligible.push({ opportunityId, reason: "DEFERRED" });
          }
        }
        const flagged = new Set(ineligible.map((item) => item.opportunityId));
        for (const item of await input.check(transaction, input.opportunityIds)) {
          if (!flagged.has(item.opportunityId)) {
            flagged.add(item.opportunityId);
            ineligible.push(item);
          }
        }
        if (ineligible.length) return { outcome: "INELIGIBLE", items: ineligible };

        const settings = await budgets.getSettings(transaction);
        const requested = input.opportunityIds.length;
        if (settings?.enforced) {
          const period = budgetPeriod(at, settings.timeZone);
          const windows = volumeWindows(at, settings.timeZone);
          const [ledger, usage] = await Promise.all([
            budgets.periodLedger({ period, currency: settings.currency, transaction }),
            budgets.throughputUsage({ day: windows.day, week: windows.week, period, transaction }),
          ]);
          // The output-token worst case, only when that limit is set.
          const callBudget = Math.min(input.execution.callBudget, settings.evaluationCallLimit ?? input.execution.callBudget);
          const perEvaluation = worstCaseOutputTokens({
            callBudget,
            maxOutputTokens: input.execution.maxOutputTokens,
            operationMaximums: input.execution.operationMaximums,
          });
          const committedOutputTokens = settings.monthlyOutputTokenLimit === null
            ? usage.outputTokens
            : (await committedOutputTokenPotential({ budgets, period, execution: input.execution, perEvaluation, transaction })).total;
          const capacity = batchCapacity({
            requested,
            settings,
            ledger,
            usage,
            committedOutputTokens,
            outputTokensPerEvaluation: perEvaluation,
          });
          if (!capacity.fits) return { outcome: "LIMITS_EXCEEDED", shortfalls: capacity.shortfalls };
        }
        const reservation = settings?.enforced && settings.reservePerEvaluation > 0
          ? {
              perEvaluation: settings.reservePerEvaluation,
              total: roundMoney(settings.reservePerEvaluation * requested),
              currency: settings.currency,
            }
          : null;
        if (input.mode === "PREFLIGHT") return { outcome: "READY", count: requested, reservation };

        const queued: Array<{ opportunityId: string; evaluationId: string; taskId: string }> = [];
        for (const opportunityId of input.opportunityIds) {
          // Exactly what single admission writes: one admission with its
          // reservation (when a budget is configured), then the evaluation
          // and task that consume it.
          const admission = await admissions.insert(transaction, {
            opportunityId,
            now: at,
            reservation: settings
              ? { amount: settings.reservePerEvaluation, currency: settings.currency, enforced: settings.enforced }
              : undefined,
          });
          const task = await input.enqueue(transaction, {
            opportunityId,
            admissionId: admission.id,
            evaluationCallLimit: settings?.evaluationCallLimit ?? null,
          });
          queued.push({ opportunityId, evaluationId: task.evaluationId, taskId: task.id });
        }
        if (input.beforeCommit) await input.beforeCommit();
        return { outcome: "QUEUED", queued };
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
      const windows = volumeWindows(at, settings.timeZone);
      const [ledger, recent, usage] = await Promise.all([
        budgets.periodLedger({ period, currency: settings.currency }),
        budgets.recentEvaluationCosts({ currency: settings.currency, limit: 10 }),
        budgets.throughputUsage({ day: windows.day, week: windows.week, period }),
      ]);
      const remaining = roundMoney(settings.amount - ledger.knownSpent - ledger.held);
      const decision = budgetDecision({
        amount: settings.amount,
        knownSpent: ledger.knownSpent,
        held: ledger.held,
        reserve: settings.reservePerEvaluation,
        enforced: settings.enforced,
      });
      // Limits at or over their value now, whether or not they are enforced
      // (when not enforced they are reported but never defer anything).
      const reached: UsageLimit[] = [
        ...(settings.reservePerEvaluation > 0 && decision.available < settings.reservePerEvaluation ? ["BUDGET" as const] : []),
        ...throughputLimitsReached(settings, usage),
      ];
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
          warningThresholds: settings.warningThresholds,
          dailyEvaluationLimit: settings.dailyEvaluationLimit,
          weeklyEvaluationLimit: settings.weeklyEvaluationLimit,
          monthlyOutputTokenLimit: settings.monthlyOutputTokenLimit,
          evaluationCallLimit: settings.evaluationCallLimit,
          updatedAt: settings.updatedAt.toISOString(),
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
        warning: warningState({
          amount: settings.amount,
          knownSpent: ledger.knownSpent,
          held: ledger.held,
          thresholds: settings.warningThresholds,
        }),
        limits: limitSnapshot(settings, windows, usage, reached),
        recentCosts: recent.length
          ? {
              count: recent.length,
              max: Math.max(...recent),
              average: roundMoney(recent.reduce((total, cost) => total + cost, 0) / recent.length),
            }
          : null,
      };
    },

    // The currency and pricing basis cost reporting uses (the same as the
    // report below), for other read-only views such as Source Intelligence.
    async costBasis() {
      const status = await this.status();
      const basis = dependencies.executionBasis?.() ?? null;
      return { currency: reportCurrency(status, basis), configuredPricingVersions: basis?.pricingVersions ?? [] };
    },

    // Operational AI usage, capacity and backlog reporting for /budget.
    // Estimates are labelled as such and anything without a basis is null.
    async report() {
      const at = now();
      const status = await this.status();
      const basis = dependencies.executionBasis?.() ?? null;
      const currency = reportCurrency(status, basis);
      const timeZone = status.configured ? status.settings.timeZone : "UTC";
      const period = budgetPeriod(at, timeZone);
      const sixMonthsAgo = budgetPeriod(
        new Date(Date.UTC(Number(period.label.slice(0, 4)), Number(period.label.slice(5, 7)) - 6, 15)),
        timeZone,
      );
      const [tokens, counts, costBasis, daily, monthly, usageBreakdown] = await Promise.all([
        budgets.periodTokenUsage(period),
        budgets.operationalCounts({ executableDomains: dependencies.executableDomains ?? [] }),
        currency ? budgets.recentEvaluationCostBasis({ currency, limit: 10 }) : Promise.resolve(null),
        currency
          ? budgets.spendSeries({ granularity: "day", timeZone, currency, from: period.start, to: period.end })
          : Promise.resolve([]),
        currency
          ? budgets.spendSeries({ granularity: "month", timeZone, currency, from: sixMonthsAgo.start, to: period.end })
          : Promise.resolve([]),
        budgets.periodUsageBreakdown({ period, currency }),
      ]);
      const totals = counts.reduce(
        (sum, row) => ({
          eligibleNotEvaluated: sum.eligibleNotEvaluated + row.eligibleNotEvaluated,
          evaluated: sum.evaluated + row.evaluated,
          queued: sum.queued + row.queued,
          running: sum.running + row.running,
          deferred: sum.deferred + row.deferred,
        }),
        { eligibleNotEvaluated: 0, evaluated: 0, queued: 0, running: 0, deferred: 0 },
      );
      const capacity = capacityEstimate({
        recentEvaluationCosts: costBasis?.costs ?? [],
        remainingBudget: status.configured ? status.remaining : null,
        dailyEvaluationLimit: status.configured ? status.settings.dailyEvaluationLimit : null,
        weeklyEvaluationLimit: status.configured ? status.settings.weeklyEvaluationLimit : null,
        usage: {
          dailyEvaluations: status.configured ? status.limits.daily.used : 0,
          weeklyEvaluations: status.configured ? status.limits.weekly.used : 0,
        },
        deferredCount: totals.deferred,
        eligibleCount: totals.eligibleNotEvaluated,
      });
      return {
        generatedAt: at.toISOString(),
        currency,
        period: { label: period.label, start: period.start.toISOString(), end: period.end.toISOString(), timeZone },
        budget: status,
        tokens,
        usageBreakdown,
        counts: { totals, breakdown: counts },
        capacity,
        basis: {
          policyVersion: basis?.policyVersion ?? null,
          configuredPricingVersions: basis?.pricingVersions ?? [],
          estimatePricingVersions: costBasis?.pricingVersions ?? [],
          callLimit: dependencies.callLimitBounds?.() ?? null,
          budgetUpdatedAt: status.configured ? status.settings.updatedAt : null,
        },
        spendOverTime: { daily, monthly },
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
      const callLimit = parsed.data.evaluationCallLimit;
      if (callLimit !== null) {
        // The allowance may only lower the deployment maximum, and never below
        // what a normal evaluation needs.
        const bounds = dependencies.callLimitBounds?.() ?? null;
        const issue = !bounds
          ? "The AI call allowance can be set once AI evaluation is configured"
          : callLimit > bounds.maximum
            ? `The AI call allowance cannot exceed the system maximum of ${bounds.maximum}`
            : callLimit < bounds.minimum
              ? `A normal evaluation needs at least ${bounds.minimum} AI calls`
              : null;
        if (issue) {
          throw new BudgetServiceError("BUDGET_INVALID", "The budget settings are invalid", 400, [
            { path: "evaluationCallLimit", message: issue },
          ]);
        }
      }
      // Changing or disabling the budget never rewrites usage or cost records,
      // and never changes evaluations that are already queued.
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

// Cost is reported in the configured budget's currency, else the configured
// pricing currency; with neither, spend is Unknown.
function reportCurrency(
  status: { configured: true; settings: { currency: string } } | { configured: false },
  basis: { currency: string } | null,
): string | null {
  return status.configured ? status.settings.currency : basis?.currency ?? null;
}

export type BudgetService = ReturnType<typeof createBudgetService>;

let budgetService: BudgetService | undefined;

export function getBudgetService(): BudgetService {
  const config = () => {
    try {
      return semanticExecutorConfigFromEnvironment();
    } catch {
      return null;
    }
  };
  budgetService ??= createBudgetService({
    pricingCurrencies: () => {
      const current = config();
      return current
        ? [...new Set([current.pricing, ...(current.pricingConfigurations ?? [])].map((item) => item.currency))]
        : null;
    },
    callLimitBounds: () => {
      const current = config();
      return current
        ? { minimum: customerSuccessSemanticOperationIds.length, maximum: current.callBudget }
        : null;
    },
    executionBasis: () => {
      const current = config();
      return current
        ? {
            policyVersion: current.executionPolicy?.version ?? null,
            pricingVersions: [...new Set([current.pricing, ...(current.pricingConfigurations ?? [])].map((item) => item.version))].sort(),
            currency: current.pricing.currency,
          }
        : null;
    },
    executableDomains: executableEvaluationDomains,
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
    async report() {
      try {
        return Response.json(await service.report());
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
