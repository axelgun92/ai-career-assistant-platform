import { describe, expect, it } from "vitest";
import { cleanTitlePolicyPatterns, createTitlePolicy, titlePolicyMatcher, titlePolicyWords } from "@ai-career/core";
import {
  customerSuccessAcceptedTitlePatterns,
  customerSuccessDefaultTitlePolicy,
  customerSuccessExcludedTitlePatterns,
} from "@ai-career/customer-success";
import { createTitlePolicyApiHandlers, createTitlePolicyLoader, opportunitiesOutsideTargetTitles, type TitlePolicyStore } from "../../apps/web/src/server/title-policy-service";

// Universal target job titles (November 22, 2026): one deterministic policy
// for every automatic source, decided from the title alone.

const policy = createTitlePolicy(customerSuccessDefaultTitlePolicy);
const verdict = (title: string | null) => policy(title).verdict;

describe("the default target job titles", () => {
  it.each([
    "Customer Success Manager",
    "Sr. Customer-Success Manager, EMEA",
    "Director, Customer Success",
    "Customer Success Engineer",
    "Technical Customer Success Manager (Remote, US)",
    "Head of Client Success",
    "Member Success Specialist",
    "User Success Lead",
    "Partner Success Manager",
    "CSM - Mid Market",
    "Customer Experience Manager",
    "Client Experience Associate",
    "Onboarding Specialist",
    "Senior Onboarding Specialists",
    "Customer Onboarding Manager",
    "Client Onboarding Coordinator",
    "Customer Education Specialist",
    "Customer Education Program Manager",
    "Client Training Specialist",
    "Customer Learning Experience Designer",
    "Customer Enablement Lead",
    "Implementation Specialist",
    "Implementation Consultant II",
    "Customer Implementation Manager",
    "Product Adoption Specialist",
    "Digital Adoption Manager",
    "Customer Engagement Manager",
    "Learner Success Coach",
    "Student Success Advisor",
    "Community Success Manager",
    "Customer Success & Onboarding Manager",
    "VP, Customer Outcomes",
  ])("accepts %s", (title) => {
    expect(verdict(title)).toBe("ACCEPTED");
  });

  it.each([
    "Payroll Support Representative",
    "Program Manager, M&A Recruiting",
    "Customer Support Representative",
    "Account Executive",
    "Software Engineer",
    "Successful Customer Outreach Lead",
    // Education, learning, training and enablement need a Customer or
    // Client qualifier.
    "Education Specialist",
    "Learning Specialist",
    "Learning Experience Designer",
    "Training Specialist",
    "Learning and Development Partner",
    "Enablement Specialist",
    // No broad single words.
    "Implementation Engineer",
    "Adoption Counselor",
  ])("skips %s (outside)", (title) => {
    expect(verdict(title)).toBe("OUTSIDE");
  });

  it.each([
    ["Employee Onboarding Specialist", "Employee Onboarding"],
    ["Customer Experience Designer", "Customer Experience Designer"],
    ["Senior Customer Experience Researcher", "Customer Experience Researcher"],
    ["New Hire Onboarding Coordinator", "New Hire Onboarding"],
  ])("skips %s (excluded by %s)", (title, pattern) => {
    expect(policy(title)).toEqual({ verdict: "EXCLUDED", pattern });
  });

  it("never accepts a missing or empty title", () => {
    for (const title of [null, undefined, "", "   ", "—"]) expect(verdict(title as string | null)).toBe("MISSING_TITLE");
  });

  it("does not filter seniority", () => {
    for (const title of ["Junior Customer Success Associate", "Principal Customer Success Manager", "VP Customer Success", "Customer Success Intern"]) {
      expect(verdict(title)).toBe("ACCEPTED");
    }
  });

  it("keeps the two high-priority targets and contains no broad single words", () => {
    expect(customerSuccessAcceptedTitlePatterns).toContain("Onboarding Specialist");
    expect(customerSuccessAcceptedTitlePatterns).toContain("Customer Education Specialist");
    for (const word of ["Implementation", "Onboarding", "Adoption", "Education", "Enablement", "Learning", "Training"]) {
      expect(customerSuccessAcceptedTitlePatterns).not.toContain(word);
    }
    expect(customerSuccessExcludedTitlePatterns.every((pattern) => titlePolicyWords(pattern).length >= 2)).toBe(true);
  });
});

