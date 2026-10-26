# AI Career Platform

A modular AI-assisted career platform for discovering, evaluating, and prioritizing opportunities using transparent, evidence-based reasoning.

The platform is designed to support multiple domain-specific assistants on top of a shared Core AI Framework. The first implemented domain is the **Customer Success AI Assistant**.

## What the Product Does

The platform is built to help users evaluate opportunities based on the actual work described in a listing rather than relying only on job titles or keyword matching.

At a high level, the platform is designed to:

- collect or accept opportunity data;
- normalize opportunities into a common internal format;
- evaluate opportunities through domain-specific pipelines;
- preserve supporting evidence, Unknowns, and contradictions;
- generate transparent recommendations;
- store evaluation history and results;
- support future discovery, deduplication, analytics, and additional domain assistants.

The current working Customer Success flow supports:

```text
Manual Opportunity
→ Persistence
→ Background Evaluation
→ Customer Success Evaluation Pipeline
→ Deterministic Final Recommendation
→ Persisted Apply / Review / Skip Result
→ Results UI
```

Future automated opportunity ingestion will feed the same existing evaluation pipeline:

```text
Job Source(s)
→ Retrieval / Collection
→ Normalization
→ Deduplication
→ Existing Evaluator
→ Apply / Review / Skip
```

## Customer Success Assistant

The Customer Success Assistant evaluates whether a role aligns with the user's career strategy, experience, preferences, and long-term goals.

Its evaluation considers:

- hard filters such as role relevance, location, salary, and travel;
- the actual responsibilities described in the job description;
- company alignment;
- organizational maturity;
- personalized fit;
- burnout risk;
- resume match and transferable experience;
- effective seniority;
- opportunity priority;
- ghost-job risk when sufficient posting-history evidence exists.

The final recommendation is one of:

- **Apply**
- **Review**
- **Skip**

The system does not rely on a single Overall Match score or a simple weighted average to make the final recommendation.

## Evaluation Principles

The evaluator follows several core rules:

- **Evidence first.** Important conclusions should be traceable to supporting evidence.
- **Unknown stays Unknown.** Missing information is not converted into an assumed positive or negative.
- **Substance over buzzwords.** The evaluator reconstructs responsibilities, workflows, ownership, and operating models rather than rewarding expected terminology.
- **Deterministic where possible.** Explicit rules such as salary thresholds, posting-age guidance, and recommendation precedence remain application logic.
- **Semantic analysis where needed.** AI is used for interpretation-heavy work such as responsibility reconstruction, ownership analysis, operating-model inference, transferable-experience comparison, and contradiction detection.
- **Preserve contradictions.** Conflicting signals are surfaced rather than silently resolved.
- **Transparent recommendations.** Apply / Review / Skip should be explainable from the underlying evidence and rules.

## Current Evaluator Architecture

The Customer Success evaluator uses ordered semantic and deterministic stages.

Current accepted semantic model routing:

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
| Ghost Job Risk | Deterministic Unknown when posting-history evidence is insufficient |
| Final Recommendation | Deterministic application logic |

The routing policy is locked (October 15, 2026). A GPT-6 Luna Job Evaluation benchmark was rejected because it regressed an established classification and omitted established evidence; the remaining GPT-6 benchmarks were skipped by product decision.

**Branch state:** the GPT-6 Luna routes for Company Alignment and Burnout Risk are implemented on the Codex evaluator branch (`codex/evaluator-live-diagnostic`). The main-product branch (`claude/gallant-pasteur-y1ou3i`) keeps the earlier accepted GPT-5.6 Luna routes for both until the final evaluator/product integration. Neither branch is merged into `main` yet.

Model routing is treated as an execution detail. It does not change the meaning of the domain schemas, stage outputs, evidence rules, Unknown handling, contradictions, or recommendation behavior.

## Current Development Status

### Implemented

- shared Core evaluation framework;
- manual opportunity ingestion with source provenance;
- PostgreSQL persistence;
- background evaluation processing with a single-worker lock and crash recovery;
- ordered Customer Success evaluation stages;
- evidence tracking;
- Unknown and contradiction handling;
- structured semantic outputs and validation;
- deterministic recommendation logic;
- semantic usage and estimated-cost accounting;
- per-operation model routing;
- persisted evaluation history;
- Customer Success results interface;
- bounded evaluation polling and status handling;
- safe rendering of untrusted job-description content;
- opportunity lifecycle (save, apply, dismiss, archive, restore);
- versioned profile and preferences management with an explicit active version, including persisted structured profile limitations;
- monthly AI budget with reservation/reconciliation, warnings, daily/weekly evaluation and monthly output-token limits, and deferral, resume and cancel;
- dashboard search, filters, sorting and summaries;
- Task 7 normalized opportunity facts: salary minimum/maximum and currency, work arrangement, seniority, department (no longer user-facing since October 26, 2026), employment type, closing date, and residency requirement/regions, with provenance and Unknown preserved;
- shared-normalization convergence (October 25, 2026; awaiting review): a stated compensation range keeps its numbers and basis (base or OTE) in its original currency; explicit work-authorization, sponsorship, relocation and employer-of-record facts for every job, shown against your own "Work eligibility" (profile page) so a requirement you already meet raises no warning; explicit team statements fill the department; and the application URL is captured with how it was found (an apply link, the page's own application form, or the source's posting page);
- cross-source correction (October 26, 2026; awaiting review and a cross-source live retest): one shared contract for every supported source. A remote role's location is where it may be done from, never an optional office. Regional pay tiers have no single range. Stated time-zone preferences, seniority labels and posting ages are kept. Job-page details shown as separate items are read, and other jobs' lists never enter the posting. The opportunity shows Salary, not a separate Compensation row, and Department is no longer a product field;
- application tracker (Task 8 completion pass complete): stages and outcomes with calendar-date rules, rescheduling follow-ups, interviews, contacts, notes, next-action and due visibility, and stale-write protection;
- setup and operations tooling (Task 9 completion pass complete): `pnpm app:setup`, `pnpm app:doctor`, migration verification, `/api/health`, the single-worker lock, honest queue states, error-name-only API logging, and whole-product acceptance tests with a deterministic, non-live E2E credential;
- Features 1–10 Gap Closure (complete, `d573acf`):
  - deduplication of captured listings with provenance retention: an exact duplicate is added to the saved opportunity as another source instead of becoming a second opportunity, and a possible duplicate is flagged for review;
  - a guard against paying twice for one listing, rechecked before a deferred evaluation resumes;
  - company names normalized, so the dashboard company filter treats spellings of one company as one company;
  - versions on evaluation-history rows, an optional stated time-zone requirement, AI usage and spend by domain and source on `/budget`, and phone-width layout fixes;
