import { describe, expect, it } from "vitest";
import {
  createManualOpportunityService,
  manualOpportunitySubmissionSchema,
  parseGeographyList,
  rawOpportunitySchema,
  readGeographyList,
  residencyRequirementFor,
  residencyRequirementValues,
  type RawOpportunity,
} from "@ai-career/core";
import {
  bareDollarCurrencySourceField,
  createManualOpportunityNormalizer,
  parseResidency,
  residencySourceFields,
} from "@ai-career/normalization";
import { activeFilterChips } from "../../apps/web/src/components/dashboard/labels";
import { formatResidency } from "../../apps/web/src/components/opportunity-facts";
import {
  parseOpportunityQuery,
  residencyOptions,
  serializeOpportunityQuery,
  toListFilters,
} from "../../apps/web/src/server/opportunity-query";

const residency = (location: string | null, rawText: string) => {
  const parsed = parseResidency({ location, rawText });
  return [parsed.requirement, parsed.regions];
};

describe("geography vocabulary", () => {
  it("reads written geography lists and refuses anything else", () => {
    expect(parseGeographyList("United States")).toEqual(["US"]);
    expect(parseGeographyList("the U.S. or Canada")).toEqual(["US", "CA"]);
    expect(parseGeographyList("Spain, Portugal and France")).toEqual(["ES", "PT", "FR"]);
    expect(parseGeographyList("EU")).toEqual(["EU"]);
    expect(parseGeographyList("Berlin")).toBeNull();
    expect(parseGeographyList("us")).toBeNull(); // a pronoun, not a country
    expect(parseGeographyList("California")).toEqual(["US-CA"]);
    expect(parseGeographyList("Toronto")).toBeNull();
  });

  it("reads U.S. states/DC/Puerto Rico, Canadian provinces/territories and UK nations", () => {
    expect(parseGeographyList("Texas, Florida or Ohio")).toEqual(["US-TX", "US-FL", "US-OH"]);
    expect(parseGeographyList("TX/FL/GA")).toEqual(["US-TX", "US-FL", "US-GA"]);
    expect(parseGeographyList("Washington, D.C.")).toEqual(["US-DC"]);
    expect(parseGeographyList("District of Columbia")).toEqual(["US-DC"]);
    expect(parseGeographyList("Washington State")).toEqual(["US-WA"]);
    expect(parseGeographyList("West Virginia and Virginia")).toEqual(["US-WV", "US-VA"]);
    expect(parseGeographyList("Indiana")).toEqual(["US-IN"]);
    expect(parseGeographyList("India")).toEqual(["IN"]);
    expect(parseGeographyList("Puerto Rico")).toEqual(["US-PR"]);
    expect(parseGeographyList("Ontario or BC")).toEqual(["CA-ON", "CA-BC"]);
    expect(parseGeographyList("Québec")).toEqual(["CA-QC"]);
    expect(parseGeographyList("Newfoundland and Labrador")).toEqual(["CA-NL"]);
    expect(parseGeographyList("Scotland or Northern Ireland")).toEqual(["GB-SCT", "GB-NIR"]);
  });

  it("never resolves an ambiguous name, and refuses a partly unreadable list", () => {
    for (const text of ["Georgia", "Washington", "CA", "TX or CA", "US/CA", "Texas or Narnia", "tx"]) {
      expect(parseGeographyList(text)).toBeNull();
    }
    expect(readGeographyList("Georgia")).toMatchObject({ codes: [], ambiguous: true });
    expect(readGeographyList("Texas or Narnia")).toMatchObject({ ambiguous: true });
    expect(readGeographyList("Texas, Monday to Friday")).toMatchObject({ codes: ["US-TX"], ambiguous: false });
    expect(readGeographyList("TX and FL")).toMatchObject({ codes: ["US-TX", "US-FL"], abbreviated: true });
  });

  it("classifies: only the United States → US_REQUIRED; residence elsewhere allowed → NON_US", () => {
    expect(residencyRequirementFor(["US"])).toBe("US_REQUIRED");
    expect(residencyRequirementFor(["US-TX", "US-FL"])).toBe("US_REQUIRED");
    expect(residencyRequirementFor(["US", "US-DC", "US-PR"])).toBe("US_REQUIRED");
    expect(residencyRequirementFor(["US-TX", "CA-ON"])).toBe("NON_US");
    expect(residencyRequirementFor(["CA-ON"])).toBe("NON_US");
    expect(residencyRequirementFor(["ES"])).toBe("NON_US");
    expect(residencyRequirementFor(["US", "CA"])).toBe("NON_US");
    expect(residencyRequirementFor(["WORLDWIDE"])).toBe("NON_US");
    expect(residencyRequirementFor([])).toBeNull();
  });
});

