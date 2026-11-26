// The Salary display contract (November 8, 2026, as clarified for the final
// pre-live corrections). All compensation stays in the one Salary field; what
// the stated range is, when the posting establishes it, follows the amounts
// in short standard wording, in the employer's own terms:
//   Base salary of $80,000–$100,000                  → $80,000–$100,000 USD (Base salary)
//   Base salary of $70,000 plus commission           → $70,000 USD base + commission
//   $90,000–$120,000 including bonuses               → $90,000–$120,000 USD (Includes bonuses)
//   Target total cash compensation of $106,400–$197,600, including base
//   salary and target incentives                     → $106,400–$197,600 USD (Target total cash: base + incentives)
//   OTE of $120,000                                  → $120,000 USD (OTE)
// One shared reading (compensationArrangement, Core) serves the normalizers
// and every view. OTE only when the employer says OTE or on-target; target
// total cash is never relabelled OTE; a range that includes variable pay is
// never base salary (internally it carries the OTE basis, so the salary
// policy never reads it as base); no base amount is ever derived from a
// combined range; variable pay alone is never a salary; ambiguous statements
// stay Unknown; nothing is invented. The compensation basis the evaluator
// reads stays BASE, OTE or Unknown.
import { evaluateSalaryPolicy } from "@ai-career/customer-success";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compensationArrangement, compensationArrangementLabel, currencySign, rangeIncludesVariablePay } from "@ai-career/core";
import type { OpportunityListItem } from "@ai-career/database";
import { createRetrievedOpportunityNormalizer, parseCompensation } from "@ai-career/normalization";
import { OpportunityList } from "../../apps/web/src/components/dashboard/opportunity-list";
import { formatCompensationRange, formatSalary, formatSalaryRange } from "../../apps/web/src/components/opportunity-facts";
import { capturedListing, parseCapture } from "../../apps/web/src/server/extension-capture";

const normalizer = createRetrievedOpportunityNormalizer();
const at = new Date("2026-11-08T12:00:00.000Z");

// A Single Capture of a page stating the compensation, through the capture
// mapping and the shared normalizer, as the job is stored.
async function captured(statement: string, salaryText: string | null = null, location = "Austin, TX") {
  const envelope = {
    schemaVersion: 1,
    pageUrl: "https://boards.greenhouse.io/acme/jobs/4012345",
    extractor: "structured-data",
    capturedAt: at.toISOString(),
    extensionVersion: "0.3.0",
    readerRevision: 1,
    notes: [],
    pageTitle: null,
    pageText: null,
    fields: { title: "Customer Success Manager", company: "Acme", location, description: `Own onboarding, adoption and renewals for a portfolio of customers.\n\n${statement}`, ...(salaryText ? { salaryText } : {}) },
  };
  const { raw } = capturedListing(parseCapture(envelope), { pairingId: "p", domain: "customer-success", receivedAt: at, method: "single" });
  const { opportunity, provenance } = await normalizer.normalize(raw);
  return { opportunity: opportunity as Record<string, unknown> & Parameters<typeof formatSalary>[0], provenance: provenance as Array<{ fieldName: string; sourceText?: string | null }> };
}

