# Current Progress

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** October 11, 2026

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

#### Organizational Maturity mixed-state stabilization — October 10, 2026

- Completed the full affected-subsystem audit and 11-assessment compatibility matrix.
- Corrected two Category-A assumptions: the over-broad missing-information conclusion guard and the evidence-identity contradiction assumption.
- Replayed five preserved Organizational Maturity outputs with the intended pass/fail behavior.
- Passed the full affected-path success proof through Burnout Risk, Opportunity Priority, and deterministic recommendation.
- Passed non-retryable failure-injection proof with downstream isolation and prior-stage preservation.
- Passed the full unit suite, typecheck, Prisma validation, changed-file lint, and diff-integrity checks.
- No provider calls or database mutations were performed.
- Next gate: one final paid acceptance rerun after explicit authorization is provided.

#### Resume Match evidence-partition stabilization — October 11, 2026

- Replaced independently authored decision-impact and assessment-only evidence arrays with one provider-visible assignment collection whose entries have exactly one purpose.
- Preserved fail-closed checks for duplicate provider identities, restored Core-identity collisions, unresolved references, wrong-source evidence, and cross-purpose overlap.
- Tightened Genuine Gap eligibility so requirement-relevant affirmative absence evidence is required; missing or unrelated evidence remains Unknown.
- Bound source-specific Resume Match evidence fields to the correct JD or profile provider catalogs while retaining source-neutral fields where the domain permits either source.
- Replayed the latest failed live response, the grouped-citation response, and preserved historical results offline; the invalid overlap remains rejected while persisted historical domain results remain readable.
- Proved the valid offline path through Resume Match, Opportunity Priority, and deterministic finalization, plus non-retryable downstream isolation for invalid Resume Match output.
- No provider calls, live evaluations, or database mutations were performed.
- Next gate: one final paid acceptance rerun after review, commit, and explicit authorization.

#### Provider-prose semantic closure — October 11, 2026 (Claude)

- Principle applied: no acceptance decision depends on provider-authored wording; prose is display-only.
- Organizational Maturity: removed the missing-information regex, clause splitting, and token-overlap coverage/contradiction gates (the source of `ORGANIZATIONAL_MATURITY_MIXED_STATE_INVALID` in evaluation `8c77e46f`). Acceptance now uses only evidence state, semantic impact, impact-evidence membership, NOT_ESTABLISHED neutrality, and evidence resolution. Provider schema and prompt version `cs-organizational-maturity-v7` are byte-identical.
- Resume Match: narrative citations are display-only (well-formed resolvable tokens are translated; nothing in prose rejects). Genuine Gap proof now has its own provider-visible `gapEvidence` collection drawn only from the requirement's precomputed eligible records, disjoint from ordinary profile evidence, so the former hidden conversion check is in the grammar. Legacy grouped outputs are split deterministically. Schema grows only when gap-eligible records exist (representative case 36,985 → 38,078 bytes).
- JD Reconstruction: removed the exclusion-vocabulary regex from ABSENT acceptance; typed `absenceBasis`, EXPLICIT/CONFIRMED evidence, and verbatim source grounding remain.
- Final Recommendation: strengths/concerns/contradictions now merge only records identical in wording and evidence, so evidence references no longer disappear when distinct findings share wording.
- Added `tests/unit/customer-success-semantic-closure.test.ts`: full production-executor path with grounded requirements and a Genuine Gap, end-to-end wording invariance across all eight semantic stages, the `8c77e46f` shape, 15 structural failure injections, and a static guard pinning every remaining text dependency.
- Open: Resume Match direct-work, startup, and Genuine Gap relevance legality are still derived (pre-generation, grammar-encoded) from JD Reconstruction requirement wording; the uploaded raw responses for `8c77e46f` and `cdb1dc32` did not reach the session, so corpus replay is outstanding.
- 681 unit tests, typecheck, Prisma validation, changed-file ESLint, and diff check pass. No provider calls, live evaluations, or database mutations.

#### Structured requirement specialization and real-artifact replay — October 11, 2026 (Claude)

