# Product Status

**Project:** AI Career Platform / AI Job Assistant  
**Primary implemented domain:** Customer Success  
**Status:** Active development  
**Last updated:** October 15, 2026

## Purpose

This document provides a concise current-state view of the product. It does not replace the authoritative PRDs, TDDs, Semantic Evaluation Playbook, or detailed handoffs.

Use it to answer:

1. What is working now?
2. What is being completed now?
3. What remains before main-product acceptance?

## Current Working Product

The platform already supports a meaningful manual Customer Success workflow:

```text
Manual Opportunity
→ Raw source/provenance preservation
→ Deterministic normalization
→ Dashboard / search / filters
→ Budget admission and queued evaluation
→ Background Customer Success evaluation
→ Deterministic Apply / Review / Skip
→ Persisted results/evidence/history
→ Lifecycle and application workflow
```

Automated discovery is not yet complete, but the manual workflow remains the stable product foundation that later retrieval will feed. The current product can evaluate a manually entered job without automated retrieval.

**Branch note:** the main-product work described here is implemented on `claude/gallant-pasteur-y1ou3i`. The October 15 evaluator routing lock and the Milestone 4 salary-policy alignment are implemented on `codex/evaluator-live-diagnostic`. Neither branch is merged into `main` yet; they are combined at the deliberate final integration pass.

## Complete or Substantially Implemented

### Core platform and product workflow

- Repository and modular-monolith foundation.
- PostgreSQL persistence and Prisma schema/migrations.
- Manual opportunity capture with raw `SourceRecord` preservation and field provenance.
- Deterministic normalization.
- Shared evaluation framework with ordered stages.
- Evidence records.
- Explicit Unknown handling.
- Contradiction handling.
- Structured semantic-output validation.
- Background evaluation processing.
- Full opportunity dashboard with search, filtering, sorting, pagination, Unknown states, and persisted evaluator-derived fields.
- Evaluation history and persisted recommendation display; results retrieval through the application.
- Saved/dismissed/archived/applied lifecycle actions with guarded transitions and action history.
- User profile/preferences management and versioning, including optional limitations.
- Semantic-operation usage and estimated-cost accounting, with AI usage/cost display.
- Restart-safe per-evaluation semantic-call budgeting.
- Persistent monthly budget ledger, reservation/reconciliation, warning thresholds, throughput/token limits, budget deferral/resume/cancel, and backlog/capacity reporting.
- Application-tracking foundation, including application states, follow-ups, interviews, and `/applications`; Task 8 is now receiving a completion pass rather than being built from zero.
- Operational hardening and product-acceptance infrastructure exist from the original Task 9 work; Task 9 will receive its own completion pass after Task 8.

`CURRENT_PROGRESS.md` records each task in detail.

### Task 7 normalized opportunity facts

Task 7 is complete at `754f956dc0860149760936a61bdace0489404b9a`.

Normalized/persisted facts now include, when explicitly supported by source data:

- salary minimum/maximum;
- currency;
- original salary text;
- work arrangement;
- seniority;
- department;
- employment type;
- closing date;
- residency requirement;
- residency regions.

Unknown stays Unknown. Raw text and provenance remain preserved. Salary amounts are stored as stated and are not FX-converted in persistence.

### Customer Success evaluator

- Nine-stage Customer Success evaluation pipeline plus deterministic Final Recommendation.
- Hard Filters.
- JD Reconstruction.
- Job Evaluation.
- Company Alignment.
- Organizational Maturity.
- Alex Fit.
- Burnout Risk.
- Resume Match with Effective Seniority.
- Opportunity Priority.
- Ghost Job Risk fallback to deterministic `UNKNOWN` when posting-history evidence is unavailable.
- Apply / Review / Skip output.
- Evidence-backed explanations, Unknowns, contradictions, and versioned evaluation metadata.
- Preservation of Unknowns and contradictions.
- Resume Match Optimization #2 and JD Reconstruction State2 are the accepted optimization baselines.

### Results Experience

