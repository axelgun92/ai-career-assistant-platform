import { describe, expect, it } from "vitest";
import {
  compensationCurrencyCodes,
  createManualOpportunityService,
  manualOpportunitySubmissionSchema,
  rawOpportunitySchema,
  seniorityValues,
  workArrangementValues,
  type RawOpportunity,
} from "@ai-career/core";
import {
  bareDollarCurrencySourceField,
  createManualOpportunityNormalizer,
  parseCompensation,
  seniorityFromTitle,
  standardizeEmploymentType,
  workArrangementFromLocation,
} from "@ai-career/normalization";
import {
  arrangementOptions,
  salaryCurrencyOptions,
  seniorityOptions,
} from "../../apps/web/src/server/opportunity-query";

const amounts = (text: string, currency: Parameters<typeof parseCompensation>[1] = null) => {
  const parsed = parseCompensation(text, currency);
  return [parsed.minimum, parsed.maximum, parsed.currency];
};

describe("compensation parsing", () => {
  it.each([
    ["$72,000-$88,000", [72000, 88000, "USD"]],
    ["$72k – $88k per year", [72000, 88000, "USD"]],
    ["72-88k USD", [72000, 88000, "USD"]],
    ["USD 72,000 - 88,000", [72000, 88000, "USD"]],
    ["between $70k and $90k", [70000, 90000, "USD"]],
    ["€60.000 - €70.000", [60000, 70000, "EUR"]],
    ["72.5k-80k EUR", [72500, 80000, "EUR"]],
    ["CA$90,000 - CA$110,000", [90000, 110000, "CAD"]],
    ["$90,000 CAD", [90000, 90000, "CAD"]],
    ["$72,000-$88,000 + 10% bonus + 401(k)", [72000, 88000, "USD"]],
  ])("reads a stated range: %s", (text, expected) => {
    expect(amounts(text)).toEqual(expected);
  });

  it("reads single values and open-ended ranges", () => {
    expect(amounts("£45,000")).toEqual([45000, 45000, "GBP"]);
    expect(amounts("$80,000")).toEqual([80000, 80000, "USD"]);
    expect(amounts("Up to $90,000")).toEqual([null, 90000, "USD"]);
    expect(amounts("From $70,000")).toEqual([70000, null, "USD"]);
    expect(amounts("$70,000+")).toEqual([70000, null, "USD"]);
  });

  it("keeps missing salary Unknown", () => {
    expect(parseCompensation(null)).toMatchObject({ minimum: null, maximum: null, currency: null });
    expect(parseCompensation("Competitive")).toMatchObject({ minimum: null, maximum: null, currency: null });
    expect(parseCompensation("   ")).toMatchObject({ minimum: null, maximum: null, currency: null });
  });

  it("keeps ambiguous amounts Unknown while preserving the currency", () => {
    expect(parseCompensation("$30/hour")).toMatchObject({ minimum: null, maximum: null, currency: "USD" });
    expect(parseCompensation("$6,000 per month")).toMatchObject({ minimum: null, amountsUnknownReason: "NON_ANNUAL_PERIOD" });
    expect(parseCompensation("$30-$40")).toMatchObject({ minimum: null, maximum: null });
    expect(parseCompensation("$120k OTE")).toMatchObject({ minimum: null, amountsUnknownReason: "TOTAL_COMPENSATION" });
    expect(parseCompensation("$72k-$88k base + $10k bonus")).toMatchObject({ minimum: null, amountsUnknownReason: "AMBIGUOUS_AMOUNTS" });
    expect(parseCompensation("$80,000 or $95,000")).toMatchObject({ minimum: null, amountsUnknownReason: "AMBIGUOUS_AMOUNTS" });
    expect(parseCompensation("$88,000 - $72,000")).toMatchObject({ minimum: null, amountsUnknownReason: "INVERTED_RANGE" });
    expect(parseCompensation("$5,000,000,000")).toMatchObject({ minimum: null, amountsUnknownReason: "AMBIGUOUS_AMOUNTS" });
  });

  it("states the currency basis: explicit, bare dollar read as USD, or selected", () => {
    expect(parseCompensation("USD 80,000").currencyBasis).toBe("STATED_CODE_OR_SYMBOL");
    expect(parseCompensation("$80,000").currencyBasis).toBe("BARE_DOLLAR_AS_USD");
    expect(parseCompensation("$80,000", "CAD")).toMatchObject({ currency: "CAD", currencyBasis: "SELECTED" });
    expect(parseCompensation("80,000", "EUR")).toMatchObject({ currency: "EUR", currencyBasis: "SELECTED" });
    expect(parseCompensation(null, "GBP")).toMatchObject({ currency: "GBP", minimum: null });
  });

  it("never picks between conflicting currencies", () => {
    expect(parseCompensation("€60,000 USD")).toMatchObject({ currency: null, currencyUnknownReason: "CONFLICTING_CURRENCIES", minimum: 60000 });
    expect(parseCompensation("£80k", "EUR")).toMatchObject({ currency: null, currencyUnknownReason: "CONFLICTING_CURRENCIES" });
    expect(parseCompensation("$80k", "EUR")).toMatchObject({ currency: null, currencyUnknownReason: "CONFLICTING_CURRENCIES" });
    expect(parseCompensation("€60,000 and $70,000")).toMatchObject({ currency: null });
    expect(parseCompensation("¥5,000,000")).toMatchObject({ currency: null, currencyUnknownReason: "AMBIGUOUS_SYMBOL" });
  });

  it("is deterministic across repeated calls (no shared regex state)", () => {
    const first = parseCompensation("CA$90,000");
    expect(parseCompensation("CA$90,000")).toEqual(first);
    expect(parseCompensation("US$70,000")).toMatchObject({ currency: "USD" });
    expect(parseCompensation("US$70,000")).toMatchObject({ currency: "USD" });
  });
});

