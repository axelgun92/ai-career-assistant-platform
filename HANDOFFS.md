# HANDOFFS.md

# AI Job Assistant — Agent Handoffs

## Purpose

This file records explicit work transfers between coding agents working on the AI Job Assistant.

Use it when one agent finishes work that another agent needs to continue, verify, integrate, or avoid duplicating.

It is not a product specification and does not replace the PRDs, TDDs, `PRODUCT_STATUS.md`, `DEVELOPMENT_PLAN.md`, `CURRENT_PROGRESS.md`, `AGENT_WORKSTREAMS.md`, or `EVALUATOR_STATUS.md`.

## Handoff Rules

1. Record only concrete completed work, known state, tests, blockers, and next actions.
2. Do not invent missing implementation details.
3. Preserve established architecture and evaluator boundaries.
4. If a handoff crosses a high-risk boundary, say so explicitly.
5. Do not silently transfer ownership of evaluator internals, schemas, routing, persistence contracts, or shared worker behavior.
6. If the receiving agent must coordinate before changing something, mark it clearly under **Do Not Change Without Coordination**.
7. Keep historical handoffs; do not overwrite prior entries.

## Handoff Template

### Handoff: <short descriptive name>

**Date:** YYYY-MM-DD  
**From:** <agent / workstream>  
**To:** <agent / workstream>  
**Status:** Ready / Blocked / Partial / Verification Needed

#### Completed

- What was finished.
- What behavior now exists.
- Any important decisions made.

#### Files Changed

- `path/to/file`

#### Current Contract / Assumptions

- What the receiving agent can safely assume.
- Relevant API, schema, persistence, or UI boundaries.
- Any accepted model-routing or evaluator assumptions that matter.

#### Verification Completed

- Tests run.
- Build/typecheck/lint results.
- Manual verification performed.
- Any checks that were intentionally not run.

#### Known Issues / Blockers

- Remaining defects.
- Environment limitations.
- Missing dependencies.
- Open questions.

#### Next Task

- The exact work the receiving agent should continue with.

#### Do Not Change Without Coordination

- High-risk files, contracts, evaluator internals, schemas, routing, worker behavior, or shared persistence paths that should not be altered casually.

## Current Handoffs

### Handoff: Evaluator Boundary to Main-Product Work

**Date:** 2026-10-06  
**From:** Codex evaluator workstream  
**To:** Claude main-product workstream  
**Status:** Ready

#### Completed

- Customer Success evaluator architecture and stage sequence are established.
- Terra/Luna routing from the semantic-stabilization phase is accepted.
- Resume Match Optimization #2 is the current accepted Resume Match baseline.
- JD Reconstruction State2 is the current accepted JD Reconstruction baseline.
- More aggressive JD Reconstruction Optimization #2 candidates were rejected.
- The current projected evaluator cost is approximately `$0.2026282`.
- Final Recommendation remains deterministic.
- Ghost Job Risk remains deterministic `UNKNOWN` when objective posting-history evidence is unavailable.
- Evidence, Unknown, contradiction, provenance, seniority, specialization, and direct/related/transferable safeguards are established.

#### Current Contract / Assumptions

Claude may treat the evaluator as a stable integration boundary for main-product work.

Accepted routing at the current stage:

- Hard Filters — Deterministic
- JD Reconstruction — GPT-5.6 Terra
- Job Evaluation — GPT-5.6 Luna
- Company Alignment — GPT-5.6 Luna
- Organizational Maturity — GPT-5.6 Luna
- Alex Fit — GPT-5.6 Luna
- Burnout Risk — GPT-5.6 Luna
- Resume Match — GPT-5.6 Terra
- Opportunity Priority — GPT-5.6 Luna
- Ghost Job Risk — Deterministic when no objective posting history exists
- Final Recommendation — Deterministic

The remaining evaluator sequence is:

1. GPT model benchmarking.
2. Final routing lock.
3. One final full evaluator verification.
4. Evaluator baseline freeze.

#### Verification Completed

- A final accepted live mixed-model evaluator run completed successfully during semantic stabilization.
- Resume Match Optimization #2 completed isolated live verification and downstream compatibility checks.
- JD Reconstruction State2 completed accepted live verification.
- Optimization candidates were compared against the last known-good baseline using BETTER / SAME / WORSE quality and cost rules.

