import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseApplicationQuery, serializeApplicationQuery } from "../../apps/web/src/server/application-query";

const { pathname } = vi.hoisted(() => ({ pathname: { value: "/" } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ usePathname: () => pathname.value }));
const { SiteHeader, siteSections } = await import("../../apps/web/src/components/site-header");
const { trackerLinks } = await import("../../apps/web/src/components/application/application-list");
const { attentionLinks } = await import("../../apps/web/src/components/dashboard/dashboard-summary");

const appDirectory = path.resolve("apps/web/src/app");
const routeExists = (href: string) => {
  const route = href.split("?")[0]!.replace(/\/$/, "");
  return existsSync(path.join(appDirectory, route, "page.tsx"));
};

describe("site header", () => {
  it("links every product area and marks the current one", () => {
    for (const [current, expected] of [
      ["/", "Dashboard"],
      ["/opportunities/6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11", "Dashboard"],
      ["/opportunities/new", "New opportunity"],
      ["/applications", "Applications"],
      ["/profile", "Profile &amp; preferences"],
      ["/budget", "Budget"],
    ] as const) {
      pathname.value = current;
      const markup = renderToStaticMarkup(<SiteHeader />);
      const currentLinks = [...markup.matchAll(/aria-current="page"[^>]*>([^<]+)</g)].map((match) => match[1]);
      expect(currentLinks, current).toEqual([expected]);
      expect(markup).toContain('href="#main-content"');
    }
  });

  it("has no dead links: every header, tracker and attention link targets a real page", () => {
    for (const href of [
      ...siteSections.map((section) => section.href),
      ...Object.values(trackerLinks),
      ...Object.values(attentionLinks),
    ]) {
      expect(routeExists(href), href).toBe(true);
    }
  });
});

describe("tracker links match their counts", () => {
  it("parses the due-today filter separately from due-now", () => {
    expect(parseApplicationQuery(new URLSearchParams("followUp=today")).followUp).toBe("today");
    expect(serializeApplicationQuery(parseApplicationQuery(new URLSearchParams("followUp=today")))).toBe("followUp=today");
    expect(trackerLinks.today).toBe("/applications?followUp=today");
  });
});
