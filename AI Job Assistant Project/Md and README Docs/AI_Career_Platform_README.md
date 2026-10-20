# AI Career Platform

**Last updated:** October 18, 2026

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

### Implemented / established

- shared Core evaluation framework and PostgreSQL-backed product foundation;
- manual opportunity ingestion with raw-source preservation, deterministic normalization, and provenance;
- background evaluation processing and persisted evaluation history;
- ordered Customer Success evaluation stages with evidence tracking, Unknown and contradiction handling, and structured semantic outputs and validation;
- deterministic recommendation logic;
- semantic usage and estimated-cost accounting;
- per-operation model routing;
- Customer Success results interface with bounded evaluation polling and status handling and safe rendering of untrusted job-description content;
- opportunity dashboard, search/sort/filter, lifecycle actions, profile/version management, and AI usage/cost display;
- application tracker, complete after the Task 8 completion pass (`534a4c7`);
- setup and operations tooling, single-worker evaluation processing, honest queue states, and whole-product acceptance tests (original Task 9 work), complete after the Task 9 completion pass (October 16, 2026);
- deduplication with provenance retention for captured listings (an exact duplicate is added to the saved opportunity as another source; a possible duplicate is flagged and never merged), a serialized guard against paying twice for one listing, and normalized company names (Features 1–10 Gap Closure, `d573acf`);
- automated retrieval from the verified official API and feed sources (Greenhouse, Lever, Ashby, SmartRecruiters, Remote OK, We Work Remotely, Himalayas, Working Nomads): sources managed on `/sources` and disabled until enabled, title-only Customer Success role-family discovery, cross-source deduplication with employer-link preference, changed-listing observations, and no automatic evaluation (Feature 11A, `fad2341`);
- automated retrieval from the verified public/guest-endpoint and public-HTML sources (Workday career sites, the Workable job search, the Wellfound role page) through the same path; Welcome to the Jungle / Otta registered but not enabled (Feature 11B, `2a1d8c2`);
- source health and conservative retrieval: escalating backoff after source failures (capped at 7 days), a source's Retry-After honoured in full, any 5xx stopping a host for the run, no in-run retries or automatic disabling, derived health and freshness on `/sources`, Run now that cannot override a rate limit or requested wait, and read-only doctor warnings (Feature 12, `f10a02b`);
- posting history: listing coverage recorded before the title filter, removal confirmed only by complete boards (Greenhouse, Lever, Ashby; Workday and SmartRecruiters when their stated total is read exactly), a listing ledger per tracking-scope generation, reappearance, a "Posting history" section, a "No longer listed" dashboard badge, and evaluator-shaped facts withheld from the evaluator (Feature 13, `d1bf217`);
- persistent monthly AI budget ledger, atomic reservation/reconciliation, deferral/resume/cancel flow, warnings, and throughput/token limits;
- Task 7 normalized salary/currency/position/residency contract (main-product branch);
- Customer Success nine-stage evaluator plus deterministic Final Recommendation;
- Resume Match Optimization #2 and JD Reconstruction State2 accepted;
- final routing policy locked (GPT-6 Luna routes on `codex/evaluator-live-diagnostic`; not yet merged);
- Customer Success Milestone 4 aligned to the Task 7 salary/currency/residency facts at commit `267124f` on `codex/evaluator-live-diagnostic` (not yet merged);
- evaluator semantic-contract repairs of October 10–13 (`cs-jd-reconstruction-v7`, `cs-resume-match-v4`, `cs-organizational-maturity-v7`) on `codex/evaluator-live-diagnostic` (not yet merged; the main-product branch still runs `cs-jd-reconstruction-v3`, `cs-resume-match-v2` and `cs-organizational-maturity-v6`).

### In progress

