import Link from "next/link";

// The browser extension's two destinations in the app: managing the
// extension (Setup & Connection) and every job it captured (Captured Jobs).
export const extensionDestinations = [
  { key: "setup", label: "Setup & Connection", href: "/extension" },
  { key: "jobs", label: "Captured Jobs", href: "/extension/jobs" },
] as const;

export function ExtensionNav({ current }: { current: (typeof extensionDestinations)[number]["key"] }) {
  return (
    <nav className="filter-links extension-nav" aria-label="Browser extension">
      {extensionDestinations.map((destination) =>
        destination.key === current ? (
          <strong key={destination.key} aria-current="page">
            {destination.label}
          </strong>
        ) : (
          <Link key={destination.key} href={destination.href}>
            {destination.label}
          </Link>
        ),
      )}
    </nav>
  );
}
