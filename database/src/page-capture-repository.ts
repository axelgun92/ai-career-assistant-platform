import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

// Staging for the browser extension's results-page capture (Mode B). A staged
// card holds only what its results-page card stated; it is a work-queue item
// until its full posting is read and ingested through the normal path. No
// analytics query reads this table, and nothing here creates an opportunity,
// a source record, a retrieved listing or an evaluation.

export type PageCaptureItemStatusValue =
  | "QUEUED"
  | "ACQUIRING"
  | "INGESTED"
  | "AWAITING_DETAILS"
  | "UNAVAILABLE"
  | "ALREADY_SAVED"
  | "DISMISSED";

export interface StagedCardInput {
  externalId: string;
  sourceUrl: string;
  siteJobId: string | null;
  title: string;
  company: string | null;
  location: string | null;
  postedText: string | null;
}

export type StageOutcome = "QUEUED" | "SEEN_AGAIN" | "ALREADY_SAVED";

export interface PageCaptureItemRecord {
  id: string;
  site: string;
  host: string;
  externalId: string;
  sourceUrl: string;
  siteJobId: string | null;
  title: string;
  company: string | null;
  location: string | null;
  postedText: string | null;
  resultsPageUrl: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sightings: number;
  lastBatchId: string;
  pairingId: string;
  status: PageCaptureItemStatusValue;
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  lastReason: string | null;
  opportunityId: string | null;
  handoffOutcome: string | null;
  handedOffAt: Date | null;
}

export interface PageCaptureListRow extends PageCaptureItemRecord {
  // The opportunity the item resolves to: its own ingestion, or (read-time
  // resolution) the job already saved under the same listing identity.
  resolvedOpportunityId: string | null;
  opportunityTitle: string | null;
  triageOutcome: string | null;
  triageManualDecision: string | null;
  evaluationStatus: string | null;
  recommendation: string | null;
}

const friction = ["ACCESS_STOPPED", "RATE_LIMITED"];

type Transaction = Prisma.TransactionClient;

export class PrismaPageCaptureRepository {
  private readonly database = getDatabaseClient();

