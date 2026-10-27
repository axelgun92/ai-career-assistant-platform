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

### Handoff: Task 6 Completion — AI Budget, Throughput, Capacity and Backlog (Awareness)

**Date:** 2026-10-15  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream (awareness; one shared-boundary note)  
**Status:** Completed (product-owned)

#### Completed

- Warning thresholds, daily and weekly evaluation-volume limits, a monthly output-token cap, and a user-lowerable per-evaluation AI call allowance.
- All are enforced at admission as operational deferrals (`USAGE_LIMIT_REACHED`, or `AI_BUDGET_LIMIT` when the monetary budget is also reached).
- `GET /api/budget/report` and the `/budget` "AI usage and capacity" section.
- Details in `CURRENT_PROGRESS.md`.

#### Shared-Boundary Note

- **Call allowance at enqueue:** the per-evaluation call allowance is written by the product into the existing `executionMetadata.semanticCallBudget` at enqueue, as `min(AI_CALL_BUDGET, user allowance)`.
  - The allowance is bounded below by `customerSuccessSemanticOperationIds.length`, read from the domain package and not changed.
  - The processor already honours the persisted value.
  - No evaluator code changed. If Codex changes the number of semantic operations, the lower bound follows automatically.
- **Output-token limit:** a monthly cap on provider-reported output tokens that gates new admissions. Per-operation `maximumOutputTokens` (routing) is untouched.

#### Contract Questions

1. Already-queued evaluations are not cancelled when the budget or a limit is lowered or reached. Unchanged; still awaiting explicit acceptance (final integration checklist item 2).
2. **Resolved (2026-10-14 naming cleanup): deferral reason name.**
   - The monthly dollar budget now defers with the TDD name `AI_BUDGET_LIMIT`; non-dollar limits keep `USAGE_LIMIT_REACHED`.
   - **Compatibility:** read-time only. `PrismaDeferredEvaluationRepository` maps a stored legacy `BUDGET_UNAVAILABLE` to `AI_BUDGET_LIMIT` (`normalizeDeferralReason` in `packages/core/src/budget.ts`). There is no migration or rewrite, and a legacy row is updated only by a normal resume recheck.
   - Product-owned only; no evaluator code changed.
3. **Resolved (2026-10-14 naming cleanup): eligibility wording.**
   - Product wording is neutral: "eligible for evaluation" (a normalized, active opportunity in a domain the evaluator supports).
   - There is no per-model eligibility concept.
4. Source Analytics must exclude budget and limit deferrals when Source Analytics is built. Nothing records a deferral as a negative outcome today.

### Handoff: Profile Limitations Persistence Boundary (Review Requested)

**Date:** 2026-10-14  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream  
**Status:** Verification Needed (shared persistence; post-integration acceptance pending)

#### Completed

- Product-owned persistence and delivery for structured profile `limitations`, so the accepted Resume Match contract (Genuine Gap requires a `PROFILE_LIMITATION` record) works on persisted production profiles, not only on the in-memory bundled profile.
- No evaluator-owned schema, enum, prompt, Resume Match logic or bundled-profile content was ported, copied or changed. The installed strict profile contract was not loosened.

#### Files Changed (Codex-relevant)

- **⚠ `database/prisma/schema.prisma` and migration `20261014090000_user_profile_limitations`:** new nullable `UserProfile.limitations` JSONB. Existing rows stay NULL.
- **⚠ `database/src/evaluation-repository.ts` `loadSubject()`:** adds `userProfile.data.limitations` only when the pinned version stores them. A version without limitations is delivered byte-for-byte as before, which keeps the currently installed strict schema valid.
- **`database/src/user-profile-import-repository.ts`:**
  - `VersionedUserProfileData.limitations` is optional.
  - Hash and create use the version content with a null or absent `limitations` omitted, so pre-existing identities are unchanged.
  - Your branch's import path (`{ ...data, version, contentHash }`) will persist the migrated bundled profile once both are merged. Before this change it would have failed with an unknown Prisma field.
- **`database/src/user-profile-repository.ts`:** `getVersion().document.limitations` is present only when stored.

#### Current Contract / Assumptions

- The product treats limitations as opaque JSON. Its structure is decided only by `customerSuccessUserProfileDataSchema` / `validateCustomerSuccessUserProfileData`, so both the web save path and the import CLI validate with the domain contract before persisting.
- Profile rows stay immutable and versions append-only. Evaluations and deferrals keep their pinned version; nothing is reassigned to a newer version.

#### Post-Integration Acceptance (required once the evaluator branch is merged)

Run these against an isolated test database for the automated checks, and as operator steps on the real installation. No paid calls except the explicitly authorized acceptance run.

1. **Policy version:**
   - Confirm the merged `packages/shared` `customerSuccessProductionSemanticPolicyVersion` is the evaluator's final version (Codex-owned; the product branch no longer pins one).
   - Remove any `AI_EXECUTION_POLICY_VERSION` line from the real `.env`.
   - `pnpm app:doctor` must show "Evaluation policy version" with PASS and that version.
   - Restart the web app and worker together. Evaluations queued under the old policy fail closed with `SEMANTIC_EXECUTION_POLICY_MISMATCH`; request them again.
2. **Migrated profile import:**
   - `pnpm profile:import:customer-success` must create a new version from the migrated bundled profile (old versions unchanged).
   - Read it back: `document.limitations` must equal the bundled limitations.
   - Repeat for "Create from the starting profile" on an empty isolated database.
3. **Profile activation:**
   - `pnpm profile:import:customer-success --activate`, or activate on the Profile page.
   - `pnpm app:doctor` must show the new version as active and "it stores structured limitations".
4. **Old deferrals:**
   - If `pnpm app:doctor` reports deferrals pinned to another profile version, review them on `/budget`. Resume keeps the pinned version; **Cancel request** then **Evaluate** uses the active one.
   - Never update deferral or evaluation rows in place.