#### Known Issues / Blockers

- Evaluator final model benchmarking is not yet complete.
- Final routing is not yet frozen.
- Final full evaluator verification using the eventual routing is still pending.
- The original `$0.10–$0.15` target has not yet been met; the current projected full-evaluator cost is approximately `$0.2026282`.

#### Next Task

Claude should continue main-product work outside evaluator internals.

The first approved product task is:

- opportunity dashboard;
- opportunity list API;
- move manual entry to `/opportunities/new`;
- make Domain a validated/defaulted `customer-success` selection;
- preserve persisted recommendation display and null/Unknown behavior.

#### Do Not Change Without Coordination

Claude should not modify the following merely to complete product UI or workflow tasks:

- evaluator stage semantics;
- evaluator schemas;
- model routing;
- prompt contracts;
- Resume Match compatibility logic;
- JD Reconstruction transport/restoration behavior;
- worker semantic execution behavior;
- recommendation logic;
- evidence/provenance validation;
- optimization baselines.

If a true integration defect is found in one of those areas, stop and document it before changing evaluator internals.

### Handoff: Evaluator Test-Harness Drift Repaired (Test-Only)

**Date:** 2026-10-06  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream (for awareness)  
**Status:** Ready

#### Completed

On `main` (`ebd5911`), 11 integration tests and both E2E evaluation flows failed before any main-product change. The cause was test harnesses that had not followed accepted evaluator contract changes. No production evaluator defect was found, and no production code changed.

1. **Burnout Risk transport (`65dcaab`).** `tests/integration/production-evaluation-flow.test.ts` had a private fake provider that still returned raw Burnout Risk domain output. It now applies `toBurnoutRiskProviderTransport`, as the shared fixture transport already did.
2. **Resume Match compatibility model (`fe8b0d2`).** Four parameterized "required gap" cases in the same file marked requirement 1 as `STRONG_MATCH` / `DIRECT_CUSTOMER_SUCCESS`. In that JD, requirement 1 is a preferred TOOL requirement, and the compatibility model correctly rejects a direct Customer Success work match for a tool. Requirement 1 is now a valid `TRANSFERABLE_MATCH` / `TRANSFERABLE` counterweight. Every assertion is unchanged: the expected Apply/Review/Skip decision and requirement 0's decision impact.
3. **Mixed-routing execution policy (`a307631`).** The E2E worker helper (`tests/support/e2e-evaluation-helper.ts`) ran without an execution policy. The processor therefore rejected the web-queued task with `SEMANTIC_EXECUTION_POLICY_MISMATCH`, which is correct production behavior.
   - The helper now builds its config with the production `semanticExecutorConfigFromEnvironment()`.
   - The Playwright web server and the helper now share one set of deterministic E2E env defaults (`tests/support/e2e-environment.ts`).
   - The fixture transport still replaces the provider, so no provider call is possible.

#### Files Changed

- `tests/integration/production-evaluation-flow.test.ts`
- `tests/support/e2e-evaluation-helper.ts`
- `tests/support/e2e-environment.ts` (new)
- `playwright.config.ts` (env defaults moved to the shared module; values unchanged)

#### Verification Completed

- Integration: 25/25 pass (was 14/25).
- Unit: 603/603 pass.
- E2E: 4/4 pass (both evaluation flows were failing).
- Typecheck and lint pass.
- Deterministic/fake providers only; no paid calls.

#### Known Issues / Blockers

- The shared `createCustomerSuccessFixtureOperations` Resume Match fixture cannot currently emit a valid `STRONG_MATCH` for a TOOL requirement. Strong matches always cite the DIRECT_EXPERIENCE profile reference, while a TOOL strong match needs SKILL or TRANSFERABLE_SKILL evidence. Codex may want to extend the fixture if tool strong matches need integration coverage.
- When evaluator contracts change, also run `pnpm test:integration` and `pnpm test:e2e`. These harnesses have their own fake-provider wiring that unit tests do not exercise.

#### Do Not Change Without Coordination

- Unchanged from the previous handoff. No evaluator internals, schemas, routing, prompts, or validators were modified.

### Handoff: Core Executor Lifecycle Guard — Review Requested

