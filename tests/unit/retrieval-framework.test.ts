// Feature 11A: the collection framework (HTML to text, title terms, RSS,
// change detection, transport and politeness), the retrieved-listing
// normalizer, source-scoped listing IDs and canonical-link precedence.
import { describe, expect, it, vi } from "vitest";
import { shouldReplaceApplicationLink, type RawOpportunity } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { compareListings, scopedListingId } from "@ai-career/deduplication";
import {
  AdapterError,
  adzunaAdapter,
  buildRetrievedListing,
  createFetchTransport,
  createFixtureTransport,
  createPoliteTransport,
  createTitleMatcher,
  defaultAdapterRegistry,
  defaultMaxResponseBytes,
  ensureSuccess,
  fixtureRequestKey,
  listingContentHash,
  parseRssItems,
  postJson,
  readJsonScript,
  redactUrl,
  rssField,
  type CollectContext,
  type ListingContentFields,
} from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer, htmlToText, markdownToText } from "@ai-career/normalization";
import { createTestAdapter, jsonResponse, testBoardUrl, type TestJob } from "../support/retrieval-test-adapter";

describe("HTML to text", () => {
  it("turns block markup into paragraphs and list items into dash lines", () => {
    expect(
      htmlToText("<h2>About</h2><p>We build <strong>workflow</strong> tools.</p><ul><li>Own onboarding</li><li>Run QBRs</li></ul><p>Remote&nbsp;&mdash; US</p>"),
    ).toBe("About\n\nWe build workflow tools.\n\n- Own onboarding\n- Run QBRs\n\nRemote — US");
  });

  it("unescapes HTML that arrives escaped once more, as Greenhouse sends it", () => {
    expect(htmlToText("&lt;p&gt;Customer &amp;amp; partner success&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Renewals&lt;/li&gt;&lt;/ul&gt;")).toBe(
      "Customer & partner success\n\n- Renewals",
    );
  });

  it("drops scripts, styles and comments, decodes numeric entities and keeps line breaks", () => {
    expect(htmlToText("<style>p{}</style><script>alert(1)</script><!-- x --><p>Caf&#233; &#x2014; line<br>two</p>")).toBe(
      "Café — line\ntwo",
    );
  });

  it("keeps plain text unchanged apart from whitespace, and empty markup is Unknown", () => {
    expect(htmlToText("Plain   text  with 3 < 5")).toBe("Plain text with 3 < 5");
    expect(htmlToText("<p> </p>")).toBeNull();
    expect(htmlToText(null)).toBeNull();
  });
});

describe("Markdown-style text to plain text", () => {
  it("decodes entities, drops emphasis and heading markers, and turns star bullets into dash lines", () => {
    expect(
      markdownToText("### Key Result Areas ### \n\n**First and Foremost:**\n\n* Onboard new customers &amp; train them\n* Resolve *queries* fast\n\n**We would love to have you** :)"),
    ).toBe("Key Result Areas\n\nFirst and Foremost:\n\n- Onboard new customers & train them\n- Resolve queries fast\n\nWe would love to have you :)");
  });

  it("keeps link text and addresses, and empty input is Unknown", () => {
    expect(markdownToText("Apply via [our form](https://example.com/apply) or [https://example.com](https://example.com).")).toBe(
      "Apply via our form (https://example.com/apply) or https://example.com.",
    );
    expect(markdownToText("  \n ")).toBeNull();
    expect(markdownToText(null)).toBeNull();
  });
});

describe("discovery title terms", () => {
  const matches = createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms);

  it("keeps titles containing a Customer Success role-family phrase, ignoring case and punctuation", () => {
    expect(matches("Senior Customer Success Manager")).toBe(true);
    expect(matches("Sr. Customer-Success Manager (EMEA)")).toBe(true);
    expect(matches("Client Success Associate")).toBe(true);
    expect(matches("Onboarding Specialist")).toBe(true);
    expect(matches("Implementation Consultant")).toBe(true);
  });

  it("matches whole phrases only", () => {
    expect(matches("Software Engineer")).toBe(false);
    expect(matches("Successful Customer Outreach Lead")).toBe(false);
    expect(matches("Customer Support Engineer")).toBe(false);
    expect(matches(null)).toBe(false);
  });

  it("never keeps an unrelated title because its description mentions customer success", async () => {
    const adapter = createTestAdapter();
    const jobs: TestJob[] = [
      { id: "1", title: "Backend Engineer", html: "<p>Partner with Customer Success Managers daily.</p>", url: "https://jobs.example.com/1" },
      { id: "2", title: "Customer Success Manager", html: "<p>Own a book of SaaS customers.</p>", url: "https://jobs.example.com/2" },
    ];
    const result = await adapter.collect(context({ [testBoardUrl("test-board", "acme", 1)]: jsonResponse({ jobs }) }), { board: "acme" });
    expect(result.fetched).toBe(2);
    expect(result.listings.map((listing) => listing.title)).toEqual(["Customer Success Manager"]);
    // The complete description is kept for the evaluator.
    expect(result.listings[0]!.description).toBe("Own a book of SaaS customers.");
  });
});

