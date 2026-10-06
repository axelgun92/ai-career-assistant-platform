# Changelog

All notable project changes for the AI Job Assistant are documented here.

This changelog summarizes major implementation milestones and evaluator evolution. Detailed historical implementation records live in `MILESTONES_1_10.md` and `EVALUATOR_STATUS.md`.

---

## Unreleased

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