describe("explicit residency statements", () => {
  it.each([
    [null, "Remote. Applicants must reside in the United States.", "US_REQUIRED", ["US"]],
    [null, "This role is US only.", "US_REQUIRED", ["US"]],
    [null, "Candidates must be located in the U.S. and available during EST hours.", "US_REQUIRED", ["US"]],
    ["Remote - United States", "", "US_REQUIRED", ["US"]],
    ["US Remote", "", "US_REQUIRED", ["US"]],
    [null, "Must be based in Spain.", "NON_US", ["ES"]],
    [null, "EU residents only.", "NON_US", ["EU"]],
    [null, "Open to candidates in the U.S. or Canada.", "NON_US", ["US", "CA"]],
    [null, "You can work from anywhere in the world.", "NON_US", ["WORLDWIDE"]],
    ["Remote (Spain)", "", "NON_US", ["ES"]],
    ["Remote - Worldwide", "", "NON_US", ["WORLDWIDE"]],
    // Sub-national units.
    [null, "Applicants must reside in Texas.", "US_REQUIRED", ["US-TX"]],
    [null, "Candidates must be based in TX, FL, or GA.", "US_REQUIRED", ["US-TX", "US-FL", "US-GA"]],
    [null, "Open to candidates residing in the following states: Arizona, Colorado, and Washington State.", "US_REQUIRED", ["US-AZ", "US-CO", "US-WA"]],
    [null, "Must reside in Washington, D.C. or Maryland.", "US_REQUIRED", ["US-DC", "US-MD"]],
    [null, "Texas residents only.", "US_REQUIRED", ["US-TX"]],
    [null, "Must reside in Puerto Rico.", "US_REQUIRED", ["US-PR"]],
    [null, "Open to residents of Ontario or British Columbia.", "NON_US", ["CA-ON", "CA-BC"]],
    [null, "Applicants must be located in the US or Ontario.", "NON_US", ["US", "CA-ON"]],
    [null, "Must be based in Scotland.", "NON_US", ["GB-SCT"]],
    ["Remote - Texas", "", "US_REQUIRED", ["US-TX"]],
    ["Remote (ON)", "", "NON_US", ["CA-ON"]],
  ])("location %j, text %j → %s %j", (location, rawText, requirement, regions) => {
    expect(residency(location, rawText)).toEqual([requirement, regions]);
  });

  it.each([
    ["Remote", "Fully remote team with an async culture."], // generic Remote
    ["Boston, MA (Remote)", ""], // a city is an office location, not a residency rule
    ["Berlin, Germany", "Our office is in Berlin."],
    [null, "US preferred."],
    [null, "Ideally based in Spain."],
    [null, "Must be authorized to work in the United States."], // work authorization
    [null, "US citizens only."], // nationality
    [null, "We support US time zones."],
    [null, "Must reside in New York City."], // a city, not the state
    [null, "Our worldwide customers rely on us."],
    [null, "Salary $72,000-$88,000 USD."], // currency never implies residency
    [null, "Headquartered in New York, United States."],
    // Ordinary location fields are office locations, not residency rules.
    ["Chicago, IL", "Join our Chicago office."],
    ["Toronto, ON", "Hybrid role."],
    ["Austin, Texas", ""],
    ["Remote - Chicago, IL", ""],
    [null, "Our team is spread across California and Ontario."],
    [null, "Remote work is OK only on Fridays."], // "OK only" is English, not Oklahoma
  ])("stays Unknown: %j / %j", (location, rawText) => {
    expect(residency(location, rawText)).toEqual([null, []]);
  });

  it("ambiguous geography in an explicit statement stays Unknown", () => {
    for (const rawText of ["Must reside in Georgia.", "Must reside in Washington.", "Must reside in CA.", "Must reside in TX or CA.", "Must reside in Texas or Narnia."]) {
      expect(parseResidency({ location: null, rawText })).toMatchObject({ requirement: null, regions: [], unknownReason: "QUALIFIED_STATEMENT" });
    }
    expect(parseResidency({ location: "Remote (US/CA)", rawText: "" })).toMatchObject({ requirement: null });
  });

  it("negated, qualified or conflicting statements stay Unknown", () => {
    expect(parseResidency({ location: null, rawText: "You do not need to reside in the US." })).toMatchObject({
      requirement: null, unknownReason: "QUALIFIED_STATEMENT",
    });
    expect(parseResidency({ location: null, rawText: "Must reside in the US. Must be based in Spain." })).toMatchObject({
      requirement: null, unknownReason: "CONFLICTING_STATEMENTS",
    });
    expect(parseResidency({ location: "Remote - Canada", rawText: "Applicants must reside in the United States." })).toMatchObject({
      requirement: null, unknownReason: "CONFLICTING_STATEMENTS",
    });
    // Consistent statements combine.
    expect(parseResidency({ location: "Remote - United States", rawText: "US only." })).toMatchObject({
      requirement: "US_REQUIRED", regions: ["US"],
    });
  });
});

