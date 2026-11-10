// LinkedIn Option A on the real November 7, 2026 job pages (reduced from the
// page LinkedIn sent; tests/fixtures/real-captures/linkedin-nov7-job-pages.json),
// with the production Playwright driver and a real headless Chromium. The
// pages are served from 127.0.0.1 only; nothing reaches LinkedIn or any other
// network. Each page carries the subresources the real one referenced (two
// scripts, a stylesheet, images), pointed at the local server.
//
// Script-enabled (pageScripts "run", the reading of November 7) and
// script-disabled ("skip") reads of the same page are compared field by
// field, through the same reader, capture mapping and normalization, and
// against the text the script-enabled worker stored on November 7 (the E5
// fixture). The script-disabled read sends exactly one request per job.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { launchBrowserDriver } from "@ai-career/browser-retrieval";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { PageCaptureItemRecord } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { chromium } from "@playwright/test";
import { JSDOM } from "jsdom";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureAcquisition, readJobPage, scriptlessPageIncomplete } from "../../apps/web/src/server/page-capture-acquisition";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath();
const fixture = JSON.parse(readFileSync("tests/fixtures/real-captures/linkedin-nov7-job-pages.json", "utf8")) as { pages: Record<string, { listingId: string; sourceUrl: string; html: string }> };
const stored = JSON.parse(readFileSync("tests/fixtures/real-captures/mode-b-e5-linkedin-nov7.json", "utf8")) as {
  listings: Record<string, { title: string; company: string; location: string; employmentType: string | null; description: string }>;
};
const names = ["tenex", "nearmap", "thomson-reuters"] as const;
const byId = new Map(names.map((name) => [fixture.pages[name]!.listingId, name]));

// The page as served here: the reduced real page with the real page's
// subresource references (now local). The script, if it ran, would change
// the description and fetch more.
const subresources =
  '<link rel="stylesheet" href="/static/page.css"><script src="/static/app.js"></script><script src="/static/tracking.js"></script>';
const served = (name: string) => fixture.pages[name]!.html.replace("</head>", `${subresources}</head>`).replace("</main>", '<img src="/static/logo.png"></main>');

