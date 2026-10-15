# Changelog

All notable project changes for the AI Job Assistant are documented here.

This changelog summarizes major implementation milestones and evaluator evolution. Detailed historical implementation records live in `MILESTONES_1_10.md` and `EVALUATOR_STATUS.md`.

---

## Unreleased

### Final evaluator routing lock

- Kept deterministic execution for Hard Filters, Ghost Job Risk when objective posting-history evidence is unavailable, and Final Recommendation.
- Kept GPT-5.6 Terra for JD Reconstruction and Resume Match.
- Kept GPT-5.6 Luna for Job Evaluation, Organizational Maturity, Alex Fit, and Opportunity Priority.
- Routed Company Alignment and Burnout Risk to GPT-6 Luna.
- Rejected GPT-6 Luna for Job Evaluation after the isolated benchmark changed Strategic Bridge Value from `HIGH` to `MODERATE` and omitted established process-development evidence.
- Skipped the remaining GPT-6 stage benchmarks by explicit product decision and locked the routing policy rather than continuing paid experimentation.
- Final live/whole-product acceptance remains deferred until the evaluator and all intended main-product work are integrated.
- Branch state: the GPT-6 Luna routes are implemented on `codex/evaluator-live-diagnostic`; `claude/gallant-pasteur-y1ou3i` keeps the earlier accepted routing until final integration.

### Task 6 completion — AI budget and usage controls

- Completed the persistent monthly AI budget ledger, atomic reservation/reconciliation, configurable warning thresholds, daily/weekly evaluation-volume limits, monthly output-token limits, budget deferral/resume/cancel flow, usage reporting, and dashboard capacity/cost visibility.
- Standardized dollar-budget deferrals on `AI_BUDGET_LIMIT`; throughput/token limits use `USAGE_LIMIT_REACHED`.
- Preserved unknown provider usage as Unknown rather than coercing it to zero.
- Accepted the product decision that already-admitted queued/running evaluations are not retroactively cancelled when limits are lowered.
- Checkpoints: `267138a` and naming cleanup `8d3993a`.

### Task 7 completion — normalized opportunity facts

- Added deterministic normalization and persistence for salary minimum/maximum, currency, work arrangement, seniority, department, employment type, closing date, residency requirement, and residency regions while preserving raw text and field provenance.
- Added supported residency geography codes for countries, U.S. states/DC/Puerto Rico, Canadian provinces/territories, UK nations, and broad regions such as EU, EEA, EMEA, APAC, LATAM, and WORLDWIDE.
- Preserved Unknown for ambiguous geography, ordinary city/location text, conflicting currencies, non-annual compensation, OTE, and unsupported cases.
- Added the bare-`$` USD provenance marker while keeping explicit currency authoritative.
- Added dashboard salary/filter/sort support and residency-aware persisted data without silently changing evaluator behavior during Task 7.
- Final Task 7 checkpoint: `754f956dc0860149760936a61bdace0489404b9a` on `claude/gallant-pasteur-y1ou3i`.

### Milestone 4 completion alignment — salary policy and Task 7 contract

- Updated Customer Success Hard Filters to consume the Task 7 salary/currency/residency contract.
- U.S.-residency-required roles now use a hard `$60,000 USD-equivalent` minimum: `$60,000+` Pass; below `$60,000` Fail/Skip; no U.S. Review band and no salary maximum.
- Non-U.S.-eligible roles use: `$60,000+` Pass; `$55,000–$59,999.99` Review; `$50,000–$54,999.99` conditional Review only when explicit configured location/cost context supports viability, otherwise Unknown; below `$50,000` Fail/Skip.
- Residency requirement selects the policy; salary currency does not.
- Added versioned FX handling under `cs-salary-policy-v2-ecb-2026-10-14` using reproducible ECB euro-reference cross-rates. No converted salary values are persisted.
- A disclosed minimum is the salary gate. Max-only salary remains Unknown unless the stated maximum is itself below the applicable floor.
- Released `salaryMin`, `salaryMax`, `currency`, `residencyRequirement`, and `residencyRegions` with provenance to the evaluator; `remoteStatus`, `seniority`, `department`, `employmentType`, and `closingDate` remain withheld pending later coordinated adoption.
- Version identifiers advanced to `cs-evaluation-v1.2-m9`, `customer-success-v1.2`, `cs-rules-v1.2`, and `cs-hard-filters-v2` (on `codex/evaluator-live-diagnostic`) without changing prompt/model versions as part of this correction.
- Focused offline verification passed without provider calls or normal-database use. Broader DB-backed integration, E2E, web build, live calls, and final Task 7→evaluator acceptance remain intentionally deferred to the later whole-product integration pass.
- Commit: `267124f fix(cs): align Milestone 4 salary policy with Task 7` on `codex/evaluator-live-diagnostic`. Not yet merged: on `claude/gallant-pasteur-y1ou3i`, `fieldsWithheldFromEvaluator` still withholds all ten Task 7 fields and the earlier version identifiers remain until final branch combination.

