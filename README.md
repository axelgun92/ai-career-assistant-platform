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
- Task 7 normalized opportunity facts: salary minimum/maximum and currency, work arrangement, seniority, department, employment type, closing date, and residency requirement/regions, with provenance and Unknown preserved;
- application tracker (Task 8 completion pass complete): stages and outcomes with calendar-date rules, rescheduling follow-ups, interviews, contacts, notes, next-action and due visibility, and stale-write protection;
- setup and operations tooling (Task 9 completion pass complete): `pnpm app:setup`, `pnpm app:doctor`, migration verification, `/api/health`, the single-worker lock, honest queue states, error-name-only API logging, and whole-product acceptance tests with a deterministic, non-live E2E credential.

### In Progress

- No main-product implementation task is open. Task 8 and Task 9 are complete.
- Next: the separate post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update (new PRD/TDD versions, Semantic Evaluation Playbook v1.3).

### Main-product work still required before final acceptance

- after the versioned-document update: an audit of any remaining gaps in features 1–10;
- feature 11 — automated retrieval/scraping, with source normalization/ingestion and deduplication across sources;
- feature 12 — source health and conservative retrieval;
- feature 13 — posting-history/ghost-job intelligence;
- feature 14 — browser extension companion;
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

The evaluator branch (Codex) holds the locked routing, the October 10–13 evaluator semantic-contract repairs and the Milestone 4 salary-policy alignment; they reach the product at the final integration checkpoint (see `HANDOFFS.md`, final integration checklist and the October 15 annotations).

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
- **Browser extension:** TypeScript + Chrome Manifest V3
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
2. the Task 1–9 product completion pass is complete (Task 8 and Task 9 complete); next comes the separate post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update, then an audit of any remaining gaps in features 1–10;
3. build main-product features 11–18: retrieval, source health, posting-history/ghost-job intelligence, the browser extension companion, source intelligence, job-market analytics, personal job-search analytics, and company intelligence;
4. only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge;
5. add the later add-ons (features 19–23) afterward.

*(Earlier order, superseded on October 15, 2026: finish the evaluator, complete the remaining main-product work, integrate into a usable product, then add retrieval, then expand discovery and analytics.)*

The retrieval layer must feed the existing evaluator rather than redesign it. The browser extension is a companion client to the same backend, data, evaluator and dashboard, not a separate product.

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

`pnpm app:doctor` is strictly read-only. It checks Node, configuration (by variable name; values are never printed), database reachability, applied migrations, the generated client, the active profile, whether an evaluation worker is connected, and the queue. It never changes data. (The script is named `app:doctor`/`app:setup` because `pnpm doctor` and `pnpm setup` are built-in pnpm commands.)

### 3. Environment variables

| Group | Variables |
|---|---|
| Required to start | `DATABASE_URL` |
| Required for real AI evaluation | `OPENAI_API_KEY`, `AI_MODEL`, `AI_MAX_OUTPUT_TOKENS`, `AI_RETRY_LIMIT`, `AI_CALL_BUDGET`, `AI_REQUEST_TIMEOUT_MS`, `EVALUATION_JOB_MAX_ATTEMPTS` |
| Required by the worker | the row above plus `EVALUATION_JOB_LEASE_SECONDS`, `EVALUATION_WORKER_POLL_MS` |
| Optional (accepted defaults) | `AI_DEFAULT_REASONING_EFFORT`, `AI_OPERATION_EXECUTION_OVERRIDES_JSON`, `AI_PRICING_*`, `AI_*_COST_PER_MILLION_TOKENS`, `AI_LONG_CONTEXT_*`, `AI_PRICING_EFFECTIVE_FROM` |
| Leave unset | `AI_EXECUTION_POLICY_VERSION`: the policy version is built into the evaluator and changes with it. An override goes stale, mislabels evaluations and weakens the worker's queued-policy check; `pnpm app:doctor` warns about one. |
| Test-only (optional) | `TEST_DATABASE_URL`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` |

Without an OpenAI key (empty, or the old `YOUR_OPENAI_API_KEY` placeholder) the product still runs: capture, dashboard, profile, budget, applications and existing results all work. Requesting an evaluation returns "AI evaluation is not configured" (nothing is queued), and the worker refuses to start with a clear message. Changing AI settings requires restarting the web app and worker.

### 4. Normal startup

```bash
pnpm dev                  # terminal 1: web app on http://127.0.0.1:3000
pnpm worker:evaluations   # terminal 2: exactly one evaluation worker
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
| `pnpm app:doctor` warns that deferrals use another profile version | Each deferral resumes with the profile version it was requested with. On `/budget`, resume to keep that version, or cancel and request again to use the active one. |

### 9. Updating the evaluator or the bundled profile

When a new evaluator version or a new bundled Customer Success profile arrives:

1. **Policy version:** keep `AI_EXECUTION_POLICY_VERSION` unset and run `pnpm app:doctor`. The "Evaluation policy version" line must show the evaluator's built-in version with PASS. Restart the web app and the worker together.
2. **Profile:** run `pnpm profile:import:customer-success --activate`. This appends a new version (old versions are never changed) and makes it active. `pnpm app:doctor` then shows the active version and whether it stores structured limitations.
3. **Deferred requests:** if `pnpm app:doctor` reports deferrals pinned to another profile version, review them on `/budget`. Resume keeps the pinned version. **Cancel request** followed by **Evaluate** on the opportunity uses the active one. Never edit them in the database.
4. **Existing evaluations** keep the profile version, policy and pricing they ran with; reevaluate an opportunity to apply the new evaluator and profile.

### 10. Ingestion boundary (before scraper work)

Every source must converge on one pipeline: *source adapter → `RawOpportunity` (`packages/core/src/raw-opportunity.ts`) → preserved `SourceRecord` → normalizer for that source type → `Opportunity` + `FieldProvenance` → evaluation*. Manual entry is the only adapter today. Known manual-only points to generalize in the scraper phase:

- the submission schema, `submit()` and `POST /api/opportunities` are manual-specific, and the normalizer accepts only `sourceType` `MANUAL`;
- a `Company` row is created per opportunity (no matching), `SourceRecord (source, externalId)` is not unique, and there is no re-observation path for `lastSeenAt`/`lastObservedAt`;
- the evaluator reads an opportunity's oldest `SourceRecord`;
- `DuplicateReference`, `packages/discovery` and `packages/deduplication` exist but are unused; `apps/extension` is a placeholder for the browser extension, which must feed the same backend.

## Project Status

**Active development**

The Customer Success evaluator routing is locked. The Task 7 normalized salary/currency/residency facts are complete on the main-product branch; the matching Customer Success Milestone 4 salary-policy alignment is on the Codex evaluator branch and is combined at final integration. The Task 8 Application Tracker completion pass (`534a4c7`) and the Task 9 operations-hardening completion pass (October 16, 2026) are complete. Next is the separate post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update, then an audit of any remaining gaps in features 1–10, then main-product features 11–18. Deliberate evaluator/product integration, full isolated verification, the evaluator freeze and the merge are deferred until the entire intended main product (features 1–18) is complete. Features 19–23 remain later add-ons.
