# Development Plan

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** October 17, 2026

## Goal

Complete the full intended main product while preserving a usable manual workflow throughout development. Automated retrieval is part of the main product, not a later optional add-on, and final product acceptance occurs only after main-product features 1–18 are complete.

The manual workflow does not depend on automated retrieval: a user can enter an opportunity manually, evaluate it, review the persisted recommendation and evidence, and use the product meaningfully. Retrieval work must not destabilize that foundation.

## Current Development State

- The Customer Success evaluator architecture, optimizations, and routing policy are established.
- Final routing is locked; Company Alignment and Burnout Risk use GPT-6 Luna, while the remaining accepted routes stay unchanged.
- Task 7 normalized salary/currency/residency facts are complete at `754f956dc0860149760936a61bdace0489404b9a`.
- Codex Milestone 4 has consumed that contract and aligned the Customer Success salary policy at `267124f`.
- Task 8 — Application Tracker completion pass is complete at `534a4c718b21086d9419c0b0d18b0c907c15b3f9`.
- Task 9 — Operations hardening completion pass is complete (commit `feat: complete operational hardening`, October 16, 2026).
- The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete (October 16, 2026).
- The features 1–10 gap audit is complete (October 17, 2026). The Features 1–10 Gap Closure is implemented and verified and awaiting review (not committed). Main-product features 11–18 follow.
- Final whole-product integration/testing/freeze is intentionally deferred until all intended main-product work is complete.

**Branch state:** the routing lock, the October 10–13 evaluator semantic-contract repairs and the Milestone 4 alignment (`267124f`) are on `codex/evaluator-live-diagnostic`; the main-product work (including Tasks 7, 8 and 9) is on `claude/gallant-pasteur-y1ou3i`. Neither is merged into `main`. Until the final integration pass, the Claude branch keeps the earlier routing (GPT-5.6 Luna for Company Alignment and Burnout Risk) and withholds all ten Task 7 fields from the evaluator.

*(Earlier development order, superseded on October 15, 2026: Finish Evaluator + Finish Remaining Main Product → Integrate into a Stable Usable Product → Build Retrieval / Scraper → Expand Discovery, Analytics, and Domains. Retrieval and intelligence are now main-product features 11–18, completed before final acceptance.)*

## Accepted Development Order

```text
1. Finish evaluator implementation / corrections
        +
2. Finish core main-product completion pass (features 1–10)
        ↓
3. Build remaining main-product retrieval and intelligence (features 11–18)
        ↓
4. Final evaluator + product integration, acceptance, freeze, and deliberate merge
        ↓
5. Later add-ons (features 19–23)
```

The evaluator and main-product workstreams may progress in parallel as long as ownership boundaries remain explicit.

## Phase 1 — Evaluator Implementation and Corrections

The evaluator should remain stable while only demonstrated correctness/contract issues are addressed.

### Current state

- Resume Match Optimization #2 is the accepted Resume Match optimization baseline.
- JD Reconstruction State2 remains the accepted JD Reconstruction optimization baseline.
- The accepted cost figures (`EVALUATOR_STATUS.md` §13) belong to those baselines. The evaluator branch has since changed the JD Reconstruction and Resume Match contracts (`cs-jd-reconstruction-v7`, `cs-resume-match-v4`). The cost of the current contracts is unmeasured until an authorized run at final integration.
- Final routing policy is locked:
  - **Deterministic:** Hard Filters; Ghost Job Risk when objective posting-history evidence is unavailable; Final Recommendation.
  - **GPT-5.6 Terra:** JD Reconstruction; Resume Match.
  - **GPT-5.6 Luna:** Job Evaluation; Organizational Maturity; Alex Fit; Opportunity Priority.
  - **GPT-6 Luna:** Company Alignment; Burnout Risk.
- Milestone 4 now consumes the Task 7 salary/currency/residency contract.
- Both the GPT-6 Luna routes and the Milestone 4 alignment are on `codex/evaluator-live-diagnostic` and reach the product only at final integration.

### Evaluator rules

- Preserve established architecture, schemas, evidence behavior, Unknown handling, contradictions, and recommendation semantics.
- Do not fix only the latest observed symptom; treat an affected evaluator path as one contract from provider response through transport, conversion, validation, persistence, and downstream consumption.
- Optimize for the quality/cost sweet spot offline before paid verification.
- Never reduce required semantic quality merely to lower cost.
- Compare every candidate against the last known-good implementation as **BETTER / SAME / WORSE** on required quality and structural cost.
- Accept a candidate when it provides the same or better required quality at the same or lower total cost.
- Do not accept higher cost unless the additional quality is genuinely required.
- Keep paid provider actions explicitly authorized.
- Preserve isolated live-test safeguards: fresh checkpoint, at-most-once operation, single-stage scope free from unrelated semantic calls, zero retry, zero fallback, no normal-database mutation.
- Do not rerun already-settled model benchmarks without a demonstrated reason.
- Final full live acceptance belongs to the later whole-product integration phase.

## Phase 2 — Complete Main-Product Features 1–10

The completion pass audits existing work against the authoritative PRDs/TDDs and adds only missing, incomplete, or newly established requirements. It is not a redesign pass.

### Core main-product scope

1. Full opportunity dashboard.
2. Search, sorting, and filtering.
3. Evaluation history.
4. Application tracker.
5. Saved/rejected/archived organization.
6. Manual job capture.
7. AI usage and cost dashboard.
8. Job source/provenance preservation.
9. Deduplication with provenance retention.
10. Persistent backlog plus budget-aware evaluation.

### Current sequence