describe("the five arrangements, from capture to the Salary shown", () => {
  const cases = [
    ["Base salary of $80,000–$100,000.", "$80,000–$100,000 USD (Base salary)", "BASE"],
    ["Base salary of $70,000 plus commission.", "$70,000 USD base + commission", "BASE"],
    ["Compensation: $70,000 base salary plus commission.", "$70,000 USD base + commission", "BASE"],
    ["The salary range is $90,000–$120,000, including bonuses.", "$90,000–$120,000 USD (Includes bonuses)", "OTE"],
    [
      "Target total cash compensation of $106,400–$197,600, including base salary and target incentives.",
      "$106,400–$197,600 USD (Target total cash: base + incentives)",
      "OTE",
    ],
    ["This role offers OTE of $120,000.", "$120,000 USD (OTE)", "OTE"],
    ["The on-target earnings for this role are $120,000.", "$120,000 USD (OTE)", "OTE"],
  ] as const;
  for (const [statement, shown, basis] of cases) {
    it(`"${statement}" → ${shown}`, async () => {
      const { opportunity, provenance } = await captured(statement);
      expect(formatSalary(opportunity)).toBe(shown);
      // The basis the evaluator reads: only BASE, OTE or Unknown; every
      // variable-inclusive total is OTE internally, never base.
      expect(opportunity.compensationBasis).toBe(basis);
      // The employer's wording is kept as the Salary's evidence.
      expect(opportunity.salaryText).toBe(statement);
      expect(provenance.find((row) => row.fieldName === "salaryText")?.sourceText).toBe(statement);
    });
  }

  it("the salary policy never reads a variable-inclusive total as base salary", async () => {
    const decide = async (statement: string) => {
      const { opportunity } = await captured(statement);
      return evaluateSalaryPolicy({
        minimum: opportunity.salaryMin as number | null,
        maximum: opportunity.salaryMax as number | null,
        currency: opportunity.currency as string | null,
        compensationBasis: opportunity.compensationBasis as "BASE" | "OTE" | null,
        residencyRequirement: "US_REQUIRED",
        residencyRegions: ["US"],
        substantiallyLowerCostCountries: [],
      });
    };
    expect(await decide("Base salary of $80,000–$100,000.")).toMatchObject({ result: "PASS", reason: "US_THRESHOLD" });
    for (const statement of [
      "The salary range is $90,000–$120,000, including bonuses.",
      "Target total cash compensation of $106,400–$197,600, including base salary and target incentives.",
      "This role offers OTE of $120,000.",
      "Total cash compensation of $50,000–$58,000, including base salary and bonus.",
    ]) {
      // A total below the U.S. minimum is not a definite failure either: its
      // base salary is unknown.
      expect(await decide(statement), statement).toMatchObject({ result: "UNKNOWN", reason: "OTE_NOT_CONFIRMED_BASE" });
    }
  });

  it("Thomson Reuters (real text): the defining sentence stays with the statement; never relabelled OTE", async () => {
    const e5 = JSON.parse(readFileSync("tests/fixtures/real-captures/mode-b-e5-linkedin-nov7.json", "utf8")) as Record<string, unknown>;
    const description = JSON.stringify(e5).match(/Thomson Reuters complies with local laws[^"]*?sales incentive\./)![0].replace(/\\n/g, "\n").replace(/\\u2019/g, "’");
    const { opportunity, provenance } = await captured(description);
    expect(opportunity).toMatchObject({ salaryMin: 106_400, salaryMax: 197_600, currency: "USD", compensationBasis: "OTE" });
    expect(formatSalary(opportunity)).toBe("$106,400–$197,600 USD (Target total cash: base + incentives)");
    expect(opportunity.salaryText).toBe(
      "For any eligible US locations, unless otherwise noted, the target total cash compensation range for this role is $106,400 USD - $197,600 USD. Target total cash compensation ranges are inclusive of both base pay and any target sales incentive.",
    );
    expect(provenance.find((row) => row.fieldName === "salaryText")?.sourceText).toBe(opportunity.salaryText);
  });
});

// The range from structured page data (JSON-LD baseSalary and the like), the
// wording in the job description (final pre-live Salary correction, November
// 8, 2026): the description's wording applies only through a statement of
// exactly that range; otherwise nothing is claimed.
describe("a structured salary range and the job description's wording", () => {
  async function structured(description: string, salaryText: string | null = null) {
    const envelope = {
      schemaVersion: 1,
      pageUrl: "https://boards.greenhouse.io/acme/jobs/4012345",
      extractor: "structured-data",
      capturedAt: at.toISOString(),
      extensionVersion: "0.3.0",
      readerRevision: 1,
      notes: [],
      pageTitle: null,
      pageText: null,
      fields: {
        title: "Customer Success Manager", company: "Acme", location: "Austin, TX",
        description: `Own onboarding, adoption and renewals for a portfolio of customers.\n\n${description}`,
        salaryMin: 100_000, salaryMax: 125_000, salaryCurrency: "USD", salaryPeriod: "YEAR",
        ...(salaryText ? { salaryText } : {}),
      },
    };
    const { raw } = capturedListing(parseCapture(envelope), { pairingId: "p", domain: "customer-success", receivedAt: at, method: "single" });
    const { opportunity, provenance } = await normalizer.normalize(raw);
    return { opportunity: opportunity as Record<string, unknown> & Parameters<typeof formatSalary>[0], provenance: provenance as Array<{ fieldName: string; sourceField: string; sourceText?: string | null }>, raw };
  }
  const policy = (opportunity: Record<string, unknown>) =>
    evaluateSalaryPolicy({
      minimum: opportunity.salaryMin as number | null, maximum: opportunity.salaryMax as number | null, currency: opportunity.currency as string | null,
      compensationBasis: opportunity.compensationBasis as "BASE" | "OTE" | null, residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], substantiallyLowerCostCountries: [],
    });

  it("explicitly identified as OTE in the job description → (OTE); never base for the salary policy", async () => {
    const statement = "The on-target earnings (OTE) for this role are $100,000 - $125,000, split 60/40 between base salary and commission.";
    const { opportunity, provenance } = await structured(statement);
    expect(opportunity).toMatchObject({ salaryMin: 100_000, salaryMax: 125_000, currency: "USD", compensationBasis: "OTE", salaryText: statement });
    expect(formatSalary(opportunity)).toBe("$100,000–$125,000 USD (OTE)");
    // The amounts' evidence is the structured data; the wording's is the
    // employer's sentence.
    expect(provenance.find((row) => row.fieldName === "salaryMin")?.sourceField).toBe("source.salaryMin");
    expect(provenance.find((row) => row.fieldName === "salaryText")).toMatchObject({ sourceField: "rawText:explicit-compensation-statement", sourceText: statement });
    expect(policy(opportunity)).toMatchObject({ result: "UNKNOWN", reason: "OTE_NOT_CONFIRMED_BASE" });
  });

  it("a structured base salary range with separate bonus and commission eligibility → base + components", async () => {
    const statement = "The base salary range for this role is $100,000 - $125,000. In addition to base salary, this position is eligible for an annual bonus and commission.";
    const { opportunity } = await structured(statement);
    expect(opportunity).toMatchObject({ compensationBasis: "BASE", salaryText: statement });
    expect(formatSalary(opportunity)).toBe("$100,000–$125,000 USD base + bonus + commission");
    expect(policy(opportunity)).toMatchObject({ result: "PASS" });
  });

  it("target total cash compensation for the structured range → in the employer's terms, not OTE", async () => {
    const statement =
      "The target total cash compensation range for this role is $100,000 USD - $125,000 USD. Target total cash compensation ranges are inclusive of both base pay and any target sales incentive.";
    const { opportunity } = await structured(statement);
    expect(formatSalary(opportunity)).toBe("$100,000–$125,000 USD (Target total cash: base + incentives)");
    expect(opportunity.compensationBasis).toBe("OTE");
    expect(policy(opportunity)).toMatchObject({ result: "UNKNOWN", reason: "OTE_NOT_CONFIRMED_BASE" });
  });

  it("OTE, bonuses or commission mentioned with no supported link to the structured range → nothing inferred", async () => {
    for (const description of [
      "Top performers regularly exceed an OTE of $180,000.",
      "We offer a generous annual bonus, commission accelerators and equity.",
      "Our sales team's on-target earnings are among the best in the industry.",
    ]) {
      const { opportunity } = await structured(description);
      expect(opportunity, description).toMatchObject({ salaryMin: 100_000, salaryMax: 125_000, compensationBasis: null, salaryText: null });
      expect(formatSalary(opportunity), description).toBe("$100,000–$125,000 USD");
    }
  });

  it("conflicting structured and job-description evidence → conservative: no unsupported label, never confirmed base", async () => {
    // A different range in the description: it says nothing about this one.
    const other = await structured("The base salary range for this role is $90,000 - $110,000.");
    expect(other.opportunity).toMatchObject({ salaryMin: 100_000, salaryMax: 125_000, compensationBasis: null, salaryText: null });
    expect(formatSalary(other.opportunity)).toBe("$100,000–$125,000 USD");
    // The same range called base salary in one sentence and OTE in another.
    const both = await structured("The base salary range is $100,000 - $125,000.\n\nOTE for this role: $100,000 - $125,000.");
    expect(both.opportunity.compensationBasis).toBe("OTE");
    expect(both.opportunity.salaryText).toBeNull();
    expect(formatSalary(both.opportunity)).toBe("$100,000–$125,000 USD");
    expect(policy(both.opportunity)).toMatchObject({ result: "UNKNOWN", reason: "OTE_NOT_CONFIRMED_BASE" });
    // The source's own salary text calls it base; the description calls the
    // same range OTE: not confirmed base, and neither label is shown.
    const own = await structured("The on-target earnings for this role are $100,000 - $125,000.", "Base salary $100,000 - $125,000");
    expect(own.opportunity).toMatchObject({ compensationBasis: "OTE", salaryText: "Base salary $100,000 - $125,000" });
    expect(formatSalary(own.opportunity)).toBe("$100,000–$125,000 USD");
    // The source's own wording is kept in the source record either way.
    expect(own.raw.salaryText).toBe("Base salary $100,000 - $125,000");
  });

  it("the source's own salary text that already says what the range is stays the Salary's text", async () => {
    const { opportunity } = await structured("The base salary range for this role is $100,000 - $125,000.", "$100,000 - $125,000 base salary");
    expect(opportunity).toMatchObject({ compensationBasis: "BASE", salaryText: "$100,000 - $125,000 base salary" });
    expect(formatSalary(opportunity)).toBe("$100,000–$125,000 USD (Base salary)");
  });
});

describe("Thomson Reuters, Dataminr and FourKites (real text) keep their Salary", () => {
  const e4 = JSON.parse(readFileSync("tests/fixtures/real-captures/mode-b-e4-linkedin-nov5.json", "utf8")) as { listings: Record<string, { description: string; location: string }> };
  it("Dataminr → (OTE); FourKites → base + the components it names", async () => {
    const dataminr = await captured(e4.listings.dataminr!.description, null, e4.listings.dataminr!.location);
    expect(formatSalary(dataminr.opportunity)).toBe("$94,588–$139,412 USD (OTE)");
    expect(dataminr.opportunity.compensationBasis).toBe("OTE");
    const fourkites = await captured(e4.listings.fourkites!.description, null, e4.listings.fourkites!.location);
    expect(formatSalary(fourkites.opportunity)).toBe("$100,000–$125,000 USD base + bonus + incentives + equity");
    expect(fourkites.opportunity.compensationBasis).toBe("BASE");
    expect(fourkites.opportunity.salaryText).toBe(
      "The expected annual base salary range for this role is $100,000 - $125,000. In addition to base salary, this position is eligible for bonus and incentive compensation as well as participation in FourKites' employee stock option program.",
    );
  });
});

describe("what the Salary never claims", () => {
  it("OTE only when the employer says OTE or on-target: a total that includes bonus is not shown as OTE, and is not base salary", async () => {
    const { opportunity } = await captured("Total cash compensation of $90,000–$120,000, including base salary and bonus.");
    // Not base salary for the salary policy (internal OTE basis) ...
    expect(opportunity.compensationBasis).toBe("OTE");
    // ... never shown as OTE, and no base amount is derived from it.
    expect(formatSalary(opportunity)).toBe("$90,000–$120,000 USD (Includes bonuses)");
    expect(opportunity).toMatchObject({ salaryMin: 90_000, salaryMax: 120_000 });
    // Target total cash is shown in its own terms, never as OTE.
    expect(formatSalary((await captured("The target total cash compensation range for this role is $106,400 USD - $197,600 USD.")).opportunity)).toBe("$106,400–$197,600 USD (Target total cash)");
    expect(parseCompensation("OTE of $120,000 (60/40 base to variable).").basis).toBe("OTE");
    expect(parseCompensation("$150,000 on-target earnings").basis).toBe("OTE");
  });

  it("variable pay alone is never a salary", async () => {
    for (const salaryText of ["Commission: $20,000", "Bonus of up to $15,000", "Equity grant of $40,000"]) {
      const parsed = parseCompensation(salaryText);
      expect(parsed, salaryText).toMatchObject({ minimum: null, maximum: null, basis: null, amountsUnknownReason: "VARIABLE_ONLY" });
      const { opportunity } = await captured("Own renewals.", salaryText);
      expect(formatSalary(opportunity), salaryText).toBeNull();
      // Kept as stated, never discarded.
      expect(opportunity.salaryText).toBe(salaryText);
    }
  });

  it("an ambiguous statement stays Unknown (two different figures, no single range)", async () => {
    const { opportunity } = await captured("Base salary: $80,000 - $100,000 plus commission; OTE $150,000.");
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, compensationBasis: null });
    expect(formatSalary(opportunity)).toBeNull();
  });

  it("no compensation stated: Unknown", async () => {
    const { opportunity } = await captured("We offer health insurance and 25 days of leave.");
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, salaryText: null });
    expect(formatSalary(opportunity)).toBeNull();
  });

  it("names only the variable pay the statement adds: never a negated one, never 'pay equity'", async () => {
    expect(formatSalary((await captured("The base salary range is $80,000–$100,000 and does not include bonus or commission.")).opportunity)).toBe("$80,000–$100,000 USD (Base salary)");
    expect(formatSalary((await captured("The salary range is $85,000–$95,000 USD and we are committed to pay equity.")).opportunity)).toBe("$85,000–$95,000 USD");
    expect(formatSalary((await captured("Base salary $95,000–$110,000, bonus and equity.")).opportunity)).toBe("$95,000–$110,000 USD base + bonus + equity");
    // A range not called base, with a bonus added: the bonus, not "base".
    expect(formatSalary((await captured("Salary: $85,000 - $90,000 with bonus potential up to $10,000.")).opportunity)).toBe("$85,000–$90,000 USD + bonus");
  });
});

