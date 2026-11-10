import {
  holdState,
  roundMoney,
  type BudgetPeriod,
  type HoldState,
  type ThroughputUsage,
  type VolumeWindow,
} from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import type { AdmissionTransaction } from "./evaluation-admission-repository";

export const globalBudgetId = "global";

export interface StoredBudgetSettings {
  amount: number;
  currency: string;
  periodType: "CALENDAR_MONTH";
  timeZone: string;
  enforced: boolean;
  reservePerEvaluation: number;
  warningThresholds: number[];
  dailyEvaluationLimit: number | null;
  weeklyEvaluationLimit: number | null;
  monthlyOutputTokenLimit: number | null;
  evaluationCallLimit: number | null;
  updatedAt: Date;
}

export type BudgetSettingsInput = Omit<StoredBudgetSettings, "periodType" | "updatedAt">;

export interface PeriodTokenUsage {
  attempts: number;
  // Sums of provider-reported tokens; attempts that did not report a
  // category are counted separately and never added as zero.
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  attemptsWithoutInputTokens: number;
  attemptsWithoutOutputTokens: number;
  attemptsWithoutTotalTokens: number;
}

export interface SpendBucket {
  // Local calendar date (YYYY-MM-DD) or month (YYYY-MM) in the budget zone.
  label: string;
  knownCost: number;
  attempts: number;
  // Attempts with no recorded cost or priced in another currency.
  unknownCostAttempts: number;
}

// Provider-reported usage and known spend in one period for one domain and
// job source (Core PRD §20, Core TDD §38). Unreported tokens and costs that
// are unknown or in another currency are counted, never added as zero.
export interface UsageBreakdownRow {
  domain: string;
  sourceType: string | null;
  source: string | null;
  attempts: number;
  evaluations: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  attemptsWithoutTotalTokens: number;
  // Null without a currency to report in.
  knownCost: number | null;
  unknownCostAttempts: number;
}

export interface OperationalCountRow {
  domain: string | null;
  sourceType: string | null;
  // Normalized, evaluable, executable-domain opportunities never evaluated
  // and neither in progress nor deferred.
  eligibleNotEvaluated: number;
  evaluated: number;
  queued: number;
  running: number;
  deferred: number;
}

export interface LedgerHold {
  reservationId: string;
  admissionId: string;
  opportunityId: string;
  evaluationId: string | null;
  reserved: number;
  knownCost: number;
  hold: HoldState;
}

export interface PeriodLedger {
  // Sum of every persisted attempt cost in the period priced in the budget
  // currency. An attempt with unknown cost never contributes, and never
  // hides the known cost of other attempts in the same evaluation.
  knownSpent: number;
  // Attempts in the period with no recorded cost (or no pricing record).
  unknownAttempts: number;
  // Attempts in the period priced in a different currency; never combined.
  otherCurrencyAttempts: number;
  holds: LedgerHold[];
  held: number;
}

const toNumber = (value: Prisma.Decimal | number | bigint | null) =>
  value === null ? 0 : typeof value === "object" ? value.toNumber() : Number(value);

// Read-only budget accounting over persisted semantic-operation attempts,
// plus the budget settings and reservations. It aggregates attempt rows
// directly and never recalculates or estimates provider cost.
export class PrismaBudgetRepository {
  private readonly database = getDatabaseClient();

  async getSettings(transaction?: AdmissionTransaction): Promise<StoredBudgetSettings | null> {
    const row = await (transaction ?? this.database).budgetSetting.findUnique({ where: { id: globalBudgetId } });
    if (!row) return null;
    return {
      amount: row.amount.toNumber(),
      currency: row.currency,
      periodType: row.periodType,
      timeZone: row.timeZone,
      enforced: row.enforced,
      reservePerEvaluation: row.reservePerEvaluation.toNumber(),
      warningThresholds: row.warningThresholds,
      dailyEvaluationLimit: row.dailyEvaluationLimit,
      weeklyEvaluationLimit: row.weeklyEvaluationLimit,
      monthlyOutputTokenLimit: row.monthlyOutputTokenLimit,
      evaluationCallLimit: row.evaluationCallLimit,
      updatedAt: row.updatedAt,
    };
  }

