// Feature 11B: the Workday, Workable and Wellfound adapters against their
// committed fixtures (trimmed from the real verification responses; see each
// meta.json), and the unverified Welcome to the Jungle registration. The
// fixture transport serves them; nothing reaches the network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rawOpportunitySchema, type RawOpportunity } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  createFixtureTransport,
  createTitleMatcher,
  defaultAdapterRegistry,
  fixtureRequestKey,
  parseWorkdayCareerSite,
  welcomeToTheJungleAdapter,
  wellfoundAdapter,
  workableAdapter,
  workableJobHtml,
  workablePageUrl,
  wellfoundPageUrl,
  workdayAdapter,
  workdayListBody,
  type CollectContext,
  type TransportResponse,
} from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";

const fixtures = path.resolve("tests/fixtures/sources");
const read = (adapter: string, file: string) => readFileSync(path.join(fixtures, adapter, file), "utf8");
const json = (body: unknown, status = 200): Omit<TransportResponse, "url"> => ({
  status,
  contentType: "application/json",
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const html = (body: string, status = 200): Omit<TransportResponse, "url"> => ({ status, contentType: "text/html; charset=utf-8", body });
const keepCs = createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms);

function context(transport: CollectContext["transport"], overrides: Partial<CollectContext> = {}): CollectContext {
  return {
    transport,
    discovery: customerSuccessDiscoveryConfiguration,
    keepTitle: keepCs,
    env: {},
    now: () => new Date("2026-10-18T18:00:00.000Z"),
    maxPages: 5,
    maxDetailRequests: 25,
    ...overrides,
  };
}

describe("Workday", () => {
  const config = workdayAdapter.configSchema.parse({ careerSite: "https://workday.wd5.myworkdayjobs.com/Workday" });
  const listUrl = "https://workday.wd5.myworkdayjobs.com/wday/cxs/workday/Workday/jobs";
  const detailBase = "https://workday.wd5.myworkdayjobs.com/wday/cxs/workday/Workday";
  const csPath = "/job/USA-IL-Chicago/Revenue-Operations-Director--Global-Customer-Success_JR-0110682";
  const page1 = () => JSON.parse(read("workday", "response.json")) as { total: number; jobPostings: Array<Record<string, any>> };
  const page2 = () => JSON.parse(read("workday", "response-page-2.json")) as { total: number; jobPostings: Array<Record<string, any>> };
  const detail = () => JSON.parse(read("workday", "detail-JR-0110682.json")) as Record<string, any>;
  const listKey = (offset: number) => fixtureRequestKey(listUrl, workdayListBody(offset));
  const run = (responses: Record<string, Omit<TransportResponse, "url">>, overrides: Partial<CollectContext> = {}, cfg = config) => {
    const transport = createFixtureTransport(responses);
    return workdayAdapter.collect(context(transport, overrides), cfg).then((result) => ({ result, requested: transport.requested }));
  };

  it("is a verified Type 3 ATS adapter whose verification request is the stateless JSON POST in the fixture metadata", () => {
    const meta = JSON.parse(read("workday", "meta.json"));
    expect(workdayAdapter).toMatchObject({ verified: true, retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT", sourceCategory: "ATS", sourceType: "ATS" });
    expect(meta.request).toBe(`POST ${workdayAdapter.verificationUrl(config)}`);
    expect(meta.requestBody).toEqual(workdayAdapter.verificationBody!(config));
    expect(meta.trimmedTo).toMatch(/^3 of \d+ items$/);
    expect(workdayAdapter.verificationFollowUpUrl!(page1(), config)).toBe(`${detailBase}${csPath}`);
  });

  it("reads the tenant and site from the career-site address and refuses anything else", () => {
    expect(parseWorkdayCareerSite("https://workday.wd5.myworkdayjobs.com/Workday")).toEqual({ host: "workday.wd5.myworkdayjobs.com", tenant: "workday", site: "Workday" });
    expect(parseWorkdayCareerSite("https://Acme.WD1.myworkdayjobs.com/en-US/External_Careers/")).toEqual({ host: "acme.wd1.myworkdayjobs.com", tenant: "acme", site: "External_Careers" });
    for (const bad of [
      "http://workday.wd5.myworkdayjobs.com/Workday",
      "https://workday.wd5.myworkdayjobs.com",
      "https://workday.wd5.myworkdayjobs.com/a/b/c",
      "https://workday.example.com/Workday",
      "https://workday.wd5.myworkdayjobs.com.evil.example/Workday",
      "https://workday.wd5.myworkdayjobs.com:8443/Workday",
      "not a url",
    ]) {
      expect(parseWorkdayCareerSite(bad)).toBeNull();
      expect(workdayAdapter.configSchema.safeParse({ careerSite: bad }).success).toBe(false);
    }
    expect(workdayAdapter.configSchema.safeParse({ careerSite: "https://workday.wd5.myworkdayjobs.com/Workday", company: "Workday" }).success).toBe(true);
  });

  it("filters list titles before any detail and maps the verified posting with its detail", async () => {
    const { result, requested } = await run({ [listKey(0)]: json(read("workday", "response.json")), [`${detailBase}${csPath}`]: json(read("workday", "detail-JR-0110682.json")) });
    // Three postings (a short page): no page 2; one title matches.
    expect(requested).toEqual([listKey(0), `${detailBase}${csPath}`]);
    expect(result).toMatchObject({ fetched: 3, requests: 2, issues: [], halted: null });
    const [listing] = result.listings;
    expect(rawOpportunitySchema.safeParse(listing).success).toBe(true);
    expect(listing).toMatchObject({
      source: "workday",
      sourceType: "ATS",
      externalId: `workday/Workday:${csPath}`,
      requisitionId: "JR-0110682",
      title: "Revenue Operations Director for the Customer Success & Solutions COE",
      company: "Workday, Inc.",
      location: "USA, IL, Chicago; USA, NY, New York City; USA, UT, Salt Lake City; USA, GA, Atlanta; USA, CO, Boulder; USA, CA, Pleasanton",
      employmentType: "Full Time",
      postingDate: "2026-10-15T00:00:00.000Z",
      sourceUrl: `https://workday.wd5.myworkdayjobs.com/Workday${csPath}`,
      applicationUrl: `https://workday.wd5.myworkdayjobs.com/Workday${csPath}`,
      retrieval: { retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT", sourceCategory: "ATS" },
    });
    expect(listing!.sourceMetadata).toMatchObject({
      tenant: "workday",
      site: "Workday",
      postingId: "8fbf50b59b921000cabe0156849f0000",
      remoteType: "Flex",
      postedOn: "Posted 3 Days Ago",
      endDate: "2026-11-30",
      structured: { workplaceType: null },
    });
    expect(listing!.sourceMetadata).not.toHaveProperty("companySource");
    expect(listing!.description).toContain("About the Role");
    expect(listing!.description).not.toMatch(/<\/?[a-z][^>]*>|&#\d+;|&amp;/i);
    expect(JSON.stringify(listing!.rawPayload)).not.toContain("similarJobs");
    const { opportunity } = await createRetrievedOpportunityNormalizer().normalize(listing!);
    expect(opportunity).toMatchObject({ status: "DISCOVERED", timeZoneRequirements: null, atsRequisitionId: "JR-0110682" });
    // Several location-dependent pay ranges in the text: never normalized.
    expect(opportunity.salaryMin).toBeNull();
    expect(opportunity.salaryMax).toBeNull();
  });

  it("maps Remote and Onsite only; Flex stays source data", async () => {
    const withRemote = (remoteType: string) => {
      const value = detail();
      value.jobPostingInfo.remoteType = remoteType;
      return run({ [listKey(0)]: json(read("workday", "response.json")), [`${detailBase}${csPath}`]: json(value) });
    };
    const workplaceOf = async (remoteType: string) => ((await withRemote(remoteType)).result.listings[0]!.sourceMetadata as any).structured.workplaceType;
    expect(await workplaceOf("Remote")).toBe("REMOTE");
    expect(await workplaceOf("Onsite")).toBe("ONSITE");
    expect(await workplaceOf("Flex")).toBeNull();
    expect(await workplaceOf("Hybrid")).toBeNull();
  });

  it("uses the configured company only when the detail names no hiring organization", async () => {
    const value = detail();
    delete value.hiringOrganization;
    const responses = { [listKey(0)]: json(read("workday", "response.json")), [`${detailBase}${csPath}`]: json(value) };
    const configured = await run(responses, {}, workdayAdapter.configSchema.parse({ careerSite: "https://workday.wd5.myworkdayjobs.com/Workday", company: "Workday" }));
    expect(configured.result.listings[0]).toMatchObject({ company: "Workday", sourceMetadata: { companySource: "configured" } });
    const { provenance } = await createRetrievedOpportunityNormalizer().normalize(configured.result.listings[0]!);
    expect(provenance.find((row) => row.fieldName === "company.name")?.sourceField).toBe("sourceConfiguration.company");
    const none = await run(responses);
    expect(none.result.listings[0]!.company).toBeNull();
  });

  it("qualifies listing ids by tenant and site, so the same path at two tenants is two listings", async () => {
    const other = workdayAdapter.configSchema.parse({ careerSite: "https://acme.wd1.myworkdayjobs.com/External" });
    const responses = {
      [fixtureRequestKey("https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/jobs", workdayListBody(0))]: json(read("workday", "response.json")),
      [`https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External${csPath}`]: json(read("workday", "detail-JR-0110682.json")),
    };
    const { result } = await run(responses, {}, other);
    expect(result.listings[0]!.externalId).toBe(`acme/External:${csPath}`);
    expect(result.listings[0]!.requisitionId).toBe("JR-0110682");
  });

  it("never treats daily-changing fields as a change, but a description change is one", async () => {
    const hashOf = async (edit: (value: Record<string, any>) => void) => {
      const value = detail();
      edit(value);
      const { result } = await run({ [listKey(0)]: json(read("workday", "response.json")), [`${detailBase}${csPath}`]: json(value) });
      return result.listings[0]!.retrieval!.contentHash;
    };
    const base = await hashOf(() => undefined);
    expect(
      await hashOf((value) => {
        value.jobPostingInfo.postedOn = "Posted 4 Days Ago";
        value.jobPostingInfo.timeLeftToApply = "29 days left to apply";
        value.similarJobs = [];
      }),
    ).toBe(base);
    expect(await hashOf((value) => { value.jobPostingInfo.jobDescription += "<p>Lead quarterly business reviews.</p>"; })).not.toBe(base);
  });

  it("refuses a posting path that is not a job path on the same site", async () => {
    const list = page1();
    // The fixture's first posting is the Customer Success one.
    list.jobPostings[1]!.externalPath = "https://evil.example/job/x";
    list.jobPostings[2]!.externalPath = "/job/../wday/other";
    const { result, requested } = await run({ [listKey(0)]: json(list), [`${detailBase}${csPath}`]: json(read("workday", "detail-JR-0110682.json")) });
    expect(requested).toEqual([listKey(0), `${detailBase}${csPath}`]);
    expect(result.issues).toHaveLength(2);
    expect(result.listings).toHaveLength(1);
  });

  describe("paging", () => {
    // Page 1 filled to the page size with copies that match no role term.
    function fullPage1() {
      const page = page1();
      const base = page.jobPostings[1]!;
      for (let index = 0; page.jobPostings.length < 20; index += 1) {
        page.jobPostings.push({ ...base, title: `Warehouse Associate ${index}`, externalPath: `/job/Costa-Rica/Warehouse-Associate_JR-99${index}` });
      }
      return page;
    }

    it("reads the verified page 2 by offset (whose total is 0) and stops at its short page", async () => {
      expect(page2().total).toBe(0);
      const { result, requested } = await run(
        { [listKey(0)]: json(fullPage1()), [listKey(20)]: json(read("workday", "response-page-2.json")) },
        { maxDetailRequests: 0 },
      );
      expect(requested).toEqual([listKey(0), listKey(20)]);
      expect(result).toMatchObject({ fetched: 23, halted: null });
    });

    it("stops at the first page's total, ignoring the later pages' zero", async () => {
      const second = page2();
      while (second.jobPostings.length < 20) second.jobPostings.push({ ...second.jobPostings[1], externalPath: `/job/x/Filler_JR-77${second.jobPostings.length}` });
      const responses = { [listKey(0)]: json({ ...fullPage1(), total: 40 }), [listKey(20)]: json(second), [listKey(40)]: json({ total: 0, jobPostings: [] }) };
      expect((await run(responses, { maxDetailRequests: 0 })).requested).toEqual([listKey(0), listKey(20)]);
      // Without a first-page total, paging continues to the empty page.
      expect((await run({ ...responses, [listKey(0)]: json({ ...fullPage1(), total: null }) }, { maxDetailRequests: 0 })).requested).toEqual([listKey(0), listKey(20), listKey(40)]);
      // The page cap always holds.
      expect((await run(responses, { maxDetailRequests: 0, maxPages: 1 })).requested).toEqual([listKey(0)]);
    });

    it("reads a posting shifted onto the next page once", async () => {
      const first = fullPage1();
      const second = page2();
      second.jobPostings.unshift(first.jobPostings[19]!);
      const { result } = await run({ [listKey(0)]: json(first), [listKey(20)]: json(second) }, { keepTitle: () => true, maxDetailRequests: 0 });
      expect(result.fetched).toBe(24);
    });

    it("stops everything after a 429, an access refusal or a server error on a later page; the first page's failure fails the run", async () => {
      for (const status of [429, 401, 403, 500, 503]) {
        const { result, requested } = await run({ [listKey(0)]: json(fullPage1()), [listKey(20)]: json({}, status) });
        expect(result.halted?.code).toBe(status === 429 ? "RATE_LIMITED" : status >= 500 ? "SERVER_ERROR" : "ACCESS_DENIED");
        expect(requested).toEqual([listKey(0), listKey(20)]);
        expect(result.listings).toEqual([]);
      }
      await expect(run({ [listKey(0)]: json({}, 403) })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      await expect(run({ [listKey(0)]: json({ unexpected: true }) })).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
    });
  });

  describe("detail priority", () => {
    // Four matching postings in list order (the list has no absolute dates).
    const matching = () => {
      const page = page1();
      const base = page.jobPostings[0]!;
      page.jobPostings = ["a", "b", "c", "d"].map((letter) => ({ ...base, title: `Customer Success Manager ${letter}`, externalPath: `/job/x/CSM-${letter}_JR-${letter}` }));
      return page;
    };
    const idOf = (letter: string) => `workday/Workday:/job/x/CSM-${letter}_JR-${letter}`;
    const requestedDetails = (requested: string[]) => requested.filter((key) => !key.startsWith("POST ")).map((url) => url.slice(-1));

    it("fetches unseen postings first (latest list position first), then stored ones by oldest check, within the cap", async () => {
      const lookups: string[][] = [];
      const lastChecked = async (ids: readonly string[]) => {
        lookups.push([...ids]);
        return new Map([[idOf("d"), new Date("2026-10-17T00:00:00Z")], [idOf("a"), new Date("2026-10-16T00:00:00Z")]]);
      };
      const { requested } = await run({ [listKey(0)]: json(matching()) }, { lastChecked, maxDetailRequests: 3 });
      // Unseen c, b (c is later in the list); then the stored a (checked before d).
      expect(requestedDetails(requested)).toEqual(["c", "b", "a"]);
      expect(lookups[0]!.sort()).toEqual(["a", "b", "c", "d"].map(idOf).sort());
      const capped = await run({ [listKey(0)]: json(matching()) }, { lastChecked, maxDetailRequests: 1 });
      expect(requestedDetails(capped.requested)).toEqual(["c"]);
    });

    it("stops requesting details after a 429 and keeps a missing posting as that listing's issue", async () => {
      const limited = await run({ [listKey(0)]: json(matching()), [`${detailBase}/job/x/CSM-d_JR-d`]: json({}, 429) });
      expect(limited.result.halted?.code).toBe("RATE_LIMITED");
      expect(requestedDetails(limited.requested)).toEqual(["d"]);
      // Any server error stops detail requests too (feature 12).
      const serverError = await run({ [listKey(0)]: json(matching()), [`${detailBase}/job/x/CSM-d_JR-d`]: json({}, 500) });
      expect(serverError.result.halted?.code).toBe("SERVER_ERROR");
      expect(requestedDetails(serverError.requested)).toEqual(["d"]);
      const missing = await run({ [listKey(0)]: json(matching()), [`${detailBase}/job/x/CSM-d_JR-d`]: json({}, 404) }, { maxDetailRequests: 2 });
      expect(missing.result.halted).toBeNull();
      expect(missing.result.issues.map((issue) => issue.externalId)).toEqual([idOf("d"), idOf("c")]);
    });
  });
});

describe("Workable", () => {
  const page1Url = "https://jobs.workable.com/api/v1/jobs?query=customer%20success";
  const page1 = () => JSON.parse(read("workable", "response.json")) as { totalSize: number; nextPageToken: string; jobs: Array<Record<string, any>> };
  const page2 = () => JSON.parse(read("workable", "response-page-2.json")) as { totalSize: number; nextPageToken: string; jobs: Array<Record<string, any>> };
  const run = (responses: Record<string, Omit<TransportResponse, "url">>, overrides: Partial<CollectContext> = {}) => {
    const transport = createFixtureTransport(responses);
    return workableAdapter.collect(context(transport, overrides), {}).then((result) => ({ result, requested: transport.requested }));
  };
  const byId = (listings: RawOpportunity[], id: string) => listings.find((listing) => listing.externalId === id)!;

  it("is a verified Type 3 global job-search adapter with no configuration, verified with the request in the fixture metadata", () => {
    const meta = JSON.parse(read("workable", "meta.json"));
    expect(workableAdapter).toMatchObject({ verified: true, retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT", sourceCategory: "JOB_BOARD", sourceType: "PUBLIC_SEARCH", configFields: [] });
    expect(meta.request).toBe(`GET ${workableAdapter.verificationUrl({})}`);
    expect(meta.page2.request).toBe(`GET ${workablePageUrl(page1().nextPageToken)}`);
    expect(workableAdapter.verificationFollowUpUrl!(page1(), {})).toBe(workablePageUrl(page1().nextPageToken));
    expect(meta.trimmedTo).toBe("3 of 20 items");
  });

  it("maps the jobs with their complete text, keeping only role-family titles", async () => {
    const { result } = await run({ [page1Url]: json(read("workable", "response.json")) }, { maxPages: 1 });
    expect(result).toMatchObject({ fetched: 3, issues: [], halted: null });
    // The non-English title has no role-family term and is not kept.
    expect(result.listings.map((listing) => listing.externalId)).toEqual(["1671f9c9-4f39-44b7-b44a-5889b15bfafd", "0686d816-4047-43c8-8fc9-e73eb6aa2bf2"]);
    const trackier = byId(result.listings, "1671f9c9-4f39-44b7-b44a-5889b15bfafd");
    expect(rawOpportunitySchema.safeParse(trackier).success).toBe(true);
    expect(trackier).toMatchObject({
      source: "workable",
      sourceType: "PUBLIC_SEARCH",
      title: "Customer Success - Apptrove (Onboarding & Account Management)",
      company: "Trackier",
      location: "Noida, Uttar Pradesh, India",
      employmentType: "Full-time",
      postingDate: "2026-10-15T12:05:31.812Z",
      sourceUrl: expect.stringMatching(/^https:\/\/jobs\.workable\.com\/view\//),
      retrieval: { retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT", sourceCategory: "JOB_BOARD" },
    });
    expect(trackier.sourceMetadata).toMatchObject({ department: "Customer Success", workplace: "on_site", remote: false, structured: { workplaceType: "ONSITE" } });
    // Description, then the requirements and benefits sections.
    const job = page1().jobs[0]!;
    expect(workableJobHtml(job)).toBe(`${job.description}<h3>Requirements</h3>${job.requirementsSection}<h3>Benefits</h3>${job.benefitsSection}`);
    expect(trackier.description).toContain("Requirements");
    expect(trackier.description).toContain("Benefits");
    expect(trackier.description).toContain("B.Tech/BE degree is mandatory.");
    expect(trackier.description).not.toMatch(/<\/?[a-z][^>]*>|&amp;/i);
    const clickview = byId(result.listings, "0686d816-4047-43c8-8fc9-e73eb6aa2bf2");
    // TELECOMMUTE marks remote work and is not a place; empty sections add nothing.
    expect(clickview).toMatchObject({ location: "United States" });
    expect(clickview.sourceMetadata).toMatchObject({ remote: true, workplace: "remote", structured: { workplaceType: "REMOTE" } });
    expect(clickview.description).not.toContain("Requirements\n");
    for (const listing of result.listings) {
      const { opportunity } = await createRetrievedOpportunityNormalizer().normalize(listing);
      expect(opportunity).toMatchObject({ status: "DISCOVERED", timeZoneRequirements: null });
    }
  });

  it("follows nextPageToken as pageToken up to the page cap, stopping when no token comes back", async () => {
    const page2Url = workablePageUrl(page1().nextPageToken);
    const page3Url = workablePageUrl(page2().nextPageToken);
    expect(page2Url).toBe(`${page1Url}&pageToken=${encodeURIComponent(page1().nextPageToken)}`);
    const responses = {
      [page1Url]: json(read("workable", "response.json")),
      [page2Url]: json(read("workable", "response-page-2.json")),
      [page3Url]: json({ ...page2(), jobs: [], nextPageToken: null }),
    };
    const { result, requested } = await run(responses);
    expect(requested).toEqual([page1Url, page2Url, page3Url]);
    expect(result).toMatchObject({ fetched: 6, halted: null });
    expect(result.listings).toHaveLength(5);
    expect((await run(responses, { maxPages: 2 })).requested).toEqual([page1Url, page2Url]);
    const last = await run({ ...responses, [page2Url]: json({ ...page2(), nextPageToken: null }) });
    expect(last.requested).toEqual([page1Url, page2Url]);
  });

  it("stops on a later page's 429 keeping page 1, and a first-page refusal fails the run", async () => {
    const page2Url = workablePageUrl(page1().nextPageToken);
    const limited = await run({ [page1Url]: json(read("workable", "response.json")), [page2Url]: json({ error: "rate_limit" }, 429) });
    expect(limited.result.halted?.code).toBe("RATE_LIMITED");
    expect(limited.result.listings).toHaveLength(2);
    await expect(run({ [page1Url]: json({ error: "rate_limit" }, 429) })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(run({ [page1Url]: json({}, 403) })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("never treats freshness or search metadata as a change, but a requirements change is one", async () => {
    const hashOf = async (edit: (value: ReturnType<typeof page1>) => void) => {
      const value = page1();
      edit(value);
      return (await run({ [page1Url]: json(value) }, { maxPages: 1 })).result.listings[0]!.retrieval!.contentHash;
    };
    const base = await hashOf(() => undefined);
    expect(
      await hashOf((value) => {
        value.jobs[0]!.updated = "2026-10-19T00:00:00.000Z";
        value.jobs[0]!.isFeatured = true;
        value.totalSize = 4000;
        value.nextPageToken = "other";
      }),
    ).toBe(base);
    expect(await hashOf((value) => { value.jobs[0]!.requirementsSection += "<p>Fluent German.</p>"; })).not.toBe(base);
  });
});

describe("Wellfound", () => {
  const fixture = () => read("wellfound", "response.html");
  const page1Url = "https://wellfound.com/role/customer-success-specialist";
  const run = (responses: Record<string, Omit<TransportResponse, "url">>, overrides: Partial<CollectContext> = {}) => {
    const transport = createFixtureTransport(responses);
    return wellfoundAdapter.collect(context(transport, { maxPages: wellfoundAdapter.maxPagesPerRun!, ...overrides }), {}).then((result) => ({ result, requested: transport.requested }));
  };
  // The fixture's embedded state, changed and written back into the page.
  function editState(change: (state: any) => void, source = fixture()) {
    return source.replace(/(<script id="__NEXT_DATA__"[^>]*>)(.*?)(<\/script>)/s, (_all, open: string, body: string, close: string) => {
      const state = JSON.parse(body);
      change(state);
      return `${open}${JSON.stringify(state)}${close}`;
    });
  }
  const resultsOf = (state: any) => {
    const talent = state.props.pageProps.apolloState.data.ROOT_QUERY.talent;
    return talent[Object.keys(talent).find((key) => key.startsWith("seoLandingPageJobSearchResults("))!];
  };
  const byId = (listings: RawOpportunity[], id: string) => listings.find((listing) => listing.externalId === id)!;

  it("is a verified Type 4 marketplace adapter with the approved 2-second interval and 11-page cap", () => {
    const meta = JSON.parse(read("wellfound", "meta.json"));
    expect(wellfoundAdapter).toMatchObject({ verified: true, retrievalType: "PUBLIC_HTML", sourceCategory: "MARKETPLACE", sourceType: "PUBLIC_SEARCH", minRequestIntervalMs: 2000, maxPagesPerRun: 11 });
    expect(meta.request).toBe(`GET ${wellfoundAdapter.verificationUrl({})}`);
    expect(meta.trimmedTo).toBe("3 of 39 items");
    expect(wellfoundAdapter.configFields).toEqual([]);
    expect(wellfoundPageUrl(1)).toBe(page1Url);
    expect(wellfoundPageUrl(3)).toBe(`${page1Url}?page=3`);
  });

  it("reads listings from the embedded state, keeps Customer Success titles and their complete descriptions", async () => {
    const all = await run({ [page1Url]: html(fixture()) }, { keepTitle: () => true, maxPages: 1 });
    expect(all.result).toMatchObject({ fetched: 3, issues: [], halted: null });
    expect(all.result.listings.map((listing) => listing.externalId)).toEqual(["1716423", "4829861", "3886599"]);
    const { result, requested } = await run({ [page1Url]: html(fixture()) });
    // pageCount is 11, but page 2 is not in the fixture transport: a later
    // page's failure stops paging and keeps page 1.
    expect(requested.slice(0, 2)).toEqual([page1Url, `${page1Url}?page=2`]);
    expect(result.halted?.code).toBe("NETWORK");
    expect(result.listings.map((listing) => listing.externalId)).toEqual(["1716423", "4829861"]);
    const pragma = byId(result.listings, "1716423");
    expect(rawOpportunitySchema.safeParse(pragma).success).toBe(true);
    expect(pragma).toMatchObject({
      source: "wellfound",
      sourceType: "PUBLIC_SEARCH",
      title: "Customer Success Specialist",
      company: "Pragma (formerly Logisy)",
      location: "Bengaluru",
      employmentType: "full-time",
      postingDate: "2026-09-23T13:28:12.000Z",
      salaryText: null,
      sourceUrl: "https://wellfound.com/jobs/1716423-customer-success-specialist",
      applicationUrl: "https://wellfound.com/jobs/1716423-customer-success-specialist",
      retrieval: { retrievalType: "PUBLIC_HTML", sourceCategory: "MARKETPLACE" },
    });
    expect(pragma.sourceMetadata).toMatchObject({ compensation: "₹30,000 – ₹50,000", remoteKind: "ONSITE", companyId: "8170167", structured: { workplaceType: "ONSITE" } });
    expect(pragma.description).toContain("Facilitating the successful onboarding of new customers");
    expect(pragma.description).not.toMatch(/\*\*|###|&amp;/);
    const medsender = byId(result.listings, "4829861");
    expect(medsender).toMatchObject({ company: "Medsender", location: "United States; New York" });
    // remote: true without a remote kind is not read as a workplace type.
    expect(medsender.sourceMetadata).toMatchObject({ remote: true, remoteKind: null, atsSource: "AtsIntegration::Ashby::Listing", structured: { workplaceType: null } });
    for (const listing of result.listings) {
      const { opportunity } = await createRetrievedOpportunityNormalizer().normalize(listing);
      expect(opportunity.status).toBe("DISCOVERED");
      // Compensation text is source data only.
      expect(opportunity.salaryMin).toBeNull();
      expect(opportunity.timeZoneRequirements).toBeNull();
    }
  });

  it("dedupes repeated location names and resolves a remote configuration stored by reference", async () => {
    const page = editState((state) => {
      const data = state.props.pageProps.apolloState.data;
      data["JobListingSearchResult:1716423"].remoteConfig = { __ref: "JobListingRemoteConfig:1" };
      data["JobListingRemoteConfig:1"] = { __typename: "JobListingRemoteConfig", id: "1", kind: "REMOTE", wfhFlexible: false };
      resultsOf(state).pageCount = 1;
    });
    const { result } = await run({ [page1Url]: html(page) });
    const pragma = byId(result.listings, "1716423");
    expect(pragma.location).toBe("Bengaluru");
    expect(pragma.sourceMetadata).toMatchObject({ remoteKind: "REMOTE", structured: { workplaceType: "REMOTE" } });
  });

  it("follows ?page=N up to the verified page count, stopping early on an empty page or the cap", async () => {
    const pageWith = (count: number, suffix: string) =>
      editState((state) => {
        resultsOf(state).pageCount = count;
        const data = state.props.pageProps.apolloState.data;
        for (const key of Object.keys(data).filter((name) => name.startsWith("JobListingSearchResult:"))) data[key].id = `${data[key].id}${suffix}`;
      });
    const three = { [page1Url]: html(pageWith(3, "")), [`${page1Url}?page=2`]: html(pageWith(3, "2")), [`${page1Url}?page=3`]: html(pageWith(3, "3")) };
    const full = await run(three);
    expect(full.requested).toEqual([page1Url, `${page1Url}?page=2`, `${page1Url}?page=3`]);
    expect(full.result.listings).toHaveLength(6);
    expect(full.result.halted).toBeNull();
    const empty = editState((state) => { resultsOf(state).startups = []; resultsOf(state).pageCount = 3; });
    expect((await run({ ...three, [`${page1Url}?page=2`]: html(empty) })).requested).toEqual([page1Url, `${page1Url}?page=2`]);
    expect((await run(three, { maxPages: 2 })).requested).toEqual([page1Url, `${page1Url}?page=2`]);
    const limited = await run({ ...three, [`${page1Url}?page=2`]: html("{}", 429) });
    expect(limited.result.halted?.code).toBe("RATE_LIMITED");
    expect(limited.result.listings).toHaveLength(2);
  });

  it("treats a page without the verified state as a contract change, never a guess", async () => {
    await expect(run({ [page1Url]: html("<html><body>Checking your browser…</body></html>") })).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
    await expect(run({ [page1Url]: html(editState((state) => { state.props.pageProps.apolloState.data.ROOT_QUERY.talent = {}; })) })).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
    await expect(run({ [page1Url]: html(editState((state) => { resultsOf(state).startups = [{ __ref: "StartupResult:missing" }]; })) })).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
    await expect(run({ [page1Url]: html("", 403) })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("ignores presentation fields in change detection but notices a compensation change", async () => {
    const hashOf = async (page: string) => (await run({ [page1Url]: html(page) }, { maxPages: 1 })).result.listings[0]!.retrieval!.contentHash;
    const base = await hashOf(fixture());
    const presentation = editState((state) => {
      const data = state.props.pageProps.apolloState.data;
      data["JobListingSearchResult:1716423"].isBookmarked = true;
      for (const key of Object.keys(data).filter((name) => name.startsWith("StartupResult:"))) data[key].logoUrl = `${data[key].logoUrl}&buster=2`;
      resultsOf(state).totalJobCount = 999;
    });
    expect(await hashOf(presentation)).toBe(base);
    expect(await hashOf(editState((state) => { state.props.pageProps.apolloState.data["JobListingSearchResult:1716423"].compensation = "₹40,000 – ₹60,000"; }))).not.toBe(base);
  });
});

describe("Welcome to the Jungle / Otta", () => {
  it("is registered as Type 3 but unverified, so it cannot be enabled or collect anything", async () => {
    expect(defaultAdapterRegistry.get("welcome-to-the-jungle")).toBe(welcomeToTheJungleAdapter);
    expect(welcomeToTheJungleAdapter).toMatchObject({ verified: false, retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT", sourceCategory: "JOB_BOARD" });
    await expect(welcomeToTheJungleAdapter.collect(context(createFixtureTransport({})), {})).rejects.toMatchObject({ code: "CONFIG" });
  });
});