### Product completion planning

- Main-product scope is features 1–18. Retrieval, source health, posting-history intelligence, the browser extension, source intelligence, market analytics, personal job-search analytics, and company intelligence are part of the intended main product rather than optional post-product add-ons.
- Only features 19–23 remain later add-ons: company watchlists, proactive notifications/follow-ups, calendar integration, email integration, and application-assistance features.
- The current sequence is: finish the Task 1–9 completion pass (Task 8 next, then Task 9), build any still-missing main-product features 1–18, then perform final evaluator/product integration, whole-product acceptance, and deliberate freeze/merge.
- Retrieval work may begin after the evaluator and manual product are stable enough to support it, but final product acceptance does not occur until all intended main-product features are complete.
- Kept evaluator and main-product workstreams separated to reduce architectural drift.

---

## Earlier Unreleased Entries (recorded before October 15, 2026; added to the repository October 6, 2026)

*Preserved as recorded before the October 15, 2026 updates above. The remaining evaluator sequence and development order below have since been completed or superseded (October 15 routing lock; main-product scope of features 1–18).*

### Evaluator finalization

- Accepted Resume Match Optimization #2 as the current Resume Match baseline.
- Retained JD Reconstruction State2 as the accepted JD Reconstruction optimization after rejecting more aggressive sparse-omission candidates.
- Reduced projected full-evaluator cost from `$0.2566362` to approximately `$0.2026282`.
- Preserved semantic safeguards around evidence, provenance, Unknowns, contradictions, seniority, specialization, and direct/related/transferable experience.
- Established final optimization acceptance rule: same or better required quality at the same or lower total cost.
- Established the current remaining evaluator sequence:
  1. benchmark GPT models stage-by-stage;
  2. lock final routing;
  3. run one final full evaluator;
  4. freeze the evaluator baseline.
- Established a verification rule that actual production request/state takes precedence over helper-derived fingerprint reproduction when full candidate identity already matches.

### Product completion planning

- Confirmed development order:
  - finish evaluator;
  - finish remaining main-product work in parallel;
  - combine into a usable product;
  - build retrieval/scraping afterward as an ingestion layer into the existing normalization/evaluation pipeline.
- Kept evaluator and main-product workstreams separated to reduce architectural drift.
- Deferred automated retrieval/scraping until after the manually usable product is complete.

---

## Evaluator Cost Optimization Phase

### Resume Match Optimization #2

- Reworked the provider-visible Resume Match schema to reduce runtime-expanded requirement-assessment structure.
- Rejected an ultra-compact candidate after live inference produced invalid semantic combinations despite passing offline replay.
- Restored provider-visible compatibility constraints without weakening domain validators.
- Accepted final live Optimization #2 result:
  - input: `20,560` tokens;
  - total: `27,048` tokens;
  - cost: `$0.1189760`;
  - quality: SAME;
  - cost: BETTER.
- Confirmed downstream compatibility through Opportunity Priority, Ghost Job Risk, and Final Recommendation.
- Made Resume Match Optimization #2 the new accepted Resume Match baseline.

### JD Reconstruction Optimization #2

- Tested more aggressive sparse-omission variants.
- Rejected v6 because cost improved but semantic quality degraded.
- Rejected v7 because quality degraded and cost increased.
- Retained JD Reconstruction State2 as the accepted baseline.

### JD Reconstruction Optimization #1

- Compacted provider schema and provider-visible payload.
- Restored application-owned metadata deterministically after provider output.
- Reduced:
  - provider schema from `11,395` to `6,361` bytes;
  - production payload from `6,015` to `2,949` bytes.
- Accepted State2 at `$0.0542460`.

### Resume Match Optimization #1

