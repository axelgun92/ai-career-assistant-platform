"use client";

import Link from "next/link";

// Shown when a page fails to load. Error details stay in the server log.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p role="alert">This page could not be loaded. Check that the database is running, then try again.</p>
      <p className="evaluation-actions">
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="button-link button-link-secondary">
          Go to the dashboard
        </Link>
      </p>
    </main>
  );
}
