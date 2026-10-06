# Product Status

**Project:** AI Career Platform / AI Job Assistant  
**Primary implemented domain:** Customer Success  
**Status:** Active development  
**Last updated:** October 5, 2026

## Purpose

This document provides a concise current-state view of the product. It is not a replacement for the authoritative PRDs, TDDs, or Semantic Evaluation Playbook.

Use it to answer three questions:

1. What is already working?
2. What is currently being completed?
3. What remains planned?

## Current Working Product

The platform currently supports a working manual Customer Success evaluation flow:

```text
Manual Opportunity
→ Persistence
→ Queued / Running Evaluation
→ Background Processing
→ Customer Success Evaluation Pipeline
→ Deterministic Final Recommendation
→ Persisted Apply / Review / Skip Result
→ Results UI
```

The current product can evaluate a manually entered job without automated retrieval.

## Complete or Substantially Implemented

### Core Platform

- Repository and shared platform foundation.
- PostgreSQL persistence.
- Manual opportunity ingestion.
- Shared evaluation framework with ordered stages.
- Evidence records.
- Explicit Unknown handling.
- Contradiction handling.
- Structured semantic-output validation.
- Background evaluation processing.
- Persisted evaluation history.
- Semantic-operation usage and estimated-cost accounting.
- Restart-safe per-evaluation semantic-call budgeting.
- Results retrieval through the application.

### Customer Success Evaluator

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
- Ghost Job Risk behavior when posting-history evidence is unavailable.
- Deterministic Final Recommendation.
- Apply / Review / Skip output.
- Evidence-backed explanations.
- Preservation of Unknowns and contradictions.

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

### Model Routing

Accepted Customer Success routing:

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
| Ghost Job Risk | Deterministic when evidence is insufficient |
| Final Recommendation | Deterministic application logic |

## In Progress

### Evaluator Completion

- JD Reconstruction optimization #2.
- Resume Match optimization #2.
- Combined-path integration.
- Final mixed-model evaluation.
- Final quality/cost verification against the last known-good implementation.

### Main Product Completion

The evaluator is not the only remaining work. The rest of the application still needs to be completed and integrated around the evaluator.

This work includes the remaining application logic, UI, workflow completion, and integration required for a stable and usable first product.

Exact remaining items should be confirmed against the current repository before this section is expanded into a task-level checklist.

## Planned After the Usable Product Is Complete

### Retrieval / Scraping

Automated job retrieval will be added after the evaluator and main product are complete enough to function together.

Planned flow:

```text
Job Sources
→ Retrieval / Scraping
→ Normalization
→ Deduplication
→ Existing Evaluator
→ Apply / Review / Skip
```

The retrieval layer should feed the existing evaluator rather than redesign it.

### Later Product Capabilities

- Broader automated discovery.
- Additional source adapters.
- Stronger posting-history support for Ghost Job Risk.
- Source analytics.
- Company watchlists.
- Additional domain assistants.
- Additional deferred features defined in the authoritative PRDs/TDDs.

## Not Yet Confirmed Here

The following should be filled from the repository and historical Codex chats rather than reconstructed from memory:

- exact remaining non-evaluator implementation tasks;
- exact package/scripts and local startup commands;
- exact milestone-by-milestone implementation history;
- exact final evaluator benchmark after remaining optimization work.
