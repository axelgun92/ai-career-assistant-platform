// @vitest-environment jsdom
// Possible Duplicates (November 25, 2026 correction): every listing in a
// group has its own Keep and Dismiss. Each changes that listing only, never
// records "same job" or "not the same job", and every listing stays in the
// group, dismissed ones included.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { DuplicateGroupCard } = await import("../../apps/web/src/components/duplicates/duplicate-group-card");
type Member = Parameters<typeof DuplicateGroupCard>[0]["members"][number];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cities = ["Denver", "Austin", "Boston", "Chicago", "Seattle"];
function member(n: number, overrides: Partial<Member> = {}): Member {
  return {
    id: id(n), title: "Customer Success Manager", companyName: "Acme", location: cities[n - 1] ?? "Remote", salary: null, arrangement: "Hybrid",
    sourceWebsite: "linkedin", listingUrl: null, applicationUrl: null, listingId: null, requisitionId: null,
    status: "NORMALIZED", statusLabel: "New", triageLabel: "Evaluate", hasApplication: false, firstSeen: "2026-11-20",
    description: { similarity: 0.9, onlyHere: [], onlyHereCount: 0 },
    ...overrides,
  };
}
const pairs = [
  { opportunityId: id(2), relatedOpportunityId: id(1), decision: "PROBABLE_MATCH" as const, confidence: 0.8, matchedOn: ["company", "title"], conflicts: [], state: "UNRESOLVED" as const },
  { opportunityId: id(3), relatedOpportunityId: id(2), decision: "PROBABLE_MATCH" as const, confidence: 0.8, matchedOn: ["company", "title"], conflicts: [], state: "UNRESOLVED" as const },
];

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: "MOVED" }), { status: 200 }));

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock.mockClear();
  router.refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (members: Member[]) => act(() => root.render(<DuplicateGroupCard label="Acme / Customer Success Manager" members={members} pairs={pairs} differing={["location"]} />));
const button = (name: string) => {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!found) throw new Error(`No button ${name}`);
  return found;
};
const click = async (name: string) => {
  await act(async () => button(name).click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const requests = () => fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse((init as RequestInit).body as string) }));

describe("each listing in a group is controlled on its own", () => {
  it("offers no action that keeps one listing and dismisses the others", () => {
    render([member(1), member(2), member(3)]);
    expect(container.textContent).not.toContain("Keep this one");
    expect(container.textContent).not.toContain("dismiss the others");
  });

  it("dismisses only the listing chosen and records no duplicate decision", async () => {
    render([member(1), member(2), member(3), member(4), member(5)]);
    await click("Dismiss Listing 2");
    await click("Dismiss Listing 4");
    expect(requests()).toEqual([
      { url: `/api/opportunities/${id(2)}/move`, body: { destination: "DISMISSED" } },
      { url: `/api/opportunities/${id(4)}/move`, body: { destination: "DISMISSED" } },
    ]);
    expect(requests().some((request) => String(request.url).endsWith("/duplicates"))).toBe(false);
  });

  it("keeps a dismissed or archived listing only, and leaves listings already in Active alone", async () => {
    render([
      member(1),
      member(2, { status: "REJECTED_BY_USER", statusLabel: "Dismissed" }),
      member(3, { status: "SAVED", statusLabel: "Saved" }),
      member(4, { status: "ARCHIVED", statusLabel: "Archived" }),
      member(5, { status: "REJECTED_BY_USER", statusLabel: "Dismissed" }),
    ]);
    // Active listings show no Keep; every listing still shows in the group.
    expect(container.querySelector('button[aria-label="Keep Listing 1"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Keep Listing 3"]')).toBeNull();
    expect(container.querySelectorAll("thead th[scope=col]")).toHaveLength(6);
    await click("Keep Listing 2");
    await click("Keep Listing 4");
    expect(requests()).toEqual([
      { url: `/api/opportunities/${id(2)}/move`, body: { destination: "RESTORE" } },
      { url: `/api/opportunities/${id(4)}/move`, body: { destination: "ACTIVE" } },
    ]);
    // Listing 5 stays dismissed: nothing was sent for it.
    expect(requests().map((request) => request.url)).not.toContain(`/api/opportunities/${id(5)}/move`);
  });

  it("protects a listing with application history", () => {
    render([member(1), member(2, { status: "APPLIED", statusLabel: "Applied", hasApplication: true }), member(3, { hasApplication: true })]);
    for (const listing of [2, 3]) {
      expect(container.querySelector(`button[aria-label="Dismiss Listing ${listing}"]`)).toBeNull();
      expect(container.querySelector(`button[aria-label="Keep Listing ${listing}"]`)).toBeNull();
    }
    expect(container.textContent).toContain("Has application history; managed in Applications");
  });

  it("deletes permanently only a dismissed listing, after a confirmation naming it", async () => {
    render([member(1), member(2, { status: "REJECTED_BY_USER", statusLabel: "Dismissed" })]);
    expect(container.querySelector('button[aria-label="Delete Listing 1 permanently"]')).toBeNull();
    await click("Delete Listing 2 permanently");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Listing 2 (Customer Success Manager · Acme)");
  });

  it("keeps Same job and Not the same job as separate, per-pair decisions", async () => {
    render([member(1), member(2), member(3)]);
    const sameJob = [...container.querySelectorAll<HTMLButtonElement>(".duplicate-pairs button")].find((candidate) => candidate.textContent === "Same job")!;
    await act(async () => sameJob.click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(requests()).toEqual([{ url: `/api/opportunities/${id(2)}/duplicates`, body: { otherOpportunityId: id(1), resolution: "SAME_JOB" } }]);
  });
});