describe("bare $ rule (product decision: read as USD, recorded as derived)", () => {
  it("normalizes $72,000–$88,000 to 72000–88000 USD", () => {
    expect(parseCompensation("$72,000–$88,000")).toMatchObject({
      minimum: 72000, maximum: 88000, currency: "USD", currencyBasis: "BARE_DOLLAR_AS_USD",
    });
  });

  it.each([
    ["US$72,000–US$88,000", "USD"],
    ["USD 72,000–88,000", "USD"],
    ["CA$72,000–CA$88,000", "CAD"],
    ["C$72,000", "CAD"],
    ["$72,000–$88,000 CAD", "CAD"],
    ["A$72,000–A$88,000", "AUD"],
    ["AU$72,000", "AUD"],
    ["$72,000–$88,000 AUD", "AUD"],
    ["€72,000–€88,000", "EUR"],
    ["£72,000–£88,000", "GBP"],
  ])("explicit currency takes precedence: %s → %s", (text, currency) => {
    expect(parseCompensation(text)).toMatchObject({ currency, currencyBasis: "STATED_CODE_OR_SYMBOL" });
  });

  it("never overrides an explicitly stated non-USD currency", () => {
    expect(parseCompensation("$72,000 EUR").currency).toBeNull(); // contradiction: Unknown, not USD
    expect(parseCompensation("£72,000 ($90,000)").currency).toBeNull();
    expect(parseCompensation("$72,000", "GBP").currency).toBeNull();
    expect(parseCompensation("$72,000", "CAD")).toMatchObject({ currency: "CAD", currencyBasis: "SELECTED" });
  });

  it("records the bare-$ currency as derived with its own marker; stated currencies are distinguishable", async () => {
    const normalizer = createManualOpportunityNormalizer();
    const currencyRow = async (salaryText: string, compensationCurrency: string | null = null) =>
      (await normalizer.normalize(raw({
        salaryText,
        sourceMetadata: compensationCurrency ? { details: { compensationCurrency } } : null,
      }))).provenance.find((row) => row.fieldName === "currency");

    expect(await currencyRow("$72,000–$88,000")).toMatchObject({
      kind: "DETERMINISTIC", sourceField: bareDollarCurrencySourceField, normalizedValue: "USD", sourceText: "$72,000–$88,000",
    });
    expect(await currencyRow("USD 72,000–88,000")).toMatchObject({
      kind: "DETERMINISTIC", sourceField: "compensationText", normalizedValue: "USD",
    });
    expect(await currencyRow("CA$72,000")).toMatchObject({ sourceField: "compensationText", normalizedValue: "CAD" });
    expect(await currencyRow("$72,000", "CAD")).toMatchObject({ kind: "DIRECT", sourceField: "compensationCurrency", normalizedValue: "CAD" });
    expect(bareDollarCurrencySourceField).toBe("compensationText:bare-dollar-as-usd");
  });
});

