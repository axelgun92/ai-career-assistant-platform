import { createApiClient, normalizeBackendUrl, type ApiClient, type EvaluationSummary } from "./api";
import { buildCaptureEnvelope, previewFields, type CaptureChoice, type PreviewFields } from "./envelope";
import { extractJobPosting, type PageExtraction } from "./extract";
import {
  captureMessage,
  evaluationActive,
  evaluationLine,
  evaluationRequestMessage,
  extractorLabels,
  siteLine,
} from "./popup-view";
import { readSettings, restrictStorage } from "./settings";
import { pageCaptureOffer, type PageCaptureSiteSpec } from "../../../packages/core/src/page-capture";
import { readResultCards, type ResultCardsReading } from "./results";
import { buildPageCaptureBatch, cardLine, pageCaptureMessage, readerInputFor, readingSummary, rejectedLines, type PageCaptureResponse } from "./page-capture-view";
import { tabRunLine } from "./tab-acquisition";
import { pendingSaveKey, startTabSave, type SaveReply, type StateReply, type TabMessage } from "./tab-messages";

// The popup. Nothing is read from the page until "Read this page", and
// nothing is sent until "Save". Every message is set as text, never as HTML.

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, text: string) => {
  element(id).textContent = text;
};
const show = (id: string, visible: boolean) => {
  element(id).hidden = !visible;
};
const showError = (message: string | null) => {
  setText("error", message ?? "");
  show("error", message !== null);
};

const pollIntervalMs = 3_000;
const pollLimit = 20;

let api: ApiClient | null = null;
let origin: string | null = null;
let tabId: number | null = null;
let extraction: PageExtraction | null = null;
let choice: CaptureChoice = "page";
let opportunityId: string | null = null;
let polling: ReturnType<typeof setTimeout> | null = null;

// The tab to read: the active tab of the window the popup was opened from.
// ?tabId= selects a tab explicitly (used by the automated extension tests,
// which cannot click the toolbar); reading still needs the page's grant.
async function targetTab(): Promise<chrome.tabs.Tab | null> {
  const requested = Number(new URLSearchParams(location.search).get("tabId"));
  if (Number.isInteger(requested) && requested > 0) return chrome.tabs.get(requested).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function renderEvaluation(evaluation: EvaluationSummary | null) {
  setText("evaluation-state", evaluationLine(evaluation));
  show("request-evaluation", opportunityId !== null && !evaluationActive(evaluation));
  if (evaluationActive(evaluation)) startPolling();
}

function startPolling() {
  if (polling || !api || !opportunityId) return;
  let remaining = pollLimit;
  const tick = async () => {
    polling = null;
    if (!api || !opportunityId) return;
    const status = await api.evaluationStatus(opportunityId);
    if (status.ok) {
      setText("evaluation-state", evaluationLine(status.body));
      const active = evaluationActive(status.body);
      show("request-evaluation", !active);
      remaining -= 1;
      if (active && remaining > 0) polling = setTimeout(tick, pollIntervalMs);
      else if (active) setText("evaluation-state", `${evaluationLine(status.body)} Open AI Job Assistant to follow it.`);
    }
  };
  polling = setTimeout(tick, pollIntervalMs);
}

const previewInputs = {
  title: "preview-title",
  company: "preview-company",
  location: "preview-location",
  description: "preview-description",
} as const;

// Fills the editable preview with what was read for the current choice;
// a field the page did not state is left empty (Unknown).
function renderPreview() {
  if (!extraction) return;
  const fields = previewFields(extraction, choice);
  for (const [field, id] of Object.entries(previewInputs)) {
    element<HTMLInputElement | HTMLTextAreaElement>(id).value = fields?.[field as keyof typeof previewInputs] ?? "";
  }
  const source = choice === "selection" ? "selection" : extraction.extractor;
  setText("preview-source", source ? `Read from ${extractorLabels[source]}` : "");
  setText("preview-notes", extraction.notes.join(" "));
  show("use-selection", extraction.selection !== null && choice !== "selection");
  show("use-page", choice === "selection" && extraction.posting !== null);
  show("preview", true);
}

const previewValues = (): PreviewFields => ({
  title: element<HTMLInputElement>(previewInputs.title).value,
  company: element<HTMLInputElement>(previewInputs.company).value,
  location: element<HTMLInputElement>(previewInputs.location).value,
  description: element<HTMLTextAreaElement>(previewInputs.description).value,
});

async function readPage() {
  showError(null);
  if (tabId === null) return;
  element<HTMLButtonElement>("read").disabled = true;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: extractJobPosting });
    extraction = injection?.result ?? null;
  } catch {
    extraction = null;
    showError("This page cannot be read. Chrome does not let extensions read some pages.");
    return;
  } finally {
    element<HTMLButtonElement>("read").disabled = false;
  }
  if (!extraction) return showError("This page could not be read.");
  if (extraction.problem === "LINKEDIN_NOT_JOB_PAGE") {
    return showError("Open a LinkedIn job page to save it. Only the job posting is read, nothing else on LinkedIn.");
  }
  choice = extraction.posting ? "page" : "selection";
  if (!extraction.posting && !extraction.selection) {
    return showError(
      extraction.linkedIn
        ? "No job details were found on this LinkedIn page. Select the job description text and press Read this page again."
        : "No job posting was found. Select the job description text on the page and press Read this page again.",
    );
  }
  renderPreview();
}