function context(responses: Parameters<typeof createFixtureTransport>[0], overrides: Partial<CollectContext> = {}): CollectContext {
  return {
    transport: createFixtureTransport(responses),
    discovery: customerSuccessDiscoveryConfiguration,
    keepTitle: createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms),
    env: {},
    now: () => new Date("2026-10-18T09:00:00.000Z"),
    maxPages: 5,
    maxDetailRequests: 5,
    ...overrides,
  };
}

describe("RSS items", () => {
  it("reads child elements with CDATA and entities", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title>Acme: Customer Success Manager</title><region>Anywhere in the World</region>
      <link>https://example.com/jobs/1</link><guid>https://example.com/jobs/1</guid>
      <description><![CDATA[<p>Own <b>renewals</b> &amp; adoption</p>]]></description></item>
      <item><title>Beta &amp; Co: Onboarding Lead</title><link>https://example.com/jobs/2</link></item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(rssField(items[0]!, "title")).toBe("Acme: Customer Success Manager");
    expect(rssField(items[0]!, "description")).toBe("<p>Own <b>renewals</b> &amp; adoption</p>");
    expect(rssField(items[0]!, "region")).toBe("Anywhere in the World");
    expect(rssField(items[1]!, "title")).toBe("Beta & Co: Onboarding Lead");
    expect(rssField(items[1]!, "description")).toBeNull();
    expect(() => parseRssItems("<html></html>")).toThrow();
  });
});

describe("change detection (content hash)", () => {
  const base: ListingContentFields = {
    title: "Customer Success Manager",
    company: "Acme",
    location: "Remote - US",
    description: "Own onboarding.\n\nRun business reviews.",
    salaryText: "$80,000 - $95,000",
    employmentType: "Full-time",
    requisitionId: "REQ-7",
    sourceUrl: "https://boards.example.com/acme/jobs/7",
    applicationUrl: "https://boards.example.com/acme/jobs/7/apply",
    structured: { salaryMin: 80000, salaryMax: 95000, salaryCurrency: "USD", salaryPeriod: "YEAR", workplaceType: "REMOTE", employmentType: null },
    material: { team: "Customer Success", offices: ["Remote", "New York"] },
  };

  it("is identical for identical content (idempotent)", () => {
    expect(listingContentHash(base)).toBe(listingContentHash({ ...base, structured: { ...base.structured }, material: { ...base.material } }));
  });

  it("ignores volatile metadata: tracking parameters, whitespace, key and list order", () => {
    const volatile = {
      ...base,
      description: "  Own onboarding.\n\n\nRun   business reviews. ",
      sourceUrl: "https://boards.example.com/acme/jobs/7?utm_source=feed&gclid=abc",
      material: { offices: ["New York", "Remote"], team: "Customer Success" },
    };
    expect(listingContentHash(volatile)).toBe(listingContentHash(base));
  });

  it("ignores fetch-time and counter fields in the source item (they are not hashed)", () => {
    const adapter = createTestAdapter();
    const job = { id: "7", title: "Customer Success Manager", html: "<p>Own onboarding.</p>", url: "https://x.example.com/7" };
    const build = (extra: Partial<TestJob>, at: string) =>
      buildRetrievedListing(
        adapter,
        { externalId: job.id, title: job.title, company: "Acme", location: null, description: "Own onboarding.", sourceUrl: job.url, applicationUrl: job.url, sourceItem: { ...job, ...extra } },
        { domain: "customer-success", discoveredAt: new Date(at) },
      );
    const first = build({ updated_at: "2026-10-01T00:00:00Z", view_count: 3 }, "2026-10-18T09:00:00Z");
    const later = build({ updated_at: "2026-10-17T12:00:00Z", view_count: 912 }, "2026-10-19T09:00:00Z");
    expect(later.retrieval!.contentHash).toBe(first.retrieval!.contentHash);
    expect(later.rawPayload).not.toEqual(first.rawPayload);
  });

  it("changes when the description materially changes", () => {
    expect(listingContentHash({ ...base, description: "Own onboarding and renewals.\n\nRun business reviews." })).not.toBe(listingContentHash(base));
  });

  it("changes when a structured field materially changes", () => {
    expect(listingContentHash({ ...base, structured: { ...base.structured, salaryMax: 105000 } })).not.toBe(listingContentHash(base));
    expect(listingContentHash({ ...base, structured: { ...base.structured, workplaceType: "HYBRID" } })).not.toBe(listingContentHash(base));
    expect(listingContentHash({ ...base, material: { ...base.material, team: "Support" } })).not.toBe(listingContentHash(base));
  });
});

