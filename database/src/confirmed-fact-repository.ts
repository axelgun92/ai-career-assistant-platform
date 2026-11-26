import { compensationTierSchema, type ConfirmableFacts, type ConfirmedFactField } from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

// User-confirmed facts (November 25, 2026): one current row per
// opportunity and field, apart from the captured evidence, with every save,
// edit and undo recorded as an event. Nothing here changes the opportunity
// or its source records.

export interface ConfirmedFactRecord {
  id: string;
  opportunityId: string;
  fieldName: ConfirmedFactField;
  value: unknown;
  capturedValue: unknown;
  quotation: string | null;
  note: string | null;
  confirmedAt: Date;
}

export interface ConfirmedFactEventRecord {
  id: string;
  fieldName: string;
  action: "CONFIRMED" | "EDITED" | "UNDONE";
  value: unknown;
  quotation: string | null;
  note: string | null;
  createdAt: Date;
}

type Database = ReturnType<typeof getDatabaseClient>;
type Client = Database | Parameters<Parameters<Database["$transaction"]>[0]>[0];

const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));

export async function activeConfirmedFacts(client: Client, opportunityId: string): Promise<ConfirmedFactRecord[]> {
  const rows = await client.userConfirmedFact.findMany({
    where: { opportunityId, revokedAt: null },
    orderBy: [{ fieldName: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    opportunityId: row.opportunityId,
    fieldName: row.fieldName as ConfirmedFactField,
    value: row.value,
    capturedValue: row.capturedValue,
    quotation: row.quotation,
    note: row.note,
    confirmedAt: row.confirmedAt,
  }));
}

export class PrismaConfirmedFactRepository {
  constructor(private readonly database: Database = getDatabaseClient()) {}

  list(opportunityId: string) {
    return activeConfirmedFacts(this.database, opportunityId);
  }

  // The captured, normalized facts a confirmation can replace (without any
  // confirmation applied). Null when the opportunity is gone.
  async capturedFacts(opportunityId: string): Promise<ConfirmableFacts | null> {
    const row = await this.database.opportunity.findUnique({
      where: { id: opportunityId },
      select: {
        salaryMin: true, salaryMax: true, currency: true, compensationBasis: true, compensationTiers: true,
        residencyRequirement: true, residencyRegions: true, remoteStatus: true, workArrangements: true,
        employmentType: true, workAuthorizationRequirement: true, workAuthorizationRegions: true, visaSponsorship: true, seniority: true,
      },
    });
    if (!row) return null;
    return {
      ...row,
      salaryMin: row.salaryMin?.toNumber() ?? null,
      salaryMax: row.salaryMax?.toNumber() ?? null,
      compensationTiers: compensationTierSchema.array().catch([]).parse(row.compensationTiers),
    };
  }

  async history(opportunityId: string): Promise<ConfirmedFactEventRecord[]> {
    const rows = await this.database.userConfirmedFactEvent.findMany({
      where: { opportunityId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({ ...row, action: row.action as ConfirmedFactEventRecord["action"] }));
  }

  // Saves (or edits) a confirmation. Null when the opportunity is gone.
  async save(input: {
    opportunityId: string;
    fieldName: ConfirmedFactField;
    value: unknown;
    capturedValue: unknown;
    quotation: string | null;
    note: string | null;
    at: Date;
  }): Promise<ConfirmedFactRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const exists = await transaction.opportunity.count({ where: { id: input.opportunityId } });
      if (!exists) return null;
      const current = await transaction.userConfirmedFact.findUnique({
        where: { opportunityId_fieldName: { opportunityId: input.opportunityId, fieldName: input.fieldName } },
      });
      const data = {
        value: input.value as Prisma.InputJsonValue,
        // The captured value when first confirmed; an edit keeps it.
        capturedValue: current && current.revokedAt === null ? (current.capturedValue === null ? Prisma.DbNull : (current.capturedValue as Prisma.InputJsonValue)) : json(input.capturedValue),
        quotation: input.quotation,
        note: input.note,
        confirmedAt: input.at,
        revokedAt: null,
      };
      await transaction.userConfirmedFact.upsert({
        where: { opportunityId_fieldName: { opportunityId: input.opportunityId, fieldName: input.fieldName } },
        create: { opportunityId: input.opportunityId, fieldName: input.fieldName, ...data },
        update: data,
      });
      await transaction.userConfirmedFactEvent.create({
        data: {
          opportunityId: input.opportunityId,
          fieldName: input.fieldName,
          action: current && current.revokedAt === null ? "EDITED" : "CONFIRMED",
          value: input.value as Prisma.InputJsonValue,
          quotation: input.quotation,
          note: input.note,
          createdAt: input.at,
        },
      });
      return (await activeConfirmedFacts(transaction, input.opportunityId)).find((fact) => fact.fieldName === input.fieldName) ?? null;
    });
  }

  // Undo: the confirmation stops applying; its history stays. False when
  // there was nothing to undo.
  async revoke(input: { opportunityId: string; fieldName: ConfirmedFactField; at: Date }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.userConfirmedFact.updateMany({
        where: { opportunityId: input.opportunityId, fieldName: input.fieldName, revokedAt: null },
        data: { revokedAt: input.at },
      });
      if (changed.count !== 1) return false;
      await transaction.userConfirmedFactEvent.create({
        data: { opportunityId: input.opportunityId, fieldName: input.fieldName, action: "UNDONE", createdAt: input.at },
      });
      return true;
    });
  }
}
