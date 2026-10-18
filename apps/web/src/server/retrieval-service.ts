import { defaultRetrievalScheduleMinutes, deriveSourceHealth, type SourceHealth } from "@ai-career/core";
import {
  PrismaRetrievalSourceRepository,
  RetrievalSourceError,
  type RetrievalRunRecord,
  type RetrievalSourceRecord,
} from "@ai-career/database";
import { defaultAdapterRegistry, missingEnvironment, type AdapterRegistry, type AnySourceAdapter } from "@ai-career/discovery";
import { z } from "zod";

// Configured retrieval sources (/sources). Each source is one adapter with
// a configuration the adapter's schema validates. Sources are disabled when
// created and nothing is retrieved until the user enables one. An adapter
// that has not been verified against a real response, or whose required
// environment variables are missing, cannot be enabled. A source that has
// produced runs or records is archived instead of deleted.

export const retrievalDomain = "customer-success";
export const minimumScheduleMinutes = 60;
export const maximumScheduleMinutes = 7 * 24 * 60;

export type RetrievalStore = Pick<
  PrismaRetrievalSourceRepository,
  "list" | "get" | "create" | "update" | "remove" | "restore" | "listRuns" | "enqueueRun" | "healthInputs"
>;

export class RetrievalServiceError extends Error {
  constructor(
    readonly code:
      | "REQUEST_INVALID"
      | "ADAPTER_UNKNOWN"
      | "CONFIG_INVALID"
      | "SOURCE_NOT_FOUND"
      | "SOURCE_ARCHIVED"
      | "SOURCE_DISABLED"
      | "ADAPTER_UNVERIFIED"
      | "ENVIRONMENT_MISSING"
      | "SOURCE_RATE_LIMITED"
      | "SOURCE_PROVIDER_WAIT"
      | "SOURCE_BACKING_OFF",
    message: string,
    readonly status: number,
    // For a gated source, when it can run (or, for backoff, run without an
    // override).
    readonly until?: Date,
  ) {
    super(message);
    this.name = "RetrievalServiceError";
  }
}

export interface AdapterSummary {
  key: string;
  name: string;
  retrievalType: string;
  sourceCategory: string;
  verified: boolean;
  missingEnvironment: string[];
  attribution: string | null;
  configFields: AnySourceAdapter["configFields"];
}

export type SourceSummary = RetrievalSourceRecord & {
  latestRun: RetrievalRunRecord | null;
  adapter: AdapterSummary | null;
  // Why the source cannot be enabled now, if so.
  enableBlockedReason: string | null;
  // Derived from its runs (feature 12, Core TDD §51).
  health: SourceHealth;
};

const scheduleSchema = z.number().int().min(minimumScheduleMinutes).max(maximumScheduleMinutes);

