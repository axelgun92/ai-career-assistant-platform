// Feature 14B live round 2 (October 29, 2026): the real browser-extension
// captures stored in Alex's acceptance database, replayed exactly through
// the production normalizer. Each is the record as the installed extension
// sent it from his Chrome (exported read-only; pairing IDs removed), in the
// evidence shape and order observed: a default capture and, where Alex made
// one, a highlighted ("Use my selected text instead") capture of the same
// page. Nothing reaches the network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawOpportunity } from "@ai-career/core";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { formatSalary, formatWorkArrangements } from "../../apps/web/src/components/opportunity-facts";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";
import { runExtractor } from "../support/extension-pages";

interface StoredCapture {
  sourceUrl: string;
  applicationUrl: string | null;
  externalId: string | null;
  requisitionId: string | null;
  rawTitle: string | null;
  rawCompany: string | null;
  rawLocation: string | null;
  rawSalaryText: string | null;
  rawEmploymentType: string | null;
  rawPostingDate: string | null;
  rawDescription: string;
  sourceMetadata: Record<string, unknown> & { capture?: { extractor?: string } };
  contentHash: string;
  createdAt: string;
}
const fixture = JSON.parse(readFileSync("tests/fixtures/real-captures/feature-14b-live-round-2.json", "utf8")) as {
  captures: Record<string, StoredCapture>;
  safebreachReplayEvidence: { rawOpportunity: RawOpportunity & { discoveredAt: string | Date } };
};
const normalizer = createRetrievedOpportunityNormalizer();

// The stored version as the listing it was ingested as (the same mapping
// the read-only source-version check uses).
function stored(name: string): RawOpportunity {
  const record = fixture.captures[name]!;
  return {
    source: "browser-extension",
    sourceType: "BROWSER_EXTENSION",
    sourceUrl: record.sourceUrl,
    applicationUrl: record.applicationUrl,
    domain: "customer-success",
    externalId: record.externalId,
    requisitionId: record.requisitionId,
    title: record.rawTitle,
    company: record.rawCompany,
    location: record.rawLocation,
    description: record.rawDescription,
    salaryText: record.rawSalaryText,
    employmentType: record.rawEmploymentType,
    postingDate: record.rawPostingDate,
    sourceMetadata: record.sourceMetadata,
    rawPayload: null,
    discoveredAt: new Date(record.createdAt),
    retrieval: {
      retrievalType: "BROWSER_ASSISTED",
      sourceCategory: /greenhouse|smartrecruiters|myworkdayjobs/.test(record.sourceUrl) ? "ATS" : "JOB_BOARD",
      retrievalSourceId: null,
      retrievalRunId: null,
      contentHash: record.contentHash,
    },
  } as RawOpportunity;
}
const markers = (rows: Array<{ fieldName: string; sourceField: string }>, field: string) => rows.filter((row) => row.fieldName === field).map((row) => row.sourceField);

describe("SafeBreach (Greenhouse): the posting's own specific location over the page header's", () => {
  // The real capture: the header line "United States" (page context and the
  // description's first lines), then "📍 Locations (Remote): United States
  // (East Coast)" (inline in the description, split over two lines in page
  // context). The 📍 icon kept the label from being read at all.
  it("the stored default capture gives United States (East Coast), Remote, and no time zone", async () => {
    for (const raw of [stored("safebreach-default"), { ...fixture.safebreachReplayEvidence.rawOpportunity, discoveredAt: new Date(fixture.safebreachReplayEvidence.rawOpportunity.discoveredAt) } as RawOpportunity]) {
      expect(raw.description).toContain("📍 Locations (Remote): United States (East Coast)");
      const { opportunity, provenance } = await normalizer.normalize(raw);
      expect(opportunity).toMatchObject({ location: "United States (East Coast)", remoteStatus: "REMOTE", timeZoneRequirements: null, salaryMin: 120000, salaryMax: 140000, currency: "USD" });
      expect(opportunity.residencyRequirement).toBeNull();
      expect(markers(provenance, "location")).toEqual(["rawText:labelled-location"]);
    }
  });
});

