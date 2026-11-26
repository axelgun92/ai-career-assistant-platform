// LinkedIn Mode B, enabled on the verified evidence (F0 and P1, November 3,
// 2026): the real F0 result cards read by the results reader exactly; the
// production registry offering LinkedIn, and only LinkedIn, by default; the
// popup's batch staged by the production intake with automatic details and
// the single-job identity; and the acquisition reading LinkedIn's public job
// page with the unchanged single-job reader, through the LinkedIn job-detail
// path, at the verified pacing. Offline: no network, browser or database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { pageCaptureMaxCards, pageCaptureOffer, pageCaptureSiteByKey } from "@ai-career/core";
import type { ExtensionPairingRecord } from "@ai-career/database";
import { buildPageCaptureBatch } from "../../apps/extension/src/page-capture-view";
import { capturedPageIdentity } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService, enabledSitesFromEnvironment } from "../../apps/web/src/server/page-capture";
import { readJobPage } from "../../apps/web/src/server/page-capture-acquisition";
import { linkedInF0ResultsPage, linkedInGuestJobPage } from "../support/linkedin-guest-pages";
import { runResultsReader } from "../support/page-capture-pages";

const f0 = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/page-capture/linkedin-f0-cards.json"), "utf8")) as { site: string; page: string; cards: string[] };
const searchUrl = "https://www.linkedin.com/jobs/search?keywords=customer%20success&location=United%20States";
const pairing: ExtensionPairingRecord = { id: "1b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e", label: "Chrome", tokenHint: "abcd", createdAt: new Date(), lastUsedAt: null, revokedAt: null };

const expectedCards = [
  { url: "https://www.linkedin.com/jobs/view/4484727127", title: "EverHealth -Strategic Customer Success Manager (Remote, US)", siteJobId: "4484727127", company: "EverCommerce", location: "Denver, CO", postedText: "21 hours ago" },
  { url: "https://www.linkedin.com/jobs/view/4423511448", title: "Customer Success Manager", siteJobId: "4423511448", company: "Planhat", location: "Los Angeles, CA", postedText: "15 hours ago" },
  { url: "https://www.linkedin.com/jobs/view/4486498409", title: "Customer Success Manager", siteJobId: "4486498409", company: "Happy Returns, a UPS Company", location: "Atlanta, GA", postedText: "15 hours ago" },
  { url: "https://www.linkedin.com/jobs/view/4444032301", title: "Customer Success Manager", siteJobId: "4444032301", company: "Circadia Health", location: "New York, United States", postedText: "18 hours ago" },
  { url: "https://www.linkedin.com/jobs/view/4486439538", title: "Customer Success Manager", siteJobId: "4486439538", company: "Silent Witness", location: "Los Angeles, CA", postedText: "19 hours ago" },
];