const createSchema = z
  .object({
    adapterKey: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    scheduleMinutes: scheduleSchema.optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    scheduleMinutes: scheduleSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export function createRetrievalService(input: {
  store: RetrievalStore;
  registry?: AdapterRegistry;
  env?: () => Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}) {
  const registry = input.registry ?? defaultAdapterRegistry;
  const env = input.env ?? (() => process.env);
  const now = input.now ?? (() => new Date());

  function summarize(adapter: AnySourceAdapter): AdapterSummary {
    return {
      key: adapter.key,
      name: adapter.name,
      retrievalType: adapter.retrievalType,
      sourceCategory: adapter.sourceCategory,
      verified: adapter.verified,
      missingEnvironment: missingEnvironment(adapter, env()),
      attribution: adapter.attribution,
      configFields: adapter.configFields,
    };
  }

  function enableBlockedReason(adapter: AnySourceAdapter | undefined): string | null {
    if (!adapter) return "This source's adapter is no longer available.";
    if (!adapter.verified) return "Awaiting verification against a real response.";
    const missing = missingEnvironment(adapter, env());
    if (missing.length) return `Needs ${missing.join(" and ")}.`;
    return null;
  }

  function adapterFor(key: string): AnySourceAdapter {
    const adapter = registry.get(key);
    if (!adapter) throw new RetrievalServiceError("ADAPTER_UNKNOWN", "Unknown source type", 400);
    return adapter;
  }

  function parseConfig(adapter: AnySourceAdapter, config: unknown) {
    const parsed = adapter.configSchema.safeParse(config);
    if (!parsed.success) throw new RetrievalServiceError("CONFIG_INVALID", "The source settings are invalid", 400);
    return parsed.data;
  }

  async function toSummary(source: RetrievalSourceRecord & { latestRun?: RetrievalRunRecord | null }): Promise<SourceSummary> {
    const adapter = registry.get(source.adapterKey);
    const blocked = enableBlockedReason(adapter);
    const { runs, lastSuccess } = await input.store.healthInputs(source.id);
    return {
      ...source,
      latestRun: source.latestRun ?? runs[0] ?? null,
      adapter: adapter ? summarize(adapter) : null,
      enableBlockedReason: blocked,
      health: deriveSourceHealth({
        enabled: source.enabled,
        archivedAt: source.archivedAt,
        blockedReason: blocked,
        scheduleMinutes: source.scheduleMinutes,
        lastRunAt: source.lastRunAt,
        nextEligibleAt: source.nextEligibleAt,
        runsNewestFirst: runs,
        lastSuccess,
        now: now(),
      }),
    };
  }

  async function existing(id: string) {
    if (!z.uuid().safeParse(id).success) throw new RetrievalServiceError("SOURCE_NOT_FOUND", "Source not found", 404);
    const source = await input.store.get(id);
    if (!source) throw new RetrievalServiceError("SOURCE_NOT_FOUND", "Source not found", 404);
    return source;
  }

  function mapStoreError(error: unknown): never {
    if (error instanceof RetrievalSourceError) {
      throw new RetrievalServiceError(error.code, error.message, error.code === "SOURCE_NOT_FOUND" ? 404 : 409, error.until);
    }
    throw error;
  }

  return {
    adapters: (): AdapterSummary[] => registry.list().map(summarize),

    async list(options: { includeArchived?: boolean } = {}): Promise<SourceSummary[]> {
      return Promise.all((await input.store.list(options)).map(toSummary));
    },

    async get(id: string): Promise<SourceSummary> {
      return toSummary(await existing(id));
    },

    async create(body: unknown): Promise<SourceSummary> {
      const parsed = createSchema.safeParse(body);
      if (!parsed.success) throw new RetrievalServiceError("REQUEST_INVALID", "The source is invalid", 400);
      const adapter = adapterFor(parsed.data.adapterKey);
      const config = parseConfig(adapter, parsed.data.config);
      const created = await input.store.create({
        adapterKey: adapter.key,
        name: parsed.data.name ?? adapter.name,
        domain: retrievalDomain,
        retrievalType: adapter.retrievalType,
        sourceCategory: adapter.sourceCategory,
        config,
        scheduleMinutes: parsed.data.scheduleMinutes ?? defaultRetrievalScheduleMinutes,
      });
      return toSummary(created);
    },

    async update(id: string, body: unknown): Promise<SourceSummary> {
      const parsed = updateSchema.safeParse(body);
      if (!parsed.success) throw new RetrievalServiceError("REQUEST_INVALID", "The change is invalid", 400);
      const source = await existing(id);
      const adapter = registry.get(source.adapterKey);
      if (parsed.data.enabled) {
        if (source.archivedAt) throw new RetrievalServiceError("SOURCE_ARCHIVED", "Restore the source before enabling it", 409);
        if (!adapter || !adapter.verified) {
          throw new RetrievalServiceError("ADAPTER_UNVERIFIED", "This source is awaiting verification and cannot be enabled yet", 409);
        }
        const missing = missingEnvironment(adapter, env());
        if (missing.length) {
          throw new RetrievalServiceError("ENVIRONMENT_MISSING", `This source needs ${missing.join(" and ")} before it can be enabled`, 409);
        }
      }
      if (parsed.data.config !== undefined && !adapter) {
        throw new RetrievalServiceError("ADAPTER_UNKNOWN", "Unknown source type", 400);
      }
      const config = parsed.data.config !== undefined ? parseConfig(adapter!, parsed.data.config) : undefined;
      const updated = await input.store.update(id, { ...parsed.data, config }).catch(mapStoreError);
      return toSummary(updated);
    },

    async remove(id: string): Promise<{ result: "DELETED" | "ARCHIVED" }> {
      await existing(id);
      return { result: await input.store.remove(id).catch(mapStoreError) };
    },

    async restore(id: string): Promise<SourceSummary> {
      await existing(id);
      return toSummary(await input.store.restore(id).catch(mapStoreError));
    },

    // A rate limit or a wait the source asked for always refuses the run;
    // our own backoff refuses it unless override is set (an explicit "Run
    // now anyway"), which permits this one run.
    async runNow(id: string, options: { override?: boolean } = {}): Promise<{ run: RetrievalRunRecord; alreadyActive: boolean }> {
      const source = await existing(id);
      const blocked = enableBlockedReason(registry.get(source.adapterKey));
      if (blocked) throw new RetrievalServiceError("SOURCE_DISABLED", blocked, 409);
      return input.store.enqueueRun(id, "MANUAL", { override: options.override === true, now: now() }).catch(mapStoreError);
    },

    async runs(id: string): Promise<RetrievalRunRecord[]> {
      await existing(id);
      return input.store.listRuns(id);
    },
  };
}

export type RetrievalService = ReturnType<typeof createRetrievalService>;

let service: RetrievalService | undefined;

export function getRetrievalService(): RetrievalService {
  service ??= createRetrievalService({ store: new PrismaRetrievalSourceRepository() });
  return service;
}

function errorResponse(error: unknown) {
  if (error instanceof RetrievalServiceError) {
    return Response.json(
      { error: error.message, code: error.code, ...(error.until ? { until: error.until.toISOString() } : {}) },
      { status: error.status },
    );
  }
  console.error("Retrieval source request failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
  return Response.json({ error: "The request could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
}

async function jsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 }) };
  }
}

