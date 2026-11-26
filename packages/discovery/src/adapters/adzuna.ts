import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, mapKeptItems, parseResponse } from "../collection";
import { AdapterError, type SourceAdapter } from "../contract";
import { getJson } from "../transport";

// Adzuna job search API (aggregator, official public API with a free key).
// UNVERIFIED: the mapping follows Adzuna's published documentation and has
// not been checked against a real response, so the adapter cannot be
// enabled until a keyed verification request confirms it. It also needs
// ADZUNA_APP_ID and ADZUNA_APP_KEY. Unresolved: Adzuna's documented search
// response carries a description excerpt, not the full posting text, which
// conflicts with the complete-description contract; this stays open until
// its live verification and a design decision.

const countryCurrency: Record<string, string> = {
  us: "USD",
  ca: "CAD",
  gb: "GBP",
  au: "AUD",
  nz: "NZD",
  sg: "SGD",
  in: "INR",
  za: "ZAR",
  de: "EUR",
  fr: "EUR",
  nl: "EUR",
  it: "EUR",
  es: "EUR",
  at: "EUR",
  be: "EUR",
  pl: "PLN",
  ch: "CHF",
  br: "BRL",
  mx: "MXN",
};

const configSchema = z
  .object({
    country: z.enum(Object.keys(countryCurrency) as [string, ...string[]]).default("us"),
    query: z.string().trim().min(1).max(100).nullable().default(null),
    resultsPerPage: z.number().int().min(1).max(50).default(50),
  })
  .strict();
type AdzunaConfig = z.infer<typeof configSchema>;

const resultSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    description: z.string().nullish(),
    redirect_url: z.string().nullish(),
    created: z.string().nullish(),
    company: z.object({ display_name: z.string().nullish() }).passthrough().nullish(),
    location: z.object({ display_name: z.string().nullish() }).passthrough().nullish(),
    salary_min: z.number().nullish(),
    salary_max: z.number().nullish(),
    salary_is_predicted: z.union([z.string(), z.number()]).nullish(),
    contract_time: z.string().nullish(),
  })
  .passthrough();
const responseSchema = z.object({ count: z.number().nullish(), results: z.array(z.unknown()) }).passthrough();

const searchBase = "https://api.adzuna.com/v1/api/jobs";

function searchUrl(config: AdzunaConfig, page: number, query: string, credentials: { id: string; key: string }) {
  const params = new URLSearchParams({
    app_id: credentials.id,
    app_key: credentials.key,
    what: query,
    results_per_page: String(config.resultsPerPage),
  });
  return `${searchBase}/${config.country}/search/${page}?${params.toString()}`;
}

export const adzunaAdapter: SourceAdapter<AdzunaConfig> = {
  key: "adzuna",
  name: "Adzuna",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "AGGREGATOR",
  sourceType: "API",
  configSchema,
  configFields: [
    { name: "country", label: "Country", help: "Two-letter Adzuna country code, for example us or gb.", required: true },
    { name: "query", label: "Search phrase", help: "Defaults to the domain's discovery phrase.", required: false },
  ],
  requiredEnv: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
  verified: false,
  attribution: "Jobs by Adzuna",
  verificationUrl(config) {
    return searchUrl({ ...config, resultsPerPage: 5 }, 1, config.query ?? "customer success", { id: "{ADZUNA_APP_ID}", key: "{ADZUNA_APP_KEY}" });
  },
  async collect(context, config) {
    const id = context.env.ADZUNA_APP_ID?.trim();
    const key = context.env.ADZUNA_APP_KEY?.trim();
    if (!id || !key) throw new AdapterError("CONFIG", "ADZUNA_APP_ID and ADZUNA_APP_KEY are required");
    const query = config.query ?? context.discovery.searchQueries[0];
    if (!query) throw new AdapterError("CONFIG", "No search phrase is configured");
    return collectPages(context, async (page) => {
      const url = searchUrl(config, page + 1, query, { id, key });
      const response = parseResponse(responseSchema, await getJson(context.transport, url), url);
      const items = response.results.map((item) => resultSchema.safeParse(item));
      const valid = items.flatMap((item) => (item.success ? [item.data] : []));
      const mapped = mapKeptItems(adzunaAdapter, context, valid, {
        title: (item) => htmlToText(item.title),
        externalId: (item) => item.id,
        map: (item) => {
          const predicted = String(item.salary_is_predicted ?? "1") !== "0";
          return {
            externalId: item.id,
            title: htmlToText(item.title),
            company: item.company?.display_name ?? null,
            location: item.location?.display_name ?? null,
            description: htmlToText(item.description),
            postingDate: item.created ?? null,
            sourceUrl: item.redirect_url ?? null,
            applicationUrl: item.redirect_url ?? null,
            // Adzuna's redirect to the advert, not an application destination.
            sourceFacts: { applicationUrlBasis: item.redirect_url ? "SOURCE_LISTING_PAGE" : null },
            employmentType: item.contract_time ?? null,
            structured: predicted
              ? {}
              : {
                  salaryMin: item.salary_min ?? null,
                  salaryMax: item.salary_max ?? null,
                  salaryCurrency: countryCurrency[config.country] ?? null,
                  salaryPeriod: "YEAR",
                },
            metadata: { country: config.country, query },
            sourceItem: item,
          };
        },
      });
      const malformed = items.filter((item) => !item.success).length;
      return {
        ...mapped,
        issues: [
          ...mapped.issues,
          ...Array.from({ length: malformed }, () => ({ externalId: null, code: "CONTRACT_MISMATCH" as const, message: "Listing does not match the expected shape" })),
        ],
        fetched: response.results.length,
        more: response.results.length >= config.resultsPerPage,
      };
    });
  },
};
