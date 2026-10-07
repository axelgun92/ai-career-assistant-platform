import { holdState, roundMoney, type BudgetPeriod, type HoldState } from "@ai-career/core";
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
  updatedAt: Date;
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
      updatedAt: row.updatedAt,
    };
  }

  async saveSettings(input: {
    amount: number;
    currency: string;
    timeZone: string;
    enforced: boolean;
    reservePerEvaluation: number;
  }): Promise<StoredBudgetSettings> {
    const data = {
      amount: new Prisma.Decimal(input.amount.toFixed(6)),
      currency: input.currency,
      timeZone: input.timeZone,
      enforced: input.enforced,
      reservePerEvaluation: new Prisma.Decimal(input.reservePerEvaluation.toFixed(6)),
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
