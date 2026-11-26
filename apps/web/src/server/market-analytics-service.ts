import {
  buildMarketAnalytics,
  MarketQueryError,
  parseMarketQuery,
  type MarketAnalytics,
  type MarketOpportunityFact,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { PrismaMarketAnalyticsRepository } from "@ai-career/database";

// Job-Market Analytics (feature 16): what the collected market looks like,
// from the persisted history. Read-only: it never writes, evaluates,
// retrieves or calls a provider, and it never ranks sources or companies.

export const marketQueryKeys = ["window", "from", "to", "titleGroup", "seniority", "arrangement", "region", "currency", "collected", "excludeRemoved"] as const;
export type MarketQueryInput = Partial<Record<(typeof marketQueryKeys)[number], string | null>>;

export interface MarketAnalyticsDependencies {
  facts: () => Promise<MarketOpportunityFact[]>;
  // The domain's discovery title terms, in their stable order.
  titleTerms?: readonly string[];
  now?: () => Date;
}

export function createMarketAnalyticsService(dependencies: MarketAnalyticsDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const titleTerms = dependencies.titleTerms ?? customerSuccessDiscoveryConfiguration.titleTerms;
  return {
    titleTerms,
    async analytics(input: MarketQueryInput = {}): Promise<MarketAnalytics> {
      // Validate before reading anything.
      const query = parseMarketQuery(input, now(), titleTerms);
      return buildMarketAnalytics({ opportunities: await dependencies.facts(), titleTerms, query });
    },
  };
}

export type MarketAnalyticsService = ReturnType<typeof createMarketAnalyticsService>;

let service: MarketAnalyticsService | undefined;

export function getMarketAnalyticsService(): MarketAnalyticsService {
  service ??= createMarketAnalyticsService({ facts: () => new PrismaMarketAnalyticsRepository().facts() });
  return service;
}

export function marketQueryOf(params: URLSearchParams): MarketQueryInput {
  return Object.fromEntries(marketQueryKeys.map((key) => [key, params.get(key)]));
}

export function createMarketApiHandlers(market: MarketAnalyticsService) {
  return {
    async analytics(request: Request): Promise<Response> {
      try {
        return Response.json({ market: await market.analytics(marketQueryOf(new URL(request.url).searchParams)) });
      } catch (error) {
        if (error instanceof MarketQueryError) {
          return Response.json({ error: error.message, code: "REQUEST_INVALID" }, { status: 400 });
        }
        console.error("Market analytics request failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return Response.json({ error: "The request could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
  };
}
