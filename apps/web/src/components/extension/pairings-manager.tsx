"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/components/budget/budget-format";

export interface PairingView {
  id: string;
  label: string;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  // The extension version that last used this pairing, as it reported it.
  extensionVersion?: string | null;
}

// Same-origin requests to the pairing routes; they refuse anything else.
async function send(url: string, body: unknown): Promise<{ ok: true; payload: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.ok) return { ok: true, payload };
    return { ok: false, error: payload?.error ?? "The change could not be saved." };
  } catch {
    return { ok: false, error: "The server could not be reached." };
  }
}

function PairingCard({ pairing, currentVersion }: { pairing: PairingView; currentVersion?: string | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const headingId = `pairing-${pairing.id}`;

  async function revoke() {
    setBusy(true);
    setError(null);
    const result = await send(`/api/extension/pairings/${pairing.id}/revoke`, {});
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    setDone(true);
    router.refresh();
  }

  return (
    <section className="source-card" aria-labelledby={headingId}>
      <div className="source-card-header">
        <h3 id={headingId}>{pairing.label}</h3>
        <span className={`status-label${pairing.revokedAt ? " status-label-muted" : ""}`}>{pairing.revokedAt ? "Revoked" : "Active"}</span>
      </div>
      <p className="source-meta">
        Credential ending <code>…{pairing.tokenHint}</code> · paired {formatDateTime(pairing.createdAt)} ·{" "}
        {pairing.lastUsedAt ? `last used by the extension ${formatDateTime(pairing.lastUsedAt)}` : "not used by the extension yet"}
        {pairing.extensionVersion ? ` · extension version ${pairing.extensionVersion}` : ""}
        {pairing.revokedAt ? ` · revoked ${formatDateTime(pairing.revokedAt)}` : ""}
      </p>
      {!pairing.revokedAt && pairing.extensionVersion && currentVersion && pairing.extensionVersion !== currentVersion ? (
        <p className="field-help">
          This browser last reported version {pairing.extensionVersion}; this app ships {currentVersion}. Rebuild the extension and reload it in{" "}
          <code>chrome://extensions</code> (see Installation and updates).
        </p>
      ) : null}
      {pairing.revokedAt ? null : (
        <div className="source-actions">
          {confirming ? (
            <span className="confirm-inline" role="group" aria-label={`Confirm unpairing ${pairing.label}`}>
              Unpair <strong>{pairing.label}</strong> and revoke its access? The extension in that browser stops working until it is paired again.
              Jobs already captured and your capture history are kept.{" "}
              <button type="button" className="danger-button" disabled={busy} onClick={revoke}>
                Unpair / Revoke Access
              </button>{" "}
              <button type="button" className="link-button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="secondary-button" onClick={() => setConfirming(true)}>
              Unpair / Revoke Access
            </button>
          )}
        </div>
      )}
      {done ? <p role="status">Access revoked. Jobs already captured are kept.</p> : null}
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function PairForm() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ label: string; credential: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    const result = await send("/api/extension/pairings", label.trim() ? { label: label.trim() } : {});
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const payload = result.payload as { credential: string; pairing: { label: string } };
    setCreated({ label: payload.pairing.label, credential: payload.credential });
    setLabel("");
    router.refresh();
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.credential);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <form className="source-form" onSubmit={submit} aria-labelledby="pair-heading">
      <h2 id="pair-heading">Pair New Extension</h2>
      <p className="field-help">
        Connects one Chrome installation or profile to this AI Job Assistant. The credential is shown once and only a hash of it is kept here.
      </p>
      <ol className="field-help">
        <li>Name the browser (for example &quot;Chrome — work profile&quot;) and press Create pairing.</li>
        <li>Copy the credential.</li>
        <li>
          In Chrome, open the extension&apos;s Options (right-click the AI Job Assistant button → Options), enter this app&apos;s address and paste the
          credential, then press Save. It confirms the connection.
        </li>
      </ol>
      <div className="form-grid">
        <label>
          Name (optional)
          <input value={label} maxLength={60} placeholder="Browser" onChange={(event) => setLabel(event.target.value)} />
        </label>
      </div>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy}>
        Create pairing
      </button>
      {created ? (
        <div className="pairing-credential" role="status">
          <p>
            <strong>Pairing credential for {created.label}</strong> (shown only now):
          </p>
          <code data-testid="pairing-credential">{created.credential}</code>
          <div className="source-actions">
            <button type="button" className="secondary-button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="link-button" onClick={() => setCreated(null)}>
              I&apos;ve saved it in the extension
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function PairingsManager({ pairings, currentVersion = null }: { pairings: PairingView[]; currentVersion?: string | null }) {
  const active = pairings.filter((pairing) => !pairing.revokedAt);
  const revoked = pairings.filter((pairing) => pairing.revokedAt);
  return (
    <>
      <PairForm />
      <section className="source-list" aria-labelledby="pairings-heading">
        <h2 id="pairings-heading">Paired browsers ({active.length})</h2>
        {active.length ? active.map((pairing) => <PairingCard key={pairing.id} pairing={pairing} currentVersion={currentVersion} />) : <p>No browser is paired yet.</p>}
      </section>
      {revoked.length ? (
        <details className="source-details">
          <summary>Revoked pairings ({revoked.length})</summary>
          {revoked.map((pairing) => (
            <PairingCard key={pairing.id} pairing={pairing} />
          ))}
        </details>
      ) : null}
    </>
  );
}
