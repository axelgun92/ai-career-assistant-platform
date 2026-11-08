// Persistent diagnostics and opt-in page evidence for the Mode B retrieval
// worker (November 6, 2026). The November 5 LinkedIn round left one console
// line (the P2028 code) and no page: the sixth job's identity (TENEX.AI,
// LinkedIn 4372638963) had to be reconstructed from the database, and the
// failing transaction could not be proven. These tests show what the next
// failure leaves behind: a structured, sanitized, crash-safe event file, the
// page as read (only when asked for), and the employer apply link read from
// the page LinkedIn sent when its scripts removed it from the rendered one.
// Offline: temporary folders, fakes for the repository, browser and ingestion.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { PageCaptureItemRecord } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { assembleDiagnosticsPackage, parsePackageArguments, packageDatabaseProblem } from "../../apps/web/src/server/diagnostics-package";
import { cleanDiagnostics, parseCleanupArguments } from "../../apps/web/src/server/diagnostics-cleanup-cli";
import { createPageCaptureAcquisition } from "../../apps/web/src/server/page-capture-acquisition";
import { applyEvidence, createPageCaptureEvidence } from "../../apps/web/src/server/page-capture-evidence";
import { runRetrievalWorkerLoop } from "../../apps/web/src/server/retrieval-worker";
import {
  createWorkerDiagnostics,
  diagnosticsDirectoryProblem,
  diagnosticUrl,
  gitHead,
  redactSecrets,
  removeEvidenceSessions,
  sanitizeMessage,
  workerDiagnosticsFromEnvironment,
} from "../../apps/web/src/server/worker-diagnostics";
import { JSDOM } from "jsdom";
import { linkedInGuestJobPage } from "../support/linkedin-guest-pages";
import { testSiteJobPage } from "../support/page-capture-pages";

const repository = path.resolve(__dirname, "../..");
const folders: string[] = [];
const temporary = () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "aija-diagnostics-test-"));
  folders.push(folder);
  return folder;
};
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const mode = (file: string) => statSync(file).mode & 0o777;
const readEvents = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown> & { event: string });

const now = new Date("2026-11-06T15:00:00.000Z");
const prismaError = (code: string, message: string) => Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code });
// Prisma's fixed P2028 text, with something secret appended to prove it is never written.
const expired = () =>
  Object.assign(
    prismaError(
      "P2028",
      "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 30000 ms, however 31234 ms passed since the start of the transaction. postgresql://aija:hunter2@db.internal:5432/acceptance password=hunter2",
    ),
    { captureTransaction: "ingestRetrievedListing" },
  );