5. **Limitations and Genuine Gap acceptance tests:**
   - the JSON editor accepts valid and rejects invalid limitations per `profileLimitationSchema`;
   - `tests/integration/profile-limitations.test.ts` passes unchanged;
   - a deterministic (fixture-transport) evaluation of a persisted profile with a limitation produces a Genuine Gap only where the limitation's category and level cover the requirement, and Unknown without it;
   - then the authorized live acceptance run on the activated migrated profile.

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
7. Task 9 additions in this handoff (`failExpiredExhaustedTasks`, the worker lock, the Prisma singleton, the public API shape).
8. Profile limitations persistence boundary (`loadSubject()` and `UserProfile.limitations`; handoff above) and its post-integration acceptance tests.
9. Task 7: the evaluator subject withholds the newly normalized salary, position and residency fields (`fieldsWithheldFromEvaluator` in `loadSubject()`). Milestone 4 adopts them per the "Final Data Contract" in the Task 7 handoff below; migration `20261016090000_opportunity_residency_requirement` is part of the merge. *(October 25, 2026: `compensationBasis` is released with them, and the evaluator's temporary compensation-basis compatibility read is replaced by the native Core field; see "Milestone 4 compensation-basis correction → final-integration contract" at the end of this file. Migration `20261025090000_work_authorization_and_compensation_basis` is also part of the merge.)*
10. Whole-product acceptance after merging: `pnpm db:verify-migrations`, unit, integration (includes `product-acceptance.test.ts`), build, and full E2E (includes the `acceptance` project).

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

### Handoff: Task 7 Completion — Normalized Opportunity Fields and the Milestone 4 Data Contract (Review Requested)

**Date:** 2026-10-14  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream  
**Status:** Verification Needed (shared persistence; evaluator inputs deliberately unchanged)

#### Completed

- Product normalization now populates explicit facts on `Opportunity`:
  - `salaryMin`, `salaryMax`, `currency`;
  - `remoteStatus`, `seniority`, `department`, `employmentType`, `closingDate`.
- Every populated value has a `FieldProvenance` row. The original text, the `SourceRecord` and the raw payload are unchanged.
- Explicit residency / geographic eligibility is now normalized: `residencyRequirement` and `residencyRegions`. Migration `20261016090000_opportunity_residency_requirement` is additive; existing rows read as Unknown and nothing is backfilled.
- Dashboard filters and sorts use these fields. Details are in `CURRENT_PROGRESS.md` ("Task 7 completion amendment").

#### Final Data Contract for Codex Milestone 4 (salary eligibility)

Task 7 stores facts only. It makes no Pass / Review / Skip decision, no FX conversion and no cost-of-living judgement; those belong to Milestone 4.

| Fact | Column | Values | Unknown |
|---|---|---|---|
| Salary bounds | `salaryMin`, `salaryMax` (Decimal) | Stated annual amounts, in the stated currency. Open-ended ranges set one bound. | null (also for hourly/monthly pay, OTE, ambiguous figures) |

*(Superseded October 25, 2026 for OTE: a stated OTE range now keeps its bounds, with `compensationBasis` = OTE; see the shared-normalization convergence record at the end of this file. The table above is preserved as written.)*

| Currency | `currency` | ISO 4217 code. Explicit code or symbol, a user selection, or a bare "$" read as USD. | null (conflicting or ambiguous) |
| Original compensation text | `salaryText` (+ `SourceRecord.rawSalaryText`) | Verbatim | null |
| Location | `location` (+ `SourceRecord.rawLocation`) | Verbatim free text | null |
| Work arrangement | `remoteStatus` | `REMOTE` / `HYBRID` / `ONSITE` | null |
| Residency requirement | `residencyRequirement` | `US_REQUIRED`: residence restricted entirely to U.S. geography (the country, states, DC, Puerto Rico). `NON_US`: residence outside the U.S. explicitly permitted or required (e.g. "must be based in Spain", "EU residents only", "open to residents of Ontario", "US or Canada", "anywhere in the world") | null |
| Eligible residence | `residencyRegions` (text[]) | Stated geographies: ISO 3166-1 alpha-2 countries; ISO 3166-2 subdivisions (`US-TX`, `US-DC`, `US-PR`, `CA-ON`, `GB-SCT`); or `WORLDWIDE`, `EU`, `EEA`, `EUROPE`, `EMEA`, `LATAM`, `APAC`, `NORTH_AMERICA`, `AMERICAS` | `[]` |

- **Policy keys on residency, never on currency.** A USD salary does not imply a U.S. job, and "Remote" does not imply U.S.-remote.
- **Residency sources, in precedence order:**
  1. The user's stated choice (`FieldProvenance` kind `DIRECT`, `sourceField` `residencyRequirement`; the region list is `DETERMINISTIC` from `residencyRegions`).
  2. Explicit statements only, each recorded with kind `DETERMINISTIC` and a marker:
     - `rawText:explicit-residency-statement` for job-text sentences such as "must reside/live/be based/be located in X", "open to candidates in X", "X only", "X residents only", "anywhere in the world";
     - `location:explicit-eligible-geography` for location fields such as "Remote - X", "Remote (X)", "X Remote", "Remote - Worldwide".
  - One pair of provenance rows is written per contributing statement, with `sourceText` set to the exact sentence or field.
- **Stays Unknown:**
  - currency, company headquarters, nationality or citizenship, work authorization, and time zones;
  - a bare "Remote", or an ordinary location field ("Chicago, IL", "Toronto, ON", "Berlin, Germany");
  - cities ("New York City");
  - ambiguous names (Georgia, a bare Washington, CA) and lists with an unreadable item;
  - preferred, negated or qualified wording, and conflicting statements.
- **Geographic levels:** state- or province-level eligibility is preserved in `residencyRegions` (for example `["US-TX", "US-FL"]`), so Milestone 4 can see the stated area. Classification only distinguishes U.S. from non-U.S.
- **Mapping to the supplied policy (for Milestone 4 to implement, not done here):**
  - `US_REQUIRED` → the U.S. policy: $60k+ Pass, below $60k Skip.
  - `NON_US` → the non-U.S. policy, where `residencyRegions` names the geography for cost viability.
  - null → residency Unknown; the policy says Unknown stays Unknown.
  - FX for "USD equivalent" must be supplied by Milestone 4; Task 7 stores no converted amounts.

#### Hand-over steps for Milestone 4

- Remove fields from `fieldsWithheldFromEvaluator` (`database/src/evaluation-repository.ts`) once the evaluator handles them. The salary fields need currency-aware hard filters first.
- `NormalizedOpportunity` already carries `residencyRequirement` and `residencyRegions`. They default to null / `[]`, so existing producers and fixtures stay valid.
- Until adoption, the subject receives null / `[]` for them and no residency provenance rows. An integration test asserts this.

#### ⚠ Evaluator boundary: inputs withheld, not changed

- **Why:** the Customer Success extractor (`explicit-facts.ts`) prefers `opportunity.salaryMin` / `salaryMax` / `currency` over its own parsing. The salary hard filter does not compare currencies. Delivering, for example, a parsed "€60,000" would silently change hard-filter results and recommendations.
- **What:** `PrismaEvaluationRepository.loadSubject()` sets `fieldsWithheldFromEvaluator` to their pre-amendment empty values (null, or `[]` for `residencyRegions`) in the subject and drops their provenance rows:
  - `salaryMin`, `salaryMax`, `currency`;
  - `remoteStatus`, `seniority`, `department`, `employmentType`, `closingDate`;
  - `residencyRequirement`, `residencyRegions`.
- **Effect:**
  - The evaluator receives exactly what it received before this amendment, because these fields were always null.
  - `salaryText`, `location`, `jobDescription`, `postingDate` and all other inputs are unchanged.
  - An integration test asserts the withholding.
- **The evaluator ignores the new raw-payload keys:** the manual raw payload gains `workArrangement`, `seniority`, `employmentType`, `department`, `closingDate`, `compensationCurrency`, `residencyRequirement` and `residencyRegions`. The only evaluator reader of `rawPayload` is `ghost-job-risk.ts`, which reads `postingHistory` only.
- **Decision for Codex:** whether and how the evaluator adopts these fields. Adopting the salary fields would at least need currency-aware salary hard filters. To adopt, remove a field from the list.

#### Ingestion contract notes

- `RawOpportunity` is unchanged.
  - Manual stated details travel in `sourceMetadata.details` (`manualStatedDetailsSchema` in core).
  - Employment type uses the existing `RawOpportunity.employmentType`.
- Future source normalizers can reuse the parsers in `packages/normalization`: `parseCompensation`, `workArrangementFromLocation`, `seniorityFromTitle`, `standardizeEmploymentType` and `parseResidency`.
- The domain-neutral geography vocabulary is in `packages/core/src/geography.ts`.
- The vocabularies are product-owned constants in `packages/core/src/opportunity.ts`. The shared `normalizedOpportunitySchema` was not narrowed.

#### Contract Questions (not blocking)

1. **Decided (user, 2026-10-14):** a bare "$" is read as USD.
   - It is recorded as derived: `FieldProvenance` kind `DETERMINISTIC`, `sourceField` `compensationText:bare-dollar-as-usd`. These rows can be found and revisited.
   - An explicit currency (US$/USD, CA$/CAD, A$/AUD, €, £…) always takes precedence. The rule never overrides an explicit non-USD currency; a contradiction stays Unknown.
   - This matches the evaluator's own `currency ?? "USD"` default.
2. Salary range filters use overlap semantics. A range matches when it can reach the amount, and open-ended ranges match on their open side.
3. A user-stated work arrangement or seniority takes precedence over the value read from location or title.
   - A stated currency that conflicts with an explicit currency in the compensation text leaves the currency Unknown.

## Notes

Update this file whenever work is explicitly transferred between Codex and Claude, especially when ownership crosses between evaluator internals, main-product UI/workflow, shared persistence, lifecycle/status handling, profile/preferences contracts, or retrieval/scraping integrations.

---

## Current-State Addendum — October 15, 2026

Older handoffs above remain historical records. When a current-state statement below conflicts with an older handoff, use the newer handoff for active work and preserve the older entry as history.

### Handoff: Task 7 normalized facts → Customer Success Milestone 4

**Date:** 2026-10-15  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream  
**Status:** Consumed / Completed

#### Completed

- Task 7 completed deterministic normalization, persistence, provenance, dashboard filtering/sorting, and compatibility handling for salary/currency and residency facts.
- Final Task 7 commit: `754f956dc0860149760936a61bdace0489404b9a` on `claude/gallant-pasteur-y1ou3i`.
- The normalized evaluator-facing contract established:
  - `salaryMin: number | null`
  - `salaryMax: number | null`
  - `currency: string | null`
  - `residencyRequirement: "US_REQUIRED" | "NON_US" | null`
  - `residencyRegions: string[]`
  - original salary/location text and provenance remain preserved.
- Salary amounts remain as stated; they are not annualized or FX-converted in persistence.
- Residency is derived only from explicit where-you-may-live eligibility/restriction evidence, never from salary currency, company HQ, nationality, work authorization, time zone, or ordinary city/location text.

#### Current Contract / Assumptions

- Empty or ambiguous residency remains Unknown.
- `US_REQUIRED` means all supported stated residency geography is U.S. geography.
- `NON_US` means residence outside the U.S. is explicitly allowed or required; mixed U.S. + non-U.S. eligibility is `NON_US`.
- Open salary ranges preserve the stated bound. A single disclosed figure may populate both bounds.
- Non-annual compensation, OTE, conflicting currencies, unsupported currency symbols, or other ambiguous compensation remains Unknown. *(October 25, 2026: OTE no longer makes the bounds Unknown in Core; the salary policy must read `compensationBasis`.)*
- Explicit structured residency fields take precedence over deterministic parsing.
- Older opportunities are not backfilled and therefore retain Unknown for newly introduced facts.

#### Verification Completed

- Final Task 7 verification passed typecheck, lint, Prisma validation, 1036 unit tests, 176 integration tests, 25 E2E tests, and build on the isolated test database.
- No paid provider calls were made and the normal application database was not used.

#### Next Task

- Milestone 4 was required to adopt the salary/currency/residency facts only after its deterministic salary policy became currency- and residency-aware.

#### Do Not Change Without Coordination

- Do not infer residency from currency or general location.
- Do not persist converted salary values.
- Do not move Customer Success salary thresholds into Core/normalization.
- Core owns factual normalization; the Customer Success domain owns salary decision policy.

### Handoff: Milestone 4 Task 7 salary-policy alignment → Claude Task 8

**Date:** 2026-10-15  
**From:** Codex evaluator workstream  
**To:** Claude main-product workstream  
**Status:** Ready

#### Completed

- Customer Success Milestone 4 now consumes the Task 7 salary/currency/residency contract.
- Commit `267124f` (`fix(cs): align Milestone 4 salary policy with Task 7`) is pushed to `origin/codex/evaluator-live-diagnostic`.
- U.S.-residency-required roles use a hard `$60,000 USD-equivalent` minimum with no Review band and no maximum.
- Non-U.S.-eligible roles use the accepted `$60k+` Pass, `$55k–$59,999.99` Review, `$50k–$54,999.99` conditional Review/Unknown, and `<$50k` Fail/Skip policy.
- Residency requirement chooses the policy. Currency never chooses the residency policy.
- Versioned FX policy: `cs-salary-policy-v2-ecb-2026-10-14`.
- Released to evaluator with provenance: `salaryMin`, `salaryMax`, `currency`, `residencyRequirement`, `residencyRegions`.
- Still withheld from evaluator: `remoteStatus`, `seniority`, `department`, `employmentType`, `closingDate`.
- Current evaluator identifiers for this correction: evaluation `cs-evaluation-v1.2-m9`; domain `customer-success-v1.2`; rules `cs-rules-v1.2`; Hard Filters `cs-hard-filters-v2`.

#### Current Contract / Assumptions

- A disclosed minimum is the salary gate.
- A max-only disclosure stays Unknown unless even the maximum is below the applicable floor.
- Missing/unsupported currency remains Unknown; raw foreign-currency amounts are never compared directly to USD thresholds.
- The `$50k–$54,999.99` non-U.S. band becomes Review only when explicit supported geography matches configured viable cost context; insufficient context remains Unknown.
- No regional cost stereotypes or invented mappings are permitted.
- Customer Success owns salary thresholds, affordability policy, and eligibility decisions. Core remains domain-neutral.
- Final routing policy is locked as:
  - deterministic — Hard Filters; Ghost Job Risk when posting history is unavailable; Final Recommendation;
  - GPT-5.6 Terra — JD Reconstruction, Resume Match;
  - GPT-5.6 Luna — Job Evaluation, Organizational Maturity, Alex Fit, Opportunity Priority;
  - GPT-6 Luna — Company Alignment, Burnout Risk.

#### Verification Completed

- Milestone 4 correction passed 24 focused offline tests, workspace typecheck, changed-file ESLint, Prisma client generation/schema validation, and `git diff --check`.
- No provider calls, normal-database connections/writes, migrations, or paid acceptance runs were performed during the correction.

#### Known Issues / Blockers

- DB-backed integration, migrations against a database, full evaluator/whole-product tests, web build, E2E, live provider calls, and final Task 7→evaluator acceptance were intentionally deferred.
- Those checks belong to the final whole-product integration/acceptance pass after all intended main-product work is complete.

#### Next Task

- Claude Task 8 — Application Tracker completion pass on `claude/gallant-pasteur-y1ou3i`.
- Audit the existing Task 8 implementation first; add only missing/incomplete requirements rather than redesigning working application-tracker code.
- Task 9 completion pass follows Task 8, then any genuinely missing main-product features through feature 18.

#### Do Not Change Without Coordination

- Do not redesign evaluator stages, schemas, semantic contracts, prompts, routing, salary-policy semantics, evidence behavior, or recommendation logic merely to complete Task 8.
- Do not move Customer Success salary thresholds into Core/shared normalization.
- Do not run paid provider calls or use the normal application database for Task 8 testing.
- Final evaluator/product integration, whole-product acceptance, evaluator freeze, and main merge occur only after all intended main-product work is complete.

### Current-State Annotations — October 15, 2026 (Claude main-product workstream)

**Date:** 2026-10-15  
**From:** Claude main-product workstream  
**To:** Codex evaluator workstream / final integration  
**Status:** Ready (annotations only; the historical entries above are preserved verbatim)

These annotations record current state against the preserved historical entries without editing them.

#### Branch state of the Milestone 4 release

- The Milestone 4 field release, the GPT-6 Luna routing for Company Alignment and Burnout Risk, and the version identifiers `cs-evaluation-v1.2-m9`, `customer-success-v1.2`, `cs-rules-v1.2` and `cs-hard-filters-v2` exist on `codex/evaluator-live-diagnostic` (`267124f`). They are not merged into `claude/gallant-pasteur-y1ou3i`.
- On `claude/gallant-pasteur-y1ou3i`, `fieldsWithheldFromEvaluator` in `database/src/evaluation-repository.ts` still withholds all ten Task 7 fields:
  - `salaryMin`, `salaryMax`, `currency`;
  - `remoteStatus`, `seniority`, `department`, `employmentType`, `closingDate`;
  - `residencyRequirement`, `residencyRegions`.
- The Claude branch also still runs the earlier routing and version identifiers until the branches are combined.

#### Final Integration Checklist (historical, above) — current status

- **Item 2 (already-queued evaluations are not cancelled when the budget is lowered) has since been accepted** as a product decision. Recorded in the October 15 CHANGELOG, CURRENT_PROGRESS and PRODUCT_STATUS. The historical checklist text is left unchanged.
- Every other item remains open as written.

#### Additional final-integration requirements

1. When the branches are combined, remove the five Codex-released fields from `fieldsWithheldFromEvaluator`:
   - `salaryMin`, `salaryMax`, `currency`, `residencyRequirement`, `residencyRegions`.
   - Update the tests that assert withholding:
     - `tests/integration/normalized-opportunity-filters.test.ts` ("delivers the evaluator exactly the pre-amendment subject…");
     - `tests/integration/opportunity-residency.test.ts` ("withholds residency from the evaluator subject…").
   - Keep `remoteStatus`, `seniority`, `department`, `employmentType` and `closingDate` withheld until a separately coordinated adoption.
2. Whenever evaluator contracts change, re-run the full DB-backed integration and E2E suites, as well as unit tests, on the isolated test database. The historical "Evaluator Test-Harness Drift Repaired" handoff above records the same lesson.

3. **Carry the evaluator branch's progress records into the canonical documentation.**
   - The Codex branches keep their evaluator progress in a root-level `Md and README Docs/CURRENT_PROGRESS.md`. That path differs from this repository's `AI Job Assistant Project/Md and README Docs/CURRENT_PROGRESS.md`, and those branches predate the `AI Job Assistant Project/` documentation folder.
   - The file's October 10–15 records are:
     - Organizational Maturity mixed-state stabilization;
     - Resume Match evidence-partition stabilization;
     - Provider-prose semantic closure;
     - Structured requirement specialization and real-artifact replay;
     - JD Reconstruction specialization category binding;
     - Requirement-relative evidence relevance;
     - Statement groups, reconciliation and requirement-relative INDUSTRY;
     - Milestone 4 salary-policy contract update.
   - At branch combination, merge these records into the canonical `CURRENT_PROGRESS.md` and `EVALUATOR_STATUS.md` (§19 already lists them).
   - Neither file's records may be dropped or silently overwritten.

#### Documentation preservation notes (October 15, 2026)

- **PRD/TDD archive:**
  - The complete formal PRD/TDD history (23 versions, plus the new Core AI Framework PRD v1.4) is in git.
  - Superseded versions are frozen in `AI Job Assistant Project/Product Recommendation Documents/Archive/` and `AI Job Assistant Project/Technical Design Documents/Archive/`.
  - The current authoritative versions are listed in the `AGENTS.md` "Documentation Locations" table: Core AI Framework PRD v1.4, Core Platform TDD v1.5, Customer Success PRD v1.3, Customer Success TDD v1.3, and Semantic Evaluation Playbook v1.2 (v1.1 kept beside it).
- **Task 6 contract questions, original wording.** The historical Task 6 handoff above shows Contract Questions 2 and 3 only in their resolved form; the 2026-10-14 naming cleanup replaced the question text in place. The original wording, as committed in `267138a` under "Contract Questions (unresolved, not blocking)", is preserved here alongside the resolutions:
  - Question 2 (original):
    > The TDD names the deferral reason `AI_BUDGET_LIMIT`; the product persists `BUDGET_UNAVAILABLE` (Task 6) and now `USAGE_LIMIT_REACHED`. Decide whether to rename or update the TDD.
    - Resolution: the dollar budget defers with `AI_BUDGET_LIMIT`; legacy `BUDGET_UNAVAILABLE` rows are mapped at read time.
  - Question 3 (original):
    > "Terra-eligible under the active model configuration" is reported as eligible for evaluation in an executable domain; there is no per-model eligibility concept.
    - Resolution: neutral "eligible for evaluation" wording, adopted in Core Platform TDD v1.5 and Core AI Framework PRD v1.4.

### Current-State Annotations — October 16, 2026 (Claude main-product workstream)

**Date:** 2026-10-16\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Ready (annotations only; every entry above is preserved verbatim)

#### Closure: "Milestone 4 Task 7 salary-policy alignment → Claude Task 8"

- Consumed. Its "Next Task", the Task 8 Application Tracker completion pass, was completed and committed as `534a4c7` (`feat: complete application tracker`) on `claude/gallant-pasteur-y1ou3i` on October 16, 2026.
- Its "Do Not Change Without Coordination" constraints were honored: no change to evaluator stages, schemas, semantic contracts, prompts, routing, salary policy, evidence behavior or recommendation logic; no paid calls; no normal-database use.
- The entry's own "Status: Ready" line is left as written.

#### Task 8 completion pass and the shared boundary

- The Task 8 guarded lifecycle path is unchanged (Final Integration Checklist item 4 stays open as written): `pendingUserActions`, `applyUserActionInTransaction`, `applyLifecycleActionGuarded`.
- The pass added one additive product migration, `20261017090000_application_follow_up_updated` (`ALTER TYPE "ApplicationEventType" ADD VALUE 'FOLLOW_UP_UPDATED'`). It contains no `Recommendation.evidenceReferences` change.

#### Task 9 completion pass (in progress)

- Status: implementation and isolated verification are complete; the documentation synchronization is under review; not yet committed.
- All changes are product-only. There is no migration and no change to `claimNext`, `failExpiredExhaustedTasks`, `complete`, `fail`, `enqueue`, `enqueueAdmitted`, the worker lock, leases or evaluator code.
- **Clarification for checklist item 7 (Task 9 additions)**, stated for the Codex review. The Task 9 handoff above says recovery runs only while the worker holds the single-worker lock and is idle, so it never touches a live run. That holds only while the lock's dedicated database connection stays up.
  - If that connection drops during a run and a second worker starts, the second worker can take the lock.
  - Its recovery can then fail a still-running task whose lease expired on its final attempt.
  - This is the documented lack of lease renewal and claim ownership ("Documented, Not Fixed").
  - The root `README.md` now states it, together with the one-worker rule. No code change is made before final integration.

#### Final integration gates (unchanged)

The historical checklist (with item 2 accepted) and the October 15 additional requirements stay open as written. The evaluator-branch contract history, residual risks and outstanding verification are recorded in `EVALUATOR_STATUS.md` §20. That includes the current-contract cost, which is still unmeasured.

When that branch's progress records are carried into the canonical documents (October 15 requirement 3), note that its own routing table still shows GPT-5.6 Luna for Company Alignment and Burnout Risk; it predates the routing lock.

### Closure Annotation — October 16, 2026: Task 9 completion pass (Claude main-product workstream)

**Date:** 2026-10-16\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Closed (annotation only; every entry above, including the "Task 9 completion pass (in progress)" annotation, is preserved as written)

- The Task 9 completion pass recorded above as in progress was reviewed and approved by the user, then committed as `feat: complete operational hardening` on `claude/gallant-pasteur-y1ou3i` and pushed to `origin`. `main` was not merged.
- Its scope is unchanged from the annotation above: product-only changes, no migration, and no change to `claimNext`, `failExpiredExhaustedTasks`, `complete`, `fail`, `enqueue`, `enqueueAdmitted`, the worker lock, leases or evaluator code.
- The checklist item 7 clarification (the single-worker lock's connection-loss caveat) stays open for the Codex review at final integration. The final integration gates are unchanged.
- Evaluator routing and contracts remain branch-specific: the main-product branch runs `cs-jd-reconstruction-v3`, `cs-resume-match-v2`, `cs-organizational-maturity-v6` with GPT-5.6 Luna for Company Alignment and Burnout Risk and all ten Task 7 fields withheld; `codex/evaluator-live-diagnostic` carries v7/v4/v7, the GPT-6 Luna routes and the five-field release (`267124f`). See `EVALUATOR_STATUS.md` §20.
- Next on the main-product workstream: the separate post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update, then an audit of any remaining gaps in features 1–10, then features 11–18.

### Features 1–10 Gap Closure — shared-boundary record (October 17, 2026; Claude main-product workstream)

**Date:** 2026-10-17\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting user review; not committed (every entry above is preserved as written)

The read-only audit of main-product features 1–10 found that feature 9 (deduplication with provenance retention) was missing. The gap closure implements it at the existing ingestion boundary, together with smaller fixes. No evaluator stage, prompt, schema, routing, salary policy, evidence behavior or recommendation logic changed, and no change was made on `codex/evaluator-live-diagnostic`. These are the points that touch shared contracts:

1. **Capture transaction and the `ManualOpportunityRepository` port** (`packages/core/src/manual-opportunity-service.ts`, `database/src/manual-opportunity-repository.ts`).
   - `createDiscoveredOpportunity()` and `transitionOpportunityStatus()` are replaced by `ingestManualOpportunity()`, plus a read-only `checkDuplicates()`.
   - Normalization runs first. One transaction under a capture advisory lock then writes the raw `SourceRecord`, decides duplicates, and either creates the `NORMALIZED` opportunity (with field provenance) or attaches the `SourceRecord` to the existing opportunity.
   - A normalization failure still preserves the raw `SourceRecord`, unlinked, through `createManualSourceRecord()`.
   - Both branches edit these files: expect merge conflicts at final integration.
2. **`loadSubject()` raw sources.** The code is unchanged, but an opportunity can now have attached duplicate `SourceRecord`s, ordered after the original.
   - The Customer Success evaluator reads `rawSources[0]` and `postingHistory` payloads. Manual payloads have none, so semantic inputs are unchanged.
   - Retrieved sources that carry posting history will feed Ghost Job Risk on purpose once feature 11 exists.
3. **`fieldsWithheldFromEvaluator` gains `timeZoneRequirements`** (now user-stated, optional), so the evaluator subject is unchanged.
   - The evaluator branch rewrites the same list for the five-field release (`267124f`). At integration, keep `timeZoneRequirements` withheld unless the evaluator adopts it deliberately.
4. **Company reuse.** New captures link to the oldest `Company` with the same normalized name.
   - For such a capture, `opportunity.companyName`, which reaches the semantic operations, is that company's stored spelling (user decision D1). What the user typed stays in `SourceRecord.rawCompany` and the `company.name` field provenance.
   - Existing opportunities and companies are never re-linked or renamed.
5. **Duplicate-spend refusal** (`apps/web/src/server/evaluation-service.ts`).
   - Before admission, a request or resume is refused with 409 `DUPLICATE_LISTING_ALREADY_EVALUATED` when all of the following hold:
     - the opportunity has never completed an evaluation;
     - an unresolved exact duplicate has a completed or active evaluation, a live admission, or an open deferral.
   - The check and the admission it allows run under `withDuplicateSpendLock` (a session advisory lock, key 41220/3, on its own short-lived connection).
   - The Task 6 admission gate, `enqueueAdmitted()`, the queue and the worker are unchanged.
   - Like the worker lock, the guarantee holds while the lock's connection stays up.
6. **Schema:** migration `20261017120000_deduplication`, additive. It adds enum `DuplicateResolution`, `DuplicateReference.resolution`/`resolvedAt`, and `SourceRecord.duplicateDecision`/`duplicateEvidence`. The `Recommendation.evidenceReferences` drift is excluded.
7. **Data backfill:** `pnpm db:backfill-dedup [--dry-run]` is explicit, additive and idempotent, and is not part of `pnpm app:setup`. It has been run only on the isolated test database. Running it on the normal application database is the user's decision.

Final Integration Checklist: add items 1–5 to the Codex review list. Feature 11 must reuse the capture transaction and the engine for retrieved sources.

### Closure Annotation — October 17, 2026: Features 1–10 Gap Closure (Claude main-product workstream)

**Date:** 2026-10-17\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Closed for review (annotation only; every entry above, including the shared-boundary record, is preserved as written)

- The user reviewed and approved the implementation and verification. The closeout is complete:
  - the documentation is synchronized;
  - after a substantive check, the new versioned specifications document the implemented behavior: Core AI Framework PRD v1.6, Customer Success PRD v1.5, Core Platform TDD v1.7 (§51) and Customer Success TDD v1.5 (§40, §49);
  - the previous versions are archived unchanged.
- The checkpoint commit to `claude/gallant-pasteur-y1ou3i` follows the user's commit approval; `main` is not merged.
- The shared-boundary items 1–5 in the record above stay open for the Codex review at final integration:
  - the capture transaction and repository port;
  - attached sources in `loadSubject()`;
  - `timeZoneRequirements` withheld;
  - the reused-company spelling;
  - the duplicate-spend refusal and its lock.
- Running `pnpm db:backfill-dedup` on the normal application database remains the user's decision.
- Evaluator routing and contracts remain branch-specific, as recorded in the October 16 closure annotation and `EVALUATOR_STATUS.md` §20.
- Next on the main-product workstream: features 11–18. Feature 11 reuses the capture transaction and the deduplication engine for retrieved sources.

### Feature 11A — shared-boundary record (October 18, 2026; Claude main-product workstream)

**Date:** 2026-10-18\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting user review; not committed (every entry above is preserved as written)

The Features 1–10 Gap Closure above was committed as `d573acf` (October 17, 2026). Feature 11A adds automated retrieval from the verified official API and feed sources at the existing ingestion boundary: Greenhouse, Lever, Ashby, SmartRecruiters, Remote OK, We Work Remotely, Himalayas and Working Nomads. Adzuna is registered but unverified and disabled.

No evaluator stage, prompt, schema, routing, salary policy, evidence behavior or recommendation logic changed, and no change was made on `codex/evaluator-live-diagnostic`. These are the points that touch shared contracts:

1. **Capture repository** (`database/src/manual-opportunity-repository.ts`, `packages/core/src/retrieval-ingestion.ts`).
   - `PrismaManualOpportunityRepository` also implements the new `RetrievalIngestionRepository` port: `ingestRetrievedListing()` and `preserveUnnormalizedListing()`.
   - The body of `ingestManualOpportunity()` moved into a private `capture()` shared with retrieval. Manual capture behaves exactly as before, apart from the `recordedBy` label on duplicate references.
   - Retrieved listings run in the same capture transaction and lock. A listing with the same source and source listing ID is a re-observation: an unchanged content hash moves only last-seen times, and a changed hash adds a `SourceRecord` linked through `previousSourceRecordId`. Any other listing takes the existing create/attach path, and an attach can upgrade `Opportunity.applicationUrl` to a higher-precedence source, with an added `applicationUrl` field-provenance row.
   - The gap-closure merge-conflict warning for this file still applies.
2. **Deduplication engine `core-dedup-v2`** (approved contract change).
   - Retrieved listing IDs are compared as `<source>::<id>`; manual IDs keep their plain form.
   - Differing listing IDs count as a conflict only when both come from the same source.
   - The candidate SQL mirrors the scoping. Manual-only decisions are unchanged, and existing evidence keeps its `core-dedup-v1` label.
3. **Evaluator boundary: no change.** Feature 11A changes no evaluator semantic logic, provider inputs, stage routing, or `loadSubject()` code or behavior.
   - Retrieval creates and updates opportunities only through the existing ingestion/capture path. It never starts an evaluation.
   - A retrieved opportunity becomes an evaluator subject only when the user requests an evaluation through the existing workflow. `loadSubject()` then loads it exactly as it loads any opportunity: its source records oldest first and its canonical description.
   - For awareness at integration (data shape, not a code change):
     - **Record order:** a retrieved opportunity's first record is the first retrieved one; attached duplicates and changed observations follow it. A changed observation does not alter the canonical description.
     - **No posting history:** retrieved source items are stored under `rawPayload.source`, never as `postingHistory`, so Ghost Job Risk sees no retrieved posting history until feature 13. This deliberately supersedes the gap-closure expectation that retrieved posting history would feed it in feature 11.
     - **Provenance labels:** retrieved field provenance uses the `retrieval:<source>` reference, `source.<field>` for structured facts, and `sourceConfiguration.company` where the company name comes from the source configuration (Lever, Ashby).
4. **`fieldsWithheldFromEvaluator`** is unchanged. Retrieval never sets `timeZoneRequirements`, and the withheld fields stay withheld.
5. **Schema:** migration `20261018090000_retrieval_sources`, additive.
   - It adds the `RetrievalSource` and `RetrievalRun` models; the enums `RetrievalType`, `SourceCategory`, `RetrievalRunStatus` and `RetrievalTrigger`; and the `SourceRecord` columns `retrievalType`, `sourceCategory`, `retrievalSourceId`, `retrievalRunId`, `contentHash` and `previousSourceRecordId`.
   - All new foreign keys are `RESTRICT`, so a source, run or earlier observation with dependent records cannot be deleted. The `Recommendation.evidenceReferences` drift is excluded.
6. **Customer Success domain:** a new `src/discovery/discovery-config.ts` holds the role-family title terms and the default search phrase. It contains no evaluator code.
7. **No paid-evaluation path changed.** Retrieval creates no `Evaluation`, `EvaluationAdmission` or `DeferredEvaluation`. The budget gate, limits and duplicate-spend refusal apply to retrieved opportunities exactly as to captured ones.
8. **New single-worker lock:** advisory key 41220/4 for `pnpm worker:retrieval`, separate from the evaluation worker (41220/1) and the duplicate-spend lock (41220/3).

Final Integration Checklist: add items 1 and 2 to the Codex review list. Item 3 is recorded for awareness only; Feature 11A changes nothing on the evaluator side. Feature 11B extends the same adapter contract and ingestion path.

*(Annotation, October 18, 2026: Feature 11A was committed as `fad2341`. The record above is preserved as written.)*

### Feature 11B — shared-boundary record (October 18, 2026; Claude main-product workstream)

**Date:** 2026-10-18\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting user review; not committed (every entry above is preserved as written)

Feature 11B adds the verified public/guest-endpoint and public-HTML sources (Workday, Workable, Wellfound) to the Feature 11A adapter contract and ingestion path. No evaluator stage, prompt, schema, routing, salary policy, evidence behavior, recommendation logic or `loadSubject()` code changed, and nothing changed on `codex/evaluator-live-diagnostic`. There is no schema or migration change and no change to the capture repository, the retrieval worker's ingestion or deduplication engine `core-dedup-v2`.

1. **Retrieval transport contract** (`packages/discovery/src/transport.ts`, `politeness.ts`). `RetrievalTransport` gains `post(url, jsonBody)`, used only by Workday, whose verified listing request is a stateless JSON POST. It shares the 10 MB ceiling, timeout, identifying User-Agent, no-cookie and no-redirect rules, per-host politeness queue and 401/403/429 stop. The fixture transport keys recorded POSTs by URL and body (`fixtureRequestKey`). Any other implementation of `RetrievalTransport` must add `post`.
2. **Adapter options.** `SourceAdapter` may declare `minRequestIntervalMs` (Wellfound: 2 s), `maxPagesPerRun` (Wellfound: 11) and `verificationBody` (Workday's verification POST). The worker's transport factory now receives the adapter's interval; `pnpm sources:verify` sends a POST where a body is declared.
3. **Listing identity.** Workday listing IDs are `<tenant>/<site>:<externalPath>`, so re-observation and source-scoped deduplication never confuse two career sites; the requisition stays in `requisitionId`, so the same requisition at the same company still matches across sites.
4. **Welcome to the Jungle / Otta:** registered as Type #3 but unverified, so it cannot be enabled. On October 18, 2026 its logged-out search surface returned HTTP 200, unblocked, but showed a sign-up and matching flow: no listings in markup or embedded state, and no anonymous listing endpoint, GraphQL operation, paging, job IDs or listing fields. It was not reinterpreted as a per-company source. **Handoff:** Feature 14 (browser-assisted retrieval) may reconsider it if that feature provides a viable current retrieval path. This is not a claim that it can never be retrieved.
5. **Workable contingency:** the JSON search endpoint is the sole production interface. Workable's official XML feed (`https://www.workable.com/boards/workable.xml`, about 850 MB, Range ignored) was verified as technically sufficient but is not implemented. Reconsider it deliberately only if the JSON endpoint proves persistently unusable from the actual production host; one Claude-cloud request was rate-limited (HTTP 429) while other networks succeeded. Retry-After handling and backoff belong to Feature 12.

Final Integration Checklist: item 1 is a shared-contract change to note in the Codex review list; items 2–5 are recorded for awareness. Feature 11B changes nothing on the evaluator side.

*(Annotation, October 18, 2026: Feature 11B was committed as `2a1d8c2`. The record above is preserved as written.)*

### Feature 12 — shared-boundary record (October 18, 2026; Claude main-product workstream)

**Date:** 2026-10-18\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting user review; not committed (every entry above is preserved as written)

Feature 12 adds source health and conservative retrieval around the existing adapters. No evaluator stage, prompt, schema, routing, salary policy, evidence behavior, recommendation logic or `loadSubject()` code changed, and ingestion and deduplication are unchanged.

1. **Adapter error codes** (`packages/discovery/src/contract.ts`). `adapterErrorCodes` gains `SERVER_ERROR`: `ensureSuccess` now reports HTTP 5xx as `SERVER_ERROR` instead of `HTTP_STATUS` (other unexpected statuses keep `HTTP_STATUS`). `AdapterError.details` may carry `retryAfterSeconds`. A new `isStopError()` (429, 401/403, 5xx, or any Retry-After) is what adapters that make several requests use to stop.
2. **Retrieval transport contract** (`transport.ts`, `politeness.ts`). `TransportResponse` gains an optional `retryAfterSeconds`, set by the fetch transport from a valid, future `Retry-After` on a 429 or 503 (`parseRetryAfter`; never capped). The politeness layer now stops a host for the rest of the run after any 5xx as well as after 429 and 401/403, and the stop error carries any Retry-After. Fixture transports can carry the field.
3. **Schema** (migration `20261018120000_retrieval_source_health`, additive, nullable, no backfill): `RetrievalSource.nextEligibleAt` (the scheduling gate) and `RetrievalRun.retryAfterUntil` (the exact wait the source asked for). `PrismaRetrievalSourceRepository.finishRun` takes an optional `retryAfterSeconds` and writes the gate in the same transaction; `enqueueRun` takes `{ override, now }` and refuses a gated source with `SOURCE_RATE_LIMITED`, `SOURCE_PROVIDER_WAIT` or `SOURCE_BACKING_OFF` (with `until`); `enqueueDueRuns` skips gated sources; `update` clears only our own backoff on a settings change; `healthInputs` is new.
4. **Run now API:** `POST /api/sources/<id>/runs` accepts an optional `{"override": true}` body; a refusal is HTTP 409 with `code` and `until`.

Final Integration Checklist: items 1–3 are shared-contract changes to note in the Codex review list (any code that matched `HTTP_STATUS` for a 5xx now sees `SERVER_ERROR`); item 4 is recorded for awareness. Feature 12 changes nothing on the evaluator side.

*(Annotation, October 19, 2026: Feature 12 was committed as `f10a02b`. The record above is preserved as written.)*

### Feature 13 — shared-boundary record (October 19, 2026; Claude main-product workstream)

**Date:** 2026-10-19\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting user review; not committed (every entry above is preserved as written)

Feature 13 records posting history for retrieved listings. **No evaluator stage, prompt, schema, routing, semantic operation, salary policy, evidence behaviour, recommendation logic or `loadSubject()` code changed.** Ghost Job Risk still receives no posting history, so it keeps returning its deterministic UNKNOWN, with unchanged cost and recommendations.

1. **Adapter contract** (`packages/discovery/src/contract.ts`, `collection.ts`): `CollectResult.coverage?: { observedListingIds; complete }` (listing IDs before the title filter; complete only for a whole, consistent read, with unique IDs **equal** to any stated total); `SourceAdapter.listingCoverage?` (`complete-board`, `complete-when-total-fits` or, by default, `bounded`) and `trackingScope?(config)` (the retrieval-scope fields); `isRemovalCapable`, `listingCoverage`, `trackingScopeOf`, `itemId`; `canonicalJson` is now exported from `listing.ts`. Only Greenhouse, Lever, Ashby, Workday and SmartRecruiters set them. A future code change to a configuration-free adapter's fixed query or page must rotate its sources' tracking scopes explicitly.
2. **Schema** (migration `20261019090000_retrieved_listing_history`, additive): enum `RetrievedListingState`, table `RetrievedListing` (FKs: source Cascade, opportunity SetNull, last-seen run SetNull), `RetrievalSource.trackingScopeKey` (an opaque generation key; null only for pre-feature-13 sources until their first run), `RetrievalRun.listingCoverageComplete`, and a HISTORICAL backfill of pre-feature-13 listings in the `''` baseline. `RetrievalRunCounts.listings` is optional.
3. **Repository/worker/service:** `create` assigns a fresh scope key; `update(id, input, now, { rotateTrackingScope })` rotates it and makes earlier rows UNTRACKED (the service decides from `trackingScopeOf`); `claimNextRun` initialises a null key and adopts the baseline; `recordListingObservations` and `listingsForOpportunity` are new; `remove` also counts ledger rows; the sighting path moves `Opportunity.lastSeenAt` but never `SourceRecord.lastObservedAt`. The worker records observations after ingestion and before finishing the run.
4. **Ready posting-history contract for Ghost Job Risk (withheld).** `derivePostingHistoryFacts` (`packages/core/src/posting-history.ts`) produces `{ type, description, occurredAt }` facts of the types ACTIVE_ATS, CURRENT_POSTING, REPOSTED, CLOSED_ATS_VISIBLE_ELSEWHERE, AGGREGATOR_VISIBILITY and UNCHANGED_OVER_TIME. A unit test parses every one with `sourcePostingHistoryFactSchema`. EVERGREEN_LANGUAGE, FARMING_INDICATOR, RECURRING_IDENTICAL_REQUISITION and new-ID reposts are not derived. Two adoption routes exist: (a) `loadSubject()` adds the derived facts as `rawPayload.postingHistory` on one source entry (one entry only, so facts are not duplicated per record); or (b) the facts are written into a SourceRecord's `rawPayload`. **The first question for the coordinated integration is whether Ghost Job Risk can become deterministic from these structured facts**, rather than activating the currently dormant paid semantic path (`customer-success.ghost-job-risk`, which has no approved route and would fall to the default model), and only then the routing, budget-estimate and recommendation effects.

Final Integration Checklist: items 1–3 are shared-contract changes to note in the Codex review list; item 4 is the evaluator decision to take at final integration. Feature 13 changes nothing on the evaluator side.

*(Annotation, October 19, 2026: Feature 13 was committed as `d1bf217`. The record above is preserved as written.)*

### Feature 14 — shared-boundary record (October 19, 2026; Claude main-product workstream)

**Date:** 2026-10-19\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting user review; not committed (every entry above is preserved as written)

Feature 14 adds browser-assisted retrieval for public, logged-out LinkedIn job pages and corrects two sources. **No evaluator stage, prompt, schema, routing, semantic operation, salary policy, evidence behaviour, recommendation logic or `loadSubject()` code changed; no migration.** The Feature 13 posting-history facts stay withheld, and Ghost Job Risk still returns its deterministic UNKNOWN.

1. **Adapter contract** (`packages/discovery/src/contract.ts`, new `browser.ts`): `CollectContext.browser?: BrowserSession` (only `open(url)` and a navigation count: no click, type, submit or account API) and `CollectContext.pendingListings?(since)`; `CollectResult.discovered?` (title matches found this run) and `unavailable?` (pending listings whose page answered 404 or 410); `SourceAdapter.requiresBrowser?` and `browser?: { authCookieNames?, detectFriction?, maxNavigations }`. `createBrowserSession` enforces one page at a time, the adapter's minimum interval, a navigation cap, a timeout and a page-size limit, and maps 429 to `RATE_LIMITED` (with Retry-After), 401/403/999, sign-in walls, authwalls, checkpoints, CAPTCHAs, challenges and account cookies to `ACCESS_DENIED`, 5xx to `SERVER_ERROR` and load failures to `NETWORK`; after any stop every later `open` is refused without navigating. `verificationFollowUpUrl` receives the first page as a `Document` for a browser-assisted adapter.
2. **Driver** (new `packages/browser-retrieval`, `playwright-core` and `jsdom`): `launchBrowserDriver({ executablePath })` starts headless Chromium with a fresh non-persistent context (asserted to start with no cookies; no service workers, downloads, profile or storage state; images, fonts and media not downloaded; any main-frame navigation the page starts by itself, such as a script reload or meta refresh, is refused) and `parseHtml` reads pages without running scripts. `BrowserNavigation.headers?` carries the response headers for diagnosis (Set-Cookie reduced to cookie names), which `sources:verify` saves. Only the retrieval worker CLI and `sources:verify` load it (dynamically, when `RETRIEVAL_BROWSER_EXECUTABLE` is set); the web app never does.
3. **Worker/repository** (no schema change): for an adapter that requires a browser, the worker launches one driver per run, builds the session from the adapter's settings and always closes the driver; without a configured browser the run is `ADAPTER_UNAVAILABLE`, and a browser that cannot start is `INTERNAL` (neutral for Feature 12 health). `recordListingObservations` accepts `discovered` (creates current-scope `RetrievedListing` rows with no opportunity, LISTED, not removal-capable, if missing) and `unavailable` (deletes only such placeholder rows); `pendingListings(sourceId, scopeKey, since)` returns them oldest first. A placeholder gains its opportunity through the existing stored-listing path when its details are read. These rows have no opportunity, so posting-history facts, the dashboard badge and `listingsForOpportunity` are unaffected; a source with them is archived rather than deleted.
4. **Sources:** the `linkedin` adapter (`BROWSER_ASSISTED`, `JOB_BOARD`, bounded, `verified: false` until a local-runtime verification, needs `RETRIEVAL_BROWSER_EXECUTABLE`; search URLs use `/jobs/search/`; a sign-in modal over present results is not friction); We Work Remotely on the all-jobs RSS feed (its tracking scope is now the constant `{ feed: "remote-jobs" }`; existing WWR sources keep their current generation, which is safe because WWR is bounded and never infers absence, so no explicit rotation was added; a stored legacy `category` is accepted and ignored); Wellfound `minRequestIntervalMs` 12,000; Welcome to the Jungle / Otta `retrievalType` changed from `PUBLIC_GUEST_INTERNAL_ENDPOINT` to `PUBLIC_HTML` (public logged-out webpage retrieval; still `verified: false` because its tested public pages expose no usable job records, so no source can run it; a source created earlier keeps its stored type). The shared environment schema adds optional `RETRIEVAL_BROWSER_EXECUTABLE`.

Final Integration Checklist: items 1–4 are shared-contract changes to note in the Codex review list. Feature 14 changes nothing on the evaluator side.

*(Annotation, October 20, 2026: Feature 14A, this record, was committed as `dd77d29` and accepted after the local-runtime LinkedIn adapter check (60 public jobs discovered; the first job page answered HTTP 429 and the run stopped with no retry). LinkedIn stays `verified: false` and disabled. Feature 14B, the browser-extension companion, is required main-product work, not yet implemented and next, so Feature 14 is not complete; its shared-boundary changes will be recorded here when it is built. The record above is preserved as written.)*

### Feature 14B — shared-boundary record (October 20, 2026; Claude main-product workstream)

**Date:** 2026-10-20\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting Alex's review and local Chrome acceptance; not committed (every entry above is preserved as written)

Feature 14B adds the browser-extension companion. It is a source-collection boundary only. **No evaluator stage, prompt, schema, routing, semantic operation, salary policy, evidence behaviour, recommendation logic or `loadSubject()` changed.**

1. **Shared contract** (`packages/core/src/extension-capture.ts`, exported from `@ai-career/core`): `extensionCaptureSchema` (strict, `schemaVersion: 1`), `cleanCapturedText`, `cleanPageUrl` and `linkedInJobIdFromUrl`, plus `editedFields` (the preview fields the user corrected before saving, kept in `sourceMetadata.capture.editedFields`). The extension bundles this file; the server parses every capture again with it.
2. **Ingestion:** a capture becomes a retrieved listing through the existing `buildRetrievedListing` and `createRetrievalIngestionService`. It carries:
   - `source: "browser-extension"`, `sourceType: BROWSER_EXTENSION`, `retrievalType: BROWSER_ASSISTED`;
   - the server-derived `sourceCategory`: known ATS, job-board and marketplace hosts, every other host AGGREGATOR;
   - `retrievalSourceId` and `retrievalRunId` null, so there are no Feature 13 ledger rows;
   - `externalId` `"linkedin:<id>"` (with the canonical `/jobs/view/<id>` URL) or `"<site>:<URL key>"`;
   - `sourceMetadata.capture` holding `pairingId`, `extractor`, `capturedAt`, `extensionVersion`, `host`, `site`, `knownHost`, `siteJobId` and `notes`.

   The evaluator reads such a record like any retrieved source record: its oldest `SourceRecord`, with the description as captured text.
3. **Evaluation:** a capture never evaluates. The extension's evaluation request and status routes are credential-gated wrappers that call the existing `handleProductionEvaluationPost` and `handleProductionEvaluationGet` unchanged. Budget, duplicate-spend, queueing, retries and persistence are untouched.
4. **Schema:** migration `20261020090000_extension_pairing` (additive): the `ExtensionPairing` table (`tokenHash` unique, no foreign keys).

Final Integration Checklist: items 1–2 are shared-contract additions to note in the Codex review list. Feature 14B changes nothing on the evaluator side.

*(Annotation, October 23, 2026: Feature 14B, this record, was committed as `e6bacc6` (October 20, 2026). Alex's local acceptance then found the shared normalization gap recorded below; 14B stays open. The record above is preserved as written.)*

### Feature 14B correction — shared Core job-text fallback: shared-boundary record (October 23, 2026; Claude main-product workstream)

**Date:** 2026-10-23\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting Alex's review; not committed (every entry above is preserved as written)

Approved by Alex on October 23, 2026. It restores the Core requirement that structured values come first and the posting's own text is the fallback for already-supported normalized facts. Core Platform TDD v1.15 §51 and Core AI Framework PRD v1.14 specify it. **No evaluator stage, prompt, schema, routing, semantic operation, salary policy, evidence behaviour, recommendation logic, `loadSubject()` or `fieldsWithheldFromEvaluator` changed; no migration; no backfill.**

1. **Shared normalization** (`packages/normalization`; exported from `@ai-career/normalization`):
   - **The reader:** `readJobTextFacts({ text, title, pageTitle })`, `parseUnambiguousDate` and `jobTextSourceFields`, with the provenance markers listed in `job-text-facts.ts`.
   - **Who calls it:** `createManualOpportunityNormalizer` and `createRetrievedOpportunityNormalizer` call it the same way, only for facts still missing.
   - **Precedence:**
     1. the user's stated or corrected value;
     2. the structured value;
     3. a dedicated-field reading;
     4. the page title (company only);
     5. the job text;
     6. Unknown.
   - **Provenance:** facts read from the text are DETERMINISTIC with `rawText:*` markers; the page-title company is marked `pageContext:page-title-company`.
   - **Residency:** keeps `parseResidency` unchanged.
2. **Currency rule (product-wide):** `parseCompensation(text, selected, geography?)` reads a bare "$" as USD only when the location, the residency regions or the statement name only U.S. geography. Otherwise the currency is null with `currencyUnknownReason: "BARE_DOLLAR_WITHOUT_US_EVIDENCE"`. The marker `compensationText:bare-dollar-as-usd` is unchanged. *(October 25, 2026: the location is read by `readLocationGeography`, where an explicit country in a full location settles an ambiguous region abbreviation, e.g. "Sunnyvale, CA, United States" is U.S. evidence.)*
   - **For the Codex salary policy at final integration:** when Milestone 4 releases salary minimum and maximum, currency and residency to the evaluator (`267124f`, not merged), currency will be Unknown more often for bare-"$" postings outside clear U.S. geography. That includes city-only locations such as "NYC", because cities are not in the geography vocabulary. A hard filter must keep treating Unknown currency as Unknown, never as USD.
3. **Evaluator subject (unchanged contract, richer data):**
   - The Task 7 fields stay withheld. That now includes values read from the job text: `timeZoneRequirements`, `closingDate`, `remoteStatus`, `employmentType`, `department`, `seniority`, salary minimum and maximum, and currency.
   - `companyName`, `location`, `salaryText` and `postingDate` were never withheld. When a source left them empty they may now carry values read from the same job text the evaluator already receives, and their provenance rows (with the markers) reach the subject.
   - Review at final integration whether a text-derived `salaryText`, a compensation statement that may be OTE, is acceptable salary context for the salary policy.
4. **Extension and server context:**
   - `extensionCaptureSchema` gains an optional `pageTitle`. It is additive, `schemaVersion` stays 1, and an older envelope still validates.
   - The envelope also gains an optional `pageText`: the job's bounded page content beside a structured description or a selection. It excludes navigation, header, footer, side panels, forms and recommendation or sharing widgets, is capped at 20,000 characters and is never sent from LinkedIn.
   - The server stores `sourceMetadata.pageTitle` and `sourceMetadata.pageText` (neither for LinkedIn) and `sourceMetadata.userCorrectedFields`.
   - Shared normalization reads page context only through labelled values, with `pageContext:*` markers, below structured values.
   - The retrieved normalizer records corrected fields as DIRECT with `userCorrected:<field>`. Neither key enters the listing content hash.
5. **Source facts and change detection:**
   - `retrievedSourceFactsSchema` (Core) adds a neutral `sourceMetadata.sourceFacts` record: department, seniority labels, and a compensation text with no stated period. Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Himalayas, LinkedIn and Wellfound copy into it values they already hashed as material.
   - The retrieved normalizer reads them: department DIRECT `source.department`; seniority `source.seniority`, which must agree with a title level, otherwise Unknown; compensation `source.compensation`, with amounts only with a stated annual period.
   - Extension captures add `material.pageContext`, the canonical labelled page-context evidence from `pageContextEvidence`, to the content hash. No stored listing's hash changed.
   - **Evaluator subject:** `department` and `seniority` stay withheld.
6. **Unchanged on purpose:**
   - the deduplication engine (`core-dedup-v2`), its thresholds and rules (re-run with the corrected inputs: a cross-site copy of one job is a PROBABLE_MATCH flag, the same title at a different company is NO_MATCH, and nothing auto-merges on similarity);
   - the unknown-host site-ID rule;
   - application-link precedence.

**Known gaps recorded, not built (for planning and final integration):**
- *(Decided and implemented October 25, 2026; see the convergence record below.)* **Work authorization and visa eligibility.** The normalized Opportunity has no field for it. Such language is deliberately never read as residency. A future contract decision should add a separate fact rather than overload residency.
- *(Approved and implemented October 25, 2026.)* **Generic employer apply-link extraction from captured pages.** A possible future enhancement, kept separate because a wrong application URL could cause an incorrect automatic attachment.

Final Integration Checklist: items 1–4 are shared-contract changes to note in the Codex review list, item 2 especially for the salary policy.

### Feature 14B correction — current-version projection and the evaluated source version: shared-boundary record (October 23, 2026; Claude main-product workstream)

**Date:** 2026-10-23\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting Alex's review; not committed

Alex approved this on October 23, 2026. It corrects the Core TDD v1.15 §51 re-observation contract: a CHANGED observation of an opportunity's originating listing re-projects the opportunity's current facts, and every version is kept. **It crosses the evaluator boundary in the integration layer only.** No stage logic, prompt, model, routing, semantic schema or recommendation rule changed, and there are no provider calls.

1. **Schema** (migration `20261023090000_superseded_provenance_and_evaluated_source`, additive and nullable): `FieldProvenance.supersededAt` and `Evaluation.sourceRecordId` (foreign key to `SourceRecord`, `ON DELETE SET NULL`, indexed). Applied only to the isolated test database.
2. **Evaluation binding:**
   - `createEvaluation` and `createEvaluationAndTask` set `Evaluation.sourceRecordId` to the current originating version (`originatingVersion` in `database/src/manual-opportunity-repository.ts`; for a manual opportunity, its source record).
   - **Contract additions** (`packages/evaluation/src/contracts.ts`):
     - `EvaluationSubject.subjectSourceRecordId?`;
     - `CoreEvaluationContext.subjectSourceRecordId`;
     - `loadSubject`'s optional `evaluationId` input;
     - the `evaluatedSource(context)` helper: the bound record, else `rawSources[0]`.
   - The executor and the Customer Success processor pass `evaluationId: snapshot.id`.
3. **`PrismaEvaluationRepository.loadSubject`:**
   - With an evaluation, the subject is the bound version as it stood: provenance rows with `createdAt <= binding` and not superseded by then. If the listing changed later, the bound record's `rawDescription` and the as-of title, company, location, salary text and posting date replace the newer projection.
   - Without an evaluation, it uses the current version and the non-superseded rows.
   - `rawSources` still lists every record, oldest first. `fieldsWithheldFromEvaluator` is unchanged.
4. **Customer Success domain (selection only):** `extraction/explicit-facts.ts`, `extraction/extractor.ts` and `evaluation/opportunity-priority.ts` read `evaluatedSource(context)` instead of `rawSources[0]`. For a single-record opportunity the behavior is identical.
5. **Attempts:** `recordSemanticOperation` stores the evaluation's bound `sourceRecordId`, falling back to the oldest record for evaluations made before the binding existed, and the bound record's source as `jobSource`.
6. **No automatic work:** a change never evaluates, queues or reserves budget. Reevaluation stays user-requested and additive. `findListingVersionHint(opportunityId)` drives the opportunity-page hint.

Final Integration Checklist: items 2–5 must be carried into the Codex evaluator branch's `loadSubject`, executor and Customer Success extractor when the branches are combined, or that branch will again evaluate the oldest record of a changed listing. The salary-policy release of withheld fields (`267124f`) should read the as-of provenance the subject now supplies.

### Feature 14B correction — shared-normalization convergence: shared-boundary record (October 25, 2026; Claude main-product workstream)

**Date:** 2026-10-25\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting Alex's review; not committed

Approved by Alex on October 25, 2026. **No evaluator stage, prompt, model, routing, semantic schema or recommendation rule changed.**

1. **Compensation (contract change).**
   - `parseCompensation` no longer returns null bounds for OTE (`TOTAL_COMPENSATION` is removed). It keeps the stated numbers in the stated currency and returns `basis` (BASE / OTE / null).
   - The new normalized fact is `compensationBasis`, with provenance under the statement's marker.
   - **For the Codex salary policy (`267124f`):** when `salaryMin`/`salaryMax` are released to the evaluator, it must read `compensationBasis` and must not treat an OTE range as qualifying base salary (CS PRD ¶241: OTE-only → Salary Unknown for the hard filter). The USD-equivalent conversion stays evaluator-only.
   - `compensationBasis` is in `fieldsWithheldFromEvaluator` until then.
   - *(Later on October 25, 2026: Codex implemented this on the evaluator worktree as `cs-hard-filters-v3`; see the next record.)*
2. **Work authorization (new facts).**
   - **Fields:** `workAuthorizationRequirement` (RIGHT_TO_WORK / CITIZENSHIP), `workAuthorizationRegions`, `visaSponsorship`, `relocationSupport` and `employerOfRecordRegions`.
   - They are never derived from or into residency, which is unchanged. All are withheld from the evaluator.
   - The user's own eligibility (`UserEligibility`: authorized and citizenship countries) is a separate table, outside the versioned profile, and never evaluator input.
   - Any evaluator use of work authorization needs a coordinated decision; CS PRD ¶223 forbids inferring residency from it.
3. **Department.** It may now carry an explicit team statement (`rawText:explicit-team-statement`). It stays withheld.
4. **Application URL.**
   - `sourceFacts.applicationUrlBasis` and the `applicationUrlProvenance` markers (Core).
   - Job-board listing pages are no longer stored as application URLs.
   - A changed originating listing updates the link only when it owned it.
   - **Deduplication logic is unchanged.** Its inputs differ only where an extension capture now carries an explicit apply link; a posting-page application URL equals the canonical URL, which is already an input.
5. **Schema:** migration `20261025090000_work_authorization_and_compensation_basis` (additive). Applied only to the isolated test database.

Final Integration Checklist: item 1 is mandatory for the salary policy before salary bounds are released; items 2–4 are shared-contract additions.

### Milestone 4 compensation-basis correction → final-integration contract (October 25, 2026)

**Date:** 2026-10-25\
**From:** Codex evaluator workstream (recorded by the Claude main-product workstream)\
**To:** Final integration\
**Status:** Evaluator side complete on the `codex/evaluator-live-diagnostic` worktree over `267124f`; not committed, not merged. Main-product docs synchronized; no main-product implementation changed.

Core preserves OTE numeric facts. Milestone 4 treats OTE-only compensation as Unknown for confirmed base-salary eligibility.

**Evaluator side (Codex):**
- **Basis:** the evaluator consumes `salaryMin`, `salaryMax`, `currency`, `salaryText`, `compensationBasis`, `residencyRequirement` and `residencyRegions`.
  - `BASE` and `null` are evaluated normally under the unchanged Customer Success bands.
  - `OTE` keeps its bounds and makes salary eligibility Unknown unless separate confirmed base-salary evidence exists, with the OTE statement kept as evidence.
- **Currency:** FX conversion stays evaluator-only, and nothing converted is written back. Core's bare-"$" rule is not reproduced.
- **Residency:** residency selects the policy branch. Work authorization, sponsorship, relocation, citizenship and `UserEligibility` are never used.
- **Identifiers:** `cs-hard-filters-v3` and `cs-salary-policy-v3-ecb-2026-10-14`. No semantic prompt, model or routing change.
- **Compatibility boundary:** the evaluator reads the basis through a temporary compatibility path because that branch lacks the native Core field.

**Integration contract (carry out at final integration):**
1. Read the native shared-Core `compensationBasis` (`compensationBasisValues` in `packages/core/src/opportunity.ts`, on a nullable field), exactly `BASE` | `OTE` | `null`. Do not add a value such as `TOTAL_COMPENSATION`, or a second copy of the enum, unless the Core contract itself is revised first.
2. Replace only the temporary evaluator compatibility read. Remove `compensationBasis` from `fieldsWithheldFromEvaluator` together with the five Task 7 fields that `267124f` releases, and update the withholding tests.
3. Preserve the OTE numeric facts and the original source currency. FX stays evaluator-only.
4. Keep residency separate from work authorization. The work-authorization fields stay in `fieldsWithheldFromEvaluator`, and `UserEligibility` is never sent to the evaluator.
5. Do not recreate bare-"$" geography logic in the evaluator.
6. Preserve the `cs-hard-filters-v3` and v3 salary-policy behavior.
7. Keep semantic prompts, provider models and routing unchanged.
8. Expect overlapping edits in `database/src/evaluation-repository.ts`, `packages/evaluation/src/contracts.ts` and `domains/customer-success/src/extraction/explicit-facts.ts`, which both branches change. Keep this branch's source-version binding (`evaluatedSource`), its withheld-field additions and the evaluator's basis evidence.

**Resolved October 25, 2026 (Alex approved; Feature 14B v5): an OTE range that also mentions "base".** The record below is the finding as reported; the resolution follows it.
- **The behavior:** Core's `parseCompensation` returns `basis: null` when a statement names both OTE/on-target and "base".
  - Measured on this branch, "$120,000 - $150,000 OTE (base + commission)" and "OTE: $120,000 - $150,000; 60/40 base to variable" keep bounds 120000/150000 with a `null` basis.
  - Under the evaluator's "`null` is evaluated normally" rule, such an OTE range would be treated as ordinary salary. With U.S. currency evidence that is a false Pass.
  - Two separate ranges ("Base salary $80,000 - $100,000 plus commission; OTE $140,000") are already safe: the amounts are ambiguous, and the bounds stay Unknown.
- **Recommended Core fix:** any OTE/on-target cue gives `OTE`; `BASE` only with a base cue and no OTE cue; otherwise `null`. It keeps the `BASE` | `OTE` | `null` values and needs no evaluator change. Its cost is a conservative miss: a base range that mentions OTE elsewhere becomes `OTE`, which is Unknown rather than a false Pass.
- **Related, lower severity:** a structured source salary range takes a basis only from that source's own salary text when the text states the same range. OTE stated only in the job description leaves the structured range `null`.
- **Status (as reported):** no implementation change until Alex decides; the fix would replace the v4 patch with a v5.
- **Resolution (implemented in v5, shared Core only; no adapter or evaluator change):**
  - **OTE precedence:** `parseCompensation` gives `OTE` whenever the statement uses OTE or on-target wording, `BASE` only for base wording without it, otherwise `null`. Both examples above now give 120000/150000 with `OTE`. Separate figures in one statement stay ambiguous, with the amounts Unknown.
  - **Same-range OTE from the description** (`onTargetStatementFor` in `packages/normalization/src/job-text-facts.ts`, used by the retrieved and manual normalizers): when the amounts come from structured source fields, a source salary text or a user-stated salary text, and their basis is not already OTE, the basis becomes `OTE` only if a compensation statement in the posting's own description states that same range as OTE.
    - Both bounds must be equal (an open end must match too), and the statement must state no other currency.
    - It must name no other figure, since several figures parse as ambiguous.
    - Page context never counts. OTE wording about any other figure leaves the basis as it was.
    - Provenance is the description statement (`rawText:explicit-compensation-statement`); the bounds and currency keep their own provenance.
  - **The values stay `BASE` | `OTE` | `null`.** The Codex evaluator contract is unchanged, and an OTE range now always reaches it as `OTE`.

### Feature 14B final cross-source batch: shared-boundary record (October 27, 2026; Claude main-product workstream)

**Date:** 2026-10-27\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented, verified on the isolated test database and committed on `claude/gallant-pasteur-y1ou3i`; awaiting the targeted live verification (Codex/local)

From Alex's final human cross-source retest. **No evaluator stage, prompt, model, routing, semantic schema or recommendation rule changed.**

1. **Two new normalized facts, withheld from the evaluator** (`fieldsWithheldFromEvaluator`, delivered as `[]` / `null`):
   - `compensationTiers`: labelled pay ranges for several places, zones or bands ([{ label, minimum, maximum, currency }]); `salaryMin`/`salaryMax` stay null when there are tiers. Additive migration `20261027090000_compensation_tiers`.
   - `bonus`: variable pay stated on its own ("Bonus potential up to $10,000"), previously always null. It is never part of the salary range.
   At integration, decide how a tiered salary meets the salary policy (for example, the tier for the user's location) and whether variable pay counts.
2. **Existing evaluator-visible fields carry corrected values** where this batch fixes them: the title (a posting heading instead of a careers site's own name), the location (a more precise labelled place; no default "Anywhere" over a stated one), `salaryText` (the agreed range's statement, or the tiers), the description (the page's full description instead of a shortened structured copy; the user's selected text after "Use my selected text instead"), the application URL and the requisition ID. The approximate posting date stays withheld.
3. **Unchanged:** deduplication, the evaluator's input contract, version binding and the no-automatic-reevaluation rule. The extension popup now says when the latest evaluation is of an earlier listing version (the existing listing-version hint); requesting evaluation stays the user's choice.

### Feature 14B cross-source correction: shared-boundary record (October 26, 2026; Claude main-product workstream)

**Date:** 2026-10-26\
**From:** Claude main-product workstream\
**To:** Codex evaluator workstream / final integration\
**Status:** Implemented and verified on the isolated test database; awaiting Alex's review and the cross-source live retest; not committed

From the live acceptance of every supported source. **No evaluator stage, prompt, model, routing, semantic schema or recommendation rule changed.**

1. **Residency is populated in more cases.**
   - **Where from:**
     - a source's remote-hiring places (`sourceFacts.remoteLocations`, read as the location "Remote (<places>)");
     - a posting's own statement that the remote role is based somewhere ("This is a U.S.-based, full-time remote role."; `rawText:explicit-remote-base-statement`, the weakest reading: explicit eligibility statements replace it). An ordinary job or office location by itself never creates eligibility;
     - eligible states listed one per line;
     - "continental U.S.";
     - the remote option of an "Office or Remote, <geography>" location.
   - **For the Codex salary policy:** these are explicit eligible-geography facts under the existing contract, and residency still selects the salary branch. Expect more `US_REQUIRED` / `NON_US` and fewer `null` values once residency is released to the evaluator. Work authorization is still never read as residency.
2. **Regional pay tiers.** When a posting states several ranges each labelled with its own place or zone, `salaryMin`/`salaryMax` are null even when a source field states one tier. The salary text is the tiers, each with its label ("U.S.: USD 63,000 - 75,000 / Canada: CAD 88,000 - 110,000"). `currency` is kept only when the tiers share one, and `compensationBasis` is null. Ranges that do not each name their place are not tiers: they are conflicting evidence and stay Unknown. The salary policy sees Unknown bounds, not one tier.
3. **New withheld fields `seniorityLabel` and `workArrangements`** (migration `20261026090000_cross_source_normalization`, additive; applied only to the isolated test database). Both join `fieldsWithheldFromEvaluator`, like `seniority` and `remoteStatus`. `workArrangements` lists every arrangement the posting states, in its order ("Office or Remote" → `ONSITE`, `REMOTE`); `remoteStatus` is the single stated arrangement, and null when several are offered.
4. **Other new readings (all still withheld from the evaluator):**
   - a time-zone preference (`rawText:explicit-time-zone-preference`);
   - a source-stated posting age (`postingDate:relative-posted-age`, `pageContext:relative-posted-age`), approximate at day precision. `postingDate` is evaluator input, so `loadSubject` withholds an approximate date (null, with its provenance row left out) until its evaluator use is approved;
   - a labelled requisition ID (`*:labelled-requisition-id`; it also feeds the existing requisition-ID dedup match, whose logic is unchanged);
   - a fuller labelled location (`rawText:labelled-location`);
   - page metadata items (`pageContext:stated-*`).
5. **Department** is no longer a product field: it is not shown, filtered on or entered. It was already withheld from the evaluator and stays so; the column remains.
6. **Extension envelope:** two optional fields, `remoteLocations` and `seniority` (`schemaVersion` stays 1). Page context is now sent with every non-LinkedIn description, one visible item per line.

Final Integration Checklist: items 1–2 matter when the Milestone 4 fields are released to the evaluator; items 3–6 are shared-contract additions with no evaluator change.