  // The opportunity a listing identity already belongs to: an earlier
  // extension capture of the same job page, or (LinkedIn) the same job
  // retrieved by the browser-assisted LinkedIn adapter.
  private async savedOpportunity(transaction: Transaction | ReturnType<typeof getDatabaseClient>, card: { externalId: string; siteJobId: string | null }, site: string) {
    const record = await transaction.sourceRecord.findFirst({
      where: {
        opportunityId: { not: null },
        OR: [
          { source: "browser-extension", externalId: card.externalId },
          ...(site === "linkedin" && card.siteJobId ? [{ source: "linkedin", externalId: card.siteJobId }] : []),
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { opportunityId: true },
    });
    return record?.opportunityId ?? null;
  }

  // Stages one batch in one transaction. Repeating a batch (the same batchId)
  // changes nothing; a later batch refreshes the card's stated fields and
  // last sighting. A job already in the app is not queued again.
  async stageBatch(input: {
    site: string;
    host: string;
    batchId: string;
    pairingId: string;
    resultsPageUrl: string;
    receivedAt: Date;
    // QUEUED when the site's jobs can be fetched for details automatically;
    // otherwise AWAITING_DETAILS with NOT_SUPPORTED.
    detailsAvailable: boolean;
    cards: StagedCardInput[];
  }): Promise<Array<{ externalId: string; outcome: StageOutcome; opportunityId: string | null; itemId: string }>> {
    return this.database.$transaction(async (transaction) => {
      const results: Array<{ externalId: string; outcome: StageOutcome; opportunityId: string | null; itemId: string }> = [];
      for (const card of input.cards) {
        const saved = await this.savedOpportunity(transaction, card, input.site);
        const existing = await transaction.pageCaptureItem.findUnique({ where: { externalId: card.externalId } });
        if (existing) {
          const repeat = existing.lastBatchId === input.batchId;
          const status =
            saved && existing.status !== "INGESTED" && existing.status !== "DISMISSED" ? "ALREADY_SAVED" : existing.status;
          const updated = repeat
            ? existing
            : await transaction.pageCaptureItem.update({
                where: { id: existing.id },
                data: {
                  title: card.title,
                  company: card.company,
                  location: card.location,
                  postedText: card.postedText,
                  sourceUrl: card.sourceUrl,
                  siteJobId: card.siteJobId,
                  resultsPageUrl: input.resultsPageUrl,
                  lastSeenAt: input.receivedAt,
                  sightings: { increment: 1 },
                  lastBatchId: input.batchId,
                  status,
                },
              });
          results.push({
            externalId: card.externalId,
            outcome: updated.status === "ALREADY_SAVED" ? "ALREADY_SAVED" : "SEEN_AGAIN",
            opportunityId: updated.opportunityId ?? saved,
            itemId: updated.id,
          });
          continue;
        }
        const created = await transaction.pageCaptureItem.create({
          data: {
            site: input.site,
            host: input.host,
            externalId: card.externalId,
            sourceUrl: card.sourceUrl,
            siteJobId: card.siteJobId,
            title: card.title,
            company: card.company,
            location: card.location,
            postedText: card.postedText,
            resultsPageUrl: input.resultsPageUrl,
            firstSeenAt: input.receivedAt,
            lastSeenAt: input.receivedAt,
            lastBatchId: input.batchId,
            pairingId: input.pairingId,
            status: saved ? "ALREADY_SAVED" : input.detailsAvailable ? "QUEUED" : "AWAITING_DETAILS",
            lastReason: saved || input.detailsAvailable ? null : "NOT_SUPPORTED",
          },
        });
        results.push({ externalId: card.externalId, outcome: saved ? "ALREADY_SAVED" : "QUEUED", opportunityId: saved, itemId: created.id });
      }
      return results;
    });
  }

  // When a site may next be contacted for details: after it stopped a pass
  // (a refusal, sign-in wall, challenge or rate limit), not before the wait
  // recorded then.
  async siteStoppedUntil(site: string, now: Date): Promise<Date | null> {
    const latest = await this.database.pageCaptureItem.findFirst({
      where: { site, lastReason: { in: friction }, nextAttemptAt: { gt: now } },
      orderBy: { nextAttemptAt: "desc" },
      select: { nextAttemptAt: true },
    });
    return latest?.nextAttemptAt ?? null;
  }

  // The next queued jobs of a site, oldest first, marked ACQUIRING. Only one
  // retrieval worker runs at a time (its lock), so no other claimant exists.
  async claimQueued(site: string, now: Date, limit: number): Promise<PageCaptureItemRecord[]> {
    const items = await this.database.pageCaptureItem.findMany({
      where: { site, status: "QUEUED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    if (!items.length) return [];
    await this.database.pageCaptureItem.updateMany({
      where: { id: { in: items.map((item) => item.id) }, status: "QUEUED" },
      data: { status: "ACQUIRING", lastAttemptAt: now },
    });
    return items.map((item) => ({ ...item, status: "ACQUIRING" as const, lastAttemptAt: now }));
  }

  // The queued sites with work due.
  async sitesWithQueued(now: Date): Promise<string[]> {
    const rows = await this.database.pageCaptureItem.findMany({
      where: { status: "QUEUED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      distinct: ["site"],
      select: { site: true },
    });
    return rows.map((row) => row.site);
  }

  // Items left ACQUIRING by an interrupted worker go back to the queue.
  async recoverInterrupted(): Promise<number> {
    const { count } = await this.database.pageCaptureItem.updateMany({ where: { status: "ACQUIRING" }, data: { status: "QUEUED" } });
    return count;
  }

  async markIngested(id: string, opportunityId: string, now: Date) {
    await this.database.pageCaptureItem.update({
      where: { id },
      data: { status: "INGESTED", opportunityId, lastReason: null, nextAttemptAt: null, attempts: { increment: 1 }, lastAttemptAt: now },
    });
  }

  // A failed attempt for one job. A terminal state ends automatic work;
  // QUEUED with a time retries it later.
  async markFailed(id: string, input: { status: "QUEUED" | "AWAITING_DETAILS" | "UNAVAILABLE"; reason: string; nextAttemptAt: Date | null; countAttempt: boolean }) {
    await this.database.pageCaptureItem.update({
      where: { id },
      data: {
        status: input.status,
        lastReason: input.reason,
        nextAttemptAt: input.nextAttemptAt,
        ...(input.countAttempt ? { attempts: { increment: 1 } } : {}),
      },
    });
  }

  // After the site stopped a pass, every queued job of the site waits too
  // (its claimed jobs were returned to the queue by the caller).
  async deferSite(site: string, until: Date, reason: string) {
    await this.database.pageCaptureItem.updateMany({
      where: { site, status: { in: ["QUEUED", "ACQUIRING"] } },
      data: { status: "QUEUED", nextAttemptAt: until, lastReason: reason },
    });
  }

  async markHandedOff(id: string, outcome: string, now: Date) {
    await this.database.pageCaptureItem.updateMany({
      where: { id, handedOffAt: null },
      data: { handoffOutcome: outcome, handedOffAt: now },
    });
  }

  async findById(id: string): Promise<PageCaptureItemRecord | null> {
    return this.database.pageCaptureItem.findUnique({ where: { id } });
  }

  // Alex's actions on the progress page.
  async retry(id: string): Promise<PageCaptureItemRecord | null> {
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { id, status: "AWAITING_DETAILS", opportunityId: null },
      data: { status: "QUEUED", attempts: 0, nextAttemptAt: null },
    });
    return count ? this.findById(id) : null;
  }

  async dismiss(id: string): Promise<PageCaptureItemRecord | null> {
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { id, status: { in: ["QUEUED", "AWAITING_DETAILS", "UNAVAILABLE"] } },
      data: { status: "DISMISSED" },
    });
    return count ? this.findById(id) : null;
  }

  async restore(id: string): Promise<PageCaptureItemRecord | null> {
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { id, status: "DISMISSED" },
      data: { status: "AWAITING_DETAILS", lastReason: "NOT_INGESTED", attempts: 0, nextAttemptAt: null },
    });
    return count ? this.findById(id) : null;
  }

