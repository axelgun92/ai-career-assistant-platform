// November 9, 2026 LinkedIn diagnostic, corrected (November 10): the same
// shared reader and normalizer serve Single Capture and Mode B, but LinkedIn's
// page decides the reader branch (its JobPosting structured data, or its job
// page). Q1–Q4 on the acceptance database showed the structured branch
// stored literal HTML (Kerv, Staffr) and LinkedIn's validThrough as the
// closing date (exactly datePosted + 30 days), and that the shared
// arrangement reader missed role-level hybrid statements (Papirfly, Kerv)
// whatever the branch. Offline: JSDOM pages, no network, database or
// evaluator. The posting texts are built from the wording the diagnostic
// quoted from the stored descriptions.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { listingExpiryValidThroughSites, pageCaptureRefreshReason, pageCaptureSiteByKey, pageReaderRevision, type RawOpportunity } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { createRetrievedOpportunityNormalizer, readJobTextFacts } from "@ai-career/normalization";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing } from "../../apps/web/src/server/extension-capture";
import { readJobPage } from "../../apps/web/src/server/page-capture-acquisition";

const capturedAt = new Date("2026-11-09T23:30:00.000Z");

// ------------------------------------------------------------------ pages

// A LinkedIn job page: its top card, its description, its criteria list, and
// (optionally) its JobPosting structured data with the description given as
// real HTML or with the markup itself escaped, as LinkedIn served it.
function linkedInPage(input: {
  id: string;
  title: string;
  company: string;
  location: string;
  html: string;
  structured: "none" | "html" | "escaped";
  validThrough?: string;
}): { url: string; html: string } {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const [locality, country] = input.location.split(", ");
  const jsonLd =
    input.structured === "none"
      ? ""
      : `<script type="application/ld+json">${JSON.stringify({
          "@context": "http://schema.org",
          "@type": "JobPosting",
          title: input.title,
          description: input.structured === "escaped" ? escape(input.html) : input.html,
          datePosted: "2026-10-23T20:10:32.000Z",
          ...(input.validThrough ? { validThrough: input.validThrough } : {}),
          hiringOrganization: { "@type": "Organization", name: input.company },
          jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: locality, addressCountry: country } },
        }).replace(/</g, "\\u003c")}</script>`;
  return {
    url: `https://www.linkedin.com/jobs/view/${input.id}/`,
    html: `<!doctype html><html><head><title>${input.title} | ${input.company} | LinkedIn</title>${jsonLd}</head><body><main>
<section class="top-card-layout"><h1 class="top-card-layout__title">${input.title}</h1>
<a class="topcard__org-name-link" href="https://www.linkedin.com/company/x">${input.company}</a>
<span class="topcard__flavor topcard__flavor--bullet">${input.location}</span><span class="posted-time-ago__text">2 weeks ago</span></section>
<section class="description"><div class="show-more-less-html__markup">${input.html}</div>
<ul class="description__job-criteria-list"><li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">Contract</span></li></ul></section>
</main></body></html>`,
  };
}

function read(page: { url: string; html: string }) {
  const window = new JSDOM(page.html, { url: page.url, runScripts: "outside-only" }).window;
  try {
    return { extraction: readJobPage(window.document)!, window };
  } finally {
    window.close();
  }
}

function captureOf(page: { url: string; html: string }): RawOpportunity {
  const { extraction } = read(page);
  const built = buildCaptureEnvelope({ ...extraction, pageUrl: page.url }, "page", { extensionVersion: "0.3.0", capturedAt });
  if (!built.ok) throw new Error(built.problems.join("; "));
  return capturedListing(built.envelope, { pairingId: "p", domain: customerSuccessDiscoveryConfiguration.domain, receivedAt: capturedAt, method: "single" }).raw;
}

const kervHtml = [
  "<p><strong>Customer Success Manager – 12-Month FTC</strong></p>",
  "<p>We are a hybrid working company and this role will require to attend Richmond (TW9) based office twice a week depending on business needs.</p>",
  "<p><strong>What you'll do</strong></p>",
  "<ul><li>Own onboarding and adoption for a portfolio of enterprise customers.</li><li>Run quarterly business reviews and partner with Sales on renewals.</li></ul>",
  "<p><strong>About you</strong><br>Comfortable working within a hybrid model that balances office-based and remote work.<br>Experience in a customer-facing SaaS role.</p>",
].join("");
const kerv = { id: "4483145321", title: "Customer Success Manager – 12-Month FTC", company: "Kerv", location: "Greater London, United Kingdom", html: kervHtml };

// ------------------------------------------------- Fix A: the shared reader

