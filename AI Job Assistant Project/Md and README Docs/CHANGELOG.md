# Changelog

All notable project changes for the AI Job Assistant are documented here.

This changelog summarizes major implementation milestones and evaluator evolution. Detailed historical implementation records live in `MILESTONES_1_10.md` and `EVALUATOR_STATUS.md`.

---

## Unreleased

Entries are newest first. The October 15 entries below describe the project as of October 15, 2026. The entries marked "added October 16, 2026" were recovered from Git history and the branch records. The Task 9 entry was added when Task 9 closed on October 16, 2026. The Features 1–10 Gap Closure entry was added at its closeout on October 17, 2026. The Feature 11A entry was added at its closeout on October 18, 2026.

### Feature 11A — automated retrieval from the verified official API and feed sources (October 18, 2026)

- **Collection framework** (`packages/discovery`): the source-adapter contract.
  - **Transport:** injectable, with an identifying User-Agent, a 20 s timeout, a hard 10 MB ceiling (refused, never truncated), no cookies and no redirects followed.
  - **Politeness:** at least 1 s between requests to a host, and a stop on 429 (`RATE_LIMITED`) or 401/403 (`ACCESS_DENIED`).
  - **Other pieces:** credential redaction, an RSS reader, title-term matching and a material-field content hash.
- **Verified adapters:** Greenhouse, Lever, Ashby, SmartRecruiters, Remote OK, We Work Remotely, Himalayas (cursor paging) and Working Nomads. Each was verified with one approved live request and a committed fixture of at most three items with metadata; SmartRecruiters with `BoschGroup` after `Visa` returned an empty board. SmartRecruiters pages its list by offset (verified with one approved page-2 request) up to the 5-page cap, so a run sees at most the newest 500 postings, and spends its 25 detail requests per run on unseen postings first (oldest first), then on stored postings by oldest last check. Adzuna is registered but unverified and disabled.
- **Discovery and normalization:** only listings whose title contains a Customer Success role-family term are kept, with the full description. A retrieved-listing normalizer records DIRECT provenance for structured facts. Salary is normalized only as one annual range with a known currency; residency only from explicit statements; time zones never.
- **Storage and ingestion** (migration `20261018090000_retrieval_sources`, additive):
  - `RetrievalSource` and `RetrievalRun`. Sources or runs with history are archived, never deleted.
  - Re-observation: an unchanged listing only moves last-seen times, and a changed one adds a linked observation while the original description stays.
  - Canonical-link precedence: employer ATS over job board over aggregator, and a manual link is never replaced.
- **Deduplication engine `core-dedup-v2`:** source-scoped listing IDs, with listing-ID conflicts only within one source.
- **Worker, UI and tooling:**
  - `pnpm worker:retrieval`: a single worker, a 12-hour default schedule, sources disabled until enabled, per-listing failure isolation and no automatic evaluation.
  - `/sources` with run history; "Found via" and "Listing changed" on the dashboard and opportunity page.
  - `pnpm sources:verify`, and read-only retrieval checks in `pnpm app:doctor`.
- **New versioned specifications:** Core AI Framework PRD v1.7, Customer Success AI Assistant PRD v1.6, Core Platform TDD v1.8 (§51 "Automated Retrieval (Feature 11A)") and Customer Success Assistant TDD v1.6 (dated implementation notes in §6–§8 and §49). The previous versions moved unchanged into `Archive/`; the Semantic Evaluation Playbook is unchanged (v1.3).

### Features 1–10 Gap Closure (October 17, 2026)

- A read-only audit of main-product features 1–10 against the current PRDs/TDDs found that feature 9 (deduplication with provenance retention) was missing, plus smaller gaps in features 2, 3, 6, 7 and 8. The gap closure addresses them; there is no task number by decision.
- **Deduplication** (`packages/deduplication`, engine `core-dedup-v1`):
  - **MATCH:** the same listing URL with nothing conflicting, or the same job/requisition ID at the same company. An exact re-capture is attached to the saved opportunity as another source instead of becoming a second opportunity.
  - **PROBABLE_MATCH:** confidence-scored. The opportunity is created and the pair is recorded for review; nothing is merged on a probable match.
  - Capture is one transaction (raw source record, decision, create or attach); a normalization failure still preserves the raw record.
  - "Not the same job" (`DISTINCT`) is reversible.
  - Existing opportunities are never merged retroactively.
