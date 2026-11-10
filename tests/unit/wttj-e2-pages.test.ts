// Welcome to the Jungle / Otta job pages as Alex's Chrome rendered them on
// November 5, 2026 (E2: the nine acceptance jobs whose capture was
// incomplete, plus Vantage as the positive control), read by the extension's
// real page reader and the real background-tab orchestrator, then mapped and
// normalized as the server does. Offline: no network, browser or database.
//
// What E2 established, against the E1 records:
// - a rendered page states its posting in several blocks: "You'll be working
//   on" (the JSON-LD description), then "We're looking for" (the JSON-LD
//   `qualifications`, as plain run-together text) and on some jobs "How we
//   hire" (not in the JSON-LD at all); the reader took the first only, on
//   every page, whether read alone or in a batch;
// - every page has one Apply link (header and sticky bar to the same
//   address), which the reader finds once the page has rendered: the 16
//   batch records without one were read before the page rendered its body;
// - the remote tag in the job header ("Fully-remote", "No remote", "A few days
//   home", "Remote: Not specified") is the only arrangement statement on
//   Beam's and Mintlify's pages.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { createTabAcquisition } from "../../apps/extension/src/tab-acquisition";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";
import { runExtractor } from "../support/extension-pages";
import { fakeTabEnvironment, runProbe, wttjRunSettings } from "../support/wttj-tab-pages";

interface E2Page {
  url: string;
  title: string;
  mainHTML: string;
  mainText: string;
  applyControls: Array<{ testid: string | null; href: string; rendered: boolean; inMain: boolean }>;
}
const fixture = JSON.parse(readFileSync("tests/fixtures/real-captures/wttj-e2-pages.json", "utf8")) as { pages: Record<string, E2Page> };
const pages = fixture.pages;
const normalizer = createRetrievedOpportunityNormalizer();
const capturedAt = new Date("2026-11-05T15:00:00.000Z");

const rendered = (page: E2Page) => `<!doctype html><html><head><title>${page.title}</title></head><body>${page.mainHTML}</body></html>`;
// The same page before it renders its body: its structured data only.
const unrendered = (page: E2Page) => {
  const script = /<script type="application\/ld\+json">[\s\S]*?<\/script>/.exec(page.mainHTML)![0];
  return `<!doctype html><html><head><title>${page.title}</title>${script}</head><body><div id="root"></div></body></html>`;
};
const jsonLd = (page: E2Page) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page.mainHTML)![1]!) as Record<string, unknown>;

async function normalized(html: string, url: string) {
  const extraction = runExtractor(html, url);
  const envelope = buildCaptureEnvelope(extraction, "page", { extensionVersion: "0.3.0", capturedAt });
  if (!envelope.ok) throw new Error(envelope.problems.join("; "));
  const { raw } = capturedListing(parseCapture(envelope.envelope), { pairingId: "p1", domain: "customer-success", receivedAt: capturedAt, method: "batch" });
  return { extraction, ...(await normalizer.normalize(raw)) };
}

describe("the E2 pages", () => {
  it("are the nine jobs, each with one Apply destination (header and sticky bar)", () => {
    expect(Object.keys(pages).sort()).toEqual(["beam", "fourkites", "hack-the-box", "mintlify", "ogury", "servicetitan", "standard-metrics", "vantage", "zeta-global"]);
    for (const [name, page] of Object.entries(pages)) {
      expect(page.applyControls.map((control) => control.testid), name).toEqual(["job_header-button-apply", "job_sticky-button-apply"]);
      expect(new Set(page.applyControls.map((control) => control.href)).size, name).toBe(1);
    }
  });
});