- Replayed the preserved live request/response pairs offline (`tests/unit/customer-success-live-artifact-replay.test.ts`, artifacts via `LIVE_REPLAY_DIR`, never copied into the repository). Fidelity checks: Organizational Maturity relationship catalog and provider schema are byte-identical to the request; Resume Match provider catalogs and requirement projection are reproduced exactly; the pre-refactor commit reproduces the exact live `ORGANIZATIONAL_MATURITY_MIXED_STATE_INVALID` message.
- Organizational Maturity `8c77e46f` now converts; removing the repeatability sentence yields the identical structured result.
- Resume Match `cdb1dc32` remains invalid for one structural reason only: requirement 0 reuses `profile-6` across decision-impact and assessment-only purposes. Narrative citations (69 grouped citations) are translated and never decide acceptance.
- JD Reconstruction `cs-jd-reconstruction-v4` adds structured `requiresDirectWorkExperience` and `requiresStartupExperience` per requirement (optional in the persisted domain for historical maps, which carry no specialization semantics). Resume Match direct-work and startup legality now use only those fields.
- Genuine Gap relevance is the provider's structured `gapEvidence` selection; requirement-term overlap was removed. Gap proof must still be an affirmative limitation statement from the user's own profile. Consequence seen in the replay: gaps 10 and 11 citing a SaaS-employment disclaimer are now structurally valid, so relevance quality must be reviewed in the live diagnostic.
- Closure tests extended: requirement wording changes do not change legality; flipping only the structured fields does. 687 tests (with artifacts), typecheck, Prisma validation, changed-file ESLint, and diff check pass. No provider calls, live evaluations, or database mutations.

#### JD Reconstruction specialization category binding — October 12, 2026 (Claude)

- Live finding (Codex, local run): the INDUSTRY requirement "Experience working with nonprofit or SMB customers" came back with `requiresDirectWorkExperience: true`. Cause: the provider grammar put both specialization booleans on every requirement while "EXPERIENCE only" existed only in prose, the domain stored the value, and Resume Match silently honored it only for EXPERIENCE.
- Fix (`cs-jd-reconstruction-v5`): the fields now exist only on EXPERIENCE requirement branches of the provider grammar; non-EXPERIENCE requirements convert with both false; the persisted requirement schema rejects specialization on non-EXPERIENCE categories. INDUSTRY keeps its direct-specialization legality through category. The added instruction sentence was removed, so instructions are byte-identical to v3.
- Regression coverage: grammar rejection for every non-EXPERIENCE category, the exact live shape as end-to-end failure injection, domain invariant, conversion, and INDUSTRY legality. 690 tests (693 with replay artifacts), typecheck, Prisma validation, changed-file ESLint, and diff check pass. No provider calls.

#### Requirement-relative evidence relevance — October 12, 2026 (Claude, uncommitted pending review)

- Live finding (Codex, `7149563`): six Genuine Gaps cited one SaaS-employment scope statement, zero positive matches, while four explanations said the requirement was met. Root cause: requirement directness (`requiresDirectWorkExperience`, relative to the stated work) was compared with profile labels relative to Customer Success, so "2+ years customer-facing" (marked direct) had no positive option at all; and gap proof was any negatively worded profile record, relevant to every requirement.
- JD Reconstruction (`cs-jd-reconstruction-v6`, in place): EXPERIENCE requirements carry `minimumExperienceSpecificity` on the Customer Success ladder plus `ANY_WORK_EXPERIENCE`; the direct-work boolean is retired (still readable in persisted results, no semantics). Instructions unchanged. A current Resume Match execution given a persisted map whose JD Reconstruction EXPERIENCE requirements lack a level fails closed (`RESUME_MATCH_PREREQUISITE_OUTDATED`, before any provider call) instead of assuming a level; deterministically extracted requirements state no level, get no ladder gating, and admit no gap.
- Resume Match (`cs-resume-match-v3`, in place): strong matches must reach the requirement's ladder level with labels the cited record can establish; `REQUIREMENT_SPECIFIC` expresses direct matches on non-ladder subjects (remote work, process improvement). Identical variants across requirement groups are emitted once.
- Profile: optional structured `limitations` (category, and for EXPERIENCE the disclaimed ladder level). Gap proof must be a limitation of the requirement's category whose level covers the requirement; the profile-text gap regex is removed; without limitations, gaps are unavailable and requirements stay Unknown. The canonical profile's scope boundary moved from `experience` to `limitations`, keeping only its factual statement (the classification guidance sentence was removed).
- Exact replay of `7149563`: all six live gaps rejected; correct positives for requirements 0, 5, 7 and 13 and a partial for 1 convert end to end; with the migrated profile, only requirement 1 admits the SaaS gap; requirement 15 stays Unknown.
- 699 tests (703 with replay artifacts), typecheck, Prisma validation, changed-file ESLint, and diff check pass. No provider calls.

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

Remaining non-evaluator product work is to be completed in parallel.

The exact outstanding task list should be pulled from the current repository / Codex architecture history before being expanded here.

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
