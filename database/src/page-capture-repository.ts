import { pageCaptureIncompleteRefreshes, pageCaptureRefreshReason, type PageCaptureRefreshPolicy } from "@ai-career/core";
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

// REFRESHING: a job already saved, read again by this save (selective
// re-observation, November 5, 2026).
export type StageOutcome = "QUEUED" | "SEEN_AGAIN" | "ALREADY_SAVED" | "REFRESHING";

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
  // When the job's page was last opened to be read (null for a single-job
  // save): dates a refresh outcome such as "no longer available".
  lastAttemptAt: Date | null;
  resolvedOpportunityId: string | null;
  opportunityTitle: string | null;
  // The saved opportunity's own company and location (November 5, 2026: a
  // row shows them once the job is saved, its card's values before).
  opportunityCompany: string | null;
  opportunityLocation: string | null;
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
  opportunityCompany: string | null;
  opportunityLocation: string | null;
  triageOutcome: string | null;
  triageManualDecision: string | null;
  evaluationStatus: string | null;
  recommendation: string | null;
}

const friction = ["ACCESS_STOPPED", "RATE_LIMITED"];

type Transaction = Prisma.TransactionClient;

// The latest browser-extension read of a saved version: the read that stored
// it (its capture time, reader revision and completeness), or a later read
// that found it unchanged ("lastRead"). Its time is the read's own capture
// time, never the card's first sighting (a batch record's lastObservedAt).
export function latestExtensionRead(
  sourceMetadata: unknown,
  lastObservedAt: Date,
): { readerRevision: number; readQuality: "COMPLETE" | "PARTIAL" | null; lastReadAt: Date } {
  const metadata = (sourceMetadata ?? {}) as Record<string, unknown>;
  const capture = (metadata.capture ?? {}) as Record<string, unknown>;
  const lastRead = (metadata.lastRead ?? null) as Record<string, unknown> | null;
  const time = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null);
  const quality = (value: unknown): "COMPLETE" | "PARTIAL" | null => (value === "COMPLETE" || value === "PARTIAL" ? value : null);
  const stored = { readerRevision: typeof capture.readerRevision === "number" ? capture.readerRevision : 0, readQuality: quality(capture.readQuality), lastReadAt: time(capture.capturedAt) ?? lastObservedAt };
  const again = lastRead ? time(lastRead.at) : null;
  if (!lastRead || !again || again < stored.lastReadAt) return stored;
  return {
    readerRevision: Math.max(stored.readerRevision, typeof lastRead.readerRevision === "number" ? lastRead.readerRevision : 0),
    readQuality: quality(lastRead.readQuality),
    lastReadAt: again,
  };
}

export class PrismaPageCaptureRepository {
  private readonly database = getDatabaseClient();

  // The opportunity a listing identity already belongs to: an earlier
  // extension capture of the same job page, or (LinkedIn) the same job
  // retrieved by the browser-assisted LinkedIn adapter.
  private async savedOpportunity(transaction: Transaction | ReturnType<typeof getDatabaseClient>, card: { externalId: string; siteJobId: string | null }, site: string) {
    return (await this.savedOpportunities(transaction, [card], site)).get(card.externalId) ?? null;
  }