async function save() {
  showError(null);
  if (!api || !extraction) return;
  const built = buildCaptureEnvelope(
    extraction,
    choice,
    { extensionVersion: chrome.runtime.getManifest().version, capturedAt: new Date() },
    previewValues(),
  );
  if (!built.ok) return showError(`This page can't be saved yet: ${built.problems.join("; ")}.`);
  element<HTMLButtonElement>("save").disabled = true;
  const result = await api.capture(built.envelope);
  element<HTMLButtonElement>("save").disabled = false;
  if (!result.ok) return showError(result.error);
  opportunityId = result.body.opportunityId;
  show("preview", false);
  show("saved", false);
  setText("result-message", captureMessage(result.body));
  show("result", true);
  show("open-app", true);
  renderEvaluation(result.body.evaluation);
}

async function requestEvaluation() {
  showError(null);
  if (!api || !opportunityId) return;
  const button = element<HTMLButtonElement>("request-evaluation");
  button.disabled = true;
  const result = await api.requestEvaluation(opportunityId);
  button.disabled = false;
  setText("evaluation-request", evaluationRequestMessage(result));
  show("evaluation-request", true);
  if (!result.ok) return;
  // Only a queued evaluation is followed. A job held for review or rejected
  // before evaluation has nothing running; its decision is made in the app.
  if (result.body.outcome === "QUEUED") {
    show("request-evaluation", false);
    setText("evaluation-state", "Evaluation queued.");
    startPolling();
  } else if (result.body.outcome === "NEEDS_REVIEW" || result.body.outcome === "REJECT") {
    show("request-evaluation", false);
    setText("evaluation-state", result.body.outcome === "NEEDS_REVIEW" ? "Needs Review before evaluation." : "Rejected before evaluation.");
  }
}

function openInApp() {
  if (origin && opportunityId) void chrome.tabs.create({ url: `${origin}/opportunities/${encodeURIComponent(opportunityId)}` });
}

// Mode B: "Save jobs on this page". The cards already loaded in the page are
// read once, shown for the user to keep or drop, and sent only on Save.
let pageSite: PageCaptureSiteSpec | null = null;
let reading: ResultCardsReading | null = null;

async function readJobsOnPage() {
  showError(null);
  if (tabId === null || !pageSite) return;
  const button = element<HTMLButtonElement>("read-jobs");
  button.disabled = true;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: readResultCards, args: [readerInputFor(pageSite)] });
    reading = (injection?.result as ResultCardsReading | undefined) ?? null;
  } catch {
    reading = null;
    showError("This page cannot be read. Chrome does not let extensions read some pages.");
    return;
  } finally {
    button.disabled = false;
  }
  if (!reading) return showError("This page could not be read.");
  setText("jobs-summary", readingSummary(reading));
  const list = element("jobs-list");
  list.replaceChildren();
  reading.cards.forEach((card, index) => {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.dataset.index = String(index);
    label.append(box, document.createTextNode(` ${cardLine(card)}`));
    item.append(label);
    list.append(item);
  });
  show("save-jobs", reading.cards.length > 0);
  show("jobs-preview", true);
}

// Not async before the permission request: Chrome grants a permission only
// from inside the user's click.
function saveJobs() {
  showError(null);
  if (!api || !reading || !pageSite) return;
  const kept = [...element("jobs-list").querySelectorAll<HTMLInputElement>("input[type=checkbox]")].map((box) => box.checked);
  const built = buildPageCaptureBatch(reading, kept, {
    site: pageSite.key,
    batchId: crypto.randomUUID(),
    extensionVersion: chrome.runtime.getManifest().version,
    capturedAt: new Date(),
  });
  if (!built.ok) return showError(built.problem);
  const button = element<HTMLButtonElement>("save-jobs");
  button.disabled = true;
  const tabs = pageSite.tabAcquisition;
  if (!tabs) return void saveBatchHere(built.batch, button);
  // The site's job pages are read in background tabs of this browser: its
  // permission is asked now, and the service worker sends the batch and
  // reads the jobs. Declined, nothing is saved.
  const site = pageSite;
  void startTabSave(
    { batch: built.batch, site: site.key, hostPermissions: tabs.hostPermissions, now: Date.now() },
    {
      keepPending: (pending) => void chrome.storage.session.set({ [pendingSaveKey]: pending }).catch(() => undefined),
      dropPending: () => chrome.storage.session.remove(pendingSaveKey).catch(() => undefined),
      requestPermission: (origins) => chrome.permissions.request({ origins }),
      send: (message: TabMessage) => chrome.runtime.sendMessage<SaveReply>(message),
    },
  ).then((outcome) => {
    button.disabled = false;
    if (!outcome.granted) {
      return showError(`Reading these jobs' details needs permission to open ${site.name} job pages in background tabs. Nothing was saved.`);
    }
    if (!outcome.reply.ok) return showError(outcome.reply.error);
    showSaved(outcome.reply.body);
    void refreshTabRun();
  });
}

