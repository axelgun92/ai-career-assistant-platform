import { geographyCountryNames, type UserWorkEligibility } from "@ai-career/core";
import { getDatabaseClient } from "./client";

// The user's own work eligibility (one row): the countries the user may work
// in and is a citizen of. Used only to decide which jobs' work-authorization
// facts need attention; never read by normalization or the evaluator.
const rowId = "user";

const countriesOnly = (codes: readonly string[]) => [...new Set(codes.filter((code) => code in geographyCountryNames))].sort();

export class PrismaUserEligibilityRepository {
  private readonly database = getDatabaseClient();

  async get(): Promise<(UserWorkEligibility & { updatedAt: Date }) | null> {
    const row = await this.database.userEligibility.findUnique({ where: { id: rowId } });
    return row ? { authorizedRegions: row.authorizedRegions, citizenshipRegions: row.citizenshipRegions, updatedAt: row.updatedAt } : null;
  }

  async save(input: UserWorkEligibility): Promise<UserWorkEligibility & { updatedAt: Date }> {
    const data = { authorizedRegions: countriesOnly(input.authorizedRegions), citizenshipRegions: countriesOnly(input.citizenshipRegions) };
    const row = await this.database.userEligibility.upsert({ where: { id: rowId }, create: { id: rowId, ...data }, update: data });
    return { authorizedRegions: row.authorizedRegions, citizenshipRegions: row.citizenshipRegions, updatedAt: row.updatedAt };
  }
}
