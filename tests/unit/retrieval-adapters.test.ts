// Feature 11A: each verified source adapter against its committed fixture
// (trimmed from the real verification response; see each meta.json). The
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
  himalayasPageUrl,
  prioritizeDetailRequests,
  splitWwrTitle,
  workingNomadsId,
  type AnySourceAdapter,
  type CollectContext,
} from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";

const fixtures = path.resolve("tests/fixtures/sources");
const read = (adapter: string, file: string) => readFileSync(path.join(fixtures, adapter, file), "utf8");
const meta = (adapter: string) => JSON.parse(read(adapter, "meta.json")) as { request: string; trimmedTo: string; sanitization: unknown[] };

const configs: Record<string, unknown> = {
  greenhouse: { board: "gitlab" },
  lever: { site: "palantir", company: "Palantir" },
  ashby: { board: "ashby", company: "Ashby" },
  smartrecruiters: { company: "BoschGroup", pageSize: 10 },
  "remote-ok": {},
  "we-work-remotely": {},
  himalayas: {},
  "working-nomads": {},
};

function adapter(key: string): AnySourceAdapter {
  return defaultAdapterRegistry.get(key)!;
}

// Collects from the fixture, optionally with the body changed first.
async function collect(key: string, options: { keepAll?: boolean; edit?: (body: string) => string; editDetail?: (body: string) => string } = {}) {
  const source = adapter(key);
  const config = source.configSchema.parse(configs[key]);
  const file = key === "we-work-remotely" ? "response.rss" : "response.json";
  const body = (options.edit ?? ((value: string) => value))(read(key, file));
  const url = source.verificationUrl(config);
  const responses: Record<string, { status: number; contentType: string; body: string }> = {
    [url]: { status: 200, contentType: "application/json", body },
  };
  // The follow-up responses verified with each source: Himalayas page 2
  // (cursor paging) and the SmartRecruiters posting detail.
  if (key === "himalayas") {
    responses[himalayasPageUrl(JSON.parse(read("himalayas", "response.json")).nextCursor)] = {
      status: 200, contentType: "application/json", body: read("himalayas", "response-page-2.json"),
    };
  }
  if (key === "smartrecruiters") {
    responses["https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000156080369"] = {
      status: 200, contentType: "application/json", body: (options.editDetail ?? ((value: string) => value))(read("smartrecruiters", "detail-744000156080369.json")),
    };
  }
  const context: CollectContext = {
    transport: createFixtureTransport(responses),
    discovery: customerSuccessDiscoveryConfiguration,
    keepTitle: options.keepAll ? () => true : createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms),
    env: {},
    now: () => new Date("2026-10-18T09:00:00.000Z"),
    // Two pages: Himalayas page 2 was verified; page 3 was never requested.
    maxPages: 2,
    // One detail: the SmartRecruiters posting whose detail was verified is
    // first in its fixture.
    maxDetailRequests: 1,
  };
  return source.collect(context, config);
}

const editJson = (change: (value: any) => void) => (body: string) => {
  const value = JSON.parse(body);
  change(value);
  return JSON.stringify(value);
};

const byId = (listings: RawOpportunity[], id: string) => listings.find((listing) => listing.externalId === id)!;