async function saveBatchHere(batch: Parameters<ApiClient["pageCapture"]>[0], button: HTMLButtonElement) {
  if (!api) return;
  const result = await api.pageCapture(batch);
  button.disabled = false;
  if (!result.ok) return showError(result.error);
  showSaved(result.body);
}

function showSaved(body: PageCaptureResponse) {
  show("jobs-preview", false);
  setText("jobs-result-message", pageCaptureMessage(body));
  setText("jobs-rejected", rejectedLines(body).join("\n"));
  show("jobs-result", true);
}

// A background-tab run in progress (or just ended), with its Stop control.
let runPolling: ReturnType<typeof setTimeout> | null = null;
async function refreshTabRun() {
  if (runPolling) clearTimeout(runPolling);
  runPolling = null;
  const reply = await chrome.runtime.sendMessage<StateReply>({ type: "page-capture:state" } satisfies TabMessage).catch(() => null);
  const state = reply?.state ?? null;
  const line = tabRunLine(state);
  setText("tab-run-state", line ?? "");
  show("tab-run", line !== null);
  show("tab-run-stop", Boolean(state && !state.finished && !state.stopRequested));
  if (state && !state.finished) runPolling = setTimeout(() => void refreshTabRun(), 2_000);
}

async function stopTabRun() {
  element<HTMLButtonElement>("tab-run-stop").disabled = true;
  await chrome.runtime.sendMessage({ type: "page-capture:stop" } satisfies TabMessage).catch(() => null);
  element<HTMLButtonElement>("tab-run-stop").disabled = false;
  await refreshTabRun();
}

function openProgress() {
  if (origin) void chrome.tabs.create({ url: `${origin}/extension/jobs` });
}

async function start() {
  element("options").addEventListener("click", () => void chrome.runtime.openOptionsPage());
  element("read").addEventListener("click", () => void readPage());
  element("save").addEventListener("click", () => void save());
  element("use-selection").addEventListener("click", () => {
    choice = "selection";
    renderPreview();
  });
  element("use-page").addEventListener("click", () => {
    choice = "page";
    renderPreview();
  });
  element("request-evaluation").addEventListener("click", () => void requestEvaluation());
  element("open-app").addEventListener("click", openInApp);
  element("read-jobs").addEventListener("click", () => void readJobsOnPage());
  element("save-jobs").addEventListener("click", () => saveJobs());
  element("tab-run-stop").addEventListener("click", () => void stopTabRun());
  element("open-progress").addEventListener("click", openProgress);

  await restrictStorage();
  const settings = await readSettings();
  origin = normalizeBackendUrl(settings.backendUrl);
  if (!origin || !settings.credential) {
    setText("connection", "Not paired yet. Open Options to connect this browser to AI Job Assistant.");
    return;
  }
  api = createApiClient({ backendUrl: origin, credential: settings.credential });
  const status = await api.status();
  if (!status.ok) {
    setText("connection", status.status === 401 ? "The pairing is no longer valid. Pair this browser again in Options." : status.error);
    return;
  }
  setText("connection", `Connected to AI Job Assistant (${status.body.pairing.label}).`);
  void refreshTabRun();

  const tab = await targetTab();
  const url = tab?.url ?? "";
  if (!tab?.id || !/^https?:/i.test(url)) {
    setText("page-site", "This page can't be saved. Open a job posting on a website.");
    return;
  }
  tabId = tab.id;
  // Mode B is offered only on a results page of a site the app enables.
  const offer = pageCaptureOffer(url, status.body.pageCapture?.sites ?? []);
  pageSite = offer.offered ? offer.site : null;
  show("page-actions", pageSite !== null);
  const lookup = await api.lookup(url);
  if (lookup.ok) {
    setText("page-site", siteLine(lookup.body.site));
    if (!lookup.body.supported) {
      setText(
        "page-site",
        pageSite
          ? "This is a results page: save the jobs on it below. To save one job with its full details, open its job page."
          : "Open a LinkedIn job page to save it. Only the job posting is read, nothing else on LinkedIn.",
      );
      return;
    }
    if (lookup.body.found && lookup.body.opportunityId) {
      opportunityId = lookup.body.opportunityId;
      setText("saved-message", `Already saved: ${lookup.body.title ?? "this job"}${lookup.body.company ? ` at ${lookup.body.company}` : ""}.`);
      show("saved", true);
      show("result", true);
      show("open-app", true);
      setText("result-message", "");
      renderEvaluation(lookup.body.evaluation ?? null);
    }
  }
  show("read-actions", true);
}

void start();