**Date:** 2026-10-06  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream  
**Status:** Verification Needed (Codex review of one Core change)

#### Completed

Task 3 (opportunity lifecycle and user actions) is implemented on `claude/gallant-pasteur-y1ou3i`.

One change touches Core evaluation orchestration and needs Codex review: the Core executor guard in `packages/evaluation/src/executor.ts` (`execute()` and `executeExisting()`).

- **Before:** `subject.opportunity.status !== "NORMALIZED"` threw.
- **After:** `!isNormalizedLifecycleState(status)` throws. The new domain-neutral predicate in `packages/core/src/opportunity.ts` means "normalization has happened", i.e. any state except `DISCOVERED`. The error message is now "Only a normalized Opportunity can be evaluated".
- **Why:** `executeExisting()` runs on every worker pass. With the old guard:
  - any opportunity past `NORMALIZED` could not be reevaluated (worker fails with `EVALUATION_WORKER_FAILED`);
  - a user action during an in-flight evaluation would break that run.

  Product rules about which states may *request* evaluation stay in `apps/web/src/server/evaluation-service.ts`: `ARCHIVED`/`CLOSED` → 409.
- **Unchanged:** Core still never mutates the Opportunity lifecycle, and the existing assertions for that remain. `retryStage()`, stages, routing, prompts, schemas, validators, recommendation logic and evidence/provenance are all unchanged.

#### Files Changed (Core / Codex-relevant)

- `packages/evaluation/src/executor.ts` (two guards)
- `packages/core/src/opportunity.ts` (`isNormalizedLifecycleState`)
- `tests/unit/evaluation-executor.test.ts` (accepts post-normalization states, rejects `DISCOVERED`, in-flight run finishes after a user action, Core leaves status untouched)

#### Product-side Changes Codex Should Know About

- `apps/web/src/server/opportunity-lifecycle-sync.ts` wraps the production processor (`evaluation-worker.ts`). After `process()` resolves, it moves the system lifecycle forward. Sync errors are logged and never fail the task. Claim, lease, retry and processing semantics are unchanged.
- `apps/web/src/server/evaluation-worker-cli.ts` runs `sweepSystemLifecycle()` once at startup.
- `tests/support/e2e-evaluation-helper.ts` uses the same wrapper.
- New additive table `OpportunityUserAction`, migration `20261006210110_opportunity_user_actions`. No evaluator tables changed.

#### Verification Completed

- Unit 665/665, integration 38/38, E2E 9/9; typecheck, lint, build and Prisma validate pass.
- With the original guard restored, 9 new executor unit tests and 4 lifecycle integration tests fail (reevaluation, saved-reevaluation, restore-after-evaluation, in-flight-after-archive). This confirms the dependency.
- Deterministic/fake providers only; no paid calls.

#### Known Issues / Blockers

- **Automatic lifecycle writes are not integration-ready** until Codex reviews the Core guard change above.
- **Pre-existing schema drift (not changed).** `prisma migrate dev` detected that `schema.prisma` declares `Recommendation.evidenceReferences` without the `DEFAULT ARRAY[]::TEXT[]` that migration `20260817210000_production_evaluation_workflow` created. It tried to add `ALTER TABLE "Recommendation" ALTER COLUMN "evidenceReferences" DROP DEFAULT`; I removed that line from the Task 3 migration to keep it additive. Codex should decide whether the schema or the database is canonical.

#### Do Not Change Without Coordination

- Unchanged from previous handoffs.

### Handoff: Foundation Pass — Provenance and Duplicate-Evaluation Guard (Awareness)

**Date:** 2026-10-06  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream (for awareness)  
**Status:** Ready

#### Completed

- `SourceRecord.applicationUrl` was added: additive migration `20261006232000_source_record_application_url` with a null-safe backfill.
  - The pre-existing `Recommendation.evidenceReferences` default drift was again excluded from the migration.
  - Manual capture can now record a source job ID and a reported source.
- **Manual-source identity rule:** manually captured jobs always have `source = "manual-input"` and `sourceType = MANUAL`. The user's "where you found it" lives only in `sourceMetadata.reportedSource` and is informational. Future deduplication, source analytics and source adapters must key on `source`/`sourceType` (and `externalId` for real adapters), never on `reportedSource`.
- **Product-layer guard:** `evaluation-service.requestEvaluation` returns 409 `EVALUATION_ALREADY_ACTIVE` when the opportunity's latest evaluation task is PENDING or RUNNING.

