import {
  buildSourceInsightDetail,
  buildSourceInsights,
  identityFromInsightSlug,
  parseGroupBy,
  parseInsightsWindow,
  parseSourceSort,
  sortSources,
  SourceInsightsWindowError,
  type SiFacts,
  type SiSourceMetrics,
  type SourceHealthStatus,
  type SourceInsightDetail,
  type SourceInsights,
  type SourceSortKey,
} from "@ai-career/core";
import { PrismaSourceIntelligenceRepository } from "@ai-career/database";
import { getBudgetService } from "./budget-service";
import { getRetrievalService, type SourceSummary } from "./retrieval-service";

// Source Intelligence (feature 15): read-only evidence of what each source
// contributes, from the persisted history. It never writes, evaluates,
// retrieves or calls a provider, and it never judges a source: figures carry
// their sample sizes, and source decisions stay with the user.

export interface SourceInsightsQuery {
  window?: string | null;
  from?: string | null;
  to?: string | null;
  groupBy?: string | null;
  archived?: string | null;
  sort?: string | null;
}

export interface SourceHealthBrief {
  status: SourceHealthStatus;
  stale: boolean;
  enabled: boolean;
  archived: boolean;
}

export interface SourceInsightsOverview extends SourceInsights {
  sort: SourceSortKey;
  includeArchived: boolean;
  health: Record<string, SourceHealthBrief>;
  needsAttention: number;
  pricingVersions: string[];
}

export interface SourceValueStrip {
  sourceId: string;
  discovered: number;
  new: number;
  evaluated: number;
  useful: number;
  usefulSample: SiSourceMetrics["evaluation"]["usefulRate"]["sample"];
  costPerUseful: number | null;
  costIncomplete: boolean;
  currency: string | null;
  notes: SiSourceMetrics["notes"];
}

const attentionStatuses = new Set<SourceHealthStatus>(["rate_limited", "provider_wait", "needs_attention", "failing"]);

export interface SourceInsightsDependencies {
  facts: (input: { currency: string | null }) => Promise<SiFacts>;
  sources: () => Promise<SourceSummary[]>;
  costBasis: () => Promise<{ currency: string | null; configuredPricingVersions: string[] }>;
  now?: () => Date;
}

export class SourceInsightsNotFoundError extends Error {
  constructor() {
    super("Source not found");
    this.name = "SourceInsightsNotFoundError";
  }
}

export function createSourceInsightsService(dependencies: SourceInsightsDependencies) {
  const now = dependencies.now ?? (() => new Date());

  const load = async () => {
    const basis = await dependencies.costBasis();
    const [facts, sources] = await Promise.all([dependencies.facts({ currency: basis.currency }), dependencies.sources()]);
    const health: Record<string, SourceHealthBrief> = {};
    for (const source of sources) {
      health[`source:${source.id}`] = {
        status: source.health.status,
        stale: source.health.stale,
        enabled: source.enabled,
        archived: source.archivedAt !== null,
      };
    }
    const needsAttention = sources.filter(
      (source) => source.enabled && !source.archivedAt && (attentionStatuses.has(source.health.status) || source.health.stale),
    ).length;
    return { basis, facts, health, needsAttention };
  };

  return {
    async overview(query: SourceInsightsQuery = {}): Promise<SourceInsightsOverview> {
      const at = now();
      const window = parseInsightsWindow(query, at);
      const groupBy = parseGroupBy(query.groupBy);
      const sort = parseSourceSort(query.sort);
      const includeArchived = query.archived === "include";
      const { basis, facts, health, needsAttention } = await load();
      const insights = buildSourceInsights({ facts, window, groupBy, currency: basis.currency, now: at, includeArchived });
      return {
        ...insights,
        // Each section is ordered on its own; the two are never ranked together.
        automated: sortSources(insights.automated, sort),
        userCollected: sortSources(insights.userCollected, sort),
        sort,
        includeArchived,
        health,
        needsAttention,
        pricingVersions: basis.configuredPricingVersions,
      };
    },

    async detail(slug: string, query: SourceInsightsQuery = {}): Promise<SourceInsightDetail & { health: SourceHealthBrief | null; currency: string | null; pricingVersions: string[] }> {
      const identity = identityFromInsightSlug(slug);
      if (!identity) throw new SourceInsightsNotFoundError();
      const at = now();
      const window = parseInsightsWindow(query, at);
      const { basis, facts, health } = await load();
      const detail = buildSourceInsightDetail({ facts, window, groupBy: identity.startsWith("adapter:") ? "adapter" : "source", currency: basis.currency, now: at, identity, includeArchived: true });
      if (!detail) throw new SourceInsightsNotFoundError();
      return { ...detail, health: health[identity] ?? null, currency: basis.currency, pricingVersions: basis.configuredPricingVersions };
    },

    // The compact last-30-days figures shown on each /sources card.
    async valueStrips(): Promise<Record<string, SourceValueStrip>> {
      const at = now();
      const { basis, facts } = await load();
      const insights = buildSourceInsights({ facts, window: parseInsightsWindow({ window: "30d" }, at), currency: basis.currency, now: at, includeArchived: true });
      const strips: Record<string, SourceValueStrip> = {};
      for (const row of insights.automated) {
        if (!row.retrievalSourceId) continue;
        strips[row.retrievalSourceId] = {
          sourceId: row.retrievalSourceId,
          discovered: row.discovery.discovered,
          new: row.discovery.new,
          evaluated: row.evaluation.evaluated,
          useful: row.evaluation.useful,
          usefulSample: row.evaluation.usefulRate.sample,
          costPerUseful: row.cost.costPerUseful,
          costIncomplete: row.cost.incomplete,
          currency: row.cost.currency,
          notes: row.notes,
        };
      }
      return strips;
    },
  };
}

export type SourceInsightsService = ReturnType<typeof createSourceInsightsService>;

let service: SourceInsightsService | undefined;

export function getSourceInsightsService(): SourceInsightsService {
  service ??= createSourceInsightsService({
    facts: (input) => new PrismaSourceIntelligenceRepository().facts(input),
    sources: () => getRetrievalService().list({ includeArchived: true }),
    costBasis: () => getBudgetService().costBasis(),
  });
  return service;
}

const queryOf = (request: Request): SourceInsightsQuery => {
  const params = new URL(request.url).searchParams;
  return {
    window: params.get("window"),
    from: params.get("from"),
    to: params.get("to"),
    groupBy: params.get("groupBy"),
    archived: params.get("archived"),
    sort: params.get("sort"),
  };
};

export function createSourceInsightsApiHandlers(insights: SourceInsightsService) {
  const handle = async (work: () => Promise<Response>) => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof SourceInsightsWindowError) {
        return Response.json({ error: error.message, code: "REQUEST_INVALID" }, { status: 400 });
      }
      if (error instanceof SourceInsightsNotFoundError) {
        return Response.json({ error: error.message, code: "NOT_FOUND" }, { status: 404 });
      }
      console.error("Source insights request failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
      return Response.json({ error: "The request could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
    }
  };
  return {
    overview: (request: Request) => handle(async () => Response.json({ insights: await insights.overview(queryOf(request)) })),
    detail: (request: Request, slug: string) => handle(async () => Response.json({ insight: await insights.detail(slug, queryOf(request)) })),
  };
}
