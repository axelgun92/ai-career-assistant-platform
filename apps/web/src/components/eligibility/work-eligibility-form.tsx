"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The user's own work eligibility, used only to decide which jobs' work-
// authorization requirements need attention. It is not part of the
// evaluation profile and never changes how jobs are normalized or evaluated.
export function WorkEligibilityForm({ initial }: { initial: { authorizedRegions: readonly string[]; citizenshipRegions: readonly string[] } }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(initial.authorizedRegions.join(", "));
  const [citizenship, setCitizenship] = useState(initial.citizenshipRegions.join(", "));
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/eligibility", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorizedRegions: authorized, citizenshipRegions: citizenship }),
      });
      const body = (await response.json()) as { authorizedRegions?: string[]; citizenshipRegions?: string[]; fields?: Array<{ message: string }>; error?: string };
      if (!response.ok) {
        setMessage({ kind: "error", text: body.fields?.map((field) => field.message).join(" ") ?? body.error ?? "Work eligibility could not be saved." });
        return;
      }
      setAuthorized((body.authorizedRegions ?? []).join(", "));
      setCitizenship((body.citizenshipRegions ?? []).join(", "));
      setMessage({ kind: "success", text: "Saved." });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Work eligibility could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="work-eligibility" aria-labelledby="work-eligibility-title">
      <h2 id="work-eligibility-title">Work eligibility</h2>
      <p>
        Where you may work. Jobs whose work-authorization requirements you already meet are not flagged; requirements, sponsorship and
        relocation facts for other countries are shown for review. This is not part of your evaluation profile.
      </p>
      <form onSubmit={save}>
        <label htmlFor="eligibility-authorized">Countries you are authorized to work in</label>
        <input id="eligibility-authorized" value={authorized} onChange={(event) => setAuthorized(event.target.value)} placeholder="United States" />
        <label htmlFor="eligibility-citizenship">Countries you are a citizen of</label>
        <input id="eligibility-citizenship" value={citizenship} onChange={(event) => setCitizenship(event.target.value)} placeholder="United States" />
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save work eligibility"}</button>
      </form>
      {message ? (
        <p className={message.kind === "success" ? "success-message" : "error-message"} role={message.kind === "success" ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