- Feature 11A, automated retrieval from the verified official API and feed sources (complete, `fad2341`):
  - Greenhouse, Lever, Ashby and SmartRecruiters (employer ATS), plus Remote OK, We Work Remotely, Himalayas and Working Nomads. Adzuna is listed but stays disabled until it is verified;
  - sources managed on `/sources`, disabled until enabled, then run every 12 hours by the single retrieval worker (`pnpm worker:retrieval`);
  - only listings whose title matches a Customer Success role family are kept, with their complete description and raw source data;
  - cross-source deduplication, an employer-ATS application link preferred over an aggregator's, and a changed listing kept as a linked new version ("Listing changed since first seen");
  - retrieved jobs arrive unevaluated: evaluation stays your choice within the budget;
- Feature 11B, the verified public/guest-endpoint and public-HTML sources (complete, `2a1d8c2`):
  - Workday (an employer's career site), the Workable job search and the Wellfound Customer Success role page, through the same retrieval, deduplication and provenance path;
  - Welcome to the Jungle / Otta is listed but cannot be enabled (no public listing interface on its current logged-out site);
- Feature 12, source health and conservative retrieval (complete, `f10a02b`):
  - a failing source is tried again less often (up to once a week), a source's own Retry-After is honoured in full, nothing is retried within a run and no source is disabled automatically;
  - each source on `/sources` shows its health, last successful retrieval and next run; Run now cannot override a rate limit or a wait the source asked for;
- Feature 13, posting history and listing removal (complete, `d1bf217`):
  - each retrieved listing records where and when it was seen; a listing is confirmed "No longer listed" only by a source that shows its whole board, after two complete checks at least a day apart, and one that returns is "Listed again";
  - a "Posting history" section on the opportunity page and a "No longer listed" dashboard badge; nothing closes an opportunity automatically, and Ghost Job Risk does not use this history yet.
- Feature 14A, browser-assisted retrieval and source corrections (complete, `dd77d29`; LinkedIn stays unverified and disabled):
  - LinkedIn's public, logged-out job search and job pages, read in a headless browser started fresh for each run with no account, cookies or stored state, one page at a time at least 5 seconds apart; any refusal, sign-in wall or challenge ends the run and the source backs off. Listed on `/sources` but not enableable: its local adapter check discovered 60 public jobs, then the first job page answered HTTP 429;
  - We Work Remotely reads its all-jobs RSS feed (Customer Success titles kept locally); Wellfound waits at least 12 seconds between requests;
  - the browser-extension companion is not part of 14A: it is Feature 14B.

### In Progress

- Feature 14B, the browser-extension companion, is committed (`e6bacc6`) and stays open (Feature 14 is not complete until it is accepted):
  - **The correction from its local acceptance** is implemented and verified (October 23, 2026), and awaits review and a minimal retest; it is not committed. It is a shared Core job-text fallback: facts a job's description states, when the source supplied none (company, location, pay, work arrangement, employment type, dates, time-zone requirement), are read from that text by one shared reader for every ingestion path. A bare "$" is now US dollars only when the job is clearly in the U.S.;
  - a Chrome Manifest V3 extension (`apps/extension`) that saves the job page you are viewing, only when you ask, into the same ingestion, deduplication, provenance and lifecycle as every other source;
  - it reads structured job data, LinkedIn's job-detail areas only (on LinkedIn job pages), your selected text, or (not on LinkedIn) the page's main content;
  - saving never evaluates; "Request evaluation" uses the existing evaluation path and the popup shows the persisted result;
  - browsers are paired on the new Extension page (`/extension`) with a revocable credential shown once and stored only as a hash. See "5b. The browser extension" below.
- Features 11A (`fad2341`), 11B (`2a1d8c2`), 12 (`f10a02b`), 13 (`d1bf217`) and 14A (`dd77d29`) are complete.
- The Features 1–10 Gap Closure (`d573acf`) and the read-only gap audit of features 1–10 that preceded it are complete.
- Task 8, Task 9 and the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update are complete.

### Main-product work still required before final acceptance

- feature 14B — browser extension companion (implemented, awaiting review and local acceptance; Feature 14 is not complete until it is accepted);
- feature 15 — source intelligence;
- feature 16 — job-market analytics;
- feature 17 — personal job-search analytics;
- feature 18 — company intelligence;
- only after all main-product features 1–18 are complete: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

### Later add-ons only (features 19–23)

- company watchlists;
- proactive notifications/follow-ups;
- calendar integration;
- email integration;
- application assistance such as resume tailoring, cover letters, application questions, interview preparation, and learning recommendations.

Beyond these add-ons, additional domain assistants remain planned on the same Core platform.

The evaluator branch (Codex) holds the locked routing, the October 10–13 evaluator semantic-contract repairs and the Milestone 4 salary-policy alignment, including its October 25 compensation-basis correction (uncommitted there; `cs-hard-filters-v3`, `cs-salary-policy-v3-ecb-2026-10-14`). Core preserves OTE numeric facts. Milestone 4 treats OTE-only compensation as Unknown for confirmed base-salary eligibility. They reach the product at the final integration checkpoint (see `HANDOFFS.md`, final integration checklist and the October 15 annotations).

## Architecture

The shared platform is designed as a modular monolith with clear boundaries between platform infrastructure and domain-specific evaluation logic.

High-level architecture:

```text
Sources
→ Collection
→ Normalization
→ Deduplication
→ Domain Evaluation
→ Evidence Validation
→ Recommendation
→ Storage
→ UI
→ Analytics
```

The Core Platform remains domain-agnostic.

Domain assistants provide their own:

- evaluation criteria;
- hard filters;
- user preferences;
- scoring semantics;
- prompts;
- schemas;
- recommendation rules;
- domain-specific result presentation.

The Customer Success Assistant is the first reference implementation.

## Technology Stack

Current design targets:

- **Frontend:** React + TypeScript
- **Web framework:** Next.js
- **Backend/API:** Next.js server/API layer
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Validation:** Zod / JSON Schema
- **Background processing:** lightweight worker / queue architecture
- **Testing:** Vitest + Playwright
- **Browser-assisted retrieval:** Playwright (`playwright-core`) with headless Chromium, logged out, retrieval worker only (feature 14)
- **Browser extension:** TypeScript + Chrome Manifest V3, bundled with esbuild, loaded unpacked (Feature 14B; `apps/extension`)
- **Version control:** Git

The project intentionally avoids unnecessary infrastructure complexity while the core workflow is being completed.

## Documentation

Authoritative product and technical documentation includes:

- **Core AI Framework PRD** — defines what the shared platform should do.
- **Core Platform TDD** — defines how the shared platform implements those requirements.
- **Customer Success AI Assistant PRD** — defines the Customer Success product requirements.
- **Customer Success Assistant TDD** — defines the executable Customer Success technical design.
- **AI Career Assistant Semantic Evaluation Implementation Playbook** — preserves evaluator implementation safeguards, testing lessons, routing guidance, and optimization rules.

Additional project documentation (paths are listed in the "Documentation Locations" table in `AGENTS.md`):

- `MILESTONES_1_10.md` — Milestones 1–10 implementation history;
- `PRODUCT_STATUS.md` — current product status;
- `EVALUATOR_STATUS.md` — evaluator routing, optimization, and status history;
- `DEVELOPMENT_PLAN.md` — development plan and feature scope (main-product features 1–18; later add-ons 19–23);
- `AGENT_WORKSTREAMS.md` — active workstreams and ownership;
- `CURRENT_PROGRESS.md` — current progress and task records;
- `HANDOFFS.md` — agent handoffs;
- `CHANGELOG.md` — notable project changes.

Superseded PRD/TDD versions are kept for history in the `Archive/` folders beside the current PRDs and TDDs.

## Development Priorities

The current development order (October 16, 2026) is:

1. keep the evaluator stable and make only demonstrated evaluator-sensitive corrections;
2. the Task 1–9 product completion pass is complete (Task 8 and Task 9 complete); the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete; the features 1–10 gap audit is complete and the Features 1–10 Gap Closure is implemented and under review;
3. build main-product features 11–18: retrieval, source health, posting-history/ghost-job intelligence, browser-assisted retrieval (feature 14A, complete), the browser extension companion (feature 14B, implemented, awaiting review and local acceptance), source intelligence, job-market analytics, personal job-search analytics, and company intelligence;
4. only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge;
5. add the later add-ons (features 19–23) afterward.

*(Earlier order, superseded on October 15, 2026: finish the evaluator, complete the remaining main-product work, integrate into a usable product, then add retrieval, then expand discovery and analytics.)*

The retrieval layer must feed the existing evaluator rather than redesign it. The browser extension (Feature 14B) is a companion client to the same backend, data, evaluator and dashboard, not a separate product.

## Local Development

This is the authoritative setup and operations guide. Commands are run from the repository root.

### 1. Prerequisites

- Node.js >= 20.9 and pnpm 11.16.0 (`corepack enable` picks the pinned version)
- PostgreSQL (16 is what tests run against)
- An OpenAI API key only if you want real (paid) AI evaluations

### 2. First-time setup

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL (and OPENAI_API_KEY for real evaluations)
createdb ai_career_assistant  # or create the database another way
pnpm app:setup                # = pnpm prisma:generate && pnpm db:migrate
pnpm profile:import:customer-success --activate   # or use "Create from the starting profile" on /profile
pnpm app:doctor               # read-only check of everything above
```

`pnpm prisma:generate` is required after every clean clone: the generated client (`database/generated/`) is not committed. `pnpm app:setup` runs it and applies all migrations (`prisma migrate deploy`).

`pnpm app:doctor` is strictly read-only. It checks Node, configuration (by variable name; values are never printed), database reachability, applied migrations, the generated client, the active profile, whether an evaluation worker is connected, the queue, and whether company names still need the deduplication backfill. It never changes data.

**Existing databases (once, after migrating to the deduplication release):** `pnpm db:backfill-dedup --dry-run` reports what would change; `pnpm db:backfill-dedup` then fills `Company.normalizedName` where it is empty and records duplicate relationships among existing opportunities. It is additive and idempotent: it never renames, merges, deletes or re-links a company or an opportunity, and never changes an existing relationship. It changes data, so `pnpm app:setup` does not run it; run it deliberately against the database you intend (it prints the target host and database name first). (The script is named `app:doctor`/`app:setup` because `pnpm doctor` and `pnpm setup` are built-in pnpm commands.)

### 3. Environment variables

| Group | Variables |
|---|---|
| Required to start | `DATABASE_URL` |
| Required for real AI evaluation | `OPENAI_API_KEY`, `AI_MODEL`, `AI_MAX_OUTPUT_TOKENS`, `AI_RETRY_LIMIT`, `AI_CALL_BUDGET`, `AI_REQUEST_TIMEOUT_MS`, `EVALUATION_JOB_MAX_ATTEMPTS` |
| Required by the worker | the row above plus `EVALUATION_JOB_LEASE_SECONDS`, `EVALUATION_WORKER_POLL_MS` |
| Optional (accepted defaults) | `AI_DEFAULT_REASONING_EFFORT`, `AI_OPERATION_EXECUTION_OVERRIDES_JSON`, `AI_PRICING_*`, `AI_*_COST_PER_MILLION_TOKENS`, `AI_LONG_CONTEXT_*`, `AI_PRICING_EFFECTIVE_FROM` |
| Leave unset | `AI_EXECUTION_POLICY_VERSION`: the policy version is built into the evaluator and changes with it. An override goes stale, mislabels evaluations and weakens the worker's queued-policy check; `pnpm app:doctor` warns about one. |
| Retrieval (optional) | `RETRIEVAL_WORKER_POLL_MS` (default 60000), `RETRIEVAL_USER_AGENT` (default: an identifying product string), `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` (Adzuna also stays disabled until it is verified), `RETRIEVAL_BROWSER_EXECUTABLE` (a Chromium or Chrome binary for browser-assisted sources, LinkedIn; without it they cannot be enabled) |
| Test-only (optional) | `TEST_DATABASE_URL`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` |

Without an OpenAI key (empty, or the old `YOUR_OPENAI_API_KEY` placeholder) the product still runs: capture, dashboard, profile, budget, applications and existing results all work. Requesting an evaluation returns "AI evaluation is not configured" (nothing is queued), and the worker refuses to start with a clear message. Changing AI settings requires restarting the web app and worker.

### 4. Normal startup

```bash
pnpm dev                  # terminal 1: web app on http://127.0.0.1:3000
pnpm worker:evaluations   # terminal 2: exactly one evaluation worker
pnpm worker:retrieval     # terminal 3 (optional): exactly one retrieval worker, for sources enabled on /sources
```

Health check: `GET /api/health` returns `{"status":"ok","service":"ai-career-platform","database":"ok","aiConfigured":true}` (HTTP 503 with `"database":"unavailable"` when the database is down). Production-style: `pnpm build && pnpm start`.

### 5. The evaluation worker and queue

- **One worker.** The worker takes a database lock when it starts; a second worker exits with "another evaluation worker is already running". `pnpm worker:evaluations:once` processes at most one task and exits.
  - The lock lives on the worker's own database connection and is not a heartbeat. If that connection drops while a task is running, the worker keeps running the task, and a second worker started meanwhile can take the lock. That second worker's recovery fails any task whose lease expired on its final attempt (`EVALUATION_LEASE_EXPIRED`), even if the first worker is still running it. Leases are not renewed, and claims are not owned by a worker, so this cannot be detected. Run exactly one worker, and stop the old one before starting another.
- **States shown on an opportunity:**
  - *Queued* — waiting for the worker. After a minute: "If the evaluation worker isn't running, start it".
  - *Running*.
  - *Running past its lease* (`RUNNING_STALE`) — the run has exceeded its worker lease (300 s by default; leases are not renewed, and a full evaluation can legitimately take longer). The run may still be in progress, or the worker may have stopped; this is **not** proof the worker stopped.
  - *Deferred — waiting for budget* or *Deferred — waiting for usage limits* — never queued. The first means the monthly AI budget has no room; the second means a daily or weekly evaluation limit, or the monthly output-token limit, is reached. Resume it from the page or `/budget`.
  - *Failed* — with a safe message and failure code; the last completed result stays visible.
- **Recovery.** If a worker dies mid-run, the task is retried automatically when attempts remain. If it died on the final attempt, the next worker start (or its idle loop) marks it failed (`EVALUATION_LEASE_EXPIRED`), which releases its budget hold and allows reevaluation. Recovery only runs in the worker that holds the lock, and only while it is not running a task, so it never fails a live run while that lock connection stays up (see the caveat under **One worker**).
- **Errors.** Temporary infrastructure problems (database unreachable or restarting, dropped connections, timeouts) are logged without details and retried with backoff (capped at 30 s). Configuration problems and unexpected errors stop the worker with a non-zero exit code instead of looping. Evaluation failures are recorded on the evaluation and the worker continues.
- **Shutdown.** Ctrl-C stops after the current task; a second Ctrl-C exits immediately (the task is then recovered as above).

### 5a. Sources and the retrieval worker (features 11A, 11B, 12, 13 and 14)

- **Sources.** Add a source on `/sources`: the source type, its board, site or company identifier (Lever and Ashby also need the company name, which their APIs do not return; Workday needs the employer's career-site address, for example `https://acme.wd5.myworkdayjobs.com/External`, and takes an optional company name used only when a posting names none), an optional name, and a schedule (12 hours by default). Workable and Wellfound need no settings: they search for Customer Success roles themselves. Every source starts disabled, and nothing is retrieved until you enable it. A newly enabled source runs at the worker's next check, then on its schedule. Run now queues a run for an enabled source. Removing a source that has run archives it (its listings keep their provenance); a source that never ran is deleted.
- **One worker.** `pnpm worker:retrieval` takes its own database lock; a second one exits. `pnpm worker:retrieval:once` processes the queued and due runs once and exits. It contacts only enabled sources: one request at a time per host, at least 1 s apart (12 s for Wellfound, 5 s between LinkedIn pages). It stops a host for the rest of the run on HTTP 429 (rate limited), 401/403 (access refused) or any 5xx (server error), never retries within a run, and refuses responses over 10 MB. It never starts an evaluation.
- **Source health and backoff (feature 12).** After a source failure the next run waits longer: after a rate limit, the schedule doubled per consecutive failure; after a server or network error, the normal schedule the first time and then doubling; after an access refusal or a changed response format, at least a day, then doubling. Every wait is capped at 7 days, except that a source's own Retry-After (on a 429 or 503) is honoured in full however long it is. Failures on our side (an interrupted worker, an internal error) never count, and no source is disabled automatically. Each source card shows its health (Healthy, Degraded, Failing, Needs attention, Rate limited, Waiting), the last attempt, the last successful retrieval, the next run and why, and the latest failure; it notes a stale source (no successful retrieval for two schedule intervals) and a successful run that found no listings. A run stopped part-way by the source never counts as a successful retrieval.
- **Run now and waits.** Run now is disabled while a source is rate limited ("Rate limited until …") or waiting as the source asked ("Retry after … (requested by the source)"); neither can be overridden. During our own backoff, Run now asks first and "Run now anyway" sends one run. Changing a source's settings (through `PATCH /api/sources/<id>`) clears our own backoff but never a source's wait; enabling or disabling a source keeps any wait.
- **Posting history (feature 13).** Each run also records which listings the source listed, before the role-title filter, so a stored listing whose title changes is still seen. A listing missing from one complete check shows "Not found in the latest complete check"; missing from two consecutive complete checks at least 24 hours apart it is "No longer listed", and a listing that returns is "Listed again". Only Greenhouse, Lever and Ashby (one response with the whole board), and Workday and SmartRecruiters when a run reads exactly the total they state (at most 100 and 500 postings), can confirm removal; Wellfound, Himalayas, Remote OK, Working Nomads, Workable and We Work Remotely show a limited window and only record sightings. An expiry date a source states is shown, never treated as removal. Changing what a source retrieves (its board, site, company identifier or career site) starts fresh tracking, and changing it back does not bring back the old history; changing only a display name does not. Listings retrieved before feature 13 show "Last observed …; current status unknown" until they are seen again. The opportunity page has a "Posting history" section, dashboard rows show "No longer listed" when every source that can confirm it has, and evaluating such a listing shows a warning but is allowed. Nothing closes or archives an opportunity automatically, and the posting-history facts are not passed to the evaluator yet.
- **LinkedIn, browser-assisted (feature 14).** LinkedIn has no public API, so its public, logged-out job search and job pages are read in headless Chromium (set `RETRIEVAL_BROWSER_EXECUTABLE`). Each run starts a fresh browser with no account, cookies, profile or stored state and closes it afterwards; it only opens and reads pages (no sign-in, applying, saving, following, messaging or clicking), one at a time and at least 5 s apart, and skips images, fonts and media. A run reads up to `maxSearchPages` search pages (default 4, at most 8) and keeps up to `maxDiscovered` results (default 100, at most 200), filters the titles, then opens at most `maxDetailsPerRun` job pages (default 20, at most 25). Matches whose page is not read yet are remembered and read first in later runs, oldest first, even after they leave the search; stored jobs are re-read only after a week. Any HTTP 403, 429 or 999, sign-in wall, authwall, checkpoint, CAPTCHA, challenge or account cookie ends the run immediately with no further request, and Feature 12's backoff applies (at least a day after an access refusal). LinkedIn never confirms removal. The adapter is not yet verified against live pages: from the Claude cloud environment its single check met HTTP 429 and LinkedIn's anti-bot page (a stop), while a separate local logged-out browser check loaded normal public results under a "Sign in to view more jobs" modal, which the adapter does not treat as a block while results are present. The source cannot be enabled until `pnpm sources:verify linkedin --config '{"maxSearchPages":1,"maxDetailsPerRun":1}' --raw-dir <dir>` succeeds and the adapter is marked verified.
- **We Work Remotely (feature 14).** Reads the official all-jobs RSS feed (`https://weworkremotely.com/remote-jobs.rss`) and keeps Customer Success titles locally; a category saved earlier is ignored. It never reads WWR's web pages.
- **What a run does.** Only listings whose title contains a Customer Success role-family term are kept.
  - A new listing is normalized and deduplicated like a manual capture.
  - A listing seen again unchanged only updates its last-seen time.
  - A changed listing is stored as a new, linked version. When it is the listing the opportunity was found from, its newest version becomes the opportunity's current facts and description (October 23, 2026 correction, awaiting review). Earlier versions and their provenance are kept, attached copies from other sites and manual entries are never re-projected, and nothing is evaluated automatically.
  - Run history on `/sources` shows each run's counts and, if it failed, a safe reason.
  - **Coverage per run:** SmartRecruiters reads up to the newest 500 postings, Workday the first 100 postings its listing endpoint returns (5 pages of 20; Workday does not state the order), Workable a bounded window of its search results (up to 5 pages, relevance order) and Wellfound up to 11 pages of its role page. Sources whose lists lack full descriptions (SmartRecruiters, Workday) fetch at most 25 details per run, new listings first.
- **Verifying a source contract.** `pnpm sources:verify <adapter> --config '<json>' --raw-dir <directory outside the repository>` makes that adapter's single verification request and checks the mapping (for LinkedIn, one search page and its first job page in a fresh logged-out browser). `--offline <directory>` re-checks saved responses without the network. It touches no database. Only run it with approval for that source.

### 5b. The browser extension (Feature 14B)

- **Build and load.** Run `pnpm extension:build`, which writes `apps/extension/dist` (git-ignored). Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `apps/extension/dist`. After a rebuild, press the extension's reload button.
- **Pair.** In the app, open **Extension**, create a pairing and copy the credential (shown once; only its hash is stored). Paste it with the app's address (for example `http://localhost:3000`) into the extension's Options. Revoke a pairing there at any time; the next request from that browser gets 401.
- **Capture.** On a job page, click the toolbar icon, then **Read this page**, check (and if needed correct) the editable preview, then **Save to AI Job Assistant**. Nothing is sent before Save.
  - The extension reads that one page only after you click, and sends only the job's fields to the local app's `/api/extension/*` routes.
  - It reads structured job data first; on LinkedIn, only the job-detail areas of a job page; then your selected text; then, except on LinkedIn, the page's main content.
  - Unrecognised sites are kept as the lowest-priority source.
  - Core's shared normalization fills facts the page states only in its text. The extension also sends neutral context (not on LinkedIn): the tab's title and, beside structured data or a selection, the job's own page content without navigation, footers or other jobs. Only labelled details such as "Remote Type: Hybrid" are read from that content. Fields you corrected are recorded as user-corrected.
  - **Duplicates.** A capture is added to an opportunity you already have only when it shares that listing's identity: the same listing URL, or the same listing or requisition ID at the same company. A copy of the same job on another site, without that shared identity, may stay a separate opportunity. When there is enough evidence (the same company, with similar title, location and description) it is flagged as a possible duplicate. Similarity alone never merges anything.
  - A saved job is never evaluated automatically: **Request evaluation** uses the existing path, within your budget.
- **Permissions:** `activeTab`, `scripting` and `storage`, plus host access to `127.0.0.1` and `localhost` only. There are no content scripts and no access to other tabs, history or cookies; a minimal service worker only restricts the extension's storage to its own pages. Details, privacy and the acceptance runbook (on a dedicated acceptance database) are in `apps/extension/README.md`.
- **Doctor.** `pnpm app:doctor` now names the database it connected to (name and host only) and counts paired browsers.

### 6. Deterministic, no-paid-call workflow

Every automated test uses a deterministic fixture provider; no test can make a paid call. There is deliberately no "fake AI" mode for normal use, because fixture results would be stored as if real.

```bash
pnpm typecheck
pnpm -r --workspace-concurrency=1 --if-present lint
pnpm prisma:validate
pnpm db:verify-migrations   # applies all migrations to a temporary database and checks for drift
pnpm test                   # unit
pnpm test:integration       # needs PostgreSQL
pnpm build
pnpm test:e2e               # Playwright; starts its own dev server unless one is already on :3000
```

Test-only startup notes:

- Integration and E2E tests use `DATABASE_URL` unless `TEST_DATABASE_URL` is set. They clean up what they create and restore the budget and active profile, but a separate database is recommended.
- Stop any `pnpm dev` you started yourself before `pnpm test:e2e`, or Playwright reuses it with your environment. Do **not** run a real worker during E2E (the tests run their own deterministic worker).
- E2E always uses a deterministic, non-live `OPENAI_API_KEY`, even when `.env` holds a real key: `playwright.config.ts` replaces it for the test runner, its helpers and the web server. Other AI settings in `.env` still apply. No E2E path calls a provider.
- If Playwright's bundled Chromium is unavailable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a local Chrome/Chromium.
- E2E projects run in order: `chromium` → `profile-management` → `budget` → `dashboard` → `acceptance` (later projects change global profile/budget state).

### 7. Real-evaluation workflow

Set `OPENAI_API_KEY` (and keep the accepted AI and pricing defaults), start the web app and one worker, capture an opportunity, and select **Evaluate**. Each evaluation makes paid provider calls; usage and estimated cost appear on the opportunity and in the dashboard totals. Set a monthly budget on `/budget` to defer evaluations that would not fit, and optional daily or weekly evaluation limits or a monthly output-token limit to defer evaluations beyond them.

### 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "AI evaluation is not configured" | `OPENAI_API_KEY` is empty, the placeholder, or an AI setting is invalid. Run `pnpm app:doctor`, fix `.env`, restart. |
| Failure code `PROVIDER_HTTP_401`/`403` | The key was rejected. Check the key; requeue with **Reevaluate**. |
| Stuck "queued" | No worker is running. Start `pnpm worker:evaluations`. |
| "Running past its lease" | A long run, or a worker that stopped. If no worker is running (`pnpm app:doctor` shows "not running"), start one; it recovers the evaluation. |
| Worker exits: "another evaluation worker is already running" | Only one worker may run. Stop the other one. |
| Worker exits with a configuration error | Fix the named variables (see `pnpm app:doctor`). |
| "An evaluation is already queued or running" but none shows | A request crashed between admission and queueing; it is released automatically after 10 minutes. |
| "Deferred — waiting for usage limits" | A daily or weekly evaluation limit, or the monthly output-token limit, set on `/budget` is reached. Raise the limit or wait for its window to reset, then resume the request from the page or `/budget`. `pnpm app:doctor` shows how many deferrals wait for the budget and how many for usage limits. |
| `/api/health` returns 503 | The database is unreachable. Start PostgreSQL / check `DATABASE_URL`. |
| `prisma migrate dev` reports a `Recommendation.evidenceReferences` change | Known, documented drift (awaiting a decision); use `pnpm db:migrate` (deploy). `pnpm db:verify-migrations` confirms it is the only difference. |
| `Cannot find module …/generated/prisma` | Run `pnpm prisma:generate`. |
| `pnpm app:doctor` warns about the evaluation policy version | `.env` pins `AI_EXECUTION_POLICY_VERSION`. Remove the line and restart the web app and worker. Evaluations already queued under another policy fail safely with `SEMANTIC_EXECUTION_POLICY_MISMATCH`; request them again. |
| `pnpm app:doctor` warns about company names | Companies saved before the deduplication release have no normalized name, so the company filter lists them separately. Run `pnpm db:backfill-dedup --dry-run`, then `pnpm db:backfill-dedup`, against this database. |
| "This listing is a duplicate of an opportunity that already has an evaluation…" | The opportunity is an exact duplicate (same listing URL, or same job ID at the same company) of one that already has an evaluation or a pending request, so evaluating it would pay twice. Open the other opportunity, or choose **Not the same job** on this page if they are different jobs (reversible with **Undo**). |
| `pnpm app:doctor` warns that deferrals use another profile version | Each deferral resumes with the profile version it was requested with. On `/budget`, resume to keep that version, or cancel and request again to use the active one. |
| A source cannot be enabled on `/sources` | Its adapter is awaiting verification (Adzuna; LinkedIn, whose adapter check from a local runtime was rate-limited by LinkedIn on its first job page; Welcome to the Jungle / Otta, whose tested public pages show no usable job records) or needs environment variables that are not set (LinkedIn needs `RETRIEVAL_BROWSER_EXECUTABLE`); the card says which. |
| A LinkedIn run failed with "refused access" | LinkedIn answered 403 or 999, or showed a sign-in wall, authwall, checkpoint or challenge. The run stopped at once and the source waits at least a day (longer after repeated failures). Nothing logs in or works around it; if it persists, leave LinkedIn disabled. |
| A LinkedIn run failed with "internal error" right away | The browser could not start: check that `RETRIEVAL_BROWSER_EXECUTABLE` points to a Chromium or Chrome binary. |
| The browser-driver integration test cannot launch Chromium | Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chromium (as for E2E), or install Playwright's Chromium. |
| `pnpm app:doctor` warns that the retrieval worker is not running | A source is enabled but no worker runs it. Start `pnpm worker:retrieval`. |
| A retrieval run failed with "refused access" or "rate-limited" | The source answered 401/403 or 429; retrieval from it stopped for that run. Nothing is retried automatically within the run; check the source's settings (board name, career-site address) and wait for the next scheduled run. Some sources limit requests from particular networks (Workable answered one network with 429 while others worked), so a persistent rate limit can depend on where the worker runs. |
| A run failed with "server error" | The source answered with a 5xx; retrieval from it stopped for that run. The first time, the source runs again on its normal schedule; repeated failures wait longer (up to 7 days). |
| Run now is disabled with "Rate limited until …" or "Retry after … (requested by the source)" | The source asked retrieval to wait, and that wait is always honoured, however long; it cannot be overridden, and enabling, disabling or changing the source's settings does not clear it. The source runs again on its own after that date. |
| Run now asks "Run now anyway" | The source is backing off after failures (shown as Needs attention, Failing or Degraded). Fix its settings if they are wrong (that clears the backoff), or confirm to send one run now. |
| An opportunity shows "No longer listed" | Every source that can confirm it (a whole-board ATS: Greenhouse, Lever, Ashby, or Workday/SmartRecruiters read in full) has not listed it in two complete checks at least a day apart, and no other source saw it afterwards. The opportunity is kept; archive it yourself if you no longer need it. If it is listed again, the badge goes away. |
| A listing says "Last observed …; current status unknown" | It was retrieved before posting history existed, or its source shows only a limited window or has not run recently. It changes as soon as a run sees the listing again; absence alone never marks it removed. |
| `pnpm app:doctor` warns about retrieval source health | An enabled source is rate limited, waiting, failing, needs attention or is stale; its card on `/sources` shows the latest failure and when it will run again. The doctor only reports; it never changes a source. |

### 9. Updating the evaluator or the bundled profile

When a new evaluator version or a new bundled Customer Success profile arrives:

1. **Policy version:** keep `AI_EXECUTION_POLICY_VERSION` unset and run `pnpm app:doctor`. The "Evaluation policy version" line must show the evaluator's built-in version with PASS. Restart the web app and the worker together.
2. **Profile:** run `pnpm profile:import:customer-success --activate`. This appends a new version (old versions are never changed) and makes it active. `pnpm app:doctor` then shows the active version and whether it stores structured limitations.
3. **Deferred requests:** if `pnpm app:doctor` reports deferrals pinned to another profile version, review them on `/budget`. Resume keeps the pinned version. **Cancel request** followed by **Evaluate** on the opportunity uses the active one. Never edit them in the database.
4. **Existing evaluations** keep the profile version, policy and pricing they ran with; reevaluate an opportunity to apply the new evaluator and profile.

### 10. Ingestion boundary

Every source must converge on one pipeline: *source adapter → `RawOpportunity` (`packages/core/src/raw-opportunity.ts`) → normalizer for that source type → one capture transaction (preserved `SourceRecord` → duplicate decision → new `Opportunity` + `FieldProvenance`, or the `SourceRecord` attached to the existing opportunity) → evaluation*. A capture whose normalization fails still preserves its raw `SourceRecord`, unlinked. Manual entry and the feature 11A retrieval adapters (`packages/discovery`, normalized by `createRetrievedOpportunityNormalizer`) are the adapters today.

Deduplication (`packages/deduplication`, engine `core-dedup-v2`; records decided before October 18, 2026 keep their `core-dedup-v1` label):

- **MATCH** (same listing URL with nothing conflicting, or the same source job/requisition ID at the same company): the new `SourceRecord` is attached to the earliest-seen matching opportunity (`duplicateDecision`/`duplicateEvidence` on the record). The opportunity's fields, lifecycle, evaluations and application are unchanged; only its last-seen time moves. `POST /api/opportunities` then returns 200 with that opportunity (201 when one is created). The capture form asks first (read-only `POST /api/opportunities/duplicate-check`); "Save as a separate opportunity" keeps it apart and records the pair as `DISTINCT`, which can be undone.
- **PROBABLE_MATCH** (same company and similar title, location and description, or a shared URL/ID with a conflict): the opportunity is created and the pair is recorded as a warning; nothing is ever merged on a probable match.
- **Duplicate spend:** an opportunity that has never completed an evaluation cannot request one (or resume a deferred one) while an unresolved exact duplicate already has a completed or active evaluation, a live admission or an open deferred request. The check and the admission it allows are serialized by an advisory lock on a dedicated connection.
- Companies are reused by normalized name (case, punctuation, `&` and one recognized legal suffix such as Inc, LLC or GmbH are ignored); stored names are never rewritten, and what the user typed stays in the raw source and field provenance.
- **Source-scoped listing IDs (`core-dedup-v2`):** a retrieved listing ID is compared as `<source>::<id>`, so a Greenhouse 123 never matches a Lever 123. Manually entered IDs keep their plain form; requisition IDs and URLs still match across sources. Differing listing IDs count as a conflict only when both come from the same source.
- **Retrieved listings:**
  - **Re-observation:** a listing already stored from the same source with the same ID is a re-observation. If its content hash (over material fields only) is unchanged, only the last-seen times move. If it changed, a new `SourceRecord` is linked through `previousSourceRecordId`.
  - For the originating listing (the opportunity's first source record's source and ID), the new version is re-normalized and re-projected. Replaced field provenance is marked `supersededAt`, never deleted, and a field with `userCorrected:*` provenance is kept.
  - Evaluations record the version they evaluated in `Evaluation.sourceRecordId`.
  - **Application link:** on an attach, the opportunity's application link moves to a strictly higher-precedence source (employer ATS/careers, then job board/marketplace, then aggregator) with field provenance; a manually entered link is never replaced.

Known points for later features:

- the manual submission schema, `submit()` and `POST /api/opportunities` stay manual-specific; retrieval enters through `createRetrievalIngestionService` and the worker;
- merging opportunities that already have history is not done (by decision); posting history (feature 13) is recorded per listing in `RetrievedListing`, and its facts are not yet passed to the evaluator;
- the evaluator reads an opportunity's oldest `SourceRecord` (attached duplicates and changed observations come after it), and retrieved source items live under `rawPayload.source`, never as posting history;
- the browser-extension companion (`apps/extension`, Feature 14B) enters through `POST /api/extension/captures`, which maps a capture to a retrieved listing with `BROWSER_EXTENSION` provenance and uses `createRetrievalIngestionService`; it never evaluates, and its evaluation wrappers call the existing evaluation handlers.

## Project Status

**Active development**

The Customer Success evaluator routing is locked. The Task 7 normalized salary/currency/residency facts are complete on the main-product branch; the matching Customer Success Milestone 4 salary-policy alignment, with its October 25 compensation-basis correction, is on the Codex evaluator branch and is combined at final integration. The Task 8 Application Tracker completion pass (`534a4c7`) and the Task 9 operations-hardening completion pass (October 16, 2026) are complete. The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete. The features 1–10 gap audit and the Features 1–10 Gap Closure (`d573acf`) are complete. Features 11A and 11B (automated retrieval, `fad2341` and `2a1d8c2`) and Feature 12 (source health and conservative retrieval, `f10a02b`) are complete, Feature 13 (posting history and listing removal, `d1bf217`) and Feature 14A (browser-assisted LinkedIn retrieval and source corrections, `dd77d29`) are complete, Feature 14B (the browser-extension companion) is next, and main-product features 15–18 follow it. Deliberate evaluator/product integration, full isolated verification, the evaluator freeze and the merge are deferred until the entire intended main product (features 1–18) is complete. Features 19–23 remain later add-ons.
