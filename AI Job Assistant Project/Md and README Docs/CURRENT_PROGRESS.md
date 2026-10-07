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

#### Completed — Opportunity lifecycle and user actions (October 6, 2026; Core guard awaiting Codex review)

- **Automatic system lifecycle.** After a completed evaluation, `NORMALIZED`/`EVALUATED` → `RECOMMENDED` (or `NORMALIZED` → `EVALUATED` if there is no recommendation). A failed evaluation changes nothing.
  - Automatic sync never overwrites a user state and never downgrades.
  - It runs in a product-level wrapper around the production evaluation processor (`apps/web/src/server/opportunity-lifecycle-sync.ts`). A sync failure is logged and never fails a completed task.
  - The worker repairs any missed sync with a sweep at startup.
  - Core still never mutates the lifecycle.
- **User actions.** `POST /api/opportunities/[id]/action` accepts `SAVE`, `MARK_APPLIED`, `DISMISS`, `ARCHIVE` and `RESTORE`.
  - Each action is a compare-and-set plus a row in the new additive `OpportunityUserAction` table, in one transaction.
  - Only explicit user actions write that table; evaluations and the automatic sync never do.
- **Deterministic RESTORE.** An undo stack over the action history: each non-RESTORE action pushes, each RESTORE pops, and RESTORE targets the newest action not yet undone. Repeated RESTORE walks backward and never bounces. A system-state target is re-derived from persisted evaluations.
- **Reevaluation.** Allowed in every normalized state except `ARCHIVED`/`CLOSED`, which return 409 `OPPORTUNITY_NOT_EVALUABLE`. A user state is preserved and a new evaluation-history row is added.
- **Dashboard.** Views for Active (default), Saved, Applied, Dismissed, Archived and All; lifecycle labels on each row; `GET /api/opportunities?view=`.
- **Detail page.** Status and action buttons. Reevaluate is disabled with an explanation when the opportunity is archived or closed. Status refreshes after an evaluation completes.
- **Core guard (⚠ awaiting Codex review).** The Core executor's `NORMALIZED`-only guard is widened to `isNormalizedLifecycleState` (any state except `DISCOVERED`) in `execute()` and `executeExisting()`. Automatic lifecycle writes depend on this change and are not integration-ready until Codex reviews it. See `HANDOFFS.md`.
- **Migration.** `20261006210110_opportunity_user_actions` is additive only.
- **Tests:**
  - unit: `opportunity-lifecycle.test.ts`, `opportunity-actions.test.tsx`, executor guard cases, evaluation request guard cases;
  - integration: `opportunity-lifecycle.test.ts`, which runs real deterministic evaluations through the production wrapper;
  - E2E: the lifecycle flow.

#### Completed — AI usage and cost display (October 6, 2026)

- **Results page.** A collapsed "AI usage and estimated cost" section for the displayed evaluation. It shows provider attempts, all five token categories, estimated cost with its currency, and the pricing configuration version(s).
  - A collapsed per-operation breakdown lists operation, model, attempt, status, tokens and cost.
  - Values are rendered from the existing API `usage` (built by `summarizeSemanticUsage()`) and `operations`.
  - Unreported values show "Unknown", never 0.
  - Provider request IDs and raw error messages are never rendered; operation error codes are sanitized.
- **Dashboard.** "AI usage" totals across all evaluations: evaluations, attempts, total tokens, estimated cost and pricing basis. The totals come from a read-only product repository (`database/src/usage-summary-repository.ts`) that reuses `summarizeSemanticUsage()` as-is. When the total cost is Unknown, the page says why: attempts without a recorded cost, or mixed currencies.
- **Not changed.** No changes to the evaluator, pricing/cost calculation, usage recording, or schema, and no budget limits, deferral or ledger.
- **Tests:**
  - `tests/unit/usage-display.test.tsx`;
  - `tests/integration/usage-summary.test.ts` (attempts seeded through the existing recorder);
  - E2E usage assertions in the Apply and lifecycle flows.

#### Completed — Pre-Task-5 foundation pass: provenance and multi-source readiness (October 6, 2026)

- **Audit result.** Most provenance was already correct:
  - raw-first `SourceRecord` capture;
  - Opportunity identity, URL and timestamp fields;
  - field-level `FieldProvenance`;
  - many `SourceRecord`s per Opportunity;
  - `DuplicateReference`.

  Evaluation, reevaluation and lifecycle actions never write provenance.
- **Fixed — per-source application URL.** `SourceRecord.applicationUrl` is now a first-class column (it was previously only in JSON). Migration `20261006232000_source_record_application_url` backfills it null-safely, copying only well-formed http(s) values and leaving everything else NULL.
- **Fixed — manual capture.** It can now record an optional source job ID (`externalId`, with field provenance) and "where you found it" (`sourceMetadata.reportedSource`, informational only). Manual jobs always keep `source = "manual-input"` / `sourceType = MANUAL`.
- **Fixed — provenance in the UI.**
  - The detail page has a "Source and provenance" section: entry method, source, reported source, every source record with its URLs (safe links), source job/requisition IDs, and discovered/last-observed/normalized timestamps.
  - Opportunity-level first/last seen is also shown.
  - Dashboard rows show the source; list items carry `source`/`sourceType`.
