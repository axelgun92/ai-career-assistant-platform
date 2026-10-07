import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpportunityListItem } from "@ai-career/database";
import { OpportunityList } from "../../apps/web/src/components/dashboard/opportunity-list";
import {
  formatDate,
  formatLabel,
  formatText,
} from "../../apps/web/src/components/dashboard/format";
import { createOpportunityListHandler } from "../../apps/web/src/server/opportunity-list-service";

const createdAt = new Date("2026-10-01T12:00:00.000Z");

function item(overrides: Partial<OpportunityListItem> = {}): OpportunityListItem {
  return {
    id: "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11",
    domain: "customer-success",
    status: "NORMALIZED",
    title: "Customer Success Manager",
    companyName: "Example SaaS",
    location: "Remote - United States",
    salaryText: "$72,000-$88,000",
    postingDate: null,
    createdAt,
    latestEvaluation: null,
    ...overrides,
  };
}

describe("dashboard display helpers", () => {
  it("keeps missing values Unknown instead of inventing them", () => {
    expect(formatText(null)).toBe("Unknown");
    expect(formatText("  ")).toBe("Unknown");
    expect(formatLabel(undefined)).toBe("Unknown");
    expect(formatDate(null)).toBe("Unknown");
    expect(formatDate("not a date")).toBe("Unknown");
  });

  it("reformats persisted labels without interpreting them", () => {
    expect(formatLabel("customer-success")).toBe("Customer Success");
    expect(formatLabel("MATERIAL_UNCERTAINTY")).toBe("Material Uncertainty");
    expect(formatDate(createdAt)).toBe("2026-10-01");
  });
});

describe("opportunity dashboard list", () => {
  it("shows an empty state that links to manual entry", () => {
    const html = renderToStaticMarkup(<OpportunityList opportunities={[]} />);
    expect(html).toContain("No opportunities yet.");
    expect(html).toContain('href="/opportunities/new"');
  });

  it("links each opportunity and shows Unknown for missing facts", () => {
    const html = renderToStaticMarkup(
      <OpportunityList
        opportunities={[
          item(),
          item({
            id: "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22",
            title: null,
            companyName: null,
            location: null,
            salaryText: null,
            domain: null,
          }),
        ]}
      />,
    );
    expect(html).toContain('href="/opportunities/6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11"');
    expect(html).toContain("Customer Success Manager");
    expect(html).toContain("Untitled opportunity");
    expect(html.match(/Unknown/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("Not evaluated");
  });

  it("shows the persisted decision verbatim and never a score", () => {
    const html = renderToStaticMarkup(
      <OpportunityList
        opportunities={[
          item({
            latestEvaluation: {
              id: "e4f0d1c2-7b6a-4c3d-9e8f-1a2b3c4d5e6f",
              status: "COMPLETED",
              decision: "REVIEW",
              createdAt,
              completedAt: createdAt,
            },
          }),
        ]}
      />,
    );
    expect(html).toContain("Review");
    expect(html).toContain("Evaluation completed");
    expect(html).not.toMatch(/overall match|score/i);
  });

  it("does not depend on Customer Success result styling", () => {
    const html = renderToStaticMarkup(
      <OpportunityList
        opportunities={[
          item({
            latestEvaluation: {
              id: "e4f0d1c2-7b6a-4c3d-9e8f-1a2b3c4d5e6f",
              status: "COMPLETED",
              decision: "APPLY",
              createdAt,
              completedAt: createdAt,
            },
          }),
        ]}
      />,
    );
    expect(html).not.toContain("classification-");
  });

  it("renders untrusted text as escaped text", () => {
    const html = renderToStaticMarkup(
      <OpportunityList opportunities={[item({ title: "<script>alert(1)</script>" })]} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("GET /api/opportunities handler", () => {
  const page = (items: OpportunityListItem[]) => ({ items, total: items.length, page: 1, requestedPage: 1, pageCount: 1, pageSize: 5 });

  it("returns persisted opportunities from the reader with pagination", async () => {
    const listPage = vi.fn().mockResolvedValue(page([item()]));
    const response = await createOpportunityListHandler({ listPage })(
      new Request("http://localhost/api/opportunities?limit=5"),
    );
    expect(response.status).toBe(200);
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 5, page: 1, sort: "newest" }));
    // The API lists every lifecycle state unless a view is requested.
    expect(listPage.mock.calls[0]![0].filters.statuses).toBeUndefined();
    const body = (await response.json()) as {
      opportunities: Array<{ id: string; createdAt: string }>;
      total: number;
      pageCount: number;
    };
    expect(body.opportunities).toHaveLength(1);
    expect(body.opportunities[0]?.createdAt).toBe(createdAt.toISOString());
    expect(body).toMatchObject({ total: 1, pageCount: 1 });
  });

  it.each(["limit=0", "limit=201", "limit=abc", "page=0", "page=abc", "pageSize=500"])(
    "rejects malformed pagination (%s)",
    async (query) => {
      const listPage = vi.fn();
      const response = await createOpportunityListHandler({ listPage })(
        new Request(`http://localhost/api/opportunities?${query}`),
      );
      expect(response.status).toBe(400);
      expect(listPage).not.toHaveBeenCalled();
    },
  );

  it("ignores unknown parameters and invalid filter values instead of failing", async () => {
    const listPage = vi.fn().mockResolvedValue(page([]));
    const response = await createOpportunityListHandler({ listPage })(
      new Request("http://localhost/api/opportunities?unexpected=1&rec=bogus&sort=sideways&from=2026-13-40"),
    );
    expect(response.status).toBe(200);
    const input = listPage.mock.calls[0]![0];
    expect(input.sort).toBe("newest");
    expect(input.filters.recommendations).toEqual([]);
    expect(input.filters.discoveredFrom).toBeNull();
  });

  it("returns a safe error when the reader fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await createOpportunityListHandler({
      listPage: vi.fn().mockRejectedValue(new Error("connection refused: secret-host")),
    })(new Request("http://localhost/api/opportunities"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-host");
    errorLog.mockRestore();
  });
});
