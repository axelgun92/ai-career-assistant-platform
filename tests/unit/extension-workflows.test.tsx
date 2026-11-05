// @vitest-environment jsdom
// The extension workflows of November 5, 2026, offline:
// - the side panel's mode choice and capture-session wording;
// - triage at single-job save as the extension reports it (outcome, or not
//   triaged for want of an active profile), and the batch rows' wording;
// - the dashboard's "Pre-Evaluation Review" view and its Needs Review entry point;
// - Setup & Connection: "Unpair / Revoke Access" only after confirmation,
//   the extension version, the supported-sites table from the registry;
// - Captured Jobs' method column and the two Extension destinations.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { captureMessage, triageLine } from "../../apps/extension/src/popup-view";
import { arrangeSessions, capturedJobsPath, defaultMode, sessionCounts, sessionHeading, sessionJobDetail, sessionLine } from "../../apps/extension/src/panel-view";
import type { CaptureSessionSummary } from "../../apps/extension/src/api";
import { addedStateText, captureMethodText } from "../../apps/web/src/components/extension/page-capture-labels";
import { captureTriageFrom } from "../../apps/web/src/server/extension-api";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { supportedSites, shippedExtensionVersion } from "../../apps/web/src/server/extension-setup";
import { opportunityViews } from "../../apps/web/src/server/opportunity-query";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { PairingsManager } = await import("../../apps/web/src/components/extension/pairings-manager");
const { ExtensionNav } = await import("../../apps/web/src/components/extension/extension-nav");
const { PageCaptureTable } = await import("../../apps/web/src/components/extension/page-capture-list");
const { NeedsAttention, needsReviewLink } = await import("../../apps/web/src/components/dashboard/dashboard-summary");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (overrides: Partial<CaptureSessionSummary> = {}): CaptureSessionSummary => ({
  id: "00000000-0000-4000-8000-000000000001",
  site: "welcome-to-the-jungle",
  siteName: "Welcome to the Jungle / Otta",
  pageUrl: "https://www.welcometothejungle.com/en/jobs",
  pageTitle: "Jobs",
  receivedAt: "2026-11-05T12:00:00.000Z",
  jobs: 5,
  pending: 0,
  added: 5,
  awaiting: 0,
  unavailable: 0,
  dismissed: 0,
  inProgress: false,
  ...overrides,
});

describe("the side panel's modes and captures", () => {
  it("starts a supported results page in Batch Capture and any other page in Single Job", () => {
    expect(defaultMode({ resultsPageOffered: true })).toBe("batch");
    expect(defaultMode({ resultsPageOffered: false })).toBe("single");
  });

  it("finds the capture in progress, the latest finished one and the earlier ones", () => {
    const running = session({ id: "a", inProgress: true, pending: 3, added: 2 });
    const latest = session({ id: "b" });
    const older = session({ id: "c", receivedAt: "2026-11-04T12:00:00.000Z" });
    expect(arrangeSessions([running, latest, older])).toEqual({ current: running, latest, previous: [older] });
    expect(arrangeSessions([])).toEqual({ current: null, latest: null, previous: [] });
  });

  it("describes a capture in plain words and links to its jobs in the app", () => {
    expect(sessionCounts(session({ pending: 2, added: 2, awaiting: 1 }))).toBe("5 jobs: 2 added, 2 getting details, 1 awaiting details");
    expect(sessionLine(session())).toMatch(/^Welcome to the Jungle \/ Otta · .+ · 5 jobs: 5 added$/);
    expect(sessionHeading(session({ inProgress: true }))).toMatch(/^Current capture: Welcome to the Jungle \/ Otta, /);
    expect(capturedJobsPath("00000000-0000-4000-8000-000000000001")).toBe("/extension/jobs?session=00000000-0000-4000-8000-000000000001");
    expect(capturedJobsPath()).toBe("/extension/jobs");
  });

  it("says which of a capture's jobs an earlier capture had already saved", () => {
    expect(sessionCounts(session({ jobs: 10, added: 10, alreadySaved: 3 }))).toBe("10 jobs: 10 added (3 already saved before)");
    // An older server reports no such count.
    expect(sessionCounts(session({ jobs: 10, added: 10 }))).toBe("10 jobs: 10 added");
    expect(sessionJobDetail({ company: "Northwind", statusText: "Added; held for review before evaluation", savedBefore: true })).toBe(
      " · Northwind — Added; held for review before evaluation · already saved before this capture",
    );
    expect(sessionJobDetail({ company: null, statusText: "Getting details" })).toBe(" — Getting details");
  });
});