describe("retrieved listings", () => {
  it("map to RawOpportunity with retrieval provenance and the source item namespaced, never as postingHistory", () => {
    const listing = buildRetrievedListing(
      createTestAdapter({ attribution: "via Test Board" }),
      {
        externalId: " 42 ",
        title: "Customer Success Manager",
        company: "Acme",
        location: "Remote",
        description: "Text",
        sourceUrl: "https://jobs.example.com/42",
        applicationUrl: "javascript:alert(1)",
        sourceItem: { id: "42", postingHistory: "not ours" },
      },
      { domain: "customer-success", discoveredAt: new Date("2026-10-18T09:00:00Z") },
    );
    expect(listing.source).toBe("test-board");
    expect(listing.externalId).toBe(" 42 ");
    expect(listing.applicationUrl).toBeNull();
    expect(listing.rawPayload).toEqual({ source: { id: "42", postingHistory: "not ours" } });
    expect((listing.rawPayload as Record<string, unknown>).postingHistory).toBeUndefined();
    expect(listing.sourceMetadata).toMatchObject({ sourceName: "Test Board", attribution: "via Test Board" });
    expect(listing.retrieval).toMatchObject({ retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", retrievalSourceId: null });
  });
});

describe("transport and politeness", () => {
  const response = (status: number) => ({ status, url: "https://api.example.com/x", contentType: "application/json", body: "{}" });

  it("classifies 429 as a rate limit, 401/403 as an access failure and 5xx as a server error", () => {
    expect(() => ensureSuccess(response(429))).toThrow(expect.objectContaining({ code: "RATE_LIMITED" }));
    expect(() => ensureSuccess(response(403))).toThrow(expect.objectContaining({ code: "ACCESS_DENIED" }));
    expect(() => ensureSuccess(response(401))).toThrow(expect.objectContaining({ code: "ACCESS_DENIED" }));
    expect(() => ensureSuccess(response(302))).toThrow(expect.objectContaining({ code: "HTTP_STATUS" }));
    expect(() => ensureSuccess(response(500))).toThrow(expect.objectContaining({ code: "SERVER_ERROR" }));
    expect(() => ensureSuccess(response(503))).toThrow(expect.objectContaining({ code: "SERVER_ERROR" }));
    expect(() => ensureSuccess(response(404))).toThrow(expect.objectContaining({ code: "HTTP_STATUS" }));
    expect(ensureSuccess(response(200)).status).toBe(200);
  });

  it("sends an identifying User-Agent, never follows redirects and enforces the size limit", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(64), { status: 200, headers: { "content-type": "text/plain" } }));
    const transport = createFetchTransport({ userAgent: "Test-Agent/1", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.get("https://api.example.com/a", { maxBytes: 16 })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe("Test-Agent/1");
    await expect(transport.get("file:///etc/passwd")).rejects.toMatchObject({ code: "CONFIG" });
  });

  it("enforces a hard 10 MB response ceiling without truncating", async () => {
    expect(defaultMaxResponseBytes).toBe(10 * 1024 * 1024);
    const chunk = new Uint8Array(1024 * 1024).fill(120);
    const streamOf = (megabytes: number, extraBytes = 0) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < megabytes; index += 1) controller.enqueue(chunk);
          if (extraBytes) controller.enqueue(new Uint8Array(extraBytes).fill(120));
          controller.close();
        },
      });
    const transport = (body: () => Response) => createFetchTransport({ fetchImpl: (async () => body()) as unknown as typeof fetch });
    // Just under the ceiling: read in full.
    const under = await transport(() => new Response(streamOf(9, 1024 * 1023), { status: 200 })).get("https://api.example.com/a");
    expect(under.body.length).toBe(9 * 1024 * 1024 + 1024 * 1023);
    // Exactly at the ceiling is allowed; one byte over is refused.
    expect((await transport(() => new Response(streamOf(10), { status: 200 })).get("https://api.example.com/a")).body.length).toBe(defaultMaxResponseBytes);
    await expect(transport(() => new Response(streamOf(10, 1), { status: 200 })).get("https://api.example.com/a")).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    // A declared length over the ceiling is refused before reading.
    let pulled = 0;
    const declared = new Response(new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(chunk); } }), {
      status: 200,
      headers: { "content-length": String(defaultMaxResponseBytes + 1) },
    });
    await expect(transport(() => declared).get("https://api.example.com/a")).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("reports network failures and timeouts as NETWORK", async () => {
    const failing = createFetchTransport({ fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    await expect(failing.get("https://api.example.com/a")).rejects.toMatchObject({ code: "NETWORK", message: "Request failed" });
    const timeout = createFetchTransport({
      fetchImpl: (async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) as unknown as typeof fetch,
    });
    await expect(timeout.get("https://api.example.com/a")).rejects.toMatchObject({ code: "NETWORK", message: "Request timed out" });
  });

  it("spaces requests to one host and stops sending to a host after 429, 401 or 403", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const statuses: Record<string, number> = {
      "https://a.example.com/1": 200,
      "https://a.example.com/2": 429,
      "https://b.example.com/1": 403,
      "https://c.example.com/1": 401,
    };
    const inner = { get: vi.fn(async (url: string) => ({ status: statuses[url] ?? 200, url, contentType: null, body: "" })), post: vi.fn() };
    const polite = createPoliteTransport(inner, {
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await polite.get("https://a.example.com/1");
    expect((await polite.get("https://a.example.com/2")).status).toBe(429);
    expect(sleeps).toEqual([1000]);
    await expect(polite.get("https://a.example.com/3")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect((await polite.get("https://b.example.com/1")).status).toBe(403);
    await expect(polite.get("https://b.example.com/2")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect((await polite.get("https://c.example.com/1")).status).toBe(401);
    await expect(polite.get("https://c.example.com/2")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(inner.get).toHaveBeenCalledTimes(4);
  });

  it("sends a JSON POST with the same limits, no cookies and no redirects, and keys recorded POSTs by body", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }));
    const transport = createFetchTransport({ userAgent: "Test-Agent/1", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await postJson(transport, "https://api.example.com/jobs", { offset: 0 })).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/jobs");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", credentials: "omit", body: '{"offset":0}' });
    expect(init.headers).toMatchObject({ "user-agent": "Test-Agent/1", "content-type": "application/json", accept: "application/json" });
    expect(Object.keys(init.headers as Record<string, string>).map((name) => name.toLowerCase())).not.toContain("cookie");
    const big = createFetchTransport({ fetchImpl: (async () => new Response("x".repeat(64), { status: 200 })) as unknown as typeof fetch });
    await expect(big.post("https://api.example.com/jobs", {}, { maxBytes: 16 })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    await expect(transport.post("file:///etc/passwd", {})).rejects.toMatchObject({ code: "CONFIG" });

    const fixture = createFixtureTransport({
      [fixtureRequestKey("https://api.example.com/jobs", { offset: 0 })]: { status: 200, contentType: "application/json", body: '{"page":1}' },
      [fixtureRequestKey("https://api.example.com/jobs", { offset: 20 })]: { status: 429, contentType: "application/json", body: "{}" },
    });
    expect(await postJson(fixture, "https://api.example.com/jobs", { offset: 0 })).toEqual({ page: 1 });
    await expect(postJson(fixture, "https://api.example.com/jobs", { offset: 20 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(fixture.get("https://api.example.com/jobs")).rejects.toMatchObject({ code: "NETWORK" });
    expect(fixture.requested).toEqual([
      'POST https://api.example.com/jobs {"offset":0}',
      'POST https://api.example.com/jobs {"offset":20}',
      "https://api.example.com/jobs",
    ]);
  });

  it("queues POSTs with GETs per host and stops the host after a refused POST", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const inner = {
      get: vi.fn(async (url: string) => ({ status: 200, url, contentType: null, body: "" })),
      post: vi.fn(async (url: string) => ({ status: url.endsWith("/denied") ? 401 : 200, url, contentType: null, body: "" })),
    };
    const polite = createPoliteTransport(inner, { minIntervalMs: 2000, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
    await polite.post("https://w.example.com/jobs", {});
    await polite.get("https://w.example.com/job/1");
    expect(sleeps).toEqual([2000]);
    expect((await polite.post("https://w.example.com/denied", {})).status).toBe(401);
    await expect(polite.get("https://w.example.com/job/2")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(polite.post("https://w.example.com/jobs", {})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(inner.post).toHaveBeenCalledTimes(2);
  });

  it("reads JSON state embedded in a page and rejects anything else", () => {
    const page = (attributes: string, content: string) => `<html><body><script ${attributes}>${content}</script></body></html>`;
    expect(readJsonScript(page('id="__NEXT_DATA__" type="application/json" crossorigin="anonymous"', '{"a":1}'), "__NEXT_DATA__")).toEqual({ a: 1 });
    expect(readJsonScript(page('id="__NEXT_DATA__"', '{"a":1}'), "__NEXT_DATA__")).toBeNull();
    expect(readJsonScript(page('id="__NEXT_DATA__" type="application/json"', "{not json"), "__NEXT_DATA__")).toBeNull();
    expect(readJsonScript(page('id="other" type="application/json"', '{"a":1}'), "__NEXT_DATA__")).toBeNull();
    expect(readJsonScript("<html><body>Checking your browser…</body></html>", "__NEXT_DATA__")).toBeNull();
  });

  it("redacts credentials from URLs in errors", () => {
    expect(redactUrl("https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=abc&app_key=secret&what=cs")).toBe(
      "https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=REDACTED&app_key=REDACTED&what=cs",
    );
    const error = new AdapterError("HTTP_STATUS", "x", { url: "https://h.example.com/?api_key=secret" });
    expect(error.details.url).not.toContain("secret");
  });

  it("collects later pages until done, and a stop on a later page keeps what was collected", async () => {
    const adapter = createTestAdapter();
    const job = (id: string): TestJob => ({ id, title: "Customer Success Manager", html: "<p>x</p>", url: `https://jobs.example.com/${id}` });
    const result = await adapter.collect(
      context({
        [testBoardUrl("test-board", "acme", 1)]: jsonResponse({ jobs: [job("1")], has_more: true }),
        [testBoardUrl("test-board", "acme", 2)]: jsonResponse({ jobs: [job("2")], has_more: true }),
        [testBoardUrl("test-board", "acme", 3)]: jsonResponse({}, 429),
      }),
      { board: "acme" },
    );
    expect(result.listings.map((listing) => listing.externalId)).toEqual(["1", "2"]);
    expect(result.halted?.code).toBe("RATE_LIMITED");
    await expect(
      adapter.collect(context({ [testBoardUrl("test-board", "acme", 1)]: jsonResponse({}, 403) }), { board: "acme" }),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(
      adapter.collect(context({ [testBoardUrl("test-board", "acme", 1)]: jsonResponse({ unexpected: true }) }), { board: "acme" }),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });

  it("respects the page cap", async () => {
    const adapter = createTestAdapter();
    const page = (id: string) => jsonResponse({ jobs: [{ id, title: "Customer Success Manager", html: "x" }], has_more: true });
    const transport = createFixtureTransport({
      [testBoardUrl("test-board", "acme", 1)]: page("1"),
      [testBoardUrl("test-board", "acme", 2)]: page("2"),
      [testBoardUrl("test-board", "acme", 3)]: page("3"),
    });
    const result = await adapter.collect(context({}, { transport, maxPages: 2 }), { board: "acme" });
    expect(result.listings).toHaveLength(2);
    expect(transport.requested).toHaveLength(2);
  });
});

function retrieved(overrides: Partial<RawOpportunity> & { structured?: Record<string, unknown> } = {}): RawOpportunity {
  const { structured, ...rest } = overrides;
  return {
    source: "test-board",
    sourceType: "ATS",
    sourceUrl: "https://jobs.example.com/1",
    applicationUrl: "https://jobs.example.com/1/apply",
    domain: "customer-success",
    externalId: "1",
    requisitionId: null,
    title: "Senior Customer Success Manager",
    company: "Acme",
    location: "Remote - United States",
    description: "Own renewals. Candidates must reside in the United States. Overlap with US Eastern hours.",
    salaryText: null,
    employmentType: null,
    postingDate: "2026-10-01T12:00:00Z",
    sourceMetadata: { structured: structured ?? {} },
    rawPayload: { source: {} },
    discoveredAt: new Date("2026-10-18T09:00:00Z"),
    retrieval: { retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", retrievalSourceId: null, retrievalRunId: null, contentHash: "a".repeat(64) },
    ...rest,
  };
}

describe("retrieved-listing normalizer", () => {
  const normalizer = createRetrievedOpportunityNormalizer();

  it("records structured source facts as DIRECT and facts read from text as DETERMINISTIC", async () => {
    const { opportunity, provenance } = await normalizer.normalize(
      retrieved({ structured: { salaryMin: 90000, salaryMax: 110000, salaryCurrency: "usd", salaryPeriod: "YEAR", workplaceType: "REMOTE", employmentType: "Full-time" } }),
    );
    expect(opportunity).toMatchObject({ salaryMin: 90000, salaryMax: 110000, currency: "USD", remoteStatus: "REMOTE", employmentType: "FULL_TIME", seniority: "SENIOR", atsPlatform: "test-board", status: "DISCOVERED" });
    const byField = (field: string) => provenance.filter((item) => item.fieldName === field);
    expect(byField("salaryMin")[0]).toMatchObject({ sourceField: "source.salaryMin", kind: "DIRECT", sourceReference: "retrieval:test-board" });
    expect(byField("remoteStatus")[0]).toMatchObject({ sourceField: "source.workplaceType", kind: "DIRECT" });
    expect(byField("employmentType")[0]).toMatchObject({ sourceField: "source.employmentType", kind: "DETERMINISTIC" });
    expect(byField("seniority")[0]).toMatchObject({ sourceField: "title", kind: "DETERMINISTIC" });
    expect(opportunity.postingDate?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("reads residency only from explicit statements and never infers a time-zone requirement", async () => {
    const { opportunity, provenance } = await normalizer.normalize(retrieved());
    expect(opportunity.residencyRequirement).toBe("US_REQUIRED");
    expect(opportunity.timeZoneRequirements).toBeNull();
    expect(provenance.some((item) => item.fieldName === "timeZoneRequirements")).toBe(false);
    const bare = await normalizer.normalize(retrieved({ description: "Own renewals for SaaS customers.", location: "Remote" }));
    expect(bare.opportunity.residencyRequirement).toBeNull();
    expect(bare.opportunity.residencyRegions).toEqual([]);
  });

  it("keeps non-annual structured pay Unknown and falls back to the salary text", async () => {
    const hourly = await normalizer.normalize(retrieved({ structured: { salaryMin: 40, salaryMax: 50, salaryCurrency: "USD", salaryPeriod: "HOUR" } }));
    expect(hourly.opportunity.salaryMin).toBeNull();
    const text = await normalizer.normalize(retrieved({ salaryText: "USD 85,000 - 95,000 per year" }));
    expect(text.opportunity).toMatchObject({ salaryMin: 85000, salaryMax: 95000, currency: "USD" });
    expect(text.provenance.find((item) => item.fieldName === "salaryMin")).toMatchObject({ sourceField: "salaryText", kind: "DETERMINISTIC" });
  });

  it("rejects manual records and listings without a description or title, and tolerates odd dates", async () => {
    await expect(normalizer.normalize(retrieved({ sourceType: "MANUAL" }))).rejects.toThrow();
    await expect(normalizer.normalize(retrieved({ retrieval: undefined }))).rejects.toThrow();
    await expect(normalizer.normalize(retrieved({ description: null }))).rejects.toThrow();
    await expect(normalizer.normalize(retrieved({ title: null }))).rejects.toThrow();
    expect((await normalizer.normalize(retrieved({ postingDate: "last week" }))).opportunity.postingDate).toBeNull();
  });
});

describe("source-scoped listing IDs", () => {
  const listing = (source: string, sourceType: string, id: string, title: string) => ({
    companyName: "Acme",
    title,
    location: null,
    description: null,
    urls: [],
    listingIds: [scopedListingId(source, sourceType, id)],
    requisitionIds: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
  });

  it("does not match the same ID from two different sources", () => {
    const greenhouse = listing("greenhouse", "ATS", "123", "Customer Success Manager");
    const lever = { ...listing("lever", "ATS", "123", "Onboarding Specialist"), opportunityId: "b", firstSeenAt: new Date() };
    expect(compareListings(greenhouse, lever)).toBeNull();
    const sameSource = { ...listing("greenhouse", "ATS", "123", "Customer Success Manager"), opportunityId: "c", firstSeenAt: new Date() };
    expect(compareListings(greenhouse, sameSource)?.decision).toBe("MATCH");
  });

  it("keeps manually entered IDs in their plain form", () => {
    expect(scopedListingId("manual-input", "MANUAL", " 123 ")).toBe("123");
    expect(scopedListingId("greenhouse", "ATS", " 123 ")).toBe("greenhouse::123");
    expect(scopedListingId("greenhouse", "ATS", "  ")).toBeNull();
  });

  it("treats differing IDs as a conflict only within one source", () => {
    const url = "https://boards.example.com/acme/jobs/1";
    const ats = { ...listing("greenhouse", "ATS", "1", "Customer Success Manager"), urls: [url] };
    const aggregator = { ...listing("remote-ok", "API", "agg-5", "Customer Success Manager"), urls: [url], opportunityId: "e", firstSeenAt: new Date() };
    expect(compareListings(ats, aggregator)).toMatchObject({ decision: "MATCH", evidence: { conflicts: [] } });
    const relisted = { ...listing("greenhouse", "ATS", "2", "Customer Success Manager"), urls: [url], opportunityId: "f", firstSeenAt: new Date() };
    expect(compareListings(ats, relisted)).toMatchObject({ decision: "PROBABLE_MATCH", evidence: { conflicts: ["listingId"] } });
  });

  it("still matches requisition IDs across sources at the same company", () => {
    const subject = { ...listing("greenhouse", "ATS", "1", "Customer Success Manager"), requisitionIds: ["REQ-9"] };
    const other = { ...listing("remote-ok", "API", "777", "Customer Success Manager"), requisitionIds: ["req-9"], opportunityId: "d", firstSeenAt: new Date() };
    expect(compareListings(subject, other)?.decision).toBe("MATCH");
  });
});

describe("canonical application link precedence", () => {
  const link = (overrides: Partial<Parameters<typeof shouldReplaceApplicationLink>[0]>) =>
    shouldReplaceApplicationLink({
      currentUrl: "https://aggregator.example.com/apply/1",
      currentIsManual: false,
      currentCategory: "AGGREGATOR",
      candidateUrl: "https://boards.example.com/acme/jobs/1",
      candidateCategory: "ATS",
      ...overrides,
    });

  it("lets an employer ATS link replace an aggregator or job-board link", () => {
    expect(link({})).toBe(true);
    expect(link({ currentCategory: "JOB_BOARD" })).toBe(true);
  });

  it("never replaces a manual link, and never replaces with an equal or lower source", () => {
    expect(link({ currentIsManual: true })).toBe(false);
    expect(link({ currentCategory: "ATS" })).toBe(false);
    expect(link({ currentCategory: "ATS", candidateCategory: "AGGREGATOR" })).toBe(false);
  });

  it("fills a missing link", () => {
    expect(link({ currentUrl: null, currentIsManual: false, currentCategory: null, candidateCategory: "AGGREGATOR" })).toBe(true);
  });
});

describe("adapter registry", () => {
  it("lists Adzuna as unverified and requiring its credentials", async () => {
    const adzuna = defaultAdapterRegistry.get("adzuna")!;
    expect(adzuna).toBe(adzunaAdapter);
    expect(adzuna.verified).toBe(false);
    expect(adzuna.requiredEnv).toEqual(["ADZUNA_APP_ID", "ADZUNA_APP_KEY"]);
    await expect(adzuna.collect(context({}), adzuna.configSchema.parse({}))).rejects.toMatchObject({ code: "CONFIG" });
    // Credentials are placeholders filled in only by pnpm sources:verify.
    expect(adzuna.verificationUrl(adzuna.configSchema.parse({}))).toContain("app_key=%7BADZUNA_APP_KEY%7D");
  });
});
