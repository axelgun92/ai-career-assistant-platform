import { listingUrlKey, listingUrlPrefix } from "@ai-career/deduplication";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import { containsPattern } from "./duplicate-repository";

// Read-only (feature 14B): whether the job page the extension is showing
// is already stored, so its popup can say "Already saved" before anything
// is read from the page. A capture still decides for itself, in the capture
// transaction; this lookup writes nothing.

export interface CapturedPageMatch {
  opportunityId: string;
  title: string | null;
  companyName: string | null;
  status: string;
}

export class PrismaExtensionLookupRepository {
  private readonly database = getDatabaseClient();

  // An earlier capture of the same page (same source listing ID) first;
  // otherwise any opportunity, or any of its source records, whose listing
  // or application URL has the same URL key.
  async findCapturedPage(input: { source: string; externalId: string | null; url: string }): Promise<CapturedPageMatch | null> {
    if (input.externalId) {
      const record = await this.database.sourceRecord.findFirst({
        where: { source: input.source, externalId: input.externalId, opportunityId: { not: null } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { opportunityId: true },
      });
      if (record?.opportunityId) return this.opportunity(record.opportunityId);
    }
    const key = listingUrlKey(input.url);
    const prefix = listingUrlPrefix(input.url);
    if (!key || !prefix) return null;
    const pattern = containsPattern(prefix);
    const rows = await this.database.$queryRaw<Array<{ id: string; url: string | null }>>(Prisma.sql`
      SELECT o."id", o."canonicalUrl" AS "url" FROM "Opportunity" o
        WHERE o."canonicalUrl" ILIKE ${pattern} OR o."applicationUrl" ILIKE ${pattern}
      UNION ALL
      SELECT s."opportunityId" AS "id", s."sourceUrl" AS "url" FROM "SourceRecord" s
        WHERE s."opportunityId" IS NOT NULL AND (s."sourceUrl" ILIKE ${pattern} OR s."applicationUrl" ILIKE ${pattern})
      LIMIT 50
    `);
    const opportunityIds = [...new Set(rows.map((row) => row.id))];
    if (!opportunityIds.length) return null;
    // ILIKE on the prefix only narrows the candidates; the URL keys decide.
    const candidates = await this.database.opportunity.findMany({
      where: { id: { in: opportunityIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        canonicalUrl: true,
        applicationUrl: true,
        sourceRecords: { select: { sourceUrl: true, applicationUrl: true } },
      },
    });
    const match = candidates.find((candidate) =>
      [candidate.canonicalUrl, candidate.applicationUrl, ...candidate.sourceRecords.flatMap((record) => [record.sourceUrl, record.applicationUrl])].some(
        (url) => listingUrlKey(url) === key,
      ),
    );
    return match ? this.opportunity(match.id) : null;
  }

  private async opportunity(id: string): Promise<CapturedPageMatch | null> {
    const row = await this.database.opportunity.findUnique({
      where: { id },
      select: { id: true, title: true, status: true, company: { select: { name: true } } },
    });
    return row ? { opportunityId: row.id, title: row.title, companyName: row.company?.name ?? null, status: row.status } : null;
  }
}
