// The November 15, 2026 LinkedIn acceptance findings (New York batch),
// replayed offline through the shared reader, capture mapping and normalizer
// on both of LinkedIn's reader branches (its JobPosting structured data and
// its job page). The quoted sentences are the employers' own wording from
// the November 15 records; the surrounding text of each description is
// synthetic and marked as such. The complete stored texts are confirmed by
// the targeted live Single Capture re-reads (L1).
//
// Corrections (Core Platform TDD v1.22 proposal, F1–F7):
// F1 the position's own statements decide the arrangement before the title
//    and before company-wide statements; F2 statements whose subject is the
//    position; F3 office days written "3 in-office days per week"; F4 the
//    right to work stated with "without … sponsorship"; F5 the employer's
//    base range and on-target figure clarify a board's total-pay range; F6
//    "remotely from anywhere in <country>" and preferences never read as a
//    requirement; F7 the arrangement written in the title.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extensionCaptureSchema, type RawOpportunity } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { createRetrievedOpportunityNormalizer, readJobTextFacts } from "@ai-career/normalization";
import { titleArrangement } from "../../packages/normalization/src/job-text-facts";
import { parseResidency } from "../../packages/normalization/src/residency";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { capturedListing } from "../../apps/web/src/server/extension-capture";
import { readJobPage } from "../../apps/web/src/server/page-capture-acquisition";
import { employerOnTargetStatement, formatSalary } from "../../apps/web/src/components/opportunity-facts";
import f0 from "../fixtures/page-capture/linkedin-f0-cards.json";

const capturedAt = new Date("2026-11-15T15:00:00.000Z");
const filler = "Synthetic text: we are looking for a Customer Success Manager to own a portfolio of accounts and drive adoption.";

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string[];
  salary?: { min: number; max: number };
}

const jobs: Record<string, Job> = {
  jacobs: {
    id: "4461565200",
    title: "Customer Success Manager, Private Sector",
    company: "Jacobs",
    location: "United States",
    description: [filler, "Location USA (remote position)", "Original Posting: August 28, 2026", filler],
  },
  dashlane: {
    id: "4483228389",
    title: "Customer Success Manager",
    company: "Dashlane",
    location: "New York, NY",
    description: [filler, "This role is based in our New York City office on a hybrid schedule (in-office Mondays, Tuesdays, and Thursdays).", filler],
  },
  trulioo: {
    id: "4487058331",
    title: "Strategic Customer Success Manager",
    company: "Trulioo",
    location: "New York, NY",
    description: [
      filler,
      "This is a full-time, permanent position, working remotely from anywhere in the United States, with a preference for candidates based in San Diego, San Francisco, or New York.",
      // Synthetic company-wide policy (the record's own wording is not quoted
      // in the findings); it must not override the position's statement.
      "Our hybrid work model means employees near one of our offices work from the office three days a week.",
      filler,
    ],
  },
  permitflow: {
    id: "4473952660",
    title: "Enterprise Customer Success Manager",
    company: "PermitFlow",
    location: "New York, NY",
    description: [filler, "Our HQ is in New York City with a hybrid schedule (3 in-office days per week).", filler],
  },
  fullpath: {
    id: "4371645061",
    title: "Customer Success Manager, Enterprise",
    company: "Fullpath",
    location: "United States",
    salary: { min: 110_000, max: 118_000 },
    description: [
      filler,
      "This is a remote position with limited travel requirements.",
      "Requirements:",
      "Legal authorization to work in the United States without the need for employer sponsorship now or in the future.",
      "Compensation:",
      "Annual base salary: $80,000–$88,000",
      "On-target earnings: up to $118,000",
      "The advertised total compensation includes base salary plus variable/commission.",
    ],
  },
};

const pageUrl = (job: Job) => `https://www.linkedin.com/jobs/view/${job.id}/`;
const html = (job: Job) => job.description.map((line) => `<p>${line}</p>`).join("");