describe("Fix A — LinkedIn's structured description is read as text whichever way it is encoded", () => {
  const texts = (["escaped", "html", "none"] as const).map((structured) => read(linkedInPage({ ...kerv, structured })).extraction);

  it("the escaped markup, real HTML and the job page itself give the same description, with paragraph, line and list boundaries", () => {
    expect(texts.map((extraction) => extraction.extractor)).toEqual(["structured-data", "structured-data", "site:linkedin"]);
    const [escaped, html, page] = texts.map((extraction) => extraction.posting!.description);
    expect(escaped).toBe(html);
    expect(escaped).toBe(page);
    expect(escaped).not.toMatch(/<\/?(?:p|br|strong|ul|li)\b/);
    expect(escaped).toContain("We are a hybrid working company and this role will require to attend Richmond (TW9) based office twice a week");
    expect(escaped).toContain("Own onboarding and adoption for a portfolio of enterprise customers.\nRun quarterly business reviews");
    expect(escaped).toContain("About you\nComfortable working within a hybrid model");
  });

  it("decodes once more only escaped markup: text with a '<', real HTML with escaped tags in its prose and doubly escaped markup are kept as written; nothing runs", () => {
    const plain = (description: string) =>
      read({
        url: "https://www.linkedin.com/jobs/view/4400000009/",
        html: `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "CSM", description }).replace(/</g, "\\u003c")}</script></head><body></body></html>`,
      }).extraction.posting!.description;
    expect(plain("Churn &lt; 5% across the book &amp; renewals above 95%.")).toBe("Churn < 5% across the book & renewals above 95%.");
    expect(plain("<p>Write templates such as &lt;b&gt;Hello&lt;/b&gt; for customers.</p>")).toBe("Write templates such as <b>Hello</b> for customers.");
    expect(plain("&amp;lt;p&amp;gt;Twice escaped&amp;lt;/p&amp;gt;")).toBe("&lt;p&gt;Twice escaped&lt;/p&gt;");
    const { extraction, window } = read({
      url: "https://www.linkedin.com/jobs/view/4400000010/",
      html: `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "CSM",
        description: "&lt;script&gt;window.__ran = 1&lt;/script&gt;&lt;p&gt;Own renewals.&lt;/p&gt;&lt;img src=x onerror=&quot;window.__ran = 2&quot;&gt;",
      }).replace(/</g, "\\u003c")}</script></head><body></body></html>`,
    });
    expect(extraction.posting!.description).toBe("Own renewals.");
    expect((window as unknown as { __ran?: number }).__ran).toBeUndefined();
  });

  it("the same posting through either branch has the same content hash (no new version for the encoding alone); a real change still has a new one", () => {
    const hash = (raw: RawOpportunity) => raw.retrieval!.contentHash;
    const [escaped, html, page] = (["escaped", "html", "none"] as const).map((structured) => captureOf(linkedInPage({ ...kerv, structured, validThrough: "2026-11-22T20:10:32.000Z" })));
    expect(hash(escaped!)).toBe(hash(page!));
    expect(hash(html!)).toBe(hash(page!));
    const changed = captureOf(linkedInPage({ ...kerv, structured: "escaped", html: kervHtml.replace("twice a week", "three days a week") }));
    expect(hash(changed)).not.toBe(hash(page!));
  });

  it("new reads record reader revision 2; no site's refresh minimum is raised, so saved jobs are not re-read for it", () => {
    expect(pageReaderRevision).toBe(2);
    expect(captureOf(linkedInPage({ ...kerv, structured: "none" })).sourceMetadata?.capture).toMatchObject({ readerRevision: 2 });
    // The shipped policy: a job last read by revision 1 (the November 9
    // records) or 2 is not re-read for its revision; one read before revisions
    // existed (0) still is. Its other refresh rules are unchanged.
    const now = new Date("2026-11-10T12:00:00.000Z");
    for (const key of ["linkedin", "welcome-to-the-jungle"]) {
      const policy = pageCaptureSiteByKey(key)!.refresh;
      expect(policy.minReaderRevision, key).toBe(1);
      const reason = (readerRevision: number) =>
        pageCaptureRefreshReason({ policy, latestRead: { readerRevision, readQuality: "COMPLETE", lastReadAt: new Date("2026-11-09T23:30:00.000Z") }, hasApplicationRoute: true, hasDescription: true, incompleteRefreshes: 0, now });
      expect([reason(0), reason(1), reason(2)], key).toEqual(["OUTDATED_READER", null, null]);
    }
  });
});

// --------------------------------- Fix C: LinkedIn validThrough is an expiry