#### Files Changed (Codex-relevant)

- `tests/integration/production-evaluation-flow.test.ts`, test "creates a new historical evaluation instead of overwriting a completed run".
  - It previously enqueued two evaluations back to back while the first was still PENDING, which is exactly the duplicate the new guard refuses.
  - It now asserts the refusal, completes the first task through `tasks.claimNext`/`tasks.complete`, then requests the second.
  - All original history assertions are unchanged.
- No evaluator, queue, worker or evaluator-persistence code changed.

#### Known Issues / Blockers

- **Open boundary item (residual race).** The duplicate-evaluation guard is a check-then-enqueue in the product layer. Two truly concurrent requests for the same opportunity can both pass before either enqueues.
  - A strict fix would belong in the queue/persistence layer: an active-task uniqueness check inside the `PrismaEvaluationTaskRepository.enqueue` transaction, or a partial unique constraint.
  - Not changed here. Low risk for single-user use; the UI also prevents duplicate submits.

#### Do Not Change Without Coordination

- Unchanged from previous handoffs.

### Handoff: Task 5 — Explicit Active Profile Version (Awareness)

**Date:** 2026-10-07  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream (for awareness)  
**Status:** Ready

#### Completed

- Profile and preferences management, with append-only versions and an explicit active version per domain:
  - the `/profile` page;
  - the `/api/profile`, `/api/profile/structured`, `/api/profile/active` and `/api/profile/versions/[id]` routes;
  - the CLI `--activate` flag.
- New additive table `ActiveUserProfile { domain @id, userProfileId → UserProfile (cascade), activatedAt }`, from migration `20261007120000_active_user_profile`. The `Recommendation.evidenceReferences` default drift was again excluded.

#### Files Changed (shared-path awareness)

- `database/src/evaluation-query-repository.ts`: `resolveUserProfile(userProfileId, domain?)`. Resolution is now:
  1. an explicit ID;
  2. `ActiveUserProfile` for the domain;
  3. the previous newest-`updatedAt` fallback, unchanged and used only when nothing was ever activated.

  Called with no domain, it behaves exactly as before.
- `apps/web/src/server/evaluation-service.ts` passes the evaluation domain. Nothing else changed: the resolved version is pinned on the Evaluation at enqueue exactly as before.
- `tests/support/e2e-evaluation-helper.ts`: `create-profile` now also makes its profile active, and `cleanup` restores the previously active version.

#### Current Contract / Assumptions

- `UserProfile` rows are never updated by product code. Saving always appends through `PrismaUserProfileImportRepository.import()`, unchanged.
- The worker, executor, evidence (`user-profile:{id}:v{version}`), domain profile contract and validators are untouched. Validation reuses `validateCustomerSuccessUserProfileData()`.
- The product additionally rejects unknown keys inside nested preference objects (salary, location, travel, workArrangement, roleFamilies), which the domain schema strips rather than rejects. This rejection happens in the product layer only; the domain schema is unchanged.

#### Verification Completed

- typecheck, lint, Prisma validate and build pass.
- Unit 722/722, integration 54/54, E2E 14/14 (deterministic fixtures only, no paid calls).

#### Do Not Change Without Coordination

- Code that pins `userProfileId`/`userProfileVersion` on an Evaluation must keep pinning at enqueue. Historical evaluations must never be rebound to a newer active version.

### Handoff: Task 6 — Budget Ledger, Deferral, and `enqueueAdmitted()` (Review Requested)

**Date:** 2026-10-07  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream (review requested during integration)  
**Status:** Verification Needed (one narrow shared-persistence change)

#### Completed

- A product-level budget ledger, a pre-run budget gate, and a persistent deferred-evaluation backlog with resume and cancel.
- Request-integrity admissions, which close the duplicate-active race recorded in the Foundation Pass handoff.
- Migration `20261007200000_budget_ledger` is additive:
  - tables `EvaluationAdmission`, `BudgetSetting`, `EvaluationBudgetReservation`, `DeferredEvaluation`;
  - enums `BudgetPeriodType`, `DeferredEvaluationStatus`;
  - a check constraint so an admission is never both consumed and abandoned.

  The `Recommendation.evidenceReferences` default drift is again excluded.

