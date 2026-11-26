// The extension's only stored data: the local AI Job Assistant address and
// the pairing credential, in chrome.storage.local (never synced storage, so
// they never leave this browser). Storage is limited to the extension's own
// pages where Chrome supports that; the page reader never touches storage.
// The credential is never logged or shown again after it is saved.

export interface ExtensionSettings {
  backendUrl: string;
  credential: string | null;
}

export const defaultBackendUrl = "http://localhost:3000";
const keys = { backendUrl: "backendUrl", credential: "pairingCredential" } as const;

export async function restrictStorage(storage: chrome.storage.StorageArea = chrome.storage.local): Promise<void> {
  await storage.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
}

export async function readSettings(storage: chrome.storage.StorageArea = chrome.storage.local): Promise<ExtensionSettings> {
  const stored = await storage.get([keys.backendUrl, keys.credential]);
  return {
    backendUrl: typeof stored[keys.backendUrl] === "string" ? (stored[keys.backendUrl] as string) : defaultBackendUrl,
    credential: typeof stored[keys.credential] === "string" ? (stored[keys.credential] as string) : null,
  };
}

export async function saveSettings(
  update: { backendUrl?: string; credential?: string },
  storage: chrome.storage.StorageArea = chrome.storage.local,
): Promise<void> {
  const items: Record<string, unknown> = {};
  if (update.backendUrl !== undefined) items[keys.backendUrl] = update.backendUrl;
  if (update.credential !== undefined) items[keys.credential] = update.credential;
  await storage.set(items);
}

export async function forgetPairing(storage: chrome.storage.StorageArea = chrome.storage.local): Promise<void> {
  await storage.remove(keys.credential);
}

export const credentialPattern = /^aija_[A-Za-z0-9_-]{43}$/;

// For display: only the last characters, as on the app's Extension page.
export const credentialHint = (credential: string) => `…${credential.slice(-4)}`;