describe("Fix C — LinkedIn's validThrough is its listing expiry, not an application deadline", () => {
  const normalize = (raw: RawOpportunity) => createRetrievedOpportunityNormalizer().normalize(raw);

  it("Kerv and Staffr: the structured validThrough (datePosted + 30 days) gives no closing date, and is not material", async () => {
    expect([...listingExpiryValidThroughSites].sort()).toEqual(["linkedin", "otta", "welcome-to-the-jungle"]);
    for (const [validThrough, posting] of [
      ["2026-11-22T20:10:32.000Z", kerv],
      ["2026-12-01T10:27:42.000Z", { ...kerv, id: "4485941875", company: "Staffr", title: "Customer Success Manager", html: "<p><strong>Location:</strong> Hybrid, London (1–2 days a week in the office)<br></p><p>Four weeks a year of Work from Anywhere.</p><ul><li>Own renewals.</li></ul>" }],
    ] as const) {
      const page = linkedInPage({ ...posting, structured: "escaped", validThrough });
      expect(read(page).extraction.posting!.closingDate).toBe(validThrough);
      const raw = captureOf(page);
      expect(JSON.stringify(raw)).not.toContain(validThrough);
      const { opportunity, provenance } = await normalize(raw);
      expect(opportunity.closingDate).toBeNull();
      expect(provenance.filter((row) => row.fieldName === "closingDate")).toEqual([]);
      expect(opportunity.remoteStatus).toBe("HYBRID");
    }
  });

  it("a deadline the LinkedIn posting states in its own words is still the closing date", async () => {
    const page = linkedInPage({ ...kerv, html: `${kervHtml}<p>Applications close on 5 December 2026.</p>`, structured: "escaped", validThrough: "2026-11-22T20:10:32.000Z" });
    const { opportunity, provenance } = await normalize(captureOf(page));
    expect(opportunity.closingDate?.toISOString()).toBe("2026-12-05T00:00:00.000Z");
    expect(provenance.find((row) => row.fieldName === "closingDate")?.sourceField).toBe("rawText:explicit-closing-date-statement");
  });
});

// ------------------------------------ Fix B: role-level hybrid statements

describe("Fix B — the shared arrangement reader: role-level hybrid statements", () => {
  const arrangement = (text: string, location = "London, England, United Kingdom") => {
    const facts = readJobTextFacts({ text, title: "Customer Success Manager", location, observedAt: capturedAt });
    return { remoteStatus: facts.remoteStatus?.value ?? null, sourceField: facts.remoteStatus?.sourceField ?? null, options: facts.workArrangements?.value ?? null };
  };
  const posting = (...lines: string[]) =>
    ["Customer Success Manager for a fast-growing SaaS platform.", "Own onboarding, adoption and renewals for a portfolio of customers.", ...lines].join("\n");

  it("Papirfly: a requirement to work in a hybrid environment is Hybrid", () => {
    expect(arrangement(posting("What we're looking for:", "Must be based in London and excited about working in a hybrid, collaborative environment."))).toEqual({
      remoteStatus: "HYBRID",
      sourceField: "rawText:explicit-work-arrangement-statement",
      options: null,
    });
  });

  it("Kerv: office attendance twice a week, with the office named first, and the hybrid-model requirement agree on Hybrid", () => {
    expect(arrangement(posting(
      "We are a hybrid working company and this role will require to attend Richmond (TW9) based office twice a week depending on business needs.",
      "Comfortable working within a hybrid model that balances office-based and remote work.",
    ), "Greater London, United Kingdom")).toMatchObject({ remoteStatus: "HYBRID", options: null });
    for (const sentence of [
      "You will attend our Richmond office twice a week.",
      "This role requires you to be in our London office 2 days a week.",
      "Expect to be in the office three times a week.",
      "Twice a week in the office, the rest from home.",
    ]) expect(arrangement(posting(sentence)), sentence).toMatchObject({ remoteStatus: "HYBRID", sourceField: "rawText:explicit-office-days-statement" });
    expect(arrangement(posting("You will attend the office five times a week."))).toMatchObject({ remoteStatus: "ONSITE" });
  });

  it("Easyship and Staffr stay Hybrid; their Work from Anywhere weeks do not override it", () => {
    expect(arrangement(posting("This is a full-time, hybrid role (3 days in office) based in London.", "Four weeks per year of Work from Anywhere flexibility."))).toMatchObject({
      remoteStatus: "HYBRID",
      sourceField: "rawText:explicit-work-arrangement-statement",
    });
    expect(arrangement(posting("Location: Hybrid, London (1–2 days a week in the office)", "Four weeks a year to Work from Anywhere."))).toMatchObject({ remoteStatus: "HYBRID" });
  });

  it("Busuu: company-wide hybrid or remote flexibility confirms no arrangement for the role (no options either)", () => {
    expect(arrangement(posting("We offer flexible working hours and a hybrid or remote model.", "Join our London team."))).toEqual({ remoteStatus: null, sourceField: null, options: null });
  });

  it("SWEEP: the employer's hybrid work model and its offices are company prose; the role being based in London states no arrangement (Unknown, under the current contract)", () => {
    expect(arrangement(posting(
      "This role is based in London.",
      "Our hybrid work model, with hiring focussed around our head offices in Paris, London and Montpellier, means you will meet your team in person regularly.",
    ))).toMatchObject({ remoteStatus: null, options: null });
  });

  it("states no arrangement: company policy, benefits, optional or indefinite attendance, past experience, alternatives, negation, other periods", () => {
    for (const sentence of [
      "We are a hybrid working company.",
      "Flexible working, hybrid options and a great culture.",
      "You may attend our London office twice a week.",
      "Come into the office up to twice a week if you like.",
      "Occasionally attend the office twice a week for planning.",
      "Experience working in a hybrid environment.",
      "Comfortable working in a hybrid or remote environment.",
      "You will not work in a hybrid model.",
      "We meet in the office twice a year.",
      "Travel to customer sites twice a week.",
    ]) expect(arrangement(posting(sentence)).remoteStatus, sentence).toBeNull();
  });
});