- **Fixed — duplicate paid evaluations.** A server-side guard returns 409 `EVALUATION_ALREADY_ACTIVE` while the opportunity's latest evaluation is queued or running. The residual true-concurrency race is documented in `HANDOFFS.md`.
- **Tests:**
  - `tests/unit/foundation-provenance.test.tsx`;
  - guard cases in `evaluation-api-worker.test.ts`;
  - `tests/integration/foundation-provenance.test.ts`: full provenance snapshot unchanged across evaluation, reevaluation and all user actions; backfill edge cases; the guard;
  - a provenance E2E flow.
- **Deferred (all additive later):**
  - `SourceRecord.retrievalType`/`sourceCategory` (with the first collector);
  - posting-history observations;
  - the dedup engine and canonical-source selection;
  - submit-URL-only capture.

#### Completed — Task 5: Profile and preferences management (October 7, 2026)

- **`/profile` ("Profile & preferences", linked from the dashboard).** Shows which version new evaluations use, a displayed-version selector, the editor, and the version history.
  - The history shows each version's saved date, how many evaluations used it, Active / In use / Viewing badges, and View and Make active (with confirmation).
- **Structured form.** Edits the evaluation-relevant fields of the existing Customer Success contract:
  - salary (currency, pass and review thresholds, lower-cost countries);
  - work arrangement and the unknown-arrangement result;
  - allowed and disallowed countries, US-only roles;
  - travel allowances (recurring onsite and field travel are fixed FAIL and shown read-only);
  - role families;
  - fit areas, lower-alignment patterns and work styles;
  - business models, product types, customer types and segments;
  - career-strategy goals;
  - career goals, experience (Direct/Related/Transferable), skills, transferable skills and work preferences.

  Unset fields show their effective default with a "Default" tag and stay unset unless edited. Nothing outside the contract was added; seniority and relocation are not in the contract and are not exposed.
- **Advanced JSON editor.** The full stored document.
  - Parse errors are shown with line and column, and validation errors by path.
  - Unknown keys are rejected, including inside nested preference objects that the domain schema would otherwise silently strip.
  - The label is locked.
- **One draft, two editors.** The form and the JSON editor share one base version, and at most one of them can hold unsaved changes.
  - Form → JSON always carries the changes over.
  - JSON → form carries the changes over only when that is lossless. Otherwise it asks; "Keep editing JSON" keeps the draft byte-for-byte, and "Discard JSON changes" returns to the base.
  - Changing the displayed version while there are unsaved changes asks first, and a `beforeunload` warning covers leaving the page.
  - Each save submits only the open editor's draft, as one request that creates at most one version.
- **Append-only versions and an explicit active version.**
  - Saving always appends through the existing `PrismaUserProfileImportRepository.import()` (with hash dedupe).
  - "Save as new version" never changes what evaluations use; "Save and make active" does.
  - The new additive `ActiveUserProfile` table (one row per domain) is a pointer only. Activation never updates a `UserProfile` row.
  - Before the first save, the version currently in use is pinned, so a new version can never take over implicitly.
- **Profile resolution for new evaluations:**
  1. an explicit `userProfileId`;
  2. the active version;
  3. the previous newest-profile fallback, used only when nothing was ever activated.

  The resolved version is pinned at enqueue as before, and historical evaluations are never rebound.
- **Opportunity detail hint.** When the latest evaluation used a different version than new evaluations would, the page says so and suggests reevaluating. Nothing is reevaluated automatically.
- **CLI.** `pnpm profile:import:customer-success` keeps appending versions. `--activate` makes the imported version active; without it, the version in use is unchanged.
- **Not changed.** Evaluator, domain profile contract, prompts, stages, routing and recommendation logic are unchanged. Migration `20261007120000_active_user_profile` is additive only (the known `Recommendation.evidenceReferences` drift line was excluded again).
- **Tests:**
  - `tests/unit/profile-management.test.ts`: option lists equal the domain schema; changes apply only to changed paths; JSON → form diff; validation paths; label lock; handlers.
  - `tests/unit/profile-editor.test.tsx`: draft reducer, including a 5,000-step invariant check, plus jsdom component tests for both switch directions, confirm and cancel discard, and exactly one save request from either editor.
  - `tests/integration/profile-versioning.test.ts`:
    - historical linkage (evaluation row, API `versions.userProfile` and profile evidence `sourceReference` unchanged after v2 is saved and activated);
    - a queued evaluation keeps the pinned v1;
    - the pin guard, rollback, fallback, dedupe and cascade;
    - no `UserProfile` row is ever mutated;
    - exactly one row per save.
  - `tests/e2e/profile-management.spec.ts`, which runs after the other specs as its own Playwright project, because it changes the active version.
  - Dev dependency `jsdom` was added for the component tests.

