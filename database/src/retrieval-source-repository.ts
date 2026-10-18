import {
  emptyRetrievalRunCounts,
  type RetrievalRunCounts,
  type RetrievalRunStatus,
  type RetrievalTrigger,
  type RetrievalType,
  type SourceCategory,
} from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

// Configured retrieval sources and their runs (feature 11). A source is
// disabled when created. A source that produced runs or source records is
// archived, never deleted, so retrieval provenance is never lost; only a
// source that never produced anything is physically deleted.

export interface RetrievalSourceRecord {
  id: string;
  adapterKey: string;
  name: string;
  domain: string;
  retrievalType: RetrievalType;
  sourceCategory: SourceCategory;
  enabled: boolean;
  config: unknown;
  scheduleMinutes: number;
  lastRunAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetrievalRunRecord {
  id: string;
  retrievalSourceId: string;
  trigger: RetrievalTrigger;
  status: RetrievalRunStatus;
  leaseExpiresAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  counts: RetrievalRunCounts | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export class RetrievalSourceError extends Error {
  constructor(
    readonly code: "SOURCE_NOT_FOUND" | "SOURCE_ARCHIVED" | "SOURCE_DISABLED",
    message: string,
  ) {
    super(message);
    this.name = "RetrievalSourceError";
  }
}

type SourceRow = Prisma.RetrievalSourceGetPayload<object>;
type RunRow = Prisma.RetrievalRunGetPayload<object>;

function mapSource(row: SourceRow): RetrievalSourceRecord {
  return { ...row, config: row.config };
}

function mapCounts(value: Prisma.JsonValue | null): RetrievalRunCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...emptyRetrievalRunCounts(), ...(value as Partial<RetrievalRunCounts>) };
}

