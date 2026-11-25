import type { TitlePolicyPatterns } from "@ai-career/core";
import { getDatabaseClient } from "./client";

// The saved target job titles for automatic acquisition, one row per domain
// (November 22, 2026). Null when nothing is saved, in which case the
// domain's defaults apply. Saving never changes any captured opportunity.
export interface SavedTitlePolicy extends TitlePolicyPatterns {
  readonly updatedAt: Date;
}

export class PrismaTitlePolicyRepository {
  private readonly database = getDatabaseClient();

  async get(domain: string): Promise<SavedTitlePolicy | null> {
    const row = await this.database.titlePolicySetting.findUnique({ where: { domain } });
    return row ? { accepted: row.acceptedPatterns, excluded: row.excludedPatterns, updatedAt: row.updatedAt } : null;
  }

  async save(domain: string, patterns: TitlePolicyPatterns): Promise<SavedTitlePolicy> {
    const data = { acceptedPatterns: [...patterns.accepted], excludedPatterns: [...patterns.excluded] };
    const row = await this.database.titlePolicySetting.upsert({
      where: { domain },
      create: { domain, ...data },
      update: data,
    });
    return { accepted: row.acceptedPatterns, excluded: row.excludedPatterns, updatedAt: row.updatedAt };
  }

  // Every captured opportunity's id and title (not DISCOVERED placeholders),
  // for finding earlier captures whose titles are outside the current target
  // job titles. Read-only.
  async opportunityTitles(): Promise<Array<{ id: string; title: string | null; status: string }>> {
    return this.database.opportunity.findMany({ where: { status: { not: "DISCOVERED" } }, select: { id: true, title: true, status: true } });
  }

  // Reset to defaults: the saved row is removed.
  async clear(domain: string): Promise<void> {
    await this.database.titlePolicySetting.deleteMany({ where: { domain } });
  }
}