describe("triage at single-job save, as reported", () => {
  it("states the outcome, or that triage could not run, never inventing one", () => {
    expect(triageLine(undefined)).toBeNull();
    expect(triageLine({ status: "NO_PROFILE" })).toBe("Pre-evaluator triage was not run: AI Job Assistant has no active profile yet. The job is saved.");
    expect(triageLine({ status: "UNAVAILABLE", reason: "TRIAGE_FAILED" })).toMatch(/could not be run.*saved/);
    expect(triageLine({ status: "ASSESSED", outcome: "EVALUATE", reasons: [] })).toMatch(/^Pre-evaluator triage: Evaluate\./);
    expect(triageLine({ status: "ASSESSED", outcome: "NEEDS_REVIEW", reasons: ["The salary is not stated."] })).toBe(
      "Pre-evaluator triage: Needs Review before evaluation. The salary is not stated. Decide on the job's page in AI Job Assistant.",
    );
    expect(triageLine({ status: "ASSESSED", outcome: "REJECT", reasons: ["The salary is below your floor."] })).toBe("Pre-evaluator triage: Rejected before evaluation. The salary is below your floor.");
  });

  it("keeps the save message as before; triage is its own line", () => {
    const base = { outcome: "CREATED" as const, decision: null, opportunityId: "o", opportunityUrl: "/opportunities/o", site: { host: "a.example", name: "a.example", knownHost: true }, sourceCategory: "JOB_BOARD", probableDuplicate: false, outsideRoleFamilies: false, evaluation: null };
    expect(captureMessage(base)).toBe("Saved as a new opportunity.");
    expect(captureMessage({ ...base, triage: { status: "NO_PROFILE" } })).toBe("Saved as a new opportunity.");
  });

  it("maps the service's assessment to the extension's view, with the effective outcome and reasons", () => {
    expect(captureTriageFrom({ status: "NO_PROFILE" })).toEqual({ status: "NO_PROFILE" });
    expect(
      captureTriageFrom({
        status: "ASSESSED",
        triage: { outcome: "NEEDS_REVIEW", automaticOutcome: "NEEDS_REVIEW", reasons: [{ code: "SALARY_UNKNOWN", fields: ["salary"], disposition: "NEEDS_REVIEW", message: "The salary is not stated." }] } as never,
      }),
    ).toEqual({ status: "ASSESSED", outcome: "NEEDS_REVIEW", reasons: ["The salary is not stated."] });
  });

  it("never fails a save because triage failed, and runs no triage when none is configured", async () => {
    const ingest = vi.fn(async () => ({ outcome: "CREATED" as const, decision: null, opportunityId: "00000000-0000-4000-8000-0000000000aa", sourceRecordId: "s" }));
    const body = { schemaVersion: 1, pageUrl: "https://jobs.example.com/a", extractor: "main-content", capturedAt: new Date().toISOString(), extensionVersion: "0.3.0", fields: { title: "CSM", description: "Own onboarding and adoption for customers." } };
    const pairing = { id: "1b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e", label: "Chrome", tokenHint: "abcd", createdAt: new Date(), lastUsedAt: null, revokedAt: null };
    const failing = createExtensionCaptureService({ ingestion: { ingest } as never, lookup: { findCapturedPage: vi.fn() }, latestEvaluation: vi.fn(async () => null), triage: vi.fn(async () => { throw new Error("boom"); }), discovery: customerSuccessDiscoveryConfiguration });
    expect((await failing.capture(body, pairing)).result.triage).toEqual({ status: "UNAVAILABLE", reason: "TRIAGE_FAILED" });
    const none = createExtensionCaptureService({ ingestion: { ingest } as never, lookup: { findCapturedPage: vi.fn() }, latestEvaluation: vi.fn(async () => null), discovery: customerSuccessDiscoveryConfiguration });
    expect((await none.capture(body, pairing)).result).not.toHaveProperty("triage");
  });

  it("words a batch job saved while no profile is active as not triaged, not as a refusal", () => {
    const row = { triageOutcome: null, triageManualDecision: null, evaluationStatus: null, recommendation: null };
    expect(addedStateText({ ...row, handoffOutcome: "FAILED:USER_PROFILE_NOT_FOUND" })).toBe("Added; not triaged yet: no active profile");
    expect(addedStateText({ ...row, handoffOutcome: "FAILED:CUSTOMER_SUCCESS_CONFIGURATION_INVALID" })).toBe("Added; not triaged yet: the active profile's preferences are incomplete");
    expect(addedStateText({ ...row, handoffOutcome: "FAILED:DUPLICATE_LISTING_ALREADY_EVALUATED" })).toBe("Added; the evaluation request was not accepted");
  });
});

