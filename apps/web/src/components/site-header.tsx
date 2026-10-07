"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One navigation for the whole product. The opportunity detail page counts
// as part of the dashboard section.
export const siteSections = [
  { href: "/", label: "Dashboard", matches: (path: string) => path === "/" || (path.startsWith("/opportunities/") && path !== "/opportunities/new") },
  { href: "/applications", label: "Applications", matches: (path: string) => path.startsWith("/applications") },
  { href: "/opportunities/new", label: "New opportunity", matches: (path: string) => path === "/opportunities/new" },
  { href: "/profile", label: "Profile & preferences", matches: (path: string) => path.startsWith("/profile") },
  { href: "/budget", label: "Budget", matches: (path: string) => path.startsWith("/budget") },
] as const;

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Link href="/" className="site-brand">
        AI Career Platform
      </Link>
      <nav aria-label="Main">
        <ul>
          {siteSections.map((section) => (
            <li key={section.href}>
              <Link href={section.href} aria-current={section.matches(pathname) ? "page" : undefined}>
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
