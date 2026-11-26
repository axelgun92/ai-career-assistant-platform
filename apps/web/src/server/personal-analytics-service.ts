import { buildPersonalAnalytics, parsePersonalQuery, PersonalQueryError, type PaFacts, type PersonalAnalytics } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { PrismaBudgetRepository, PrismaPersonalAnalyticsRepository } from "@ai-career/database";

// Personal Job-Search Analytics (feature 17): what is working in the user's
// own search, from their persisted evaluations and applications. Read-only:
// it never writes, evaluates, retrieves or calls a provider, and it never
// measures evaluator accuracy or prescribes learning.

export const personalQueryKeys = ["window", "from", "to", "titleGroup", "recommendation", "arrangement", "seniority", "source", "profile"] as const;
export type PersonalQueryInput = Partial<Record<(typeof personalQueryKeys)[number], string | null>>;

export interface PersonalAnalyticsDependencies {
  facts: () => Promise<PaFacts>;
  // The user's time zone for calendar-day comparisons (the budget's; UTC when none).
  timeZone: () => Promise<string>;
  titleTerms?: readonly string[];
  now?: () => Date;
}

export function createPersonalAnalyticsService(dependencies: PersonalAnalyticsDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const titleTerms = dependencies.titleTerms ?? customerSuccessDiscoveryConfiguration.titleTerms;
  return {
    titleTerms,
    async analytics(input: PersonalQueryInput = {}): Promise<PersonalAnalytics> {
      const at = now();
      // Validate before reading anything.
      const query = parsePersonalQuery(input, at, titleTerms);
      const [facts, timeZone] = await Promise.all([dependencies.facts(), dependencies.timeZone()]);
      return buildPersonalAnalytics({ facts, titleTerms, query, now: at, timeZone });
    },
  };
}

export type PersonalAnalyticsService = ReturnType<typeof createPersonalAnalyticsService>;

let service: PersonalAnalyticsService | undefined;

export function getPersonalAnalyticsService(): PersonalAnalyticsService {
  service ??= createPersonalAnalyticsService({
    facts: () => new PrismaPersonalAnalyticsRepository().facts(),
    timeZone: async () => (await new PrismaBudgetRepository().getSettings())?.timeZone ?? "UTC",
  });
  return service;
}

export function personalQueryOf(params: URLSearchParams): PersonalQueryInput {
  return Object.fromEntries(personalQueryKeys.map((key) => [key, params.get(key)]));
}

export function createPersonalApiHandlers(personal: PersonalAnalyticsService) {
  return {
    async analytics(request: Request): Promise<Response> {
      try {
        return Response.json({ personal: await personal.analytics(personalQueryOf(new URL(request.url).searchParams)) });
      } catch (error) {
        if (error instanceof PersonalQueryError) {
          return Response.json({ error: error.message, code: "REQUEST_INVALID" }, { status: 400 });
        }
        console.error("Personal analytics request failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return Response.json({ error: "The request could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
  };
}