describe("the diagnostics file", () => {
  it("removes credentials, tokens, cookies and connection secrets from any message it keeps, and bounds it", () => {
    const message = sanitizeMessage(
      "connect postgresql://aija:hunter2@db.internal:5432/x failed; password=hunter2 token: abc123 Cookie=li_at=AQEDAT Authorization: Bearer eyJhbGciOi.payload.sig session=s3cr3t jsessionid=\"ajax:123\"",
    )!;
    for (const secret of ["hunter2", "abc123", "AQEDAT", "eyJhbGciOi", "s3cr3t", "ajax:123"]) expect(message).not.toContain(secret);
    expect(message).toContain("postgresql://<redacted>@db.internal");
    expect(sanitizeMessage("x".repeat(5_000))!.length).toBe(600);
    expect(sanitizeMessage("   ")).toBeUndefined();
  });

  it("is never kept in the repository or anywhere inside it", () => {
    expect(diagnosticsDirectoryProblem(repository, repository)).toBe("must be outside the repository");
    expect(diagnosticsDirectoryProblem(path.join(repository, "tmp", "logs"), repository)).toBe("must be outside the repository");
    expect(diagnosticsDirectoryProblem(path.join(os.tmpdir(), "aija"), repository)).toBeNull();
    const warnings: string[] = [];
    const diagnostics = createWorkerDiagnostics({ directory: path.join(repository, "diagnostics"), warn: (line) => warnings.push(line) });
    expect(diagnostics.file).toBeNull();
    diagnostics.event("worker.start");
    expect(warnings[0]).toContain("must be outside the repository");
  });

  it("writes one owner-only JSON line per event, with ids, decisions, the error's whitelisted fields and a sanitized message", () => {
    const root = temporary();
    const diagnostics = createWorkerDiagnostics({ directory: root, sessionId: "s-1", now: () => now });
    diagnostics.event("job.failed", { itemId: "i-6", listingId: "4372638963", stage: "ingest", decision: "DB_PENDING_PROVISIONAL", error: expired(), at: now });
    const file = path.join(root, "logs", "retrieval-worker-2026-11-06.jsonl");
    expect(diagnostics.file).toBe(file);
    expect(mode(path.join(root, "logs"))).toBe(0o700);
    expect(mode(file)).toBe(0o600);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("hunter2");
    const [event] = readEvents(file);
    expect(event).toMatchObject({
      session: "s-1",
      pid: process.pid,
      event: "job.failed",
      itemId: "i-6",
      listingId: "4372638963",
      stage: "ingest",
      decision: "DB_PENDING_PROVISIONAL",
      error: { prismaCode: "P2028", transactionError: "expired", timeoutMs: "30000", elapsedMs: "31234", transaction: "ingestRetrievedListing" },
    });
    expect((event!.error as { message: string }).message).toContain("expired transaction");
  });

  it("removes its own files past the retention period at start, and nothing else", () => {
    const root = temporary();
    const logs = path.join(root, "logs");
    mkdirSync(logs, { recursive: true });
    const old = path.join(logs, "retrieval-worker-2026-09-01.jsonl");
    const recent = path.join(logs, "retrieval-worker-2026-11-01.jsonl");
    const other = path.join(logs, "notes.txt");
    for (const file of [old, recent, other]) writeFileSync(file, "x\n");
    const at = (iso: string) => new Date(iso).getTime() / 1000;
    utimesSync(old, at("2026-09-01T00:00:00Z"), at("2026-09-01T00:00:00Z"));
    utimesSync(other, at("2026-09-01T00:00:00Z"), at("2026-09-01T00:00:00Z"));
    createWorkerDiagnostics({ directory: root, retentionDays: 30, now: () => now });
    expect(readdirSync(logs).sort()).toEqual(["notes.txt", "retrieval-worker-2026-11-01.jsonl"]);
  });

  it("never stops the worker when it cannot write, and is off when RETRIEVAL_WORKER_LOG_DIR=off", () => {
    const root = temporary();
    writeFileSync(path.join(root, "logs"), "a file where the folder should be");
    const warnings: string[] = [];
    const diagnostics = createWorkerDiagnostics({ directory: root, warn: (line) => warnings.push(line) });
    expect(() => diagnostics.event("worker.start")).not.toThrow();
    expect(warnings).toEqual(["the diagnostics directory could not be prepared; persistent diagnostics are off"]);
    expect(workerDiagnosticsFromEnvironment({ RETRIEVAL_WORKER_LOG_DIR: "off" }).file).toBeNull();
    const other = temporary();
    expect(workerDiagnosticsFromEnvironment({ RETRIEVAL_WORKER_LOG_DIR: other }).file).toContain(path.join(other, "logs"));
  });

  it("keeps every event written before the process crashed or was killed", () => {
    const root = temporary();
    const script = path.join(temporary(), "crash.ts");
    const module = path.join(repository, "apps/web/src/server/worker-diagnostics.ts");
    writeFileSync(
      script,
      [
        `import { createWorkerDiagnostics } from ${JSON.stringify(module)};`,
        `const diagnostics = createWorkerDiagnostics({ directory: ${JSON.stringify(root)}, sessionId: "crash" });`,
        `process.on("uncaughtException", (error) => { diagnostics.event("worker.crash", { kind: "uncaughtException", error }); process.exit(1); });`,
        `diagnostics.event("job.read", { itemId: "i-6" });`,
        `if (process.argv[2] === "kill") process.kill(process.pid, "SIGKILL");`,
        `throw Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), { name: "PrismaClientKnownRequestError", code: "P2028" });`,
      ].join("\n"),
    );
    const tsx = path.join(repository, "node_modules/.bin/tsx");
    // Run from an unrelated folder: the file is refused inside the working directory.
    const cwd = temporary();
    const crashed = spawnSync(tsx, [script], { cwd, encoding: "utf8" });
    expect(crashed.status).toBe(1);
    const killed = spawnSync(tsx, [script, "kill"], { cwd, encoding: "utf8" });
    expect(killed.signal ?? killed.status).toBeTruthy();
    const logs = path.join(root, "logs");
    const events = readEvents(path.join(logs, readdirSync(logs)[0]!));
    expect(events.map((event) => event.event)).toEqual(["job.read", "worker.crash", "job.read"]);
    expect(events[1]).toMatchObject({ kind: "uncaughtException", error: { prismaCode: "P2028", transactionError: "start-timeout" } });
  });

  it("names the checked-out commit without running git", () => {
    const head = gitHead(repository);
    expect(head.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("the worker loop's events", () => {
  it("records the lock, recovery, each transient back-off with its next retry, and the fatal exit", async () => {
    const events: Array<{ name: string; fields?: Record<string, unknown> }> = [];
    let calls = 0;
    const code = await runRetrievalWorkerLoop({
      worker: {
        recover: async () => 0,
        runOnce: async () => {
          calls += 1;
          if (calls === 1) throw prismaError("P2028", "Transaction API error: Unable to start a transaction in the given time.");
          throw prismaError("P2000", "The provided value for the column is too long");
        },
      },
      lock: { isHeld: () => true, acquire: async () => true },
      sleep: async () => undefined,
      shouldStop: () => false,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      pollMs: 1_000,
      events: { event: (name, fields) => events.push({ name, ...(fields ? { fields } : {}) }) },
    });
    expect(code).toBe(1);
    expect(events.map((event) => event.name)).toEqual(["worker.recovery", "worker.transient", "worker.fatal"]);
    expect(events[1]!.fields).toMatchObject({ classification: "transient", attempt: 1, delayMs: 2_000, decision: "BACKOFF_KEEP_LOCK" });
    expect(events[1]!.fields!.nextRetryAt).toBeInstanceOf(Date);
    expect(events[2]!.fields).toMatchObject({ classification: "fatal", decision: "EXIT" });
  });
});

// ----------------------------------------------------------- page evidence

const parseRunnable = (html: string, url: string) => new JSDOM(html, { url }).window.document;
const tenex = "4372638963";
const employerApply = "https://jobs.tenex.ai/careers/42?source=linkedin";
const applyCode = `<code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/${tenex}?url=${encodeURIComponent(employerApply)}&urlHash=Ab1c"--></code>`;
const tenexPage = (withApplyCode: boolean) =>
  linkedInGuestJobPage({
    id: tenex,
    title: "Customer Success Manager",
    company: "TENEX.AI",
    location: "United States",
    descriptionHtml: "<p>Customer Success Manager for a security operations platform.</p><p>Own onboarding, adoption and renewals for enterprise customers.</p>",
  }).replace("</main>", `${withApplyCode ? applyCode : ""}<button class="sign-up-modal__outlet top-card-layout__cta" data-tracking-control-name="public_jobs_apply-link-offsite_sign-up-modal">Apply</button></main>`);

describe("page evidence (opt-in)", () => {
  it("summarizes where a page says to apply: the apply code, apply links and apply buttons", () => {
    const evidence = applyEvidence(parseRunnable(tenexPage(true), `https://www.linkedin.com/jobs/view/${tenex}`));
    expect(evidence.codeApplyUrl).toEqual({ present: true, url: employerApply });
    expect(evidence.buttons).toEqual([{ text: "Apply", tracking: "public_jobs_apply-link-offsite_sign-up-modal", className: "sign-up-modal__outlet top-card-layout__cta" }]);
    expect(applyEvidence(parseRunnable(tenexPage(false), "https://www.linkedin.com/")).codeApplyUrl).toEqual({ present: false, url: null });
  });

  it("is off unless a folder is named, refuses the repository, and keeps owner-only files per worker session with retention", () => {
    expect(createPageCaptureEvidence({ directory: undefined, sessionId: "s" }).directory).toBeNull();
    const warnings: string[] = [];
    expect(createPageCaptureEvidence({ directory: path.join(repository, "evidence"), sessionId: "s", warn: (line) => warnings.push(line) }).directory).toBeNull();
    expect(warnings[0]).toContain("must be outside the repository");

    const root = temporary();
    const expiredSession = path.join(root, "11111111-1111-4111-8111-111111111111");
    const unrelated = path.join(root, "keep-me");
    mkdirSync(expiredSession);
    mkdirSync(unrelated);
    const old = new Date("2026-10-01T00:00:00Z").getTime() / 1000;
    utimesSync(expiredSession, old, old);
    utimesSync(unrelated, old, old);
    const session = "22222222-2222-4222-8222-222222222222";
    const evidence = createPageCaptureEvidence({ directory: root, sessionId: session, retentionDays: 7, now: () => now });
    expect(readdirSync(root).sort()).toEqual([session, "keep-me"]);
    expect(mode(root)).toBe(0o700);
    evidence.record({ site: "linkedin", itemId: "i-6", listingId: tenex, batchId: "b", url: "u", html: "<html>rendered</html>", servedHtml: "<html>served</html>", outcome: "READ" });
    const folder = path.join(root, session);
    expect(readdirSync(folder).sort()).toEqual(["i-6.json", "i-6.rendered.html", "i-6.served.html"]);
    for (const file of readdirSync(folder)) expect(mode(path.join(folder, file))).toBe(0o600);
    const summary = JSON.parse(readFileSync(path.join(folder, "i-6.json"), "utf8")) as Record<string, unknown>;
    expect(summary).toMatchObject({ listingId: tenex, outcome: "READ", renderedHtmlSaved: true, servedHtmlSaved: true });
    expect(summary).not.toHaveProperty("html");
  });
});

// ------------------------------------------------- the acquisition pass

const item = (id: string, site: "linkedin" | "e2e-results", overrides: Partial<PageCaptureItemRecord> = {}): PageCaptureItemRecord => ({
  id,
  site,
  host: site === "linkedin" ? "www.linkedin.com" : "jobs.e2e.invalid",
  externalId: `${site}:${id}`,
  sourceUrl: site === "linkedin" ? `https://www.linkedin.com/jobs/view/${id}` : `https://jobs.e2e.invalid/jobs/${id}`,
  siteJobId: id,
  title: `Customer Success Manager ${id}`,
  company: null,
  location: null,
  postedText: null,
  resultsPageUrl: "https://www.linkedin.com/jobs/search",
  firstSeenAt: now,
  lastSeenAt: now,
  sightings: 1,
  lastBatchId: "33333333-3333-4333-8333-333333333333",
  pairingId: "p",
  status: "QUEUED",
  attempts: 0,
  lastAttemptAt: null,
  nextAttemptAt: null,
  lastReason: null,
  opportunityId: null,
  handoffOutcome: null,
  handedOffAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

// An in-memory queue applying the repository's state rules (as in
// page-capture-db-failures.test.ts), with diagnostics and evidence attached.
function setup(input: {
  site: "linkedin" | "e2e-results";
  ids: string[];
  serve: (id: string) => { status: number; html: string; servedHtml?: string };
  ingest?: (id: string) => Error | null;
  rows?: Map<string, PageCaptureItemRecord>;
  diagnosticsRoot: string;
  evidenceRoot?: string;
  sessionId?: string;
}) {
  const rows = input.rows ?? new Map(input.ids.map((id) => [id, item(id, input.site)]));
  const due = (row: PageCaptureItemRecord) => row.status === "QUEUED" && (!row.nextAttemptAt || row.nextAttemptAt <= now);
  const repository = {
    recoverInterrupted: vi.fn(async () => {
      let count = 0;
      for (const row of rows.values()) if (row.status === "ACQUIRING") (row.status = "QUEUED"), (count += 1);
      return count;
    }),
    sitesWithQueued: vi.fn(async () => ([...rows.values()].some(due) ? [input.site] : [])),
    siteStoppedUntil: vi.fn(async () => null),
    claimQueued: vi.fn(async () => {
      const claimed = [...rows.values()].filter(due);
      for (const row of claimed) row.status = "ACQUIRING";
      return claimed.map((row) => ({ ...row }));
    }),
    markIngested: vi.fn(async (id: string, opportunityId: string) => {
      const row = rows.get(id)!;
      Object.assign(row, { status: "INGESTED", opportunityId, lastReason: null, nextAttemptAt: null, attempts: row.attempts + 1 });
    }),
    markFailed: vi.fn(async (id: string, change: { status: PageCaptureItemRecord["status"]; reason: string; nextAttemptAt: Date | null; countAttempt: boolean }) => {
      const row = rows.get(id)!;
      Object.assign(row, { status: change.status, lastReason: change.reason, nextAttemptAt: change.nextAttemptAt, attempts: row.attempts + (change.countAttempt ? 1 : 0) });
    }),
    deferSite: vi.fn(async () => undefined),
    markHandedOff: vi.fn(async (id: string, outcome: string) => {
      rows.get(id)!.handoffOutcome = outcome;
    }),
    requeueUncounted: vi.fn(async (id: string, reason: string) => {
      const row = rows.get(id)!;
      if (row.status !== "ACQUIRING" && row.status !== "QUEUED") return false;
      Object.assign(row, { status: "QUEUED", nextAttemptAt: null, lastReason: reason });
      return true;
    }),
    releaseClaimed: vi.fn(async (ids: string[]) => {
      let count = 0;
      for (const id of ids) if (rows.get(id)?.status === "ACQUIRING") (rows.get(id)!.status = "QUEUED"), (count += 1);
      return count;
    }),
    finalizeProvisionalFailure: vi.fn(async (id: string, options: { now: Date; retryAfterMs: number; maxAttempts: number }) => {
      const row = rows.get(id)!;
      if (row.status !== "QUEUED" || row.lastReason !== "DB_PENDING") return false;
      Object.assign(row, { attempts: row.attempts + 1, lastReason: "INGEST_DB_ERROR", nextAttemptAt: new Date(options.now.getTime() + options.retryAfterMs) });
      return true;
    }),
  };
  const raws: Array<Record<string, unknown>> = [];
  let opportunities = 0;
  const ingest = vi.fn(async (raw: Record<string, unknown>) => {
    const id = String(raw.externalId).split(/[/:]/).pop()!;
    const error = input.ingest?.(id) ?? null;
    if (error) throw error;
    raws.push(raw);
    opportunities += 1;
    return { outcome: "CREATED" as const, opportunityId: `0000${String(opportunities).padStart(4, "0")}-0000-4000-8000-000000000000`, sourceRecordId: "s", decision: "NO_MATCH" as const };
  });
  const driver: BrowserDriver = {
    async navigate(url) {
      const id = url.split("/").pop()!;
      const served = input.serve(id);
      return { status: served.status, finalUrl: url, html: served.html, cookieNames: [], ...(served.servedHtml ? { servedHtml: served.servedHtml } : {}) };
    },
    close: vi.fn(async () => undefined),
  };
  const diagnostics = createWorkerDiagnostics({ directory: input.diagnosticsRoot, sessionId: input.sessionId ?? "44444444-4444-4444-8444-444444444444", now: () => now });
  const evidence = input.evidenceRoot ? createPageCaptureEvidence({ directory: input.evidenceRoot, sessionId: diagnostics.sessionId, now: () => now }) : undefined;
  const acquisition = createPageCaptureAcquisition({
    repository,
    ingestion: { ingest } as never,
    handoff: { alreadyHandled: vi.fn(async () => false), request: vi.fn(async () => "NO_ACTIVE_PROFILE") },
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => [input.site],
    browser: { launch: async () => driver },
    probeCapture: async () => undefined,
    now: () => now,
    sleep: async () => undefined,
    diagnostics,
    ...(evidence ? { evidence } : {}),
  });
  return { acquisition, rows, raws, events: () => readEvents(diagnostics.file!), evidence };
}

describe("LinkedIn's employer apply link from the page as sent (approved precedence, step 2)", () => {
  it("reads it from the received page when the rendered page no longer has it, and records which route the link took", async () => {
    const evidenceRoot = temporary();
    const { acquisition, raws, events, evidence } = setup({
      site: "linkedin",
      ids: [tenex],
      serve: () => ({ status: 200, html: tenexPage(false), servedHtml: tenexPage(true) }),
      diagnosticsRoot: temporary(),
      evidenceRoot,
    });
    await acquisition.runOnce();
    expect(raws[0]!.applicationUrl).toBe(employerApply);
    expect(events().find((event) => event.event === "job.read")).toMatchObject({ itemId: tenex, listingId: tenex, applicationRoute: "EMPLOYER_LINK_SERVED", servedHtmlAvailable: true });
    const summary = JSON.parse(readFileSync(path.join(evidence!.directory!, `${tenex}.json`), "utf8")) as { apply: Record<string, unknown> };
    expect(summary.apply).toMatchObject({ route: "EMPLOYER_LINK_SERVED", applicationUrl: employerApply, rendered: { codeApplyUrl: { present: false } }, served: { codeApplyUrl: { present: true } } });
  });

  it("keeps the rendered page's own link first, and falls back to the labelled LinkedIn listing when neither page names an employer", async () => {
    const rendered = setup({ site: "linkedin", ids: [tenex], serve: () => ({ status: 200, html: tenexPage(true), servedHtml: tenexPage(true) }), diagnosticsRoot: temporary() });
    await rendered.acquisition.runOnce();
    expect(rendered.raws[0]!.applicationUrl).toBe(employerApply);
    expect(rendered.events().find((event) => event.event === "job.read")).toMatchObject({ applicationRoute: "EMPLOYER_LINK_RENDERED" });

    const neither = setup({ site: "linkedin", ids: [tenex], serve: () => ({ status: 200, html: tenexPage(false), servedHtml: tenexPage(false) }), diagnosticsRoot: temporary() });
    await neither.acquisition.runOnce();
    expect(neither.raws[0]!.applicationUrl).toBe(`https://www.linkedin.com/jobs/view/${tenex}`);
    expect((neither.raws[0]!.sourceMetadata as { sourceFacts: Record<string, unknown> }).sourceFacts.applicationUrlBasis).toBe("LISTING_PAGE_FALLBACK");
    expect(neither.events().find((event) => event.event === "job.read")).toMatchObject({ applicationRoute: "LISTING_FALLBACK" });
  });

  it("LinkedIn's logged-out apply controls as E4 recorded them (Nov 3 pages): a sign-up link is never the application link; the listing fallback is used", async () => {
    // The shapes the five logged-out P1 pages carried: no code#applyUrl, the
    // top-card Apply as a sign-up modal button, and "Apply" links to
    // LinkedIn's sign-up with the job only as the post-sign-up redirect.
    const signUp = `https://www.linkedin.com/signup/cold-join?source=jobs_registration&amp;session_redirect=https%3A%2F%2Fwww.linkedin.com%2Fjobs%2Fview%2Fcustomer-success-manager-at-tenex-ai-${tenex}&amp;trk=public_jobs_apply-link-offsite_contextual-sign-in-modal_join-link`;
    const loggedOut = linkedInGuestJobPage({
      id: tenex,
      title: "Customer Success Manager",
      company: "TENEX.AI",
      location: "United States",
      descriptionHtml: "<p>Customer Success Manager for a security operations platform.</p><p>Own onboarding, adoption and renewals for enterprise customers.</p>",
    }).replace(
      '<h1 class="top-card-layout__title">',
      `<button class="sign-up-modal__outlet top-card-layout__cta top-card-layout__cta--primary btn-md btn-primary" data-tracking-control-name="public_jobs_contextual-sign-in-modal_ssr-ui-lib-outlet-button" data-modal="job-details-subnav-apply-modal" id="topbar-apply">Apply</button><a class="apply-button" href="${signUp}" data-tracking-control-name="public_jobs_apply-link-offsite_contextual-sign-in-modal_join-link">Apply</a><h1 class="top-card-layout__title">`,
    );
    const run = setup({ site: "linkedin", ids: [tenex], serve: () => ({ status: 200, html: loggedOut, servedHtml: loggedOut }), diagnosticsRoot: temporary() });
    await run.acquisition.runOnce();
    expect(run.raws[0]!.applicationUrl).toBe(`https://www.linkedin.com/jobs/view/${tenex}`);
    expect((run.raws[0]!.sourceMetadata as { sourceFacts: Record<string, unknown> }).sourceFacts.applicationUrlBasis).toBe("LISTING_PAGE_FALLBACK");
    expect(run.events().find((event) => event.event === "job.read")).toMatchObject({ applicationRoute: "LISTING_FALLBACK" });
  });
});

// The November 5 batch, offline: 25 LinkedIn jobs in claim order, the sixth
// being TENEX.AI (4372638963).
const batchIds = Array.from({ length: 25 }, (_, index) => (index === 5 ? tenex : String(4372600000 + index)));
const page = (id: string) => ({
  status: 200,
  html: linkedInGuestJobPage({ id, title: "Customer Success Manager", company: id === tenex ? "TENEX.AI" : `Company ${id}`, location: "United States", descriptionHtml: "<p>Customer Success Manager for a SaaS platform; own onboarding, adoption and renewals.</p>" }),
});

describe("the diagnostics a failed batch leaves (the TENEX.AI case)", () => {
  it("localized P2028 on the sixth job: the file names the job, stage, transaction, fixed P2028 form and each decision; 24 ingested", async () => {
    const diagnosticsRoot = temporary();
    const evidenceRoot = temporary();
    const run = setup({ site: "linkedin", ids: batchIds, serve: page, ingest: (id) => (id === tenex ? expired() : null), diagnosticsRoot, evidenceRoot });
    await run.acquisition.runOnce();
    const events = run.events();
    const text = readFileSync(path.join(diagnosticsRoot, "logs", "retrieval-worker-2026-11-06.jsonl"), "utf8");
    expect(text).not.toContain("hunter2");
    expect(events.find((event) => event.event === "pass.start")).toMatchObject({ site: "linkedin", claimed: 25 });
    expect((events.find((event) => event.event === "pass.start")!.jobs as Array<{ listingId: string }>)[5]!.listingId).toBe(tenex);
    expect(events.find((event) => event.event === "job.failed")).toMatchObject({
      itemId: tenex,
      listingId: tenex,
      stage: "ingest",
      failure: "TRANSIENT",
      decision: "DB_PENDING_PROVISIONAL",
      transactionSettings: { maxWait: 15_000, timeout: 30_000, lockTimeoutMs: 20_000 },
      error: { prismaCode: "P2028", transactionError: "expired", timeoutMs: "30000", elapsedMs: "31234", transaction: "ingestRetrievedListing" },
    });
    // The seventh job's success proves the failure was TENEX's own: counted once.
    const sequence = events.filter((event) => ["job.ingested", "job.failed", "job.decision"].includes(event.event)).map((event) => `${event.event}:${event.listingId ?? ""}:${event.decision ?? ""}`);
    expect(sequence.slice(5, 8)).toEqual([`job.failed:${tenex}:DB_PENDING_PROVISIONAL`, `job.ingested:${batchIds[6]}:`, `job.decision:${tenex}:PROVISIONAL_FAILURE_COUNTED`]);
    expect(events.filter((event) => event.event === "job.ingested")).toHaveLength(24);
    expect(events.at(-1)).toMatchObject({ event: "pass.end", ingested: 24, reason: null });
    expect(run.rows.get(tenex)).toMatchObject({ status: "QUEUED", attempts: 1, lastReason: "INGEST_DB_ERROR" });
    // Page evidence for every read job, the sixth included.
    expect(readdirSync(run.evidence!.directory!).filter((file) => file.endsWith(".json"))).toHaveLength(25);
  });

  it("broader outage: the sixth and seventh both fail; nothing counted, the pass ends with 18 unread queued again, and the restart completes", async () => {
    const diagnosticsRoot = temporary();
    let down = true;
    const run = setup({ site: "linkedin", ids: batchIds, serve: page, ingest: (id) => (down && (id === tenex || id === batchIds[6]) ? expired() : null), diagnosticsRoot });
    await run.acquisition.runOnce();
    let events = run.events();
    expect(events.filter((event) => event.event === "job.failed").map((event) => event.decision)).toEqual(["DB_PENDING_PROVISIONAL", "DB_PENDING_SECOND_IN_A_ROW_OUTAGE"]);
    expect(events.find((event) => event.event === "pass.decision")).toMatchObject({ decision: "DATABASE_UNAVAILABLE", unreadJobsQueuedAgain: 18 });
    expect(events.find((event) => event.event === "pass.end")).toMatchObject({ ingested: 5, stopped: "DATABASE_UNAVAILABLE" });
    expect([run.rows.get(tenex)!.attempts, run.rows.get(batchIds[6]!)!.attempts]).toEqual([0, 0]);
    // Database back; the next pass (after recovery) reads the remaining 20.
    down = false;
    await run.acquisition.runOnce();
    events = run.events();
    expect(events.filter((event) => event.event === "recovery")).toHaveLength(2);
    expect(events.filter((event) => event.event === "job.ingested")).toHaveLength(25);
    expect([...run.rows.values()].every((row) => row.status === "INGESTED")).toBe(true);
  });

  it("a worker killed after the sixth job's provisional failure: the restarted worker's file records the recovery and the batch completes uncounted", async () => {
    const diagnosticsRoot = temporary();
    const rows = new Map(batchIds.map((id, index) => [id, item(id, "linkedin", index < 5 ? { status: "INGESTED", attempts: 1 } : index === 5 ? { lastReason: "DB_PENDING" } : { status: "ACQUIRING" })]));
    const restarted = setup({ site: "linkedin", ids: batchIds, serve: page, rows, diagnosticsRoot, sessionId: "55555555-5555-4555-8555-555555555555" });
    await restarted.acquisition.runOnce();
    const events = restarted.events();
    expect(events[0]).toMatchObject({ event: "recovery", interruptedJobsQueuedAgain: 19, session: "55555555-5555-4555-8555-555555555555" });
    expect(events.filter((event) => event.event === "job.ingested")).toHaveLength(20);
    expect(rows.get(tenex)).toMatchObject({ status: "INGESTED", attempts: 1, lastReason: null });
  });

  it("an unreadable page and a gone listing are recorded with their stage, decision and the page kept as evidence", async () => {
    const evidenceRoot = temporary();
    const run = setup({
      site: "e2e-results",
      ids: ["gone", "blank"],
      serve: (id) => (id === "gone" ? { status: 404, html: "<html><body>Not found</body></html>" } : { status: 200, html: "<html><body><p>Loading…</p></body></html>" }),
      diagnosticsRoot: temporary(),
      evidenceRoot,
    });
    await run.acquisition.runOnce();
    const events = run.events();
    expect(events.find((event) => event.itemId === "gone" && event.event === "job.decision")).toMatchObject({ stage: "navigate", decision: "UNAVAILABLE", status: 404 });
    expect(events.find((event) => event.itemId === "blank" && event.event === "job.read")).toMatchObject({ posting: false, fieldsMissing: expect.arrayContaining(["title", "description"]) });
    expect(events.find((event) => event.itemId === "blank" && event.event === "job.decision")).toMatchObject({ decision: "ATTEMPT_COUNTED", reason: "UNREADABLE", attempts: 1 });
    const directory = run.evidence!.directory!;
    expect(readdirSync(directory).sort()).toEqual(["blank.json", "blank.rendered.html", "gone.json", "gone.rendered.html"]);
    expect(JSON.parse(readFileSync(path.join(directory, "blank.json"), "utf8"))).toMatchObject({ outcome: "UNREADABLE", fields: { observed: [] } });
    expect(testSiteJobPage({ id: "x" })).toBeTruthy();
  });
});

describe("the failure evidence package's safety checks", () => {
  const url = (name: string) => `postgresql://u:p@localhost:5432/${name}?schema=public`;
  it("reads only the named test or acceptance database, never the normal application database", () => {
    expect(packageDatabaseProblem("ai_career_assistant_test", url("ai_career_assistant_test"))).toBeNull();
    expect(packageDatabaseProblem("ai_career_assistant_acceptance", url("ai_career_assistant_acceptance"))).toBeNull();
    expect(packageDatabaseProblem("ai_career_assistant", url("ai_career_assistant"))).toContain("not a test or acceptance database");
    expect(packageDatabaseProblem("ai_career_assistant_test", url("ai_career_assistant"))).toContain('points to database "ai_career_assistant"');
    expect(packageDatabaseProblem("x", undefined)).toBe("DATABASE_URL is not set");
  });

  it("writes only to a new or empty folder outside the repository", () => {
    const environment = { DATABASE_URL: url("ai_career_assistant_test") };
    const base = ["--database", "ai_career_assistant_test", "--latest"];
    expect(parsePackageArguments([...base, "--out", path.join(repository, "evidence")], environment, repository)).toEqual({ ok: false, problem: "--out must be outside the repository" });
    const used = temporary();
    writeFileSync(path.join(used, "x"), "x");
    expect(parsePackageArguments([...base, "--out", used], environment, repository)).toEqual({ ok: false, problem: "--out must be a new or empty folder" });
    expect(parsePackageArguments(["--database", "ai_career_assistant_test", "--out", path.join(temporary(), "p")], environment, repository)).toEqual({ ok: false, problem: "Give exactly one of --capture-session <id> or --latest" });
    const parsed = parsePackageArguments([...base, "--site", "linkedin", "--out", path.join(temporary(), "p")], environment, repository);
    expect(parsed).toMatchObject({ ok: true, value: { captureSession: "latest", site: "linkedin", databaseLabel: "ai_career_assistant_test on localhost:5432" } });
  });
});

// ------------------------------------------------ security of the artifacts

describe("diagnostic artifacts stay private (security review, November 6, 2026)", () => {
  it("refuse any folder inside a Git checkout, through symbolic links and from any working folder", () => {
    // Started from a subfolder (apps/web), the repository root is still refused.
    expect(diagnosticsDirectoryProblem(path.join(repository, "evidence"), path.join(repository, "apps/web"))).toBe("must be outside the repository");
    // Any other checkout too (e.g. a historical acceptance checkout).
    const other = temporary();
    mkdirSync(path.join(other, ".git"));
    expect(diagnosticsDirectoryProblem(path.join(other, "notes", "evidence"), repository)).toBe("must be outside the repository");
    // A link that leads into the repository.
    const link = path.join(temporary(), "looks-outside");
    symlinkSync(repository, link);
    expect(diagnosticsDirectoryProblem(path.join(link, "evidence"), os.tmpdir())).toBe("must be outside the repository");
    expect(diagnosticsDirectoryProblem(path.join(temporary(), "evidence"), repository)).toBeNull();
  });

  it("redact secrets wherever they appear in kept text, and keep URLs without credentials, query or fragment", () => {
    const text = redactSecrets(
      "PGPASSWORD=hunter2 DATABASE_PASSWORD: 'p4ss' access_token=abc.def refresh-token=xyz key sk-proj-ABCDEFGHIJKLMNOPQRST ghp_ABCDEFGHIJKLMNOPQRSTUVWX jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl",
    );
    for (const secret of ["hunter2", "p4ss", "abc.def", "xyz", "ABCDEFGHIJKLMNOPQRST", "ghp_ABCD", "eyJhbGciOiJIUzI1NiJ9"]) expect(text).not.toContain(secret);
    expect(diagnosticUrl("https://user:pw@www.linkedin.com/jobs/view/4372638963?trk=abc&refId=x#top")).toBe("https://www.linkedin.com/jobs/view/4372638963");
    // Any string field, not only errors, is redacted before it is written.
    const root = temporary();
    const diagnostics = createWorkerDiagnostics({ directory: root, now: () => now });
    diagnostics.event("worker.start", { note: "DATABASE_URL=postgresql://aija:hunter2@db/x" });
    expect(readFileSync(diagnostics.file!, "utf8")).not.toContain("hunter2");
  });

  it("make an existing log file owner-only", () => {
    const root = temporary();
    const logs = path.join(root, "logs");
    mkdirSync(logs, { recursive: true });
    const file = path.join(logs, "retrieval-worker-2026-11-06.jsonl");
    writeFileSync(file, "", { mode: 0o644 });
    chmodSync(file, 0o644);
    createWorkerDiagnostics({ directory: root, now: () => now }).event("worker.start");
    expect(mode(file)).toBe(0o600);
    expect(mode(logs)).toBe(0o700);
  });

  it("make the evidence package owner-only even in an existing folder, with copied page evidence 0600", async () => {
    const out = path.join(temporary(), "package");
    mkdirSync(out, { mode: 0o755 });
    chmodSync(out, 0o755);
    const evidenceRoot = temporary();
    const session = path.join(evidenceRoot, "66666666-6666-4666-8666-666666666666");
    mkdirSync(session);
    const itemId = "77777777-7777-4777-8777-777777777777";
    writeFileSync(path.join(session, `${itemId}.rendered.html`), "<html></html>", { mode: 0o644 });
    chmodSync(path.join(session, `${itemId}.rendered.html`), 0o644);
    const rows: Record<string, unknown[]> = {
      PageCaptureSession: [{ id: "88888888-8888-4888-8888-888888888888", site: "linkedin", receivedAt: now, itemIds: [itemId], counts: {} }],
      PageCaptureItem: [{ id: itemId, externalId: `linkedin:${tenex}`, opportunityId: null, firstSeenAt: now, lastAttemptAt: now, updatedAt: now }],
      SourceRecord: [],
      Opportunity: [],
    };
    const reader = {
      read: <T>(reads: (transaction: { $queryRawUnsafe<R = unknown>(query: string, ...values: unknown[]): Promise<R> }) => Promise<T>) =>
        reads({ $queryRawUnsafe: async <R>(query: string) => (Object.entries(rows).find(([table]) => new RegExp(`FROM "${table}"`).test(query))?.[1] ?? []) as R }),
    };
    await assembleDiagnosticsPackage(
      { connectionString: "x", database: "ai_career_assistant_test", databaseLabel: "test", captureSession: "latest", site: null, out, logsDirectory: null, evidenceDirectory: evidenceRoot, windowMinutes: 60 },
      reader,
      { gitSha: null, gitBranch: null, pageReaderRevision: 1, environmentNames: [], now: () => now },
    );
    expect(mode(out)).toBe(0o700);
    expect(mode(path.join(out, "page-evidence"))).toBe(0o700);
    expect(mode(path.join(out, "page-evidence", path.basename(session), `${itemId}.rendered.html`))).toBe(0o600);
    for (const file of readdirSync(out).filter((name) => name.endsWith(".json"))) expect(mode(path.join(out, file)), file).toBe(0o600);
  });

  it("clean up on demand: expired logs and evidence sessions, or every evidence session; nothing else is touched", () => {
    const logsRoot = temporary();
    const logs = path.join(logsRoot, "logs");
    mkdirSync(logs, { recursive: true });
    const old = new Date("2026-09-01T00:00:00Z").getTime() / 1000;
    for (const name of ["retrieval-worker-2026-09-01.jsonl", "retrieval-worker-2026-11-05.jsonl", "keep.txt"]) writeFileSync(path.join(logs, name), "x");
    utimesSync(path.join(logs, "retrieval-worker-2026-09-01.jsonl"), old, old);
    utimesSync(path.join(logs, "keep.txt"), old, old);
    const evidence = temporary();
    const stale = "99999999-9999-4999-8999-999999999999";
    const fresh = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    for (const name of [stale, fresh, "not-a-session"]) mkdirSync(path.join(evidence, name));
    utimesSync(path.join(evidence, stale), old, old);
    utimesSync(path.join(evidence, "not-a-session"), old, old);

    const parsed = parseCleanupArguments(["--logs-dir", logsRoot, "--evidence-dir", evidence], {});
    expect(parsed).toMatchObject({ ok: true, logDays: 30, evidenceDays: 7, allEvidence: false });
    const result = cleanDiagnostics({ ...(parsed as Extract<typeof parsed, { ok: true }>), now });
    expect(result).toMatchObject({ logs: ["retrieval-worker-2026-09-01.jsonl"], evidence: [stale] });
    expect(readdirSync(logs).sort()).toEqual(["keep.txt", "retrieval-worker-2026-11-05.jsonl"]);
    expect(readdirSync(evidence).sort()).toEqual([fresh, "not-a-session"]);
    expect(removeEvidenceSessions(evidence, { retentionDays: 7, now, all: true })).toEqual([fresh]);
    expect(readdirSync(evidence)).toEqual(["not-a-session"]);
    expect(parseCleanupArguments(["--bogus"], {})).toEqual({ ok: false, problem: "Unknown option --bogus" });
  });
});

// ------------------------------------- what counts as a LinkedIn restriction

describe("a LinkedIn restriction is recorded only on the site's own answer (November 7, 2026 review)", () => {
  const ids = ["4372638963", "4479301564", "4483749069", "4400000004"];
  const ok = (id: string) => ({ status: 200, html: page(id).html });
  it("HTTP 429 is RATE_LIMITED: the status is logged, the job and the rest wait uncounted, the site stops for a day", async () => {
    const run = setup({ site: "linkedin", ids, serve: (id) => (id === ids[3] ? { status: 429, html: "<html><body>Too many requests</body></html>" } : ok(id)), diagnosticsRoot: temporary() });
    expect(await run.acquisition.runOnce()).toMatchObject({ ingested: 3, stopped: "RATE_LIMITED" });
    const events = run.events();
    expect(events.find((event) => event.event === "job.navigate.failed")).toMatchObject({ itemId: ids[3], stage: "navigate", code: "RATE_LIMITED", status: 429 });
    expect(events.find((event) => event.event === "site.stopped")).toMatchObject({ site: "linkedin", reason: "RATE_LIMITED" });
    expect(run.rows.get(ids[3])).toMatchObject({ attempts: 0 });
  });

  it("a sign-in wall answered with HTTP 200 is a restriction of its own kind (ACCESS_STOPPED), never RATE_LIMITED; a failed load is neither", async () => {
    const authwall = '<html><head><title>Sign Up | LinkedIn</title></head><body><main><form class="join-form"><input name="email"></form></main></body></html>';
    const walled = setup({ site: "linkedin", ids: [ids[0]!], serve: () => ({ status: 200, html: authwall }), diagnosticsRoot: temporary() });
    const walledPass = await walled.acquisition.runOnce();
    expect(walledPass?.stopped).not.toBe("RATE_LIMITED");
    const failure = walled.events().find((event) => event.event === "job.navigate.failed");
    expect(failure).toMatchObject({ code: "ACCESS_DENIED", status: 200 });

    const failedLoad: BrowserDriver = { navigate: async () => Promise.reject(new Error("net::ERR_TIMED_OUT")), close: async () => undefined };
    const diagnostics = createWorkerDiagnostics({ directory: temporary(), now: () => now });
    const rows = new Map([[ids[0]!, item(ids[0]!, "linkedin")]]);
    const deferSite = vi.fn(async () => undefined);
    const acquisition = createPageCaptureAcquisition({
      repository: {
        recoverInterrupted: async () => 0,
        sitesWithQueued: async () => ["linkedin"],
        siteStoppedUntil: async () => null,
        claimQueued: async () => [...rows.values()],
        markIngested: async () => undefined,
        markFailed: async () => undefined,
        deferSite,
        markHandedOff: async () => undefined,
        requeueUncounted: async () => true,
        releaseClaimed: async () => 0,
        finalizeProvisionalFailure: async () => false,
      },
      ingestion: { ingest: vi.fn() } as never,
      handoff: { alreadyHandled: async () => false, request: async () => "X" },
      discovery: customerSuccessDiscoveryConfiguration,
      detailSites: () => ["linkedin"],
      browser: { launch: async () => failedLoad },
      now: () => now,
      sleep: async () => undefined,
      diagnostics,
    });
    expect(await acquisition.runOnce()).toMatchObject({ stopped: "NETWORK" });
    // A failed load defers the site for an hour as NOT_INGESTED: no restriction recorded.
    expect(deferSite).toHaveBeenCalledWith("linkedin", expect.any(Date), "NOT_INGESTED");
    expect(readEvents(diagnostics.file!).find((event) => event.event === "job.navigate.failed")).toMatchObject({ code: "NETWORK", status: null });
  });
});