describe("country tiers and the primary range", () => {
  const e4 = JSON.parse(readFileSync("tests/fixtures/real-captures/mode-b-e4-linkedin-nov5.json", "utf8")) as { listings: Record<string, { description: string; location: string }> };

  it("Juniper Square (real text): both tiers in their own currencies, no unsupported primary, labelled base salary", async () => {
    const juniper = e4.listings["juniper-square"]!;
    const { opportunity } = await captured(juniper.description, null, juniper.location);
    expect(opportunity).toMatchObject({ salaryMin: null, salaryMax: null, currency: null, compensationBasis: null });
    expect(formatSalary(opportunity)).toBe("United States: $86,000–$95,000 USD · Canada: $77,000–$85,000 CAD (Base salary)");
  });

  it("an evidence-supported primary (U.S. only) shows the primary range with its arrangement", async () => {
    const { opportunity } = await captured(
      "The U.S. base salary range for this full-time position is $86,000 - $95,000 USD and the Canadian base salary range is $77,000 to $85,000 CAD. Candidates must reside in the United States.",
    );
    expect(formatSalary(opportunity)).toBe("$86,000–$95,000 USD (Base salary)");
  });
});

describe("the shared reading and formatting", () => {
  it("compensationArrangement and its labels", () => {
    expect(compensationArrangement(null, "OTE $120,000")).toEqual({ kind: "OTE", components: [] });
    expect(compensationArrangement("OTE", "on-target earnings of $120,000")).toEqual({ kind: "OTE", components: [] });
    // Recorded as not base, with no wording here: no label (never "OTE",
    // never "Base salary").
    expect(compensationArrangement("OTE", "$90,000–$120,000")).toBeNull();
    expect(compensationArrangement("OTE", "Base salary $90,000–$120,000")).toBeNull();
    expect(compensationArrangement("OTE", "Total target compensation: $150,000, made up of base salary and commission")).toEqual({
      kind: "TARGET_TOTAL",
      components: ["commission"],
      term: "Target total compensation",
      includesBase: true,
    });
    expect(compensationArrangementLabel(compensationArrangement("OTE", "Total target compensation: $150,000, made up of base salary and commission"))).toBe(
      "(Target total compensation: base + commission)",
    );
    // "internal equity" and "pay equity" are fair pay, not equity compensation.
    expect(compensationArrangement("OTE", "target total cash of $100,000, with consideration given to internal equity")).toMatchObject({ components: [] });
    expect(compensationArrangement("BASE", "Base salary $90,000")).toEqual({ kind: "BASE", components: [] });
    expect(compensationArrangement("BASE", "$70,000 base salary + commission and equity")).toEqual({ kind: "BASE_PLUS_VARIABLE", components: ["commission", "equity"] });
    expect(compensationArrangement(null, "$90,000–$120,000, inclusive of bonus and commission")).toEqual({ kind: "INCLUDES_VARIABLE", components: ["bonus", "commission"] });
    expect(compensationArrangement(null, "$90,000–$120,000")).toBeNull();
    expect(compensationArrangementLabel({ kind: "INCLUDES_VARIABLE", components: ["bonus", "commission"] })).toBe("(Includes bonuses and commission)");
    expect(compensationArrangementLabel(null)).toBeNull();
    expect(rangeIncludesVariablePay("This range does not include bonus.")).toBe(false);
    expect(rangeIncludesVariablePay("excluding commission")).toBe(false);
  });

  it("amounts with their currency's sign and code; no sign guessed for an unknown currency", () => {
    expect(formatSalaryRange(80_000, 100_000, "USD")).toBe("$80,000–$100,000 USD");
    expect(formatSalaryRange(77_000, 85_000, "CAD")).toBe("$77,000–$85,000 CAD");
    expect(formatSalaryRange(50_000, 60_000, "EUR")).toBe("€50,000–€60,000 EUR");
    expect(formatSalaryRange(45_000, null, "GBP")).toBe("At least £45,000 GBP");
    expect(formatSalaryRange(500_000, 700_000, "SEK")).toBe("500,000–700,000 SEK");
    expect(formatSalaryRange(null, 90_000, null)).toBe("Up to 90,000 (currency unknown)");
    expect(currencySign("CHF")).toBe("");
    expect(formatCompensationRange(80_000, 100_000, "USD", "BASE")).toBe("$80,000–$100,000 USD (Base salary)");
  });

  it("the job list shows the same Salary as the job page", async () => {
    const { opportunity } = await captured("Compensation: $70,000 base salary plus commission.");
    const row = {
      id: "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22", domain: "customer-success", status: "NORMALIZED", source: "browser-extension", sourceType: "BROWSER_EXTENSION",
      title: "Customer Success Manager", companyName: "Acme", location: "Austin, TX", postingDate: null, createdAt: at, discoveredAt: at, updatedAt: at,
      applicationUrl: null, deferred: false, latestEvaluation: null, currentRecommendation: null, priorityBand: null, roleFamily: null, customerSegment: null, application: null,
      salaryText: opportunity.salaryText as string, salaryMin: opportunity.salaryMin as number, salaryMax: opportunity.salaryMax as number,
      currency: opportunity.currency as string, compensationBasis: opportunity.compensationBasis as string,
    } as unknown as OpportunityListItem;
    const visible = renderToStaticMarkup(<OpportunityList opportunities={[row]} />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(visible).toContain(`Salary ${formatSalary(opportunity)}`);
    expect(visible).toContain("Salary $70,000 USD base + commission");
  });
});