- Feature 14B, the browser-extension companion, is next and not started (required main-product work; Feature 14 is not complete until it is accepted).
- Feature 14A is complete (`dd77d29`, accepted October 20, 2026; LinkedIn stays unverified and disabled): browser-assisted retrieval for public, logged-out LinkedIn job pages (a fresh logged-out Chromium context per run, navigation only, at least 5 seconds between pages, separate discovery and detail budgets, a pending queue of discovered matches in the existing ledger, a stop and Feature 12 backoff on any access friction; unverified and disabled: its local adapter check discovered 60 public jobs, then the first job page answered HTTP 429), We Work Remotely on its all-jobs RSS feed, and Wellfound at 12 seconds between requests; the other sources were audited and are unchanged. The browser-extension companion is Feature 14B, not part of 14A.
- Feature 13 is complete (`d1bf217`, October 19, 2026): pre-title-filter listing coverage, the removal-capable source matrix with exact stated totals, the `RetrievedListing` ledger with opaque tracking-scope generations and a HISTORICAL baseline, the removal and reappearance rules, posting-history facts withheld from the evaluator, and the opportunity-page and dashboard display.
- Feature 12 is complete (`f10a02b`, October 18, 2026): the `SERVER_ERROR` code and a host stop after any 5xx, Retry-After on the transport, one backoff gate per source (`RetrievalSource.nextEligibleAt`, with `RetrievalRun.retryAfterUntil`), derived source health, Run now's gate rules and doctor warnings. Listing expiry/removal detection moved to feature 13.
- Feature 11B is complete (`2a1d8c2`, October 18, 2026): the Workday, Workable and Wellfound adapters, a JSON POST transport method and source-specific request intervals and page caps; Welcome to the Jungle / Otta registered but unverified.
- Feature 11A is complete (`fad2341`, October 18, 2026): the collection framework, eight verified official API/feed adapters, the retrieval worker and `/sources`, title-only role-family discovery, cross-source deduplication (`core-dedup-v2`), canonical-link precedence and changed-listing observations.
- The Features 1–10 Gap Closure is complete (`d573acf`, October 17, 2026).
- The features 1–10 gap audit, Task 8, Task 9 and the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update are complete (Core AI Framework PRD v1.5, Customer Success PRD v1.4, Core Platform TDD v1.6, Customer Success TDD v1.4, Semantic Evaluation Playbook v1.3).

### Main-product work still required before final acceptance

- feature 14B — browser extension companion (next; not started; Feature 14 is not complete until it is accepted);
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
- **Browser-assisted retrieval:** Playwright (`playwright-core`) with headless Chromium, logged out, retrieval worker only (feature 14)
- **Browser extension:** TypeScript + Chrome Manifest V3 (Feature 14B; not yet built)
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
2. the Task 1–9 product completion pass is complete (Task 8 and Task 9 complete); the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete; the features 1–10 gap audit, the Features 1–10 Gap Closure, Feature 11A, Feature 11B, Feature 12, Feature 13 and Feature 14A are complete, and Feature 14B (the browser-extension companion) is next;
3. build main-product features 11–18: retrieval, source health, posting-history/ghost-job intelligence, browser-assisted retrieval (feature 14A, complete), the browser extension companion (feature 14B, next), source intelligence, job-market analytics, personal job-search analytics, and company intelligence;
4. only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge;
5. add the later add-ons (features 19–23) afterward.

*(Earlier order, superseded on October 15, 2026: finish the evaluator, complete the remaining main-product work, integrate into a usable product, then add retrieval, then expand discovery and analytics.)*

The retrieval layer must feed the existing evaluator rather than redesign it. The browser extension (Feature 14B) is a companion client to the same backend, data, evaluator and dashboard, not a separate product.

## Local Development

Setup, startup, worker operations, deterministic testing and troubleshooting are documented in the repository root `README.md` ("Local Development"), which is kept in sync with the code.

## Project Status

**Active development**

The Customer Success evaluator routing is locked. The Task 7 normalized salary/currency/residency facts are complete on the main-product branch; the matching Customer Success Milestone 4 salary-policy alignment is on the Codex evaluator branch and is combined at final integration. The Task 8 Application Tracker completion pass (`534a4c7`) and the Task 9 operations-hardening completion pass (October 16, 2026) are complete. The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete. The features 1–10 gap audit and the Features 1–10 Gap Closure are complete, Features 11A, 11B, 12, 13 and 14A are complete, and Feature 14B (the browser-extension companion) is next; Feature 14 is not complete until it is accepted. Main-product features 15–18 follow 14B. Deliberate evaluator/product integration, full isolated verification, the evaluator freeze and the merge are deferred until the entire intended main product (features 1–18) is complete. Features 19–23 remain later add-ons.