- Compacted the provider-facing Resume Match transport.
- Corrected regressions affecting startup safeguards and narrative citation behavior.
- Reduced:
  - input tokens by `35.12%`;
  - total tokens by `30.92%`;
  - cost from `$0.1714280` to `$0.1372300`.
- Commit:
  - `7ec73f8 perf: compact resume match provider transport`

---

## Terra/Luna Routing and Semantic Stabilization

### Final accepted routing

- Deterministic:
  - Hard Filters
  - Ghost Job Risk when no objective posting-history evidence is available
  - Final Recommendation
- GPT-5.6 Terra:
  - JD Reconstruction
  - Resume Match
- GPT-5.6 Luna:
  - Job Evaluation
  - Company Alignment
  - Organizational Maturity
  - Alex Fit
  - Burnout Risk
  - Opportunity Priority

### Final accepted mixed-model evaluation

- Completed a full live mixed-model evaluation successfully.
- Final recommendation: `REVIEW`.
- Accepted evaluation ID:
  - `437dcca0-f299-4066-b8d3-fe949c124ce3`
- Completed with:
  - `8` provider calls;
  - `0` retries;
  - `0` fallbacks.
- Accepted total evaluator cost:
  - `$0.2566362`
- This run became the semantic-quality baseline for the later cost-optimization phase.

### Opportunity Priority contract repair

- Fixed invalid evidence identifiers returned by the provider.
- Replaced free-form semantic evidence labels with bounded numeric evidence indexes and deterministic restoration.
- Accepted isolated Opportunity Priority verification after the repair.

### Resume Match transport and evidence repairs

- Stabilized:
  - direct / related / transferable distinctions;
  - evidence-basis compatibility;
  - specialization safeguards;
  - job-only seniority;
  - duplicate-evidence handling;
  - assessment-local decision-impact evidence;
  - Genuine Gap and Unknown behavior.
- Added partition-integrity validation so decision-impact and assessment-only evidence references cannot overlap.
- Commits:
  - `1b1bade fix: redesign resume match decision impact transport`
  - `e9c3f47 fix: enforce resume match partition integrity`

### Terra/Luna comparison outcomes

- Retained Terra for JD Reconstruction after Luna produced:
  - inflated strengths;
  - overstated responsibilities;
  - omitted Education ownership.
- Retained Terra for Resume Match because it remained the most judgment-sensitive stage and no accepted Luna replacement was established.
- Accepted Luna for six bounded semantic stages after calibration and contract stabilization.

### Original all-Terra production baseline

- Completed the first successful full production evaluation using Terra for all semantic operations.
- Final recommendation: `REVIEW`.
- Total tokens: `125,670`.
- Estimated cost: `$0.4528088`.
- Known checkpoint:
  - `a7a0a47 feat: complete Customer Success evaluation foundation`

---

## Milestone 10 — Results Interface and Manual-JD Vertical Slice

- Completed the Customer Success results experience.
- Added:
  - evaluation request flow;
  - queued/running/completed/failed states;
  - bounded polling;
  - polling cleanup;
  - duplicate active-submission prevention;
  - persisted recommendation display;
  - strengths, concerns, Unknowns, and review conditions;
  - expandable stage details;
  - JD versus profile evidence distinction;
  - contradiction display;
  - safe JD text rendering;
  - evaluation history;
  - reevaluation behavior that preserves prior successful results;
  - accessible and responsive results UI.
- Completed the deterministic manual-JD end-to-end product flow.

---

## Milestone 9 — Production Evaluation Workflow

- Added durable PostgreSQL-backed evaluation task execution.
- Added:
  - request/status APIs;
  - worker execution;
  - task leasing;
  - retries and recovery;
  - persisted stage/evidence/recommendation state;
  - model usage recording;
  - restart-safe per-evaluation call budgets;
  - resume-from-persisted-stages behavior.
- Introduced OpenAI Responses structured-output execution.
- Added worker commands:
  - `pnpm worker:evaluations`
  - `pnpm worker:evaluations:once`

---

## Milestone 8 — Opportunity Priority, Ghost Job Risk, and Final Recommendation

- Added:
  - Opportunity Priority;
  - Ghost Job Risk;
  - deterministic final `APPLY`, `REVIEW`, or `SKIP`.