#### Files Changed (Codex-relevant)

- **⚠ Shared queue persistence (review requested):** `database/src/evaluation-task-repository.ts`.
  - `enqueue()` was refactored only to share a private `createEvaluationAndTask(tx, input)` helper. Its behaviour is identical: same rows, same `executionMetadata`, same `maxAttempts`/`availableAt`.
  - New `enqueueAdmitted(input & { admissionId })`, used only by the product request path. It creates exactly what `enqueue()` creates and, in the same transaction, conditionally consumes one `EvaluationAdmission`: `UPDATE … SET evaluationId WHERE id = ? AND evaluationId IS NULL AND abandonedAt IS NULL`. If no row matches, it throws `AdmissionNotConsumableError`, so the whole transaction (Evaluation and Task) rolls back.
  - Abandonment is the mirror conditional update. Postgres row locking makes "consumed" and "abandoned" mutually exclusive, so an abandoned admission can never produce an Evaluation.
  - The shared `EvaluationTaskRepository` interface (`packages/evaluation`), `claimNext`, `complete`, `fail`, leases, retries, the worker and the executor are **unchanged**.
- **Product layer:**
  - `apps/web/src/server/evaluation-service.ts` runs the gate (optional `admissionGate` dependency) before enqueue; without a gate (evaluator-level tests) it behaves exactly as before;
  - `apps/web/src/server/budget-service.ts`;
  - `database/src/{evaluation-admission,budget,deferred-evaluation}-repository.ts`.
- **Reads only:** the ledger reads `SemanticOperationAttempt`, `AiModelPricingConfiguration`, `Evaluation` and `EvaluationTask` read-only. Pricing, cost calculation, usage recording and `summarizeSemanticUsage()` are untouched.

#### Current Contract / Assumptions

- Spend is the direct sum of persisted attempt costs in the budget currency. Unknown and other-currency attempts are never treated as $0.
- `executionMetadata` is unchanged; no new keys.
- Deferred requests pin the profile version resolved at request time.

#### Verification Completed

- typecheck, lint, Prisma validate and build pass.
- Unit 754/754, integration 79/79 (run twice), E2E 17/17 (deterministic fixtures, no paid calls).
- The concurrency regression test fails 3 times in 4 with the old check order and passes 30 of 30 with the fix.

#### Known Issues / Boundary Items