#### Completed — Task 6: Budget ledger and deferral (October 7, 2026)

- **Budget** (`/budget`, plus a "Budget" link and an "AI budget" card on the dashboard):
  - a monthly calendar budget in a chosen IANA time zone (default UTC), with amount, currency (must match the AI pricing currency), reserve per evaluation, and an enforcement toggle;
  - "Remove budget" makes evaluations unlimited again;
  - the period resets implicitly, because spend is always computed over the current window, so no job is needed.
- **Spend accounting.**
  - Known spend is the direct sum of persisted `SemanticOperationAttempt.estimatedCost` in the budget currency within the period.
  - Null-cost attempts are counted separately as unknown, and other-currency attempts separately; neither is ever counted as $0.
  - An evaluation with $0.07 known plus one unknown attempt contributes $0.07 and raises the unknown warning.
  - `summarizeSemanticUsage()` and the existing usage displays are unchanged.
- **Reservations and holds.**
  - With a budget configured, each admitted evaluation gets a reservation (`EvaluationBudgetReservation`).
  - Its remaining hold (reserve − known cost so far) counts while the work is unresolved:
    - live or queued/running work holds in whichever period is current, including across a month boundary;
    - a finished run with unknown cost holds only in the period of its unknown attempt;
    - a finished run with all costs known holds nothing.
  - Actual cost replaces the hold automatically, and nothing is rewritten.
- **Gate and deferral.** Each request runs under one Postgres advisory lock.
  - With no budget, it is unrestricted: no reservation, no deferral, behaviour as before.
  - With enforcement on and no room, the request is recorded as a `DeferredEvaluation` (BUDGET_UNAVAILABLE, with a budget snapshot). It creates no Evaluation, Task or provider call, and the lifecycle is untouched.
  - The evaluate API returns 200 `outcome: "DEFERRED"` instead of 202.
- **Resume and cancel.**
  - From the backlog on `/budget`, or the opportunity page ("Resume deferred evaluation" / "Cancel request").
  - Resume re-checks the budget, the active-evaluation guard and the lifecycle.
  - It uses the **profile version pinned at deferral time**; a deleted pinned version is refused with a clear reason.
  - A request whose resume admission is abandoned returns to the backlog.
  - Automated draining is additive later; there is no scheduler.
- **Request integrity** (always on, separate from money).
  - Every product request creates an `EvaluationAdmission`, which the new `PrismaEvaluationTaskRepository.enqueueAdmitted()` consumes atomically in the transaction that creates the Evaluation and Task.
  - An abandoned admission (timeout after a crash before enqueue) can therefore never produce an Evaluation.
  - This closes the duplicate-active race previously documented in HANDOFFS.
  - A check-ordering race found during testing (two queued under concurrency) was fixed: the live admission is read before the active evaluation. It is covered by a repeated concurrency regression test.
- **UI:**
  - the dashboard budget card (known spend, reserved, remaining known, unknown/other-currency warnings, enforcement, reset date, deferred count);
  - rows show "Evaluation deferred";
  - the opportunity page explains the deferral from the snapshot (pinned profile, active-profile difference);
  - the results page shows "Reserved before run" next to the actual cost.
- **Migration.** `20261007200000_budget_ledger` is additive (four tables, two enums, plus a check that an admission is never both consumed and abandoned); the known `Recommendation` drift line is excluded.
- **Tests:**
  - unit: `budget.test.ts` (period/DST/time zones, holds, decision, validation) and `budget-ui.test.tsx` (card, reason, backlog, handlers, 200/202 outcomes);
  - integration: `evaluation-admission.test.ts` (recovery, durable association, delayed enqueue after abandonment, consume/abandon race ×20, failed enqueue, unchanged `enqueue()`, concurrent requests with and without budget, no-budget integrity) and `budget-deferral.test.ts` (gate, deferral with zero rows created, restart persistence, resume re-check, reconciliation, unknown cost, both concurrency cases, pinned profile, archived/cancel, abandoned resume, settings never rewrite usage, currency, period boundaries);
  - E2E: `budget.spec.ts`, its own Playwright project, run last.

#### Remaining main-product order

Revised roadmap:

- Task 5 — Profile + Preferences: done (see above).
- Task 6 — Budget Ledger + Deferral: done (see above).
- Task 7 — Product UI: dashboard, search, sort, filters, analytics polish.
- Task 8 — Application Tracker: notes, follow-ups, contacts, outcomes.
- Task 9 — Final setup, operations, integration, E2E.
- Then retrieval/scraper; then source, job-market and posting-history intelligence; later ecosystem features.

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
