"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CommandError {
  code: string;
  message: string;
  issues: Array<{ path: string; message: string }>;
}

export const conflictCode = "APPLICATION_CHANGED";

async function readError(response: Response): Promise<CommandError> {
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
    issues?: Array<{ path: string; message: string }>;
  };
  return {
    code: body.code ?? "UNKNOWN",
    message: body.error ?? "The change could not be saved.",
    issues: body.issues ?? [],
  };
}

// Sends one request and refreshes server data on success. On failure the
// caller's form state is left untouched, so typed input is never lost —
// including on a stale-version conflict.
export function useApplicationRequest() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);

  async function send(url: string, body: unknown): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await readError(response));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError({ code: "NETWORK", message: "The application could not reach the server.", issues: [] });
      return false;
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    error,
    clearError: () => setError(null),
    reload: () => {
      setError(null);
      router.refresh();
    },
    send,
  };
}

export function useApplicationCommand(applicationId: string) {
  const request = useApplicationRequest();
  return {
    ...request,
    run: (body: Record<string, unknown>) => request.send(`/api/applications/${encodeURIComponent(applicationId)}`, body),
  };
}

export function fieldError(error: CommandError | null, path: string): string | null {
  return error?.issues.find((issue) => issue.path === path)?.message ?? null;
}
