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
| JD Reconstruction | GPT-5.6 Terra |
| Job Evaluation | GPT-5.6 Luna |
| Company Alignment | GPT-5.6 Luna |
| Organizational Maturity | GPT-5.6 Luna |
| Alex Fit | GPT-5.6 Luna |
| Burnout Risk | GPT-5.6 Luna |
| Resume Match | GPT-5.6 Terra |
| Opportunity Priority | GPT-5.6 Luna |
| Ghost Job Risk | Deterministic Unknown when posting-history evidence is insufficient |
| Final Recommendation | Deterministic application logic |

Model routing is treated as an execution detail. It does not change the meaning of the domain schemas, stage outputs, evidence rules, Unknown handling, contradictions, or recommendation behavior.

## Current Development Status

### Implemented

- shared Core evaluation framework;
- manual opportunity ingestion;
- PostgreSQL persistence;
- background evaluation processing;
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
- safe rendering of untrusted job-description content.

### In Progress

- final evaluator cost optimization;
- JD Reconstruction optimization;
- Resume Match optimization;
- combined-path evaluator verification;
- final mixed-model evaluation;
- remaining application workflow and integration work outside the evaluator.

### Planned

- automated job retrieval / scraping;
- source normalization and ingestion;
- deduplication across sources;
- broader source integrations;
- stronger posting-history support for Ghost Job Risk;
- source analytics;
- company watchlists;
- additional domain assistants.

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

Additional repository documentation will cover:

- Milestones 1–10;
- current product status;
- evaluator status;
- development plan;
- active workstreams;
- current progress;
- future agent handoffs.

## Development Priorities

The current development order is:

1. finish and verify the evaluator;
2. complete the remaining main-product work;
3. integrate both into a stable, usable product;
4. then add automated job retrieval and source ingestion;
5. expand discovery, analytics, and additional domain capabilities afterward.

The retrieval layer should feed the existing evaluator rather than redesign it.

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
| Optional (accepted defaults) | `AI_DEFAULT_REASONING_EFFORT`, `AI_EXECUTION_POLICY_VERSION`, `AI_OPERATION_EXECUTION_OVERRIDES_JSON`, `AI_PRICING_*`, `AI_*_COST_PER_MILLION_TOKENS`, `AI_LONG_CONTEXT_*`, `AI_PRICING_EFFECTIVE_FROM` |
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
- **States shown on an opportunity:**
  - *Queued* — waiting for the worker. After a minute: "If the evaluation worker isn't running, start it".
  - *Running*.
  - *Running past its lease* (`RUNNING_STALE`) — the run has exceeded its worker lease (300 s by default; leases are not renewed, and a full evaluation can legitimately take longer). The run may still be in progress, or the worker may have stopped; this is **not** proof the worker stopped.
  - *Deferred — waiting for budget* — never queued; resume it from the page or `/budget`.
  - *Failed* — with a safe message and failure code; the last completed result stays visible.
- **Recovery.** If a worker dies mid-run, the task is retried automatically when attempts remain. If it died on the final attempt, the next worker start (or its idle loop) marks it failed (`EVALUATION_LEASE_EXPIRED`), which releases its budget hold and allows reevaluation. Recovery only runs in the worker that holds the lock, and only while it is not running a task, so it never fails a live run.
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
- If Playwright's bundled Chromium is unavailable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a local Chrome/Chromium.
- E2E projects run in order: `chromium` → `profile-management` → `budget` → `dashboard` → `acceptance` (later projects change global profile/budget state).

### 7. Real-evaluation workflow

Set `OPENAI_API_KEY` (and keep the accepted AI and pricing defaults), start the web app and one worker, capture an opportunity, and select **Evaluate**. Each evaluation makes paid provider calls; usage and estimated cost appear on the opportunity and in the dashboard totals. Set a monthly budget on `/budget` to defer evaluations that would not fit.

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
| `/api/health` returns 503 | The database is unreachable. Start PostgreSQL / check `DATABASE_URL`. |
| `prisma migrate dev` reports a `Recommendation.evidenceReferences` change | Known, documented drift (awaiting a decision); use `pnpm db:migrate` (deploy). `pnpm db:verify-migrations` confirms it is the only difference. |
| `Cannot find module …/generated/prisma` | Run `pnpm prisma:generate`. |

### 9. Ingestion boundary (before scraper work)

Every source must converge on one pipeline: *source adapter → `RawOpportunity` (`packages/core/src/raw-opportunity.ts`) → preserved `SourceRecord` → normalizer for that source type → `Opportunity` + `FieldProvenance` → evaluation*. Manual entry is the only adapter today. Known manual-only points to generalize in the scraper phase:

- the submission schema, `submit()` and `POST /api/opportunities` are manual-specific, and the normalizer accepts only `sourceType` `MANUAL`;
- a `Company` row is created per opportunity (no matching), `SourceRecord (source, externalId)` is not unique, and there is no re-observation path for `lastSeenAt`/`lastObservedAt`;
- the evaluator reads an opportunity's oldest `SourceRecord`;
- `DuplicateReference`, `packages/discovery` and `packages/deduplication` exist but are unused; `apps/extension` is a placeholder for the browser extension, which must feed the same backend.

## Project Status

**Active development**

The Customer Success evaluator is close to completion, and the current focus is finishing evaluator optimization while completing the remaining product workflow in parallel.
