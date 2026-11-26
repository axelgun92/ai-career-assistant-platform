"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Creates the first profile version from the bundled starting profile and
// makes it active. Offered only when no profile exists at all.
export function StartingProfileButton({ document }: { document: unknown }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const response = await fetch("/api/profile", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ baseVersionId: null, document, activate: true }),
            });
            if (!response.ok) {
              const body = (await response.json().catch(() => ({}))) as { error?: string };
              setError(body.error ?? "The starting profile could not be created.");
              return;
            }
            router.refresh();
          } catch {
            setError("The application could not reach the server.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Creating…" : "Create from the starting profile"}
      </button>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
