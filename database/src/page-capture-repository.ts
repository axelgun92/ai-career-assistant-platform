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

export interface StagedResult {
  externalId: string;
  outcome: StageOutcome;
  opportunityId: string | null;
  itemId: string;
  // The item's status after staging.
  status: PageCaptureItemStatusValue;
}

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

export interface PageCaptureSessionRow {
  id: string;
  site: string;
  pageUrl: string;
  pageTitle: string | null;
  receivedAt: Date;
  counts: unknown;
  jobs: number;
  pending: number;
  added: number;
  awaiting: number;
  unavailable: number;
  dismissed: number;
}

// One row of Captured Jobs: a job saved from a results page (its staging
// item, whatever its state) or a job saved alone with the single-job capture
// (its opportunity, once, at its latest capture). A job saved both ways is
// one batch row. Nothing here creates or copies a job record.
export interface CapturedJobRow {
  method: "batch" | "single";
  id: string;
  site: string;
  host: string | null;
  title: string;
  company: string | null;
  location: string | null;
  postedText: string | null;
  sourceUrl: string | null;
  firstSeenAt: Date;
  capturedAt: Date;
  status: string;
  lastReason: string | null;
  handoffOutcome: string | null;
  resolvedOpportunityId: string | null;
  opportunityTitle: string | null;
  triageOutcome: string | null;
  triageManualDecision: string | null;
  evaluationStatus: string | null;
  recommendation: string | null;
  // A results-page job that was also saved alone with the single-job capture
  // (before this results-page capture, or marked as a single-job save).
  alsoSingle: boolean;
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
    // otherwise AWAITING_DETAILS with awaitingReason (NOT_SUPPORTED unless
    // stated).
    detailsAvailable: boolean;
    awaitingReason?: string;
    // Background-tab reading only: the new save is the user's explicit
    // request to read again, so a job of this batch that is awaiting details
    // (and was never added) is queued again. Never set for the worker's
    // sites, whose waiting jobs keep their own retry rules.
    requeueAwaiting?: boolean;
    cards: StagedCardInput[];
    // Capture history: the save, recorded once per batchId with the items it
    // covered (in page order), in the same transaction.
    session?: { pageTitle: string | null; counts: Record<string, number> };
  }): Promise<StagedResult[]> {
    return this.database.$transaction(async (transaction) => {
      const results: StagedResult[] = [];
      for (const card of input.cards) {
        const saved = await this.savedOpportunity(transaction, card, input.site);
        const existing = await transaction.pageCaptureItem.findUnique({ where: { externalId: card.externalId } });
        if (existing) {
          const repeat = existing.lastBatchId === input.batchId;
          const requeue =
            !saved && input.requeueAwaiting === true && input.detailsAvailable && existing.status === "AWAITING_DETAILS" && !existing.opportunityId;
          const status =
            saved && existing.status !== "INGESTED" && existing.status !== "DISMISSED"
              ? "ALREADY_SAVED"
              : requeue
                ? "QUEUED"
                : existing.status;
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
                  ...(requeue ? { attempts: 0, lastReason: null, nextAttemptAt: null, lastAttemptAt: null } : {}),
                },
              });
          // A job already in the app (added by an earlier capture, from a
          // results page or alone) is reported as already saved; a job an
          // earlier capture is still reading is reported as in progress.
          const opportunityId = updated.opportunityId ?? saved;
          results.push({
            externalId: card.externalId,
            outcome: opportunityId ? "ALREADY_SAVED" : !repeat && requeue ? "QUEUED" : "SEEN_AGAIN",
            opportunityId,
            itemId: updated.id,
            status: updated.status,
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
            lastReason: saved || input.detailsAvailable ? null : (input.awaitingReason ?? "NOT_SUPPORTED"),
          },
        });
        results.push({ externalId: card.externalId, outcome: saved ? "ALREADY_SAVED" : "QUEUED", opportunityId: saved, itemId: created.id, status: created.status });
      }
      if (input.session) {
        await transaction.pageCaptureSession.upsert({
          where: { id: input.batchId },
          create: {
            id: input.batchId,
            site: input.site,
            pageUrl: input.resultsPageUrl,
            pageTitle: input.session.pageTitle,
            pairingId: input.pairingId,
            receivedAt: input.receivedAt,
            itemIds: results.map((result) => result.itemId),
            // What this save found, as of the save: the jobs already saved by
            // an earlier capture and those an earlier capture was still
            // reading. The jobs' current states are read live.
            counts: {
              ...input.session.counts,
              alreadySaved: results.filter((result) => result.outcome === "ALREADY_SAVED").length,
              seenAgain: results.filter((result) => result.outcome === "SEEN_AGAIN").length,
              alreadySavedItemIds: results.filter((result) => result.outcome === "ALREADY_SAVED").map((result) => result.itemId),
            },
          },
          // A repeated batch is the same save.
          update: {},
        });
      }
      return results;
    });
  }

  // Captured Jobs: batch and single-job captures in one list, newest capture
  // first (a session's own jobs in page order).
  async capturedJobs(input: {
    method: "all" | "batch" | "single";
    statuses: PageCaptureItemStatusValue[] | null;
    site: string | null;
    itemIds: string[] | null;
    page: number;
    pageSize: number;
  }): Promise<{ rows: CapturedJobRow[]; total: number }> {
    const itemFilter = input.itemIds ? Prisma.sql`AND i."id" = ANY(${input.itemIds}::uuid[])` : Prisma.empty;
    const includeSingle = input.method !== "batch" && !input.itemIds;
    const includeBatch = input.method !== "single";
    const jobs = Prisma.sql`
      SELECT * FROM (
        SELECT 'batch'::text AS "method", i."id", i."site", i."host", i."title", i."company", i."location", i."postedText",
              i."sourceUrl", i."firstSeenAt", i."lastSeenAt" AS "capturedAt", i."status"::text AS "status", i."lastReason", i."handoffOutcome",
              COALESCE(i."opportunityId", (
                SELECT sr."opportunityId" FROM "SourceRecord" sr
                WHERE sr."opportunityId" IS NOT NULL
                  AND ((sr."source" = 'browser-extension' AND sr."externalId" = i."externalId")
                    OR (i."site" = 'linkedin' AND i."siteJobId" IS NOT NULL AND sr."source" = 'linkedin' AND sr."externalId" = i."siteJobId"))
                ORDER BY sr."createdAt" ASC, sr."id" ASC LIMIT 1)) AS "resolvedOpportunityId",
              EXISTS (
                SELECT 1 FROM "SourceRecord" sr
                WHERE sr."source" = 'browser-extension' AND sr."externalId" = i."externalId"
                  AND (sr."sourceMetadata"->'capture'->>'method' = 'single'
                    OR (sr."sourceMetadata"->'capture'->>'method' IS NULL AND sr."createdAt" < i."firstSeenAt"))) AS "alsoSingle",
              ${input.itemIds ? Prisma.sql`array_position(${input.itemIds}::uuid[], i."id")` : Prisma.sql`NULL::int`} AS "position"
            FROM "PageCaptureItem" i WHERE TRUE ${itemFilter} ${includeBatch ? Prisma.empty : Prisma.sql`AND FALSE`}
        ${includeSingle
          ? Prisma.sql`UNION ALL
            SELECT * FROM (SELECT DISTINCT ON (sr."opportunityId") 'single'::text, sr."id", COALESCE(sr."sourceMetadata"->'capture'->>'site', ''),
              sr."sourceMetadata"->'capture'->>'host', COALESCE(sr."rawTitle", o."title", 'Untitled job'), sr."rawCompany", sr."rawLocation", NULL::text,
              sr."sourceUrl", sr."createdAt", sr."createdAt", 'INGESTED', NULL::text, NULL::text, sr."opportunityId", FALSE, NULL::int
            FROM "SourceRecord" sr JOIN "Opportunity" o ON o."id" = sr."opportunityId"
            WHERE sr."source" = 'browser-extension'
              AND NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."externalId" = sr."externalId")
            ORDER BY sr."opportunityId", sr."createdAt" DESC, sr."id" DESC) singles`
          : Prisma.empty}
      ) jobs
      WHERE TRUE
        ${input.statuses ? Prisma.sql`AND jobs."status" IN (${Prisma.join(input.statuses)})` : Prisma.empty}
        ${input.site ? Prisma.sql`AND jobs."site" = ${input.site}` : Prisma.empty}`;
    const [rows, total] = await Promise.all([
      this.database.$queryRaw<CapturedJobRow[]>(Prisma.sql`
        WITH page AS (
          SELECT * FROM (${jobs}) filtered
          ORDER BY ${input.itemIds ? Prisma.sql`filtered."position" ASC,` : Prisma.empty} filtered."capturedAt" DESC, filtered."id" DESC
          LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
        )
        SELECT page."method", page."id", page."site", page."host", page."title", page."company", page."location", page."postedText",
          page."sourceUrl", page."firstSeenAt", page."capturedAt", page."status", page."lastReason", page."handoffOutcome",
          page."resolvedOpportunityId", page."alsoSingle", o."title" AS "opportunityTitle",
          t."outcome"::text AS "triageOutcome", t."manualDecision"::text AS "triageManualDecision",
          e."status"::text AS "evaluationStatus", r."decision"::text AS "recommendation"
        FROM page
        LEFT JOIN "Opportunity" o ON o."id" = page."resolvedOpportunityId"
        LEFT JOIN "PreEvaluatorTriage" t ON t."opportunityId" = page."resolvedOpportunityId"
        LEFT JOIN LATERAL (
          SELECT ev."id", ev."status" FROM "Evaluation" ev WHERE ev."opportunityId" = page."resolvedOpportunityId"
          ORDER BY ev."createdAt" DESC, ev."id" DESC LIMIT 1) e ON TRUE
        LEFT JOIN "Recommendation" r ON r."evaluationId" = e."id"
        ORDER BY ${input.itemIds ? Prisma.sql`page."position" ASC,` : Prisma.empty} page."capturedAt" DESC, page."id" DESC`),
      this.database.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*) AS count FROM (${jobs}) counted`),
    ]);
    return { rows, total: Number(total[0]?.count ?? 0) };
  }

  // Capture history (newest first), each save with its jobs' current state.
  async listSessions(input: { site: string | null; page: number; pageSize: number; id?: string }): Promise<{ rows: PageCaptureSessionRow[]; total: number }> {
    const where = Prisma.sql`WHERE TRUE
      ${input.site ? Prisma.sql`AND s."site" = ${input.site}` : Prisma.empty}
      ${input.id ? Prisma.sql`AND s."id" = ${input.id}::uuid` : Prisma.empty}`;
    const [rows, total] = await Promise.all([
      this.database.$queryRaw<PageCaptureSessionRow[]>(Prisma.sql`
        SELECT s."id", s."site", s."pageUrl", s."pageTitle", s."receivedAt", s."counts",
          COALESCE(cardinality(s."itemIds"), 0)::int AS "jobs",
          COUNT(i."id") FILTER (WHERE i."status" IN ('QUEUED', 'ACQUIRING'))::int AS "pending",
          COUNT(i."id") FILTER (WHERE i."status" IN ('INGESTED', 'ALREADY_SAVED'))::int AS "added",
          COUNT(i."id") FILTER (WHERE i."status" = 'AWAITING_DETAILS')::int AS "awaiting",
          COUNT(i."id") FILTER (WHERE i."status" = 'UNAVAILABLE')::int AS "unavailable",
          COUNT(i."id") FILTER (WHERE i."status" = 'DISMISSED')::int AS "dismissed"
        FROM "PageCaptureSession" s
        LEFT JOIN "PageCaptureItem" i ON i."id" = ANY(s."itemIds")
        ${where}
        GROUP BY s."id"
        ORDER BY s."receivedAt" DESC, s."id" DESC
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`),
      this.database.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*) AS count FROM "PageCaptureSession" s ${where}`),
    ]);
    return { rows, total: Number(total[0]?.count ?? 0) };
  }

  async findSession(id: string): Promise<{ id: string; site: string; pageUrl: string; pageTitle: string | null; receivedAt: Date; itemIds: string[]; counts: unknown } | null> {
    return this.database.pageCaptureSession.findUnique({ where: { id } });
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

  // Background-tab reading (extension-tabs). The extension reads a job's page
  // only after the server confirms the job is still queued (not dismissed,
  // not stopped, not already added); the start is recorded. Jobs read this
  // way are never ACQUIRING, so the worker's recovery never touches them.
  async startTabItem(id: string, site: string, now: Date): Promise<PageCaptureItemRecord | null> {
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { id, site, status: "QUEUED" },
      data: { lastAttemptAt: now },
    });
    return count ? this.findById(id) : null;
  }

  // The end of one job's reading other than its ingestion; only a job still
  // queued changes, so a repeated report changes nothing.
  async settleTabItem(
    id: string,
    input: { status: "AWAITING_DETAILS" | "UNAVAILABLE"; reason: string; nextAttemptAt: Date | null },
  ): Promise<boolean> {
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { id, status: "QUEUED" },
      data: { status: input.status, lastReason: input.reason, nextAttemptAt: input.nextAttemptAt, attempts: { increment: 1 } },
    });
    return count > 0;
  }

  // The rest of a stopped batch: the named jobs of the site that are still
  // queued wait for the user's next save. Nothing resumes them.
  async stopTabItems(site: string, ids: readonly string[], reason: string): Promise<number> {
    if (!ids.length) return 0;
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { site, id: { in: [...ids] }, status: "QUEUED" },
      data: { status: "AWAITING_DETAILS", lastReason: reason },
    });
    return count;
  }

  // An access restriction: every queued job of the site stops, and the site
  // is not contacted until `until` (siteStoppedUntil reads it). The jobs stay
  // Awaiting details; the end of the wait does not resume them.
  async stopTabSite(site: string, until: Date, reason: string): Promise<number> {
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { site, status: "QUEUED" },
      data: { status: "AWAITING_DETAILS", lastReason: reason, nextAttemptAt: until },
    });
    return count;
  }

  // Jobs of background-tab sites still queued long after their save and
  // their last start were not being read any more (the browser closed or
  // the extension stopped): they become Awaiting details, Interrupted.
  async expireTabItems(sites: readonly string[], cutoff: Date): Promise<number> {
    if (!sites.length) return 0;
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: {
        site: { in: [...sites] },
        status: "QUEUED",
        lastSeenAt: { lt: cutoff },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: cutoff } }],
      },
      data: { status: "AWAITING_DETAILS", lastReason: "INTERRUPTED" },
    });
    return count;
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