describe("ServiceTitan (Workday): the two zones as separate tiers, default and highlighted", () => {
  // Default capture: the page's JSON-LD description, one run-on line (no
  // line breaks). Highlighted capture: the same text with the page's lines.
  it("both captures give Zone 1 and Zone 2 side by side, never one range", async () => {
    expect(fixture.captures["servicetitan-default"]!.rawDescription).not.toContain("\n");
    expect(fixture.captures["servicetitan-highlighted"]!.rawDescription).toContain("\n\nZone 1: $76,900 USD - $115,300 USD Applicable for: CA, CT, DC, MD, MA, NJ, NY, VA, and WA");
    for (const name of ["servicetitan-default", "servicetitan-highlighted"]) {
      const { opportunity } = await normalizer.normalize(stored(name));
      expect(opportunity, name).toMatchObject({ salaryMin: null, salaryMax: null, currency: "USD" });
      expect(opportunity.compensationTiers.map(({ label, minimum, maximum, currency }) => [label, minimum, maximum, currency]), name).toEqual([
        ["Zone 1", 76900, 115300, "USD"],
        ["Zone 2", 71800, 107800, "USD"],
      ]);
      expect(formatSalary(opportunity), name).toBe("Zone 1: 76,900–115,300 USD · Zone 2: 71,800–107,800 USD");
    }
  });

  it("the highlighted capture reads the PST/MST requirement; the parser needs no change", async () => {
    expect((await normalizer.normalize(stored("servicetitan-highlighted"))).opportunity.timeZoneRequirements).toBe("Able to work PST/MST hours");
  });

  it("the default capture's run-on JSON-LD text holds the same statement, inside one over-long sentence", () => {
    const description = fixture.captures["servicetitan-default"]!.rawDescription;
    expect(description).toContain("best practices Able to work PST/MST hours Be Human With Us:");
  });
});

describe("We Work Remotely: the stored default captures (header only) still name their company", () => {
  // The default captures were cut short in the browser (950 and 544
  // characters: the page header); their company comes from the page title,
  // "Remote <title> at <Company>".
  it("Dropbox and New Law Business Model", async () => {
    expect(fixture.captures["wwr-dropbox-default"]!.rawDescription.length).toBe(950);
    expect(fixture.captures["wwr-nlbm-default"]!.rawDescription.length).toBe(544);
    const dropbox = await normalizer.normalize(stored("wwr-dropbox-default"));
    const nlbm = await normalizer.normalize(stored("wwr-nlbm-default"));
    expect(dropbox.opportunity.companyName).toBe("Dropbox");
    expect(nlbm.opportunity.companyName).toBe("New Law Business Model");
    expect(markers(nlbm.provenance, "company.name")).toEqual(["pageContext:page-title-company"]);
  });

  it("the highlighted captures: the zone tiers, and the Pacific Time overlap", async () => {
    const dropbox = (await normalizer.normalize(stored("wwr-dropbox-highlighted"))).opportunity;
    expect(formatSalary(dropbox)).toBe("US Zone 2: 142,700–193,100 USD · US Zone 3: 126,800–171,600 USD");
    expect(formatWorkArrangements(dropbox)).toBe("Remote");
    const nlbm = (await normalizer.normalize(stored("wwr-nlbm-highlighted"))).opportunity;
    expect(nlbm).toMatchObject({ companyName: "New Law Business Model", remoteStatus: "REMOTE", employmentType: "FULL_TIME" });
    expect(nlbm.timeZoneRequirements).toBe("Requires minimum (4) hours core schedule to overlap with Pacific Time (e.g., 9:00 AM – 1:00 PM PT)");
  });
});

describe("SmartRecruiters and Remote OK: the stored captures carry no application link", () => {
  // The extension found none on those pages (see the rendered-page tests);
  // normalization adds none.
  it("QAD, ServiceNow, INNERGY, Renaissance", async () => {
    for (const name of ["smartrecruiters-qad-default", "smartrecruiters-servicenow-default", "remoteok-innergy-default", "remoteok-renaissance-default"]) {
      expect(fixture.captures[name]!.applicationUrl, name).toBeNull();
      expect((await normalizer.normalize(stored(name))).opportunity.applicationUrl, name).toBeNull();
    }
  });
});

