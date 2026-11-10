import { readFileSync } from "node:fs";
import path from "node:path";
import type { RawOpportunity } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  createBrowserSession,
  createFixtureTransport,
  createTitleMatcher,
  defaultAdapterRegistry,
  fixtureRequestKey,
  himalayasPageUrl,
  linkedinAdapter,
  linkedInKeywords,
  linkedInSearchUrl,
  workdayListBody,
  type CollectContext,
  type TransportResponse,
} from "@ai-career/discovery";
import { createFixtureBrowser, jobPage, parsePage, searchPage } from "./linkedin-fixtures";

// Every source adapter that produces listings, collected from its committed
// fixture (trimmed from the real verification response; see each meta.json),
// with the same follow-up responses its own suite uses, so the listings can
// be followed through the shared normalizer and persistence. LinkedIn and
// Adzuna (implemented, unverified and disabled) use synthetic pages and a
// synthetic response in the shape their parsers read. Nothing reaches the
// network.

const fixtures = path.resolve("tests/fixtures/sources");
const read = (adapter: string, file: string) => readFileSync(path.join(fixtures, adapter, file), "utf8");
const json = (body: string | unknown): Omit<TransportResponse, "url"> => ({
  status: 200,
  contentType: "application/json",
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const html = (body: string): Omit<TransportResponse, "url"> => ({ status: 200, contentType: "text/html; charset=utf-8", body });

export const fixtureAdapterKeys = [
  "greenhouse", "lever", "ashby", "smartrecruiters", "remote-ok", "we-work-remotely", "himalayas", "working-nomads",
  "workday", "workable", "wellfound", "linkedin", "adzuna",
] as const;
export type FixtureAdapterKey = (typeof fixtureAdapterKeys)[number];

const configs: Record<FixtureAdapterKey, unknown> = {
  greenhouse: { board: "gitlab" },
  lever: { site: "palantir", company: "Palantir" },
  ashby: { board: "ashby", company: "Ashby" },
  smartrecruiters: { company: "BoschGroup", pageSize: 10 },
  "remote-ok": {},
  "we-work-remotely": {},
  himalayas: {},
  "working-nomads": {},
  workday: { careerSite: "https://workday.wd5.myworkdayjobs.com/Workday" },
  workable: {},
  wellfound: {},
  linkedin: {},
  adzuna: { country: "gb", query: "customer success" },
};

// A synthetic Adzuna search response (the adapter is unverified: no real
// response was ever captured): one advert with a stated (not predicted) GBP
// salary and one with a predicted salary, which is never taken.
export const adzunaSynthetic = {
  count: 2,
  results: [
    {
      id: "5001", title: "Customer Success Manager", description: "Own onboarding and renewals for UK customers.",
      redirect_url: "https://www.adzuna.co.uk/jobs/land/ad/5001?se=abc", created: "2026-10-15T09:00:00Z",
      company: { display_name: "Britco" }, location: { display_name: "London, UK" },
      salary_min: 45000, salary_max: 55000, salary_is_predicted: "0", contract_time: "full_time",
    },
    {
      id: "5002", title: "Customer Success Lead", description: "Lead a customer success team.",
      redirect_url: "https://www.adzuna.co.uk/jobs/land/ad/5002", created: "2026-10-16T09:00:00Z",
      company: { display_name: "Predictco" }, location: { display_name: "Leeds, UK" },
      salary_min: 50000, salary_max: 60000, salary_is_predicted: "1", contract_time: "full_time",
    },
  ],
};

export const keepAll = () => true;

export async function collectFixture(key: FixtureAdapterKey): Promise<RawOpportunity[]> {
  const adapter = defaultAdapterRegistry.get(key)!;
  const config = adapter.configSchema.parse(configs[key]);
  const responses: Record<string, Omit<TransportResponse, "url">> = {};
  const context: Partial<CollectContext> = { maxPages: 1, maxDetailRequests: 1 };
  if (key === "workday") {
    // Only the Customer Success posting's detail is in the fixture.
    context.keepTitle = createKeepCs();
    const listUrl = "https://workday.wd5.myworkdayjobs.com/wday/cxs/workday/Workday/jobs";
    responses[fixtureRequestKey(listUrl, workdayListBody(0))] = json(read("workday", "response.json"));
    responses["https://workday.wd5.myworkdayjobs.com/wday/cxs/workday/Workday/job/USA-IL-Chicago/Revenue-Operations-Director--Global-Customer-Success_JR-0110682"] =
      json(read("workday", "detail-JR-0110682.json"));
  } else if (key === "wellfound") {
    responses[adapter.verificationUrl(config)] = html(read("wellfound", "response.html"));
  } else if (key === "we-work-remotely") {
    responses[adapter.verificationUrl(config)] = { status: 200, contentType: "application/rss+xml", body: read("we-work-remotely", "response.rss") };
  } else if (key === "adzuna") {
    responses[adapter.verificationUrl(config).replace("%7BADZUNA_APP_ID%7D", "id").replace("%7BADZUNA_APP_KEY%7D", "key").replace("results_per_page=5", "results_per_page=50")] =
      json(adzunaSynthetic);
    context.env = { ADZUNA_APP_ID: "id", ADZUNA_APP_KEY: "key" };
  } else if (key !== "linkedin") {
    responses[adapter.verificationUrl(config)] = json(read(key, "response.json"));
  }
  if (key === "himalayas") {
    context.maxPages = 2;
    responses[himalayasPageUrl(JSON.parse(read("himalayas", "response.json")).nextCursor)] = json(read("himalayas", "response-page-2.json"));
  }
  if (key === "smartrecruiters") {
    responses["https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000156080369"] = json(read("smartrecruiters", "detail-744000156080369.json"));
  }
  const base: CollectContext = {
    transport: createFixtureTransport(responses),
    discovery: customerSuccessDiscoveryConfiguration,
    keepTitle: keepAll,
    env: {},
    now: () => new Date("2026-10-18T09:00:00.000Z"),
    maxPages: 1,
    maxDetailRequests: 1,
    ...context,
  };
  if (key === "linkedin") {
    const search = linkedInSearchUrl(config as never, linkedInKeywords(config as never, customerSuccessDiscoveryConfiguration.searchQueries), 0);
    const pages: Record<string, { status: number; html: string }> = {
      [search]: { status: 200, html: searchPage([{ id: "4100000001", title: "Customer Success Manager" }, { id: "4100000002", title: "Customer Success Lead" }]) },
    };
    const browser = createFixtureBrowser((url) => {
      if (pages[url]) return pages[url];
      if (url.endsWith("4100000001")) return { status: 200, html: jobPage({ id: "4100000001", title: "Customer Success Manager", company: "Applyco", applyUrl: "https://boards.greenhouse.io/applyco/jobs/77", salary: "$90,000/yr - $110,000/yr" }) };
      if (url.endsWith("4100000002")) return { status: 200, html: jobPage({ id: "4100000002", title: "Customer Success Lead", company: "Easyco", remote: true }) };
      return undefined;
    });
    base.maxDetailRequests = 2;
    base.lastChecked = async () => new Map();
    base.pendingListings = async () => [];
    base.browser = createBrowserSession(browser.driver, {
      minIntervalMs: 5_000,
      maxNavigations: linkedinAdapter.browser!.maxNavigations,
      authCookieNames: linkedinAdapter.browser!.authCookieNames!,
      detectFriction: linkedinAdapter.browser!.detectFriction!,
      parse: (body, url) => parsePage(body, url),
      sleep: async () => undefined,
    });
    const result = await linkedinAdapter.collect(base, linkedinAdapter.configSchema.parse({ maxDetailsPerRun: "2" }));
    return result.listings;
  }
  const result = await adapter.collect(base, config);
  if (result.issues.length) throw new Error(`${key}: ${JSON.stringify(result.issues)}`);
  return result.listings;
}

export const createKeepCs = () => createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms);
