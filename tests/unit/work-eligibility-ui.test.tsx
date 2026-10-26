// @vitest-environment jsdom
// Work eligibility in the UI (October 25, 2026): the normalized work-
// authorization fact as stated, and the user-relevance note and dashboard
// badge, which appear only when something needs a look.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { geographyName, workAuthorizationRelevance } from "@ai-career/core";

vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { WorkEligibilityNote } = await import("../../apps/web/src/components/eligibility/work-eligibility-note");
const { OpportunityList } = await import("../../apps/web/src/components/dashboard/opportunity-list");
const { formatCompensationRange, formatWorkAuthorization } = await import("../../apps/web/src/components/opportunity-facts");

const alex = { authorizedRegions: ["US"], citizenshipRegions: ["US"] };
const facts = (overrides: Record<string, unknown> = {}) => ({
  workAuthorizationRequirement: null, workAuthorizationRegions: [] as string[], visaSponsorship: null, relocationSupport: null,
  employerOfRecordRegions: [] as string[], residencyRegions: [] as string[], location: null as string | null, ...overrides,
}) as Parameters<typeof workAuthorizationRelevance>[0];

describe("the normalized facts as shown", () => {
  it("states the work-authorization fact and the compensation basis", () => {
    expect(formatWorkAuthorization(facts({ workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"] }), geographyName))
      .toBe("United States authorization required · Sponsorship: Unknown");
    expect(formatWorkAuthorization(facts({ visaSponsorship: "NOT_AVAILABLE" }), geographyName)).toBe("Requirement not stated · Sponsorship: not available");
    expect(formatWorkAuthorization(facts(), geographyName)).toBeNull();
    expect(formatCompensationRange(105000, 155000, "USD", "OTE")).toBe("105,000–155,000 USD (OTE)");
    expect(formatCompensationRange(80000, 100000, "USD", "BASE")).toBe("80,000–100,000 USD (base salary)");
    expect(formatCompensationRange(58000, 68000, "EUR", null)).toBe("58,000–68,000 EUR");
  });
});

describe("the user-relevance note", () => {
  const note = (input: Parameters<typeof workAuthorizationRelevance>[0]) => renderToStaticMarkup(<WorkEligibilityNote relevance={workAuthorizationRelevance(input, alex)} />);
  it("says nothing for a requirement the user already meets", () => {
    expect(note(facts({ workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"] }))).toBe("");
  });
  it("asks for a check on a non-U.S. requirement, and on an unknown one outside the user's countries", () => {
    expect(note(facts({ workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["GB"] }))).toContain("Check work eligibility.</strong> This job states: United Kingdom work authorization required.");
    expect(note(facts({ location: "London, United Kingdom" }))).toContain("Work eligibility unknown.</strong> This job is in United Kingdom");
    expect(note(facts({ location: "Berlin, Germany", visaSponsorship: "AVAILABLE" }))).toContain("states: Visa sponsorship available");
  });
});

describe("the dashboard badge", () => {
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, domain: "customer-success", status: "NORMALIZED", source: "test-board", sourceType: "ATS", title: id, companyName: "Acme",
    location: null, salaryText: null, postingDate: null, createdAt: new Date("2026-10-18T00:00:00Z"), deferred: false, latestEvaluation: null,
    ...overrides,
  });
  it("appears only when the relevance layer finds something to check", () => {
    const html = renderToStaticMarkup(
      <OpportunityList
        eligibility={alex}
        opportunities={[
          row("us", { workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"] }),
          row("uk", { workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["GB"] }),
          row("london", { location: "London, United Kingdom" }),
          row("austin", { location: "Austin, TX" }),
        ] as never}
      />,
    );
    expect(html.match(/Check work eligibility/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<OpportunityList opportunities={[row("uk", { workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["GB"] })] as never} />)).not.toContain("Check work eligibility");
  });
});
