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

The authoritative setup and operations guide is the repository root `README.md` ("Local Development"): prerequisites, first-time setup (`pnpm app:setup`), the read-only `pnpm app:doctor` check, environment variables, starting the web app and exactly one worker, worker and queue states, the deterministic test workflow, and troubleshooting.

Corrections to earlier notes kept here:

- Playwright starts its own Next.js dev server **unless one is already running on port 3000** (`reuseExistingServer` outside CI); stop your own `pnpm dev` before E2E runs.
- Migrations are applied with `pnpm db:migrate` (`prisma migrate deploy`); `pnpm db:verify-migrations` checks a clean apply against a temporary database.
- No machine-specific paths are required (earlier notes referenced a personal WSL path).

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
