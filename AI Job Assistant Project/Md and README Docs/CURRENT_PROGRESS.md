# Current Progress

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** October 20, 2026

## Current Objective

**Feature 14B — the browser-extension companion** is implemented and verified with automated tests on `claude/gallant-pasteur-y1ou3i`, and awaits Alex's review and local Chrome acceptance. It is **not committed or pushed**. It was built to the approved Feature 14B plan (decisions D1–D4 and O1–O4, October 20, 2026); see "Feature 14B" under Recently Completed. Feature 14 is **not complete until 14B is accepted**; there is no Feature 14C, and Feature 15 does not start before then.

*(Earlier wording, superseded on October 20, 2026 when 14B was implemented: "Feature 14B … is the next main-product task. It is required main-product work and is not yet implemented (no extension code exists; `apps/extension` holds only a placeholder).")*

**Feature 14A — browser-assisted automated retrieval and source corrections** is complete and accepted: committed and pushed as `dd77d298cfb0888f8914e1592d30d426b30fe6c4` on `claude/gallant-pasteur-y1ou3i` (October 20, 2026) and accepted after the local-runtime LinkedIn adapter check. On October 20, 2026 the committed adapter (`dd77d29`) was run from the local WSL runtime with one search page and one job page: the public search page returned HTTP 200 and 60 public job cards were discovered (the "Sign in to view more jobs" modal did not prevent it); the first job-detail page returned HTTP 429, and the run stopped at once as RATE_LIMITED, with no retry and no listing emitted. Feature 14A was accepted on that result; LinkedIn itself stays unverified and disabled (a source-side rate limit, not an implementation defect) and is not retried. Any later live check of LinkedIn's job pages is a separate, explicitly approved source-enablement decision.

In order, what follows:

1. Next: Alex's review of Feature 14B (implementation, verification and documentation, including the new spec versions, are done), then its local acceptance in Chrome on a dedicated acceptance database (`apps/extension/README.md`, "Local acceptance runbook"), then the checkpoint commit on Alex's approval. *(Earlier step: "Next: Feature 14B, the browser-extension companion (not started …)", superseded October 20, 2026 when it was implemented.)*
2. Then: main-product features 15–18, after 14B is accepted. Feature 15 does not begin before then unless Alex changes the roadmap.
3. Only after features 1–18: deliberate evaluator/product integration (including how Ghost Job Risk adopts the Feature 13 posting-history facts), full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Correction, October 20, 2026: An October 19, 2026 implementation instruction incorrectly treated Feature 14B, the required browser-extension companion, as deferred, an optional future idea and not required. No approved roadmap or authoritative product-scope revision removed Feature 14B from the main product. This correction (October 20, 2026) resolves that inconsistency while preserving Feature 14A's accepted implementation. From October 19 this document repeated that instruction, calling the browser extension "deferred" or "an optional future idea"; those statements are superseded. The corrected specification versions are Core AI Framework PRD v1.12, Customer Success PRD v1.11, Core Platform TDD v1.13 and Customer Success TDD v1.11.)*

*(Earlier objective, superseded on October 20, 2026 when Feature 14A was committed as `dd77d29` and accepted. It read as follows.)*

**Feature 14 — browser-assisted retrieval and source corrections** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 13 was committed as `d1bf217` (October 19, 2026).

In order, what follows:

1. Next: user review of Feature 14, then the checkpoint commit and the personal-file refresh. LinkedIn is a viable source awaiting one controlled local-runtime verification of the Feature 14 adapter itself, after this code is synced locally (the Claude cloud automated Chromium got HTTP 429 and an anti-bot interstitial, but a local logged-out browser check loaded normal public results); Welcome to the Jungle stays disabled because WTTJ's tested public surfaces (the search page, and the company jobs page checked locally) expose no usable job records. Any further check is a separate, approved decision, never a workaround.
2. Then: main-product features 15–18.
3. Only after features 1–18: deliberate evaluator/product integration (including how Ghost Job Risk adopts the Feature 13 posting-history facts), full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved. The Manifest V3 browser extension, originally planned as feature 14, is deferred as an optional future idea.

*(Earlier objective, superseded on October 19, 2026 when Feature 13 had been committed as `d1bf217` and Feature 14 implemented. It read as follows.)*

**Feature 13 — posting history and listing removal** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 12 was committed as `f10a02b` (October 18, 2026).

In order, what follows:

1. Next: user review of Feature 13, then the checkpoint commit and the personal-file refresh.
2. Then: main-product features 14–18.
3. Only after features 1–18: deliberate evaluator/product integration (including how Ghost Job Risk adopts the Feature 13 posting-history facts), full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 19, 2026 when Feature 12 had been committed as `f10a02b` and Feature 13 implemented. It read as follows.)*

**Feature 12 — source health and conservative retrieval** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 11B was committed as `2a1d8c2` (October 18, 2026).

In order, what follows:

1. Next: user review of Feature 12, then the checkpoint commit and the personal-file refresh.
2. Then: main-product features 13–18 (feature 13 now includes listing expiry/removal detection).
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 18, 2026 when Feature 11B had been committed as `2a1d8c2` and Feature 12 implemented. It read as follows.)*

**Feature 11B — automated retrieval from the verified public/guest-endpoint and public-HTML sources** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 11A was committed as `fad2341` (October 18, 2026).

In order, what follows:

1. Next: user review of Feature 11B, then the checkpoint commit and the personal-file refresh.
2. Then: main-product features 12–18.
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 18, 2026 when Feature 11A had been committed as `fad2341` and Feature 11B implemented. It read as follows.)*

**Feature 11A — automated retrieval from the verified official API and feed sources** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 11B (the verified public/guest-endpoint and public-HTML sources) is a separate acceptance unit that starts only after 11A is committed.

In order, what follows:

1. Next: user review of Feature 11A, then the checkpoint commit and the personal-file refresh.
2. Then: Feature 11B, then main-product features 12–18.
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 18, 2026 when the gap closure had been committed as `d573acf` on October 17 and Feature 11A implemented. It read as follows.)*

The **Features 1–10 Gap Closure** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. It closes with the review, the check of the versioned PRDs/TDDs against what changed, and then the checkpoint commit. The read-only gap audit that defined it is complete (October 17, 2026). The work package has deliberately not been given a task number.

In order, what follows:

1. Next: user review of the gap closure, the versioned-specification check, and the checkpoint commit.
2. Then: main-product features 11–18.
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 17, 2026 when the gap audit was completed and the gap closure implemented. It read as follows.)*

The Task 1–9 completion pass is complete on `claude/gallant-pasteur-y1ou3i`:

- Task 8 — Application Tracker completion pass: complete (`534a4c7`);
- Task 9 — Operations hardening completion pass: complete (commit `feat: complete operational hardening`, October 16, 2026).

The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is also complete (October 16, 2026): Core AI Framework PRD v1.5, Customer Success AI Assistant PRD v1.4, Core Platform TDD v1.6, Customer Success Assistant TDD v1.4 and Semantic Evaluation Playbook v1.3 are the current authoritative versions.

In order, what follows:

1. Next: audit any remaining gaps in main-product features 1–10.
2. Then: main-product features 11–18.
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier next step, superseded on October 16, 2026 when the versioned-document update was committed: "Next: the separate post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update (new PRD/TDD versions, Semantic Evaluation Playbook v1.3).")*

*(Earlier objective, superseded on October 16, 2026 when the Task 9 completion pass was committed: "The current task is Claude Task 9 — Operations hardening completion pass on `claude/gallant-pasteur-y1ou3i`. It is open: implementation and isolated verification are complete; the documentation synchronization is under review; it closes with the review and then the checkpoint commit.")*

*(Earlier objective, superseded on October 16, 2026 when the Task 8 completion pass was committed: "The Claude Task 8 — Application Tracker completion pass is implemented on `claude/gallant-pasteur-y1ou3i` and awaiting user review before its checkpoint commit. The Task 9 completion pass follows after that review.")*

*(Earlier objective, superseded on October 15, 2026 when the completion pass was implemented: "Complete Claude Task 8 — Application Tracker as the next completion-pass task while preserving the now-aligned Task 7 → Customer Success Milestone 4 contract.")*

*(Earlier objective, superseded on October 15, 2026: "Finish the evaluator and remaining main-product work in parallel so they can be combined into a stable, usable first product before automated retrieval/scraping begins." Main-product scope is now features 1–18, which include retrieval and intelligence; see `DEVELOPMENT_PLAN.md`.)*

## Recently Completed (October 14–20, 2026)

### Feature 14B — browser-extension companion (implemented and verified October 20, 2026; awaiting review and local acceptance; not committed)

**What it is.** A TypeScript Manifest V3 extension in `apps/extension` that saves the job page Alex is viewing into the local AI Job Assistant, only when asked. It is a source-collection boundary only: no evaluator, model calls, prompts, budget, recommendation logic, lifecycle or database of its own.

**Approved decisions it implements (October 20, 2026).**
- **D1, evaluation.** A capture only saves. After a save, an explicit **Request evaluation** goes through an authenticated extension wrapper to the existing production evaluation handler. The popup shows only the persisted queued, running, completed or failed state and the recommendation, read-only.
- **D2, LinkedIn.** Job pages only, read through structured data, then a reader limited to LinkedIn's job-detail areas, then Alex's selection. There is no whole-page fallback. Account, profile, messaging, feed, cookies and other tabs are never read. It complements 14A and does not address 14A's HTTP 429.
- **D3, WTTJ/Otta.** Generic extraction only; there is no site reader.
- **D4, authentication.** A revocable pairing credential, shown once and stored server-side only as a SHA-256 hash. The extension keeps it only in `chrome.storage.local`.
- **O1, unknown hosts.** Accepted as AGGREGATOR, the lowest link precedence, with the real host and capture provenance kept.
- **O2, acceptance database.** A dedicated local acceptance database.
- **O3, stale Core TDD wording.** Corrected at the 14B closeout spec version.
- **O4, evaluation routes.** The credential protects the extension's evaluation request and status wrappers under `/api/extension/*`.

**Built.**
- **The extension** (`apps/extension`):
  - `manifest.json` with exactly `activeTab`, `scripting` and `storage`, host access to `127.0.0.1` and `localhost` only, no content scripts, and a minimal service worker (`service-worker.ts`).
  - The service worker only restricts the extension's storage to its own pages, on installation and every browser start.
  - `extract.ts`: one self-contained page reader, injected only on "Read this page", taking no arguments and using no storage, cookies or network.
  - `envelope.ts`: local validation with the server's own schema, and the user's corrections from the editable preview, named in `editedFields`.
  - `api.ts`: the only `fetch`, limited to `/api/extension/*` on a local backend.
  - `settings.ts`: `chrome.storage.local` only, restricted with `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`.
  - The popup: an editable preview (title, company, location, description; nothing sent before Save), Save, Request evaluation, and the persisted state.
  - The options page, and `build.mjs` (esbuild, writing `dist/`, which is git-ignored).
  - `pnpm extension:build`.
- **Core:** `packages/core/src/extension-capture.ts`, the strict capture envelope (128 KB body, 50,000-character description, no HTML), the user-corrected `editedFields`, text cleaning, URL cleaning and LinkedIn job-ID parsing, shared by the server and the extension.
- **Server:**
  - `extension-auth.ts`: credential generation and hashing; the Bearer check with constant-time comparison; refusal of web origins; same-origin-only pairing management that refuses Bearer credentials; JSON bodies capped, with 415, 413 and 400 responses.
  - `extension-capture.ts`: site classification (known ATS, job-board and marketplace hosts, everything else AGGREGATOR); page identity (LinkedIn canonical `/jobs/view/<id>` and `linkedin:<id>`, otherwise `<site>:<cleaned URL key>`); and the mapping to `buildRetrievedListing` with `BROWSER_EXTENSION` / `BROWSER_ASSISTED`, then `createRetrievalIngestionService`. Captures are not title-filtered; `outsideRoleFamilies` is informational.
  - `extension-api.ts`: the handlers.
  - Seven route files under `apps/web/src/app/api/extension/`: captures, status, lookup, pairings, pairings/[id]/revoke, opportunities/[id]/evaluation-requests and opportunities/[id]/evaluation. `OPTIONS` returns 405 and no CORS headers are emitted.
- **App:** an **Extension** page (`/extension`) to create, list and revoke pairings, added to the header navigation. The doctor names the connected database (name and host only) and counts paired browsers.
- **Database:** one additive migration, `20261020090000_extension_pairing` (the `ExtensionPairing` table, with no foreign keys; rollback is `DROP TABLE "ExtensionPairing";`). It was applied only to the isolated test database, and `db:verify-migrations` passes with 20 migrations. Also `PrismaExtensionPairingRepository` and the read-only `PrismaExtensionLookupRepository`.
- **Unchanged:** evaluator internals, model routing, semantic schemas and recommendation logic.

**Differences from the approved plan's wording, all approved or required by the implementation prompt.**
- **Unknown-host identity (approved refinement, October 20, 2026).** An unrecognised site's listing identity is its cleaned page URL. Any identifier the page declares (for example a JSON-LD `identifier`) is kept as capture metadata (`siteJobId`) and not trusted as identity. Known sites keep their URL-based ID rules (LinkedIn's job ID).
- **A minimal service worker.** The plan text said "no service worker". The Feature 14B implementation prompt lists one, with an E2E check that it starts. It only restricts storage.
- **An editable preview.** The plan text said the preview is read-only. The implementation prompt requires it to be editable and testable. Corrected fields are named in the capture (`editedFields`) for provenance.