  // The opportunity each card's job already has (the first saved record of
  // it), for a whole batch in one query.
  private async savedOpportunities(
    transaction: Transaction | ReturnType<typeof getDatabaseClient>,
    cards: Array<{ externalId: string; siteJobId: string | null }>,
    site: string,
  ): Promise<Map<string, string>> {
    if (!cards.length) return new Map();
    const siteJobIds = site === "linkedin" ? cards.map((card) => card.siteJobId).filter((id): id is string => Boolean(id)) : [];
    const records = await transaction.sourceRecord.findMany({
      where: {
        opportunityId: { not: null },
        OR: [
          { source: "browser-extension", externalId: { in: cards.map((card) => card.externalId) } },
          ...(siteJobIds.length ? [{ source: "linkedin", externalId: { in: siteJobIds } }] : []),
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { opportunityId: true, source: true, externalId: true },
    });
    const saved = new Map<string, string>();
    for (const card of cards) {
      const record = records.find(
        (row) =>
          (row.source === "browser-extension" && row.externalId === card.externalId) ||
          (site === "linkedin" && card.siteJobId !== null && row.source === "linkedin" && row.externalId === card.siteJobId),
      );
      if (record?.opportunityId) saved.set(card.externalId, record.opportunityId);
    }
    return saved;
  }

  // The refresh marker ("REFRESH:<n>") for each card whose saved job is due
  // to be read again: its latest read from this site (a browser-extension
  // record of the same listing) and the saved opportunity decide
  // (pageCaptureRefreshReason). A job saved only from another source, one
  // being read, dismissed or awaiting details is never refreshed.
  private async refreshReasons(
    transaction: Transaction,
    cards: Array<{ externalId: string }>,
    policy: PageCaptureRefreshPolicy,
    now: Date,
    existing: Map<string, { status: PageCaptureItemStatusValue; lastReason: string | null }>,
  ): Promise<Map<string, string>> {
    const records = await transaction.sourceRecord.findMany({
      where: { source: "browser-extension", externalId: { in: cards.map((card) => card.externalId) }, opportunityId: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        externalId: true,
        lastObservedAt: true,
        sourceMetadata: true,
        opportunity: { select: { applicationUrl: true, jobDescription: true } },
      },
    });
    const reasons = new Map<string, string>();
    for (const card of cards) {
      const item = existing.get(card.externalId);
      if (item && item.status !== "INGESTED" && item.status !== "ALREADY_SAVED") continue;
      const latest = records.find((record) => record.externalId === card.externalId);
      if (!latest) continue;
      const incompleteRefreshes = pageCaptureIncompleteRefreshes(item?.lastReason);
      const reason = pageCaptureRefreshReason({
        policy,
        latestRead: latestExtensionRead(latest.sourceMetadata, latest.lastObservedAt),
        hasApplicationRoute: Boolean(latest.opportunity?.applicationUrl),
        hasDescription: Boolean(latest.opportunity?.jobDescription),
        incompleteRefreshes,
        now,
      });
      if (reason) reasons.set(card.externalId, `REFRESH:${reason === "INCOMPLETE" ? incompleteRefreshes : 0}`);
    }
    return reasons;
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
    // Selective re-observation: a job already saved is queued to be read
    // again only when the site's policy says so (pageCaptureRefreshReason),
    // never while the site is stopped, and only when details are read
    // automatically.
    refresh?: { policy: PageCaptureRefreshPolicy; siteStopped: boolean };
    // Capture history: the save, recorded once per batchId with the items it
    // covered (in page order), in the same transaction.
    session?: { pageTitle: string | null; counts: Record<string, number> };
  }): Promise<StagedResult[]> {
    return this.database.$transaction(async (transaction) => {
      const results: StagedResult[] = [];
      // The batch's lookups in two queries, not three per card (November 5,
      // 2026: 25 cards ran ~75 queries in one transaction).
      const savedByExternalId = await this.savedOpportunities(transaction, input.cards, input.site);
      const existingItems = await transaction.pageCaptureItem.findMany({ where: { externalId: { in: input.cards.map((card) => card.externalId) } } });
      const existingByExternalId = new Map(existingItems.map((item) => [item.externalId, item]));
      const refreshable = input.refresh && !input.refresh.siteStopped && input.detailsAvailable ? await this.refreshReasons(transaction, input.cards, input.refresh.policy, input.receivedAt, existingByExternalId) : new Map<string, string>();
      for (const card of input.cards) {
        const saved = savedByExternalId.get(card.externalId) ?? null;
        const existing = existingByExternalId.get(card.externalId) ?? null;
        // A saved job read again by this save: queued with its refresh
        // marker, keeping its opportunity; never handed off again.
        const refresh = saved && (!existing || existing.lastBatchId !== input.batchId) ? refreshable.get(card.externalId) : undefined;
        if (refresh) {
          const data = {
            title: card.title,
            company: card.company,
            location: card.location,
            postedText: card.postedText,
            sourceUrl: card.sourceUrl,
            siteJobId: card.siteJobId,
            resultsPageUrl: input.resultsPageUrl,
            lastSeenAt: input.receivedAt,
            lastBatchId: input.batchId,
            status: "QUEUED" as const,
            attempts: 0,
            nextAttemptAt: null,
            lastReason: refresh,
          };
          const item = existing
            ? await transaction.pageCaptureItem.update({ where: { id: existing.id }, data: { ...data, sightings: { increment: 1 } } })
            : await transaction.pageCaptureItem.create({
                data: { ...data, site: input.site, host: input.host, externalId: card.externalId, firstSeenAt: input.receivedAt, pairingId: input.pairingId, opportunityId: saved },
              });
          results.push({ externalId: card.externalId, outcome: "REFRESHING", opportunityId: saved, itemId: item.id, status: item.status });
          continue;
        }
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
              refreshing: results.filter((result) => result.outcome === "REFRESHING").length,
              alreadySavedItemIds: results.filter((result) => result.outcome === "ALREADY_SAVED").map((result) => result.itemId),
            },
          },
          // A repeated batch is the same save.
          update: {},
        });
      }
      return results;
    }, { maxWait: 15_000, timeout: 30_000 });
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
              i."sourceUrl", i."firstSeenAt", i."lastSeenAt" AS "capturedAt", i."status"::text AS "status", i."lastReason", i."handoffOutcome", i."lastAttemptAt",
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
              sr."sourceUrl", sr."createdAt", sr."createdAt", 'INGESTED', NULL::text, NULL::text, NULL::timestamptz, sr."opportunityId", FALSE, NULL::int
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
          page."sourceUrl", page."firstSeenAt", page."capturedAt", page."status", page."lastReason", page."handoffOutcome", page."lastAttemptAt",
          page."resolvedOpportunityId", page."alsoSingle", o."title" AS "opportunityTitle",
          oc."name" AS "opportunityCompany", o."location" AS "opportunityLocation",
          t."outcome"::text AS "triageOutcome", t."manualDecision"::text AS "triageManualDecision",
          e."status"::text AS "evaluationStatus", r."decision"::text AS "recommendation"
        FROM page
        LEFT JOIN "Opportunity" o ON o."id" = page."resolvedOpportunityId"
        LEFT JOIN "Company" oc ON oc."id" = o."companyId"
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
      where: { site, OR: [{ lastReason: { in: friction } }, { lastReason: { startsWith: "REFRESH_DEFERRED:" } }], nextAttemptAt: { gt: now } },
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

  // A refresh that ends without a new read (unavailable, stopped, failed,
  // interrupted) restores the saved job as it was: INGESTED (or ALREADY_SAVED
  // when it was saved elsewhere), its opportunity, fields and provenance
  // untouched, with the outcome in lastReason (November 5, 2026). Runs before
  // each ending below, so those only ever change jobs that are not refreshes.
  // A refresh deferred by a site restriction keeps the restriction's end in
  // nextAttemptAt, so the site stays stopped even when every job it stopped
  // was a refresh (siteStoppedUntil reads it; November 6, 2026).
  private async restoreRefreshes(
    where: Prisma.Sql,
    outcome: "REFRESH_UNAVAILABLE" | "REFRESH_DEFERRED" | "REFRESH_FAILED" | "REFRESH_STOPPED",
    stoppedUntil: Date | null = null,
  ): Promise<number> {
    return this.database.$executeRaw`
      UPDATE "PageCaptureItem"
      SET "status" = (CASE WHEN "opportunityId" IS NOT NULL THEN 'INGESTED' ELSE 'ALREADY_SAVED' END)::"PageCaptureItemStatus",
          "lastReason" = ${outcome}::text || ':' || COALESCE(substring("lastReason" from '^REFRESH:([0-9]+)$'), '0'),
          "nextAttemptAt" = ${outcome === "REFRESH_DEFERRED" ? stoppedUntil : null}::timestamptz,
          "updatedAt" = now()
      WHERE "lastReason" ~ '^REFRESH:[0-9]+$' AND ${where}
    `;
  }

  // Claimed jobs the pass did not read (it ended early) go back to the queue,
  // uncounted. Only jobs still ACQUIRING change.
  async releaseClaimed(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const { count } = await this.database.pageCaptureItem.updateMany({ where: { id: { in: ids }, status: "ACQUIRING" }, data: { status: "QUEUED" } });
    return count;
  }

  // A job back to the queue with nothing counted (November 6, 2026): a
  // provisional database failure (DB_PENDING), a busy capture lock
  // (CAPTURE_BUSY), or a job already saved whose staged item could not be
  // marked (SAVED_UNMARKED). A refresh keeps its refresh state instead, so
  // the saved job is read again as a refresh and never handed off again.
  async requeueUncounted(id: string, reason: "DB_PENDING" | "CAPTURE_BUSY" | "SAVED_UNMARKED"): Promise<boolean> {
    const count = await this.database.$executeRaw`
      UPDATE "PageCaptureItem"
      SET "status" = 'QUEUED'::"PageCaptureItemStatus",
          "nextAttemptAt" = NULL,
          "lastReason" = CASE WHEN "lastReason" ~ '^REFRESH:[0-9]+$' THEN "lastReason" ELSE ${reason}::text END,
          "updatedAt" = now()
      WHERE "id" = ${id}::uuid AND "status" IN ('ACQUIRING', 'QUEUED')
    `;
    return count > 0;
  }

  // A provisional database failure (lastReason DB_PENDING, uncounted) proven
  // to be this job's own: counted now, once. Only a job still QUEUED and
  // DB_PENDING changes, so a repeated finalization changes nothing. The
  // third counted attempt ends automatic work (as any failed attempt).
  // A refresh's proven failure ends that refresh: the saved job is restored
  // untouched (REFRESH_FAILED), once.
  async finalizeProvisionalFailure(id: string, input: { now: Date; retryAfterMs: number; maxAttempts: number }): Promise<boolean> {
    if (await this.restoreRefreshes(Prisma.sql`"id" = ${id}::uuid AND "status" = 'QUEUED'`, "REFRESH_FAILED")) return true;
    const retryAt = new Date(input.now.getTime() + input.retryAfterMs);
    const count = await this.database.$executeRaw`
      UPDATE "PageCaptureItem"
      SET "attempts" = "attempts" + 1,
          "status" = CASE WHEN "attempts" + 1 >= ${input.maxAttempts} THEN 'AWAITING_DETAILS'::"PageCaptureItemStatus" ELSE 'QUEUED'::"PageCaptureItemStatus" END,
          "lastReason" = CASE WHEN "attempts" + 1 >= ${input.maxAttempts} THEN 'FAILED_REPEATEDLY' ELSE 'INGEST_DB_ERROR' END,
          "nextAttemptAt" = CASE WHEN "attempts" + 1 >= ${input.maxAttempts} THEN NULL ELSE ${retryAt}::timestamptz END,
          "updatedAt" = now()
      WHERE "id" = ${id}::uuid AND "status" = 'QUEUED' AND "lastReason" = 'DB_PENDING'
    `;
    return count > 0;
  }

  // A refresh read records how it went ("REFRESHED:<outcome>:<n>", n the
  // incomplete refreshes in a row: one more when this read was incomplete,
  // else none).
  async markIngested(id: string, opportunityId: string, now: Date, refresh?: { outcome: string; incomplete: boolean }) {
    const refreshed = await this.database.$executeRaw`
      UPDATE "PageCaptureItem"
      SET "status" = 'INGESTED'::"PageCaptureItemStatus",
          "opportunityId" = ${opportunityId}::uuid,
          "lastReason" = 'REFRESHED:' || ${refresh?.outcome ?? "READ"}::text || ':' ||
            CASE WHEN ${refresh?.incomplete ?? false}::boolean THEN (COALESCE(substring("lastReason" from '^REFRESH:([0-9]+)$'), '0')::int + 1)::text ELSE '0' END,
          "nextAttemptAt" = NULL,
          "lastAttemptAt" = ${now}::timestamptz,
          "updatedAt" = now()
      WHERE "id" = ${id}::uuid AND "lastReason" ~ '^REFRESH:[0-9]+$'
    `;
    if (refreshed) return;
    await this.database.pageCaptureItem.update({
      where: { id },
      data: { status: "INGESTED", opportunityId, lastReason: null, nextAttemptAt: null, attempts: { increment: 1 }, lastAttemptAt: now },
    });
  }

  // A failed attempt for one job. A terminal state ends automatic work;
  // QUEUED with a time retries it later.
  async markFailed(id: string, input: { status: "QUEUED" | "AWAITING_DETAILS" | "UNAVAILABLE"; reason: string; nextAttemptAt: Date | null; countAttempt: boolean }) {
    if (await this.restoreRefreshes(Prisma.sql`"id" = ${id}::uuid`, input.status === "UNAVAILABLE" ? "REFRESH_UNAVAILABLE" : "REFRESH_FAILED")) return;
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
    if (friction.includes(reason)) {
      // A site restriction: saved jobs being read again are restored as
      // they were (REFRESH_DEFERRED), carrying the stop.
      await this.restoreRefreshes(Prisma.sql`"site" = ${site} AND "status" IN ('QUEUED', 'ACQUIRING')`, "REFRESH_DEFERRED", until);
    } else {
      // Any other deferral (a failed load) is no restriction: refreshes wait
      // with the rest, still refreshes (November 6, 2026).
      await this.database.$executeRaw`
        UPDATE "PageCaptureItem" SET "status" = 'QUEUED'::"PageCaptureItemStatus", "nextAttemptAt" = ${until}::timestamptz, "updatedAt" = now()
        WHERE "site" = ${site} AND "status" IN ('QUEUED', 'ACQUIRING') AND "lastReason" ~ '^REFRESH:[0-9]+$'`;
    }
    await this.database.$executeRaw`
      UPDATE "PageCaptureItem" SET "status" = 'QUEUED'::"PageCaptureItemStatus", "nextAttemptAt" = ${until}::timestamptz, "lastReason" = ${reason}, "updatedAt" = now()
      WHERE "site" = ${site} AND "status" IN ('QUEUED', 'ACQUIRING') AND ("lastReason" IS NULL OR "lastReason" !~ '^REFRESH:[0-9]+$')`;
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
    const restored = await this.restoreRefreshes(
      Prisma.sql`"id" = ${id}::uuid AND "status" = 'QUEUED'`,
      input.status === "UNAVAILABLE" ? "REFRESH_UNAVAILABLE" : /^(?:ACCESS_|RATE_|SIGN|CHALLENGE)/.test(input.reason) ? "REFRESH_DEFERRED" : "REFRESH_FAILED",
      friction.includes(input.reason) ? input.nextAttemptAt : null,
    );
    if (restored) return true;
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
    const restored = await this.restoreRefreshes(Prisma.sql`"site" = ${site} AND "id" = ANY(${[...ids]}::uuid[]) AND "status" = 'QUEUED'`, "REFRESH_STOPPED");
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { site, id: { in: [...ids] }, status: "QUEUED" },
      data: { status: "AWAITING_DETAILS", lastReason: reason },
    });
    return count + restored;
  }

  // An access restriction: every queued job of the site stops, and the site
  // is not contacted until `until` (siteStoppedUntil reads it). The jobs stay
  // Awaiting details; the end of the wait does not resume them.
  async stopTabSite(site: string, until: Date, reason: string): Promise<number> {
    const restored = await this.restoreRefreshes(Prisma.sql`"site" = ${site} AND "status" = 'QUEUED'`, "REFRESH_DEFERRED", friction.includes(reason) ? until : null);
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: { site, status: "QUEUED" },
      data: { status: "AWAITING_DETAILS", lastReason: reason, nextAttemptAt: until },
    });
    return count + restored;
  }

  // Jobs of background-tab sites still queued long after their save and
  // their last start were not being read any more (the browser closed or
  // the extension stopped): they become Awaiting details, Interrupted.
  async expireTabItems(sites: readonly string[], cutoff: Date): Promise<number> {
    if (!sites.length) return 0;
    const restored = await this.restoreRefreshes(
      Prisma.sql`"site" = ANY(${[...sites]}::text[]) AND "status" = 'QUEUED' AND "lastSeenAt" < ${cutoff}::timestamptz AND ("lastAttemptAt" IS NULL OR "lastAttemptAt" < ${cutoff}::timestamptz)`,
      "REFRESH_FAILED",
    );
    const { count } = await this.database.pageCaptureItem.updateMany({
      where: {
        site: { in: [...sites] },
        status: "QUEUED",
        lastSeenAt: { lt: cutoff },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: cutoff } }],
      },
      data: { status: "AWAITING_DETAILS", lastReason: "INTERRUPTED" },
    });
    return count + restored;
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
          o."title" AS "opportunityTitle", oc."name" AS "opportunityCompany", o."location" AS "opportunityLocation",
          t."outcome"::text AS "triageOutcome", t."manualDecision"::text AS "triageManualDecision",
          e."status"::text AS "evaluationStatus", r."decision"::text AS "recommendation"
        FROM items
        LEFT JOIN "Opportunity" o ON o."id" = items."resolvedOpportunityId"
        LEFT JOIN "Company" oc ON oc."id" = o."companyId"
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
