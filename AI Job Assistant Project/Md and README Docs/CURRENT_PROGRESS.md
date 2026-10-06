# Current Progress

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** October 5, 2026

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

Remaining non-evaluator product work is being completed in parallel by Claude.

#### Completed — Opportunity dashboard and Domain default (October 6, 2026)

- `GET /api/opportunities`: read-only, newest-first list of persisted opportunities with their latest evaluation (task status and persisted decision). Bounded by `limit` (default 100, max 200); an invalid query returns 400.
- `/` is now a dashboard of opportunities with an empty state. Manual entry moved to `/opportunities/new`. The detail page links back to the dashboard.
- The manual-entry Domain field is now a select defaulting to `customer-success`. Previously a blank domain made the opportunity impossible to evaluate.
- The dashboard uses its own domain-neutral display helpers (`apps/web/src/components/dashboard/`). It does not import the evaluation/Customer Success result UI and does not recalculate or restyle recommendations.
- No changes to evaluator internals, schemas, routing, worker/queue behavior, or recommendation logic.
- Tests added:
  - `tests/unit/opportunity-dashboard.test.tsx`
  - `tests/integration/opportunity-list.test.ts`
  - `tests/e2e/opportunity-dashboard.spec.ts`
  - `tests/e2e/app-shell.spec.ts` updated.

#### Remaining main-product order

1. Evaluation-experience correctness:
   - show the last completed result when the latest evaluation failed;
   - show safe failure details;
   - show per-field form errors;
   - add a continue-checking control after the polling cap;
   - add a stalled-queue notice;
   - make source and application URLs clickable.
2. Lifecycle and user actions: Save, Applied, Dismiss, Archive, plus `EVALUATED`/`RECOMMENDED`. Needs Codex coordination: shared persistence and worker path, and the `NORMALIZED`-only evaluation guard.
3. Usage/cost display. The data is already returned by the evaluation API.
4. Profile/preferences management. Needs Codex coordination: domain profile contract.
5. Budget ledger and deferral, if in V1 scope.
6. Setup docs and a migrate script, then final E2E acceptance after the evaluator freeze.

#### Known issues found during main-product work

- **Pre-existing evaluator test-harness drift (Codex area, not fixed here).** These fail on `main` (`ebd5911`) before any main-product change. Unit tests (603) pass.
  - **Integration:** 11 tests in `tests/integration/production-evaluation-flow.test.ts` fail. The test's own fake provider returns raw Burnout Risk domain output (the `customer-success.burnout-risk` case, around line 206). It does not apply `toBurnoutRiskProviderTransport`, so the stage fails with `STRUCTURED_OUTPUT_INVALID`.
  - **E2E:** the Apply/Review flows in `tests/e2e/evaluation-results.spec.ts` fail with `SEMANTIC_EXECUTION_POLICY_MISMATCH`. The web server queues the mixed Terra/Luna execution policy (`semantic-execution-config.ts`), but the worker in `tests/support/e2e-evaluation-helper.ts` is built without that policy.
- **Playwright Chromium mismatch.** In environments with a different preinstalled Chromium build, Playwright 1.62.1 needs a matching browser or a `launchOptions.executablePath` override.

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