describe("the dashboard", () => {
  it("calls the lifecycle view Pre-Evaluation Review (its URL stays) and links the Needs Review queue", () => {
    expect(opportunityViews.triage.label).toBe("Pre-Evaluation Review");
    const summary = { activeNotEvaluated: 0, triageRecommendedApply: 0, deferred: 0, activeFailed: 0, queued: 0, running: 0, followUpsDue: 0 } as never;
    const markup = renderToStaticMarkup(<NeedsAttention summary={summary} needsReview={3} />);
    expect(markup).toContain(`aria-label="Needs Review before evaluation: 3" href="${needsReviewLink}"`);
    expect(needsReviewLink).toBe("/budget#pre-evaluator-review");
    expect(renderToStaticMarkup(<NeedsAttention summary={summary} />)).not.toContain("Needs Review before evaluation");
  });
});

describe("Setup & Connection", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fetchMock.mockReset();
    router.refresh.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const pairing = { id: "00000000-0000-4000-8000-0000000000b1", label: "Alex ChromeB1", tokenHint: "abcd", createdAt: "2026-11-04T12:00:00.000Z", lastUsedAt: "2026-11-05T09:00:00.000Z", revokedAt: null, extensionVersion: "0.2.0" };
  const other = { ...pairing, id: "00000000-0000-4000-8000-0000000000b2", label: "Laptop" };

  it("revokes one named pairing only after an explicit confirmation, keeping captured jobs", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ pairing: { ...pairing, revokedAt: "2026-11-05T10:00:00.000Z" } }), { status: 200 }));
    await act(async () => root.render(<PairingsManager pairings={[pairing, other]} currentVersion="0.3.0" />));
    const card = [...container.querySelectorAll("section.source-card")].find((node) => node.textContent?.includes("Alex ChromeB1"))!;
    const unpair = [...card.querySelectorAll("button")].find((button) => button.textContent === "Unpair / Revoke Access")!;
    await act(async () => unpair.click());
    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = card.querySelector('[role="group"]')!;
    expect(confirm.getAttribute("aria-label")).toBe("Confirm unpairing Alex ChromeB1");
    expect(confirm.textContent).toContain("Jobs already captured and your capture history are kept.");
    await act(async () => [...confirm.querySelectorAll("button")].find((button) => button.textContent === "Unpair / Revoke Access")!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/extension/pairings/${pairing.id}/revoke`, expect.objectContaining({ method: "POST" }));
    // Never "simulate".
    expect(container.textContent).not.toMatch(/simulat/i);
  });

  it("offers Cancel instead of revoking, and shows each pairing's last reported version", async () => {
    await act(async () => root.render(<PairingsManager pairings={[pairing]} currentVersion="0.3.0" />));
    expect(container.textContent).toContain("extension version 0.2.0");
    expect(container.textContent).toContain("This browser last reported version 0.2.0; this app ships 0.3.0.");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Unpair / Revoke Access")!.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click());
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Pair New Extension");
  });

  it("derives the supported sites and modes from the registry and the server's settings", () => {
    const rows = supportedSites({});
    expect(rows.find((row) => row.site === "LinkedIn")).toEqual({ site: "LinkedIn", single: "Yes, on a job's own page", batch: "Yes; details read automatically by the app" });
    expect(rows.find((row) => row.site === "Welcome to the Jungle / Otta")).toMatchObject({ batch: "Not available yet (pending live acceptance)" });
    expect(supportedSites({ PAGE_CAPTURE_ACCEPTANCE_SITES: "welcome-to-the-jungle" }).find((row) => row.site === "Welcome to the Jungle / Otta")).toMatchObject({
      batch: "Enabled for acceptance testing; details read in background tabs of your browser",
    });
    expect(rows.at(-1)).toEqual({ site: "Any other job site", single: "Yes (saved as a lower-priority source)", batch: "No" });
    expect(rows.some((row) => row.site.includes("Test"))).toBe(false);
    expect(shippedExtensionVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names the two Extension destinations, marking the current one", () => {
    const markup = renderToStaticMarkup(<ExtensionNav current="jobs" />);
    expect(markup).toContain('href="/extension"');
    expect(markup).toContain(">Setup &amp; Connection<");
    expect(markup).toContain('aria-current="page">Captured Jobs<');
  });
});

describe("Captured Jobs", () => {
  it("shows how and when each job was captured, single-job rows without retry", () => {
    const base = { id: "x", site: "linkedin", siteName: "LinkedIn", title: "CSM", company: null, location: null, postedText: null, sourceUrl: "https://www.linkedin.com/jobs/view/1", firstSeenAt: "2026-11-05T12:00:00.000Z", lastReason: null, resolvedOpportunityId: "00000000-0000-4000-8000-0000000000c1", opportunityTitle: "CSM", triageOutcome: null, triageManualDecision: null, evaluationStatus: null, recommendation: null, handoffOutcome: null };
    const markup = renderToStaticMarkup(
      <PageCaptureTable
        rows={[
          { ...base, status: "INGESTED", method: "single", capturedAt: "2026-11-05T12:00:00.000Z", retryable: false },
          { ...base, id: "y", status: "QUEUED", method: "batch", capturedAt: "2026-11-05T11:00:00.000Z" },
        ]}
      />,
    );
    expect(markup).toContain(">Captured<");
    expect(markup).toContain("Single job");
    expect(markup).toContain("Results page");
  });

  it("shows a job captured both ways once, with both methods, and marks jobs saved before a capture", () => {
    expect(captureMethodText({ method: "batch", alsoSingle: true })).toBe("Results page and single job");
    expect(captureMethodText({ method: "batch", alsoSingle: false })).toBe("Results page");
    expect(captureMethodText({ method: "single" })).toBe("Single job");
    expect(captureMethodText({})).toBe("—");
    const base = { id: "x", site: "linkedin", siteName: "LinkedIn", title: "CSM", company: null, location: null, postedText: null, sourceUrl: "https://www.linkedin.com/jobs/view/1", firstSeenAt: "2026-11-05T12:00:00.000Z", lastReason: null, resolvedOpportunityId: "00000000-0000-4000-8000-0000000000c1", opportunityTitle: "CSM", triageOutcome: null, triageManualDecision: null, evaluationStatus: null, recommendation: null, handoffOutcome: null };
    const markup = renderToStaticMarkup(
      <PageCaptureTable rows={[{ ...base, status: "INGESTED", method: "batch", alsoSingle: true, savedBefore: true, capturedAt: "2026-11-05T12:00:00.000Z" }]} />,
    );
    expect(markup).toContain("Results page and single job");
    expect(markup).toContain("Already saved before this capture");
  });
});