- Already-queued tasks are not stopped when the budget is lowered or removed. That would need a pre-claim check in the shared worker; it is deliberately not done.
- Evaluations created outside the product request path (direct `tasks.enqueue`, or the Core executor's `execute()`) have no admission or reservation. Their actual cost is still counted, and the duplicate guard still sees them.
- The reserve is a user-set estimate; actual cost can exceed it (visible in the UI).

#### Do Not Change Without Coordination

- Keep `enqueueAdmitted()`'s consumption in the same transaction as Evaluation/Task creation, and keep the conditional `WHERE` clauses; the no-duplicate guarantee depends on both.

### Handoff: Task 7 — Dashboard Reads Evaluation Result Fields (Awareness)

**Date:** 2026-10-08  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream (for awareness)  
**Status:** Ready

#### Completed

- Dashboard search, filters, sorts, pagination and summaries, all read-only (`database/src/opportunity-list-repository.ts`, `database/src/opportunity-dashboard-repository.ts`).
- Migration `20261008090000_dashboard_indexes` adds Opportunity indexes only. No evaluator tables are touched, and the known `Recommendation` drift is excluded again.

#### Current Contract / Assumptions (read dependency)

- The dashboard reads these persisted Customer Success result paths from the Evaluation linked to the **latest Recommendation row**:
  - `domainResult.opportunityPriority.band`;
  - `domainResult.hardFilters.role.classification`;
  - `domainResult.companyAlignment.alignment.customerSegment.classification`.
- It also reads `Recommendation.decision`, the latest `Evaluation`/`EvaluationTask` status, and open `DeferredEvaluation` rows.
- **If these result field names or enum values change, the dashboard filters and labels need a matching update.** Unit tests assert the dashboard's option lists equal the current Customer Success schema enums, so a rename fails the build.
- Values are never reinterpreted or inferred; a missing value is shown as "Not evaluated"/"Unknown".

#### Carried Forward to Final Integration (unchanged)

- Codex review of the Task 6 `enqueueAdmitted()` shared-persistence change.
- Explicit review and acceptance that already-queued evaluations are not cancelled when the budget is later lowered.

### Handoff: Task 8 — Application Tracker and Guarded Lifecycle Actions (Awareness)

**Date:** 2026-10-09  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream (for awareness; shared lifecycle path changed)  
**Status:** Ready

#### Completed

- An application tracker beside the opportunity lifecycle: one `Application` per Opportunity, an append-only `ApplicationEvent` history, notes, contacts, follow-ups, interviews and outcomes.
- Migration `20261009090000_application_tracker` is additive. No Opportunity, `OpportunityUserAction` or evaluator table is altered, and the known `Recommendation` drift is excluded again.

#### Files Changed (shared lifecycle path)

- `packages/core/src/opportunity-lifecycle.ts`: the RESTORE undo-stack replay is exported as `pendingUserActions(history)`. `restoreTarget` uses it with identical behaviour, and the transition table is unchanged.
- `database/src/opportunity-lifecycle-repository.ts`: `applyUserActionInTransaction(tx, input)` is extracted from `applyUserAction`. The public method delegates with identical rules and the same `OpportunityUserAction` row. Tracker submission uses it to apply MARK_APPLIED in the same transaction as the application change.
- `apps/web/src/server/opportunity-action-service.ts`: product lifecycle actions now run through `PrismaApplicationRepository.applyLifecycleActionGuarded`. Under an Opportunity row lock it refuses (409 `APPLICATION_BLOCKS_ACTION`):
  - MARK_APPLIED while the application is unsubmitted;
  - RESTORE from Applied while a submitted application exists;
  - DISMISS while an application is active.

  Otherwise it applies the action exactly as before.
- **Dashboard (additive reads):** `opportunity-list-repository.ts` and `opportunity-dashboard-repository.ts` left-join the application tables. No existing filter changed.

#### Current Contract / Assumptions

- Evaluations, the worker's lifecycle sync, budget deferral and profile hints never read or write application tables, and the reverse holds too. Integration tests prove application rows stay identical across a reevaluation and a budget deferral.
- The worker's `syncSystemLifecycle` only touches system states, so it cannot conflict with the guard. The guard covers user actions only.
- The unguarded `PrismaOpportunityLifecycleRepository.applyUserAction` still exists, for tests and internal callers. Product requests use the guarded path.

#### Carried Forward to Final Integration (unchanged)

- Codex review of the Task 6 `enqueueAdmitted()` shared-persistence change.
- Explicit review and acceptance that already-queued evaluations are not cancelled when the budget is later lowered.
- The Task 7 dashboard reads `opportunityPriority.band`, role classification and customer segment from the persisted Customer Success result. If those field names change, dashboard queries must be updated.

#### Do Not Change Without Coordination

- Keep lifecycle user actions on the guarded path (Opportunity row lock, then guard, then `applyUserActionInTransaction`). Bypassing it could leave a planned application under an Applied lifecycle.

### Handoff: Task 9 — Operations Hardening and Final Integration Checklist (Review Requested)

**Date:** 2026-10-10  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream (review requested at the final integration checkpoint)  
**Status:** Verification Needed (narrow shared-persistence additions)

#### Completed

- Setup and operations tooling: `pnpm app:setup`, `pnpm db:migrate`, `pnpm db:status`, `pnpm db:verify-migrations`, and the read-only `pnpm app:doctor`.
- A database-checking `/api/health`.
- A worker hardened with a single-worker lock, idle-only recovery, classified errors and graceful shutdown.
- Honest queue states and safe public error output.
- Navigation and coherence fixes.
- Whole-product acceptance tests (integration and E2E).
- No evaluator semantics, stages, routing, prompts, recommendation logic, evidence/provenance contracts, pricing or usage recording changed.

#### Files Changed (Codex-relevant)

- **⚠ `database/src/evaluation-task-repository.ts` (additive; review requested):**
  - `failExpiredExhaustedTasks(now)` fails tasks that are `RUNNING`, have `leaseExpiresAt < now`, and have `attempt >= maxAttempts`. These are tasks `claimNext` can never pick up again. It also fails their running stages (`WORKER_INTERRUPTED`) and their evaluation, with code `EVALUATION_LEASE_EXPIRED`. It is called only by the product worker while it holds the single-worker lock and has no task in flight.
  - `readQueueSnapshot` / `queueSnapshot` are read-only counts.
  - `claimNext`, `complete`, `fail`, `enqueue` and `enqueueAdmitted` are unchanged.
- **⚠ `database/src/evaluation-worker-lock.ts` (new):**
  - a session-level advisory lock (`pg_try_advisory_lock(41220, 1)`) on a dedicated `pg` connection, held for the worker's lifetime;
  - `isEvaluationWorkerConnected` reads `pg_locks` only.
- **⚠ `database/src/client.ts`:** one Prisma client per process in every environment. Previously the client was cached only outside production, so `next start` opened a pool per repository.
- **Product worker:**
  - `apps/web/src/server/evaluation-worker-cli.ts`, `worker-loop.ts`, `worker-errors.ts`;
  - `createEvaluationWorker`/`runOnce` (`packages/evaluation`) is unchanged.
- **Public evaluation API (`evaluation-service.ts`):**
  - no longer returns `task.errorMessage`, stage `errorMessage`, operation `errorMessage`/`providerRequestId`, or `error`;
  - adds `queueState`;
  - resolves AI configuration lazily, only to request or resume.
  - Persisted data is unchanged.

#### Current Contract / Assumptions

- **Run exactly one worker** (now enforced).
- Leases are 300 s with no renewal, while a full evaluation can take longer (16 calls × 120 s). An expired lease is shown as `RUNNING_STALE`, "may still be in progress, or the worker may have stopped". It is never reported as a stopped worker.
- With one worker, `claimNext`'s existing reclaim of expired leases cannot take a live run.

#### Documented, Not Fixed (queue/evaluator design — for Codex)

- Lease renewal (heartbeat) and claim ownership in `complete`/`fail` are missing. Required before running more than one worker.
- `Evaluation.status` can stay PENDING/RUNNING when a task fails before `finalize` (for example a policy mismatch). Product reads use the task status.
- Task-level retries are effectively unused: every worker error is non-retryable, and `maxAttempts` only bounds lease reclaims.

#### Final Integration Checklist (all carried forward unchanged)

1. Codex review of the Task 6 `enqueueAdmitted()` shared-persistence change (narrow; `enqueue()` behaviour-identical; no evaluator-semantic change).
2. Explicit review and acceptance that already-queued evaluations are not cancelled when the budget is later lowered (no worker-side cancellation added).
3. Task 7 dashboard read dependency on `opportunityPriority.band`, `hardFilters.role.classification` and `companyAlignment.alignment.customerSegment.classification` from the persisted Customer Success result.
4. Task 8 guarded lifecycle path (`applyUserActionInTransaction`, `pendingUserActions`, `applyLifecycleActionGuarded`).
5. Core executor lifecycle guard review (earlier handoff).
6. The `Recommendation.evidenceReferences` default drift decision. `pnpm db:verify-migrations` confirms it is the only schema/migration difference.
7. Task 9 additions above (`failExpiredExhaustedTasks`, the worker lock, the Prisma singleton, the public API shape).
8. Whole-product acceptance after merging: `pnpm db:verify-migrations`, unit, integration (includes `product-acceptance.test.ts`), build, and full E2E (includes the `acceptance` project).

#### Before Scraper Work

- See README "Ingestion boundary".
- Every source must converge on adapter → `RawOpportunity` → `SourceRecord` → per-source normalizer → `Opportunity` + `FieldProvenance`.
- Manual-only points to generalize:
  - the normalizer;
  - company matching;
  - a unique `(source, externalId)`;
  - re-observation;
  - the evaluator reading the oldest `SourceRecord`;
  - the unused `DuplicateReference`, discovery and deduplication packages.

## Notes

Update this file whenever work is explicitly transferred between Codex and Claude, especially when ownership crosses between evaluator internals, main-product UI/workflow, shared persistence, lifecycle/status handling, profile/preferences contracts, or retrieval/scraping integrations.
