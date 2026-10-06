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

## Notes

Update this file whenever work is explicitly transferred between Codex and Claude, especially when ownership crosses between evaluator internals, main-product UI/workflow, shared persistence, lifecycle/status handling, profile/preferences contracts, or retrieval/scraping integrations.