const discoveredAt = new Date("2026-10-14T12:00:00.000Z");
function raw(overrides: Partial<RawOpportunity>): RawOpportunity {
  return rawOpportunitySchema.parse({
    source: "manual-input", sourceType: "MANUAL", sourceUrl: null, applicationUrl: null, domain: "customer-success",
    externalId: null, requisitionId: null, title: null, company: null, location: null, description: "Job text",
    salaryText: null, employmentType: null, postingDate: null, sourceMetadata: null, rawPayload: null, discoveredAt,
    ...overrides,
  });
}
const normalize = (overrides: Partial<RawOpportunity>) => createManualOpportunityNormalizer().normalize(raw(overrides));

describe("normalizer: residency is independent of salary currency", () => {
  it("an internationally located role quoted in USD stays non-U.S.", async () => {
    const { opportunity, provenance } = await normalize({ location: "Remote (Spain)", salaryText: "USD 70,000" });
    expect(opportunity).toMatchObject({
      currency: "USD", salaryMin: 70000, residencyRequirement: "NON_US", residencyRegions: ["ES"], location: "Remote (Spain)",
    });
    expect(provenance.find((row) => row.fieldName === "currency")).toMatchObject({ sourceField: "compensationText" });
    // A bare "$" is US dollars wherever the job is (October 27, 2026), and the
    // currency never changes the residency.
    const bare = await normalize({ location: "Remote (Spain)", salaryText: "$70,000" });
    expect(bare.opportunity).toMatchObject({ currency: "USD", salaryMin: 70000, residencyRequirement: "NON_US", residencyRegions: ["ES"] });
    expect(bare.provenance.find((row) => row.sourceField === bareDollarCurrencySourceField)).toMatchObject({ normalizedValue: "USD" });
    expect(provenance.filter((row) => row.fieldName.startsWith("residency"))).toEqual([
      expect.objectContaining({
        fieldName: "residencyRequirement", kind: "DETERMINISTIC", sourceField: residencySourceFields.location,
        normalizedValue: "NON_US", sourceText: "Remote (Spain)",
      }),
      expect.objectContaining({ fieldName: "residencyRegions", normalizedValue: ["ES"], sourceText: "Remote (Spain)" }),
    ]);
  });

  it("a U.S.-residency-required role quoted in a non-USD currency stays U.S.-required", async () => {
    const description = "Customer Success Manager.\nApplicants must reside in the United States.\nPay €60,000.";
    const { opportunity, provenance } = await normalize({ description, salaryText: "€60,000" });
    expect(opportunity).toMatchObject({ currency: "EUR", residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], jobDescription: description });
    expect(provenance.find((row) => row.fieldName === "residencyRequirement")).toMatchObject({
      kind: "DETERMINISTIC", sourceField: residencySourceFields.rawText, sourceText: "Applicants must reside in the United States.",
    });
  });

  it("a USD salary with no residency statement leaves residency Unknown", async () => {
    const { opportunity, provenance } = await normalize({ location: "Remote", salaryText: "USD 80,000", description: "Remote role." });
    expect(opportunity).toMatchObject({ currency: "USD", residencyRequirement: null, residencyRegions: [] });
    expect(provenance.some((row) => row.fieldName.startsWith("residency"))).toBe(false);
  });

  it("stated residency wins and keeps direct provenance", async () => {
    const { opportunity, provenance } = await normalize({
      description: "Applicants must reside in the United States.",
      sourceMetadata: { details: { residencyRequirement: "NON_US", residencyRegions: "Spain, Portugal" } },
    });
    expect(opportunity).toMatchObject({ residencyRequirement: "NON_US", residencyRegions: ["ES", "PT"] });
    const rows = Object.fromEntries(provenance.filter((row) => row.fieldName.startsWith("residency")).map((row) => [row.fieldName, row]));
    expect(rows.residencyRequirement).toMatchObject({ kind: "DIRECT", sourceField: "residencyRequirement", normalizedValue: "NON_US" });
    expect(rows.residencyRegions).toMatchObject({ kind: "DETERMINISTIC", sourceField: "residencyRegions", sourceText: "Spain, Portugal" });
  });

  it("a stated requirement or list alone derives the other, marked as derived", async () => {
    const usOnly = await normalize({ sourceMetadata: { details: { residencyRequirement: "US_REQUIRED" } } });
    expect(usOnly.opportunity).toMatchObject({ residencyRequirement: "US_REQUIRED", residencyRegions: ["US"] });
    expect(usOnly.provenance.find((row) => row.fieldName === "residencyRegions")).toMatchObject({
      kind: "DETERMINISTIC", sourceField: "residencyRequirement",
    });
    const listOnly = await normalize({ sourceMetadata: { details: { residencyRegions: "Canada" } } });
    expect(listOnly.opportunity).toMatchObject({ residencyRequirement: "NON_US", residencyRegions: ["CA"] });
    expect(listOnly.provenance.find((row) => row.fieldName === "residencyRequirement")).toMatchObject({
      kind: "DETERMINISTIC", sourceField: "residencyRegions", sourceText: "Canada",
    });
    const statesOnly = await normalize({ sourceMetadata: { details: { residencyRegions: "Texas or Florida" } } });
    expect(statesOnly.opportunity).toMatchObject({ residencyRequirement: "US_REQUIRED", residencyRegions: ["US-TX", "US-FL"] });
    const nonUsOnly = await normalize({ sourceMetadata: { details: { residencyRequirement: "NON_US" } } });
    expect(nonUsOnly.opportunity).toMatchObject({ residencyRequirement: "NON_US", residencyRegions: [] });
  });

  it("older raw records without the new details keep residency Unknown unless the text is explicit", async () => {
    expect((await normalize({ sourceMetadata: { reportedSource: "LinkedIn" } })).opportunity).toMatchObject({
      residencyRequirement: null, residencyRegions: [],
    });
    await expect(normalize({ sourceMetadata: { details: { residencyRegions: "Atlantis" } } })).rejects.toThrow("Manual stated details are invalid");
  });
});