- **Duplicate-spend guard:** a paid evaluation request or deferred resume is refused (409 `DUPLICATE_LISTING_ALREADY_EVALUATED`) while an exact duplicate already has an evaluation, admission or deferral. The check and admission are serialized by an advisory lock, closing the race between simultaneous requests. The Task 6 admission gate is unchanged.
- **Companies:** reused by normalized name, with the typed spelling kept in provenance; one dashboard company-filter entry per company. `pnpm db:backfill-dedup [--dry-run]` is explicit, additive and idempotent, and is not part of `pnpm app:setup`; `pnpm app:doctor` reports when it is needed.
- **Also:**
  - versions on evaluation-history rows;
  - an optional user-stated time-zone requirement, withheld from the evaluator;
  - AI usage and spend by domain and source on `/budget`;
  - phone-width overflow fixes on the opportunity page and `/profile`.
- **Migration:** `20261017120000_deduplication`, additive only.
- **New versioned specifications:** Core AI Framework PRD v1.6, Customer Success AI Assistant PRD v1.5, Core Platform TDD v1.7 and Customer Success Assistant TDD v1.5. Their status sections and the Core TDD §51 deduplication summary are updated; the requirements are unchanged. The previous versions moved unchanged into `Archive/`. The Semantic Evaluation Playbook is unchanged (v1.3).
- **Verification** (isolated test database, no paid calls): unit 1,128, integration 223, E2E 32/32. No evaluator internals, routing, prompts or recommendation logic changed.
- Commit: `feat: close features 1–10 gaps` on `claude/gallant-pasteur-y1ou3i`.

### Post-Task-9 versioned specification update (October 16, 2026)

- New current versions: Core AI Framework PRD v1.5, Customer Success AI Assistant PRD v1.4, Core Platform TDD v1.6, Customer Success Assistant TDD v1.4 and Semantic Evaluation Playbook v1.3.
- The previous current PRD/TDD versions moved unchanged into the `Archive/` folders; Playbooks v1.1 and v1.2 stay beside v1.3.
- Core AI Framework PRD v1.5 and Customer Success PRD v1.4: current status after the Task 1–9 completion pass, and the evaluator-branch semantic-contract repairs noted as effective at final integration. Product requirements are unchanged.
- Core Platform TDD v1.6:
  - documents the `USAGE_LIMIT_REACHED` deferral reason and the legacy `BUDGET_UNAVAILABLE` mapping;
  - completes the neutral "eligible for evaluation" wording;
  - adds implementation-status summaries for the application tracker and for the operations and worker model.
- Customer Success TDD v1.4: a per-branch table of evaluator contract versions and the October 10–13 evaluator-branch rules, effective at final integration. The evaluation design body is unchanged until then.
- Semantic Evaluation Playbook v1.3 adds §14 with the October 10–13 semantic-contract rules (on `codex/evaluator-live-diagnostic`), plus dated notes in §11 and §13.
- `AGENTS.md` and `CLAUDE.md` point to the new versions. Documentation only; no code, test, database or provider activity.

### Task 9 completion — operational hardening (October 16, 2026)

- Completed the audit-first completion pass over the October 10 Task 9 operations work. The worker loop, single-worker lock, task claiming, recovery, error classification, backoff, shutdown, queue states, AI-configuration handling, health behavior, public evaluation API, navigation and acceptance tests were audited as complete and left unchanged.
- `POST /api/opportunities` and `GET /api/opportunities/[id]` now log only the error name, like every other route; response bodies are unchanged.
- `pnpm app:doctor` reports requests waiting for the AI budget (including legacy `BUDGET_UNAVAILABLE` rows) separately from those waiting for usage limits (`USAGE_LIMIT_REACHED`). It remains a single read-only query.
- E2E runs always use a deterministic, non-live `OPENAI_API_KEY` (`playwright.config.ts`, `e2eEnvironment()`), so the runner, its helpers and the web server never inherit a real key from `.env`.
- New unit tests cover `/api/health` (200 and 503 with no error detail), error-name-only logging in both routes, and the E2E credential; the integration suite checks the doctor's per-reason deferral counts. `vitest.config.ts` resolves the web app's `@/` alias.
- The root `README.md` documents usage-limit deferrals, the E2E credential, and the single-worker lock's connection-loss caveat (the lock holds only while its database connection stays up; documented, not changed).
- No migration; no queue, worker, lease, routing, prompt or evaluator change. Verified on an isolated test database with no paid calls: unit 1,086, integration 192, E2E 27/27.
- Commit: `feat: complete operational hardening` on `claude/gallant-pasteur-y1ou3i`.