const seen: string[] = [];
let server: Server;
let origin = "";
beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    seen.push(path);
    const job = /^\/jobs\/view\/(\d+)$/.exec(path);
    if (job && byId.has(job[1]!)) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(served(byId.get(job[1]!)!));
      return;
    }
    if (path === "/static/app.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end('document.documentElement.setAttribute("data-app", "ran"); fetch("/static/xhr");');
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// The production driver, with LinkedIn's job addresses served locally: the
// page keeps its LinkedIn address for the reader, as in the worker.
async function localLinkedIn(pageScripts: "run" | "skip"): Promise<BrowserDriver> {
  const driver = await launchBrowserDriver({ executablePath, pageScripts });
  return {
    async navigate(url, options) {
      const local = url.replace("https://www.linkedin.com", origin);
      const page = await driver.navigate(local, options);
      return { ...page, finalUrl: page.finalUrl.replace(origin, "https://www.linkedin.com") };
    },
    close: () => driver.close(),
  };
}

const normalizer = createRetrievedOpportunityNormalizer();
const at = new Date("2026-11-07T18:00:00.000Z");
async function readAs(pageScripts: "run" | "skip", name: (typeof names)[number]) {
  const page = fixture.pages[name]!;
  const driver = await localLinkedIn(pageScripts);
  seen.length = 0;
  try {
    const navigation = await driver.navigate(page.sourceUrl, { timeoutMs: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const document = new JSDOM(navigation.html, { url: navigation.finalUrl, runScripts: "outside-only" }).window.document;
    const extraction = readJobPage(document);
    const built = buildCaptureEnvelope({ ...extraction!, pageUrl: page.sourceUrl }, "page", { extensionVersion: "0.2.0", capturedAt: at });
    if (!built.ok) throw new Error(`${name}: no capture`);
    const { raw } = capturedListing(parseCapture(JSON.parse(JSON.stringify(built.envelope))), { pairingId: "p", domain: "customer-success", receivedAt: at, method: "batch" });
    const { opportunity } = await normalizer.normalize(raw);
    return { navigation, extraction: extraction!, raw, opportunity: opportunity as Record<string, unknown>, requested: [...seen], scriptRan: document.documentElement.getAttribute("data-app") === "ran" };
  } finally {
    await driver.close();
  }
}

const facts = ["title", "company", "location", "description", "remoteStatus", "workArrangements", "residencyRequirement", "residencyRegions", "residencyExclusions", "salaryMin", "salaryMax", "currency", "compensationBasis", "compensationTiers", "employmentType", "seniority", "closingDate", "applicationUrl", "timeZoneRequirements", "workAuthorizationRequirement", "visaSponsorship"];

describe("LinkedIn job pages read with and without their scripts (the real November 7 pages)", () => {
  for (const name of names) {
    it(`${name}: the same posting, capture and facts either way; without scripts, one request and nothing else`, async () => {
      const withScripts = await readAs("run", name);
      const without = await readAs("skip", name);
      // Script-enabled: the page's scripts ran and fetched their resources.
      expect(withScripts.scriptRan).toBe(true);
      expect(withScripts.requested).toEqual(expect.arrayContaining([`/jobs/view/${fixture.pages[name]!.listingId}`, "/static/app.js", "/static/tracking.js", "/static/page.css", "/static/xhr"]));
      // Script-disabled: the document only.
      expect(without.scriptRan).toBe(false);
      expect(without.requested).toEqual([`/jobs/view/${fixture.pages[name]!.listingId}`]);
      expect(without.navigation.requests).toMatchObject({ pageScripts: "skip", documentRequests: 1, redirects: 0, sentRequests: 1 });
      expect(without.navigation.requests!.blockedByType).toMatchObject({ stylesheet: 1, image: 1 });
      expect(withScripts.navigation.requests!.sentRequests).toBeGreaterThan(1);
      // The same reading, field by field.
      expect(without.extraction.extractor).toBe("site:linkedin");
      expect(without.extraction.posting).toEqual(withScripts.extraction.posting);
      expect(scriptlessPageIncomplete(without.extraction)).toBeNull();
      expect(without.raw).toEqual(withScripts.raw);
      for (const fact of facts) expect(without.opportunity[fact], `${name} ${fact}`).toEqual(withScripts.opportunity[fact]);
      // And the text the script-enabled worker stored on November 7.
      const nov7 = stored.listings[name]!;
      expect({ title: without.raw.title, company: without.raw.company, location: without.raw.location, employmentType: without.raw.employmentType, description: without.raw.description }).toEqual({
        title: nov7.title,
        company: nov7.company,
        location: nov7.location,
        employmentType: nov7.employmentType,
        description: nov7.description,
      });
    });
  }

  it("the November 7 facts hold on the script-disabled read: TENEX Hybrid, Nearmap Remote in the continental U.S., Thomson Reuters target total cash", async () => {
    expect((await readAs("skip", "tenex")).opportunity).toMatchObject({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"], salaryMin: null });
    expect((await readAs("skip", "nearmap")).opportunity).toMatchObject({ remoteStatus: "REMOTE", residencyRequirement: "US_REQUIRED", residencyExclusions: ["US-AK", "US-HI"], location: "Lehi, UT" });
    expect((await readAs("skip", "thomson-reuters")).opportunity).toMatchObject({ salaryMin: 106_400, salaryMax: 197_600, currency: "USD", compensationBasis: "OTE", remoteStatus: null });
  });
});

describe("a Mode B pass over the real pages without scripts (production driver, local pages)", () => {
  it("reads all three, one request each, nothing else requested, and records the counts", async () => {
    const now = new Date("2026-11-08T15:00:00.000Z");
    const rows = new Map<string, PageCaptureItemRecord>(
      names.map((name, index) => {
        const id = fixture.pages[name]!.listingId;
        return [
          id,
          {
            id, site: "linkedin", host: "www.linkedin.com", externalId: `linkedin:${id}`, sourceUrl: fixture.pages[name]!.sourceUrl, siteJobId: id, title: name, company: null, location: null, postedText: null,
            resultsPageUrl: "https://www.linkedin.com/jobs/search", firstSeenAt: new Date(now.getTime() + index), lastSeenAt: now, sightings: 1, lastBatchId: null, pairingId: "p",
            status: "QUEUED", attempts: 0, lastAttemptAt: null, nextAttemptAt: null, lastReason: null, opportunityId: null, handoffOutcome: null, handedOffAt: null, createdAt: now, updatedAt: now,
          } as PageCaptureItemRecord,
        ];
      }),
    );
    const repository = {
      recoverInterrupted: vi.fn(async () => 0),
      sitesWithQueued: vi.fn(async () => ([...rows.values()].some((row) => row.status === "QUEUED") ? ["linkedin"] : [])),
      siteStoppedUntil: vi.fn(async () => null),
      claimQueued: vi.fn(async () => [...rows.values()].filter((row) => row.status === "QUEUED").map((row) => ((row.status = "ACQUIRING"), { ...row }))),
      markIngested: vi.fn(async (id: string, opportunityId: string) => void Object.assign(rows.get(id)!, { status: "INGESTED", opportunityId })),
      markFailed: vi.fn(async () => undefined),
      deferSite: vi.fn(async () => undefined),
      markHandedOff: vi.fn(async () => undefined),
      requeueUncounted: vi.fn(async () => true),
      releaseClaimed: vi.fn(async () => 0),
      finalizeProvisionalFailure: vi.fn(async () => false),
    };
    const raws: Array<Record<string, unknown>> = [];
    const launches: unknown[] = [];
    const acquisition = createPageCaptureAcquisition({
      repository,
      ingestion: {
        ingest: vi.fn(async (raw: Record<string, unknown>) => {
          raws.push(raw);
          await normalizer.normalize(raw as never);
          return { outcome: "CREATED" as const, opportunityId: `0000000${raws.length}-0000-4000-8000-000000000000`, sourceRecordId: "s", decision: "NO_MATCH" as const };
        }),
      } as never,
      handoff: { alreadyHandled: vi.fn(async () => false), request: vi.fn(async () => "NO_ACTIVE_PROFILE") },
      discovery: customerSuccessDiscoveryConfiguration,
      detailSites: () => ["linkedin"],
      browser: {
        launch: async (options) => {
          launches.push(options);
          return localLinkedIn(options?.pageScripts ?? "run");
        },
      },
      now: () => now,
      sleep: async () => undefined,
    });
    seen.length = 0;
    const result = await acquisition.runOnce();
    expect(launches).toEqual([{ pageScripts: "skip" }]);
    expect(result).toMatchObject({ ingested: 3, incomplete: 0, stopped: null, pageScripts: "skip", requests: { pages: 3, documentRequests: 3, sentRequests: 3 } });
    expect(result!.requests.blockedRequests).toBeGreaterThanOrEqual(6);
    expect(seen).toEqual(names.map((name) => `/jobs/view/${fixture.pages[name]!.listingId}`));
    expect(raws.map((raw) => raw.description)).toEqual(names.map((name) => stored.listings[name]!.description));
    expect([...rows.values()].every((row) => row.status === "INGESTED")).toBe(true);
  });
});
