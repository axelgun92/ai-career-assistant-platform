import {
  buildCompanyDetail,
  buildCompanyIndex,
  CompanyQueryError,
  isCompanyId,
  parseCompanyIndexQuery,
  parseCompanyWindow,
  type CiFacts,
  type CompanyDetail,
  type CompanyIndex,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { PrismaBudgetRepository, PrismaCompanyIntelligenceRepository } from "@ai-career/database";

// Company Intelligence (feature 18): what has been observed about a company
// over time, from the collected listings and the user's own applications.
// Read-only: it never writes, evaluates, retrieves or calls a provider, and it
// never scores, ranks or labels a company.

export const companyIndexQueryKeys = ["window", "from", "to", "q", "listed", "applied", "signals", "titleGroup", "arrangement", "sort", "page"] as const;
export const companyDetailQueryKeys = ["window", "from", "to"] as const;
export type CompanyIndexInput = Partial<Record<(typeof companyIndexQueryKeys)[number], string | null>>;
export type CompanyDetailInput = Partial<Record<(typeof companyDetailQueryKeys)[number], string | null>>;

export interface CompanyIntelligenceDependencies {
  facts: (companyIds?: readonly string[]) => Promise<CiFacts>;
  companyGroupIds: (companyId: string) => Promise<string[]>;
  companyIdForOpportunity?: (opportunityId: string) => Promise<string | null>;
  // The user's time zone for calendar months and days (the budget's; UTC when none).
  timeZone: () => Promise<string>;
  titleTerms?: readonly string[];
  now?: () => Date;
}

export function createCompanyIntelligenceService(dependencies: CompanyIntelligenceDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const titleTerms = dependencies.titleTerms ?? customerSuccessDiscoveryConfiguration.titleTerms;
  return {
    titleTerms,
    async index(input: CompanyIndexInput = {}): Promise<CompanyIndex> {
      const at = now();
      // Validate before reading anything.
      const query = parseCompanyIndexQuery(input, at, titleTerms);
      const [facts, timeZone] = await Promise.all([dependencies.facts(), dependencies.timeZone()]);
      return buildCompanyIndex({ facts, titleTerms, query, now: at, timeZone });
    },
    // Null when the id is not a company.
    async detail(companyId: string, input: CompanyDetailInput = {}): Promise<CompanyDetail | null> {
      const at = now();
      const window = parseCompanyWindow(input, at);
      if (!isCompanyId(companyId)) return null;
      const ids = await dependencies.companyGroupIds(companyId);
      if (!ids.length) return null;
      const [facts, timeZone] = await Promise.all([dependencies.facts(ids), dependencies.timeZone()]);
      return buildCompanyDetail({ facts, titleTerms, companyId, window, now: at, timeZone });
    },
    async companyIdForOpportunity(opportunityId: string): Promise<string | null> {
      return dependencies.companyIdForOpportunity ? dependencies.companyIdForOpportunity(opportunityId) : null;
    },
  };
}

export type CompanyIntelligenceService = ReturnType<typeof createCompanyIntelligenceService>;

let service: CompanyIntelligenceService | undefined;

export function getCompanyIntelligenceService(): CompanyIntelligenceService {
  service ??= (() => {
    const repository = new PrismaCompanyIntelligenceRepository();
    return createCompanyIntelligenceService({
      facts: (companyIds) => repository.facts(companyIds),
      companyGroupIds: (companyId) => repository.companyGroupIds(companyId),
      companyIdForOpportunity: (opportunityId) => repository.companyIdForOpportunity(opportunityId),
      timeZone: async () => (await new PrismaBudgetRepository().getSettings())?.timeZone ?? "UTC",
    });
  })();
  return service;
}

const queryOf = <K extends string>(keys: readonly K[], params: URLSearchParams) =>
  Object.fromEntries(keys.map((key) => [key, params.get(key)])) as Partial<Record<K, string | null>>;

const failure = (error: unknown) => {
  if (error instanceof CompanyQueryError) return Response.json({ error: error.message, code: "REQUEST_INVALID" }, { status: 400 });
  console.error("Company intelligence request failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
  return Response.json({ error: "The request could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
};

export function createCompanyApiHandlers(companies: CompanyIntelligenceService) {
  return {
    async index(request: Request): Promise<Response> {
      try {
        return Response.json({ companies: await companies.index(queryOf(companyIndexQueryKeys, new URL(request.url).searchParams)) });
      } catch (error) {
        return failure(error);
      }
    },
    async detail(request: Request, companyId: string): Promise<Response> {
      try {
        const detail = await companies.detail(companyId, queryOf(companyDetailQueryKeys, new URL(request.url).searchParams));
        if (!detail) return Response.json({ error: "Company not found", code: "NOT_FOUND" }, { status: 404 });
        return Response.json({ company: detail });
      } catch (error) {
        return failure(error);
      }
    },
  };
}