### Task 8 completion — application tracker (October 16, 2026)

- Completed the audit-first completion pass over the October tracker; the stages, outcomes and lifecycle model are unchanged.
- Calendar dates:
  - applied and closed dates cannot be later than the current UTC date;
  - a close cannot precede the applied date;
  - an applied-date correction cannot follow the closed date;
  - refusals return `APPLICATION_DATE_INVALID` (400) with no trace.
- Follow-ups can be rescheduled and reworded through the versioned `updateFollowUp` command, recorded as a `FOLLOW_UP_UPDATED` event. Additive migration: `20261017090000_application_follow_up_updated`.
- Interviews have full editing; the status can be chosen when adding; "Move to Interviewing?" appears only for a non-cancelled interview.
- Only open applications of non-archived opportunities have a next action. The rule applies consistently to follow-up filters, tracker tiles, the next-action sort, dashboard badges and the "Follow-ups due" count.
- `/applications`:
  - an outcome or Closed filter under Active widens the view to All;
  - empty results recover inside the tracker.
- Stale writes:
  - typed input is kept on every refusal;
  - "Load latest" is offered only for state and concurrency conflicts.
- Tracking refusals name the opportunity's state; the opportunity page shows a load-error notice.
- The guarded lifecycle path and the evaluator are unchanged. Verified on an isolated test database with no paid calls (E2E 27/27).
- Commit: `534a4c7` on `claude/gallant-pasteur-y1ou3i`.

### Final evaluator routing lock (October 15, 2026)

- Kept deterministic execution for Hard Filters, Ghost Job Risk when objective posting-history evidence is unavailable, and Final Recommendation.
- Kept GPT-5.6 Terra for JD Reconstruction and Resume Match.
- Kept GPT-5.6 Luna for Job Evaluation, Organizational Maturity, Alex Fit, and Opportunity Priority.
- Routed Company Alignment and Burnout Risk to GPT-6 Luna.
- Rejected GPT-6 Luna for Job Evaluation after the isolated benchmark changed Strategic Bridge Value from `HIGH` to `MODERATE` and omitted established process-development evidence.
- Skipped the remaining GPT-6 stage benchmarks by explicit product decision and locked the routing policy rather than continuing paid experimentation.
- Final live/whole-product acceptance remains deferred until the evaluator and all intended main-product work are integrated.
- Branch state: the GPT-6 Luna routes are implemented on `codex/evaluator-live-diagnostic`; `claude/gallant-pasteur-y1ou3i` keeps the earlier accepted routing until final integration.

### Task 6 completion — AI budget and usage controls (October 14, 2026)

- Completed the persistent monthly AI budget ledger, atomic reservation/reconciliation, configurable warning thresholds, daily/weekly evaluation-volume limits, monthly output-token limits, budget deferral/resume/cancel flow, usage reporting, and dashboard capacity/cost visibility.
- Standardized dollar-budget deferrals on `AI_BUDGET_LIMIT`; throughput/token limits use `USAGE_LIMIT_REACHED`.
- Preserved unknown provider usage as Unknown rather than coercing it to zero.
- Accepted the product decision that already-admitted queued/running evaluations are not retroactively cancelled when limits are lowered.
- Checkpoints: `267138a` and naming cleanup `8d3993a`.

### Task 7 completion — normalized opportunity facts (October 14, 2026)