**Implementation-time checks from the plan.**
- **Chrome storage restriction:** `chrome.storage.local.setAccessLevel` is supported (Chrome 102 and later; the manifest requires 120). In Chromium 141 a scratch control showed that a page-injected script reads `chrome.storage.local` by default and is refused after `TRUSTED_CONTEXTS` is set. The extension E2E checks that a page-injected script cannot read the extension's storage, while its own pages can.
- **Shell `DATABASE_URL` precedence:** proved with a temporary decoy `.env` naming a nonexistent database, removed afterwards. With the shell variable, `pnpm app:doctor`, Prisma (`db:status`, the same config `app:setup` uses), `next dev` (`/api/health`) and `dotenv/config` (the worker's loader) each used the shell's database. Without it, each read the decoy, which proves `.env` is loaded otherwise. The normal application database was never involved.

**Verified (October 20, 2026; isolated test database only; no live third-party requests; no provider or evaluator calls beyond the fixture transport).**
- typecheck and lint, including the new extension package;
- unit tests: 57 files and 1,433 tests, among them `extension-extract` (13), `extension-client` (16) and `extension-server` (41), plus doctor and navigation checks;
- integration on the test database: 31 files and 265 tests, including `extension-capture` (7);
- E2E: the `extension` Playwright project (6 tests) loads the built unpacked extension into Chromium 141 with `launchPersistentContext`, with DNS limited to `127.0.0.1` and `localhost`. The full E2E chain passed 43/43 (7.2 min) after the service worker and editable preview were added (and 39/39 before them);
- the production web build; `pnpm extension:build`; `db:verify-migrations`; `git diff --check`; `apps/web/next-env.d.ts` left unchanged.

The extension E2E covers:
- the service worker starting, and storage closed to page scripts;
- pairing through the UI, and the editable preview;
- that no capture request is made before Save;
- created, unchanged and possible-duplicate results, and a corrected title being saved;
- Open in AI Job Assistant;
- Request evaluation with its queued, running, completed (with the recommendation) and failed states;
- a page with no job;
- the LinkedIn reader in real Chromium, with profile, message and feed decoys and no whole-page fallback, and the Welcome to the Jungle generic path, on pages Playwright answers itself;
- revocation (then 401), and the routes' refusals.

**Versioned specifications.** Core Platform TDD v1.14, Customer Success TDD v1.12, Core AI Framework PRD v1.13 and Customer Success PRD v1.12 are built from the previous versions, which moved unchanged into `Archive/`. Core Platform TDD v1.14:
- records Feature 14B's implementation status (Section 51);
- notes in Section 45 that evaluation after capture is only ever the user's explicit request;
- records the approved pairing-credential exception to the general rule against secrets in browser storage;
- corrects Section 9's stale wording (D7/O3): browser-assisted support for LinkedIn is implemented, but the source remains unverified and disabled after the local check (search page HTTP 200 with 60 cards, first job page HTTP 429), and Upwork belongs to the Freelance Writing domain, implying no Customer Success verification.

The others refresh the 14B status and their dependencies.

**What remains.** Alex's review of this implementation, then Alex's local acceptance in Chrome on a dedicated acceptance database (runbook in `apps/extension/README.md`), then the checkpoint commit (only on Alex's approval). Feature 14 is complete only then, and Alex's personal documentation copies are exported only then.

### Feature 14A — browser-assisted retrieval and source corrections (committed `dd77d29` and accepted, October 20, 2026)

*(Heading corrected on October 20, 2026 from "Feature 14 — …": this record covers Feature 14A only. Feature 14B, the browser-extension companion, is required and not yet implemented, so Feature 14 as a whole is not complete.)*

*(Heading updated on October 20, 2026 after the commit and acceptance; it read "implemented and verified October 19, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Acceptance (October 20, 2026).** On October 20, 2026 the committed adapter (`dd77d29`) was run from the local WSL runtime with one search page and one job page: the public search page returned HTTP 200 and 60 public job cards were discovered (the "Sign in to view more jobs" modal did not prevent it); the first job-detail page returned HTTP 429, and the run stopped at once as RATE_LIMITED, with no retry and no listing emitted. Feature 14A was accepted on that result; LinkedIn itself stays unverified and disabled (a source-side rate limit, not an implementation defect) and is not retried.

**Scope (approved October 19, 2026, with a scope change).** Part A: browser-assisted, automated retrieval for **public, logged-out LinkedIn** job pages only. Part B: source audits and corrections. Part C: the Manifest V3 manual-capture extension is **deferred** (an optional future idea): no manifest, popup, `activeTab`/`scripting` permissions, localhost bridge, pairing token or extension E2E were built. No evaluator change, no migration, no AI calls, no broad crawling. *(Correction, October 20, 2026: An October 19, 2026 implementation instruction incorrectly treated Feature 14B, the required browser-extension companion, as deferred, an optional future idea and not required. No approved roadmap or authoritative product-scope revision removed Feature 14B from the main product. This correction (October 20, 2026) resolves that inconsistency while preserving Feature 14A's accepted implementation. Part C above records that instruction as it was given; Feature 14B remains required main-product work and is next.)*

**Access model (A1).** A fresh, non-persistent browser context per run, asserted to start with no cookies; no profile, `userDataDir`, storage state, credentials or account; no login, applying, saving, following, messaging or connections; no proxy rotation, IP hopping, stealth, fingerprint or user-agent changes, CAPTCHA solving, or challenge/authwall/access-control bypass. The adapter only opens URLs and reads the returned document (the session API exposes only `open`). An account cookie (`li_at`) appearing would stop the run.

**What changed.**

- **Runner (A2–A4)** (`packages/discovery/src/browser.ts`): `createBrowserSession(driver, options)`: sequential navigation with at least the adapter's minimum interval between starts (LinkedIn 5 s; no concurrency); a per-run navigation cap; a 30 s timeout; a 5 MB page limit; generic friction detection (authwall, login, signup, checkpoint, challenge, `uas/login` or CAPTCHA paths; CAPTCHA or challenge widgets) plus the adapter's own (LinkedIn's join form or security-check page). 429 → `RATE_LIMITED` (with Retry-After); 401/403/999, friction or an account cookie → `ACCESS_DENIED`; 5xx → `SERVER_ERROR`; a failed load → `NETWORK`. After any stop, every later `open` is refused without navigating. Feature 12 then backs the source off (at least a day after an access refusal); nothing is retried.
- **Driver** (new `packages/browser-retrieval`): `launchBrowserDriver({ executablePath })` with `playwright-core` (headless Chromium, `serviceWorkers: "block"`, no downloads, images/fonts/media aborted), and `parseHtml` with jsdom (scripts not run). Configured by the optional `RETRIEVAL_BROWSER_EXECUTABLE`; loaded dynamically by the retrieval worker CLI and `sources:verify` only.
- **Worker:** for `requiresBrowser` adapters, one driver per run, closed in `finally`; no browser configured → `ADAPTER_UNAVAILABLE`; a launch failure → `INTERNAL` (neutral for health). It passes `pendingListings` and records `discovered` and `unavailable`.
- **LinkedIn adapter (A5–A8)** (`packages/discovery/src/adapters/linkedin.ts`; `BROWSER_ASSISTED`, `JOB_BOARD`, `PUBLIC_SEARCH`, `verified: false`):
  - deterministic public search URLs (`keywords`, optional `location`, `f_TPR`, `f_WT=2` for remote, `start`), keywords defaulting to the domain's search query (`"customer success"`);
  - discovery: pages by the number of results each page actually returned (never an assumed page size), ending on an empty, repeated or short page, within `maxSearchPages` (default 4, hard cap 8) and `maxDiscovered` (default 100, hard cap 200). The existing Customer Success title filter runs on the cards. Coverage is reported (all card IDs) and never complete;
  - details, a separate budget: `maxDetailsPerRun` (default 20, hard cap 25). Order: pending matches from earlier runs (oldest first, up to 30 days), then this run's unseen matches, then stored matches last checked over 7 days ago. 404/410 marks a pending job unavailable; three unreadable pages in a row halt the run;
  - parsing: schema.org JobPosting JSON-LD first, then the public page's title, description, criteria and salary; no value is invented; the source URL is the public job page and `applicationUrl` only the external apply address the page states;
  - bounded and never removal-capable (Feature 13 rules unchanged). No query segmentation to get around caps.
- **Cross-run pool (no migration):** title matches without stored details are kept as current-scope `RetrievedListing` rows with no opportunity (LISTED, not removal-capable); `pendingListings(sourceId, scopeKey, since)` returns them oldest first; the existing stored-listing path attaches the opportunity when their details are read; an unavailable job's placeholder is deleted. Stored jobs are detected with the existing `lastCheckedListings`.
- **`sources:verify`:** a browser-assisted adapter is verified through a fresh logged-out browser: one search page and the first job page it lists (`verificationFollowUpUrl` now receives the page as a `Document`), saved outside the repository and replayed offline.
- **We Work Remotely (B1):** the official all-jobs feed `https://weworkremotely.com/remote-jobs.rss` with our own title filter; attribution and links kept; a legacy `category` setting is accepted and ignored; no HTML, browser or extension.
- **Wellfound (B2):** `minRequestIntervalMs` 12,000 (was 2,000); sequential; embedded state unchanged.
- **Welcome to the Jungle / Otta (B11, revised by the October 19 addendum):** reclassified as public logged-out webpage retrieval (`retrievalType` `PUBLIC_HTML`; no public jobs API identified; bounded; not removal-capable) and treated as an active candidate, not disabled because of its terms. Live inspection (October 19, 2026): one plain GET of `https://www.welcometothejungle.com/en/jobs?query=customer%20success` (through the existing verification tool) answered 200 with 537 KB of HTML for a sign-up and matching landing page: no listings, no job links, no job data in its embedded React data, and the query ignored. One logged-out headless-browser load of the same page (through the Feature 14 session) was refused by WTTJ's CloudFront firewall: HTTP 403 "Request blocked". That is a stop condition, so no further WTTJ request was made (no retry, no company page, no workaround). At that point no public listing surface had been retrieved without a block; the adapter's comment records all of the evidence below. *Local check (later on October 19, 2026; the scheduled cloud company-page check was cancelled):* a local WSL browser check run by Alex then loaded the public company jobs page (`/en/companies/wttj/jobs`, which ends at `/en/companies-v1/wttj/jobs`) logged out with no 403, 429, CAPTCHA, sign-in wall or challenge, and with JavaScript rendering showed the company shell and a "Jobs 16" tab but "We didn’t find any jobs for your search": no job cards, links, IDs, descriptions, locations, employment types or dates. Plain HTML is insufficient and JavaScript rendering is required for the page state, but even rendered, this public company page exposed no usable job records. So: Claude cloud headless browser, HTTP 403 (environment-specific, not a universal block); local WSL browser, page reachable; public rendered page, no usable job records. **Final Feature 14 status:** registered candidate, `PUBLIC_HTML`, bounded and not removal-capable, public logged-out webpage retrieval technically possible in principle, but unverified and disabled because the tested public surfaces expose no usable job records (not because of its terms, and not because it is universally blocked). No hidden or internal API discovery or reverse engineering was done, and no other WTTJ route was tried.

**Audits (no code change).**

- **Workday (B3):** the tenant career-site JSON (`/wday/cxs/<tenant>/<site>/jobs`), stateless POST, bounded; preserved. No adapter reads `robots.txt` (reported; supporting it would be a framework addition).
- **Workable (B4):** the anonymous Jobs by Workable search JSON; left alone; the ~850 MB XML feed is not used.
- **Working Nomads (B5):** the public `https://www.workingnomads.com/api/exposed_jobs/` JSON feed; `/jobsapi/_search` is **not** intercepted or replayed.
- **Remote OK, SmartRecruiters, Himalayas (B6–B8):** their official public API/feed endpoints, as verified in 11A. Himalayas' `expiresAt` stays display-only (Feature 13).
- **Adzuna (B9):** disabled (unverified, needs credentials). **Greenhouse, Lever, Ashby (B10):** no work.

**Tests.**

- **Unit:** new `browser-retrieval.test.ts` (40): sequential one-at-a-time navigation and the interval; the navigation cap; stops on 429 (Retry-After), 403, 999, 401, 503, authwall/login/checkpoint redirects, a CAPTCHA, a challenge iframe, LinkedIn's anti-bot interstitial (with 200 or 429), an account cookie, an oversized page and a failed load, each with no later navigation; the adapter's friction check; the `open`-only API; search-card parsing (URN or link IDs, unidentified cards, no-results versus unrecognized); job pages with and without JSON-LD, null on a changed layout, no invented application URL; deterministic URLs and defaults; the verification pair (one search page and the first job page it lists); strict config rejecting credentials, cookies, profiles, proxies and over-cap budgets; registration (browser-assisted, unverified, not removal-capable, scope excluding budgets); the 100-result pool across 4 pages with a 20-page detail budget; caps; paging by actual counts and early ends; pending-first ordering, no refetch of fresh stored jobs and the 7-day refresh; mapping and normalization; unavailable pages and the three-in-a-row halt; first-page blocks failing the run; later blocks keeping what was found. New `browser-retrieval-worker.test.ts` (7): no browser or executable → unavailable; launch failure → internal; one fresh browser per run, paced and closed; the discovered pool and unavailable IDs reaching the ledger; 999/429/authwall failing the run with Feature 12 data (Retry-After) and no further navigation; a stop during details keeping stored listings. `retrieval-adapters.test.ts` (+1): WWR reads only the all-jobs feed and filters titles itself. `retrieval-adapters-11b.test.ts` (+1): Wellfound 12-second sequential cadence through the polite transport, and a 429 or 403 stopping with no further request.
- **Integration:** new `linkedin-retrieval.test.ts` (3, isolated test database): the discovered pool persisted as pending rows and worked through over four runs within a 2-page budget, never refetching stored jobs, bounded rows never MISSING, no evaluation created and the provenance recorded; a gone pending job leaving the queue; HTTP 999 failing the run with at least a day of backoff, no further navigation and Run now refused. New `browser-driver.test.ts` (4): the real Playwright driver and headless Chromium against a local 127.0.0.1 server: no cookie carried into a new run, images and fonts not requested, statuses and Retry-After reported, a closed driver refusing navigation, an authwall redirect stopping the session, and a self-reloading 429 page producing exactly one request with headers kept and cookie values dropped.
- **E2E:** `retrieval.spec.ts` (extended): a LinkedIn source on `/sources` shows "LinkedIn (job board · browser-assisted)" and cannot be enabled.

**Verification** (isolated test database only; no paid or provider calls; normal application database untouched):

- typecheck and lint clean; `git diff --check` clean;
- unit 54 files / 1,362 tests; integration 30 files / 258 tests; E2E 37/37; production build succeeds; `pnpm db:verify-migrations` (19 migrations, only the known documented drift; no new migration);
- `apps/web/next-env.d.ts` unchanged (the dev server rewrote it during E2E and the build; it was reverted each time).

**LinkedIn live verification (Part E).** *First attempt (earlier on October 19, recorded as written):* The Claude cloud environment's egress proxy answered HTTP 403 to `CONNECT www.linkedin.com:443` (policy denial; re-checked on October 19, 2026 with a single CONNECT probe that reached no LinkedIn server). No LinkedIn page was loaded, so the parsers rest on synthetic pages modelled on the public layout, and the adapter stays `verified: false` and cannot be enabled. To verify it, add `www.linkedin.com` to the environment's allowed domains (Network access in the environment settings), then run `pnpm sources:verify linkedin --config '{"maxSearchPages":1,"maxDetailsPerRun":1}' --raw-dir <dir outside the repository>` with `RETRIEVAL_BROWSER_EXECUTABLE` set, and mark the adapter verified only if both pages map.

*Network check and second attempt (after the October 19 addendum):* the environment's allowlist is enforced by the upstream gateway and is not readable from the session, so each host was probed with a CONNECT and a TLS handshake only (no HTTP request). `www.linkedin.com`, `linkedin.com`, `static.licdn.com`, `www.welcometothejungle.com` and `app.welcometothejungle.com` all completed TLS with their own certificates and the gateway logged no refusal, so nothing further needs allowlisting and no setting was changed (the minimum LinkedIn set is `www.linkedin.com`; images and media are not loaded, and `static.licdn.com` is reachable too). One minimal logged-out verification then ran (`pnpm sources:verify linkedin --config '{"maxSearchPages":1,"maxDetailsPerRun":1}'`, fresh browser): the first and only request, one public search page, was answered with **HTTP 429** and LinkedIn's anti-bot interstitial (24 KB: an obfuscated script that computes a cookie and a one-second meta refresh to the home page; a Cloudflare `__cf_bm` cookie was set). The session stopped as RATE_LIMITED and made no second request; the interstitial was not executed, solved or retried. The raw page stays outside Git. Outcome (environment-specific): the Claude cloud environment's automated headless Chromium received HTTP 429 and an anti-bot response; this does not establish how LinkedIn treats a local runtime or an ordinary local Chrome, which remain a separate future decision. The adapter stays `verified: false` and disabled, and the LinkedIn friction check now also recognises this interstitial (a refresh-only page with no job content) whatever its status. Node's built-in `fetch` in this environment needs `NODE_USE_ENV_PROXY=1` to reach the proxy (used for the WTTJ check); Chromium uses the proxy without configuration.

*Offline diagnosis of that single 429 (no further LinkedIn request; the challenge script was read as text, never executed):*

- **Verified:**
  - The response was HTTP 429 for `https://www.linkedin.com/jobs/search?keywords=%22customer+success%22&f_TPR=r604800&f_WT=2&start=0`, with no redirect: the final address equals the request.
  - The 24,644-byte body has no visible content. It holds one inline script, no external resources, and `<meta http-equiv="refresh" content="1;url=https://www.linkedin.com">` (the fallback for clients without JavaScript).
  - The script is an obfuscated CryptoJS HMAC-SHA256 routine. On `window.onload` it sets a 20-minute `ccookie=<value>|<hash>` cookie, then reloads the same URL with an added `original_referer` parameter (the referrer, truncated to 200 characters).
  - The script reads no `navigator`, `webdriver`, `userAgent`, screen, canvas or WebGL properties. The decision to serve it was therefore made on the server from the request alone, before any page-side check.
  - After the response the context held one cookie, `__cf_bm`. That is Cloudflare's bot-management cookie name; its domain and value were not recorded. There was no `ccookie`, so the script had not completed when the cookies were read.
  - The run stopped as RATE_LIMITED and our code issued no further navigation.
  - Response headers, including any Retry-After, were not recorded: the driver then kept only the parsed Retry-After, and the verification tool logged no headers.
  - **Browser configuration** (measured locally against a 127.0.0.1 echo server with the same launch options): Chromium 141.0.7390.37, `headless: true` (Playwright's headless mode, no display).
  - **User agent:** `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36`.
  - **Request headers:** `sec-ch-ua: "Chromium";v="141", "Not?A_Brand";v="8"`, `sec-ch-ua-platform: "Linux"`, `accept-language: en-US,en;q=0.9`, ordinary `accept` and `sec-fetch-*` values, and `pragma: no-cache` / `cache-control: no-cache`. A first navigation in ordinary Chrome sends neither of the last two; here they come from the driver's request interception, which disables the cache.
  - **Visible to the page:** `navigator.webdriver` is `true`, the timezone is UTC, the screen is 1280×720 and there are 4 cores.
  - **Network path:** direct egress is impossible (a direct HTTPS request to example.com fails), so Chromium necessarily went through the environment's agent proxy and gateway. At the moment of the verification launch the gateway logged Chromium's background requests to www.google.com as refused. The CONNECT tunnel to LinkedIn is end to end: its certificate is LinkedIn's own (DigiCert), so Chromium's own TLS and HTTP reached LinkedIn unmodified.
  - The block came on the first request, before any LinkedIn parsing or paging logic ran.
  - The request was well formed: the URL is the documented public search form and the headers are standard. No evidence of a malformed request exists.
- **Plausible inferences:**
  - The request left from a shared cloud or datacenter egress, not a residential connection. The egress IP was not looked up.
  - IP or ASN reputation, or rate limits on that shared egress, are a likely factor (the status is 429, and it came on the very first request, with no earlier traffic of ours).
  - Automated-browser signals visible in the request itself are a likely contributing factor: the `HeadlessChrome` user agent, the Chromium-only client hints and the no-cache headers. The headless TLS fingerprint may also differ from desktop Chrome, but this was not verifiable.
  - The challenge is a JavaScript-capability check served to traffic already classified as suspicious.
- **Unknown from one response:**
  - LinkedIn's actual reasons and which signal weighed most.
  - Whether the same request from a residential local runtime, or from an ordinary local Chrome, would be served normally.
  - Whether a Retry-After was sent.
  - The cookie's issuing domain.
  - Whether Chromium's own execution of the page script began its reload before the browser closed. The missing `ccookie` suggests not, but it cannot be proven.
- **Best-supported explanation:** a combination of a shared cloud egress and plainly automated-browser request signals (the `HeadlessChrome` user agent), classified server-side before any page script ran. Malformed implementation behaviour is not supported by the evidence.
- **Changes made from this diagnosis** (no LinkedIn request, no change to proxy, network, user agent or fingerprint, and no stealth):
  - The driver now refuses any main-frame navigation the page starts by itself, such as a script reload or meta refresh, so a challenge page can never cause a further request after a stop. A local test shows a self-reloading 429 page producing exactly one request.
  - The driver now records the response headers (Set-Cookie reduced to cookie names), and `sources:verify` saves them, so a future approved check keeps them.

*Local LinkedIn check (later on October 19, 2026, run by Alex outside Claude cloud):* a controlled logged-out check from a local browser-automation environment (not Claude cloud) then loaded `https://www.linkedin.com/jobs/search/?keywords=Customer%20Success&location=United%20States&f_WT=2` successfully (no 429, 403, 999, CAPTCHA, challenge or login interaction), with public job cards (title, company, location, public job link, relative posting time) for about 11,000 results under a dismissible "Sign in to view more jobs" modal. Examples included Trustpilot, Commas, JustPark, MongoDB, Copado, MaintainX and Cvent; the final address added `position=1&pageNum=0`. The exact user agent and egress type were not recorded. **Interpretation:** the Claude cloud 429 is environment-specific (Claude cloud headless Chromium → 429 anti-bot response); LinkedIn public, logged-out retrieval remains a viable Feature 14 source and is not generally blocked; the MV3 extension is not needed for it and stays deferred. The adapter stays `verified: false` until one controlled local-runtime verification of the Feature 14 adapter itself (`pnpm sources:verify linkedin --config '{"maxSearchPages":1,"maxDetailsPerRun":1}' --raw-dir <dir>` with `RETRIEVAL_BROWSER_EXECUTABLE` set) succeeds after this code is synced locally. **Changes from it (no LinkedIn request from Claude cloud):** the sign-in modal over still-present public results is no longer treated as a login wall (it was, which would have stopped a run); a sign-in form with no job content still is. The search URL now uses the verified `/jobs/search/` form.

**Final bounded live source pass (October 20, 2026, approved; one request per source, production adapter code and routes, the real fetch transport through the environment proxy, raw responses kept outside Git, no browser, no retries):**

- **We Work Remotely** (required contract check): `GET https://weworkremotely.com/remote-jobs.rss` → 200, valid RSS, 91 items. The existing parser mapped all 91 with no issues; the Customer Success title filter kept 3 (for example "Client Success Manager - Enterprise Accounts", FIXD Automotive), each with its WWR link as source and application link and "We Work Remotely" as source name. The committed fixture was re-captured from this response (3 of 91 items, byte-for-byte, no contact data), and its tests updated. WWR stays verified.
- **Wellfound:** `GET https://wellfound.com/role/customer-success-specialist` (one page) → 200; embedded Next.js data present; 41 listings parsed, 18 kept by the title filter; 12-second interval, sequential, bounded.
- **Working Nomads:** `GET https://www.workingnomads.com/api/exposed_jobs/` → 200 JSON; 41 jobs mapped with no issues (none matched Customer Success at the time); no `/jobsapi/_search`, no Elasticsearch request and no browser.
- **Remote OK:** `GET https://remoteok.com/api` → 200 JSON; 99 jobs mapped, 3 kept, each with the Remote OK link and "via Remote OK" attribution.
- **Himalayas:** `GET https://himalayas.app/jobs/api?limit=20` → 200 JSON; 20 jobs mapped (none matched at the time); `nextCursor` present and not followed; links taken from `applicationLink`, which now carries `?utm_source=api` (tracking parameters are already dropped from listing URL keys, so no false changes).
- **SmartRecruiters:** `GET https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=10` → 200 JSON; the list contract parsed (10 postings, coverage IDs read). No detail request was made (minimal smoke test); mapping, which uses details, is covered by the verified fixture and is unchanged by Feature 14.
- **Not repeated:** LinkedIn (cloud 429 anti-bot response; local logged-out browser success), Welcome to the Jungle (cloud 403; local rendered page with no job records), Workday and Workable (routes unchanged since their 11B verification), Greenhouse, Lever and Ashby (unchanged), Adzuna (disabled, needs credentials).
- No implementation defect was found; no production code changed in this pass.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/`. *(Status correction, October 20, 2026: Core Platform TDD v1.13, Core AI Framework PRD v1.12, Customer Success PRD v1.11 and Customer Success TDD v1.11 supersede the versions below. They record Feature 14A as accepted, with the local LinkedIn evidence, and Feature 14B as required, pending and next, replacing wording that called the extension deferred or optional. The versions below moved unchanged into `Archive/`.)*

- **Core Platform TDD v1.12:** a §51 "Browser-Assisted Retrieval and Source Corrections (Feature 14)" section, the sequence and the dependency.
- **Core AI Framework PRD v1.11** and **Customer Success PRD v1.10:** current status, revision history and dependencies.
- **Customer Success TDD v1.10:** status, revision history and the dependencies.

The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- The LinkedIn parsers have not met a live page (the cloud check was stopped by an anti-bot interstitial; the successful local check was a manual browser load, not this adapter). The public search may show more results only to signed-in users; the adapter reads what is public and stops on a real sign-in wall. Its public layout may differ (class names, a guest search endpoint instead of the full page, a consent or sign-in modal); the adapter fails closed (a contract mismatch or a stop), never guessing.
- The We Work Remotely fixture is now captured from the all-jobs feed (see the live source pass below); the October 17 category-feed fixture it replaced used the same RSS item format.
- A LinkedIn search past its last page may answer something other than an empty list; a non-200 later page halts discovery for that run (PARTIAL) rather than failing it.
- A 404 job page counts as a listing issue, so a run whose only detail is gone finishes `LISTING_FAILURES` (neutral for health).
- No adapter honours `robots.txt`; the controls are the cadence, caps, stop rules and backoff.
- The browser-driver integration test needs a Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE` here (as for E2E), or Playwright's own.

### Feature 13 — posting history and listing removal (committed `d1bf217`, October 19, 2026)

*(Heading updated on October 19, 2026 after the commit; it read "implemented and verified October 19, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Scope (approved, with the final corrections of October 19, 2026).** An objective, conservative posting history per retrieved listing: sightings, confirmed removal only where a source provably shows its whole board, reappearance, the source's stated expiry, and deterministic posting-history facts. No adapter retrieval change beyond coverage, no ingestion or deduplication change, no evaluator change, no live source requests and no AI calls. Out of scope: feeding the evaluator, text-based ghost signals, new-ID repost and requisition-frequency patterns (feature 18), browser-assisted sources (feature 14).

**Approved decisions.**

- The facts are built and contract-tested but **withheld** from `loadSubject()` and the evaluator. The first question for the later integration is whether Ghost Job Risk can become deterministic from them rather than activating the dormant paid semantic path.
- REMOVED requires two consecutive qualifying complete misses **and** at least 24 hours between the first miss and confirmation; the first miss gives MISSING only.
- `UNCHANGED_OVER_TIME`: 30 days, measured on content observations only.
- `Opportunity.status` is never changed automatically; source expiry dates are display-only (no removal, no `closingDate`); We Work Remotely is bounded until separately verified.
- Corrections: coverage IDs are collected before the title filter; Wellfound never confirms removal; tracking scopes are opaque **generations** (A → B → A gives three, and A₂ never inherits A₁'s history); the legacy backfill is HISTORICAL, never currently listed; where a source states a total, unique IDs must **equal** it exactly; the dashboard badge uses current-scope logic.

**What changed.**

- **Coverage** (`packages/discovery`): `CollectResult.coverage` (`observedListingIds`, `complete`); `listingCoverage()` (complete only for a whole read, every item with an ID, and unique IDs equal to any stated total), `trackingScopeOf()`, `itemId()`, `isRemovalCapable()`; `listingCoverage` and `trackingScope` declared on Greenhouse (`board`; `meta.total` checked), Lever (`site`), Ashby (`board`; unlisted postings excluded), SmartRecruiters (`company`; complete only when `totalFound` is read in full within the page cap) and Workday (host/tenant/site; complete only when the first page's `total` is read in full). The others stay bounded.
- **Migration** `20261019090000_retrieved_listing_history`: enum `RetrievedListingState`, table `RetrievedListing` (unique on source, scope generation and listing ID), `RetrievalSource.trackingScopeKey`, `RetrievalRun.listingCoverageComplete`, and the HISTORICAL backfill (one row per pre-feature-13 retrieved listing: first discovered, last observed, its opportunity, removal capability from the adapter, the `''` baseline scope).
- **Repository:** a fresh scope key on create; `update(…, { rotateTrackingScope })` assigns a new key and makes every earlier row UNTRACKED in the same transaction; `claimNextRun` initialises a legacy null key and adopts the baseline; `recordListingObservations` (one transaction: rows for stored listings, sightings, reappearance, `Opportunity.lastSeenAt`, then MISSING/REMOVED on qualifying runs; nothing if the scope changed mid-run); `listingsForOpportunity`; `remove` counts ledger rows.
- **Worker:** records observations after ingestion; a run qualifies only when the adapter is removal-capable, its coverage is complete, it was not halted, and it was a successful retrieval (Feature 12 sense). Source expiry is read from `expiresAt`/`endDate` metadata. A recording failure is logged and never fails the run.
- **Service:** rotates the scope only when the adapter's scope fields change (a display-only change, such as a Lever or Workday fallback company name or the SmartRecruiters page size, does not).
- **Facts** (`packages/core/src/posting-history.ts`): `derivePostingHistoryFacts`, `listingStatus`, `isNoLongerListed`, `isRecentlyListed`.
- **UI:** a "Posting history" section on the opportunity page; a "No longer listed" dashboard badge (SQL equal to `isNoLongerListed`); an evaluation warning, not a block; "Read the whole list" / "Limited window" and tracked-listing counts in `/sources` run history.
- **No change** to `loadSubject()`, the evaluator, ingestion, `core-dedup-v2` or adapter retrieval behaviour.

**Tests.**

- **Unit:** new `posting-history.test.ts` (18): coverage below/above/equal to a stated total, a missing ID, Greenhouse IDs before the title filter, Lever/Ashby coverage, SmartRecruiters and Workday conditional completeness (cap, halt, shift, unsafe path), the removal-capability matrix, scope fields, every fact rule including the content-only `UNCHANGED_OVER_TIME`, the evaluator-schema contract test, listing status and badge rules, the worker's qualifying decision, and the service's rotation. `retrieval-ui.test.tsx` (+2) covers the section's wording and the badge.
- **Integration:** new `posting-history.test.ts` (8): removal after two complete misses ≥ 24 h apart (not sooner; a total mismatch run ignored), the dashboard badge, no lifecycle change and reappearance; a title change keeping a listing LISTED while `Opportunity.lastSeenAt` moves and `SourceRecord.lastObservedAt` does not; a bounded source never removing; **A → B → A** giving three scope keys with no inherited history; the migration's backfill SQL producing HISTORICAL rows; baseline adoption (seen → LISTED keeping `firstSeenAt`, absent → stays HISTORICAL); baseline UNTRACKED when a scope change comes first; and `loadSubject()` unchanged.
- **E2E:** `retrieval.spec.ts` (+1): a complete Greenhouse fixture board shrinks across two runs a day apart (helper clock), the dashboard shows "No longer listed", the opportunity page shows the history and an evaluation warning with the button still enabled, and the listing is "Listed again" after a later run.

**Verification** (isolated test database only; no live source requests; no AI or provider calls; normal application database untouched):

- typecheck and lint clean; `git diff --check` clean;
- unit 52 files / 1,313 tests; integration 28 files / 251 tests; E2E 37/37; production build succeeds; `pnpm db:verify-migrations` (19 migrations, only the known documented drift; it caught an over-long unique-index name, corrected before closeout, and the test database's copy of the migration was rolled back and re-applied);
- `apps/web/next-env.d.ts` unchanged.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/` (the blobs match `HEAD`):

- **Core Platform TDD v1.11:** a §51 "Posting History and Listing Removal (Feature 13)" section (four paragraphs), the sequence and the dependency.
- **Core AI Framework PRD v1.10** and **Customer Success PRD v1.9:** current status, revision history and dependencies.
- **Customer Success TDD v1.9:** status, the §45 and §49 Ghost Job Risk notes annotated, and the dependencies.

The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- The committed Greenhouse fixture states `meta.total` 232 for three jobs, so ordinary fixture runs are (correctly) incomplete; the E2E uses a consistent whole-board variant.
- SmartRecruiters and Workday confirm removal only for employers whose total fits the run's window (500 and 100 postings); larger employers record sightings only.
- `UNCHANGED_OVER_TIME` for SmartRecruiters and Workday advances only when a listing gets one of the 25 detail requests per run.
- Pre-feature-13 listings that are no longer live stay "current status unknown" (HISTORICAL) indefinitely, by design.
- A code change to a configuration-free adapter's fixed query must rotate its sources' scopes explicitly (documented in the adapter contract); no such change exists today.

### Feature 12 — source health and conservative retrieval (committed `f10a02b`, October 18, 2026)

*(Heading updated on October 19, 2026 after the commit; it read "implemented and verified October 18, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Scope (approved).** Deterministic source health and conservative retrieval around the existing adapters: no adapter or contract redesign, no in-run retries, no automatic disabling, no live source requests and no AI calls. Listing expiry/removal detection moved to feature 13 (DEVELOPMENT_PLAN updated). Out of scope: features 13–15 and evaluator changes.

**Approved decisions.**

- Access, contract, settings and oversized-response failures use long deterministic backoff (at least a day, escalating to at most once per 7 days); no auto-disable and no manual repair step.
- Internal backoff is capped at 7 days. A valid provider Retry-After (429, or 503 with Retry-After) is honoured in full with no cap: the gate is the later of it and the backoff. Invalid, unparsable, zero, negative or past values fall back to the deterministic policy.
- A successful retrieval is COMPLETED, or PARTIAL caused solely by `LISTING_FAILURES`; a PARTIAL caused by a source failure never counts as success or clears the failure state.
- Within a run, any 5xx stops further requests to that host (not only a 503 with Retry-After). Across runs, the first transient failure keeps the normal schedule, repeats escalate, and a valid Retry-After extends the gate.
- A 429 is a rate limit ("Rate limited until …", `SOURCE_RATE_LIMITED`); a 503 with Retry-After is a generic provider wait ("Retry after … (requested by the source)", `SOURCE_PROVIDER_WAIT`). Both are non-bypassable. When our backoff outlasts the source's date, the gate is a provider wait until `retryAfterUntil` and then our backoff, which can be overridden.
- Run now: our own backoff only through an explicit "Run now anyway" (one run; its outcome recalculates the gate). A settings change clears only our own backoff, never a rate limit or provider wait; enable/disable never touches any gate.
- Schema: `RetrievalSource.nextEligibleAt` plus `RetrievalRun.retryAfterUntil` (the flagged, accepted deviation), both nullable; everything else derived from runs. Stale = no successful retrieval for 2× the schedule; disabled/archived sources stay neutral; zero results are informational.

**What changed.**

- **Transport and adapters** (`packages/discovery`): `SERVER_ERROR` for 5xx (`ensureSuccess`); `parseRetryAfter` and `TransportResponse.retryAfterSeconds` (429/503); politeness stops a host after any 5xx and carries Retry-After on the stop error; `isStopError()` used where SmartRecruiters and Workday stop detail requests.
- **Policy** (`packages/core/src/retrieval-health.ts`): `classifyRunOutcome` (success / source failure / neutral / active), `failureStreak`, `computeNextEligibleAt`, `activeGate`/`gateKind` (rate_limited, provider_wait, backoff) and `deriveSourceHealth` (status, streak, last attempt, last success, latest failure, gate, next run, stale, never succeeded, empty result).
- **Migration** `20261018120000_retrieval_source_health`: two nullable `TIMESTAMPTZ(3)` columns, no backfill.
- **Repository:** `finishRun` writes the run (with `retryAfterUntil`) and the gate in one transaction, never shortening a gate still in force after a failure; `enqueueDueRuns` skips gated sources; `enqueueRun(id, trigger, { override, now })` refuses with `SOURCE_RATE_LIMITED`, `SOURCE_PROVIDER_WAIT` or `SOURCE_BACKING_OFF` (with `until`); `update` clears only a backoff gate on a settings change; `healthInputs`.
- **Worker:** passes the failure's `retryAfterSeconds` to `finishRun`; safe message for `SERVER_ERROR`.
- **Service/API:** `health` on every source summary; `runNow(id, { override })`; `POST /api/sources/<id>/runs` takes an optional `{"override": true}`; refusals are 409 with `code` and `until`.
- **UI** (`/sources`): health badge, last attempt, last successful retrieval, next run and why, latest failure, stale/never-succeeded/empty-result notes; Run now disabled with distinct 429 and provider-wait wording; a "Run now anyway" confirmation for backoff.
- **`pnpm app:doctor`:** a read-only "Retrieval source health" check listing enabled sources that are rate limited, waiting, failing, need attention or are stale.
- **No change** to adapter contracts beyond the shared stop rule, ingestion, `core-dedup-v2`, the evaluator or `loadSubject()`.

**Tests.**

- **Unit:** new `retrieval-health.test.ts` (29): outcomes and streaks, every backoff family, uncapped Retry-After, the mixed provider/backoff gate, health statuses (PARTIAL-by-429 not refreshing freshness, neutral runs, disabled/archived neutral, stale, never succeeded, zero results), `parseRetryAfter`, Retry-After on 429/503 only, politeness stopping after any 5xx, `isStopError`, the worker passing Retry-After and the `SERVER_ERROR` message, service and API Run now rules, and the doctor check. `retrieval-ui.test.tsx` (+3): health lines, distinct gate wording with Run now disabled, and the "Run now anyway" confirmation. Adapter tests now cover 500/503 page stops and 5xx detail stops for SmartRecruiters and Workday; the framework test expects `SERVER_ERROR` for 5xx.
- **Integration:** `retrieval-ingestion.test.ts` (+4): a 60-day Retry-After honoured in full (scheduler, override, settings and enable/disable cannot pass it); a 503 provider wait turning into overridable backoff after its date and cleared by a settings change; access-refusal backoff escalating 1 → 2 → 4 days with an override run, a neutral interrupted run ignored and success clearing the gate; and a PARTIAL run stopped by a 429 never counting as a successful retrieval. The existing access/rate-limit test now needs an explicit override for its second run.
- **E2E:** `retrieval.spec.ts` (+1): a fixture 429 with Retry-After shows "Rate limited until …" with Run now disabled and the API refusing even with an override; after the gate expires (helper), a successful run shows Healthy.

**Verification** (isolated test database only; no live source requests; no AI or provider calls; normal application database untouched):

- typecheck and lint clean; `git diff --check` clean;
- unit 51 files / 1,293 tests; integration 27 files / 243 tests; E2E 36/36; production build succeeds; `pnpm db:verify-migrations` (18 migrations, only the known documented drift);
- `pnpm app:doctor` run read-only against the test database (its new queries execute);
- `apps/web/next-env.d.ts` unchanged.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/` (the blobs match `HEAD`):

- **Core Platform TDD v1.10:** a §51 "Source Health and Conservative Retrieval (Feature 12)" section (four paragraphs), the sequence and the dependency.
- **Core AI Framework PRD v1.9**, **Customer Success PRD v1.8** and **Customer Success TDD v1.8:** current status, revision history and dependencies.

The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- Health is derived per request from the latest 20 runs and the last successful run; `/sources` reads them per source (fine for the expected handful of sources).
- A settings change is detected by comparing the stored and submitted configuration; the `/sources` UI has no settings editor, so this path is used through `PATCH /api/sources/<id>`.
- The gate is checked when a run is queued, not again when the worker claims it; since a source has at most one queued or running run and the gate changes only when a run finishes, a queued run cannot be overtaken by a new gate.
- Listing expiry/removal detection is feature 13.

### Feature 11B — automated retrieval from the verified public/guest-endpoint and public-HTML sources (committed `2a1d8c2`, October 18, 2026)

*(Heading updated on October 18, 2026 after the commit; it read "implemented and verified October 18, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Scope (approved).** The remaining non-browser Customer Success sources, on the Feature 11A framework without redesigning it: Workday and Workable (Type #3, public/guest endpoints) and Wellfound (Type #4, public HTML). Welcome to the Jungle / Otta (Type #3) is in scope but could not be verified. ProBlogger and Mediabistro, listed in Core Platform TDD §10, are Freelance Writing domain sources and not part of 11B. Out of scope: features 12–15, evaluator changes, automatic evaluation and description-based discovery.

**Live verification** (each request approved individually; no retries, alternate endpoints or probing; raw responses kept outside Git):

- **Workday** (target `https://workday.wd5.myworkdayjobs.com/Workday`, stateless: no cookies or session values):
  - the career-site document is an application shell whose configuration names `tenant: "workday"`, `siteId: "Workday"`, `appName: "cxs"`;
  - `POST /wday/cxs/workday/Workday/jobs` with `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` returned `{total: 386, jobPostings[20], facets, userAuthenticated: false}`. Each posting has only title, externalPath, locationsText, relative postedOn, remoteType and the requisition;
  - the posting detail `GET /wday/cxs/workday/Workday<externalPath>` returned the complete HTML description, locations, `startDate`, `timeType`, `jobReqId`, `externalUrl` and `hiringOrganization.name`;
  - page 2 (`offset` 20) returned 20 new postings with `total` 0: Workday reports the total on the first page only.
- **Wellfound:** `GET https://wellfound.com/jobs` returned a curated featured-jobs page (no descriptions or paging), so it is not a discovery page. The approved role page `https://wellfound.com/role/customer-success-specialist` returned usable logged-out HTML whose Next.js state holds the results (`totalJobCount` 335, `pageCount` 11, 20 companies per page) and 39 listings with complete descriptions.
- **Workable:** this environment's only request was rate-limited (HTTP 429, `Retry-After` 19517), a network/reputation condition: another network and your local environment reached the same endpoint. Your local verification established the contract: `{title, totalSize: 3156, nextPageToken, jobs[20], autoAppliedFilters}`, page 2 by `pageToken=<nextPageToken>` (20 jobs, same total, no overlap). You supplied both raw pages to this session for the fixture. The official XML feed (`workable.xml`: public, `application/xml`, 849,816,782 bytes, Range ignored; a bounded 256 KB sample held 79 complete job records with full descriptions) was compared and kept as a documented contingency only.
- **Welcome to the Jungle / Otta:** the logged-out search `GET https://www.welcometothejungle.com/en/jobs?query=customer%20success` returned HTTP 200, unblocked, but a sign-up and matching flow: no listings in markup or embedded state, and no anonymous listing endpoint, GraphQL operation, paging, job IDs or fields. Verification stopped there by decision.
- **Offline check:** every adapter maps every item of its full real responses with no contract issues: Workday's 20 postings (with the verified detail), Wellfound's 39 listings and both 20-job Workable pages.

**What changed.**

- **Framework** (`packages/discovery`):
  - a JSON POST transport method (`post`, `postJson`) with the existing ceiling, timeout, User-Agent, no-cookie and no-redirect rules, politeness and status handling; the fixture transport keys POSTs by URL and body (`fixtureRequestKey`);
  - adapter options `minRequestIntervalMs`, `maxPagesPerRun` and `verificationBody`, passed through the worker's transport factory and `pnpm sources:verify`;
  - `prioritizeDetailRequests` moved into `collection.ts` and shared by SmartRecruiters and Workday (unchanged behaviour);
  - `readJsonScript` for embedded JSON state, and `markdownToText` in the normalization package.
- **Workday adapter:** configured by "Career site address" (validated `https://<tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>`; only those hosts) and an optional company name used only when a detail names no hiring organization (then recorded as `sourceConfiguration.company`).
  - Paging by offset up to 5 pages: a bounded window of the first 100 postings the listing endpoint returns. Workday does not state the order (the verified pages looked newest first, which is not relied on). Paging stops on a short page, the first page's total or the cap; a posting shifted between pages is read once.
  - Detail requests for title matches only, at most 25 per run, unseen postings first (among those, later list positions first, as no posting dates are listed); posting paths must be `/job/...` on the same site.
  - Listing ID `<tenant>/<site>:<externalPath>`; `jobReqId` as the requisition; the posting date from `startDate`; Remote/Onsite mapped, Flex kept as source data; pay ranges left in the description; `postedOn`, `timeLeftToApply` and `similarJobs` excluded from change detection (and `similarJobs` not stored).
- **Workable adapter:** no configuration; the search for "customer success"; `pageToken` paging up to 5 pages (a bounded relevance-ordered window, not newest first); the complete text joined from `description`, `requirementsSection` and `benefitsSection`; `TELECOMMUTE` treated as a remote marker, not a place; `workplace` mapped (remote, on_site, hybrid); the `created` date; `updated`, `totalSize`, `nextPageToken` and `autoAppliedFilters` not material.
- **Wellfound adapter:** no configuration; the built-in role page only; the embedded `__NEXT_DATA__` state parsed (a page without it is a contract mismatch, never a guess); `?page=N` up to the verified `pageCount`, capped at 11 pages, at least 2 s apart; no job-page requests; Markdown-style descriptions converted to plain text; duplicate location names removed; only explicit REMOTE/ONSITE kinds mapped; compensation, `atsSource` and remote fields kept as source data; bookmark flags, logo URLs, badges, page position and counts not material.
- **Welcome to the Jungle / Otta adapter:** registered (Type #3, job board), unverified, cannot be enabled; collecting throws a configuration error.
- **Fixtures** (`tests/fixtures/sources/`): `workday/` (page 1, page 2 and the complete detail), `wellfound/` (the role page reduced to its title and embedded state, three listings) and `workable/` (pages 1 and 2, three jobs each), each with `meta.json`: requests, capture times, full-response sizes and SHA-256, "3 of N items", selection reasons and personal-data scans. No sanitization was needed; the Workday detail keeps the employer's published accommodations address.
- **No change** to the schema, migrations, the capture repository, the retrieval worker's ingestion, `core-dedup-v2`, `/sources` UI code, the evaluator or `loadSubject()`.

**Decisions recorded (user-approved).**

- Workday: the target tenant above; tenant/site + externalPath identity; company from the detail with an optional fallback; Flex never hybrid; `startDate` as posting date; no salary from multiple ranges; volatile fields not material.
- Wellfound: the verified role page only (no role-slug field); an 11-page source cap (more is documented partial coverage); a 2-second interval; no detail requests; compensation as source data.
- Workable: the JSON search as the sole production interface, Type #3 unchanged; XML a documented contingency only; no further Claude-cloud retry required.
- Welcome to the Jungle / Otta: registered but unverified for 11B; no per-company reinterpretation; reconsider with feature 14.
- The JSON POST transport extension, because Workday's verified contract requires it.

**Tests.**

- **Unit:** `retrieval-adapters-11b.test.ts` (26): Workday (configuration parsing, mapping, workplace and company rules, tenant-scoped IDs, change detection, path safety, offset paging with the first-page total, detail priority and stops), Workable (mapping, combined text, TELECOMMUTE, token paging, stops, change detection) and Wellfound (state parsing, title filter, paging and cap, contract-mismatch cases, change detection), and Welcome to the Jungle registered but unverified. `retrieval-framework.test.ts` (39) adds the JSON POST, fixture keying, POST politeness, embedded state and Markdown tests; `retrieval-worker-service.test.ts` (13) adds the adapter interval and page cap; `retrieval-adapters.test.ts` (47) is unchanged in count.
- **Integration:** `retrieval-ingestion.test.ts` (16) adds the real Workday, Workable and Wellfound fixtures through the worker: tenant-scoped records with a shared requisition attached, unchanged re-runs despite daily-changing fields, marketplace and job-board provenance, and no evaluation rows.
- **E2E:** `retrieval.spec.ts` (3) adds Workday, Workable and Wellfound sources added and run from `/sources`, "Found via" on the dashboard, provenance on the opportunity page, and Welcome to the Jungle unable to be enabled.

**Verification** (isolated test database only; no paid provider calls; no live production worker; normal application database untouched):

- typecheck and lint clean; `git diff --check` clean;
- unit 50 files / 1,261 tests; integration 27 files / 239 tests; E2E 35/35; production build succeeds;
- `apps/web/next-env.d.ts` reverted after each Next run.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/` (the blobs match `HEAD`):

- **Core AI Framework PRD v1.8** and **Customer Success PRD v1.7:** current status and dependencies.
- **Core Platform TDD v1.9:** a §51 "Automated Retrieval: Type #3 and Type #4 Sources (Feature 11B)" summary, the sequence and the dependency.
- **Customer Success TDD v1.7:** the dated §8 implementation note, the sequence and the dependencies.

Each `.docx` passes the validator against its source. The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- **Welcome to the Jungle / Otta** is unverified and cannot be enabled (see above).
- **Coverage windows:** Workday reads the first 100 postings its listing endpoint returns per run (5 pages of 20; the order is not stated), Workable a bounded relevance window (up to 5 pages), Wellfound up to 11 pages (the current page count). Beyond them is out of scope for 11B.
- **Workable rate limiting** depends on the network the worker runs from; a 429 stops the run, and Retry-After/backoff is feature 12.
- **Wellfound** may block non-browser clients in future; a 403 or a page without the verified state stops the run.
- **Test database cluster:** it stopped again after environment restarts and was restarted; one E2E attempt failed only for that reason and passed on rerun.
- **E2E log line:** the full run logged one dev-server "destination stream closed early" message during an evaluation-results test unrelated to retrieval; all tests passed.

### Feature 11A — automated retrieval from the verified official API and feed sources (committed `fad2341`, October 18, 2026)

*(Heading until October 18, 2026: "implemented and verified October 18, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Scope (approved).** Feature 11 is split into two acceptance units. 11A is the collection framework, the Type #1 adapters, source and run storage, the retrieval worker, normalization of retrieved listings, cross-source deduplication, canonical-link selection, re-observation and change detection, the `/sources` UI and basic politeness and safety. 11B covers the verified Type #3/#4 sources (Workday, Workable, Welcome to the Jungle / Otta, Wellfound). These stay out of 11A: source health, backoff and freshness (feature 12); posting history and Ghost Job Risk input (feature 13); LinkedIn and browser-assisted sources (feature 14); and source-quality analytics (feature 15).

**Live verification** (one approved request per source; no retries, alternative endpoints or probing; raw responses kept outside Git):

- **Network:** the environment allowlist initially blocked every host at the proxy (October 17), so nothing reached a source. After the allowlist was saved, a single Greenhouse canary request succeeded, and then one request was made to each remaining source.
- **Verified:**
  - Greenhouse `gitlab`: 232 jobs, about 3.65 MB.
  - Lever `palantir`: 310 postings, about 6.0 MB.
  - Ashby `ashby`: 63 jobs.
  - Remote OK: 99 jobs plus the API terms notice.
  - We Work Remotely: the customer-support category feed, 61 items.
  - Himalayas: page 1, then one approved page-2 request with the documented `nextCursor`, which confirmed the same contract with no overlap.
  - Working Nomads: 49 jobs.
  - SmartRecruiters: the first target, `Visa`, returned an empty board, so it was stopped. The approved replacement, `BoschGroup` (5,079 postings), was verified with one list request and one detail request. At the closeout check, one further approved request (`?limit=10&offset=10`) verified offset paging: the response echoed offset 10 and limit 10, `totalFound` was unchanged, and its 10 postings did not overlap page 1 and continued page 1's newest-first order. Three of its postings are the page-2 fixture.
- **Offline check:** every adapter maps every item of its full real response with no contract issues, and every listing passes the retrieved-listing normalizer.
- **Fixtures** (`tests/fixtures/sources/<source>/`): at most 3 items per response, structure preserved, with a `meta.json` (request, status, content type, capture time, full-response size and SHA-256, "3 of N items", selection reasons and a personal-data scan).
  - No sanitization was needed. Postings with a named hiring manager (Ashby) or a recruiter `creator` name (SmartRecruiters) were left out.
  - Two organizational contact mentions were kept and recorded: `accommodations@palantir.com` and a `@gong.io` domain.

**What changed.**

- **Collection framework** (`packages/discovery`): the `SourceAdapter` contract, which collects and never judges suitability.
  - **Transport:** injectable, with an identifying User-Agent, a 20 s timeout, a hard 10 MB ceiling (refused, never truncated; raised from 5 MB after the 3.65 MB Greenhouse response), no cookies and no redirects followed.
  - **Politeness:** within a run, requests to a host are serialized at least 1 s apart. A 429 is `RATE_LIMITED` and a 401/403 is `ACCESS_DENIED` (an access failure, not a rate limit); either stops that host for the run.
  - **Other pieces:** credentials redacted from errors and logs, a minimal RSS reader, title-term matching and a content hash.
- **Adapters:** Greenhouse, Lever, Ashby, SmartRecruiters (employer ATS); Remote OK, Himalayas, Working Nomads (aggregators); We Work Remotely (job board). Adzuna is registered, unverified and cannot be enabled. Notable mappings:
  - **Greenhouse:** content arrives HTML-escaped once more; `updated_at` is metadata only.
  - **Lever:** description + lists + additional are joined into one document.
  - **Lever and Ashby:** neither returns an employer name, so "Company name" is a required source field, and field provenance records `sourceConfiguration.company`.
  - **Ashby compensation:** salary is normalized only for a single published tier. Multi-tier and mixed-currency summaries are kept as source data, never normalized.
  - **Remote OK:** salaries carry no currency, so they are source data only. The required attribution links back without `nofollow`.
  - **We Work Remotely:** "Company: Title" is split, and the `guid` is the identity.
  - **Himalayas:** cursor paging up to the page cap. Location and time-zone restrictions are source data only.
  - **Working Nomads:** the identity comes from the URL number.
  - **SmartRecruiters:** the list is paged by offset up to the 5-page cap, so a run sees at most the newest 500 postings (100 per page); older postings are out of scope for 11A. Titles are filtered from the list before any detail request. Details (whose `jobAd.sections` give the full HTML) are capped at 25 per run: postings never stored from the source go first, oldest first, then stored postings, longest since last checked first, so stored postings take turns and never displace unseen ones. A posting shifted onto the next page while paging is read once. Only an explicit remote or hybrid flag sets a workplace type.
- **Discovery terms** (Customer Success domain, CS TDD §6): a listing is kept only when its title contains a core-family name (Customer Success, Client Success, Member Success) or an adjacent term as a whole phrase. The description is never used to keep a listing, and the full description is preserved.
- **Normalization** (`createRetrievedOpportunityNormalizer`): structured facts get DIRECT provenance and text-derived facts DETERMINISTIC. Salary amounts count only as one annual range with a recognized currency. Residency is read only from explicit statements; a time-zone requirement is never inferred. Source items are stored under `rawPayload.source`.
- **Persistence** (migration `20261018090000_retrieval_sources`, additive):
  - `RetrievalSource` and `RetrievalRun`;
  - `SourceRecord` gains retrieval type/category, source and run links, `contentHash` and `previousSourceRecordId`.
  - Foreign keys restrict deletion, so a source or run with records is archived; only a source that never produced anything is deleted.
- **Ingestion** (inside the existing capture transaction and lock):
  - **Same source and listing ID:** an unchanged hash only moves last-seen times. A changed hash adds a linked observation; the original record and the canonical description are left unchanged.
  - **Anything else** goes through the deduplication path.
  - **On an attach,** the application link moves to a strictly higher-precedence source (ATS/careers > job board/marketplace > aggregator) with provenance; a manual link is never replaced.
  - **Hashed fields:** the hash covers material fields only. Fetch times, counters, tracking parameters and source update stamps are not part of it.
- **Deduplication engine `core-dedup-v2`** (approved contract change): source listing IDs are scoped by source, and differing IDs conflict only within one source. Manual-only behavior is unchanged; earlier evidence keeps its v1 label.
- **Worker** (`pnpm worker:retrieval [--once]`): single-worker advisory lock (41220/4), SKIP LOCKED claim with a lease, and startup recovery of interrupted runs.
  - **Detail priority:** adapters get an optional last-checked lookup (`lastCheckedListings`: the latest `lastObservedAt` per source listing ID, scoped to the adapter key), which the SmartRecruiters adapter uses to order its detail requests.
  - **Schedule:** 12-hour default. A newly enabled source that has never run is due at the next poll.
  - **Isolation:** each listing is ingested in its own transaction.
  - **Run results:** `COMPLETED`, `PARTIAL` or `FAILED`, each with a safe error code.
  - **No evaluation:** retrieval never creates an evaluation, admission or deferral.
- **Verification command** (`pnpm sources:verify <adapter> --config '<json>' (--raw-dir <outside repo> | --offline <dir>)`): makes an adapter's single verification request (plus a derived follow-up), saves the raw response outside the repository and checks the mapping offline. It touches no database.
- **UI and API:**
  - **`/sources`:** add, configure, enable, disable, Run now, run history, remove/archive and restore, plus the Sources link in the navigation.
  - **API:** `/api/sources` (`GET`, `POST`); `/api/sources/[id]` (`GET`, `PATCH`, `DELETE`); `/api/sources/[id]/runs` (`GET`, `POST`); `/api/sources/[id]/restore` (`POST`).
  - **Opportunity page:** "Found via …", the retrieval source and run, the attribution link and a "Listing changed since first seen" notice.
  - **Dashboard rows:** "Found via …" and a "Listing changed" badge.
  - **`pnpm app:doctor`:** read-only retrieval checks.
- **Configuration:** `.env.example` documents `RETRIEVAL_WORKER_POLL_MS`, `RETRIEVAL_USER_AGENT`, `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`. No new third-party dependency.

**Decisions recorded (user-approved).**

- **Verification targets:** `gitlab`, `palantir`, `ashby`, and `BoschGroup` replacing `Visa`. They serve fixture verification only and are never persistent sources.
- **Schedule and enabling:** 12-hour schedule with every source disabled by default. A source becomes due as soon as it is first enabled. Run now is available only for enabled sources.
- **Limits:** a 10 MB hard response ceiling. Himalayas cursor paging up to the page cap.
- **SmartRecruiters coverage** (closeout check): offset paging up to the existing 5-page cap, and detail-request priority within the existing 25-request cap (unseen postings first, oldest first; then stored postings by oldest last check). Neither cap was raised. Coverage is bounded to the newest 500 postings visible through the verified list interface per run.
- **Company name and compensation:** a required company-name field for Lever and Ashby; the conservative Ashby compensation rule.
- **Adzuna:** stays unverified and disabled. The excerpt-only description is an open issue, not a reason to weaken the complete-description contract.

**Tests.**

- **Unit:**
  - `retrieval-framework.test.ts` (34): HTML-to-text, title terms, RSS, the content-hash cases (volatile metadata gives no change, description and structured-field changes do, identical content is idempotent), transport classification, the 10 MB ceiling, politeness, the normalizer, scoped IDs and link precedence.
  - `retrieval-adapters.test.ts` (47): every verified adapter against its fixture, including Himalayas page 2 and the SmartRecruiters detail; SmartRecruiters offset paging against the verified page 2 (page cap, short or empty page, `totalFound`, a shifted posting read once, a 429/401/403 on a later page stopping everything, another later-page failure keeping what was read); and detail priority (unseen before stored, oldest unseen first, stored by oldest last check, rotation, the cap always respected).
  - `retrieval-worker-service.test.ts` (12), including a 401 run outcome and the last-checked lookup scoped to the adapter key, and `retrieval-ui.test.tsx` (8); a Sources entry in the navigation test.
- **Integration:** `retrieval-ingestion.test.ts` (13) on the isolated test database, covering:
  - the first run, idempotent reruns and volatile-only changes;
  - linked changed observations;
  - cross-source attach with the link upgrade, and a manual link never replaced;
  - probable matches and scoped IDs;
  - per-listing failure isolation;
  - access versus rate-limit failures;
  - the real Greenhouse fixture through the worker;
  - SmartRecruiters detail priority through the worker and repository over seven runs: unseen postings first (oldest first), stored postings rotating by last check, and a new posting going ahead of every stored one;
  - one active run per source and a single claim;
  - scheduling and archive-instead-of-delete;
  - no evaluation rows ever created.
- **E2E:** `retrieval.spec.ts` (2): add Greenhouse on `/sources`, enable it, Run now, check the run history, "Found via Greenhouse" on the dashboard and provenance on the opportunity page; then a changed listing flagged on both, and archiving a source with history.

**Verification** (isolated test database only; no paid provider calls; no live production retrieval worker; no normal application database in this environment):

- typecheck and lint clean; Prisma schema valid; `db:verify-migrations` 17/17 (only the documented drift);
- unit 49 files / 1,218 tests; integration 27 files / 235 tests; E2E 34/34 across all five projects; production build succeeds; `git diff --check` clean;
- `pnpm app:doctor`: no blocking problems; the retrieval checks are read-only.
- **Fixture-transport browser walkthrough:**
  - all eight sources were added, enabled and run from `/sources`: 7 listings created, the counts shown in run history, and dashboard rows showing "Found via".
  - The Greenhouse provenance, the Remote OK attribution link (followed, no `nofollow`) and a changed-listing notice were all shown.
  - At 390 px, `/sources`, the opportunity page and the dashboard measure 390 px wide.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/` (the blobs match `HEAD`):

- **Core AI Framework PRD v1.7:** §31 status and planned work.
- **Customer Success PRD v1.6:** §23 status, the implemented employer-ATS link preference, and the dependency.
- **Core Platform TDD v1.8:**
  - a §51 "Automated Retrieval (Feature 11A)" summary, including the SmartRecruiters 500-posting window and detail-request priority;
  - the `core-dedup-v2` wording;
  - the merging and cross-source sentences;
  - the sequence and the dependency.
- **Customer Success TDD v1.6:**
  - dated implementation notes in §6–§8: the title-matching rule; title-only discovery, so the semantic and responsibility-based discovery of §7 is not implemented at discovery time; and the implemented sources;
  - a §49 paragraph on retrieved opportunities and the unchanged evaluator;
  - the planned work and the dependencies.

Each `.docx` passes the validator against its source, and the text comparison shows only these changes. The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- **Adzuna** is unverified (no credentials), and its description is excerpt-only.
- **Pagination:** SmartRecruiters coverage is bounded to the newest 500 postings visible through its list per run (5 pages of 100); postings outside that window are out of scope for 11A. Within it, up to 25 details per run, so a burst of matches takes several runs to work through. Remote OK, Working Nomads, We Work Remotely, Greenhouse, Lever and Ashby return their whole feed or board in one response.
- **Description-only roles:** a listing whose title has no role-family term is not retrieved even when its description is Customer Success work (CS TDD §7, by decision).
- **Retrieval is exercised only with the fixture transport.** It has never run live against real sources, and no production worker has been run.
- **Test database cluster:** it stopped several times when the environment restarted, and was restarted each time; no data was lost.
- **Date dependence:** one integration test assumed the real date was earlier than its fixed test clock, and is now direction-independent.
- **pg warning:** the pg "client.query() when the client is already executing a query" warning still appears in integration and E2E runs. It is pre-existing (see the gap-closure record); the retrieval tests produce none.


### Features 1–10 Gap Closure (committed `d573acf`, October 17, 2026)

*(Heading until October 18, 2026: "implemented and verified October 17, 2026; implementation and verification approved by the user; awaiting the commit approval". The record below is preserved as written.)*

**Audit (read-only, approved October 17, 2026).** Features 1–10 were checked against Core AI Framework PRD v1.5, Core Platform TDD v1.6, Customer Success PRD v1.4 and Customer Success TDD v1.4, in code, with targeted tests and in a browser walkthrough on the isolated test database.

- Complete: feature 1 (dashboard), feature 4 (application tracker), feature 5 (saved/rejected/archived), feature 8 (source/provenance, for manual capture) and feature 10 (backlog and budget-aware evaluation).
- Gaps found and approved for closure:
  - **G1**, feature 9: deduplication was missing. The package was an interface stub and `DuplicateReference` was unused, so an identical re-capture became a second opportunity that could be evaluated, and paid for, again.
  - **G2/G3**, features 2 and 8: every capture created its own `Company` row and `normalizedName` was never filled. The company filter therefore listed one company once per opportunity, and choosing one entry showed one job.
  - **G4**, feature 3: history rows did not show the versions behind each evaluation.
  - **G5**, feature 6: the time-zone requirement could never be anything but Unknown.
  - **G6**, feature 7: AI usage and spend were not broken down by domain and job source (Core PRD §20, Core TDD §38).
  - **G7**: horizontal overflow at phone width on the opportunity page and `/profile`.
- Boundaries accepted:
  - to feature 11: structured location, posting history, retrieval/source-specific metadata, cross-source deduplication and the merging of opportunities that already have history;
  - to features 15–17: the analytics event stream and opportunity-view events;
  - evaluator-internal changes: out of scope, recorded only.

**What changed.**

- **Deduplication engine** (`packages/deduplication`, version `core-dedup-v1`). Pure and deterministic; it holds no product data.
  - **MATCH:** the same listing URL with nothing conflicting, or the same source job or requisition ID at the same company. URL keys ignore case, `www.`, trailing slashes, tracking parameters and parameter order. A shared URL with a different title, company or job ID drops to a probable match.
  - **PROBABLE_MATCH:** the same normalized company, scored as 0.5 × title + 0.2 × location + 0.3 × description token similarity, minus 0.1 for non-overlapping salary ranges in one currency; threshold 0.6. A shared ID without both companies known also counts.
  - **Canonical opportunity:** the earliest-seen exact match.
- **Capture.**
  - **Transaction:** normalization runs in memory first. One transaction then holds a capture advisory lock and writes the raw `SourceRecord` first, then the duplicate decision and either a new `NORMALIZED` opportunity (with field provenance and any duplicate references) or the attachment of that `SourceRecord` to the existing opportunity.
  - **On failure:** a failure rolls back everything, so nothing is half-processed or orphaned. A capture whose normalization fails still preserves its raw `SourceRecord` unlinked, as before (Core TDD §11).
  - **Exact duplicates are attached by default.** The canonical opportunity's fields, lifecycle, evaluations and application do not change; only `lastSeenAt` moves. `POST /api/opportunities` returns 200 with that opportunity.
  - **The form asks first,** through the read-only `POST /api/opportunities/duplicate-check`. "Save as a separate opportunity" creates the opportunity and records the pair as `DISTINCT`.
  - **Probable matches** create the opportunity and record up to three warnings. Nothing is ever merged on a probable match.
- **Company reuse.** A capture links to the oldest company with the same normalized name. Companies that have not been backfilled are compared without being changed. Stored names are never rewritten; the spelling the user typed stays in `SourceRecord.rawCompany` and the `company.name` field provenance.
  - Normalization ignores case, width, punctuation, `&` and one recognized trailing legal-entity suffix (Inc, LLC, Ltd, Limited, Corp, Corporation, GmbH, PLC, LLP, LP, AG, SA, BV, NV, Pty Ltd, Pvt Ltd, Private Limited). Business words are never removed.
- **Dashboard company filter.** There is one entry per normalized company, with the combined count; orphan companies are excluded. The `company=` parameter takes the normalized name. An older company-id link selects that company's whole group, and a company not yet backfilled still filters by its id.
- **Backfill.** `pnpm db:backfill-dedup [--dry-run]` is explicit, additive and idempotent.
  - It fills only empty `Company.normalizedName` values and records missing `DuplicateReference` rows among existing opportunities.
  - It never renames, merges, deletes or re-links anything, and never changes an existing relationship.
  - It is not part of `pnpm app:setup`. `pnpm app:doctor` stays read-only and reports how many companies still need it.
  - Orphan companies (left only by test cleanup; the product has no delete path) are kept, excluded from views, and reused by later captures.
- **Duplicate-spend guard** (feature 10, Core TDD §33). A paid evaluation request, or a deferred resume, is refused with 409 `DUPLICATE_LISTING_ALREADY_EVALUATED` when all of the following hold:
  - the opportunity has never completed an evaluation;
  - an unresolved exact duplicate (detected live, or stored and not `DISTINCT`) already has a completed, queued or running evaluation, a live admission or an open deferred request.

  Behavior around the guard:
  - A refused resume leaves the deferral open and writes nothing.
  - Probable matches and pairs marked `DISTINCT` are never blocked, and an opportunity's own reevaluation is never blocked.
  - **The race is closed:** the check and the admission, evaluation or deferral it allows run under a session advisory lock on a dedicated connection (`withDuplicateSpendLock`). The Task 6 admission gate is unchanged. Without the lock, a test of simultaneous requests for two duplicates admitted both; with it, exactly one is admitted in every round.
  - The existing stale-state checks (archived or closed, missing pinned profile, already active) are unchanged.
- **"Not the same job" is reversible.** `POST /api/opportunities/[id]/duplicates` sets `DuplicateReference.resolution` to `DISTINCT` or clears it (Undo). A detected pair without a stored row is stored with the engine's decision.
- **UI.**
  - the capture form's match panel;
  - a "Duplicates" section on the opportunity page (the attached-capture notice, exact and probable duplicates, "Not the same job" and Undo);
  - attached sources labelled under "Source records";
  - "Duplicate listing" and "Possible duplicate" dashboard badges.
- **G4.** Each history row shows "Profile vN · Evaluation … · Prompt …", from fields the API already returned. No comparison view was built.
- **G5.** Optional "Time-zone requirements" field, recorded only as stated (DIRECT provenance; never read from the job text). It is added to `fieldsWithheldFromEvaluator`, so the evaluator's input is unchanged.
- **G6.** `/budget` adds "Usage and spend by domain and source" for the budget period (domain × source type × job source): evaluations, attempts, provider-reported tokens with unreported attempts counted, known spend in the report currency, and attempts whose cost is unknown or in another currency. Per-evaluation operation usage is unchanged; no operation/model analytics were added.
- **G7.** The audit attributed the opportunity-page overflow to the usage table. The actual causes were these, and both are now fixed:
  - **opportunity page:** long unbroken listing URLs in the provenance lists, which now wrap;
  - **`/profile`:** an absolutely positioned visually-hidden label escaping the table's scroll container, which is now contained.

  Every main page measures 390 px wide at a 390 px viewport, with all sections expanded.
- **Migration.** `20261017120000_deduplication`, additive only: enum `DuplicateResolution`, `DuplicateReference.resolution`/`resolvedAt`, `SourceRecord.duplicateDecision`/`duplicateEvidence`. The known `Recommendation.evidenceReferences` drift is excluded.
- **Shared-boundary impact** (recorded in `HANDOFFS.md` for the Codex review at final integration):
  - the core `ManualOpportunityRepository` port;
  - `loadSubject()` may now return attached duplicate sources after the original one;
  - `fieldsWithheldFromEvaluator` gains `timeZoneRequirements`;
  - reused companies give the evaluator the stored company spelling;
  - the new request/resume refusal.

**Tests.**

- **Unit:**
  - `deduplication-engine.test.ts` (21), `deduplication-ui.test.tsx` (11) and `gap-closure-ui.test.tsx` (3);
  - additions to `manual-opportunity.test.ts`, `opportunity-normalization.test.ts` and `worker-operations.test.ts`;
  - repository fakes updated to the new port.
- **Integration:**
  - `deduplication-capture.test.ts` (12);
  - `deduplication-backfill.test.ts` (7, including the company filter);
  - `duplicate-spend-guard.test.ts` (9, including the race);
  - `time-zone-requirement.test.ts` (2) and `usage-breakdown.test.ts` (1).
- **E2E:**
  - `deduplication.spec.ts` (4);
  - a 390 px `/profile` check in `profile-management.spec.ts`;
  - a history-version assertion in `golden-path.spec.ts`.
- **Fixture updates:** fixed listing URLs in `opportunity-dashboard.spec.ts` now carry a per-run token, and two fixtures were updated to the grouped company-option shape.

**Verification** (isolated test database only; no paid provider calls; no live worker; no normal application database exists in this environment):

- typecheck and lint clean; Prisma schema valid; `db:verify-migrations` 16/16 (only the documented drift);
- unit 45 files / 1,128 tests; integration 26 files / 223 tests; E2E 32/32 across all five projects; production build succeeds; `git diff --check` clean;
- `pnpm db:backfill-dedup`: the dry run wrote nothing, the first run filled the seeded companies and the second changed nothing. `pnpm app:doctor` reported no blocking problems.
- A browser walkthrough repeated the audit scenario: the re-capture opened the original opportunity, the company group listed three opportunities, history showed versions, and `/budget` showed the breakdown.

**Versioned specifications** (checked after verification, as the workflow requires). The implementation made their current-status sections stale, so new versions were built from the current ones; only status, revision history, metadata and dependency lines changed.

- **Core AI Framework PRD v1.6:** §31 records deduplication with provenance retention; the requirements are unchanged.
- **Customer Success AI Assistant PRD v1.5:** §23 records duplicate detection; depends on Core PRD v1.6.
- **Core Platform TDD v1.7:** §51 gains a "Deduplication and Provenance Retention" summary, plus the stated time-zone rule and usage by domain and source; depends on Core PRD v1.6.
  - After review, a substantive-spec check confirmed §51 also documents: the reversible "not the same job" decision for any detected pair; that existing opportunities with history are never merged retroactively; the attached source record's provenance; the explicit, idempotent backfill outside setup; the duplicate recheck alongside the existing release rechecks; and the lock that prevents duplicate paid admission.
- **Customer Success Assistant TDD v1.5:** §49 status, the attached-source note and the withheld time-zone field; §40 now lists the user-stated time-zone requirement beside the other withheld evaluator-input fields; updated dependencies.
- The previous versions (PRD v1.5 and v1.4, TDD v1.6 and v1.4) moved unchanged into the `Archive/` folders; the blobs are identical.
- Each new `.docx` passes the docx validator against its source, and a text comparison shows only the intended changes.
- The Semantic Evaluation Playbook is unchanged (no evaluator semantics changed).
- `AGENTS.md` and `CLAUDE.md` point to the new versions.

**Known issues and observations.**

- A pg deprecation warning ("client.query() when the client is already executing a query") appears once per E2E web-server run. It was traced to Prisma's query interpreter inside existing application-tracker transactions: `applications.spec.ts` alone produces it. It is not caused by this work; the two new in-transaction parallel reads were made sequential. It is harmless today; it matters only for a future pg 9 upgrade.
- The new E2E spec bundles its helper per Playwright worker. The existing specs' shared-bundle race (noted in the Task 8 record) is unchanged.
- The duplicate-spend lock holds only while its dedicated connection stays up, like the single-worker lock.


### Post-Task-9 versioned-document update (committed October 16, 2026)

The specification update deferred until Task 9 closed. Planned, reviewed and approved before editing. Documentation only: no code, test, schema or database change, and no provider calls.

- **New current versions:** Core AI Framework PRD v1.5, Customer Success AI Assistant PRD v1.4, Core Platform TDD v1.6, Customer Success Assistant TDD v1.4 and Semantic Evaluation Playbook v1.3.
  - Each new PRD/TDD was built from its previous current version. Each adds a newest-first revision-history entry and keeps every earlier entry and all other content unchanged.
  - The previous current versions (Core AI Framework PRD v1.4, Customer Success AI Assistant PRD v1.3, Core Platform TDD v1.5, Customer Success Assistant TDD v1.3) moved unchanged into the `Archive/` folders.
  - Playbook v1.2 and v1.1 stay unchanged beside v1.3.
- **Core AI Framework PRD v1.5:** §31 status and planned work after the Task 1–9 completion pass; a note on the evaluator-branch semantic-contract repairs.
- **Customer Success PRD v1.4:** §23 status; an evaluator-branch contract note; dependency on Core AI Framework PRD v1.5.
- **Core Platform TDD v1.6:**
  - the `USAGE_LIMIT_REACHED` deferral reason and the legacy `BUDGET_UNAVAILABLE` → `AI_BUDGET_LIMIT` mapping (§33, §38, §39 and their tests);
  - "eligible-for-evaluation" in place of the last "model-eligible";
  - §51 "Application Tracker" and "Operations and Worker Model" status subsections;
  - the updated sequence and the dependency on Core AI Framework PRD v1.5.
- **Customer Success TDD v1.4:** a §49 per-branch contract-version table and the October 10–13 evaluator-branch rules, marked effective at final integration. The evaluation design body sections are unchanged until final integration.
- **Semantic Evaluation Playbook v1.3:** keeps all of v1.2 and adds §14 (semantic closure, structured authority, deterministic reconciliation, evidence and gap rules, Unknown behavior, fail-closed prerequisites, replay methodology, residual risks, outstanding verification), plus dated notes in §11 and §13. Every §14 rule was checked against the evaluator branch's code.
- **References and status:** `AGENTS.md` and `CLAUDE.md` spec paths; `EVALUATOR_STATUS.md` pointer to Playbook v1.3; current-state documents now show the features 1–10 gap audit as next; a `CHANGELOG.md` entry.
- **Verification:**
  - each new `.docx` passes schema validation against its source;
  - a text comparison against each source shows only the intended changes;
  - archived and historical versions are byte-identical to their committed blobs;
  - no code or test file changed; `git diff --check` is clean.

### Claude Task 9 — Operations hardening completion pass (committed October 16, 2026)

**Status (October 16, 2026):** reviewed, approved and committed as `feat: complete operational hardening`, pushed to `origin/claude/gallant-pasteur-y1ou3i`. The audit, changes and verification are recorded under "Completed — Task 9 completion pass" below.

*(Status earlier on October 16, 2026: "open. Planned and approved, implemented, and verified offline on the isolated test database. The documentation synchronization is done and awaiting user review. It closes with the review and then the checkpoint commit. Not committed or pushed yet.")*

The pass audited the October 10 Task 9 operations work and added only what was missing:

- error-name-only logging in the opportunity API routes;
- `pnpm app:doctor` reporting budget deferrals and usage-limit deferrals separately;
- health-endpoint failure tests;
- a deterministic, non-live AI credential for every E2E run;
- documentation of the single-worker lock's connection-loss caveat.

It added no migration and changed no queue, worker, lease or evaluator code.

### Claude Task 8 — Application Tracker completion pass (committed `534a4c7`, October 16, 2026)

**Status (October 16, 2026):** reviewed and committed as `534a4c7` (`feat: complete application tracker`), pushed to `origin/claude/gallant-pasteur-y1ou3i`. The audit, changes and verification are recorded under "Completed — Task 8 completion pass" below.

*(Status on October 15, 2026: "implemented and verified offline; awaiting user review, then the checkpoint commit.")*

The pass audited the existing tracker against current requirements and added only missing/incomplete behavior.

Focus areas:

- persistent application state/stage;
- application and follow-up dates;
- notes;
- contacts/interviews where already part of the established design;
- outcomes;
- next action and due/overdue/due-today visibility;
- `/applications` usability;
- guarded lifecycle interaction;
- stale-write/concurrency behavior;
- persistence across refresh/restart;
- application data surviving reevaluation unchanged.

Do not add push/email/browser notifications, calendar integration, email integration, or evaluator redesign as part of Task 8.


### Documentation preservation and correction pass (October 15, 2026)

- Reconciled the October 15 project documents preserve-first.
- Completed a repository-wide documentation preservation audit (five revisions).
- Recovered the full formal PRD/TDD history:
  - 23 versions, placed under `Archive/` folders, plus Core AI Framework PRD v1.4;
  - Core Platform TDD v1.0 and v1.1 confirmed as separate versions.
- Corrected stale current-state documents:
  - `AGENT_WORKSTREAMS.md`, both READMEs, `AI_Architecture_README.md` (restored Windows/WSL environment lessons), `EVALUATOR_STATUS.md` (§19 addendum), `HANDOFFS.md` (integration and preservation notes), `AGENTS.md` (version retention);
  - Semantic Evaluation Playbook v1.2.
- No application, evaluator, schema or database changes.

### Profile and policy readiness

- Product-side profile limitations persistence and transport completed.
- Active-profile resolution and pinned-version behavior clarified.
- Policy/version override diagnostics and stale-environment warnings added.
- Final integration still must verify the stored limitation → deterministic Genuine Gap path after branch combination.

Detailed records: "Profile limitations persistence" and "Policy and profile integration readiness" below.

### Task 6 — AI budget and usage controls

- Persistent monthly budget ledger.
- Atomic reservation/reconciliation.
- Warning thresholds.
- Daily/weekly evaluation limits.
- Monthly output-token limit.
- Per-evaluation call limit within the system maximum.
- Budget/usage/capacity reporting.
- Persistent budget deferral, resume, and cancel behavior.
- `AI_BUDGET_LIMIT` for dollar-budget deferral.
- `USAGE_LIMIT_REACHED` for throughput/token limits.
- Unknown provider usage remains Unknown.
- Accepted decision: already-admitted queued/running evaluations are not retroactively cancelled when limits are lowered.
- Completion checkpoints: `267138a`, `8d3993a`.

Detailed records: "Task 6 completion" and "Task 6 naming cleanup" below.

### Task 7 — normalized opportunity facts and dashboard completion

Final commit: `754f956dc0860149760936a61bdace0489404b9a` on `claude/gallant-pasteur-y1ou3i`.

Completed:

- salary minimum/maximum and currency normalization;
- open-range/single-value salary handling;
- bare-`$` USD provenance marker;
- work arrangement, seniority, department, employment type, and closing-date normalization;
- residency requirement and residency-region normalization across countries, U.S. subdivisions, Canadian subdivisions, UK nations, and broad regions;
- explicit precedence/provenance rules;
- numeric salary filters/sort and additional dashboard filters;
- compatibility for older records without backfilling Unknown facts.

Task 7 verification passed typecheck/lint/Prisma, 1036 unit tests, 176 integration tests, 25 E2E tests, and build using only the isolated test database.

Detailed record: "Task 7 completion amendment" below.

### Customer Success Milestone 4 — Task 7 salary-policy alignment

Commit: `267124f fix(cs): align Milestone 4 salary policy with Task 7` on `codex/evaluator-live-diagnostic`, pushed to origin.

**Branch state:** this commit is on the Codex evaluator branch and is **not merged** into `main` or `claude/gallant-pasteur-y1ou3i`. On `claude/gallant-pasteur-y1ou3i`, `fieldsWithheldFromEvaluator` still withholds all ten Task 7 fields, and the earlier version identifiers remain. The release is reconciled at final branch combination (see the October 15 addenda in `HANDOFFS.md`).

Completed (on `codex/evaluator-live-diagnostic`):

- currency- and residency-aware deterministic salary Hard Filter;
- U.S. hard minimum of `$60,000 USD-equivalent` with no Review band;
- non-U.S. `$60k+` Pass, `$55k–$59,999.99` Review, `$50k–$54,999.99` conditional Review/Unknown, `<$50k` Fail/Skip;
- versioned FX policy `cs-salary-policy-v2-ecb-2026-10-14`;
- disclosed-minimum gate and max-only conservative handling;
- evaluator release of salary min/max, currency, residency requirement, and residency regions with provenance;
- preservation of Customer Success policy inside the domain rather than Core.

Focused offline verification passed. Broader DB-backed integration, E2E, build, live provider calls, and final acceptance were intentionally deferred.

## Completed

### Product Foundation

- Core AI Framework defined.
- Core Platform architecture defined.
- Customer Success product requirements defined.
- Customer Success technical design defined.
- Semantic Evaluation Implementation Playbook established and updated.

### Platform / Product

- Manual opportunity ingestion.
- PostgreSQL persistence.
- Shared ordered evaluation framework.
- Background evaluation processing.
- Evaluation history.
- Persisted recommendation flow.
- Customer Success results UI.
- Evidence display.
- Unknown and contradiction display.
- Safe untrusted-text rendering.
- Bounded evaluation polling.
- Polling cleanup when leaving the page.
- Recommendation is read from persisted results rather than recalculated in the browser.
- Opportunity dashboard with search, filters, sorting, pagination and summaries (Task 7).
- Opportunity lifecycle and user actions with guarded transitions.
- Profile and preferences management with explicit active versions and structured limitations (Task 5 and the limitations persistence).
- AI budget ledger, deferral, throughput limits, capacity and backlog reporting (Task 6).
- Application tracker (Task 8, including the October 15–16 completion pass).
- Setup, operations hardening, single-worker evaluation processing and whole-product acceptance tests (Task 9, including the October 16 completion pass).

Details for each are in the task records under "Main Product" below.

### Evaluator

- Full Customer Success evaluation foundation.
- Hard Filters.
- JD Reconstruction.
- Job Evaluation.
- Company Alignment.
- Organizational Maturity.
- Alex Fit.
- Burnout Risk.
- Resume Match.
- Effective Seniority.
- Opportunity Priority.
- Ghost Job Risk fallback behavior.
- Deterministic Final Recommendation.
- Semantic-operation usage/cost accounting.
- Restart-safe per-evaluation semantic-call budgeting.
- Per-operation model routing.
- Accepted mixed Terra/Luna routing.
- Resume Match optimization #1.
- JD Reconstruction optimization #1.
- Resume Match optimization #2 (accepted Resume Match baseline).
- JD Reconstruction optimization #2 evaluated and rejected (its v6 and v7 candidates; State2 from optimization #1 retained).
- Final model-routing lock (October 15, 2026; see below).
- Milestone 4 salary-policy alignment with the Task 7 contract (on `codex/evaluator-live-diagnostic`; not merged).
- Evaluator semantic-contract repairs, October 10–13 (on `codex/evaluator-live-diagnostic`; not merged; see below).

#### Evaluator-branch progress (October 10–15, 2026; `codex/evaluator-live-diagnostic`, not merged)

These records come from the evaluator branch's own `Md and README Docs/CURRENT_PROGRESS.md` and its commits. The full records are carried into this document at final branch combination (`HANDOFFS.md`, October 15 annotations). Contract details, residual risks and outstanding verification are in `EVALUATOR_STATUS.md` §20.

- **Organizational Maturity mixed-state stabilization** (October 10): two over-broad guards corrected; preserved outputs replayed offline.
- **Resume Match evidence-partition stabilization** (October 11): one single-purpose evidence assignment collection; fail-closed integrity checks kept.
- **Provider-prose semantic closure** (October 11; `04611af`, `1c09924`): provider prose became display-only. Genuine Gap proof moved to a structured `gapEvidence` collection. A static guard pins the remaining text dependencies.
- **Structured requirement specialization and real-artifact replay** (October 11; `1c09924`, `cs-jd-reconstruction-v4`): preserved live request/response pairs are replayed offline from outside the repository.
- **JD Reconstruction specialization category binding** (October 12; `7149563`, `cs-jd-reconstruction-v5`).
- **Requirement-relative evidence relevance** (October 12; `f29530c`, `cs-jd-reconstruction-v6`, `cs-resume-match-v3`):
  - EXPERIENCE requirements get ladder levels;
  - structured profile limitations become the only gap proof;
  - Resume Match fails closed with `RESUME_MATCH_PREREQUISITE_OUTDATED` on an outdated map.
- **Statement groups, reconciliation and requirement-relative INDUSTRY** (October 13; `067c5dc`, `cs-jd-reconstruction-v7`, `cs-resume-match-v4`):
  - structured `requirementStatements`;
  - deterministic reconciliation of statement quotes against deterministic requirement lines;
  - INDUSTRY matches only from actual work experience;
  - Unknown without supported or unsupported portions.
  - The branch record calls this work "uncommitted pending review", but Git shows commit `067c5dc` on October 13.
- **Milestone 4 salary-policy contract update** (October 15; `267124f`).

## Current Accepted Model Routing

| Operation | Execution |
| --- | --- |
| Hard Filters | Deterministic |
| JD Reconstruction | GPT-5.6 Terra |
| Job Evaluation | GPT-5.6 Luna |
| Company Alignment | GPT-6 Luna |
| Organizational Maturity | GPT-5.6 Luna |
| Alex Fit | GPT-5.6 Luna |
| Burnout Risk | GPT-6 Luna |
| Resume Match | GPT-5.6 Terra |
| Opportunity Priority | GPT-5.6 Luna |
| Ghost Job Risk | Deterministic when posting-history evidence is insufficient |
| Final Recommendation | Deterministic application logic |

The routing policy is locked. A GPT-6 Luna Job Evaluation benchmark was rejected because it regressed Strategic Bridge Value and omitted established evidence. Remaining GPT-6 benchmarks were intentionally skipped by product decision.

**Branch state:** the GPT-6 Luna routing for Company Alignment and Burnout Risk is implemented on `codex/evaluator-live-diagnostic`. `claude/gallant-pasteur-y1ou3i` still carries the earlier accepted routing (GPT-5.6 Luna for both operations) until final branch combination. Routing is an execution detail and does not change product semantics.

## In Progress

### Main-product tasks

Feature 14B (the browser-extension companion) is implemented and verified (October 20, 2026) and awaits Alex's review and local acceptance; it is not committed. Feature 14A (browser-assisted LinkedIn retrieval and source corrections) was committed as `dd77d29` and accepted on October 20, 2026; Feature 14 as a whole is not complete until 14B is accepted. Features 15–18 follow 14B.

*(Earlier status, superseded on October 20, 2026: "Feature 14 (browser-assisted LinkedIn retrieval and source corrections) is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." It was committed as `dd77d29` and accepted.)*

*(Earlier status, superseded on October 19, 2026: "Feature 13 (posting history and listing removal) is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." It was committed as `d1bf217`.)*

*(Earlier status, superseded on October 19, 2026: "Feature 12 (source health and conservative retrieval) is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." It was committed as `f10a02b`.)*

*(Earlier status, superseded on October 18, 2026: "Feature 11A is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." Feature 11A was committed as `fad2341` and Feature 11B as `2a1d8c2`.)*

*(Earlier status, superseded on October 18, 2026: "The Features 1–10 Gap Closure is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." It was committed as `d573acf`.)*

*(Earlier status, superseded on October 17, 2026: "No main-product implementation task is open. Task 9 and the post-Task-9 versioned-document update are complete (see "Recently Completed"). Next is the audit of any remaining gaps in main-product features 1–10.")*

### Evaluator

The earlier accepted sequence (JD Reconstruction optimization #2 → Resume Match optimization #2 → combined-path integration → final mixed-model evaluation) has been worked through: Resume Match optimization #2 was accepted, JD Reconstruction State2 was retained, and the routing was locked on October 15, 2026 (Codex workstream, `codex/evaluator-live-diagnostic`). The final live / whole-product evaluation is deferred to the final integration pass after main-product features 1–18 are complete.

Outstanding evaluator items (October 16, 2026) — none of them is authorized to run now:

- the final paid acceptance run of the integrated evaluator;
- measurement of the current-contract cost (`cs-jd-reconstruction-v7`, `cs-resume-match-v4`, with the GPT-6 Luna routes);
- the replay items recorded on the evaluator branch.

See "Evaluator-branch progress" below and `EVALUATOR_STATUS.md` §20.

### Main Product

Remaining non-evaluator product work is being completed in parallel by Claude. The task records below are cumulative and preserved as written; earlier records describe the state at their own date.

#### Completed — Opportunity dashboard and Domain default (October 6, 2026)

- `GET /api/opportunities`: read-only, newest-first list of persisted opportunities with their latest evaluation (task status and persisted decision). Bounded by `limit` (default 100, max 200); an invalid query returns 400.
- `/` is now a dashboard of opportunities with an empty state. Manual entry moved to `/opportunities/new`. The detail page links back to the dashboard.
- The manual-entry Domain field is now a select defaulting to `customer-success`. Previously a blank domain made the opportunity impossible to evaluate.
- The dashboard uses its own domain-neutral display helpers (`apps/web/src/components/dashboard/`). It does not import the evaluation/Customer Success result UI and does not recalculate or restyle recommendations.
- No changes to evaluator internals, schemas, routing, worker/queue behavior, or recommendation logic.
- Tests added:
  - `tests/unit/opportunity-dashboard.test.tsx`
  - `tests/integration/opportunity-list.test.ts`
  - `tests/e2e/opportunity-dashboard.spec.ts`
  - `tests/e2e/app-shell.spec.ts` updated.

#### Completed — Evaluation-experience correctness (October 6, 2026)

- **Failed latest evaluation.** When the latest evaluation failed, the page shows the most recent completed evaluation from history, labeled as such. Otherwise it accurately says whether earlier results exist. The latest status still drives the controls.
- **Safe failure details.** The persisted failure code is shown (only if it is a well-formed identifier) with a mapped user-facing message. The stored error message is never rendered, because it can contain internal validation/provider detail.
- **Per-field validation errors.** Manual entry shows server validation errors next to each field (`aria-invalid` + `aria-describedby`). Unmatched issues stay form-level.
- **Keep checking.** A "Keep checking" control appears whenever status polling stops, whether at the polling cap or after a failed refresh, and restarts bounded polling.
- **Stalled-queue notice.** If an evaluation stays queued for more than 60 seconds, a notice says the worker may not be running (`pnpm worker:evaluations`).
- **Clickable URLs.** Source and application URLs are links that open in a new tab (`noopener noreferrer`). Only http(s) URLs become links; anything else stays plain text.
- UI and product-service code only. No evaluator, schema, routing, worker, or recommendation changes. Nothing is recalculated in the browser.
- Tests:
  - `tests/unit/evaluation-experience-correctness.test.tsx` (new);
  - poller cap/restart case in `tests/unit/evaluation-poller.test.ts`;
  - two E2E flows in `tests/e2e/evaluation-results.spec.ts`: failed-reevaluation fallback, and queued-too-long plus keep checking;
  - two E2E flows in `tests/e2e/opportunity-dashboard.spec.ts`: field errors and clickable links.
  - The E2E helper gained deterministic `fail-latest` and `age-latest` commands.

#### Completed — Opportunity lifecycle and user actions (October 6, 2026; Core guard awaiting Codex review)

- **Automatic system lifecycle.** After a completed evaluation, `NORMALIZED`/`EVALUATED` → `RECOMMENDED` (or `NORMALIZED` → `EVALUATED` if there is no recommendation). A failed evaluation changes nothing.
  - Automatic sync never overwrites a user state and never downgrades.
  - It runs in a product-level wrapper around the production evaluation processor (`apps/web/src/server/opportunity-lifecycle-sync.ts`). A sync failure is logged and never fails a completed task.
  - The worker repairs any missed sync with a sweep at startup.
  - Core still never mutates the lifecycle.
- **User actions.** `POST /api/opportunities/[id]/action` accepts `SAVE`, `MARK_APPLIED`, `DISMISS`, `ARCHIVE` and `RESTORE`.
  - Each action is a compare-and-set plus a row in the new additive `OpportunityUserAction` table, in one transaction.
  - Only explicit user actions write that table; evaluations and the automatic sync never do.
- **Deterministic RESTORE.** An undo stack over the action history: each non-RESTORE action pushes, each RESTORE pops, and RESTORE targets the newest action not yet undone. Repeated RESTORE walks backward and never bounces. A system-state target is re-derived from persisted evaluations.
- **Reevaluation.** Allowed in every normalized state except `ARCHIVED`/`CLOSED`, which return 409 `OPPORTUNITY_NOT_EVALUABLE`. A user state is preserved and a new evaluation-history row is added.
- **Dashboard.** Views for Active (default), Saved, Applied, Dismissed, Archived and All; lifecycle labels on each row; `GET /api/opportunities?view=`.
- **Detail page.** Status and action buttons. Reevaluate is disabled with an explanation when the opportunity is archived or closed. Status refreshes after an evaluation completes.
- **Core guard (⚠ awaiting Codex review).** The Core executor's `NORMALIZED`-only guard is widened to `isNormalizedLifecycleState` (any state except `DISCOVERED`) in `execute()` and `executeExisting()`. Automatic lifecycle writes depend on this change and are not integration-ready until Codex reviews it. See `HANDOFFS.md`.
- **Migration.** `20261006210110_opportunity_user_actions` is additive only.
- **Tests:**
  - unit: `opportunity-lifecycle.test.ts`, `opportunity-actions.test.tsx`, executor guard cases, evaluation request guard cases;
  - integration: `opportunity-lifecycle.test.ts`, which runs real deterministic evaluations through the production wrapper;
  - E2E: the lifecycle flow.

#### Completed — AI usage and cost display (October 6, 2026)

- **Results page.** A collapsed "AI usage and estimated cost" section for the displayed evaluation. It shows provider attempts, all five token categories, estimated cost with its currency, and the pricing configuration version(s).
  - A collapsed per-operation breakdown lists operation, model, attempt, status, tokens and cost.
  - Values are rendered from the existing API `usage` (built by `summarizeSemanticUsage()`) and `operations`.
  - Unreported values show "Unknown", never 0.
  - Provider request IDs and raw error messages are never rendered; operation error codes are sanitized.
- **Dashboard.** "AI usage" totals across all evaluations: evaluations, attempts, total tokens, estimated cost and pricing basis. The totals come from a read-only product repository (`database/src/usage-summary-repository.ts`) that reuses `summarizeSemanticUsage()` as-is. When the total cost is Unknown, the page says why: attempts without a recorded cost, or mixed currencies.
- **Not changed.** No changes to the evaluator, pricing/cost calculation, usage recording, or schema, and no budget limits, deferral or ledger.
- **Tests:**
  - `tests/unit/usage-display.test.tsx`;
  - `tests/integration/usage-summary.test.ts` (attempts seeded through the existing recorder);
  - E2E usage assertions in the Apply and lifecycle flows.

#### Completed — Pre-Task-5 foundation pass: provenance and multi-source readiness (October 6, 2026)

- **Audit result.** Most provenance was already correct:
  - raw-first `SourceRecord` capture;
  - Opportunity identity, URL and timestamp fields;
  - field-level `FieldProvenance`;
  - many `SourceRecord`s per Opportunity;
  - `DuplicateReference`.

  Evaluation, reevaluation and lifecycle actions never write provenance.
- **Fixed — per-source application URL.** `SourceRecord.applicationUrl` is now a first-class column (it was previously only in JSON). Migration `20261006232000_source_record_application_url` backfills it null-safely, copying only well-formed http(s) values and leaving everything else NULL.
- **Fixed — manual capture.** It can now record an optional source job ID (`externalId`, with field provenance) and "where you found it" (`sourceMetadata.reportedSource`, informational only). Manual jobs always keep `source = "manual-input"` / `sourceType = MANUAL`.
- **Fixed — provenance in the UI.**
  - The detail page has a "Source and provenance" section: entry method, source, reported source, every source record with its URLs (safe links), source job/requisition IDs, and discovered/last-observed/normalized timestamps.
  - Opportunity-level first/last seen is also shown.
  - Dashboard rows show the source; list items carry `source`/`sourceType`.
- **Fixed — duplicate paid evaluations.** A server-side guard returns 409 `EVALUATION_ALREADY_ACTIVE` while the opportunity's latest evaluation is queued or running. The residual true-concurrency race is documented in `HANDOFFS.md`.
- **Tests:**
  - `tests/unit/foundation-provenance.test.tsx`;
  - guard cases in `evaluation-api-worker.test.ts`;
  - `tests/integration/foundation-provenance.test.ts`: full provenance snapshot unchanged across evaluation, reevaluation and all user actions; backfill edge cases; the guard;
  - a provenance E2E flow.
- **Deferred (all additive later):**
  - `SourceRecord.retrievalType`/`sourceCategory` (with the first collector);
  - posting-history observations;
  - the dedup engine and canonical-source selection;
  - submit-URL-only capture.

#### Completed — Task 5: Profile and preferences management (October 7, 2026)

- **`/profile` ("Profile & preferences", linked from the dashboard).** Shows which version new evaluations use, a displayed-version selector, the editor, and the version history.
  - The history shows each version's saved date, how many evaluations used it, Active / In use / Viewing badges, and View and Make active (with confirmation).
- **Structured form.** Edits the evaluation-relevant fields of the existing Customer Success contract:
  - salary (currency, pass and review thresholds, lower-cost countries);
  - work arrangement and the unknown-arrangement result;
  - allowed and disallowed countries, US-only roles;
  - travel allowances (recurring onsite and field travel are fixed FAIL and shown read-only);
  - role families;
  - fit areas, lower-alignment patterns and work styles;
  - business models, product types, customer types and segments;
  - career-strategy goals;
  - career goals, experience (Direct/Related/Transferable), skills, transferable skills and work preferences.

  Unset fields show their effective default with a "Default" tag and stay unset unless edited. Nothing outside the contract was added; seniority and relocation are not in the contract and are not exposed.
- **Advanced JSON editor.** The full stored document.
  - Parse errors are shown with line and column, and validation errors by path.
  - Unknown keys are rejected, including inside nested preference objects that the domain schema would otherwise silently strip.
  - The label is locked.
- **One draft, two editors.** The form and the JSON editor share one base version, and at most one of them can hold unsaved changes.
  - Form → JSON always carries the changes over.
  - JSON → form carries the changes over only when that is lossless. Otherwise it asks; "Keep editing JSON" keeps the draft byte-for-byte, and "Discard JSON changes" returns to the base.
  - Changing the displayed version while there are unsaved changes asks first, and a `beforeunload` warning covers leaving the page.
  - Each save submits only the open editor's draft, as one request that creates at most one version.
- **Append-only versions and an explicit active version.**
  - Saving always appends through the existing `PrismaUserProfileImportRepository.import()` (with hash dedupe).
  - "Save as new version" never changes what evaluations use; "Save and make active" does.
  - The new additive `ActiveUserProfile` table (one row per domain) is a pointer only. Activation never updates a `UserProfile` row.
  - Before the first save, the version currently in use is pinned, so a new version can never take over implicitly.
- **Profile resolution for new evaluations:**
  1. an explicit `userProfileId`;
  2. the active version;
  3. the previous newest-profile fallback, used only when nothing was ever activated.

  The resolved version is pinned at enqueue as before, and historical evaluations are never rebound.
- **Opportunity detail hint.** When the latest evaluation used a different version than new evaluations would, the page says so and suggests reevaluating. Nothing is reevaluated automatically.
- **CLI.** `pnpm profile:import:customer-success` keeps appending versions. `--activate` makes the imported version active; without it, the version in use is unchanged.
- **Not changed.** Evaluator, domain profile contract, prompts, stages, routing and recommendation logic are unchanged. Migration `20261007120000_active_user_profile` is additive only (the known `Recommendation.evidenceReferences` drift line was excluded again).
- **Tests:**
  - `tests/unit/profile-management.test.ts`: option lists equal the domain schema; changes apply only to changed paths; JSON → form diff; validation paths; label lock; handlers.
  - `tests/unit/profile-editor.test.tsx`: draft reducer, including a 5,000-step invariant check, plus jsdom component tests for both switch directions, confirm and cancel discard, and exactly one save request from either editor.
  - `tests/integration/profile-versioning.test.ts`:
    - historical linkage (evaluation row, API `versions.userProfile` and profile evidence `sourceReference` unchanged after v2 is saved and activated);
    - a queued evaluation keeps the pinned v1;
    - the pin guard, rollback, fallback, dedupe and cascade;
    - no `UserProfile` row is ever mutated;
    - exactly one row per save.
  - `tests/e2e/profile-management.spec.ts`, which runs after the other specs as its own Playwright project, because it changes the active version.
  - Dev dependency `jsdom` was added for the component tests.

#### Completed — Task 6: Budget ledger and deferral (October 7, 2026)

- **Budget** (`/budget`, plus a "Budget" link and an "AI budget" card on the dashboard):
  - a monthly calendar budget in a chosen IANA time zone (default UTC), with amount, currency (must match the AI pricing currency), reserve per evaluation, and an enforcement toggle;
  - "Remove budget" makes evaluations unlimited again;
  - the period resets implicitly, because spend is always computed over the current window, so no job is needed.
- **Spend accounting.**
  - Known spend is the direct sum of persisted `SemanticOperationAttempt.estimatedCost` in the budget currency within the period.
  - Null-cost attempts are counted separately as unknown, and other-currency attempts separately; neither is ever counted as $0.
  - An evaluation with $0.07 known plus one unknown attempt contributes $0.07 and raises the unknown warning.
  - `summarizeSemanticUsage()` and the existing usage displays are unchanged.
- **Reservations and holds.**
  - With a budget configured, each admitted evaluation gets a reservation (`EvaluationBudgetReservation`).
  - Its remaining hold (reserve − known cost so far) counts while the work is unresolved:
    - live or queued/running work holds in whichever period is current, including across a month boundary;
    - a finished run with unknown cost holds only in the period of its unknown attempt;
    - a finished run with all costs known holds nothing.
  - Actual cost replaces the hold automatically, and nothing is rewritten.
- **Gate and deferral.** Each request runs under one Postgres advisory lock.
  - With no budget, it is unrestricted: no reservation, no deferral, behaviour as before.
  - With enforcement on and no room, the request is recorded as a `DeferredEvaluation` (`AI_BUDGET_LIMIT`, originally persisted as `BUDGET_UNAVAILABLE`; see the Task 6 naming cleanup below; with a budget snapshot). It creates no Evaluation, Task or provider call, and the lifecycle is untouched.
  - The evaluate API returns 200 `outcome: "DEFERRED"` instead of 202.
- **Resume and cancel.**
  - From the backlog on `/budget`, or the opportunity page ("Resume deferred evaluation" / "Cancel request").
  - Resume re-checks the budget, the active-evaluation guard and the lifecycle.
  - It uses the **profile version pinned at deferral time**; a deleted pinned version is refused with a clear reason.
  - A request whose resume admission is abandoned returns to the backlog.
  - Automated draining is additive later; there is no scheduler.
- **Request integrity** (always on, separate from money).
  - Every product request creates an `EvaluationAdmission`, which the new `PrismaEvaluationTaskRepository.enqueueAdmitted()` consumes atomically in the transaction that creates the Evaluation and Task.
  - An abandoned admission (timeout after a crash before enqueue) can therefore never produce an Evaluation.
  - This closes the duplicate-active race previously documented in HANDOFFS.
  - A check-ordering race found during testing (two queued under concurrency) was fixed: the live admission is read before the active evaluation. It is covered by a repeated concurrency regression test.
- **UI:**
  - the dashboard budget card (known spend, reserved, remaining known, unknown/other-currency warnings, enforcement, reset date, deferred count);
  - rows show "Evaluation deferred";
  - the opportunity page explains the deferral from the snapshot (pinned profile, active-profile difference);
  - the results page shows "Reserved before run" next to the actual cost.
- **Migration.** `20261007200000_budget_ledger` is additive (four tables, two enums, plus a check that an admission is never both consumed and abandoned); the known `Recommendation` drift line is excluded.
- **Tests:**
  - unit: `budget.test.ts` (period/DST/time zones, holds, decision, validation) and `budget-ui.test.tsx` (card, reason, backlog, handlers, 200/202 outcomes);
  - integration: `evaluation-admission.test.ts` (recovery, durable association, delayed enqueue after abandonment, consume/abandon race ×20, failed enqueue, unchanged `enqueue()`, concurrent requests with and without budget, no-budget integrity) and `budget-deferral.test.ts` (gate, deferral with zero rows created, restart persistence, resume re-check, reconciliation, unknown cost, both concurrency cases, pinned profile, archived/cancel, abandoned resume, settings never rewrite usage, currency, period boundaries);
  - E2E: `budget.spec.ts`, its own Playwright project, run last.

#### Completed — Task 7: Dashboard search, sort, filters, and analytics polish (October 8, 2026)

- **Server-side, read-only, URL-held state** (`/`, plus `GET /api/opportunities`). Filters, search and sort never mutate anything.
- **Lifecycle views:** Active (default), **To triage** (new: system states only, so "recommended to apply, not yet acted on" is an exact view), Saved, Applied, Dismissed, Archived, All. Archived appears only in Archived/All.
- **Filters** (OR within a filter, AND across filters):
  - recommendation (latest completed evaluation: apply / review / skip / none);
  - evaluation state (none / queued / running / completed / failed / deferred);
  - priority band;
  - role family;
  - customer segment;
  - source type, source, company, domain;
  - title contains, location contains;
  - salary stated / not stated;
  - discovered date range (inclusive UTC days).
- **Evaluation-derived values** (priority, role family, segment) are read as-is from the latest completed evaluation's persisted result. They are never inferred; a "Not evaluated"/"Unknown" option covers their absence.
- **Deferred filters** (data not reliable yet), mostly completed by the Task 7 completion amendment below:
  - numeric salary range and salary sorts: **done**;
  - remote/seniority/department: **done**;
  - structured location: still deferred (no structured location columns);
  - salary analytics: still deferred.
- **Search** (`q`): case-insensitive partial matching, AND across up to 8 terms (80 characters each), over title, company, location, source, original source, salary text and listing/requisition IDs. Wildcards are escaped. Descriptions are excluded (full-text search is an additive follow-up).
- **Sorts:** newest/oldest discovered, recently updated, priority (contract band order, unknown last), company A–Z and title A–Z (missing last). All end with deterministic tie-breakers. Recommendation is a filter, not a sort.
- **URL state.**
  - A pure parser and serializer (`apps/web/src/server/opportunity-query.ts`). Invalid or stale values are dropped and never error.
  - The dashboard redirects to the canonical URL, so empty or invalid params are removed and a page past the end becomes the last valid page (`?page=99` with 63 results at 25 per page → page 3; zero results → page 1).
  - Refresh, back/forward and bookmarks all work. The filter form is a plain GET form, auto-submitting on change.
- **Pagination.** Offset-based, 25 per page. A filtered `COUNT(*)` and the page query share one predicate builder and run in one RepeatableRead read-only snapshot, so totals and items cannot disagree.
- **Dashboard.**
  - A "Needs attention" strip (not evaluated, recommended to apply, deferred for budget, evaluation failed, in progress); each count equals the total of the view it links to.
  - Removable filter chips, clear-all, a result count, and distinct "no opportunities yet" vs "no matches" empty states.
  - Pipeline overview counts and lightweight distributions (current recommendation, priority, source).
  - Richer rows: company · location, salary or "Salary not stated", source, discovered date, lifecycle, current recommendation (marked "last completed" when a reevaluation is pending or failed), priority, evaluation state, deferred badge, and a safe application link.
  - The budget card and AI usage totals are unchanged.
- **Migration.** `20261008090000_dashboard_indexes` adds Opportunity indexes only (`discoveredAt/id`, `status/discoveredAt`, `sourceType`, `updatedAt`); the known `Recommendation` drift line is excluded.
- **API.** `GET /api/opportunities` now accepts every filter/sort/page param and returns `total`, `page`, `requestedPage`, `pageCount` and `pageSize`. Unknown params and invalid values are now ignored; malformed `limit`/`page`/`pageSize` still return 400. Without `view`, the API keeps listing every lifecycle state.
- **Tests:**
  - unit: `opportunity-query.test.ts` (parsing, dropping, normalization, escaping, canonical serialization, `clampPage`, canonical redirect, contract value parity) and `dashboard-ui.test.tsx` (chips, count, form state, rows, pagination, attention links, distributions);
  - integration: `dashboard-query.test.ts` (every filter and combinations, search, sorts with nulls last, page beyond end, exact final page, zero results, count/items agreement across pages, summary counts equal linked views, read-only);
  - E2E: `dashboard.spec.ts`, its own Playwright project, run last.

#### Completed — Task 7 completion amendment: normalized Opportunity fields and the deferred filters (October 14, 2026)

**Audit (before):**
- `salaryMin`/`salaryMax`/`currency`, `remoteStatus`, `seniority`, `department` and `closingDate` existed in the schema but were never populated.
- `employmentType` was partial: the normalizer copied it, but manual entry always sent null.
- Location, salary text, posting date, source/provenance and domain were complete.
- Every other Task 7 filter, sort, search, URL state, pagination and empty state was complete.
- Numeric salary filtering and sorting, and work-arrangement, seniority and department filters, were missing.

**Normalization** (deterministic, `packages/normalization`; no AI calls):
- **Compensation** (`parseCompensation`) from the compensation text only:
  - a stated range, single amount or open-ended amount ("Up to", "From", "+");
  - `72k`, `72,000` and `72.000` formats.
  - **Stays Unknown:**
    - hourly, daily, weekly or monthly pay (there is no pay-period column);
    - OTE;
    - more than one candidate figure, an inverted range, or an implausible amount.
- **Currency:**
  - from an explicit code or symbol (USD, US$, CA$, €, £…), or from the user's selection;
  - a bare "$" is read as USD (user decision, confirmed 2026-10-14). Example: "$72,000–$88,000" → 72000–88000 USD.
    - It is recorded as a derived value (`DETERMINISTIC`, source field `compensationText:bare-dollar-as-usd`), never as a stated currency, so it stays identifiable and can be revisited.
    - An explicit currency always takes precedence: US$/USD → USD, CA$/C$/CAD → CAD, A$/AU$/AUD → AUD, € → EUR, £ → GBP.
    - The rule never overrides an explicit non-USD currency. "$72,000 EUR", or a "$" with a selected non-dollar currency, leaves the currency Unknown.
  - conflicting currencies, or a "¥", stay Unknown;
  - no conversion exists.
- **Work arrangement:** a stated choice, or else the location field when it states exactly one of Remote / Hybrid / On-site. A plain place name is never read as on-site, and the job description is never scanned.
- **Seniority:** a stated choice, or else unambiguous title words only (Junior, Senior/Sr, Principal, Director, VP/Chief). "Lead", "Staff", "Associate", "Head", "Manager" and mixed titles stay Unknown.
- **Department, employment type and closing date:** only as stated.
- **Residency / geographic eligibility** (added 2026-10-16; migration `20261016090000_opportunity_residency_requirement`, additive):
  - `Opportunity.residencyRequirement` is `US_REQUIRED`, `NON_US` (residence outside the U.S. explicitly permitted or required) or null (Unknown).
  - `Opportunity.residencyRegions` lists the stated geographies (ISO country codes or regions such as `EU`, `EMEA`, `WORLDWIDE`); it is empty when not stated.
  - **Sources:**
    - the user's statement on the form ("Residency requirement", "Eligible residence");
    - otherwise only explicit statements: job text such as "must reside in the United States", "US only", "EU residents only", "must be based in Spain" or "open to candidates in the US or Canada"; or a location field such as "Remote - United States" or "Remote (Spain)".
  - **Never inferred** from salary currency, "Remote" alone, a city or country on its own, headquarters, nationality, work authorization or time zones. Preferred, negated or conflicting wording stays Unknown.
  - **Provenance:** stated values are recorded DIRECT. Parsed values are DETERMINISTIC with markers `rawText:explicit-residency-statement` / `location:explicit-eligible-geography` and the exact sentence.
  - The free-text location and the raw source record are unchanged. Older rows read as Unknown and are not backfilled.
  - **Geographic levels** (extended 2026-10-16):
    - countries, regions (EU/EEA/EMEA/LATAM/APAC/North America/Americas/Worldwide), U.S. states, DC and Puerto Rico (`US-TX`, `US-DC`, `US-PR`), Canadian provinces and territories (`CA-ON`), and UK nations (`GB-SCT`);
    - full names, plus two-letter postal codes written in capitals for U.S. states and Canadian provinces/territories;
    - **classification:** residence restricted entirely to U.S. geography → `US_REQUIRED` (e.g. "must reside in Texas or Florida" → `US-TX`, `US-FL`); any non-U.S. place allowed or required → `NON_US` (e.g. "open to residents of Ontario", "US or Ontario"). The stated places are kept in `residencyRegions`.
  - **Never resolved by guessing:**
    - "Georgia" (state or country), a bare "Washington" (state or D.C.) and "CA" (California or Canada);
    - a city ("New York City");
    - a list with an unreadable item ("Texas or Narnia").
    - Such statements leave residency Unknown.
  - **Ordinary location fields** such as "Chicago, IL" or "Toronto, ON" are never a residency requirement; explicit candidate residence or eligibility wording is required. A remote-qualified location field ("Remote - Texas", "Remote (Ontario)") still counts as stated eligibility, as before.
- **Manual form:** a new optional "Additional details" group (work arrangement, seniority, employment type, salary currency, department, closing date). Blank stays Unknown.
- **Provenance and preservation:**
  - every populated value gets `FieldProvenance`: DIRECT when stated, DETERMINISTIC when read from text;
  - original text, the `SourceRecord` and the raw payload are preserved;
  - `RawOpportunity` is unchanged, and the stated details live in `sourceMetadata.details`.
- **Existing rows:**
  - older opportunities keep null facts; there is no backfill, and they stay listed and filterable as Unknown;
  - historical evaluations and evaluated job descriptions are untouched.
- **Evaluator boundary:**
  - `loadSubject()` withholds the newly populated fields, so the evaluator's input is exactly as before;
  - the Customer Success salary hard filter would otherwise use parsed amounts without comparing currencies;
  - Codex review is requested in `HANDOFFS.md`.

**Dashboard (Task 7 completed):**
- **Filters:**
  - work arrangement and seniority (multi-select, each with "Unknown (not stated)");
  - residency requirement: U.S. residence required / Non-U.S. residence allowed / Unknown (multi-select, `residency=` in the URL);
  - department (values present in the data);
  - salary currency;
  - salary at least / at most.
- **Salary filter semantics:**
  - amounts are compared in one currency only, USD when none is chosen;
  - a range matches when it can reach the amount, including open-ended ranges;
  - opportunities without an amount, in another currency, or with an unknown currency are counted and named in a note under the result count.
- **Sorts:** "Salary, highest first" and "Salary, lowest first". Both are grouped by currency and never interleave currencies. Unknown currency comes next and no stated amount last, then deterministic tie-breakers. A note explains this when no currency is selected.
- **Semantics kept:** OR within a filter, AND across filters; malformed values are dropped; old URLs are unchanged; the canonical redirect adds `currency=USD` to a bare amount.
- **Server-side and parameterized:** filtering runs in the existing `buildFilterPredicate` and sorts in the whitelisted orders. All values are bound parameters, and the API returns `salaryExclusions`.
- **Rows and detail page:**
  - rows show the work arrangement and residency;
  - the opportunity page shows salary range, closing date, work arrangement, residency requirement (with eligible geographies), seniority (as stated), department and employment type, each "Unknown" when not stated.
- **Fixed while verifying:** a filter change made before the page finished hydrating was silently lost. The form now submits such a change on mount. A unit test guards against the form ever submitting itself unprompted.

**Not complete, and why:**
- **Structured location** (office city/region): manual entry gives free text, so it stays a "location contains" filter, deferred to retrieval. Eligible-residence geography is now structured (above).
- **Residency from cities, or from ambiguous names** (Georgia, Washington, CA): stays Unknown. U.S. states, DC, Puerto Rico, Canadian provinces/territories and UK nations are supported.
- **Time-zone requirements, bonus and equity:** not populated from manual input.
- **Re-normalizing changed listings:** there is no re-observation path yet, so it is blocked on dedup and re-observation in the scraper phase.
- **Salary analytics:** still deferred.

**Schema:** only the residency migration above. The salary and position columns already existed.

**Final data contract for Codex Milestone 4** (salary eligibility):
- Facts stored: salary bounds, currency, original compensation text, location, work arrangement, residency requirement and eligible residence. The full table is in `HANDOFFS.md`.
- Task 7 implements no salary policy: no Pass/Review/Skip, no FX conversion, no cost-of-living judgement, and no recommendation change.
- The salary policy keys on residency, not on the quoted currency.
- The evaluator subject still withholds all newly normalized fields until Milestone 4 adopts them.

**Tests:**
- unit `opportunity-normalization.test.ts` (39, including the bare-$ rule, explicit-currency precedence and provenance marking), `opportunity-filters-hydration.test.tsx` (5), plus query, UI and handler additions;
- unit `opportunity-residency.test.ts` (57, including states, DC, provinces, UK nations, ambiguous names and ordinary location fields): the geography vocabulary; explicit U.S.-required and non-U.S. statements; generic Remote, ambiguous, negated and conflicting text staying Unknown; a USD salary for a Spain-located role; a U.S.-required role quoted in EUR; provenance; the stated-precedence rule; submission validation; the query and labels;
- integration `opportunity-residency.test.ts` (8, including a U.S.-state statement, a provincial statement with an ordinary "Toronto, ON" field, and a plain "Chicago, IL" field staying Unknown): persisted facts independent of currency, provenance markers, raw records unchanged, evaluator withholding, residency filters alone and with salary/currency, malformed values, legacy rows;
- integration `normalized-opportunity-filters.test.ts` (12): persistence and provenance, evaluator withholding, salary boundaries, currencies, exclusions, malformed parameters, arrangement, seniority, department, AND/OR, null legacy rows, sorts and Unknown ordering;
- E2E: manual entry with details, then the arrangement filter, residency filters (U.S.-required and Unknown), the salary filter with its exclusion note, and the salary sort.

**Verification** (isolated test database; normal database untouched; no paid calls):
- typecheck, lint and Prisma validate pass;
- unit 1036/1036, integration 176/176, E2E 25/25 (after the geographic-levels extension);
- `db:verify-migrations` passes (14 migrations, known drift only);
- build passes.

#### Completed — Task 8: Application tracker (October 9, 2026)

An application-tracking layer beside the opportunity lifecycle. The evaluator, recommendation semantics, profile, budget, provenance and usage accounting are untouched.

- **Model** (migration `20261009090000_application_tracker`, additive; the known `Recommendation` drift line is excluded):
  - one `Application` per Opportunity (`opportunityId` unique), with `stage`, `outcome`, `appliedOn`, `closedOn`, a `version` (CAS) and `lastEventSequence`;
  - an append-only `ApplicationEvent` history with a per-application, gap-free `sequence`;
  - `ApplicationNote`, `ApplicationContact`, `ApplicationFollowUp` and `ApplicationInterview`, each with its own `version`.
  - No Opportunity data is snapshotted; title, company, URLs and provenance are read live.
- **Stages** (fixed for Task 8): Planning to apply → Applied → Recruiter screen → Interviewing → Final interview → Offer → Closed.
  - Submitted stages move freely in either direction; a submitted application never returns to planning.
  - Closing needs an outcome: offer accepted/declined (from Offer only); rejected, withdrew or no response (from any submitted stage); decided not to apply (from planning only).
  - Reopen returns to the stage held before closing.
- **`appliedOn` invariant**, enforced by a database CHECK and mirrored by `appliedOnRequired()`:
  - NULL for PLANNED and for CLOSED/NOT_SUBMITTED;
  - non-null for every submitted stage and submitted outcome.
  - Closing and reopening never change it. A correction is refused on never-submitted applications.
- **Lifecycle interaction** (explicit and conservative):
  - A plan is possible only from a system state or Saved. An opportunity already marked Applied can only be tracked as submitted, prefilled from the MARK_APPLIED behind its current state (the same undo stack as RESTORE) and with no new lifecycle action. A direct plan request returns 409 `APPLICATION_ALREADY_SUBMITTED`.
  - Submitting applies MARK_APPLIED in the same transaction. Closing (including rejected or withdrew) never changes the lifecycle, and archiving stays separate.
  - Lifecycle actions run through a guard under the Opportunity row lock:
    - MARK_APPLIED is refused while the application is unsubmitted (planned, or closed as not submitted);
    - RESTORE is refused from Applied while a submitted application exists;
    - DISMISS is refused while the application is active.
  - Reopening to planning needs a lifecycle that permits a plan. Archived opportunities make the application read-only.
- **Concurrency:**
  - every application write and guarded lifecycle action takes the Opportunity row lock;
  - the 10 commands that update existing state require `expectedVersion` (per entity), and a stale version returns 409 `APPLICATION_CHANGED` with no event, no sequence number and no partial change;
  - additive commands take no version.
- **Follow-ups** use UTC calendar dates (stated in the UI). The next action is the earliest open follow-up; states are overdue / due today / upcoming (7 days) / later / done.
- **UI:**
  - an Application section on the opportunity page: start tracking by lifecycle mode, stage controls, close and reopen, applied-date correction, follow-ups, interviews (with a "Move to Interviewing?" suggestion), contacts (mailto and safe profile links), editable notes with history, and a readable timeline;
  - the lifecycle card explains blocked actions;
  - stale-version conflicts keep typed input and offer "Load latest";
  - a new `/applications` tracker: summary counts, Active/Closed/All views, stage, outcome, follow-up and applied-date filters, search, sorts and canonical URL state;
  - dashboard rows show the stage or outcome badge, the next or overdue follow-up, and "Not tracked yet"; a "Follow-ups due" attention item equals `/applications?followUp=due`.
- **API:**
  - `POST`/`GET /api/opportunities/[id]/application`;
  - `GET /api/applications`;
  - `GET`/`POST /api/applications/[id]` (one validated command endpoint).
- **Tests:**
  - unit: `application-rules.test.ts` (rules, invariant, guards, effective date, follow-up states, schemas and version requirements, handler error mapping), `application-query.test.ts` and `application-ui.test.tsx` (jsdom: start tracking by mode, conflict keeps typed input, read-only archived view, timeline sentences);
  - integration: `application-tracker.test.ts` (34 tests, including the four DB-rejected `appliedOn` shapes, compatibility with existing APPLIED, guards, a 6-round plan/MARK_APPLIED race, stale versions for all 10 commands, concurrent equal-version pairs, independence from reevaluation and budget deferral, and tracker/dashboard counts);
  - E2E: `applications.spec.ts`;
  - three racing waits fixed in `evaluation-results.spec.ts` (test-only).

#### Completed — Task 8 completion pass (implemented October 15, 2026; committed as `534a4c7` on October 16, 2026)

*(Recorded on October 15, 2026 as "awaiting review, not yet committed"; reviewed, committed and pushed on October 16, 2026.)*

An audit-first pass over the October 9 tracker. The established model is unchanged: the same seven stages and six outcomes, "Interested" = Saved, "Applying" = Planning to apply, and assessment/case study as an interview type. No evaluator, routing, prompt, provider-schema, recommendation, Resume Match/JD Reconstruction, evidence or pricing code was touched.

- **Audit result.**
  - Complete, kept as is: persistent stages and outcomes, notes, contacts, the guarded lifecycle path, persistence across refresh/restart, and separation from evaluation.
  - Partial or inconsistent, fixed below: date rules, follow-up editing, interview editing, due-work visibility for closed/archived applications, `/applications` filter/view combinations and empty states, conflict recovery, refusal text, and the opportunity-page load failure.
  - Out of scope (later add-ons 20–23): notifications, proactive follow-ups, calendar, email, application assistance.
- **Calendar dates.**
  - Applied and closed dates cannot be later than the current UTC calendar date. A close cannot be earlier than the applied date, and an applied-date correction cannot be later than the closed date. There is no day of tolerance.
  - Refusals return 400 `APPLICATION_DATE_INVALID` and leave no trace; a submission refused for its date also leaves the lifecycle unchanged.
  - The date pickers carry the same limits. Date-only values round-trip unchanged (browser → API → `DATE` column → API → browser), verified in several process time zones and in a UTC+14 browser.
- **Follow-ups.**
  - New versioned `updateFollowUp` command (description and due date). It records a `FOLLOW_UP_UPDATED` event holding the previous values; the timeline shows "rescheduled from … to …".
  - Each follow-up has an edit form.
- **Actionable next actions.**
  - Only actionable applications (not closed, opportunity not archived) have a next action. This rule now drives the follow-up filters, the tracker tiles, the next-action sort, the dashboard row badge and the "Follow-ups due" count, so each tile still equals its linked view.
  - The follow-up rows themselves are kept; reopening or restoring makes them due again.
  - The existing Next-action cell and the panel state "closed" or "archived" instead.
- **Interviews.**
  - A full edit form (type, round, date/time, status, interviewer, notes). An untouched time is kept exactly.
  - The status is selectable when adding.
  - The quick status control follows a status saved elsewhere.
  - "Move to Interviewing?" appears only when an interview is not cancelled.
- **`/applications`.**
  - An outcome or the Closed stage chosen under the default Active view widens the view to All (canonical redirect).
  - Empty results recover inside the tracker: "Clear all filters", "Search all applications" or "View all applications", with the count in the other view. Only when nothing is tracked at all is the dashboard linked.
  - The "No open follow-up" filter is relabelled "No next action".
- **Stale writes.**
  - Typed input is kept on every refusal: the destructive remount keys on the stage, close and applied-date forms are removed, and an untouched applied-date form follows the persisted value.
  - "Load latest" is offered for `APPLICATION_CHANGED`, `OPPORTUNITY_ARCHIVED`, `APPLICATION_EXISTS`, `APPLICATION_ALREADY_SUBMITTED` and `OPPORTUNITY_NOT_TRACKABLE`. Validation and transition refusals show only their message.
  - The version is checked before the dates, so a stale form gets the conflict first.
- **Other.**
  - Tracking/reopen refusals name the opportunity's own state (dismissed, archived, closed posting, not yet processed).
  - The opportunity page shows a load-error notice instead of silently omitting the Application section.
- **Migration.** `20261017090000_application_follow_up_updated`, additive only: `ALTER TYPE "ApplicationEventType" ADD VALUE 'FOLLOW_UP_UPDATED'`. It was applied and verified on the isolated test database only.
- **Lifecycle.** The guarded path (`pendingUserActions` → `applyUserActionInTransaction` → `applyLifecycleActionGuarded`) is unchanged. New tests cover the 409 `APPLICATION_BLOCKS_ACTION` mapping, the route's use of the guarded writer, and reevaluation, sync and sweep never downgrading Applied or touching application rows.
- **Later analytics (features 15/17).** No analytics were built. A test asserts that the dated, gap-free history yields submission → stages → interview → outcome with dates.
- **Tests.**
  - unit: `application-completion.test.ts` and `application-completion-ui.test.tsx` (new); `application-rules.test.ts` updated for the eleventh versioned command and the 400 mapping;
  - integration: `application-tracker-completion.test.ts` (new, 15 tests);
  - E2E: two tests added to `applications.spec.ts`, running in a UTC+14 browser.
- **Verification** (isolated test database only; no paid provider calls; normal database transaction count 0): typecheck and lint clean; Prisma schema valid; `db:verify-migrations` 15/15 migrations in order (only the documented `Recommendation.evidenceReferences` drift); unit 41 files / 1,077 tests; integration 21 files / 191 tests; production build succeeds; E2E 27/27 across all five projects.
  - Two earlier E2E runs failed on wrong assertions in the new tests, which were then fixed; the product behaved correctly both times.
  - The second of those runs also failed the existing `opportunity-dashboard.spec.ts` cleanup, because its compiled helper was deleted by another worker. This is a latent race in that spec when Playwright splits the file across workers after a worker restart. It was not changed in Task 8 and passes in normal runs.

#### Completed — Task 9: Final setup, operations, integration and acceptance (October 10, 2026)

The manual-input product is ready to use as one product. It is ready for the evaluator freeze and the final integration checkpoint; scraper/retrieval work has not started. No evaluator semantics, stages, routing, prompts or recommendation logic changed.

- **Setup and operations** (the root `README.md` "Local Development" section is now the authoritative guide):
  - new scripts:
    - `pnpm app:setup` (generate + migrate)
    - `pnpm db:migrate`
    - `pnpm db:status`
    - `pnpm db:verify-migrations`
    - `pnpm app:doctor`
  - The `app:` prefix is needed because `pnpm setup` and `pnpm doctor` are built-in pnpm commands.
  - `pnpm app:doctor` is strictly read-only (SELECTs and environment checks; never prints values; never runs recovery). It reports:
    - configuration by variable name;
    - database, migrations and the generated client;
    - the active profile;
    - whether a worker is connected;
    - the queue, including leases that expired, reported without claiming the worker stopped.
  - `/api/health` now checks the database (503 when unavailable) and reports whether AI is configured.
  - `.env.example` is grouped (required, real AI, optional, test-only), and its OpenAI key is blank.
- **AI configuration:**
  - Reading results and history no longer needs an OpenAI key; only requesting or resuming an evaluation does.
  - A missing or placeholder key returns 503 `PRODUCTION_CONFIGURATION_MISSING` before anything is written.
  - The worker refuses to start with a named-variable message.
- **Worker and queue:**
  - Single-worker advisory lock: a second worker exits non-zero.
  - Worker-owned recovery of tasks orphaned on their final attempt (`EVALUATION_LEASE_EXPIRED`). It runs only under the lock and only while idle, so it can never fail a live run.
  - Error classes:
    - transient infrastructure errors back off (capped at 30 s) and continue;
    - configuration errors and unexpected/fatal errors exit non-zero instead of looping;
    - evaluation failures are persisted as before.
  - The lifecycle sweep runs every 5 minutes.
  - Sanitized operational logs.
  - Graceful stop on the first Ctrl-C; immediate exit on the second.
- **Honest queue states** (server time): `QUEUED`, `QUEUED_LONG`, `RUNNING`, `RUNNING_STALE`, `FAILED`, `COMPLETED`. `RUNNING_STALE` means the lease expired; the UI says the run may still be in progress or the worker may have stopped.
- **Safe errors:**
  - The public evaluation JSON no longer returns stored error messages or provider request IDs.
  - Every failure code the system produces has a safe message, including `PROVIDER_HTTP_*` and `OPERATION_METADATA_PERSISTENCE_*`.
  - "Request another evaluation" is offered only when the opportunity is evaluable.
- **Production start:** one Prisma client per process in every environment (previously one per repository under `next start`).
- **Navigation and coherence:**
  - a shared header (Dashboard, Applications, New opportunity, Profile & preferences, Budget) with a skip link and current-section marking;
  - a not-found page and an error page;
  - page titles;
  - a visible opportunity title (h1) on the detail page;
  - a bad id is a 404, while a load failure is an error page.
- **Labels and copy:**
  - "Application: …" badges on dashboard rows;
  - a "Due today" tracker tile that links to a matching `followUp=today` view;
  - readable lifecycle and provenance labels ("Found via", "Manual entry (manual-input)");
  - "Save opportunity" button;
  - the interview status selection is kept after "Load latest".
- **Migrations:** `pnpm db:verify-migrations` applies all 11 migrations to a temporary database. It confirms they are recorded in order and that the only schema difference is the known `Recommendation.evidenceReferences` default line, then drops the database.
- **Test infrastructure:**
  - opt-in `TEST_DATABASE_URL` (integration and E2E) and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`;
  - new final Playwright project `acceptance`;
  - E2E helper commands `expire-lease` and `run-recovery` (the recovery command takes the lock).
- **Tests added:**
  - unit: `worker-operations.test.ts` (classifier, loop, AI configuration, doctor) and `navigation.test.tsx`; queue-state and failure-code cases in `evaluation-experience-correctness.test.tsx`;
  - integration: `worker-recovery.test.ts` (recovery, lock, doctor makes no writes, public JSON shape, reads without AI) and `product-acceptance.test.ts`, one connected scenario:
    1. capture and provenance;
    2. profile pinning;
    3. budget deferral and resume;
    4. deterministic worker completion: recommendation, evidence, usage and cost;
    5. dashboard state;
    6. lifecycle and application tracking;
    7. reevaluation under a newly active profile;
    8. history;
  - E2E: `golden-path.spec.ts` (golden path, plus recovery: polling resumes after a refresh, the stale-lease copy, worker recovery, and the 404 page).
- **Verification (no paid provider calls):**
  - typecheck, lint, Prisma validate pass;
  - `db:verify-migrations` passes;
  - unit 896/896, integration 138/138;
  - build and a `next start` health smoke check pass;
  - E2E 23/23;
  - `pnpm app:doctor` reports no blocking problems.

#### Completed — Task 9 completion pass (October 16, 2026; committed as `feat: complete operational hardening`)

*(Heading before the commit, October 16, 2026: "In progress — Task 9 completion pass (October 16, 2026; implementation verified; documentation synchronized; awaiting review; not committed)".)*

An audit-first pass over the October 10 Task 9 operations work, planned and approved before implementation. The worker loop, single-worker lock, task claiming, recovery, error classification, backoff, shutdown, lifecycle sweep, queue states, AI-configuration handling, health behavior, public evaluation API, navigation and acceptance tests were audited as complete and left unchanged. No evaluator, routing, prompt, queue, lease or shared-persistence code changed, and there is no migration.

- **Audit result.**
  - Complete: setup, migrations and their verification, health behavior, AI configuration, worker startup and shutdown, single-worker enforcement, claiming and recovery, exhausted leases, error classification and backoff, queue-state truthfulness, the Prisma/process model, navigation, and acceptance coverage (which tracks applications through the Task 8 tracker).
  - Inconsistent or partial, fixed below: two API routes logged raw error objects; the doctor's deferral line predated usage-limit deferrals; the health endpoint's failure path had no unit test; and the README omitted usage-limit deferrals.
- **The three documented queue limitations** (`HANDOFFS.md`, Task 9 handoff) remain accurately described and acceptable for the one-worker product:
  - no lease heartbeat or claim ownership;
  - `Evaluation.status` lag (every product read uses task status first);
  - task-level retries unused (provider-call retries and user reevaluation cover retryable AI failures).
  - They stay for the final-integration/Codex review.
- **Log hygiene.** `POST /api/opportunities` and `GET /api/opportunities/[id]` now log only the error name, like every other route. A raw error could carry submitted job text or database details. Response bodies are unchanged.
- **`pnpm app:doctor`.** The deferral line now separates requests waiting for the AI budget (including legacy `BUDGET_UNAVAILABLE` rows) from those waiting for usage limits (`USAGE_LIMIT_REACHED`). The query is still a single SELECT; the doctor stays read-only.
- **E2E credential.** `playwright.config.ts` and `e2eEnvironment()` always use the deterministic, non-live `OPENAI_API_KEY`, so the test runner, its helpers and the web server never inherit a real key from `.env`. Other AI settings still follow `.env`. Production AI configuration is unchanged.
- **Worker-lock caveat (documented, not changed).** The single-worker lock lives on the worker's own database connection and is not a heartbeat. If that connection drops during a run and a second worker starts, the second worker's recovery can fail a still-running task whose lease expired on its final attempt. The README now states this and the one-worker rule; the October 10 record above is left as written.
- **README.** Usage-limit deferral in §5, §7 and troubleshooting; the E2E credential note in §6; the lock caveat in §5.
- **Documentation synchronization (October 16, 2026).** This follows a separate documentation audit.
  - Current-state documents now show Task 8 complete and Task 9 current: `AGENTS.md`, `AGENT_WORKSTREAMS.md`, `PRODUCT_STATUS.md`, `DEVELOPMENT_PLAN.md`, the root `README.md`, `AI_Career_Platform_README.md`, and the status sections of `AI_Architecture_README.md`.
  - Additions:
    - `EVALUATOR_STATUS.md` §20: evaluator-branch contract history, residual risks, outstanding verification;
    - dated annotations in `HANDOFFS.md`;
    - Task 8 and Git-recorded history in `CHANGELOG.md`;
    - a Git-record addendum to `MILESTONES_1_10.md`.
  - PRDs, TDDs and the Semantic Evaluation Playbook are unchanged; their next versions follow Task 9.
- **Test infrastructure.** `vitest.config.ts` resolves the web app's `@/` alias, so route handlers can be unit-tested.
- **Tests.**
  - unit: `operations-hardening.test.ts` (new): health 200/503 with no detail leakage; error-name-only logging in both routes (these tests fail on the previous route code); the deterministic E2E key. `worker-operations.test.ts`: the deferral breakdown.
  - integration: `worker-recovery.test.ts` gained a test checking the doctor's per-reason counts against independent counts.
- **Verification** (isolated test database only; no paid provider calls; normal database transaction count 0):
  - typecheck and lint clean; Prisma schema valid; `db:verify-migrations` 15/15 (only the documented `Recommendation.evidenceReferences` drift);
  - unit 42 files / 1,086 tests; integration 21 files / 192 tests; production build succeeds; E2E 27/27.
- **Closure (October 16, 2026).** The user reviewed and approved the pass. The current-state documents were then updated from "Task 9 current" to "Task 9 complete", a Task 9 entry was added to `CHANGELOG.md` and a closure note to `HANDOFFS.md`. The pass was committed as `feat: complete operational hardening` and pushed to `origin/claude/gallant-pasteur-y1ou3i`; `main` was not merged. The full suites were not rerun for the documentation-only closure edits; the implementation and tests are byte-identical to the verified state above.
  - Operational checks on the test database: `pnpm app:doctor` (no blocking problems); `pnpm db:status` (up to date); `pnpm app:setup` (no pending migrations); `pnpm worker:evaluations:once` refuses the placeholder key and exits 1; `next start` `/api/health` returns 200 on the test database and 503 `degraded` on an unreachable one, with no URL in the response or log.

#### Completed — Profile limitations persistence (main-product completion, task 1; October 14, 2026)

The product persistence boundary can now carry structured profile `limitations`, which the accepted evaluator's Resume Match needs before a requirement can become a Genuine Gap. Only product-owned plumbing was added. No evaluator-owned domain schema, enum, prompt, Resume Match logic or bundled-profile content was ported or changed, and the installed strict profile contract was not loosened.

- **Schema:** additive nullable `UserProfile.limitations` (JSONB), migration `20261014090000_user_profile_limitations`. Existing rows keep NULL and are never rewritten.
- **Import and versioning:**
  - `VersionedUserProfileData.limitations` is optional (`database/src/user-profile-import-repository.ts`).
  - Content identity includes limitations when present. A version without them, absent or null, hashes and stores exactly as before, so existing versions keep their identity and re-saving them creates no duplicate.
  - Changing limitations appends a new version; identical content does not.
- **Repository:** `PrismaUserProfileRepository.getVersion()` returns `document.limitations` only when stored. So the JSON editor round-trips limitations, and versions without them look exactly as before.
- **Evaluator delivery:** `loadSubject()` adds `userProfile.data.limitations` only when the pinned version stores them (shared persistence; flagged in `HANDOFFS.md`).
- **Pinning:** active-profile, evaluation and deferral pinning are unchanged. A newer version with limitations never changes queued or deferred work.
- **Editor and API:** documents pass to the domain validator unchanged. With the currently installed contract, `limitations` is rejected as an unknown field. Once Codex's profile contract is integrated, the same path accepts it with no product change.
- **Tests:** `tests/integration/profile-limitations.test.ts` (7):
  1. import → database → repository round trip;
  2. identity and versioning (duplicate, change, removal, old rows unchanged);
  3. absent and null identity;
  4. legacy rows still building the evaluator profile context;
  5. `loadSubject` delivery with evaluation and deferral pinning;
  6. the starting-profile web save path;
  7. the editor deferring to the installed domain contract.
- **Isolated test database:** all verification ran against a separate database (`ai_career_assistant_test`) via `TEST_DATABASE_URL`. The normal application database recorded zero transactions throughout.
- **Verification:**
  - typecheck, lint, Prisma validate, and `db:verify-migrations` (12 migrations, known drift only) pass;
  - unit 896/896, integration 145/145, E2E 23/23;
  - build passes.
  - No paid calls.
- **Post-integration acceptance tests (run when the evaluator branch is integrated):**
  1. the editor accepts valid limitations and rejects invalid ones per Codex's `profileLimitationSchema`;
  2. `pnpm profile:import:customer-success` and "Create from the starting profile" persist the migrated bundled profile, including its limitation;
  3. a persisted profile with a limitation lets deterministic Resume Match produce a Genuine Gap end to end;
  4. re-import and activate the migrated profile before any acceptance run.

#### Completed — Policy and profile integration readiness (main-product completion, task 2; October 14, 2026)

The audit found no change that would require evaluator semantics to change.

- **Stale policy pin removed:**
  - `.env.example` no longer sets `AI_EXECUTION_POLICY_VERSION=customer-success-semantic-policy-v3-mixed-terra-luna`. It now explains why the variable stays unset.
  - The policy version comes only from the evaluator's built-in `customerSuccessProductionSemanticPolicyVersion` (`packages/shared`, evaluator-owned, unchanged), so the integrated evaluator supplies its own version.
  - No policy identifier was invented.
  - The worker's fail-closed policy-mismatch check, and the policy and pricing metadata stored on evaluations, are unchanged.
- **`pnpm app:doctor` (still read-only)** now reports:
  - the effective policy version, with a WARN when `.env` overrides it;
  - the active profile version and whether it stores structured limitations;
  - open deferrals pinned to a profile version other than the active one, with guidance to resume or cancel and request again through the existing UI.
- **Profile resolution audit:** explicit ID → active version → newest fallback (only when nothing was ever activated). Evaluation and deferral pinning are unchanged. No product code resolves "newest" where the active version applies.
- **Docs:**
  - README environment table, troubleshooting, a new "Updating the evaluator or the bundled profile" operator section, and the current development status;
  - `PRODUCT_STATUS.md` main-product status.
- **Tests:**
  - unit: doctor policy, active-profile and deferral reporting;
  - integration: doctor reads against a migrated profile and a deferral pinned to the older version, on the isolated test database.
- **Verification:** see the commit for this task. No paid calls; normal database untouched.

#### Completed — Task 6 completion: AI budget, throughput, capacity and backlog (main-product completion, task 3; October 15, 2026)

Completes the Core PRD v1.3 "Configurable AI Budget and Throughput Controls" and "AI Capacity and Budget Visibility" requirements, and Core TDD v1.4 "AI Usage and Budget Persistence", "Budget and Deferral API Boundary" and "AI Budget Observability". No evaluator stage, prompt, routing, model, schema or recommendation changed.

**Already complete before this task (Task 6):**
- monthly spending limit (calendar month in a chosen time zone; enforced or advisory);
- atomic, concurrency- and restart-safe reservation through admissions under an advisory lock;
- reconciliation, derived from persisted attempt costs (unknown cost is never $0);
- remaining budget;
- persistent deferred backlog pinned to the profile version, with resume and cancel; resume rechecks budget, eligibility, active work and the pinned profile;
- Unknown token and cost handling in usage totals.

**Added by this task:**
- **Settings** (migration `20261015090000_budget_throughput_limits`, all additive): warning thresholds (up to five percentages), evaluations per day, evaluations per week (ISO week, Monday start, in the budget time zone), output tokens per month, and AI calls per evaluation. Blank means no limit. Nothing is ever raised automatically.
- **Admission:**
  - Every configured limit is checked under the existing admission lock against persisted rows only, so concurrent requests cannot overshoot and restarts never reset counts.
  - Volume counts non-abandoned admissions in the local day and week.
  - The output-token limit counts provider-reported output tokens in the budget month. Unreported tokens stay Unknown and are reported, never counted as zero. Running evaluations always finish.
  - A limit hit is an operational deferral: reason `USAGE_LIMIT_REACHED`, or `AI_BUDGET_LIMIT` when the monetary budget is among the limits reached.
  - The snapshot records every limit reached.
  - Resume rechecks the budget and all limits, plus the existing eligibility, active-work and pinned-profile checks.
  - The enforcement switch covers the budget and the limits; when off, limits are reported but never defer.
- **AI calls per evaluation:**
  - The user may only lower the system maximum (`AI_CALL_BUDGET`), and never below the evaluator's operation count, which is what a normal evaluation needs.
  - It is applied through the existing persisted `executionMetadata.semanticCallBudget` at enqueue, so evaluations already queued keep their allowance.
  - No monthly call-count cap was added (decision recorded with the user).
- **Warnings:** derived from configured thresholds over spent plus reserved, and shown on the dashboard budget card and `/budget`.
- **Reporting** (`GET /api/budget/report`, the `/budget` "AI usage and capacity" section):
  - counts of eligible-not-yet-evaluated, evaluated, queued, running and deferred, with a domain × source-type breakdown;
  - provider-reported tokens this month, with unreported attempts counted separately;
  - estimated remaining capacity (by budget, by today's limit, by this week's limit), Unknown when a budget is set without a cost basis;
  - estimated cost of the deferred and of the eligible backlog (average recorded cost of the last ten fully costed completed evaluations; Unknown without one);
  - known spend per day for the month and per month for six months, with unknown-cost attempts shown;
  - the pricing and configuration basis: policy version, configured pricing versions, the pricing versions behind the estimates, call-allowance bounds, and when the budget was last changed.
  - No credentials, provider error text or request IDs are returned.
- **Also fixed:** the shared site header from Task 9 had no styles and rendered as a bullet list; it is now styled.
- **Tests:**
  - unit `budget-throughput.test.tsx` (24): windows across time zones, DST and year end; warnings; limits; estimates; validation; card, deferral and report rendering; API error sanitization;
  - integration `budget-throughput.test.ts` (10): daily and weekly limits and resets; six simultaneous requests against a limit of two; budget plus limit; enforcement off; output-token cap with unreported tokens and untouched queued work; warnings; invalid settings; call allowance bounds and persistence; report counts, tokens, estimates, spend over time and no secrets;
  - E2E: a daily limit defers the next request, and `/budget` shows the report.
- **Verification** (isolated test database; normal database untouched; no paid calls):
  - typecheck, lint, Prisma validate, and `db:verify-migrations` (13 migrations, known drift only) pass;
  - unit 923/923, integration 155/155, E2E 24/24;
  - build passes.

**Still open (recorded in `HANDOFFS.md`):**
- Already-queued evaluations are still not cancelled when the budget is lowered (unchanged, still awaiting explicit acceptance).
- Source Analytics exclusion of budget deferral applies once Source Analytics exists.

**Resolved by the Task 6 naming cleanup (below):** the deferral reason name (now `AI_BUDGET_LIMIT`, matching the TDD) and the eligibility wording (neutral "eligible for evaluation").

#### Task 6 naming cleanup — completed (2026-10-14)

A small alignment patch. Task 6 stays complete; admission behaviour is unchanged.

- **Deferral reason renamed:**
  - The monthly dollar budget now defers with `AI_BUDGET_LIMIT`, the TDD name. It replaces `BUDGET_UNAVAILABLE`.
  - Non-dollar limits keep `USAGE_LIMIT_REACHED`.
  - The constants and `normalizeDeferralReason()` live in `packages/core/src/budget.ts`.
  - The backlog label reads "AI budget limit".
- **Backward compatibility:**
  - Handled at read time. `PrismaDeferredEvaluationRepository` maps a stored legacy `BUDGET_UNAVAILABLE` to `AI_BUDGET_LIMIT`, so the API, UI and resume results only ever show the current name.
  - There is no migration and no bulk rewrite; the column is free text.
  - A legacy row keeps its stored value until a normal resume recheck writes the current reason (existing behaviour).
  - No code filters on the stored reason.
- **Eligibility wording:**
  - Product-owned text uses "eligible for evaluation" (`eligibleNotEvaluated`, "Eligible, not yet evaluated").
  - Model-specific eligibility wording was only in the HANDOFFS contract question, which is now resolved.
  - No Codex-owned text was touched.
- **Unchanged:** queued evaluations are not cancelled when limits are lowered; running evaluations finish; new and resumed evaluations are checked against current limits.
- **Tests:**
  - a unit test for the constants and the normalizer;
  - an integration test: a legacy row reads as `AI_BUDGET_LIMIT` through the list and the gate, the stored value is not rewritten on read, and a still-deferred resume reports `AI_BUDGET_LIMIT`;
  - existing assertions are updated to the new name.

#### Remaining main-product order

Revised roadmap:

- Task 5 — Profile + Preferences: done (see above).
- Task 6 — Budget Ledger + Deferral: done (see above).
- Task 7 — Product UI: dashboard, search, sort, filters, analytics polish: done, including the completion amendment (normalized fields, salary/arrangement/seniority/department filters and salary sorts; structured location and salary analytics deferred).
- Task 8 — Application Tracker: done (see above).
- Task 9 — Final setup, operations, integration, E2E: done (see above).
- Next: freeze the evaluator, then the deliberate final integration checkpoint (see the final integration checklist in `HANDOFFS.md`), then retrieval/scraper work.
- Then retrieval/scraper; then source, job-market and posting-history intelligence; later ecosystem features.

**Current order (updated October 16, 2026; supersedes the "Next" line above):** the Task 1–9 completion pass is complete: Task 8 completion pass committed (`534a4c7`, October 16, 2026); Task 9 completion pass committed (`feat: complete operational hardening`, October 16, 2026). The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete (October 16, 2026). Next comes an audit of any remaining gaps in main-product features 1–10. Then main-product features 11–18 (retrieval, source health, posting-history/ghost intelligence, browser extension, source intelligence, market analytics, personal job-search analytics, company intelligence). Only after all of that: deliberate evaluator/product integration, full isolated verification, E2E acceptance, evaluator freeze and merge. Features 19–23 are later add-ons. See `DEVELOPMENT_PLAN.md`.

#### Known issues found during main-product work

- **Resolved (test-only): evaluator test-harness drift.** On `main` (`ebd5911`), 11 integration tests and both E2E evaluation flows failed because test harnesses lagged accepted evaluator contract changes:
  - the Burnout Risk transport (`65dcaab`);
  - the Resume Match compatibility model (`fe8b0d2`);
  - the mixed-routing execution policy (`a307631`).

  The harnesses are repaired without production changes. Integration is now 25/25 and E2E 4/4. See `HANDOFFS.md` ("Evaluator Test-Harness Drift Repaired").
- **Playwright Chromium mismatch.** In environments with a different preinstalled Chromium build, Playwright 1.62.1 needs a matching browser or a `launchOptions.executablePath` override.

## Planned Next

Task 8 (`534a4c7`) and Task 9 (`feat: complete operational hardening`) are complete.

The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete (October 16, 2026). The features 1–10 gap audit is complete, and the Features 1–10 Gap Closure is committed (`d573acf`, October 17, 2026). Features 11A (`fad2341`), 11B (`2a1d8c2`), 12 (`f10a02b`), 13 (`d1bf217`) and 14A (`dd77d29`, accepted October 20, 2026) are committed; Feature 14B is implemented and verified (October 20, 2026), awaiting review and local acceptance, and not committed.

1. Next: Alex's review and local Chrome acceptance of Feature 14B (implemented October 20, 2026), then its checkpoint commit and documentation closeout; Feature 14 is not complete until it is accepted. *(Earlier steps: "Next: Feature 14B, the browser-extension companion", superseded October 20, 2026 when it was implemented; "Next: user review of Feature 11A …", of Feature 11B, of Feature 12, of Feature 13 and of Feature 14A, superseded October 18–20, 2026 after the commits `fad2341`, `2a1d8c2`, `f10a02b`, `d1bf217` and `dd77d29`; "Next: audit any remaining main-product gaps in features 1–10", superseded October 17, 2026; "Next: user review of the gap closure, the check of the versioned PRDs/TDDs against what changed, then the checkpoint commit", superseded October 18, 2026 after the commit `d573acf`.)*
2. Then, after 14B is accepted, features 15–18 in order: source intelligence, market analytics, personal job-search analytics, and company intelligence. *(Earlier step: "main-product features 14–18: browser extension, …"; on October 19, 2026 the browser-assisted LinkedIn retrieval and source corrections became feature 14A, and the browser-extension companion remains feature 14B, next.)*
3. Only after features 1–18 are complete: deliberate evaluator/product integration, migrations/full isolated verification, E2E acceptance, any explicitly authorized live verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons.

Retrieval must connect to the existing normalization and deduplication pipeline and feed normalized opportunities into the existing evaluator; source coverage expands within features 11–18.

## Settled Decisions

- Customer Success is the first implemented domain.
- The Core Platform remains domain-agnostic.
- Customer Success salary thresholds and affordability policy remain domain-owned.
- Residency requirement selects salary policy; currency never selects residency policy.
- No salary maximum is imposed by the Customer Success hard filter.
- The evaluator should not be redesigned merely to accommodate model/provider quirks.
- Provider transport schemas may differ from persisted domain schemas.
- Authoritative application data should be restored deterministically rather than regenerated by a model.
- Predetermined results belong in code rather than paid semantic calls.
- Unknowns remain Unknown.
- Final Apply / Review / Skip is deterministic application logic.
- Model routing is an execution detail, not a product-semantic change.
- Retrieval must feed the existing normalization/dedup/evaluator architecture. *(Earlier wording: "Retrieval/scraping comes after the first usable product and must feed the existing evaluator." Since October 15, 2026 retrieval is main-product work in features 11–18, built after the Task 1–9 completion pass and before final acceptance.)*
- Main-product scope is features 1–18; only features 19–23 are later add-ons.
- Codex and Claude may work in parallel only with clear ownership boundaries.
- Paid provider calls require explicit authorization.
- Normal application database use for experiments/tests is prohibited unless explicitly authorized.
- Optimization candidates are judged against the last known-good implementation as BETTER / SAME / WORSE.
- Do not fix evaluator issues as isolated one-off symptoms; validate the whole affected contract/path.
- Already-admitted queued/running evaluations are not retroactively cancelled when limits are lowered (accepted; recorded in the October 15 annotations in `HANDOFFS.md`).

## Open Integration Items

These are intentionally not Task 9 work:

- final branch combination and handoff resolution;
- DB-backed acceptance of the Task 7 → Milestone 4 contract, including removing the five released fields from `fieldsWithheldFromEvaluator` on this branch and updating its withholding tests (see the October 15 annotations in `HANDOFFS.md`);
- profile limitation end-to-end acceptance after branch integration (the four post-integration acceptance tests in "Profile limitations persistence" below);
- persisted-attempt seeding / pre-send marker decisions for crash recovery;
- Recommendation evidence-reference schema drift decision;
- full migrations/typecheck/lint/build/integration/E2E acceptance, re-run in full whenever evaluator contracts change;
- any final live provider acceptance run;
- evaluator freeze and deliberate main merge;
- carry the evaluator branch's October 10–15 records into the canonical documentation. They currently live in the Codex branches' root-level `Md and README Docs/CURRENT_PROGRESS.md`, a different path from this file. At branch combination, merge them into this file and `EVALUATOR_STATUS.md` (§19 lists them) without dropping either side (see `HANDOFFS.md`, October 15 annotations, item 3).

Codex reviews still open from the `HANDOFFS.md` Final Integration Checklist:

- the Task 6 `enqueueAdmitted()` shared-persistence change;
- the Task 7 dashboard read dependency on persisted Customer Success result fields;
- the Task 8 guarded lifecycle path (`pendingUserActions`, `applyUserActionInTransaction`, `applyLifecycleActionGuarded`);
- the Core executor lifecycle guard (`isNormalizedLifecycleState`);
- the Task 9 additions (`failExpiredExhaustedTasks`, the worker lock, the Prisma singleton, the public API shape);
- the profile limitations persistence boundary (`loadSubject()` and `UserProfile.limitations`);
- the Features 1–10 Gap Closure shared-boundary changes (October 17, 2026; see `HANDOFFS.md`):
  - the capture transaction and the `ManualOpportunityRepository` port;
  - attached duplicate sources in `loadSubject()`;
  - `timeZoneRequirements` added to `fieldsWithheldFromEvaluator`;
  - the reused-company spelling;
  - the duplicate-spend refusal and its lock.
- the Feature 11A shared-boundary changes (October 18, 2026; see `HANDOFFS.md`):
  - `ingestRetrievedListing()` and `preserveUnnormalizedListing()` on the capture repository, which now implements the new `RetrievalIngestionRepository` port and shares its capture path with manual capture;
  - deduplication engine `core-dedup-v2` (source-scoped listing IDs; listing-ID conflicts only within one source);
  - new `SourceRecord` columns and the retrieval models;
  - no evaluator or `loadSubject()` change: retrieval creates and updates opportunities through the existing capture path, and a retrieved opportunity becomes an evaluator subject only through the existing evaluation workflow (for awareness: its first source record is the first retrieved one, changed observations follow it, and source items live under `rawPayload.source`, with no posting history);
  - the Customer Success discovery configuration (no evaluator code).

Main-product follow-up (not an integration blocker):

- Source Analytics must exclude budget/usage-limit deferrals once Source Analytics exists (features 11–18).
- Feature 11 must reuse the capture transaction and the deduplication engine for retrieved sources. It must add cross-source matching, canonical-source selection by source type, posting history and any merging of opportunities that already have history (not done in the gap closure, by decision). *(Status October 18, 2026: Feature 11A reuses the capture transaction and engine and adds cross-source matching and canonical-link selection. Posting history is feature 13. Merging opportunities that already have history remains undone by decision.)*
- Adzuna stays registered, unverified and disabled until the user provides credentials and authorizes its verification. Its documented search response carries only a description excerpt, which conflicts with the complete-description contract; this is an open Adzuna-specific design decision.
- Run `pnpm db:backfill-dedup --dry-run`, then `pnpm db:backfill-dedup`, on the normal application database. Only when the user chooses to; it changes data.

Documentation items carried from the earlier Open Items list, with their status after the October 15 documentation preservation audit and correction pass:

- exact current local setup/run commands for README: **resolved**. The root `README.md` "Local Development" section is the authoritative operator guide (Task 9 setup tooling).
- complete Milestones 1–10 historical documentation: **resolved**. `MILESTONES_1_10.md` contains all ten milestones.
- complete evaluator-history/status document: **resolved**. `EVALUATOR_STATUS.md` §1–18 are preserved, and §19 adds the October 10–15 state.
- final evaluator benchmark: superseded by the October 15 routing lock. The final live / whole-product evaluation is part of final integration.

Documentation status (October 15, 2026):

- **PRD/TDD archive complete.**
  - All 23 recovered formal PRD/TDD versions, August 2026 → October 15, are in git and hash-verified.
  - Superseded versions are frozen in the `Archive/` folders beside the current PRDs and TDDs.
  - Core AI Framework PRD v1.4 is the new current Core PRD; v1.3 is archived unchanged.
  - Current authoritative versions are listed in `AGENTS.md`.
- **Semantic Evaluation Playbook v1.2** is current; v1.1 is preserved unchanged beside it.
- **Update (October 16, 2026):** the post-Task-9 versioned-document update made Core AI Framework PRD v1.5, Customer Success AI Assistant PRD v1.4, Core Platform TDD v1.6, Customer Success Assistant TDD v1.4 and Semantic Evaluation Playbook v1.3 current. The previous PRD/TDD versions are archived unchanged; Playbooks v1.1 and v1.2 stay beside v1.3. `AGENTS.md` lists the current versions.
- **P13 (specification version index in `CHANGELOG.md`): intentionally deferred.** It was an optional proposal in the documentation preservation audit, never an approved required item, and is not required for the Task 8 documentation gate. The specification history remains recorded in each document's own revision table and in the archived versions.

## Known-Good Principle

When a change introduces instability or semantic regression, revert to the last known-good implementation rather than forcing the change through.