describe("position facts", () => {
  it("work arrangement only when the location states exactly one", () => {
    expect(workArrangementFromLocation("Remote - United States")).toBe("REMOTE");
    expect(workArrangementFromLocation("Boston, MA (Hybrid)")).toBe("HYBRID");
    expect(workArrangementFromLocation("On-site, Austin")).toBe("ONSITE");
    expect(workArrangementFromLocation("In office - NYC")).toBe("ONSITE");
    expect(workArrangementFromLocation("Boston, MA")).toBeNull(); // a place is not "on-site"
    expect(workArrangementFromLocation("Remote or hybrid")).toBeNull();
    expect(workArrangementFromLocation("Not remote - NYC")).toBeNull();
    expect(workArrangementFromLocation(null)).toBeNull();
  });

  it("seniority only from unambiguous level words in the title", () => {
    expect(seniorityFromTitle("Senior Customer Success Manager")).toBe("SENIOR");
    expect(seniorityFromTitle("Sr. CSM")).toBe("SENIOR");
    expect(seniorityFromTitle("Jr Customer Success Associate")).toBe("ENTRY");
    expect(seniorityFromTitle("Principal CSM")).toBe("PRINCIPAL");
    expect(seniorityFromTitle("Director of Customer Success")).toBe("DIRECTOR");
    expect(seniorityFromTitle("VP, Customer Success")).toBe("EXECUTIVE");
    for (const title of ["Customer Success Manager", "Lead CSM", "Staff CSM", "Head of CS", "Associate CSM", "Senior Director, CS"]) {
      expect(seniorityFromTitle(title)).toBeNull();
    }
  });

  it("employment type standardizes stated values and leaves combined ones Unknown", () => {
    expect(standardizeEmploymentType("Full-time")).toBe("FULL_TIME");
    expect(standardizeEmploymentType("FULL_TIME")).toBe("FULL_TIME");
    expect(standardizeEmploymentType("part time")).toBe("PART_TIME");
    expect(standardizeEmploymentType("Contractor")).toBe("CONTRACT");
    expect(standardizeEmploymentType("Intern")).toBe("INTERNSHIP");
    expect(standardizeEmploymentType("Full-time or contract")).toBeNull();
    expect(standardizeEmploymentType(null)).toBeNull();
  });
});

const discoveredAt = new Date("2026-10-14T12:00:00.000Z");
function raw(overrides: Partial<RawOpportunity>): RawOpportunity {
  return rawOpportunitySchema.parse({
    source: "manual-input",
    sourceType: "MANUAL",
    sourceUrl: null,
    applicationUrl: null,
    domain: "customer-success",
    externalId: null,
    requisitionId: null,
    title: null,
    company: null,
    location: null,
    description: "Job text",
    salaryText: null,
    employmentType: null,
    postingDate: null,
    sourceMetadata: null,
    rawPayload: null,
    discoveredAt,
    ...overrides,
  });
}