- Added deterministic normalization and persistence for salary minimum/maximum, currency, work arrangement, seniority, department, employment type, closing date, residency requirement, and residency regions while preserving raw text and field provenance.
- Added supported residency geography codes for countries, U.S. states/DC/Puerto Rico, Canadian provinces/territories, UK nations, and broad regions such as EU, EEA, EMEA, APAC, LATAM, and WORLDWIDE.
- Preserved Unknown for ambiguous geography, ordinary city/location text, conflicting currencies, non-annual compensation, OTE, and unsupported cases.
- Added the bare-`$` USD provenance marker while keeping explicit currency authoritative.
- Added dashboard salary/filter/sort support and residency-aware persisted data without silently changing evaluator behavior during Task 7.
- Final Task 7 checkpoint: `754f956dc0860149760936a61bdace0489404b9a` on `claude/gallant-pasteur-y1ou3i`.

### Milestone 4 completion alignment — salary policy and Task 7 contract (October 15, 2026)

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

### Product completion planning (October 15, 2026)

- Main-product scope is features 1–18. Retrieval, source health, posting-history intelligence, the browser extension, source intelligence, market analytics, personal job-search analytics, and company intelligence are part of the intended main product rather than optional post-product add-ons.
- Only features 19–23 remain later add-ons: company watchlists, proactive notifications/follow-ups, calendar integration, email integration, and application-assistance features.
- The current sequence is: finish the Task 1–9 completion pass (Task 8 next, then Task 9), build any still-missing main-product features 1–18, then perform final evaluator/product integration, whole-product acceptance, and deliberate freeze/merge.
- Retrieval work may begin after the evaluator and manual product are stable enough to support it, but final product acceptance does not occur until all intended main-product features are complete.
- Kept evaluator and main-product workstreams separated to reduce architectural drift.

### Profile limitations and policy readiness (October 14, 2026; added October 16, 2026 from Git)

- Persisted optional structured profile `limitations` (`UserProfile.limitations`) and delivered them to the evaluator subject without loosening the installed profile contract. Commit `96c6eb1`.
- Removed a stale execution-policy pin and prepared the profile/policy integration; `pnpm app:doctor` reports the evaluator's built-in policy version. Commit `35b8265`.

### Evaluator semantic-contract stabilization (October 10–13, 2026; evaluator branch, not merged; added October 16, 2026 from Git)

- Recorded on `codex/evaluator-live-diagnostic`; not part of the main-product branch until final integration.
- Changes:
  - provider prose is display-only;
  - Genuine Gap proof uses structured `gapEvidence` and structured profile limitations;
  - requirement-relative experience levels;
  - structured `requirementStatements` with deterministic reconciliation;
  - requirement-relative INDUSTRY evidence;
  - Unknown without supported or unsupported portions;
  - a fail-closed `RESUME_MATCH_PREREQUISITE_OUTDATED` gate.
- Contract identifiers on that branch: `cs-jd-reconstruction-v7`, `cs-resume-match-v4`, `cs-organizational-maturity-v7`.
- Commits:
  - `ba95d76` (Oct 11, work-in-progress handoff; introduces the GPT-6 Luna policy code);
  - `04611af` and `1c09924` (Oct 11);
  - `7149563` and `f29530c` (Oct 12);
  - `067c5dc` (Oct 13).
- Offline verification only. Final paid acceptance and current-contract cost measurement remain outstanding. See `EVALUATOR_STATUS.md` §20.

### Main-product Tasks 1–9: initial implementation (October 6–7, 2026; added October 16, 2026 from Git)

Commit dates are from Git. The task records in `CURRENT_PROGRESS.md` and `HANDOFFS.md` carry dates from October 6 to October 10; those record dates are preserved as written.

- October 6:
  - opportunity dashboard and Domain default (`ccd3761`);
  - evaluator test-harness repair (`a0e225c`);
  - evaluation-experience correctness under failure and delay (`0639785`);
  - evaluation of any normalized opportunity (`27c897e`);
  - opportunity lifecycle and user actions (`f129d40`);
  - AI usage and estimated-cost display (`440306a`);
  - job provenance foundation (`26dbdb5`);
  - agent-guide documentation paths (`e3e6d5e`).
- October 7:
  - Task 5, profile and preferences management with an explicit active version (`68f25c9`);
  - Task 6, AI budget ledger with deferral and request-integrity admissions (`ccd80c9`);
  - Task 7, dashboard search, filters, sorting, pagination and summaries (`a0d99a5`);
  - Task 8, application tracker beside the opportunity lifecycle (`f884b72`);
  - Task 9, final setup, operations hardening and whole-product acceptance (`b7f7e87`).

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