describe("manual submission", () => {
  it("accepts stated residency, rejects unknown places and contradictions", () => {
    expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "x", residencyRequirement: "US_REQUIRED", residencyRegions: "United States" }).success).toBe(true);
    expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "x", residencyRegions: "Spain or Portugal" }).success).toBe(true);
    expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "x", residencyRequirement: "US_REQUIRED", residencyRegions: "Texas, Florida" }).success).toBe(true);
    expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "x", residencyRequirement: "NON_US", residencyRegions: "Ontario" }).success).toBe(true);
    for (const bad of [
      { residencyRequirement: "US" },
      { residencyRegions: "Atlantis" },
      { residencyRegions: "Berlin" },
      { residencyRequirement: "US_REQUIRED", residencyRegions: "Spain" },
      { residencyRequirement: "NON_US", residencyRegions: "United States" },
      { residencyRequirement: "NON_US", residencyRegions: "Texas" },
      { residencyRequirement: "US_REQUIRED", residencyRegions: "Ontario" },
      { residencyRegions: "Georgia" },
      { residencyRegions: "CA" },
    ]) {
      expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "x", ...bad }).success).toBe(false);
    }
  });

  it("preserves the stated residency in the raw payload and source metadata", async () => {
    let captured: RawOpportunity | null = null;
    await createManualOpportunityService({
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
    }).submit({ rawText: "Job", residencyRequirement: "NON_US", residencyRegions: "EU" });
    expect(captured!.sourceMetadata).toMatchObject({ details: { residencyRequirement: "NON_US", residencyRegions: "EU" } });
    expect(captured!.rawPayload).toMatchObject({ residencyRequirement: "NON_US", residencyRegions: "EU" });
  });
});

