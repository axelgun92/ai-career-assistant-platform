// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  changedBeforeHydration,
  OpportunityFilters,
} from "../../apps/web/src/components/dashboard/opportunity-filters";
import { parseOpportunityQuery } from "../../apps/web/src/server/opportunity-query";

// The filter form auto-submits on change once hydrated. A change made before
// hydration must still be submitted when the form mounts.
const options = { sources: [], domains: [], companies: [], departments: [], currencies: [] };

function serverForm(search: string): HTMLFormElement {
  document.body.innerHTML = renderToStaticMarkup(
    <OpportunityFilters query={parseOpportunityQuery(new URLSearchParams(search))} options={options} />,
  );
  return document.querySelector("form")!;
}

describe("filter changes made before hydration", () => {
  it("are detected for checkboxes, selects and dates, but not for untouched forms or text", () => {
    expect(changedBeforeHydration(serverForm("rec=apply&sort=title"))).toBe(false);

    const checkbox = serverForm("rec=apply");
    checkbox.querySelector<HTMLInputElement>('input[name="eval"][value="completed"]')!.checked = true;
    expect(changedBeforeHydration(checkbox)).toBe(true);

    const unchecked = serverForm("rec=apply");
    unchecked.querySelector<HTMLInputElement>('input[name="rec"][value="apply"]')!.checked = false;
    expect(changedBeforeHydration(unchecked)).toBe(true);

    const select = serverForm("");
    select.querySelector<HTMLSelectElement>('select[name="sort"]')!.value = "salary-high";
    expect(changedBeforeHydration(select)).toBe(true);

    const date = serverForm("");
    date.querySelector<HTMLInputElement>('input[name="from"]')!.value = "2026-10-01";
    expect(changedBeforeHydration(date)).toBe(true);

    const text = serverForm("");
    text.querySelector<HTMLInputElement>('input[name="salaryMin"]')!.value = "80000";
    expect(changedBeforeHydration(text)).toBe(false); // text submits on Enter
  });
});

describe("a freshly rendered form never submits itself", () => {
  it.each(["", "sort=salary-low", "view=all&currency=EUR&salaryMin=1000", "arrangement=unknown&department=Support"])(
    "untouched: %s",
    (search) => {
      expect(changedBeforeHydration(serverForm(search))).toBe(false);
    },
  );
});