- Queued/running/completed/failed status handling.
- Bounded API polling.
- Polling cleanup when leaving the page.
- Persisted recommendation display.
- No recommendation recalculation in browser code.
- Expandable evaluation sections.
- Distinction between job-description evidence and profile evidence.
- Explicit display of Unknowns and contradictions.
- Safe rendering of untrusted job-description content as text.
- Evaluation history without overwriting previous evaluations.
- Accessible headings, controls, and status messaging.

### Current routing lock

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

Routing is an execution detail and does not change stage semantics or recommendation rules.

**Branch state:** the GPT-6 Luna routing for Company Alignment and Burnout Risk is on `codex/evaluator-live-diagnostic`. `claude/gallant-pasteur-y1ou3i` still carries the earlier accepted routing (GPT-5.6 Luna for both) until final branch combination.

### Milestone 4 salary-policy alignment

Milestone 4 now consumes the Task 7 salary/currency/residency contract at commit `267124f` on `codex/evaluator-live-diagnostic` (not yet merged; on `claude/gallant-pasteur-y1ou3i` the evaluator subject still withholds all ten Task 7 fields until final branch combination).

- `US_REQUIRED`: `$60,000 USD-equivalent` or more = Pass; below `$60,000` = Fail/Skip. No U.S. Review band and no maximum.
- `NON_US`: `$60,000+` = Pass; `$55,000–$59,999.99` = Review; `$50,000–$54,999.99` = conditional Review only when explicit configured geography supports viability, otherwise Unknown; below `$50,000` = Fail/Skip.
- `null` residency requirement = Unknown.
- Residency selects the policy; currency does not.
- Foreign compensation uses the versioned `cs-salary-policy-v2-ecb-2026-10-14` FX policy.
- A disclosed minimum is the gate. Max-only remains Unknown unless even the maximum is below the applicable floor.
- Released to evaluator (on the Codex branch): salary minimum/maximum, currency, residency requirement, residency regions.
- Still withheld pending later coordinated adoption: work arrangement, seniority, department, employment type, closing date.

## In Progress Now

### Claude Task 8 — Application Tracker completion pass

Task 8 is the immediate product task.

The completion pass should audit and close only genuine gaps in the existing application tracker, including persistent stage/state, dates, follow-ups, notes, contacts/interviews where supported, outcomes, due/overdue/due-today visibility, stale-write protection, guarded lifecycle interaction, and survival across reevaluation.

Task 8 does not include a proactive notification engine, calendar integration, or email integration.

### Evaluator acceptance state

The evaluator routing policy is locked. Broader DB-backed integration, E2E, whole-product acceptance, and any final live provider verification remain intentionally deferred until all intended main-product work is complete.

## Next Main-Product Work

After Task 8:

1. Task 9 completion pass.
2. Audit/close any remaining gaps in features 1–10.
3. Build main-product features 11–18:
   - automated discovery/retrieval/scraping;
   - source health and conservative retrieval;
   - ghost-job/posting-history intelligence;
   - browser extension companion;
   - source intelligence;
   - job-market analytics;
   - personal job-search analytics;
   - company intelligence.
4. Perform final evaluator/product integration, whole-product acceptance, evaluator freeze, and deliberate merge only after features 1–18 are complete.

Retrieval flow:

```text
Job Sources
→ Retrieval / Scraping
→ Normalization
→ Deduplication
→ Existing Evaluator
→ Apply / Review / Skip
```

The retrieval layer should feed the existing evaluator rather than redesign it.

## Later Add-ons Only

The following are not part of main-product acceptance:

- company watchlists;
- proactive notifications/follow-ups;
- calendar integration;
- email integration;
- application assistance such as resume tailoring, cover letters, application questions, interview preparation, and skills-gap/learning assistance.

Beyond the Customer Success product:

- additional domain assistants;
- additional deferred features defined in the authoritative PRDs/TDDs.

## Current Boundaries

- Core remains domain-neutral.
- Customer Success owns its salary thresholds and affordability policy.
- Retrieval must feed the existing normalization/dedup/evaluator boundary rather than create a second evaluator.
- The browser extension is a companion to the same application, backend, data, evaluator, lifecycle, provenance, budget, and dashboard.
- Paid provider calls require explicit authorization.
- Experiments/tests must not use the normal application database without explicit authorization.
- Historical milestone/status documents should remain truthful history; current-state documents should reflect the latest accepted implementation.