const runNowSchema = z.object({ override: z.boolean().optional() }).strict();

export function createRetrievalApiHandlers(retrieval: RetrievalService) {
  const handle = async (work: () => Promise<Response>) => {
    try {
      return await work();
    } catch (error) {
      return errorResponse(error);
    }
  };
  return {
    list: (request: Request) =>
      handle(async () => {
        const includeArchived = new URL(request.url).searchParams.get("archived") === "include";
        return Response.json({ sources: await retrieval.list({ includeArchived }), adapters: retrieval.adapters() });
      }),
    create: async (request: Request) => {
      const parsed = await jsonBody(request);
      if (!parsed.ok) return parsed.response;
      return handle(async () => Response.json({ source: await retrieval.create(parsed.body) }, { status: 201 }));
    },
    get: (id: string) => handle(async () => Response.json({ source: await retrieval.get(id) })),
    update: async (request: Request, id: string) => {
      const parsed = await jsonBody(request);
      if (!parsed.ok) return parsed.response;
      return handle(async () => Response.json({ source: await retrieval.update(id, parsed.body) }));
    },
    remove: (id: string) => handle(async () => Response.json(await retrieval.remove(id))),
    restore: (id: string) => handle(async () => Response.json({ source: await retrieval.restore(id) })),
    runs: (id: string) => handle(async () => Response.json({ runs: await retrieval.runs(id) })),
    // The body is optional; {"override": true} is the explicit "Run now
    // anyway" past our own backoff.
    runNow: async (id: string, request?: Request) => {
      let override = false;
      if (request && (await request.clone().text()).trim()) {
        const parsed = await jsonBody(request);
        if (!parsed.ok) return parsed.response;
        const body = runNowSchema.safeParse(parsed.body);
        if (!body.success) return Response.json({ error: "The request is invalid", code: "REQUEST_INVALID" }, { status: 400 });
        override = body.data.override === true;
      }
      return handle(async () => {
        const result = await retrieval.runNow(id, { override });
        return Response.json(result, { status: result.alreadyActive ? 200 : 202 });
      });
    },
  };
}
