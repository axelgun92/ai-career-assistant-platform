# Agent Workstreams

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** October 16, 2026

## Purpose

This document defines current ownership boundaries for coding agents so parallel development does not create conflicting edits, architectural drift, or duplicated work.

It is a coordination document, not a product specification.

## Current Workstream Split (October 15, 2026; status updated October 16, 2026)

Ownership as defined in `DEVELOPMENT_PLAN.md` (October 15, 2026):

### Codex

Primary ownership:

- evaluator internals;
- evaluator-sensitive contract changes;
- model routing and pricing policy;
- deep evaluator debugging/audits;
- paid/live diagnostics and final live acceptance when explicitly authorized.

The evaluator routing policy is locked. Codex's evaluator work lives on the evaluator branch (`codex/evaluator-live-diagnostic`). That includes the GPT-6 Luna routes for Company Alignment and Burnout Risk, the October 10–13 semantic-contract repairs (`cs-jd-reconstruction-v7`, `cs-resume-match-v4`, `cs-organizational-maturity-v7`) and the Milestone 4 salary-policy alignment (`267124f`). It is combined with the main-product branch only at the final integration checkpoint.

Outstanding evaluator work (October 16, 2026): final live acceptance of the integrated evaluator and measurement of the current-contract cost. Both belong to the final integration pass and need explicit paid-call authorization. No evaluator-branch commits after `267124f` (October 15) are recorded, and the repository does not record any newer Codex activity.

### Claude / Claude Code

Primary ownership:

- product/UI/workflow completion;
- application logic;
- profile/budget/dashboard/tracker behavior;
- retrieval architecture and most main-product implementation outside evaluator internals, including main-product features 11–18;
- isolated product integration tests.

Claude treats the evaluator as an existing boundary unless a genuine integration defect requires coordinated change. Current Claude work is on `claude/gallant-pasteur-y1ou3i`: the Task 1–9 completion pass.

- Task 8 — Application Tracker completion pass: complete (`534a4c7`, October 16, 2026).
- Task 9 — Operations hardening completion pass: complete (commit `feat: complete operational hardening`, October 16, 2026).
- The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete (Core AI Framework PRD v1.5, Customer Success PRD v1.4, Core Platform TDD v1.6, Customer Success TDD v1.4, Semantic Evaluation Playbook v1.3).
- Next: an audit of any remaining gaps in main-product features 1–10.
- After that: main-product features 11–18.
- Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze and merge. Features 19–23 remain later add-ons.

### Shared rules (October 15, 2026)

- The builder gets the first opportunity to debug its own code; the other agent may provide a second opinion.
- Neither agent auto-merges `main`.
- Shared schemas, persistence contracts, evaluator orchestration, queue/worker behavior, and ingestion/evaluator boundaries require explicit coordination.
- Retrieval work may be split once ownership can be cleanly separated, but both agents must use one shared ingestion contract.
- Agents should not edit the same files at the same time.

## Earlier Workstream Split (October 5, 2026; superseded, kept as history)

### Codex

Primary responsibility:

- finish the Customer Success evaluator;
- evaluator optimization;
- evaluator-sensitive implementation changes;
- architecture/code audits tied to evaluator correctness;
- bugs affecting semantic execution;
- isolated/live verification;
- final mixed-model integration;
- evaluator regression protection.

Codex should preserve the existing evaluator contracts and should not redesign settled architecture without a demonstrated product requirement.

### Claude / Claude Code

Primary responsibility:

- remaining main-product work outside evaluator internals;
- application logic;
- remaining UI;
- workflow completion;
- integration around the evaluator;
- product-level usability work;
- non-evaluator implementation needed to reach a stable usable product.

Claude should treat the evaluator as an existing boundary unless a genuine integration defect requires coordinated change.

## Shared Rules

Both agents must:

- read the authoritative PRDs and TDDs before changing product behavior;
- read the Semantic Evaluation Playbook before changing semantic execution;
- preserve existing product semantics unless a new authoritative requirement says otherwise;
- avoid duplicating architecture in a second subsystem;
- keep Unknowns, evidence, contradictions, and persisted recommendations intact;
- avoid silently changing recommendation behavior;
- prefer targeted fixes over unnecessary redesigns;
- update current progress after meaningful completed work.

## Files and Areas with Extra Coordination Risk

The following areas should not be edited concurrently without an explicit handoff:

- evaluator orchestration;
- semantic provider/model routing;
- Customer Success stage contracts;
- shared schemas;
- persistence contracts used by both evaluator and UI;
- queue/worker behavior;
- recommendation logic;
- ingestion/evaluator boundary.

If both agents need the same area, one agent should finish and hand off before the other begins.

## Retrieval / Scraper Phase

**Current (October 15, 2026):** retrieval and intelligence are **main-product features 11–18**, not a later post-product phase:

- automated retrieval/scraping;
- source health and conservative retrieval;
- posting-history/ghost-job intelligence;
- the browser extension companion;
- source intelligence;
- job-market analytics;
- personal job-search analytics;
- company intelligence.

They are built after the Task 1–9 completion pass and must be complete before final evaluator/product integration and acceptance. Only features 19–23 are later add-ons. See `DEVELOPMENT_PLAN.md`.

*Earlier wording (October 5, 2026; superseded):* Retrieval begins after the evaluator and usable product are complete.

At that point, work may be split between agents.

Example split:

### Retrieval Agent

- source adapters;
- retrieval methods;
- source-specific collection;
- source fixtures;
- source failure handling.

### Integration Agent

- ingestion contract;
- normalization;
- deduplication;
- provenance;
- evaluator handoff;
- duplicate-evaluation prevention;
- integration testing;
- error handling.

The exact division can change, but both agents must use one shared ingestion contract.

## Ownership Changes

Whenever ownership changes:

1. update this file if the workstream split materially changes;
2. add a handoff entry to `HANDOFFS.md` (repository root) when work is actively transferred;
3. update `AI Job Assistant Project/Md and README Docs/CURRENT_PROGRESS.md` with the new current owner and next task.