  async saveSettings(input: BudgetSettingsInput): Promise<StoredBudgetSettings> {
    const data = {
      amount: new Prisma.Decimal(input.amount.toFixed(6)),
      currency: input.currency,
      timeZone: input.timeZone,
      enforced: input.enforced,
      reservePerEvaluation: new Prisma.Decimal(input.reservePerEvaluation.toFixed(6)),
      warningThresholds: input.warningThresholds,
      dailyEvaluationLimit: input.dailyEvaluationLimit,
      weeklyEvaluationLimit: input.weeklyEvaluationLimit,
      monthlyOutputTokenLimit: input.monthlyOutputTokenLimit,
      evaluationCallLimit: input.evaluationCallLimit,
    };
    await this.database.budgetSetting.upsert({
      where: { id: globalBudgetId },
      create: { id: globalBudgetId, ...data },
      update: data,
    });
    return (await this.getSettings())!;
  }

  // Removing the budget only removes the setting; reservations, usage and
  // cost records are kept unchanged.
  async deleteSettings(): Promise<void> {
    await this.database.budgetSetting.deleteMany({ where: { id: globalBudgetId } });
  }

  async periodLedger(input: {
    period: BudgetPeriod;
    currency: string;
    transaction?: AdmissionTransaction;
  }): Promise<PeriodLedger> {
    const client = input.transaction ?? this.database;
    const { start, end } = input.period;
    const [totals] = await client.$queryRaw<
      Array<{ known: Prisma.Decimal | null; unknown: bigint; other: bigint }>
    >`
      SELECT
        COALESCE(SUM(a."estimatedCost") FILTER (
          WHERE a."estimatedCost" IS NOT NULL AND p."currency" = ${input.currency}
        ), 0) AS known,
        COUNT(*) FILTER (
          WHERE a."estimatedCost" IS NULL OR p."id" IS NULL
        ) AS unknown,
        COUNT(*) FILTER (
          WHERE a."estimatedCost" IS NOT NULL AND p."id" IS NOT NULL AND p."currency" <> ${input.currency}
        ) AS other
      FROM "SemanticOperationAttempt" a
      LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
      WHERE a."createdAt" >= ${start} AND a."createdAt" < ${end}
    `;

    // Reservations that may still hold budget in this period: live
    // admissions, queued/running evaluations (from any period), and finished
    // evaluations with unknown-cost attempts in this period.
    const rows = await client.$queryRaw<
      Array<{
        reservationId: string;
        admissionId: string;
        opportunityId: string;
        evaluationId: string | null;
        amount: Prisma.Decimal;
        taskStatus: string | null;
        knownCost: Prisma.Decimal | null;
        unknownInPeriod: bigint;
      }>
    >`
      SELECT
        r."id" AS "reservationId",
        ad."id" AS "admissionId",
        ad."opportunityId" AS "opportunityId",
        ad."evaluationId" AS "evaluationId",
        r."amount" AS "amount",
        t."status"::text AS "taskStatus",
        (
          SELECT COALESCE(SUM(a."estimatedCost"), 0)
          FROM "SemanticOperationAttempt" a
          JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
          WHERE a."evaluationId" = ad."evaluationId"
            AND a."estimatedCost" IS NOT NULL
            AND p."currency" = ${input.currency}
        ) AS "knownCost",
        (
          SELECT COUNT(*)
          FROM "SemanticOperationAttempt" a
          LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
          WHERE a."evaluationId" = ad."evaluationId"
            AND a."createdAt" >= ${start} AND a."createdAt" < ${end}
            AND NOT (a."estimatedCost" IS NOT NULL AND p."currency" IS NOT NULL AND p."currency" = ${input.currency})
        ) AS "unknownInPeriod"
      FROM "EvaluationBudgetReservation" r
      JOIN "EvaluationAdmission" ad ON ad."id" = r."admissionId"
      LEFT JOIN "EvaluationTask" t ON t."evaluationId" = ad."evaluationId"
      WHERE ad."abandonedAt" IS NULL
        AND (
          ad."evaluationId" IS NULL
          OR t."status" IN ('PENDING', 'RUNNING')
          OR EXISTS (
            SELECT 1
            FROM "SemanticOperationAttempt" a
            LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
            WHERE a."evaluationId" = ad."evaluationId"
              AND a."createdAt" >= ${start} AND a."createdAt" < ${end}
              AND NOT (a."estimatedCost" IS NOT NULL AND p."currency" IS NOT NULL AND p."currency" = ${input.currency})
          )
        )
      ORDER BY r."createdAt" ASC
    `;

    const holds = rows
      .map((row) => {
        const knownCost = toNumber(row.knownCost);
        const reserved = toNumber(row.amount);
        return {
          reservationId: row.reservationId,
          admissionId: row.admissionId,
          opportunityId: row.opportunityId,
          evaluationId: row.evaluationId,
          reserved,
          knownCost,
          hold: holdState({
            amount: reserved,
            admission: row.evaluationId ? "CONSUMED" : "LIVE",
            taskStatus: (row.taskStatus as "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | null) ?? null,
            knownCost,
            unknownAttemptsInPeriod: Number(row.unknownInPeriod),
          }),
        };
      })
      .filter((item) => item.hold.kind !== "NOT_HELD");

    return {
      knownSpent: roundMoney(toNumber(totals?.known ?? null)),
      unknownAttempts: Number(totals?.unknown ?? 0),
      otherCurrencyAttempts: Number(totals?.other ?? 0),
      holds,
      held: roundMoney(holds.reduce((total, item) => total + item.hold.remaining, 0)),
    };
  }

  // Persisted usage counted against throughput limits. Admissions count
  // whether still live or already consumed by an evaluation; abandoned ones
  // never started and do not count. Read inside the admission lock this is
  // concurrency-safe, and it is restart-safe because it is only persisted rows.
  async throughputUsage(input: {
    day: VolumeWindow;
    week: VolumeWindow;
    period: BudgetPeriod;
    transaction?: AdmissionTransaction;
  }): Promise<ThroughputUsage & { attemptsWithoutOutputTokens: number }> {
    const client = input.transaction ?? this.database;
    const [volume] = await client.$queryRaw<Array<{ daily: bigint; weekly: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" >= ${input.day.start} AND "createdAt" < ${input.day.end}) AS daily,
        COUNT(*) FILTER (WHERE "createdAt" >= ${input.week.start} AND "createdAt" < ${input.week.end}) AS weekly
      FROM "EvaluationAdmission"
      WHERE "abandonedAt" IS NULL
        AND "createdAt" >= ${input.day.start < input.week.start ? input.day.start : input.week.start}
    `;
    const [tokens] = await client.$queryRaw<Array<{ output: bigint | null; unreported: bigint }>>`
      SELECT
        SUM("outputTokens") AS output,
        COUNT(*) FILTER (WHERE "outputTokens" IS NULL) AS unreported
      FROM "SemanticOperationAttempt"
      WHERE "createdAt" >= ${input.period.start} AND "createdAt" < ${input.period.end}
    `;
    return {
      dailyEvaluations: Number(volume?.daily ?? 0),
      weeklyEvaluations: Number(volume?.weekly ?? 0),
      outputTokens: Number(tokens?.output ?? 0),
      attemptsWithoutOutputTokens: Number(tokens?.unreported ?? 0),
    };
  }

  async periodTokenUsage(period: BudgetPeriod): Promise<PeriodTokenUsage> {
    const [row] = await this.database.$queryRaw<Array<Record<string, bigint | null>>>`
      SELECT
        COUNT(*) AS attempts,
        SUM("inputTokens") AS "inputTokens",
        SUM("outputTokens") AS "outputTokens",
        SUM("totalTokens") AS "totalTokens",
        COUNT(*) FILTER (WHERE "inputTokens" IS NULL) AS "attemptsWithoutInputTokens",
        COUNT(*) FILTER (WHERE "outputTokens" IS NULL) AS "attemptsWithoutOutputTokens",
        COUNT(*) FILTER (WHERE "totalTokens" IS NULL) AS "attemptsWithoutTotalTokens"
      FROM "SemanticOperationAttempt"
      WHERE "createdAt" >= ${period.start} AND "createdAt" < ${period.end}
    `;
    const value = (key: string) => Number(row?.[key] ?? 0);
    return {
      attempts: value("attempts"),
      inputTokens: value("inputTokens"),
      outputTokens: value("outputTokens"),
      totalTokens: value("totalTokens"),
      attemptsWithoutInputTokens: value("attemptsWithoutInputTokens"),
      attemptsWithoutOutputTokens: value("attemptsWithoutOutputTokens"),
      attemptsWithoutTotalTokens: value("attemptsWithoutTotalTokens"),
    };
  }

  async periodUsageBreakdown(input: { period: BudgetPeriod; currency: string | null }): Promise<UsageBreakdownRow[]> {
    const currency = input.currency ?? "";
    const rows = await this.database.$queryRaw<
      Array<{
        domain: string;
        sourceType: string | null;
        source: string | null;
        attempts: bigint;
        evaluations: bigint;
        inputTokens: bigint | null;
        outputTokens: bigint | null;
        totalTokens: bigint | null;
        attemptsWithoutTotalTokens: bigint;
        known: Prisma.Decimal | null;
        unknown: bigint;
      }>
    >`
      SELECT
        a."domain",
        o."sourceType"::text AS "sourceType",
        COALESCE(a."jobSource", o."source") AS "source",
        COUNT(*) AS attempts,
        COUNT(DISTINCT a."evaluationId") AS evaluations,
        SUM(a."inputTokens") AS "inputTokens",
        SUM(a."outputTokens") AS "outputTokens",
        SUM(a."totalTokens") AS "totalTokens",
        COUNT(*) FILTER (WHERE a."totalTokens" IS NULL) AS "attemptsWithoutTotalTokens",
        COALESCE(SUM(a."estimatedCost") FILTER (
          WHERE a."estimatedCost" IS NOT NULL AND p."currency" = ${currency}
        ), 0) AS known,
        COUNT(*) FILTER (
          WHERE NOT (a."estimatedCost" IS NOT NULL AND p."currency" IS NOT NULL AND p."currency" = ${currency})
        ) AS unknown
      FROM "SemanticOperationAttempt" a
      JOIN "Opportunity" o ON o."id" = a."opportunityId"
      LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
      WHERE a."createdAt" >= ${input.period.start} AND a."createdAt" < ${input.period.end}
      GROUP BY 1, 2, 3
      ORDER BY 1, 2 NULLS LAST, 3 NULLS LAST
    `;
    return rows.map((row) => ({
      domain: row.domain,
      sourceType: row.sourceType,
      source: row.source,
      attempts: Number(row.attempts),
      evaluations: Number(row.evaluations),
      inputTokens: Number(row.inputTokens ?? 0),
      outputTokens: Number(row.outputTokens ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      attemptsWithoutTotalTokens: Number(row.attemptsWithoutTotalTokens),
      knownCost: input.currency ? roundMoney(toNumber(row.known)) : null,
      unknownCostAttempts: input.currency ? Number(row.unknown) : Number(row.attempts),
    }));
  }

  // Known spend per local day or month in the budget zone, from persisted
  // attempt costs in the budget currency. Buckets with no attempts are
  // omitted; callers fill the range.
  async spendSeries(input: {
    granularity: "day" | "month";
    timeZone: string;
    currency: string;
    from: Date;
    to: Date;
  }): Promise<SpendBucket[]> {
    const format = input.granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM";
    const rows = await this.database.$queryRaw<
      Array<{ label: string; known: Prisma.Decimal | null; attempts: bigint; unknown: bigint }>
    >`
      SELECT
        to_char(a."createdAt" AT TIME ZONE ${input.timeZone}, ${format}) AS label,
        COALESCE(SUM(a."estimatedCost") FILTER (
          WHERE a."estimatedCost" IS NOT NULL AND p."currency" = ${input.currency}
        ), 0) AS known,
        COUNT(*) AS attempts,
        COUNT(*) FILTER (
          WHERE NOT (a."estimatedCost" IS NOT NULL AND p."currency" IS NOT NULL AND p."currency" = ${input.currency})
        ) AS unknown
      FROM "SemanticOperationAttempt" a
      LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
      WHERE a."createdAt" >= ${input.from} AND a."createdAt" < ${input.to}
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map((row) => ({
      label: row.label,
      knownCost: roundMoney(toNumber(row.known)),
      attempts: Number(row.attempts),
      unknownCostAttempts: Number(row.unknown),
    }));
  }

  // Operational counts per domain and job source type. Each opportunity is
  // counted once per state it is in: evaluated (has a completed evaluation),
  // queued/running (its latest task), deferred (an open budget deferral), and
  // eligible-not-evaluated (evaluable lifecycle, executable domain, no
  // evaluation, nothing in progress or deferred).
  async operationalCounts(input: { executableDomains: readonly string[] }): Promise<OperationalCountRow[]> {
    const domains = input.executableDomains.length ? input.executableDomains : ["__none__"];
    const rows = await this.database.$queryRaw<
      Array<{
        domain: string | null;
        sourceType: string | null;
        eligible: bigint;
        evaluated: bigint;
        queued: bigint;
        running: bigint;
        deferred: bigint;
      }>
    >`
      WITH state AS (
        SELECT
          o."id",
          o."domain",
          o."sourceType"::text AS "sourceType",
          o."status"::text AS status,
          EXISTS (SELECT 1 FROM "Evaluation" e WHERE e."opportunityId" = o."id") AS "hasEvaluation",
          EXISTS (
            SELECT 1 FROM "Evaluation" e
            JOIN "EvaluationTask" t ON t."evaluationId" = e."id"
            WHERE e."opportunityId" = o."id" AND t."status" = 'COMPLETED'
          ) AS "hasCompleted",
          (
            SELECT t."status"::text FROM "Evaluation" e
            JOIN "EvaluationTask" t ON t."evaluationId" = e."id"
            WHERE e."opportunityId" = o."id"
            ORDER BY e."createdAt" DESC LIMIT 1
          ) AS "latestTask",
          EXISTS (
            SELECT 1 FROM "DeferredEvaluation" d
            WHERE d."opportunityId" = o."id" AND d."status" = 'DEFERRED'
          ) AS "deferred"
        FROM "Opportunity" o
      )
      SELECT
        "domain",
        "sourceType",
        COUNT(*) FILTER (
          WHERE status NOT IN ('DISCOVERED', 'ARCHIVED', 'CLOSED')
            AND "domain" IN (${Prisma.join(domains)})
            AND NOT "hasEvaluation" AND NOT "deferred"
        ) AS eligible,
        COUNT(*) FILTER (WHERE "hasCompleted") AS evaluated,
        COUNT(*) FILTER (WHERE "latestTask" = 'PENDING') AS queued,
        COUNT(*) FILTER (WHERE "latestTask" = 'RUNNING') AS running,
        COUNT(*) FILTER (WHERE "deferred") AS deferred
      FROM state
      GROUP BY "domain", "sourceType"
      ORDER BY "domain" NULLS LAST, "sourceType" NULLS LAST
    `;
    return rows.map((row) => ({
      domain: row.domain,
      sourceType: row.sourceType,
      eligibleNotEvaluated: Number(row.eligible),
      evaluated: Number(row.evaluated),
      queued: Number(row.queued),
      running: Number(row.running),
      deferred: Number(row.deferred),
    }));
  }

  // The estimate basis: known cost of recent completed evaluations whose
  // every attempt has a known cost in the currency, plus the pricing
  // versions those costs were estimated with.
  async recentEvaluationCostBasis(input: { currency: string; limit: number }): Promise<{
    costs: number[];
    pricingVersions: string[];
  }> {
    const rows = await this.database.$queryRaw<Array<{ cost: Prisma.Decimal; versions: string[] }>>`
      SELECT SUM(a."estimatedCost") AS cost, array_agg(DISTINCT p."version") AS versions
      FROM "SemanticOperationAttempt" a
      JOIN "Evaluation" e ON e."id" = a."evaluationId" AND e."status" = 'COMPLETED'
      LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
      GROUP BY a."evaluationId"
      HAVING bool_and(a."estimatedCost" IS NOT NULL AND p."currency" IS NOT NULL AND p."currency" = ${input.currency})
      ORDER BY MAX(a."createdAt") DESC
      LIMIT ${input.limit}
    `;
    return {
      costs: rows.map((row) => roundMoney(toNumber(row.cost))),
      pricingVersions: [...new Set(rows.flatMap((row) => row.versions ?? []))].sort(),
    };
  }

  // Known cost of recent completed evaluations whose every attempt has a
  // known cost in the currency; used only to suggest a reserve.
  async recentEvaluationCosts(input: { currency: string; limit: number }): Promise<number[]> {
    const rows = await this.database.$queryRaw<Array<{ cost: Prisma.Decimal }>>`
      SELECT SUM(a."estimatedCost") AS cost
      FROM "SemanticOperationAttempt" a
      JOIN "Evaluation" e ON e."id" = a."evaluationId" AND e."status" = 'COMPLETED'
      LEFT JOIN "AiModelPricingConfiguration" p ON p."id" = a."pricingConfigurationId"
      GROUP BY a."evaluationId"
      HAVING bool_and(a."estimatedCost" IS NOT NULL AND p."currency" IS NOT NULL AND p."currency" = ${input.currency})
      ORDER BY MAX(a."createdAt") DESC
      LIMIT ${input.limit}
    `;
    return rows.map((row) => roundMoney(toNumber(row.cost)));
  }

  // Reserved amount for an evaluation, for showing reserved vs actual.
  async reservationForEvaluation(evaluationId: string) {
    const admission = await this.database.evaluationAdmission.findUnique({
      where: { evaluationId },
      select: { reservation: { select: { amount: true, currency: true } } },
    });
    return admission?.reservation
      ? { amount: admission.reservation.amount.toNumber(), currency: admission.reservation.currency }
      : null;
  }
}
