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

#### Completed — Evaluation-experience correctness (October 6, 2026)

- **Failed latest evaluation.** When the latest evaluation failed, the page shows the most recent completed evaluation from history, labeled as such. Otherwise it accurately says whether earlier results exist. The latest status still drives the controls.
- **Safe failure details.** The persisted failure code is shown (only if it is a well-formed identifier) with a mapped user-facing message. The stored error message is never rendered, because it can contain internal validation/provider detail.
- **Per-field validation errors.** Manual entry shows server validation errors next to each field (`aria-invalid` + `aria-describedby`). Unmatched issues stay form-level.
- **Keep checking.** A "Keep checking" control appears whenever status polling stops, whether at the polling cap or after a failed refresh, and restarts bounded polling.
- **Stalled-queue notice.** If an evaluation stays queued for more than 60 seconds, a notice says the worker may not be running (`pnpm worker:evaluations`).
- **Clickable URLs.** Source and application URLs are links that open in a new tab (`noopener noreferrer`). Only http(s) URLs become links; anything else stays plain text.
- UI and product-service code only. No evaluator, schema, routing, worker, or recommendation changes. Nothing is recalculated in the browser.
- Tests:
  - `tests/unit/evaluation-experience-correctness.test.tsx` (new);
  - poller cap/restart case in `tests/unit/evaluation-poller.test.ts`;
  - two E2E flows in `tests/e2e/evaluation-results.spec.ts`: failed-reevaluation fallback, and queued-too-long plus keep checking;
  - two E2E flows in `tests/e2e/opportunity-dashboard.spec.ts`: field errors and clickable links.
  - The E2E helper gained deterministic `fail-latest` and `age-latest` commands.

#### Remaining main-product order

1. Lifecycle and user actions: Save, Applied, Dismiss, Archive, plus `EVALUATED`/`RECOMMENDED`. Needs Codex coordination: shared persistence and worker path, and the `NORMALIZED`-only evaluation guard.
2. Usage/cost display. The data is already returned by the evaluation API.
3. Profile/preferences management. Needs Codex coordination: domain profile contract.
4. Budget ledger and deferral, if in V1 scope.
5. Setup docs and a migrate script, then final E2E acceptance after the evaluator freeze.

#### Known issues found during main-product work

- **Resolved (test-only): evaluator test-harness drift.** On `main` (`ebd5911`), 11 integration tests and both E2E evaluation flows failed because test harnesses lagged accepted evaluator contract changes:
  - the Burnout Risk transport (`65dcaab`);
  - the Resume Match compatibility model (`fe8b0d2`);
  - the mixed-routing execution policy (`a307631`).

  The harnesses are repaired without production changes. Integration is now 25/25 and E2E 4/4. See `HANDOFFS.md` ("Evaluator Test-Harness Drift Repaired").
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
