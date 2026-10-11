# Current Progress

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** October 11, 2026

## Current Objective

Finish the evaluator and remaining main-product work in parallel so they can be combined into a stable, usable first product before automated retrieval/scraping begins.

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

#### Organizational Maturity mixed-state stabilization — October 10, 2026

- Completed the full affected-subsystem audit and 11-assessment compatibility matrix.
- Corrected two Category-A assumptions: the over-broad missing-information conclusion guard and the evidence-identity contradiction assumption.
- Replayed five preserved Organizational Maturity outputs with the intended pass/fail behavior.
- Passed the full affected-path success proof through Burnout Risk, Opportunity Priority, and deterministic recommendation.
- Passed non-retryable failure-injection proof with downstream isolation and prior-stage preservation.
- Passed the full unit suite, typecheck, Prisma validation, changed-file lint, and diff-integrity checks.
- No provider calls or database mutations were performed.
- Next gate: one final paid acceptance rerun after explicit authorization is provided.

#### Resume Match evidence-partition stabilization — October 11, 2026

- Replaced independently authored decision-impact and assessment-only evidence arrays with one provider-visible assignment collection whose entries have exactly one purpose.
- Preserved fail-closed checks for duplicate provider identities, restored Core-identity collisions, unresolved references, wrong-source evidence, and cross-purpose overlap.
- Tightened Genuine Gap eligibility so requirement-relevant affirmative absence evidence is required; missing or unrelated evidence remains Unknown.
- Bound source-specific Resume Match evidence fields to the correct JD or profile provider catalogs while retaining source-neutral fields where the domain permits either source.
- Replayed the latest failed live response, the grouped-citation response, and preserved historical results offline; the invalid overlap remains rejected while persisted historical domain results remain readable.
- Proved the valid offline path through Resume Match, Opportunity Priority, and deterministic finalization, plus non-retryable downstream isolation for invalid Resume Match output.
- No provider calls, live evaluations, or database mutations were performed.
- Next gate: one final paid acceptance rerun after review, commit, and explicit authorization.

## Current Accepted Model Routing

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

### Evaluator

Next accepted sequence:

```text
JD Reconstruction optimization #2
→ Resume Match optimization #2
→ combined-path integration
→ final mixed-model evaluation
```

### Main Product

Remaining non-evaluator product work is to be completed in parallel.

The exact outstanding task list should be pulled from the current repository / Codex architecture history before being expanded here.

## Planned Next

After evaluator and main product completion:

1. integrate both into the first stable usable product;
2. verify the end-to-end manual workflow;
3. begin automated retrieval/scraping;
4. connect retrieval to normalization and deduplication;
5. feed normalized opportunities into the existing evaluator;
6. expand source coverage and analytics later.

## Settled Decisions

- Customer Success is the first implemented domain.
- The Core Platform remains domain-agnostic.
- The evaluator should not be redesigned merely to accommodate model/provider quirks.
- Provider transport schemas may differ from persisted domain schemas.
- Authoritative application data should be restored deterministically rather than regenerated by a model.
- Predetermined results belong in code rather than paid semantic calls.
- Unknowns remain Unknown.
- Final Apply / Review / Skip is deterministic application logic.
- Model routing is an execution detail, not a product-semantic change.
- Retrieval/scraping comes after the first usable product and must feed the existing evaluator.
- Codex and Claude may work in parallel only with clear ownership boundaries.
- Paid provider calls require explicit authorization.
- Optimization candidates are judged against the last known-good implementation as BETTER / SAME / WORSE.

## Open Items

- Exact remaining non-evaluator product task list.
- Exact current local setup/run commands for README.
- Complete Milestones 1–10 historical documentation.
- Complete evaluator-history/status document.
- Final evaluator benchmark after remaining optimization work.

## Known-Good Principle

When a change introduces instability or semantic regression, revert to the last known-good implementation rather than forcing the optimization through.
