// Client calls for deferred evaluations. Resume re-checks the budget on the
// server; the response says whether it was queued or is still deferred.

export type DeferredActionResult =
  | { kind: "queued" }
  | { kind: "still-deferred" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export async function runDeferredAction(id: string, action: "resume" | "cancel"): Promise<DeferredActionResult> {
  try {
    const response = await fetch(`/api/evaluations/deferred/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { error?: string; outcome?: string };
    if (!response.ok) return { kind: "error", message: body.error ?? "The request could not be completed." };
    if (action === "cancel") return { kind: "cancelled" };
    return body.outcome === "QUEUED" ? { kind: "queued" } : { kind: "still-deferred" };
  } catch {
    return { kind: "error", message: "The application could not reach the server." };
  }
}