describe("LinkedIn Mode B on the real F0 cards", () => {
  it("reads the five real cards exactly, with nothing from the card's benefits text and without scrolling, clicking or requests", () => {
    expect(f0).toMatchObject({ site: "linkedin" });
    expect(f0.cards).toHaveLength(5);
    const reading = runResultsReader(linkedInF0ResultsPage(f0.cards), searchUrl, "linkedin");
    expect(reading.problem).toBeNull();
    expect(reading.counts).toEqual({ loaded: 5, skippedUnloaded: 0, overCap: 0 });
    expect(reading.cards).toEqual(expectedCards);
    expect(JSON.stringify(reading.cards)).not.toMatch(/early applicant|benefits/i);
    expect(reading.calls).toEqual([]);
  });

  it("is offered by the production registry on LinkedIn results pages only; Welcome to the Jungle stays off", () => {
    const enabled = enabledSitesFromEnvironment({});
    expect(enabled).toEqual({ cards: ["linkedin"], details: ["linkedin"] });
    for (const url of [searchUrl, "https://www.linkedin.com/jobs/search/?currentJobId=4484727127&keywords=csm", "https://www.linkedin.com/jobs/collections/recommended/"]) {
      expect(pageCaptureOffer(url, enabled.cards), url).toMatchObject({ offered: true });
    }
    expect(pageCaptureOffer("https://www.linkedin.com/jobs/view/4484727127/", enabled.cards)).toMatchObject({ offered: false, reason: "NOT_RESULTS_PAGE" });
    for (const url of ["https://www.linkedin.com/feed/", "https://www.linkedin.com/in/someone/", "https://www.linkedin.com/messaging/"]) {
      expect(pageCaptureOffer(url, enabled.cards).offered, url).toBe(false);
    }
    expect(pageCaptureOffer("https://www.welcometothejungle.com/en/jobs?query=csm", enabled.cards)).toMatchObject({ offered: false, reason: "NOT_VERIFIED" });
    // The verified safeguards are unchanged.
    expect(pageCaptureSiteByKey("linkedin")!.detail).toEqual({ minIntervalMs: 5_000, authCookieNames: ["li_at"], pageScripts: "skip" });
    expect(pageCaptureMaxCards).toBe(25);
  });

  it("stages the popup's batch of the real cards with automatic details, under the single-job identity", async () => {
    const reading = runResultsReader(linkedInF0ResultsPage(f0.cards), searchUrl, "linkedin");
    const built = buildPageCaptureBatch(reading, [true, true, false, true, true], {
      site: "linkedin",
      batchId: "0f6f1c9c-1d55-4a3b-9b9f-0d2b8a1e4c11",
      extensionVersion: "0.2.0",
      capturedAt: new Date("2026-11-04T09:00:00.000Z"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const stageBatch = vi.fn(async (input: { cards: Array<{ externalId: string }> }) =>
      input.cards.map((card, index) => ({ externalId: card.externalId, outcome: "QUEUED" as const, opportunityId: null, itemId: `item-${index}` })),
    );
    const service = createPageCaptureService({ repository: { stageBatch, siteStoppedUntil: async () => null } as never, enabledSites: () => enabledSitesFromEnvironment({}) });
    const result = await service.capture(built.batch, pairing);
    expect(result).toMatchObject({ site: { key: "linkedin", automaticDetails: true }, counts: { queued: 4, seenAgain: 0, alreadySaved: 0, rejected: 0 } });
    const staged = stageBatch.mock.calls[0]![0] as { site: string; detailsAvailable: boolean; cards: Array<{ externalId: string; sourceUrl: string; siteJobId: string }> };
    expect(staged).toMatchObject({ site: "linkedin", detailsAvailable: true });
    expect(staged.cards.map((card) => card.siteJobId)).toEqual(["4484727127", "4423511448", "4444032301", "4486439538"]);
    for (const card of staged.cards) {
      const identity = capturedPageIdentity(`https://www.linkedin.com/jobs/view/customer-success-${card.siteJobId}`);
      expect(card).toMatchObject({ externalId: identity.externalId, sourceUrl: identity.sourceUrl });
      expect(card.externalId).toBe(`linkedin:${card.siteJobId}`);
    }
  });

  it("reads LinkedIn's public job page with the unchanged single-job reader through its LinkedIn job-detail path", () => {
    const html = linkedInGuestJobPage({
      id: "4423511448",
      title: "Customer Success Manager",
      company: "Planhat",
      location: "Los Angeles, CA",
      descriptionHtml:
        "<p>Own onboarding, adoption and renewals for a portfolio of mid-market SaaS customers.</p><ul><li>Run business reviews</li><li>Partner with Sales and Support</li></ul><p>Remote in the United States. Base salary $72,000-$88,000.</p>",
    });
    const extraction = readJobPage(new JSDOM(html, { url: "https://www.linkedin.com/jobs/view/4423511448", runScripts: "outside-only" }).window.document);
    expect(extraction).toMatchObject({ extractor: "site:linkedin", problem: null });
    expect(extraction!.posting).toMatchObject({ title: "Customer Success Manager", company: "Planhat", location: "Los Angeles, CA", siteJobId: "4423511448", seniority: "Mid-Senior level", employmentType: "Full-time" });
    expect(extraction!.posting!.description).toContain("Own onboarding, adoption and renewals");
    expect(extraction!.posting!.description).not.toContain("Support Engineer");
  });
});
