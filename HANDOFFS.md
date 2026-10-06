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

## Notes

Update this file whenever work is explicitly transferred between Codex and Claude, especially when ownership crosses between evaluator internals, main-product UI/workflow, shared persistence, lifecycle/status handling, profile/preferences contracts, or retrieval/scraping integrations.