- Kept Final Recommendation outside the numbered stage sequence.
- Established deterministic `UNKNOWN` for Ghost Job Risk when objective posting-history evidence is unavailable.
- Preserved a nine-stage evaluator architecture plus deterministic finalization.
- Did not introduce a universal Overall Match score.

---

## Milestone 7 — Resume Match and Effective Seniority

- Added Resume Match as Stage 7.
- Nested Effective Seniority inside Resume Match rather than creating a separate stage.
- Added requirement-level classifications:
  - `STRONG_MATCH`
  - `TRANSFERABLE_MATCH`
  - `PARTIAL_MATCH`
  - `GENUINE_GAP`
  - `UNKNOWN`
- Added evidence-backed score/band handling and seniority classifications.
- Preserved separate JD and profile evidence validation.

---

## Milestone 6 — Alex Fit and Burnout Risk

- Added:
  - Alex Fit;
  - Burnout Risk.
- Kept Alex Fit categorical rather than percentage-based.
- Added explicit separation of:
  - direct experience;
  - related experience;
  - transferable experience.
- Added holistic burnout-risk scoring with explicit risk contributors and positive workload indicators.

---

## Milestone 5 — Company Alignment and Organizational Maturity

- Added:
  - Company Alignment;
  - Organizational Maturity.
- Reused structured maps and validated prior-stage results instead of rereading the raw JD.
- Used a holistic bounded maturity score rather than a hidden weighted formula.
- Preserved uncertainty where company facts were not established.

---

## Milestone 4 — Customer Success Domain Foundation and JD Reconstruction

- Introduced the first Customer Success-specific evaluator logic.
- Added:
  - Customer Success domain registration;
  - typed preferences;
  - JD Reconstruction;
  - Responsibility Map;
  - Requirement Map;
  - Ownership Map;
  - Hard Filters;
  - Job Evaluation;
  - Strategic Bridge Value.
- Preserved evidence, Unknowns, and contradictions.
- Reused the existing Core runner without refactoring Core for the domain.
- Established the Customer Success salary hard-filter rules and role-classification taxonomy.

---

## Milestone 3 — Shared Core Evaluation Framework

- Added the reusable domain-neutral evaluation framework.
- Added:
  - ordered stages;
  - structured stage results;
  - stage validation;
  - shared evaluation context;
  - evidence records;
  - Unknown handling;
  - contradictions;
  - retryable isolated failures;
  - evaluator/version metadata;
  - evaluation persistence.
- Kept Customer Success logic out of Core.
- Established the core principle:

> Core supplies infrastructure and execution behavior; domains supply career-specific intelligence.

---

## Milestone 2 — Manual Opportunity Ingestion and Persistence

- Added the first real product data slice:
  - manual opportunity input;
  - raw source preservation;
  - deterministic normalization;
  - field provenance;
  - PostgreSQL persistence;
  - retrieval;
  - opportunity detail UI.
- Added the initial database migration:
  - `20260812230155_init`
- Added APIs:
  - `/api/opportunities`
  - `/api/opportunities/[id]`
- Stabilized Playwright automatic server startup.
- Known commits:
  - `4d90d1e Completed Milestone platform 2`
  - `344fece Fix Playwright E2E server startup`
- Final tag:
  - `milestone-2`

---

## Milestone 1 — Repository and Platform Foundation

- Established the permanent pnpm-workspace modular monolith.
- Added:
  - Next.js;
  - React;
  - TypeScript;
  - Prisma;
  - PostgreSQL-oriented persistence;
  - Vitest;
  - Playwright;
  - Chrome-extension application boundary.
- Established separation between Core infrastructure and domain-owned logic.
- Added initial data-model foundations for opportunities, sources, companies, provenance, evaluations, evidence, contradictions, and recommendations.
- Deliberately avoided a universal Overall Match score.
- Known commit:
  - `482ecf7 Completed Milestone platform 1`
- Known tag:
  - `milestone-1`

---

## Historical Notes

- Milestone-specific details, test counts, bugs, and deferred work are documented in `MILESTONES_1_10.md`.
- Evaluator routing, live evaluation history, request IDs, optimization details, rejected candidates, and current completion status are documented in `EVALUATOR_STATUS.md`.
- PRDs describe intended product behavior.
- TDDs describe technical architecture and implementation contracts.
- The Semantic Evaluation Implementation Playbook records evaluator engineering and verification practice.
