import { pageCaptureSiteByKey } from "../../../packages/core/src/page-capture";
import { createApiClient, normalizeBackendUrl, type ApiClient, type ApiResult } from "./api";
import { extractJobPosting, type PageExtraction } from "./extract";
import { readSettings, restrictStorage } from "./settings";
import { createTabAcquisition, probeJobPage, tabRunStorageKey, type TabProbe, type TabRunState } from "./tab-acquisition";
import { isTabMessage, pendingSaveKey, pendingSaveMaxAgeMs, type PendingSave, type SaveReply, type StateReply } from "./tab-messages";

// The extension's service worker.
//
// - It keeps the extension's storage (the backend address and the pairing
//   credential) limited to the extension's own pages, from installation and
//   every browser start, before any page is read.
// - For "Save selected jobs" on a site whose details are read in background
//   tabs (Welcome to the Jungle / Otta), it sends the batch the popup handed
//   it, then reads each saved job's page in its own background tab, one at a
//   time (tab-acquisition.ts). It reads nothing else, opens no other tab and
//   calls only the local AI Job Assistant's extension routes.
// - Nothing reopens tabs on browser start: the run lives in session storage,
//   which the browser clears when it closes, and is cleared again at start.

const runAlarm = "page-capture-tab-run";

chrome.runtime.onInstalled.addListener(() => void restrictStorage());
chrome.runtime.onStartup.addListener(() => {
  void restrictStorage();
  void chrome.storage.session.remove([tabRunStorageKey, pendingSaveKey]).catch(() => undefined);
  void chrome.alarms.clear(runAlarm).catch(() => undefined);
});
void restrictStorage();

async function apiClient() {
  const settings = await readSettings();
  const origin = normalizeBackendUrl(settings.backendUrl);
  if (!origin || !settings.credential) return null;
  return createApiClient({ backendUrl: origin, credential: settings.credential });
}

// The client is made for each call from the stored settings, so a run uses
// the current pairing; without one, the call fails as unreachable and the
// run stops.
async function withApi<T>(run: (api: ApiClient) => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  const api = await apiClient();
  return api ? run(api) : { ok: false, status: 0, code: "NOT_CONFIGURED", error: "Not paired" };
}

function waitForLoad(tabId: number, timeoutMs: number): Promise<"complete" | "timeout" | "removed"> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: "complete" | "timeout" | "removed") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      resolve(value);
    };
    const updated = (id: number, change: { status?: string }) => {
      if (id === tabId && change.status === "complete") finish("complete");
    };
    const removed = (id: number) => {
      if (id === tabId) finish("removed");
    };
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete" && tab.url) finish("complete");
      })
      .catch(() => finish("removed"));
  });
}

let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

const acquisition = createTabAcquisition({
  api: {
    pageCaptureTabStart: (id) => withApi((api) => api.pageCaptureTabStart(id)),
    pageCaptureTabDetails: (id, body) => withApi((api) => api.pageCaptureTabDetails(id, body)),
    pageCaptureTabResult: (id, body) => withApi((api) => api.pageCaptureTabResult(id, body)),
    pageCaptureTabStop: (body) => withApi((api) => api.pageCaptureTabStop(body)),
  },
  tabs: {
    async open(url) {
      // A background tab: the user's active tab is never touched.
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) throw new Error("The tab could not be opened");
      return tab.id;
    },
    async url(tabId) {
      const tab = await chrome.tabs.get(tabId);
      return tab.url ?? null;
    },
    async exists(tabId) {
      return chrome.tabs
        .get(tabId)
        .then(() => true)
        .catch(() => false);
    },
    waitForLoad,
    close: (tabId) => chrome.tabs.remove(tabId),
  },
  page: {
    async probe(tabId) {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: probeJobPage });
      if (!injection?.result) throw new Error("The page could not be checked");
      return injection.result as TabProbe;
    },
    async read(tabId) {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: extractJobPosting });
      return (injection?.result as PageExtraction | undefined) ?? null;
    },
  },
  hasPermission: (origins) => chrome.permissions.contains({ origins }),
  storage: {
    async load() {
      const stored = await chrome.storage.session.get(tabRunStorageKey);
      return (stored[tabRunStorageKey] as TabRunState | undefined) ?? null;
    },
    async save(state) {
      if (state) await chrome.storage.session.set({ [tabRunStorageKey]: state });
      else await chrome.storage.session.remove(tabRunStorageKey);
    },
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  extensionVersion: chrome.runtime.getManifest().version,
  keepAlive(active) {
    // While a run is active, a light extension call every 20 seconds keeps
    // the service worker from being stopped between jobs, and an alarm
    // resumes the run if it is stopped anyway.
    if (active) {
      keepAliveTimer ??= setInterval(() => void chrome.runtime.getPlatformInfo().catch(() => undefined), 20_000);
      void chrome.alarms.create(runAlarm, { periodInMinutes: 0.5 }).catch(() => undefined);
    } else {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      void chrome.alarms.clear(runAlarm).catch(() => undefined);
    }
  },
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== runAlarm || acquisition.isRunning()) return;
  void acquisition.state().then((state) => {
    if (state && !state.finished) void acquisition.resume();
    else void chrome.alarms.clear(runAlarm).catch(() => undefined);
  });
});