- Tasks 1–9 have completed their current completion work (Task 8 at `534a4c7`; Task 9 on October 16, 2026).
- **Done:** the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update (Core AI Framework PRD v1.5, Customer Success PRD v1.4, Core Platform TDD v1.6, Customer Success TDD v1.4, Semantic Evaluation Playbook v1.3).
- **Done:** the read-only audit of features 1–10 (October 17, 2026). It found the feature 9 deduplication gap and smaller gaps in features 2, 3, 6, 7 and 8.
- **Now:** the Features 1–10 Gap Closure, implemented and verified and awaiting review. It reuses the existing ingestion boundary; feature 11 extends the same capture transaction and deduplication engine to retrieved sources, adding cross-source matching, canonical-source selection, posting history and any merging of opportunities with history.

### Completion-pass rule

For each task:

- classify requirements as complete, partial, missing, inconsistent, or intentionally out of scope;
- preserve working implementation when it already satisfies the requirement;
- update the current implementation directly when a final requirement changed;
- do not bolt a parallel “amendment subsystem” onto obsolete behavior;
- use only isolated/offline testing unless a paid/live action is explicitly authorized;
- never use the normal application database for experiments or test validation;
- consume the evaluator as an existing product boundary rather than redesign it.

## Phase 3 — Build Main-Product Features 11–18

These features are part of the intended main product and must be complete before final product acceptance.

11. Automated job discovery/retrieval/scraping.
12. Source health monitoring and conservative retrieval: pacing, backoff, failure isolation, freshness checks, and expiry/removal detection.
13. Ghost-job/posting-history intelligence.
14. Browser extension companion using the same backend, account, data, evaluator, lifecycle, provenance, budget, and dashboard as the main app.
15. Source intelligence: source quality, duplicate rates, reliability, cost per useful job, and outcomes by source.
16. Job-market analytics: salary, role, location, skills/requirements, seniority, and recommendation trends.
17. Personal job-search analytics: best-fit roles, recurring gaps, application-to-interview outcomes, strongest sources, and wasted effort.
18. Company intelligence: repost/frequency patterns, hiring speed, remote friendliness, response patterns, and recurring roles.

### Retrieval principles

- No second evaluator.
- Retrieval feeds the existing `RawOpportunity → Normalization → Deduplication → Domain Evaluation` boundary.
- Preserve one clear ingestion contract between retrieval and the existing Core Platform.
- Keep source retrieval separate from normalization and evaluation logic.
- Preserve every source and source provenance.
- Prefer the strongest verified collection interface for each source.
- Verify retrieval methods by evidence, not assumptions.
- Once a source is sufficiently classified under the established source/retrieval categories, stop unnecessary reverse-engineering unless additional detail is actually required.
- Use browser-assisted collection only where browser/session access is genuinely required.
- The extension is a companion client, not a separate product or dashboard.
- Do not mutate an evaluated opportunity's canonical JD/raw description in place; append observations/source records and preserve history.
- Keep deduplication upstream of paid evaluation to avoid duplicate spend.
- Source health must be conservative and respectful of each source.

## Phase 4 — Final Integration, Acceptance, and Freeze

This phase begins only after main-product features 1–18 and the evaluator implementation are complete.

The final pass should:

- deliberately combine the Claude product work and Codex evaluator work;
- resolve recorded handoffs and shared-contract differences, including the evaluator release of the Task 7 fields (`fieldsWithheldFromEvaluator` and its tests; see the October 15 annotations in `HANDOFFS.md`);
- review persisted attempts/resume behavior and pre-send/in-flight accounting risks;
- verify profile limitations and active/pinned profile behavior;
- run the full isolated test suite, typecheck, lint, build, Prisma/migration checks, and E2E acceptance, and re-run the full DB-backed integration and E2E suites whenever evaluator contracts change;
- perform any explicitly authorized final live evaluator verification;
- confirm recommendation/evidence contracts and the final routing policy;
- freeze the evaluator baseline only after acceptance;
- merge to main deliberately rather than automatically.

Final integration is not the first time known requirements should become correct. Each task should already satisfy its own final product contract before reaching this phase.

## Phase 5 — Later Add-ons Only

The following are the only currently designated later add-ons:

19. Company watchlists.
20. Notifications and proactive follow-ups.
21. Calendar integration.
22. Email integration.
23. Application assistance, including resume tailoring, cover letters, application-question help, interview preparation, and skills-gap/learning assistance.

These are not required for completion of main-product features 1–18.

Beyond these add-ons, the platform may later:

- add additional domain assistants;
- revisit other deferred product features defined in the authoritative PRDs/TDDs as justified.

## Parallel Agent Strategy

### Codex

Primary ownership:

- evaluator internals;
- evaluator-sensitive contract changes;
- model routing and pricing policy;
- deep evaluator debugging/audits;
- paid/live diagnostics and final live acceptance when explicitly authorized.

### Claude / Claude Code

Primary ownership:

- product/UI/workflow completion;
- application logic;
- profile/budget/dashboard/tracker behavior;
- retrieval architecture and most main-product implementation outside evaluator internals;
- isolated product integration tests.

### Shared rules

- The builder gets the first opportunity to debug its own code; the other agent may provide a second opinion.
- Neither agent auto-merges main.
- Shared schemas, persistence contracts, evaluator orchestration, queue/worker behavior, and ingestion/evaluator boundaries require explicit coordination.
- Agents should not edit the same files at the same time.
- Retrieval work may be split once ownership can be cleanly separated, but both agents must use one shared ingestion contract. A possible split: one agent for source retrieval/adapters; one for normalization, ingestion, deduplication, evaluator handoff, testing, and error handling. The exact split may change, but ownership must remain explicit.

## Completion Principle

The priority is not merely to make an early manual demo usable. The priority is to finish the complete intended main product without letting retrieval work destabilize the already-working evaluator/product foundation.

**Evaluator stability + features 1–10 → features 11–18 → final integration/acceptance → later add-ons 19–23**