describe("manual normalizer", () => {
  it("populates explicit facts with provenance and keeps the original text", async () => {
    const { opportunity, provenance } = await createManualOpportunityNormalizer().normalize(raw({
      title: "Senior CSM",
      location: "Remote - US",
      salaryText: " $90,000-$110,000 ",
      employmentType: "Full-time",
    }));
    expect(opportunity).toMatchObject({
      salaryMin: 90000, salaryMax: 110000, currency: "USD", salaryText: "$90,000-$110,000",
      remoteStatus: "REMOTE", seniority: "SENIOR", employmentType: "FULL_TIME", department: null, closingDate: null,
    });
    const fields = Object.fromEntries(provenance.map((row) => [row.fieldName, row]));
    expect(fields.salaryMin).toMatchObject({ kind: "DETERMINISTIC", sourceField: "compensationText", normalizedValue: 90000 });
    expect(fields.employmentType).toMatchObject({ kind: "DETERMINISTIC", sourceText: "Full-time", normalizedValue: "FULL_TIME" });
    expect(fields.remoteStatus).toMatchObject({ sourceField: "location", sourceText: "Remote - US" });
  });

  it("stated details take precedence and are recorded as direct", async () => {
    const { opportunity, provenance } = await createManualOpportunityNormalizer().normalize(raw({
      title: "Senior CSM",
      location: "Remote - US",
      salaryText: "$80,000",
      sourceMetadata: {
        details: {
          workArrangement: "HYBRID", seniority: "MID", department: "  Customer Success ",
          closingDate: "2026-12-01", compensationCurrency: "CAD",
        },
      },
    }));
    expect(opportunity).toMatchObject({
      remoteStatus: "HYBRID", seniority: "MID", department: "Customer Success", currency: "CAD",
      closingDate: new Date("2026-12-01T00:00:00.000Z"),
    });
    const fields = Object.fromEntries(provenance.map((row) => [row.fieldName, row]));
    expect(fields.remoteStatus).toMatchObject({ kind: "DIRECT", sourceField: "workArrangement" });
    expect(fields.seniority).toMatchObject({ kind: "DIRECT", sourceField: "seniority" });
    expect(fields.currency).toMatchObject({ kind: "DIRECT", sourceField: "compensationCurrency" });
    expect(fields.department).toMatchObject({ kind: "DETERMINISTIC", sourceText: "  Customer Success " });
    expect(fields.closingDate).toMatchObject({ normalizedValue: "2026-12-01T00:00:00.000Z", sourceText: "2026-12-01" });
  });

  it("keeps everything Unknown for a record without structured facts (older captures)", async () => {
    const { opportunity, provenance } = await createManualOpportunityNormalizer().normalize(raw({
      title: "Customer Success Manager",
      location: "Boston, MA",
      salaryText: "Competitive",
    }));
    expect(opportunity).toMatchObject({
      salaryMin: null, salaryMax: null, currency: null, remoteStatus: null, seniority: null,
      department: null, employmentType: null, closingDate: null,
    });
    expect(provenance.map((row) => row.fieldName)).not.toEqual(
      expect.arrayContaining(["salaryMin"]),
    );
  });

  it("rejects malformed stated details instead of guessing", async () => {
    await expect(createManualOpportunityNormalizer().normalize(raw({
      sourceMetadata: { details: { workArrangement: "SOMETIMES" } },
    }))).rejects.toThrow("Manual stated details are invalid");
    await expect(createManualOpportunityNormalizer().normalize(raw({
      sourceMetadata: { details: { closingDate: "2026-02-30" } },
    }))).rejects.toThrow("Manual closing date is invalid");
  });
});

