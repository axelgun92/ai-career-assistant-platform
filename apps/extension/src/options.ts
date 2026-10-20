import { createApiClient, normalizeBackendUrl } from "./api";
import { credentialHint, credentialPattern, forgetPairing, readSettings, restrictStorage, saveSettings } from "./settings";

// The options page: where the local AI Job Assistant runs and this
// browser's pairing credential. The credential is entered once, stored in
// chrome.storage.local and never shown again (only its last characters).

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setStatus = (message: string, isError = false) => {
  const status = element("status");
  status.textContent = message;
  status.className = isError ? "error" : "muted";
};

async function render() {
  const settings = await readSettings();
  element<HTMLInputElement>("backend-url").value = settings.backendUrl;
  element("paired-state").textContent = settings.credential
    ? `A pairing credential ending ${credentialHint(settings.credential)} is saved in this browser.`
    : "No pairing credential is saved yet.";
  element("forget").hidden = !settings.credential;
}

async function test() {
  const settings = await readSettings();
  if (!settings.credential) return setStatus("Save a pairing credential first.", true);
  const result = await createApiClient({ backendUrl: settings.backendUrl, credential: settings.credential }).status();
  if (result.ok) setStatus(`Connected to AI Job Assistant as "${result.body.pairing.label}".`);
  else setStatus(result.error, true);
}

async function save(event: Event) {
  event.preventDefault();
  const backendUrl = normalizeBackendUrl(element<HTMLInputElement>("backend-url").value);
  if (!backendUrl) return setStatus("Enter the local address of AI Job Assistant, such as http://localhost:3000.", true);
  const credentialInput = element<HTMLInputElement>("credential");
  const credential = credentialInput.value.trim();
  if (credential && !credentialPattern.test(credential)) {
    return setStatus("That is not a pairing credential. Copy it from AI Job Assistant's Extension page.", true);
  }
  await saveSettings({ backendUrl, ...(credential ? { credential } : {}) });
  credentialInput.value = "";
  await render();
  await test();
}

async function start() {
  await restrictStorage();
  element("settings-form").addEventListener("submit", (event) => void save(event));
  element("test").addEventListener("click", () => void test());
  element("forget").addEventListener("click", () => {
    void forgetPairing().then(async () => {
      await render();
      setStatus("The pairing credential was removed from this browser. Revoke it on AI Job Assistant's Extension page too.");
    });
  });
  await render();
}

void start();