// LinkedIn's page for a job, as its JobPosting structured data (with the
// board's salary as baseSalary) or as its job page (with the board's salary
// in the top card).
function page(job: Job, structured: boolean) {
  const escaped = html(job).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const jsonLd = structured
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "http://schema.org",
        "@type": "JobPosting",
        title: job.title,
        description: escaped,
        datePosted: "2026-11-08",
        hiringOrganization: { "@type": "Organization", name: job.company },
        jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.location } },
        ...(job.salary
          ? { baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: job.salary.min, maxValue: job.salary.max, unitText: "YEAR" } } }
          : {}),
      }).replace(/</g, "\\u003c")}</script>`
    : "";
  const salary = !structured && job.salary ? `<div class="salary compensation__salary">$${job.salary.min.toLocaleString("en-US")}.00/yr - $${job.salary.max.toLocaleString("en-US")}.00/yr</div>` : "";
  return `<!doctype html><html><head><title>${job.title} | ${job.company} | LinkedIn</title>${jsonLd}</head><body><main>
<section class="top-card-layout"><h1 class="top-card-layout__title">${job.title}</h1><a class="topcard__org-name-link" href="https://www.linkedin.com/company/x">${job.company}</a>
<span class="topcard__flavor topcard__flavor--bullet">${job.location}</span><span class="posted-time-ago__text">1 week ago</span>${salary}</section>
<section class="description"><div class="show-more-less-html__markup">${html(job)}</div></section></main></body></html>`;
}

function read(job: Job, structured: boolean): RawOpportunity {
  const window = new JSDOM(page(job, structured), { url: pageUrl(job), runScripts: "outside-only" }).window;
  try {
    const extraction = readJobPage(window.document)!;
    const built = buildCaptureEnvelope({ ...extraction, pageUrl: pageUrl(job) }, "page", { extensionVersion: "0.3.0", capturedAt });
    if (!built.ok) throw new Error(built.problems.join("; "));
    return capturedListing(extensionCaptureSchema.parse(built.envelope), {
      pairingId: "p",
      domain: customerSuccessDiscoveryConfiguration.domain,
      receivedAt: capturedAt,
      method: "single",
    }).raw;
  } finally {
    window.close();
  }
}

async function normalized(job: Job, structured: boolean) {
  const raw = read(job, structured);
  const { opportunity, provenance } = await createRetrievedOpportunityNormalizer().normalize(raw);
  return { raw, opportunity, provenance: (field: string) => provenance.filter((row) => row.fieldName === field) };
}

const branches = [
  ["structured data", true],
  ["job page", false],
] as const;

describe("November 15 LinkedIn records, on both reader branches", () => {
  for (const [branch, structured] of branches) {
    describe(branch, () => {
      it("Jacobs: 'Location USA (remote position)' → Remote", async () => {
        const { opportunity, provenance } = await normalized(jobs.jacobs!, structured);
        expect(opportunity.remoteStatus).toBe("REMOTE");
        expect(provenance("remoteStatus")[0]?.sourceText).toBe("Location USA (remote position)");
      });

      it("Dashlane: based in the office on a hybrid schedule → Hybrid", async () => {
        const { opportunity } = await normalized(jobs.dashlane!, structured);
        expect(opportunity.remoteStatus).toBe("HYBRID");
      });

      it("Trulioo: the position's remote statement wins over the company-wide hybrid policy; nationwide US eligibility; preferred cities are no requirement", async () => {
        const { opportunity, provenance } = await normalized(jobs.trulioo!, structured);
        expect(opportunity.remoteStatus).toBe("REMOTE");
        expect(provenance("remoteStatus")[0]?.sourceText).toMatch(/^This is a full-time, permanent position, working remotely/);
        expect(opportunity.residencyRequirement).toBe("US_REQUIRED");
        expect(opportunity.residencyRegions).toEqual(["US"]);
        expect(opportunity.employmentType).toBe("FULL_TIME");
        expect(opportunity.location).toBe("New York, NY");
      });

      it("PermitFlow: '3 in-office days per week' → Hybrid", async () => {
        const { opportunity } = await normalized(jobs.permitflow!, structured);
        expect(opportunity.remoteStatus).toBe("HYBRID");
      });

      it("Fullpath: Remote (positive control); the right to work in the US required and no sponsorship", async () => {
        const { opportunity } = await normalized(jobs.fullpath!, structured);
        expect(opportunity.remoteStatus).toBe("REMOTE");
        expect(opportunity.workAuthorizationRequirement).toBe("RIGHT_TO_WORK");
        expect(opportunity.workAuthorizationRegions).toEqual(["US"]);
        expect(opportunity.visaSponsorship).toBe("NOT_AVAILABLE");
      });

      it("Fullpath: the employer's base salary replaces the board's total-pay range; the on-target figure is kept as on-target earnings, never as variable pay", async () => {
        const { raw, opportunity, provenance } = await normalized(jobs.fullpath!, structured);
        expect(opportunity.salaryMin).toBe(80_000);
        expect(opportunity.salaryMax).toBe(88_000);
        expect(opportunity.currency).toBe("USD");
        expect(opportunity.compensationBasis).toBe("BASE");
        expect(opportunity.salaryText).toBe("Annual base salary: $80,000–$88,000");
        expect(formatSalary(opportunity)).toBe("$80,000–$88,000 USD (Base salary)");
        expect(provenance("salaryMin").map((row) => row.sourceField)).toEqual(["rawText:employer-base-and-ote-statement"]);
        // OTE is total pay (base plus variable): it is never the bonus /
        // variable-pay fact (which the evaluator and the source-version check
        // read as variable pay). The opportunity page shows it from the
        // salary's evidence, labelled as on-target earnings.
        expect(opportunity.bonus).toBeNull();
        expect(employerOnTargetStatement(provenance("salaryMin"))).toBe("On-target earnings: up to $118,000");
        // The board's range stays in the source record.
        const board = structured ? raw.sourceMetadata?.structured : raw.salaryText;
        expect(JSON.stringify(board)).toMatch(/110,?000/);
      });
    });
  }
});

describe("F1/F2: the position's statements, and the guards", () => {
  const arrangement = (text: string, title: string | null = "Customer Success Manager") => readJobTextFacts({ text, title, observedAt: capturedAt }).remoteStatus?.value ?? null;

  it("reads statements whose subject is the position", () => {
    expect(arrangement("This role is remote, with occasional on-site customer visits.")).toBe("REMOTE");
    expect(arrangement("The position is office-based in our Austin headquarters.")).toBe("ONSITE");
    expect(arrangement("You will be working remotely from anywhere in Canada.")).toBe("REMOTE");
    expect(arrangement("Remote anywhere in the United States")).toBe("REMOTE");
    expect(arrangement("This role requires 3 days a week in the office.")).toBe("HYBRID");
  });

  it("states nothing for negated, alternative, indefinite, limited or past-experience wording", () => {
    expect(arrangement("This role is not remote.")).toBeNull();
    expect(arrangement("This is a remote or hybrid role.")).toBeNull();
    expect(arrangement("This role may be remote for the right candidate.")).toBeNull();
    expect(arrangement("This is a great opportunity for someone who has worked remotely before.")).toBeNull();
    expect(arrangement("Experience working in a remote role.")).toBeNull();
    expect(arrangement("You will be able to work from anywhere for up to 4 weeks a year.")).toBeNull();
    expect(arrangement("Up to 2 days in office per week.")).toBeNull();
  });

  it("company-wide wording alone stays Unknown (Core TDD v1.21 ¶856)", () => {
    expect(arrangement("We are a hybrid working company.")).toBeNull();
    expect(arrangement("Our hybrid work model supports flexibility.")).toBeNull();
    expect(arrangement("We offer a hybrid or remote model.")).toBeNull();
  });

  it("a company-wide office cadence decides only when the posting says nothing of the position", () => {
    expect(arrangement("Our teams work from the office three days a week.")).toBe("HYBRID");
    expect(arrangement("Our teams work from the office three days a week.\nThis is a fully remote role.")).toBe("REMOTE");
    // Two statements about the position that disagree: Unknown.
    expect(arrangement("This is a fully remote role.\nThis role is based in our London office on a hybrid schedule.")).toBeNull();
  });
});

describe("F7: the arrangement written in the title", () => {
  const card = (f0.cards as string[])[0]!;
  const realTitle = /class="base-search-card__title">\s*([^<]+?)\s*</.exec(card)![1]!;

  it("the real F0 title '… (Remote, US)' states Remote", () => {
    expect(realTitle).toMatch(/\(Remote, US\)$/);
    expect(titleArrangement(realTitle)).toBe("REMOTE");
    const facts = readJobTextFacts({ text: filler, title: realTitle, observedAt: capturedAt });
    expect(facts.remoteStatus).toMatchObject({ value: "REMOTE", sourceField: "title:stated-work-arrangement" });
  });

  it("reads a trailing segment, and never a negated or conflicting one", () => {
    expect(titleArrangement("Customer Success Manager – Hybrid")).toBe("HYBRID");
    expect(titleArrangement("Customer Success Manager | On-site")).toBe("ONSITE");
    expect(titleArrangement("Customer Success Manager (Non-Remote)")).toBeNull();
    expect(titleArrangement("Customer Success Manager (Remote or Hybrid)")).toBeNull();
    expect(titleArrangement("Remote Customer Success Manager")).toBeNull();
  });

  it("the description's statement about the position wins over the title; the title wins over company-wide statements", () => {
    const fromText = readJobTextFacts({ text: "This role is based in our NYC office on a hybrid schedule.", title: "CSM (Remote, US)", observedAt: capturedAt });
    expect(fromText.remoteStatus?.value).toBe("HYBRID");
    const fromTitle = readJobTextFacts({ text: "Our teams work from the office three days a week.", title: "CSM (Remote, US)", observedAt: capturedAt });
    expect(fromTitle.remoteStatus?.value).toBe("REMOTE");
  });
});

describe("F4: work authorization", () => {
  const authorization = (text: string) => readJobTextFacts({ text, observedAt: capturedAt }).workAuthorization?.value ?? null;

  it("reads a right to work stated with 'without sponsorship', or as a qualification line", () => {
    expect(authorization("Legal authorization to work in the United States without the need for employer sponsorship now or in the future.")).toEqual({ requirement: "RIGHT_TO_WORK", regions: ["US"] });
    expect(authorization("Valid authorization to work in the UK")).toEqual({ requirement: "RIGHT_TO_WORK", regions: ["GB"] });
  });

  it("never reads a preference, a negation, or a citizenship that is not stated", () => {
    expect(authorization("Authorization to work in the United States is a plus.")).toBeNull();
    expect(authorization("We do not require authorization to work in Canada.")).toBeNull();
    expect(authorization("Legal authorization to work in the United States without the need for employer sponsorship.")?.requirement).toBe("RIGHT_TO_WORK");
  });
});

describe("F6: residency", () => {
  const residency = (rawText: string) => parseResidency({ rawText, location: null });

  it("'remotely from anywhere in <country>' is where the role may be done; a stated preference is set aside", () => {
    expect(residency("Work remotely from anywhere in Canada, with a preference for candidates based in Toronto.")).toMatchObject({ regions: ["CA"] });
  });

  it("remote work allowed only for a while is a benefit, not eligibility", () => {
    expect(residency("You can work remotely from anywhere in the world for up to 4 weeks a year.").requirement).toBeNull();
  });
});

describe("F5: what does not change", () => {
  const job = (description: string[], salary = { min: 110_000, max: 118_000 }): Job => ({ ...jobs.fullpath!, description, salary });

  it("a description stating the board's range as on-target earnings keeps the existing reading", async () => {
    const { opportunity } = await normalized(job([filler, "On-target earnings: $110,000–$118,000"]), true);
    expect([opportunity.salaryMin, opportunity.salaryMax, opportunity.compensationBasis]).toEqual([110_000, 118_000, "OTE"]);
  });

  it("a base range without a matching on-target figure leaves the board's range as it was", async () => {
    const { opportunity } = await normalized(job([filler, "Annual base salary: $80,000–$88,000", "On-target earnings: up to $125,000"]), true);
    expect([opportunity.salaryMin, opportunity.salaryMax]).toEqual([110_000, 118_000]);
    expect(opportunity.bonus).not.toBe("On-target earnings: up to $125,000");
  });

  it("two different base ranges establish nothing", async () => {
    const { opportunity } = await normalized(job([filler, "Annual base salary: $80,000–$88,000", "Annual base salary (senior): $90,000–$98,000", "On-target earnings: up to $118,000"]), true);
    expect([opportunity.salaryMin, opportunity.salaryMax]).toEqual([110_000, 118_000]);
  });
});

describe("posting dates (no change)", () => {
  it("month-old LinkedIn ages stay Unknown; the description's own original posting date is not the posting date", async () => {
    const { opportunity } = await normalized(jobs.jacobs!, false);
    // "1 week ago" on the page is LinkedIn's (re)posting age.
    expect(opportunity.postingDate?.toISOString().slice(0, 10)).toBe("2026-11-08");
  });
});