describe("verified adapters: common contract", () => {
  it.each(Object.keys(configs))("%s maps every fixture listing to a valid retrieved RawOpportunity", async (key) => {
    const fixture = meta(key);
    expect(adapter(key).verified).toBe(true);
    // The fixture was captured with the adapter's own verification request.
    expect(fixture.request).toBe(`GET ${adapter(key).verificationUrl(adapter(key).configSchema.parse(configs[key]))}`);
    expect(fixture.trimmedTo).toMatch(/^3 of \d+ items$/);
    const result = await collect(key, { keepAll: true });
    expect(result.issues).toEqual([]);
    expect(result.halted).toBeNull();
    expect(result.listings).toHaveLength(key === "himalayas" ? 6 : key === "smartrecruiters" ? 1 : 3);
    const normalizer = createRetrievedOpportunityNormalizer();
    for (const listing of result.listings) {
      expect(rawOpportunitySchema.safeParse(listing).success).toBe(true);
      expect(listing.source).toBe(key);
      expect(listing.externalId).toBeTruthy();
      expect(listing.description!.length).toBeGreaterThan(200);
      expect(listing.description).not.toMatch(/<\/?[a-z][^>]*>|&lt;|&amp;nbsp;/i);
      expect(Object.keys(listing.rawPayload as object)).toEqual(["source"]);
      expect(JSON.stringify(listing.rawPayload)).not.toContain("postingHistory");
      expect(listing.retrieval?.contentHash).toMatch(/^[0-9a-f]{64}$/);
      const { opportunity } = await normalizer.normalize(listing);
      expect(opportunity.timeZoneRequirements).toBeNull();
      expect(opportunity.status).toBe("DISCOVERED");
    }
  });

  it.each(Object.keys(configs))("%s re-collected unchanged gives identical content hashes", async (key) => {
    const first = await collect(key, { keepAll: true });
    const second = await collect(key, { keepAll: true });
    expect(second.listings.map((listing) => listing.retrieval!.contentHash)).toEqual(first.listings.map((listing) => listing.retrieval!.contentHash));
  });

  it("keeps only Customer Success role-family titles", async () => {
    const kept = Object.fromEntries(
      await Promise.all(Object.keys(configs).map(async (key) => [key, (await collect(key)).listings.map((listing) => listing.title)])),
    );
    expect(kept).toEqual({
      greenhouse: ["Customer Success Architect"],
      lever: ["Forward Deployed Enablement Engineer - Customer Success"],
      ashby: ["Founding Customer Success Manager - APAC"],
      smartrecruiters: [],
      "remote-ok": ["Customer Success Associate", "Consultant Implementation Engineer"],
      "we-work-remotely": ["Lead Enterprise Revenue Architect (Customer Success)", "Scaled Customer Success Manager"],
      himalayas: [],
      // Its category is Customer Success, but only the title is matched.
      "working-nomads": [],
    });
  });

  it("records no sanitization for any fixture", () => {
    for (const key of Object.keys(configs)) expect(meta(key).sanitization).toEqual([]);
  });

  it("registers SmartRecruiters (verified against BoschGroup) and keeps Adzuna unverified", () => {
    expect(defaultAdapterRegistry.get("smartrecruiters")?.verified).toBe(true);
    expect(defaultAdapterRegistry.get("adzuna")?.verified).toBe(false);
  });
});