describe("the matching rules", () => {
  it("matches whole words in order, ignoring case, accents, punctuation, '&' and plurals", () => {
    expect(titlePolicyWords("Spécialistes d’Onboarding & Co.")).toEqual(["specialiste", "d", "onboarding", "and", "co"]);
    const custom = createTitlePolicy({ accepted: ["Customer Success"], excluded: [] });
    expect(custom("customer-success manager").verdict).toBe("ACCEPTED");
    expect(custom("Success, Customer").verdict).toBe("OUTSIDE");
    expect(custom("CustomerSuccess Manager").verdict).toBe("OUTSIDE");
    expect(createTitlePolicy({ accepted: ["Implementation Specialist"], excluded: [] })("Implementation Specialists").verdict).toBe("ACCEPTED");
    expect(createTitlePolicy({ accepted: ["Customer Story"], excluded: [] })("Customer Stories Lead").verdict).toBe("ACCEPTED");
  });

  it("lets the most specific pattern decide: an exclusion never rejects a title for one shared word", () => {
    const custom = createTitlePolicy({ accepted: ["Customer Success", "Customer Experience"], excluded: ["Engineer", "Customer Experience Designer"] });
    expect(custom("Customer Success Engineer").verdict).toBe("ACCEPTED");
    expect(custom("Customer Experience Designer")).toEqual({ verdict: "EXCLUDED", pattern: "Customer Experience Designer" });
    // An exclusion with no accepted match is simply outside.
    expect(custom("Software Engineer").verdict).toBe("OUTSIDE");
    // A tie goes to the exclusion (fewer false positives).
    expect(createTitlePolicy({ accepted: ["Onboarding Specialist"], excluded: ["Employee Onboarding"] })("Employee Onboarding Specialist").verdict).toBe(
      "EXCLUDED",
    );
  });

  it("applies added and removed patterns", () => {
    const base = { accepted: [...customerSuccessDefaultTitlePolicy.accepted], excluded: [...customerSuccessDefaultTitlePolicy.excluded] };
    expect(createTitlePolicy(base)("Technical Account Manager").verdict).toBe("OUTSIDE");
    expect(createTitlePolicy({ ...base, accepted: [...base.accepted, "Technical Account Manager"] })("Technical Account Manager").verdict).toBe("ACCEPTED");
    expect(createTitlePolicy({ ...base, accepted: base.accepted.filter((item) => item !== "CSM") })("CSM - Mid Market").verdict).toBe("OUTSIDE");
    expect(createTitlePolicy({ ...base, excluded: [] })("Employee Onboarding Specialist").verdict).toBe("ACCEPTED");
    expect(titlePolicyMatcher(policy)("Customer Success Manager")).toBe(true);
  });

  it("cleans edited lists: trimmed, collapsed, empties and normalized duplicates dropped, order kept", () => {
    expect(cleanTitlePolicyPatterns(["  Customer  Success ", "customer-success", "", "Onboarding Specialists", "Onboarding Specialist"])).toEqual([
      "Customer Success",
      "Onboarding Specialists",
    ]);
  });
});

function memoryStore(initial: { accepted: string[]; excluded: string[] } | null = null) {
  let saved = initial ? { ...initial, updatedAt: new Date("2026-11-22T10:00:00Z") } : null;
  const store: TitlePolicyStore & { opportunityTitles(): Promise<Array<{ id: string; title: string | null }>> } = {
    get: async () => saved,
    save: async (_domain, patterns) => (saved = { accepted: [...patterns.accepted], excluded: [...patterns.excluded], updatedAt: new Date("2026-11-22T11:00:00Z") }),
    clear: async () => {
      saved = null;
    },
    opportunityTitles: async () => [
      { id: "a", title: "Customer Success Manager" },
      { id: "b", title: "Payroll Support Representative" },
      { id: "c", title: null },
    ],
  };
  return store;
}

describe("the Target Job Titles setting", () => {
  it("serves the defaults until something is saved, and the loader reads the saved setting on every call", async () => {
    const store = memoryStore();
    const handlers = createTitlePolicyApiHandlers(store);
    const initial = (await (await handlers.get()).json()) as { isDefault: boolean; accepted: string[] };
    expect(initial.isDefault).toBe(true);
    expect(initial.accepted).toEqual([...customerSuccessAcceptedTitlePatterns]);
    const load = createTitlePolicyLoader(store);
    expect((await load())("Technical Account Manager").verdict).toBe("OUTSIDE");
    const saved = await handlers.put(
      new Request("http://test/api/title-policy", {
        method: "PUT",
        body: JSON.stringify({ accepted: [" Technical Account Manager ", "Customer Success"], excluded: [] }),
      }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ isDefault: false, accepted: ["Technical Account Manager", "Customer Success"], excluded: [] });
    expect((await load())("Technical Account Manager").verdict).toBe("ACCEPTED");
    expect((await load())("Onboarding Specialist").verdict).toBe("OUTSIDE");
    expect(await (await handlers.reset()).json()).toMatchObject({ isDefault: true });
    expect((await load())("Onboarding Specialist").verdict).toBe("ACCEPTED");
  });

  it("refuses an empty accepted list and malformed input, saving nothing", async () => {
    const store = memoryStore();
    const handlers = createTitlePolicyApiHandlers(store);
    const empty = await handlers.put(new Request("http://test", { method: "PUT", body: JSON.stringify({ accepted: ["  "], excluded: [] }) }));
    expect(empty.status).toBe(400);
    const tooLong = await handlers.put(new Request("http://test", { method: "PUT", body: JSON.stringify({ accepted: ["x".repeat(81)], excluded: [] }) }));
    expect(tooLong.status).toBe(400);
    const extra = await handlers.put(new Request("http://test", { method: "PUT", body: JSON.stringify({ accepted: ["CSM"], excluded: [], other: 1 }) }));
    expect(extra.status).toBe(400);
    expect(await store.get("customer-success")).toBeNull();
  });

  it("finds earlier captures whose titles are outside the current target job titles, changing nothing", async () => {
    expect(await opportunitiesOutsideTargetTitles(memoryStore())).toEqual(["b", "c"]);
  });
});