describe("manual submission", () => {
  it("accepts the optional details and rejects invalid ones", () => {
    expect(manualOpportunitySubmissionSchema.parse({
      rawText: "x", workArrangement: "REMOTE", seniority: "SENIOR", employmentType: "CONTRACT",
      department: "Customer Success", closingDate: "2026-11-30", compensationCurrency: "EUR",
    })).toMatchObject({ workArrangement: "REMOTE", compensationCurrency: "EUR" });
    for (const bad of [
      { workArrangement: "remote" }, { seniority: "GURU" }, { employmentType: "GIG" },
      { closingDate: "2026-02-30" }, { compensationCurrency: "BTC" }, { department: "x".repeat(121) }, { department: "   " },
    ]) {
      expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "x", ...bad }).success).toBe(false);
    }
  });

  it("preserves the stated details in the raw payload and source metadata", async () => {
    let captured: RawOpportunity | null = null;
    const service = createManualOpportunityService({
      repository: {
        createManualSourceRecord: async () => ({ id: "source-1", discoveredAt }),
        ingestManualOpportunity: async ({ rawOpportunity }) => {
          captured = rawOpportunity;
          return {
            opportunityId: "opportunity-1",
            deduplication: { outcome: "CREATED", decision: "NO_MATCH", canonicalOpportunityId: null, matches: [] },
          };
        },
        checkDuplicates: async () => ({ decision: "NO_MATCH", canonicalOpportunityId: null, matches: [] }),
        findOpportunityDetail: async () => ({ opportunity: { id: "opportunity-1" } }) as never,
      },
      normalizer: createManualOpportunityNormalizer(),
      clock: () => discoveredAt,
    });
    await service.submit({ rawText: "Job", employmentType: "FULL_TIME", department: "CS", compensationCurrency: "USD" });
    expect(captured!.employmentType).toBe("FULL_TIME");
    expect(captured!.sourceMetadata).toMatchObject({ details: { department: "CS", compensationCurrency: "USD", workArrangement: null } });
    expect(captured!.rawPayload).toMatchObject({ employmentType: "FULL_TIME", department: "CS", compensationCurrency: "USD" });
  });
});

describe("stated time-zone requirements (G5)", () => {
  const raw = (details: Record<string, unknown>, description = "Job") => ({
    source: "manual-input", sourceType: "MANUAL" as const, sourceUrl: null, applicationUrl: null, domain: null,
    externalId: null, requisitionId: null, title: null, company: null, location: null, description,
    salaryText: null, employmentType: null, postingDate: null, sourceMetadata: { details }, rawPayload: null, discoveredAt,
  });

  it("records only the stated value, trimmed, with provenance", async () => {
    const stated = await createManualOpportunityNormalizer().normalize(raw({ timeZoneRequirements: "US Eastern hours" }));
    expect(stated.opportunity.timeZoneRequirements).toBe("US Eastern hours");
    expect(stated.provenance).toContainEqual(expect.objectContaining({ fieldName: "timeZoneRequirements", kind: "DIRECT" }));
    const padded = await createManualOpportunityNormalizer().normalize(raw({ timeZoneRequirements: "  CET  " }));
    expect(padded.opportunity.timeZoneRequirements).toBe("CET");
    expect(padded.provenance).toContainEqual(expect.objectContaining({ fieldName: "timeZoneRequirements", kind: "DETERMINISTIC", sourceText: "  CET  " }));
  });

  it("leaves it Unknown when only the job text mentions time zones", async () => {
    const result = await createManualOpportunityNormalizer().normalize(raw({}, "Must work US Eastern (EST) hours."));
    expect(result.opportunity.timeZoneRequirements).toBeNull();
    expect(result.provenance.map((item) => item.fieldName)).not.toContain("timeZoneRequirements");
  });

  it("validates the submitted value", () => {
    expect(manualOpportunitySubmissionSchema.parse({ rawText: "x", timeZoneRequirements: "PST overlap" })).toMatchObject({ timeZoneRequirements: "PST overlap" });
    for (const bad of ["", "   ", "x".repeat(121)]) {
      expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "x", timeZoneRequirements: bad }).success).toBe(false);
    }
  });
});

describe("vocabulary parity", () => {
  it("dashboard filter values match the normalized vocabularies", () => {
    expect([...salaryCurrencyOptions]).toEqual([...compensationCurrencyCodes]);
    expect(Object.values(arrangementOptions).filter((value) => value !== "UNKNOWN")).toEqual([...workArrangementValues]);
    expect(Object.values(seniorityOptions).filter((value) => value !== "UNKNOWN")).toEqual([...seniorityValues]);
  });
});