describe("a rendered WTTJ job page, read by the extension", () => {
  it("keeps every part of the posting the page shows, once, and its Apply link", async () => {
    for (const [name, page] of Object.entries(pages)) {
      const { extraction } = await normalized(rendered(page), page.url);
      const description = extraction.posting!.description!;
      expect(extraction.extractor, name).toBe("structured-data");
      expect(extraction.posting!.applicationUrl, name).toBe(page.applyControls[0]!.href);
      expect(extraction.pageText, name).not.toBeNull();
      // Each posting block the page shows is in the description.
      for (const heading of ["We're looking for", "How we hire"]) {
        if (page.mainText.includes(`\n${heading}\n`)) expect(description, `${name}: ${heading}`).toContain(heading);
      }
      // Nothing is added twice, and the company and workplace blocks are not the posting.
      expect(description.split("We're looking for").length, name).toBeLessThanOrEqual(2);
      expect(description, name).not.toContain("Explore the company");
      expect(description, name).not.toContain("The workplace");
      expect(description, name).not.toContain("Our take");
    }
  });

  it("keeps the requirements the original captures lost", async () => {
    const serviceTitan = await normalized(rendered(pages.servicetitan!), pages.servicetitan!.url);
    expect(serviceTitan.extraction.posting!.description).toMatch(/We're looking for\n+Self-motivated and able to work effectively in a remote setting\n/);
    expect(serviceTitan.opportunity.timeZoneRequirements).toBe("Able to work PST/MST hours");
    const hackTheBox = await normalized(rendered(pages["hack-the-box"]!), pages["hack-the-box"]!.url);
    expect(hackTheBox.extraction.posting!.description).toMatch(/How we hire\n+Level 1 — Apply/);
    const mintlify = await normalized(rendered(pages.mintlify!), pages.mintlify!.url);
    expect(mintlify.extraction.posting!.description).toContain("SQL or Python for your own analysis");
    // Beam and Ogury publish their whole posting as the description: unchanged.
    for (const name of ["beam", "ogury"]) {
      const { extraction } = await normalized(rendered(pages[name]!), pages[name]!.url);
      expect(extraction.notes, name).not.toContain("The page's other job sections were added to the description");
    }
  });

  it("normalizes each job's arrangement from its structured data, its header tag or its own text", async () => {
    const expected: Record<string, string[]> = {
      servicetitan: ["REMOTE"],
      "zeta-global": ["REMOTE"],
      "hack-the-box": ["REMOTE"],
      vantage: ["REMOTE"],
      // "Remote: Not specified"; the posting: a remote-first company with optional offices.
      "standard-metrics": ["REMOTE"],
      // "No remote".
      mintlify: ["ONSITE"],
      // "A few days home".
      beam: ["HYBRID"],
      ogury: ["HYBRID"],
      // "Remote: Not specified", and nothing in the posting: Unknown.
      fourkites: [],
    };
    for (const [name, arrangement] of Object.entries(expected)) {
      const { opportunity } = await normalized(rendered(pages[name]!), pages[name]!.url);
      expect(opportunity.workArrangements, name).toEqual(arrangement);
    }
    const ogury = await normalized(rendered(pages.ogury!), pages.ogury!.url);
    expect(ogury.opportunity.location).toBe("Denver, US");
  });
});

describe("a WTTJ job page read before it renders its body", () => {
  it("still keeps the posting's qualifications from its structured data, with no Apply link or page context", async () => {
    const page = pages.servicetitan!;
    const { extraction, opportunity } = await normalized(unrendered(page), page.url);
    expect(extraction.pageText).toBeNull();
    expect(extraction.posting!.applicationUrl).toBeNull();
    expect(extraction.posting!.description).toContain("Qualifications\nSelf-motivated and able to work effectively in a remote setting");
    expect(extraction.notes).toContain("The job data's own qualifications were added to the description");
    expect(opportunity.timeZoneRequirements).toBe("Able to work PST/MST hours");
    // Structured data without a qualifications part (Beam) adds nothing.
    expect(jsonLd(pages.beam!).qualifications).toBeUndefined();
    const beam = await normalized(unrendered(pages.beam!), pages.beam!.url);
    expect(beam.extraction.notes).not.toContain("The job data's own qualifications were added to the description");
  });
});

describe("the background-tab reader on a real WTTJ job page", () => {
  const page = pages.servicetitan!;
  const item = { itemId: "00000000-0000-4000-8000-000000000001", url: page.url };
  const run = async (served: Parameters<typeof fakeTabEnvironment>[0]["serve"]) => {
    const fake = fakeTabEnvironment({ serve: served });
    const acquisition = createTabAcquisition(fake.environment);
    fake.registerItems([item]);
    await acquisition.enqueue({ ...wttjRunSettings, items: [item] });
    await acquisition.resume();
    return fake;
  };

  it("waits for the page to render before taking a posting read only from its structured data", async () => {
    const fake = await run(() => ({ status: 200, html: rendered(page), earlyHtml: unrendered(page), renderedAfterReads: 1 }));
    expect(fake.log.reads).toHaveLength(2);
    const capture = fake.log.details[0]!.capture;
    expect(capture.fields.applicationUrl).toBe(page.applyControls[0]!.href);
    expect(capture.pageText).not.toBeNull();
    expect(capture.fields.description).toContain("We're looking for");
  });

  it("takes the structured-data read after the last re-read when the page never renders", async () => {
    const fake = await run(() => ({ status: 200, html: unrendered(page), earlyHtml: unrendered(page) }));
    expect(fake.log.reads).toHaveLength(1 + wttjRunSettings.rereadDelaysMs.length);
    const capture = fake.log.details[0]!.capture;
    expect(capture.fields.applicationUrl ?? null).toBeNull();
    expect(capture.fields.description).toContain("Qualifications\nSelf-motivated");
  });

  it("finds no access restriction on any of the nine pages", () => {
    for (const [name, candidate] of Object.entries(pages)) {
      expect(runProbe(rendered(candidate), candidate.url, 200), name).toMatchObject({ hard: null, soft: null });
    }
  });
});