// ------------------------------------------------- real rendered pages
//
// The live pages as rendered in Chromium after their scripts ran (October
// 29, 2026; scripts, styles and tracking tokens removed), read by the real
// page reader and carried through the envelope, the capture mapping and the
// normalizer.

async function captureRendered(file: string, url: string) {
  const extraction = runExtractor(readFileSync(`tests/fixtures/pages/${file}`, "utf8"), url);
  const capturedAt = new Date("2026-10-29T20:00:00.000Z");
  const envelope = buildCaptureEnvelope(extraction, "page", { extensionVersion: "0.1.0", capturedAt });
  if (!envelope.ok) throw new Error(envelope.problems.join("; "));
  const { raw } = capturedListing(parseCapture(envelope.envelope), { pairingId: "p1", domain: "customer-success", receivedAt: capturedAt });
  return { extraction, ...(await normalizer.normalize(raw)) };
}

describe("Remote OK (rendered): the job's own Apply among the other jobs' hidden expanded copies", () => {
  // After its scripts run, the page lists other jobs, each with a hidden
  // expanded copy carrying its own <h1> and Apply buttons.
  it("INNERGY: https://remoteok.com/l/1134651", async () => {
    const html = readFileSync("tests/fixtures/pages/remote-ok-innergy.html", "utf8");
    expect((html.match(/<h1/g) ?? []).length).toBeGreaterThan(1);
    const { extraction, opportunity, provenance } = await captureRendered("remote-ok-innergy.html", "https://remoteok.com/remote-jobs/remote-customer-success-manager-innergy-1134651");
    expect(extraction.application).toEqual({ url: "https://remoteok.com/l/1134651", basis: "PAGE_APPLY_LINK" });
    expect(opportunity.applicationUrl).toBe("https://remoteok.com/l/1134651");
    expect(markers(provenance, "applicationUrl")).toEqual(["page:apply-link"]);
    expect(opportunity).toMatchObject({ title: "Customer Success Manager", companyName: "INNERGY", salaryMin: 80000, salaryMax: 155000 });
  });
});

describe("We Work Remotely (rendered): the default capture reads the whole posting", () => {
  it("Dropbox: the posting body beside the header, the sidebar's facts, and the page-title company", async () => {
    const { extraction, opportunity } = await captureRendered("we-work-remotely-dropbox.html", "https://weworkremotely.com/remote-jobs/dropbox-scaled-customer-success-manager");
    expect(extraction.extractor).toBe("main-content");
    // The stored default capture had 950 characters (the header only).
    expect(extraction.posting!.description!.length).toBeGreaterThan(10000);
    expect(extraction.posting!.description).toContain("US Zone 2");
    expect(extraction.posting!.description).not.toContain("Related Jobs");
    expect(opportunity).toMatchObject({ companyName: "Dropbox", location: "United States of America", remoteStatus: "REMOTE", employmentType: "FULL_TIME", salaryMin: null, salaryMax: null });
    expect(formatSalary(opportunity)).toBe("US Zone 2: 142,700–193,100 USD · US Zone 3: 126,800–171,600 USD");
  });

  it("New Law Business Model: company, the annualized range over the sidebar's bucket, and the Pacific overlap", async () => {
    const { extraction, opportunity } = await captureRendered("we-work-remotely-nlbm.html", "https://weworkremotely.com/remote-jobs/new-law-business-model-solutions-engineer-customer-success");
    // The stored default capture had 544 characters.
    expect(extraction.posting!.description!.length).toBeGreaterThan(5000);
    expect(opportunity).toMatchObject({ companyName: "New Law Business Model", remoteStatus: "REMOTE", employmentType: "FULL_TIME", salaryMin: 85000, salaryMax: 95000, currency: "USD" });
    expect(opportunity.timeZoneRequirements).toBe("Requires minimum (4) hours core schedule to overlap with Pacific Time (e.g., 9:00 AM – 1:00 PM PT)");
    expect(opportunity).toMatchObject({ residencyRequirement: "NON_US", residencyRegions: ["WORLDWIDE"] });
  });
});