  async statusCounts(): Promise<Record<string, number>> {
    const rows = await this.database.pageCaptureItem.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  // The progress list, newest sighting first, with each item's resolved
  // opportunity and that opportunity's current triage and evaluation state,
  // read as stored (nothing is decided here).
  async list(input: { statuses: PageCaptureItemStatusValue[] | null; site: string | null; page: number; pageSize: number }): Promise<{ rows: PageCaptureListRow[]; total: number }> {
    const where = Prisma.sql`WHERE TRUE
      ${input.statuses ? Prisma.sql`AND i."status"::text IN (${Prisma.join(input.statuses)})` : Prisma.empty}
      ${input.site ? Prisma.sql`AND i."site" = ${input.site}` : Prisma.empty}`;
    const [rows, total] = await Promise.all([
      this.database.$queryRaw<PageCaptureListRow[]>(Prisma.sql`
        WITH items AS (
          SELECT i.*, i."status"::text AS "statusText",
            COALESCE(i."opportunityId", (
              SELECT sr."opportunityId" FROM "SourceRecord" sr
              WHERE sr."opportunityId" IS NOT NULL
                AND ((sr."source" = 'browser-extension' AND sr."externalId" = i."externalId")
                  OR (i."site" = 'linkedin' AND i."siteJobId" IS NOT NULL AND sr."source" = 'linkedin' AND sr."externalId" = i."siteJobId"))
              ORDER BY sr."createdAt" ASC, sr."id" ASC LIMIT 1)) AS "resolvedOpportunityId"
          FROM "PageCaptureItem" i ${where}
          ORDER BY i."lastSeenAt" DESC, i."id" DESC
          LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
        )
        SELECT items."id", items."site", items."host", items."externalId", items."sourceUrl", items."siteJobId", items."title",
          items."company", items."location", items."postedText", items."resultsPageUrl", items."firstSeenAt", items."lastSeenAt",
          items."sightings", items."lastBatchId", items."pairingId", items."statusText" AS "status", items."attempts",
          items."lastAttemptAt", items."nextAttemptAt", items."lastReason", items."opportunityId", items."handoffOutcome",
          items."handedOffAt", items."resolvedOpportunityId",
          o."title" AS "opportunityTitle",
          t."outcome"::text AS "triageOutcome", t."manualDecision"::text AS "triageManualDecision",
          e."status"::text AS "evaluationStatus", r."decision"::text AS "recommendation"
        FROM items
        LEFT JOIN "Opportunity" o ON o."id" = items."resolvedOpportunityId"
        LEFT JOIN "PreEvaluatorTriage" t ON t."opportunityId" = items."resolvedOpportunityId"
        LEFT JOIN LATERAL (
          SELECT ev."id", ev."status" FROM "Evaluation" ev WHERE ev."opportunityId" = items."resolvedOpportunityId"
          ORDER BY ev."createdAt" DESC, ev."id" DESC LIMIT 1) e ON TRUE
        LEFT JOIN "Recommendation" r ON r."evaluationId" = e."id"
        ORDER BY items."lastSeenAt" DESC, items."id" DESC`),
      this.database.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*) AS count FROM "PageCaptureItem" i ${where}`),
    ]);
    return { rows, total: Number(total[0]?.count ?? 0) };
  }
}