// One send per batch, whichever comes first: the popup's message after the
// permission was granted, or the grant itself when the popup closed.
const saves = new Map<string, Promise<SaveReply>>();

function savePending(pending: PendingSave): Promise<SaveReply> {
  const existing = saves.get(pending.batch.batchId);
  if (existing) return existing;
  const promise = (async (): Promise<SaveReply> => {
    await chrome.storage.session.remove(pendingSaveKey).catch(() => undefined);
    if (Date.now() - pending.createdAt > pendingSaveMaxAgeMs) {
      return { ok: false, status: 0, code: "EXPIRED", error: "This save is too old. Read the page and save again." };
    }
    const site = pageCaptureSiteByKey(pending.site);
    if (!site?.tabAcquisition || site.key !== pending.batch.site) {
      return { ok: false, status: 0, code: "EXPIRED", error: "Saving jobs from this page is not supported." };
    }
    // Nothing is sent without the site's permission.
    if (!(await chrome.permissions.contains({ origins: site.tabAcquisition.hostPermissions }))) {
      return { ok: false, status: 0, code: "EXPIRED", error: `Reading job details needs permission to open ${site.name} job pages. Nothing was saved.` };
    }
    const api = await apiClient();
    if (!api) return { ok: false, status: 0, code: "NOT_PAIRED", error: "Not paired yet. Open Options to connect this browser to AI Job Assistant." };
    const result = await api.pageCapture(pending.batch);
    const plan = result.ok ? result.body.acquisition : undefined;
    if (plan && plan.items.length) {
      await acquisition.enqueue({
        site: site.key,
        siteName: site.name,
        hostPermissions: site.tabAcquisition.hostPermissions,
        minIntervalMs: Math.max(plan.minIntervalMs, site.detail.minIntervalMs),
        loadTimeoutMs: site.tabAcquisition.loadTimeoutMs,
        rereadDelaysMs: site.tabAcquisition.rereadDelaysMs,
        items: plan.items,
      });
    }
    return result;
  })();
  saves.set(pending.batch.batchId, promise);
  return promise;
}

chrome.permissions.onAdded.addListener((permissions) => {
  if (!permissions.origins?.length) return;
  void chrome.storage.session.get(pendingSaveKey).then((stored) => {
    const pending = stored[pendingSaveKey] as PendingSave | undefined;
    if (pending) void savePending(pending);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the extension's own pages (the popup) may ask.
  if (sender.id !== chrome.runtime.id || sender.tab || !isTabMessage(message)) return;
  if (message.type === "page-capture:save") {
    void savePending(message.pending).then(sendResponse);
    return true;
  }
  if (message.type === "page-capture:stop") {
    void acquisition.stop().then((state) => sendResponse({ state } satisfies StateReply));
    return true;
  }
  void acquisition.state().then((state) => {
    // A run the service worker was stopped in continues.
    if (state && !state.finished && !acquisition.isRunning()) void acquisition.resume();
    sendResponse({ state } satisfies StateReply);
  });
  return true;
});