describe("Greenhouse", () => {
  it("maps the listing ID, requisition ID, company, location, URL and the double-escaped description", async () => {
    const listing = byId((await collect("greenhouse", { keepAll: true })).listings, "8877426002");
    expect(listing).toMatchObject({
      sourceType: "ATS",
      requisitionId: "7173",
      title: "Customer Success Architect",
      company: "GitLab",
      location: "Remote, United States",
      sourceUrl: "https://job-boards.greenhouse.io/gitlab/jobs/8877426002",
      applicationUrl: "https://job-boards.greenhouse.io/gitlab/jobs/8877426002",
      postingDate: "2026-10-16T15:58:24-04:00",
      retrieval: { sourceCategory: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED" },
    });
    expect(listing.sourceMetadata).toMatchObject({ board: "gitlab", sourceName: "Greenhouse", structured: { salaryMin: null, workplaceType: null } });
    expect(listing.description).toMatch(/^GitLab is/);
  });

  it("does not treat a changed updated_at as a change, but does a changed description", async () => {
    const original = (await collect("greenhouse", { keepAll: true })).listings[0]!;
    const touched = (await collect("greenhouse", { keepAll: true, edit: editJson((value) => { value.jobs[0].updated_at = "2026-10-18T08:00:00-04:00"; }) })).listings[0]!;
    expect(touched.retrieval!.contentHash).toBe(original.retrieval!.contentHash);
    expect((touched.sourceMetadata as { updatedAt: string }).updatedAt).toBe("2026-10-18T08:00:00-04:00");
    const edited = (await collect("greenhouse", { keepAll: true, edit: editJson((value) => { value.jobs[0].content += "&lt;p&gt;New responsibility.&lt;/p&gt;"; }) })).listings[0]!;
    expect(edited.retrieval!.contentHash).not.toBe(original.retrieval!.contentHash);
    const moved = (await collect("greenhouse", { keepAll: true, edit: editJson((value) => { value.jobs[0].location.name = "Remote, Canada"; }) })).listings[0]!;
    expect(moved.retrieval!.contentHash).not.toBe(original.retrieval!.contentHash);
  });

  it("reports a changed response contract instead of guessing", async () => {
    await expect(collect("greenhouse", { edit: () => JSON.stringify({ postings: [] }) })).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });
});

describe("Lever", () => {
  it("joins description, lists and additional text, and maps workplace type and commitment", async () => {
    const listings = (await collect("lever", { keepAll: true })).listings;
    const cs = byId(listings, "00c2c97b-8514-4617-9883-e53e486b6dcd");
    expect(cs).toMatchObject({
      company: "Palantir",
      location: "London, United Kingdom",
      employmentType: "Full-time",
      postingDate: new Date(1731430306017).toISOString(),
      sourceUrl: "https://jobs.lever.co/palantir/00c2c97b-8514-4617-9883-e53e486b6dcd",
      applicationUrl: "https://jobs.lever.co/palantir/00c2c97b-8514-4617-9883-e53e486b6dcd/apply",
    });
    expect(cs.sourceMetadata).toMatchObject({ companySource: "configured", structured: { workplaceType: "HYBRID" } });
    const source = JSON.parse(read("lever", "response.json"))[0];
    for (const list of source.lists) expect(cs.description).toContain(list.text.trim());
    expect(cs.description).toContain("- ");
    expect(byId(listings, "1345438c-ebfc-4fa5-b545-30c1414f317c").sourceMetadata).toMatchObject({ structured: { workplaceType: "ONSITE" } });
  });

  it("requires the company name, which Lever does not return, and records that it came from the source configuration", async () => {
    expect(adapter("lever").configSchema.safeParse({ site: "palantir" }).success).toBe(false);
    const [listing] = (await collect("lever", { keepAll: true })).listings;
    const { provenance } = await createRetrievedOpportunityNormalizer().normalize(listing!);
    expect(provenance.find((item) => item.fieldName === "company.name")).toMatchObject({ sourceField: "sourceConfiguration.company", kind: "DIRECT", normalizedValue: "Palantir" });
    const greenhouse = (await collect("greenhouse", { keepAll: true })).listings[0]!;
    const fromResponse = await createRetrievedOpportunityNormalizer().normalize(greenhouse);
    expect(fromResponse.provenance.find((item) => item.fieldName === "company.name")).toMatchObject({ sourceField: "company", normalizedValue: "GitLab" });
  });
});

describe("Ashby", () => {
  it("uses a structured salary and its summary only for a single published salary", async () => {
    const listings = (await collect("ashby", { keepAll: true })).listings;
    const single = byId(listings, "55078a90-f1f0-4190-9d2a-c14d1cbc5486");
    expect(single.salaryText).toBe("A$89K – A$105K • Offers Equity");
    expect(single.sourceMetadata).toMatchObject({ structured: { salaryMin: 89000, salaryMax: 105000, salaryCurrency: "AUD", salaryPeriod: "YEAR", workplaceType: "REMOTE" } });
    const tiered = byId(listings, "893cd08a-929c-4077-b39c-64bc34f347ea");
    expect(tiered.salaryText).toBeNull();
    expect(tiered.sourceMetadata).toMatchObject({ structured: { salaryMin: null }, compensationSummary: "A$135K – A$189K • Offers Equity • Multiple Ranges" });
    expect((tiered.sourceMetadata as { salaryTierCount: number }).salaryTierCount).toBeGreaterThan(1);
    const { opportunity } = await createRetrievedOpportunityNormalizer().normalize(single);
    expect(opportunity).toMatchObject({ salaryMin: 89000, salaryMax: 105000, currency: "AUD", remoteStatus: "REMOTE", employmentType: "FULL_TIME" });
    const tieredOpportunity = (await createRetrievedOpportunityNormalizer().normalize(tiered)).opportunity;
    expect(tieredOpportunity.salaryMin).toBeNull();
  });

  it("does not use compensation the employer does not display, and skips unlisted postings", async () => {
    const hidden = (await collect("ashby", { keepAll: true, edit: editJson((value) => { value.jobs[1].shouldDisplayCompensationOnJobPostings = false; }) })).listings;
    expect(byId(hidden, "55078a90-f1f0-4190-9d2a-c14d1cbc5486")).toMatchObject({ salaryText: null, sourceMetadata: { structured: { salaryMin: null } } });
    const unlisted = await collect("ashby", { keepAll: true, edit: editJson((value) => { value.jobs[0].isListed = false; }) });
    expect(unlisted.listings.map((listing) => listing.externalId)).not.toContain("893cd08a-929c-4077-b39c-64bc34f347ea");
    expect(unlisted.fetched).toBe(3);
  });
});

describe("Remote OK", () => {
  it("skips the terms notice, keeps salary as source data only and carries the required attribution", async () => {
    const result = await collect("remote-ok", { keepAll: true });
    expect(result.fetched).toBe(3);
    const salaried = byId(result.listings, "1137537");
    expect(salaried).toMatchObject({ location: null, salaryText: null, sourceType: "API", retrieval: { sourceCategory: "AGGREGATOR" } });
    expect(salaried.sourceMetadata).toMatchObject({ attribution: "via Remote OK", statedSalaryMin: 140000, statedSalaryMax: 250000, structured: { salaryMin: null } });
    expect((await createRetrievedOpportunityNormalizer().normalize(salaried)).opportunity.salaryMin).toBeNull();
    expect(byId(result.listings, "1137529").sourceMetadata).toMatchObject({ statedSalaryMin: null });
  });
});

describe("We Work Remotely", () => {
  it("splits company and title, uses the guid as identity and joins the location fields", async () => {
    const listings = (await collect("we-work-remotely", { keepAll: true })).listings;
    const dropbox = byId(listings, "https://weworkremotely.com/remote-jobs/dropbox-scaled-customer-success-manager");
    expect(dropbox).toMatchObject({
      company: "Dropbox",
      title: "Scaled Customer Success Manager",
      location: "Anywhere in the World, California, 🇺🇸 United States of America",
      employmentType: "Full-Time",
      postingDate: "2026-10-06T22:42:07.000Z",
      retrieval: { sourceCategory: "JOB_BOARD" },
    });
    expect(splitWwrTitle("No separator here")).toEqual({ company: null, title: "No separator here" });
  });

  it("reports a non-RSS body as a contract mismatch", async () => {
    await expect(collect("we-work-remotely", { edit: () => "<html><body>Maintenance</body></html>" })).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });
});

describe("Himalayas", () => {
  it("maps structured salary with its period and currency, and keeps restrictions as source data", async () => {
    const listings = (await collect("himalayas", { keepAll: true })).listings;
    const [annual, noCurrency, monthly] = listings;
    expect(annual!.sourceMetadata).toMatchObject({ structured: { salaryMin: 500000, salaryCurrency: "EUR", salaryPeriod: "YEAR" }, timezoneRestrictions: [1], locationRestrictions: ["France"] });
    expect(annual!.location).toBe("France");
    expect(annual!.postingDate).toBe(new Date(1792277591 * 1000).toISOString());
    const normalizer = createRetrievedOpportunityNormalizer();
    expect((await normalizer.normalize(annual!)).opportunity).toMatchObject({ salaryMin: 500000, currency: "EUR", timeZoneRequirements: null });
    expect((await normalizer.normalize(noCurrency!)).opportunity.salaryMin).toBeNull();
    expect(monthly!.sourceMetadata).toMatchObject({ structured: { salaryPeriod: "MONTH" } });
    expect((await normalizer.normalize(monthly!)).opportunity.salaryMin).toBeNull();
  });

  it("follows nextCursor to the next page, up to the page cap", async () => {
    const result = await collect("himalayas", { keepAll: true });
    expect(result.requests).toBe(2);
    expect(result.fetched).toBe(6);
    const page2 = JSON.parse(read("himalayas", "response-page-2.json")) as { jobs: Array<{ guid: string }> };
    expect(result.listings.slice(3).map((listing) => listing.externalId)).toEqual(page2.jobs.map((job) => job.guid));
    expect(himalayasPageUrl("abc=")).toBe("https://himalayas.app/jobs/api?limit=20&cursor=abc%3D");
  });

  it("stops when a page has no nextCursor", async () => {
    const result = await collect("himalayas", { keepAll: true, edit: editJson((value) => { value.nextCursor = null; }) });
    expect(result.requests).toBe(1);
    expect(result.listings).toHaveLength(3);
  });
});

describe("Working Nomads", () => {
  it("takes the listing identity from the number in its URL", async () => {
    const listings = (await collect("working-nomads", { keepAll: true })).listings;
    expect(listings.map((listing) => listing.externalId)).toEqual(["1936318", "1944774", "1939844"]);
    expect(listings[0]).toMatchObject({ location: "United States", sourceMetadata: { category: "Customer Success" } });
    expect(workingNomadsId("https://www.workingnomads.com/jobs/other-shape")).toBe("https://www.workingnomads.com/jobs/other-shape");
  });
});

describe("SmartRecruiters", () => {
  it("reads the full job ad from the posting detail and maps its fields", async () => {
    const [listing] = (await collect("smartrecruiters", { keepAll: true })).listings;
    expect(listing).toMatchObject({
      externalId: "744000156080369",
      requisitionId: "REF286758X",
      title: "Senior Account Manager- Semiconductors",
      company: "Bosch Group",
      location: "Sunnyvale, CA, United States",
      employmentType: "Full-time",
      postingDate: "2026-10-16T20:52:12.836Z",
      sourceUrl: "https://jobs.smartrecruiters.com/BoschGroup/744000156080369-senior-account-manager-semiconductors",
      retrieval: { sourceCategory: "ATS" },
    });
    expect(listing!.sourceMetadata).toMatchObject({ companyIdentifier: "BoschGroup", experienceLevel: "Associate", function: "Engineering", structured: { workplaceType: "HYBRID" } });
    for (const title of ["Company Description", "Job Description", "Qualifications", "Additional Information"]) expect(listing!.description).toContain(title);
    expect(listing!.description).not.toMatch(/&#xa0;|<p>/);
  });

  it("filters list titles before requesting any detail, and counts only fetched details", async () => {
    const transportRequests: string[] = [];
    const source = adapter("smartrecruiters");
    const config = source.configSchema.parse(configs.smartrecruiters);
    const transport = createFixtureTransport({ [source.verificationUrl(config)]: { status: 200, contentType: "application/json", body: read("smartrecruiters", "response.json") } });
    const result = await source.collect(
      { transport, discovery: customerSuccessDiscoveryConfiguration, keepTitle: createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms), env: {}, now: () => new Date(), maxPages: 1, maxDetailRequests: 25 },
      config,
    );
    transportRequests.push(...transport.requested);
    expect(result).toMatchObject({ fetched: 3, listings: [], issues: [], requests: 1 });
    expect(transportRequests).toHaveLength(1);
  });

  it("treats only explicit remote or hybrid flags as a workplace type", async () => {
    const onsite = editJson((value) => { value.location.hybrid = false; value.location.remote = false; });
    const [listing] = (await collect("smartrecruiters", { keepAll: true, editDetail: onsite })).listings;
    expect(listing!.sourceMetadata).toMatchObject({ structured: { workplaceType: null } });
  });

  it("stops requesting details after a rate limit and reports a missing posting as that listing's issue", async () => {
    const source = adapter("smartrecruiters");
    const config = source.configSchema.parse(configs.smartrecruiters);
    const list = read("smartrecruiters", "response.json");
    const ids = (JSON.parse(list) as { content: Array<{ id: string }> }).content.map((item) => item.id);
    const detail = (id: string) => `https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/${id}`;
    const run = (responses: Record<string, { status: number; contentType: string; body: string }>) =>
      source.collect(
        { transport: createFixtureTransport({ [source.verificationUrl(config)]: { status: 200, contentType: "application/json", body: list }, ...responses }), discovery: customerSuccessDiscoveryConfiguration, keepTitle: () => true, env: {}, now: () => new Date(), maxPages: 1, maxDetailRequests: 3 },
        config,
      );
    const limited = await run({ [detail(ids[0]!)]: { status: 429, contentType: "application/json", body: "{}" } });
    expect(limited.halted?.code).toBe("RATE_LIMITED");
    expect(limited.requests).toBe(2);
    const missing = await run({
      [detail(ids[0]!)]: { status: 200, contentType: "application/json", body: read("smartrecruiters", "detail-744000156080369.json") },
      [detail(ids[1]!)]: { status: 404, contentType: "application/json", body: "{}" },
    });
    expect(missing.listings).toHaveLength(1);
    // Oldest posting first: ids[0] (October 16), then ids[2], then ids[1].
    expect(missing.issues.map((issue) => issue.externalId)).toEqual([ids[2], ids[1]]);
    expect(missing.halted).toBeNull();
  });
});

describe("SmartRecruiters detail-request priority", () => {
  const summary = (id: string, releasedDate: string | null) => ({ id, name: `Customer Success Manager ${id}`, releasedDate });
  const released = (item: { releasedDate: string | null }) => item.releasedDate;
  // Newest first, as the list is ordered.
  const matches = [
    summary("e", "2026-10-18T05:00:00.000Z"),
    summary("d", "2026-10-18T04:00:00.000Z"),
    summary("c", "2026-10-18T03:00:00.000Z"),
    summary("b", "2026-10-18T02:00:00.000Z"),
    summary("a", "2026-10-18T01:00:00.000Z"),
  ];
  const checked = (entries: Record<string, string>) => async (ids: readonly string[]) => {
    expect([...ids].sort()).toEqual(matches.map((item) => item.id).sort());
    return new Map(Object.entries(entries).map(([id, at]) => [id, new Date(at)]));
  };
  const order = async (cap: number, entries: Record<string, string>, items = matches) =>
    (await prioritizeDetailRequests({ maxDetailRequests: cap, lastChecked: checked(entries) }, items, released)).map((item) => item.id);

  it("puts unseen postings first, oldest first, then stored postings by oldest last check", async () => {
    // b and d are stored: d was checked before b.
    const stored = { b: "2026-10-18T09:00:00.000Z", d: "2026-10-18T08:00:00.000Z" };
    expect(await order(25, stored)).toEqual(["a", "c", "e", "d", "b"]);
    // A stored posting never takes a place ahead of an unseen one.
    expect(await order(3, stored)).toEqual(["a", "c", "e"]);
    expect(await order(4, stored)).toEqual(["a", "c", "e", "d"]);
  });

  it("always respects the cap", async () => {
    for (const cap of [0, 1, 2, 5, 25]) {
      const picked = await order(cap, {});
      expect(picked).toHaveLength(Math.min(cap, matches.length));
      expect(picked).toEqual(["a", "b", "c", "d", "e"].slice(0, cap));
    }
    expect(await order(-1, {})).toEqual([]);
  });

  it("rotates stored postings so each is checked in turn", async () => {
    // Every posting stored; a run with capacity 2 checks the two longest
    // unchecked, and the next run (after they were checked) the next two.
    const times: Record<string, string> = {
      a: "2026-10-18T09:00:00.000Z", b: "2026-10-18T09:00:00.000Z", c: "2026-10-18T09:00:00.000Z",
      d: "2026-10-18T09:00:00.000Z", e: "2026-10-18T09:00:00.000Z",
    };
    const seen: string[] = [];
    for (let run = 1; run <= 3; run += 1) {
      const picked = await order(2, times);
      seen.push(...picked);
      for (const id of picked) times[id] = `2026-10-18T${String(9 + run).padStart(2, "0")}:00:00.000Z`;
    }
    // Ties on the last check go oldest posting first; all five are checked
    // within three runs, and a is the first to come round again.
    expect(seen).toEqual(["a", "b", "c", "d", "e", "a"]);
  });

  it("orders undated postings after dated ones, and treats every posting as unseen without a lookup", async () => {
    const items = [summary("new", null), ...matches.slice(3), summary("old", "not a date")];
    const picked = await prioritizeDetailRequests({ maxDetailRequests: 25 }, items, released);
    // b, a by date; then the undated ones, later in the list counting as older.
    expect(picked.map((item) => item.id)).toEqual(["a", "b", "old", "new"]);
  });

  it("makes no lookup when nothing matched or the cap is zero", async () => {
    let lookups = 0;
    const lastChecked = async () => {
      lookups += 1;
      return new Map<string, Date>();
    };
    expect(await prioritizeDetailRequests({ maxDetailRequests: 25, lastChecked }, [])).toEqual([]);
    expect(await prioritizeDetailRequests({ maxDetailRequests: 0, lastChecked }, matches)).toEqual([]);
    expect(lookups).toBe(0);
  });
});

describe("SmartRecruiters list paging", () => {
  const source = () => adapter("smartrecruiters");
  const config = () => source().configSchema.parse(configs.smartrecruiters);
  const page1Url = "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=10";
  // The verified page-2 request (see meta.json page2).
  const page2Url = "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=10&offset=10";
  const page3Url = "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=10&offset=20";
  const detailUrl = (id: string) => `https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/${id}`;
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  // Page 1 filled to the page size: the three fixture postings and seven
  // others (copies with new ids and titles that match no role term), all
  // newer than page 2.
  function fullPage1() {
    const page = JSON.parse(read("smartrecruiters", "response.json")) as { content: Array<Record<string, unknown>> };
    const base = page.content[1]!;
    for (let index = 0; index < 7; index += 1) {
      page.content.push({ ...base, id: `7440001561900${index}`, name: `Warehouse Associate ${index}`, releasedDate: "2026-10-17T12:00:00.000Z" });
    }
    return page;
  }
  const page2 = () => JSON.parse(read("smartrecruiters", "response-page-2.json")) as { offset: number; limit: number; totalFound: number; content: Array<Record<string, unknown>> };
  // Account Manager titles: one on page 1 (the verified detail) and one on page 2.
  const keepAccountManagers = (title: string | null) => Boolean(title && /account manager/i.test(title));
  const run = (responses: Record<string, { status: number; contentType: string; body: string }>, options: { maxPages?: number; maxDetailRequests?: number } = {}) => {
    const transport = createFixtureTransport(responses);
    const collected = source().collect(
      { transport, discovery: customerSuccessDiscoveryConfiguration, keepTitle: keepAccountManagers, env: {}, now: () => new Date("2026-10-18T15:00:00.000Z"), maxPages: options.maxPages ?? 5, maxDetailRequests: options.maxDetailRequests ?? 25 },
      config(),
    );
    return collected.then((result) => ({ result, requested: transport.requested }));
  };

  it("reads the verified page 2 by offset, stops at the short page and filters titles from every page before any detail", async () => {
    expect(page2()).toMatchObject({ offset: 10, limit: 10, totalFound: 5079 });
    const { result, requested } = await run({
      [page1Url]: json(fullPage1()),
      [page2Url]: json(read("smartrecruiters", "response-page-2.json")),
      [detailUrl("744000156080369")]: json(read("smartrecruiters", "detail-744000156080369.json")),
    });
    // Two list pages, then the two matching postings' details, oldest first.
    expect(requested).toEqual([page1Url, page2Url, detailUrl("744000156079459"), detailUrl("744000156080369")]);
    expect(result).toMatchObject({ fetched: 13, requests: 4, halted: null });
    expect(result.listings.map((listing) => listing.externalId)).toEqual(["744000156080369"]);
    // Page 2's posting has no detail in the fixture transport: that listing only.
    expect(result.issues).toEqual([{ externalId: "744000156079459", code: "CONTRACT_MISMATCH", message: "Posting detail could not be read" }]);
    expect(result.listings[0]!.sourceMetadata).toMatchObject({ totalFound: 5079 });
  });

  it("never reads beyond the page cap", async () => {
    const full2 = page2();
    while (full2.content.length < 10) full2.content.push({ ...full2.content[1]!, id: `74400015607000${full2.content.length}` });
    const responses = { [page1Url]: json(fullPage1()), [page2Url]: json(full2), [page3Url]: json({ offset: 20, limit: 10, totalFound: 5079, content: [] }) };
    expect((await run(responses, { maxPages: 1, maxDetailRequests: 0 })).requested).toEqual([page1Url]);
    expect((await run(responses, { maxPages: 2, maxDetailRequests: 0 })).requested).toEqual([page1Url, page2Url]);
    // With room for more, an empty page ends the listing.
    expect((await run(responses, { maxPages: 5, maxDetailRequests: 0 })).requested).toEqual([page1Url, page2Url, page3Url]);
  });

  it("stops when totalFound is reached and reads a posting shifted onto the next page once", async () => {
    const first = fullPage1();
    const second = page2();
    // A posting released while paging pushes page 1's last posting onto page 2.
    second.content.unshift(first.content[first.content.length - 1]!);
    const { result, requested } = await run(
      { [page1Url]: json({ ...first, totalFound: 14 }), [page2Url]: json({ ...second, content: [...second.content], totalFound: 14 }) },
      { maxDetailRequests: 0 },
    );
    // 10 + 4 = totalFound: no third request even though page 2 was not short.
    expect(requested).toEqual([page1Url, page2Url]);
    expect(result.fetched).toBe(14);
  });

  it("stops everything after a 429 or an access refusal on a later page, keeping the first page's failure fatal", async () => {
    for (const status of [429, 401, 403]) {
      const { result, requested } = await run({ [page1Url]: json(fullPage1()), [page2Url]: json({}, status) });
      expect(result.halted?.code).toBe(status === 429 ? "RATE_LIMITED" : "ACCESS_DENIED");
      expect(requested).toEqual([page1Url, page2Url]);
      expect(result).toMatchObject({ listings: [], requests: 2 });
    }
    await expect(run({ [page1Url]: json({}, 403) })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(run({ [page1Url]: json({}, 429) })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("keeps the pages already read after another failure on a later page", async () => {
    const { result, requested } = await run({
      [page1Url]: json(fullPage1()),
      [page2Url]: json({ unexpected: true }),
      [detailUrl("744000156080369")]: json(read("smartrecruiters", "detail-744000156080369.json")),
    });
    expect(result.halted?.code).toBe("CONTRACT_MISMATCH");
    expect(requested).toEqual([page1Url, page2Url, detailUrl("744000156080369")]);
    expect(result.listings.map((listing) => listing.externalId)).toEqual(["744000156080369"]);
  });
});
