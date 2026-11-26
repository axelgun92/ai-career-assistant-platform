// The Profile page's Target Job Titles section (November 22, 2026).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createTitlePolicy } from "@ai-career/core";
import { customerSuccessDefaultTitlePolicy } from "@ai-career/customer-success";

vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { TargetJobTitlesForm, titleVerdictText } = await import("../../apps/web/src/components/profile/target-job-titles-form");

const defaults = { accepted: [...customerSuccessDefaultTitlePolicy.accepted], excluded: [...customerSuccessDefaultTitlePolicy.excluded] };

describe("Target job titles (automatic capture)", () => {
  it("lists accepted and excluded patterns with remove buttons, add fields, Test a title, Save and Reset", () => {
    const markup = renderToStaticMarkup(<TargetJobTitlesForm initial={{ ...defaults, isDefault: true, defaults }} />);
    expect(markup).toContain("Target job titles (automatic capture)");
    expect(markup).toContain("Accepted title patterns");
    expect(markup).toContain("Excluded title patterns");
    expect(markup).toContain("Onboarding Specialist");
    expect(markup).toContain("Customer Education Specialist");
    expect(markup).toContain("Remove “Employee Onboarding”");
    expect(markup).toContain("Test a title");
    expect(markup).toContain("Save target job titles");
    expect(markup).toContain("Reset to defaults");
    expect(markup).toContain("You are using the default target job titles.");
    expect(markup).toContain("Jobs you capture or add yourself are always kept");
  });

  it("explains each verdict of the Test a title preview", () => {
    const policy = createTitlePolicy(defaults);
    expect(titleVerdictText(policy("Customer Education Specialist"))).toBe("Accepted: matches “Customer Education Specialist”.");
    expect(titleVerdictText(policy("Payroll Support Representative"))).toBe("Skipped: no accepted pattern appears in this title.");
    expect(titleVerdictText(policy("Employee Onboarding Specialist"))).toContain("excluded pattern “Employee Onboarding”");
    expect(titleVerdictText(policy(""))).toBe("Enter a title to test.");
  });
});