describe("dashboard query and display", () => {
  it("parses, serializes and maps the residency filter; malformed values are dropped", () => {
    const query = parseOpportunityQuery(new URLSearchParams("residency=unknown,us-required&residency=martian"));
    expect(query.residency).toEqual(["us-required", "unknown"]);
    expect(toListFilters(query).residencyRequirements).toEqual(["US_REQUIRED", "UNKNOWN"]);
    expect(serializeOpportunityQuery(query)).toBe("residency=us-required&residency=unknown");
    expect(parseOpportunityQuery(new URLSearchParams("rec=apply")).residency).toEqual([]);
    expect(activeFilterChips(parseOpportunityQuery(new URLSearchParams("residency=non-us"))).map((chip) => chip.label)).toEqual([
      "Residency: Non-U.S. residence allowed",
    ]);
  });

  it("labels residency without assuming anything", () => {
    expect(formatResidency("US_REQUIRED", ["US"])).toBe("U.S. residence required");
    expect(formatResidency("US_REQUIRED", ["US-TX", "US-FL"])).toBe("U.S. residence required (Texas, Florida)");
    expect(formatResidency("NON_US", ["CA-ON"])).toBe("Non-U.S. residence allowed (Ontario)");
    expect(formatResidency("NON_US", ["ES", "PT"])).toBe("Non-U.S. residence allowed (Spain, Portugal)");
    expect(formatResidency("NON_US", ["WORLDWIDE"])).toBe("Non-U.S. residence allowed (Worldwide)");
    expect(formatResidency("NON_US", [])).toBe("Non-U.S. residence allowed");
    expect(formatResidency(null, [])).toBe("Unknown");
  });

  it("filter values match the stored vocabulary", () => {
    expect(Object.values(residencyOptions).filter((value) => value !== "UNKNOWN")).toEqual([...residencyRequirementValues]);
  });
});
