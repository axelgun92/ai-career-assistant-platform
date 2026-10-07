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
- **Testing:** Vitest / Jest + Playwright
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

### Prerequisites

- Git
- Node.js `>=20.9.0`
- pnpm `11.16.0`
- PostgreSQL
- An OpenAI API key for real semantic evaluations
- Playwright Chromium for E2E tests

> The installation method for Node, pnpm, and PostgreSQL was not established in this project history. Do not add unverified platform-specific installation commands.

### Install dependencies

From the repository root:

```bash
pnpm install
```

The WSL path used during development was:

```bash
cd "/mnt/c/Users/khaleesi-zandra/Documents/ChatGPT/AI Career Assistant"
```

Replace that path with the location of your clone.

### Environment configuration

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

At minimum, configure:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/ai_career_assistant?schema=public
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

Keep the remaining AI, pricing, retry, call-budget, timeout, and worker settings from `.env.example`.

Important:

- `.env` and `.env.*` are ignored by Git.
- `.env.example` is the non-secret template.
- Never commit an actual API key or database password.
- The OpenAI key is required for real worker-driven evaluations.
- Normal unit tests use fake providers and do not require live API calls.

### PostgreSQL and Prisma

Create a local PostgreSQL database matching `DATABASE_URL`. The development configuration uses:

- Host: `localhost`
- Port: `5432`
- Database: `ai_career_assistant`
- Schema: `public`

The exact PostgreSQL database/user creation command was not established and should be documented separately for each operating system.

Apply all committed migrations:

```bash
pnpm exec prisma migrate deploy --config database/prisma.config.ts
```

Generate the Prisma client:

```bash
pnpm prisma:generate
```

Optional schema checks:

```bash
pnpm prisma:validate
pnpm prisma:format
```

### Import the Customer Success profile

The evaluator requires a valid versioned `UserProfile`. The current local import command imports the repository’s canonical Customer Success profile and its validated domain preferences:

```bash
pnpm profile:import:customer-success
```

The import is repeatable:

- The first import creates profile version 1.
- Importing identical content does not create a duplicate.
- A future changed profile creates a new version rather than overwriting history.
- Importing does not change which version new evaluations use. Pass `--activate` to make the imported version active:

```bash
pnpm profile:import:customer-success --activate
```

- New evaluations use, in order: an explicitly requested profile, the active version, or (only when no version was ever activated) the newest profile. Each evaluation stays linked to the exact version it used.

Profiles can also be viewed, edited (structured form or full JSON), versioned, and activated in the app at `/profile` ("Profile & preferences" on the dashboard). Every save creates a new version; existing versions are never changed.

### Start the application

Terminal 1 — web application:

```bash
pnpm dev
```

Equivalent explicit workspace command:

```bash
pnpm --filter @ai-career/web dev
```

Local URLs:

- Application: `http://localhost:3000`
- E2E base URL: `http://127.0.0.1:3000`
- Health check: `http://127.0.0.1:3000/api/health`

Expected health response:

```json
{"status":"ok","service":"ai-career-platform"}
```

Terminal 2 — continuous evaluation worker:

```bash
pnpm worker:evaluations
```

To poll/process only once and exit:

```bash
pnpm worker:evaluations:once
```

The web app and continuous worker are separate long-running processes, so use separate terminals. PostgreSQL must also be running. The worker is required to process evaluation tasks queued by the application.

### Tests and verification

Unit tests:

```bash
pnpm test
```

Watch mode:

```bash
pnpm test:watch
```

Database-backed integration tests:

```bash
pnpm test:integration
```

> Integration tests write temporary records to the configured database and clean up their fixtures. Use an isolated test database rather than valuable development or production data. No automatic `TEST_DATABASE_URL` workflow was established.

Type checking:

```bash
pnpm typecheck
```

Linting:

```bash
pnpm lint
```

Production build:

```bash
pnpm build
```

Install Playwright Chromium once:

```bash
pnpm exec playwright install chromium
```

Run E2E tests:

```bash
pnpm test:e2e
```

List E2E tests without running them:

```bash
pnpm test:e2e:list
```

Playwright now starts and stops the Next.js server automatically. A manually started development server is not required.

### Windows and WSL notes

- Development was performed through Ubuntu/WSL against a Windows-mounted repository.
- WSL is not established as a repository requirement.
- The worker was corrected to use an async `main()` rather than top-level `await`, allowing it to load under the project’s Node.js 24, Windows, pnpm, and `tsx` configuration.
- A machine-specific Node.js 24/`tsx` error was occasionally encountered with temporary one-off test harnesses:

```text
uv_os_get_passwd returned ENOMEM
```

This was handled with a temporary preload workaround. It has not been established as a requirement for the normal web or worker commands and should not be presented as standard setup.

- Playwright previously timed out while launching its web server. The current configuration fixes this by launching Next.js directly from `apps/web` on `127.0.0.1`. Do not reintroduce the old `pnpm dev` Playwright child-process configuration without retesting it.
- Run shell commands on separate lines. Combining commands accidentally produced invalid commands such as `HEADgit` and `statusgit`.

## Repository Structure

```text
apps/
  web/                 Next.js application and server-side worker/API code
  extension/           Browser-extension placeholder

database/
  prisma/              Prisma schema and migrations
  src/                 PostgreSQL repositories and database client

domains/
  customer-success/    Customer Success schemas, extraction and evaluation logic

packages/
  core/                Domain-neutral opportunity and platform contracts
  evaluation/          Evaluation runner, stages and semantic executor
  evidence/            Evidence contracts
  normalization/       Opportunity normalization
  shared/              Environment and shared server configuration
  discovery/           Domain-neutral discovery package
  deduplication/       Domain-neutral deduplication package

tests/
  unit/
  integration/
  e2e/
```

### Additional architecture notes

- This is a private pnpm monorepo.
- Core remains domain-neutral; Customer Success rules live under `domains/customer-success`.
- Manual opportunities are normalized and persisted in PostgreSQL.
- Evaluation tasks are stored in PostgreSQL and processed by the background worker.
- Semantic results use strict structured outputs, schema validation, evidence-reference validation, Unknown preservation, contradiction preservation, and bounded retry/call budgets.
- Provider calls and retries persist model, prompt version, token usage, pricing version, estimated cost, status, and duration.
- Production supports per-operation model routing with no automatic Luna-to-Terra fallback.
- Current mixed routing uses Terra for JD Reconstruction and Resume Match, and Luna for several bounded Customer Success interpretation stages.
- Ghost Job Risk remains deterministic `UNKNOWN` when objective posting-history evidence is unavailable.
- Final Apply/Review/Skip recommendation logic is deterministic.
- Unit tests and normal fake-provider integration flows do not require live OpenAI calls.
- Real evaluations can incur API charges and send the configured job description, company/opportunity data, profile-derived evidence, preferences, and intermediate stage results to OpenAI.


## Project Status

**Active development**

The Customer Success evaluator is close to completion, and the current focus is finishing evaluator optimization while completing the remaining product workflow in parallel.