function mapRun(row: RunRow): RetrievalRunRecord {
  return {
    id: row.id,
    retrievalSourceId: row.retrievalSourceId,
    trigger: row.trigger,
    status: row.status,
    leaseExpiresAt: row.leaseExpiresAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    counts: mapCounts(row.counts),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}

const activeStatuses = ["QUEUED", "RUNNING"] as const;

export class PrismaRetrievalSourceRepository {
  private readonly database = getDatabaseClient();

  async list(options: { includeArchived?: boolean } = {}): Promise<Array<RetrievalSourceRecord & { latestRun: RetrievalRunRecord | null }>> {
    const rows = await this.database.retrievalSource.findMany({
      where: options.includeArchived ? {} : { archivedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { runs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
    });
    return rows.map(({ runs, ...row }) => ({ ...mapSource(row), latestRun: runs[0] ? mapRun(runs[0]) : null }));
  }

  async get(id: string): Promise<RetrievalSourceRecord | null> {
    const row = await this.database.retrievalSource.findUnique({ where: { id } });
    return row ? mapSource(row) : null;
  }

  async create(input: {
    adapterKey: string;
    name: string;
    domain: string;
    retrievalType: RetrievalType;
    sourceCategory: SourceCategory;
    config: unknown;
    scheduleMinutes: number;
  }): Promise<RetrievalSourceRecord> {
    const row = await this.database.retrievalSource.create({
      data: { ...input, enabled: false, config: input.config as Prisma.InputJsonValue },
    });
    return mapSource(row);
  }

  async update(
    id: string,
    input: { name?: string; config?: unknown; scheduleMinutes?: number; enabled?: boolean },
  ): Promise<RetrievalSourceRecord> {
    const existing = await this.get(id);
    if (!existing) throw new RetrievalSourceError("SOURCE_NOT_FOUND", "Retrieval source not found");
    if (existing.archivedAt && input.enabled) {
      throw new RetrievalSourceError("SOURCE_ARCHIVED", "An archived source cannot be enabled");
    }
    const row = await this.database.retrievalSource.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.scheduleMinutes !== undefined ? { scheduleMinutes: input.scheduleMinutes } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    return mapSource(row);
  }

  // Removes a source: physically only if it never produced a run or a
  // source record; otherwise it is archived (and disabled) and every
  // record keeps its link to it.
  async remove(id: string, now = new Date()): Promise<"DELETED" | "ARCHIVED"> {
    return this.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "RetrievalSource" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!rows.length) throw new RetrievalSourceError("SOURCE_NOT_FOUND", "Retrieval source not found");
      const runs = await transaction.retrievalRun.count({ where: { retrievalSourceId: id } });
      const records = await transaction.sourceRecord.count({ where: { retrievalSourceId: id } });
      if (runs === 0 && records === 0) {
        await transaction.retrievalSource.delete({ where: { id } });
        return "DELETED" as const;
      }
      await transaction.retrievalSource.update({ where: { id }, data: { enabled: false, archivedAt: now } });
      return "ARCHIVED" as const;
    });
  }

  // Brings an archived source back, disabled.
  async restore(id: string): Promise<RetrievalSourceRecord> {
    const existing = await this.get(id);
    if (!existing) throw new RetrievalSourceError("SOURCE_NOT_FOUND", "Retrieval source not found");
    const row = await this.database.retrievalSource.update({ where: { id }, data: { archivedAt: null, enabled: false } });
    return mapSource(row);
  }

  async listRuns(sourceId: string, limit = 20): Promise<RetrievalRunRecord[]> {
    const rows = await this.database.retrievalRun.findMany({
      where: { retrievalSourceId: sourceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(mapRun);
  }

  // Queues a run unless one is already queued or running for the source
  // (then that one is returned). Only an enabled, unarchived source runs.
  async enqueueRun(
    sourceId: string,
    trigger: RetrievalTrigger,
  ): Promise<{ run: RetrievalRunRecord; alreadyActive: boolean }> {
    return this.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ enabled: boolean; archivedAt: Date | null }>>`
        SELECT "enabled", "archivedAt" FROM "RetrievalSource" WHERE "id" = ${sourceId}::uuid FOR UPDATE`;
      const source = rows[0];
      if (!source) throw new RetrievalSourceError("SOURCE_NOT_FOUND", "Retrieval source not found");
      if (source.archivedAt) throw new RetrievalSourceError("SOURCE_ARCHIVED", "An archived source cannot run");
      if (!source.enabled) throw new RetrievalSourceError("SOURCE_DISABLED", "Enable the source before running it");
      const active = await transaction.retrievalRun.findFirst({
        where: { retrievalSourceId: sourceId, status: { in: [...activeStatuses] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (active) return { run: mapRun(active), alreadyActive: true };
      const run = await transaction.retrievalRun.create({ data: { retrievalSourceId: sourceId, trigger } });
      return { run: mapRun(run), alreadyActive: false };
    });
  }

  // Queues a scheduled run for every enabled source whose interval has
  // passed since its last run (or that has never run) and that has no
  // queued or running run. Returns how many were queued.
  async enqueueDueRuns(now = new Date()): Promise<number> {
    const due = await this.database.$queryRaw<Array<{ id: string }>>`
      SELECT s."id" FROM "RetrievalSource" s
      WHERE s."enabled" AND s."archivedAt" IS NULL
        AND (s."lastRunAt" IS NULL OR s."lastRunAt" + make_interval(mins => s."scheduleMinutes") <= ${now}::timestamptz)
        AND NOT EXISTS (
          SELECT 1 FROM "RetrievalRun" r WHERE r."retrievalSourceId" = s."id" AND r."status" IN ('QUEUED', 'RUNNING')
        )
      ORDER BY s."createdAt" ASC, s."id" ASC`;
    let queued = 0;
    for (const { id } of due) {
      try {
        const result = await this.enqueueRun(id, "SCHEDULE");
        if (!result.alreadyActive) queued += 1;
      } catch (error) {
        // Disabled or archived since the read: nothing to queue.
        if (!(error instanceof RetrievalSourceError)) throw error;
      }
    }
    return queued;
  }

  // Claims the oldest queued run (SKIP LOCKED), marks it running with a
  // lease and records the source's last run time. A run whose source was
  // disabled or archived after it was queued is closed without running.
  async claimNextRun(
    now = new Date(),
    leaseSeconds = 15 * 60,
  ): Promise<{ run: RetrievalRunRecord; source: RetrievalSourceRecord } | null> {
    return this.database.$transaction(async (transaction) => {
      for (;;) {
        const rows = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "RetrievalRun" WHERE "status" = 'QUEUED'
          ORDER BY "createdAt" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED LIMIT 1`;
        const id = rows[0]?.id;
        if (!id) return null;
        const queued = await transaction.retrievalRun.findUniqueOrThrow({ where: { id }, include: { retrievalSource: true } });
        if (!queued.retrievalSource.enabled || queued.retrievalSource.archivedAt) {
          await transaction.retrievalRun.update({
            where: { id },
            data: {
              status: "FAILED",
              finishedAt: now,
              errorCode: "SOURCE_DISABLED",
              errorMessage: "The source was disabled before the run started",
            },
          });
          continue;
        }
        const run = await transaction.retrievalRun.update({
          where: { id },
          data: { status: "RUNNING", startedAt: now, leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000) },
        });
        const source = await transaction.retrievalSource.update({
          where: { id: queued.retrievalSourceId },
          data: { lastRunAt: now },
        });
        return { run: mapRun(run), source: mapSource(source) };
      }
    });
  }

  async finishRun(
    runId: string,
    input: {
      status: Extract<RetrievalRunStatus, "COMPLETED" | "PARTIAL" | "FAILED">;
      counts: RetrievalRunCounts;
      errorCode: string | null;
      errorMessage: string | null;
      now?: Date;
    },
  ): Promise<RetrievalRunRecord> {
    const run = await this.database.retrievalRun.update({
      where: { id: runId },
      data: {
        status: input.status,
        finishedAt: input.now ?? new Date(),
        leaseExpiresAt: null,
        counts: input.counts as unknown as Prisma.InputJsonValue,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });
    return mapRun(run);
  }

  // Runs left RUNNING by a worker that stopped mid-run are closed as
  // FAILED; records they already ingested are kept. Normally only runs
  // whose lease expired; the worker passes regardlessOfLease at startup,
  // when it holds the single-worker lock and nothing can be running.
  async failInterruptedRuns(now = new Date(), options: { regardlessOfLease?: boolean } = {}): Promise<number> {
    const result = await this.database.retrievalRun.updateMany({
      where: { status: "RUNNING", ...(options.regardlessOfLease ? {} : { leaseExpiresAt: { lt: now } }) },
      data: {
        status: "FAILED",
        finishedAt: now,
        leaseExpiresAt: null,
        errorCode: "WORKER_INTERRUPTED",
        errorMessage: "The retrieval worker stopped before the run finished",
      },
    });
    return result.count;
  }

  // When each of these source listing IDs was last checked by a retrieval
  // run, for listings already stored from this source (the adapter key, as
  // on SourceRecord.source); the latest of a listing's records counts. An ID
  // missing from the map has never been stored. Used to order detail
  // requests: unseen listings first, then the longest since last checked.
  async lastCheckedListings(source: string, externalIds: readonly string[]): Promise<Map<string, Date>> {
    if (!externalIds.length) return new Map();
    const rows = await this.database.sourceRecord.groupBy({
      by: ["externalId"],
      where: { source, externalId: { in: [...new Set(externalIds)] } },
      _max: { lastObservedAt: true },
    });
    return new Map(
      rows.flatMap((row) => (row.externalId && row._max.lastObservedAt ? [[row.externalId, row._max.lastObservedAt] as const] : [])),
    );
  }

  // Read-only figures for pnpm app:doctor.
  async health(now = new Date()): Promise<{ enabledSources: Array<{ id: string; adapterKey: string; name: string }>; failedRunsLastDay: number }> {
    const enabledSources = await this.database.retrievalSource.findMany({
      where: { enabled: true, archivedAt: null },
      select: { id: true, adapterKey: true, name: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const failedRunsLastDay = await this.database.retrievalRun.count({
      where: { status: "FAILED", finishedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    });
    return { enabledSources, failedRunsLastDay };
  }
}
