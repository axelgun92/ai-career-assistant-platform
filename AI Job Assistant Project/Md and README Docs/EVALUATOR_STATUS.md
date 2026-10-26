# AI Job Assistant — Evaluator Status

**Domain:** Customer Success  
**Status:** Final optimization and verification  
**Last updated:** October 5, 2026
**Addendum:** §19 (October 15, 2026) records the October 10–15 evaluator state: routing lock, GPT-6 Luna outcomes, and branch-specific work. §1–18 are preserved as written for October 5, 2026.
**Addendum:** §20 (October 16, 2026) records the evaluator-branch semantic-contract history of October 10–13. It also covers current versus superseded contracts, residual risks and outstanding verification.
**Playbook:** the §20 rules are in Semantic Evaluation Playbook v1.3 §14 (October 16, 2026).
**Current status (October 16, 2026):**

- Routing is locked and the semantic contracts were repaired on `codex/evaluator-live-diagnostic`; neither is merged.
- Final paid acceptance, current-contract cost measurement and the evaluator freeze are deferred to the final evaluator/product integration.
- October 25, 2026: Codex completed the Milestone 4 compensation-basis correction (`cs-hard-filters-v3`, `cs-salary-policy-v3-ecb-2026-10-14`), uncommitted on the same branch; see §19, "Milestone 4 compensation-basis correction".

## Purpose

This document consolidates the evaluator history from two phases:

1. Terra/Luna routing and semantic stabilization.
2. Cost optimization after the accepted mixed-model evaluator was established.

It records the accepted architecture, important failures and corrections, current cost baseline, rejected optimization paths, and the work remaining before the evaluator is frozen.

---

## 1. Evaluator Sequence

The Customer Success evaluator consists of:

1. Hard Filters / JD Reconstruction
2. Job Evaluation
3. Company Alignment
4. Organizational Maturity
5. Alex Fit
6. Burnout Risk
7. Resume Match, including Effective Seniority
8. Opportunity Priority
9. Ghost Job Risk
10. Final Recommendation

### Deterministic

- Hard Filters
- Ghost Job Risk when objective posting-history evidence is unavailable
- Final Recommendation

### Semantic

- JD Reconstruction
- Job Evaluation
- Company Alignment
- Organizational Maturity
- Alex Fit
- Burnout Risk
- Resume Match
- Opportunity Priority

Final Recommendation is deterministic application logic rather than another semantic stage.

---

## 2. Original Successful All-Terra Baseline

The first successful production baseline used GPT-5.6 Terra for every semantic operation.

- Evaluation ID: `186aa2b2-9599-4114-a429-57821c28e5a1`
- Opportunity ID: `f3f56612-3783-4cbd-8c6e-07e4680f2e55`
- Profile version: `1`
- Final recommendation: `REVIEW`
- Semantic requests: `8`
- Retries: `0`
- Total tokens: `125,670`
- Persisted estimated cost: `$0.4528088`

The `REVIEW` result was driven by unresolved country/employment eligibility and work-arrangement information. Salary and travel passed and the role was classified as Core Customer Success.

Known production-foundation checkpoint:

`a7a0a47 feat: complete Customer Success evaluation foundation`

---

## 3. Terra/Luna Routing History

The routing phase began from the working all-Terra evaluator.

### Final accepted routing from semantic stabilization

| Operation | Accepted route |
| --- | --- |
| Hard Filters | Deterministic |
| JD Reconstruction | GPT-5.6 Terra |
| Job Evaluation | GPT-5.6 Luna |
| Company Alignment | GPT-5.6 Luna |
| Organizational Maturity | GPT-5.6 Luna |
| Alex Fit | GPT-5.6 Luna |
| Burnout Risk | GPT-5.6 Luna |
| Resume Match | GPT-5.6 Terra |
| Opportunity Priority | GPT-5.6 Luna |
| Ghost Job Risk | Deterministic `UNKNOWN` when no objective history exists |
| Final Recommendation | Deterministic |

### Why Terra remained on JD Reconstruction

Luna was directly compared against Terra and showed material semantic degradation:

- inflated strengths;
- overstated responsibilities;
- omitted Education ownership.

Because JD Reconstruction feeds all later stages, Terra was retained.

### Why Terra remained on Resume Match

Resume Match was the largest and most judgment-sensitive semantic stage. Its stabilization work focused on:

- direct / related / transferable distinctions;
- evidence basis;
- specialization safeguards;
- job-only seniority;
- duplicate-evidence rejection;
- assessment-local evidence;
- Genuine Gap and Unknown behavior;
- transport/domain compatibility.

No accepted Luna replacement was established during this phase.

### Luna stages

Luna was accepted for:

- Job Evaluation;
- Company Alignment;
- Organizational Maturity;
- Alex Fit;
- Burnout Risk;
- Opportunity Priority.

Several Luna stages required calibration or provider-contract repair before acceptance. The routing decision was based on required semantic quality, not model price alone.

---

## 4. Important Mixed-Model Failures

### Opportunity Priority evidence-ID failure

The first full mixed-model run reached Opportunity Priority and failed with:

`OPPORTUNITY_PRIORITY_EVIDENCE_INVALID`

Luna returned semantic labels such as `postingTiming`, `strategicBridgeValue`, `alexFit`, and `burnoutRisk` instead of resolvable Core evidence IDs.

This was classified primarily as an evidence-reference/provider-contract defect, not a raw model-quality failure.

The provider contract was redesigned to use bounded numeric evidence indexes with deterministic restoration.

Accepted isolated Opportunity Priority verification:

- Request ID: `req_2c46c4c757844230b09a104082dbd264`
- Score: `74`
- Band: `HIGH`
- Cost: `$0.0069472`

### Resume Match partition-integrity failure

A later full mixed-model run failed in Resume Match after HTTP 200 because the same profile evidence reference appeared in both:

- `decisionImpactReferences`
- `assessmentOnlyReferences`

This was an integration-specific schema/evidence-partition problem, not primarily a Terra reasoning failure.

The correction required:

- uniqueness inside each partition;
- mutual exclusion between partitions;
- deterministic pre-domain validation;
- non-retryable duplicate failure;
- no silent deduplication or movement of evidence.

Relevant commit:

`e9c3f47 fix: enforce resume match partition integrity`

---

## 5. Final Accepted Live Mixed-Model Evaluation

Acceptance marker:

`FINAL_MIXED_EVALUATION_ACCEPTED`

- Evaluation ID: `437dcca0-f299-4066-b8d3-fe949c124ce3`
- Task ID: `c7b1e079-08b3-4417-9902-d78975573cbe`
- Provider calls: `8`
- Retries: `0`
- Fallbacks: `0`
- All provider responses: HTTP 200

### Accepted stage results

| Operation | Route | Result |
| --- | --- | --- |
| Hard Filters | Deterministic | `REVIEW` |
| JD Reconstruction | Terra | Completed |
| Job Evaluation | Luna | `CORE_CS`; Strategic Bridge Value `HIGH` |
| Company Alignment | Luna | Completed, partial |
| Organizational Maturity | Luna | `56 — MIXED_MODERATE` |
| Alex Fit | Luna | `GOOD`; `TRANSFERABLE` |
| Burnout Risk | Luna | `62 — HIGH` |
| Resume Match | Terra | `67 — GOOD_HIGH`; Seniority `MID_LEVEL`; Effective Level `STRETCH` |
| Opportunity Priority | Luna | `68 — HIGH` |
| Ghost Job Risk | Deterministic | `UNKNOWN` |
| Final Recommendation | Deterministic | `REVIEW` |

The final `REVIEW` was driven by high Burnout Risk together with unresolved hard-filter location/work-arrangement conditions.

### Cost of accepted mixed baseline

| Semantic operation | Model | Cost |
| --- | --- | ---: |
| JD Reconstruction | Terra | `$0.0558020` |
| Job Evaluation | Luna | `$0.0021890` |
| Company Alignment | Luna | `$0.0033036` |
| Organizational Maturity | Luna | `$0.0051106` |
| Alex Fit | Luna | `$0.0072216` |
| Burnout Risk | Luna | `$0.0053530` |
| Resume Match | Terra | `$0.1714280` |
| Opportunity Priority | Luna | `$0.0062284` |
| **Complete evaluation** |  | **`$0.2566362`** |

This evaluation became the semantic-quality control for cost optimization.

---

## 6. Cost-Optimization Target and Acceptance Rule

Working cost target:

**approximately `$0.10–$0.15` per completed evaluation**

Every candidate is compared against the last known-good accepted implementation.

Comparison labels:

- `BETTER`
- `SAME`
- `WORSE`

Governing rule:

> Keep a candidate only if it delivers the same or better required quality at the same or lower total cost.

A cheaper candidate that weakens required semantic behavior is rejected.

A higher-cost candidate is accepted only when the additional quality is genuinely required.

---

## 7. Required Semantic Safeguards

Optimization must preserve:

- evidence grounding;
- provenance;
- Unknowns;
- contradictions;
- direct / related / transferable distinctions;
- specialization safeguards;
- seniority safeguards;
- no invented SaaS employment;
- no invented literal Customer Success employment;
- requirement identity and order;
- source-separated evidence;
- downstream compatibility.

Working rule:

> Never sacrifice required semantic quality merely to reduce cost.

---

## 8. Optimization and Paid-Verification Workflow

### Offline before live

1. Identify the structural cost source.
2. Build the candidate offline.
3. Measure schema/request changes.
4. Replay known-good accepted responses.
5. Run compatibility and negative tests.
6. Confirm downstream compatibility.
7. Compare against the last known-good state.
8. Perform one isolated paid verification only when the candidate is ready.

Offline replay proves representability and conversion compatibility. It does **not** prove that the model will independently produce equally good semantics under the changed provider-visible contract.

### Paid-call rules

Every paid provider action requires explicit authorization in the main task prompt.

For isolated verification:

- fresh checkpoint;
- one authorized stage only;
- zero retries unless explicitly authorized;
- zero fallback unless explicitly authorized;
- no DB mutation;
- no worker/queue/full-evaluation execution;
- save raw response, request ID, usage, and cost immediately.

If request/send state becomes ambiguous:

> Stop. Do not resend.

---

## 9. Resume Match Optimization #1

### Pre-optimization baseline

| Metric | Baseline |
| --- | ---: |
| Input tokens | `44,830` |
| Reasoning tokens | `499` |
| Output tokens | `6,814` |
| Total tokens | `51,644` |
| Cost | **`$0.1714280`** |

### Change

The provider-facing Resume Match DTO was compacted.

Accepted commit:

`7ec73f8 perf: compact resume match provider transport`

Regressions discovered and corrected:

- startup safeguard behavior;
- narrative citation behavior.

### Accepted result

| Metric | Baseline | Optimization #1 |
| --- | ---: | ---: |
| Input tokens | `44,830` | `29,087` |
| Total tokens | `51,644` | `35,675` |
| Cost | `$0.1714280` | **`$0.1372300`** |

Reductions:

- input: `−35.12%`
- total tokens: `−30.92%`
- cost: `−$0.0341980`
- cost reduction: approximately `19.95%`

Quality remained accepted.

---

## 10. JD Reconstruction Optimization #1

### Change

The provider schema/transport was compacted and application-owned metadata was restored deterministically after provider output.

Structural reduction:

- provider schema: `11,395 → 6,361` (`−44.2%`)
- production payload: `6,015 → 2,949` (`−51.0%`)

Accepted repaired state:

**JD Reconstruction State2**

Checkpoint:

`.env.jd-reconstruction-opt1-repaired-verification-1bba9f07-35ab-4dff-8bea-afe028d94290`

Accepted cost:

**`$0.0542460`**

Original comparison cost:

**`$0.0558020`**

State2 preserved downstream Resume Match compatibility and the accepted reconstruction semantics.

---

## 11. JD Reconstruction Optimization #2 — Rejected

A more aggressive sparse-omission strategy was tested.

### v6

- Request ID: `req_2f47f9c72c984724bba4d10fe1e40a95`
- Cost: `$0.0530900`
- Cost: BETTER
- Quality: WORSE
- Overall: REJECT

Semantic regressions included degraded relationship-management ownership and loss of self-service-resources responsibility.

### v7

- Request ID: `req_70dd545f7a0a4bdc95d1fb6070ee0b7b`
- Cost: `$0.0648920`
- Quality: WORSE
- Cost: WORSE
- Overall: REJECT

No JD Optimization #2 candidate was accepted.

**JD Reconstruction State2 remains the accepted JD baseline.**

---

## 12. Resume Match Optimization #2

Optimization #2 targeted the large runtime-expanded `requirementAssessments` schema.

### Initial compact candidate

The first aggressive compact design reduced the provider-visible request by approximately `48.72%` offline and replayed the known-good response correctly.

The first live attempt failed before inference because the strict schema contained `$ref` nodes with sibling `description` fields.

After a narrow schema repair, a live call succeeded at:

**`$0.1043360`**

but the result was semantically invalid. The model produced incompatible classification/evidence/specificity combinations.

Verdict:

- Quality: WORSE
- Cost: BETTER
- Overall: REJECT

This established a key lesson:

> Offline replay can prove conversion compatibility while still failing to predict live model behavior when provider-visible constraints become too weak.

### Compatibility salvage

A targeted revision restored provider-visible compatibility constraints without weakening application validators.

Validation included:

- all `315` positive compatibility combinations;
- the exact failed live regression;
- accepted-response replay;
- rejected-live replay;
- downstream compatibility.

### Final accepted Optimization #2

- Checkpoint: `.env.resume-match-opt2-compat-live-20261005-a95cb44-01`
- Request ID: `req_f2bc9503c6304fb38e4866c4530cfdbb`
- Model: `gpt-5.6-terra`
- Calls: `1`
- Retries: `0`
- Fallbacks: `0`

| Metric | Final Opt #2 |
| --- | ---: |
| Input | `20,560` |
| Reasoning | `881` |
| Output | `6,488` |
| Total | `27,048` |
| Cost | **`$0.1189760`** |

Compared with Optimization #1:

- absolute savings: `$0.0182540`
- cost reduction: `13.30%`
- input reduction: `29.32%`
- total-token reduction: `24.18%`

Validation passed for structured output, compatibility, evidence restoration, provenance, domain validation, complete-stage validation, and downstream behavior.

Final verdict:

- Quality: SAME
- Cost: BETTER
- Overall: ACCEPT

**Resume Match Optimization #2 is the accepted Resume Match baseline.**

---

## 13. Current Accepted Cost State

| Stage / group | Accepted cost |
| --- | ---: |
| JD Reconstruction State2 | **`$0.0542460`** |
| Resume Match Optimization #2 | **`$0.1189760`** |
| Existing Luna stages subtotal | **`$0.0294062`** |
| **Projected full evaluator** | **`$0.2026282`** |

Previous projected accepted full evaluator:

**`$0.2208822`**

Original accepted full evaluator entering optimization:

**`$0.2566362`**

The evaluator is substantially cheaper than the original accepted mixed baseline, but still above the original target.

---

## 14. Current Cost and Quality Risks

### Cost

Projected current evaluator cost:

**`$0.2026282`**

The remaining cost opportunity is model benchmarking/routing rather than more aggressive schema compression.

### Structural compression

Resume Match Optimization #2 demonstrated that provider schemas can become too permissive even when offline replay and conversion tests pass.

### Aggregate score

A rejected Resume Match candidate still produced the same aggregate score of `72` while its requirement-level classifications were materially worse.

Therefore aggregate score identity is not sufficient evidence of semantic equivalence.

### Verification tooling

Windows/WSL/tsx harness issues and historical helper-serialization differences can consume time without representing production defects.

---

## 15. Derived-Hash / Helper-Serialization Rule

Accepted rule:

> If the full schema hash, source diff, provider input content, instructions content, model, fixture, and production code all match the approved candidate, do not spend extended time reverse-engineering historical helper serialization solely to reproduce a derived combined fingerprint.

Treat helper-derived fingerprint mismatches as tooling differences unless they reveal a real production-request difference.

Priority:

**actual production request/state > helper-derived fingerprint reproduction**

---

## 16. Current Evaluator State

### Complete / Accepted

- Evaluator architecture and stage sequence.
- Terra/Luna semantic routing from the stabilization phase.
- Deterministic Hard Filters.
- Deterministic no-history Ghost Job Risk.
- Deterministic Final Recommendation.
- Final accepted live mixed semantic baseline.
- Opportunity Priority evidence-contract repair.
- Resume Match compatibility and partition-integrity repairs.
- Resume Match Optimization #1.
- Resume Match Optimization #2.
- JD Reconstruction Optimization #1 / State2.
- Optimization acceptance rules.
- Offline-before-live workflow.
- Paid-call authorization safeguards.

### Rejected / Reverted

- JD Reconstruction Optimization #2 v6.
- JD Reconstruction Optimization #2 v7.
- More aggressive JD sparse omission in the current pass.
- Initial ultra-compact Resume Match Optimization #2 candidate.
- Any optimization that reduced cost while weakening required semantic quality.

### Planned

- GPT model benchmarking.
- Final routing lock.
- Final full evaluator verification with final routing and accepted optimizations.
- Evaluator baseline freeze.

---

## 17. Exact Remaining Evaluator Completion Sequence

### 1. Benchmark models stage-by-stage

Benchmark GPT-6 Luna against current GPT-5.6 Luna stages:

- Job Evaluation
- Company Alignment
- Organizational Maturity
- Alex Fit
- Burnout Risk
- Opportunity Priority

Then benchmark GPT-6 Luna against Terra for:

- JD Reconstruction
- Resume Match

Acceptance standard:

**same or better required quality at the same or lower total cost**

Do not combine model benchmarking with more schema/prompt optimization.

### 2. Lock final routing

Choose the winning accepted model independently for each stage.

### 3. Run one final full evaluator

Validate:

- stage outputs;
- evidence IDs;
- provenance;
- Unknowns;
- contradictions;
- direct / related / transferable distinctions;
- downstream compatibility;
- Opportunity Priority;
- Final Recommendation;
- actual total cost.

### 4. Freeze the evaluator baseline

Record:

- final model per stage;
- prompt/schema version;
- accepted cost per stage;
- final evaluator cost;
- benchmark results;
- rejected alternatives;
- semantic safeguards;
- final routing.

After that, evaluator optimization is considered complete unless a real product defect later requires reopening it.

---

## 18. Important Known IDs and Checkpoints

### Commits

- `a7a0a47 feat: complete Customer Success evaluation foundation`
- `1b1bade fix: redesign resume match decision impact transport`
- `e9c3f47 fix: enforce resume match partition integrity`
- `7ec73f8 perf: compact resume match provider transport`

### Accepted request IDs

- Resume Match isolated routing acceptance: `req_91edfde7626743e68750609fd5d90486`
- Opportunity Priority isolated acceptance: `req_2c46c4c757844230b09a104082dbd264`
- Resume Match Optimization #2 final: `req_f2bc9503c6304fb38e4866c4530cfdbb`

### Rejected optimization request IDs

- JD Reconstruction Opt #2 v6: `req_2f47f9c72c984724bba4d10fe1e40a95`
- JD Reconstruction Opt #2 v7: `req_70dd545f7a0a4bdc95d1fb6070ee0b7b`
- Resume Match Opt #2 compact live rejection: `req_20259af6e06c49148e131b35e80e82e9`

### Final accepted semantic baseline

Evaluation:

`437dcca0-f299-4066-b8d3-fe949c124ce3`

This remains the live semantic-quality control while final model benchmarking is completed.

---

## 19. Status Addendum — October 10–15, 2026

This addendum records evaluator work after §1–18 (October 5, 2026). Earlier sections are preserved as written. In particular, the §3 and §5 routing and the §13 cost state describe the evaluator at that time, and the GPT-6 Luna routes below did not exist then.

### Model benchmarking and routing lock

Following the §17 sequence, step 1 (stage-by-stage GPT model benchmarking):

- **Job Evaluation:** GPT-6 Luna was **rejected**. The isolated benchmark changed Strategic Bridge Value from `HIGH` to `MODERATE` and omitted established process-development evidence. This is a classification and evidence regression, so it fails the same-or-better quality requirement. GPT-5.6 Luna remains the Job Evaluation route.
- **Company Alignment and Burnout Risk:** routed to **GPT-6 Luna**.
- **Remaining GPT-6 stage benchmarks:** intentionally **skipped by product decision**. The routing policy was locked rather than continuing paid experimentation.

§17 step 2 is complete: **routing is locked.**

| Operation | Locked execution |
| --- | --- |
| Hard Filters | Deterministic |
| JD Reconstruction | GPT-5.6 Terra |
| Job Evaluation | GPT-5.6 Luna |
| Company Alignment | GPT-6 Luna |
| Organizational Maturity | GPT-5.6 Luna |
| Alex Fit | GPT-5.6 Luna |
| Burnout Risk | GPT-6 Luna |
| Resume Match | GPT-5.6 Terra |
| Opportunity Priority | GPT-5.6 Luna |
| Ghost Job Risk | Deterministic when posting-history evidence is insufficient |
| Final Recommendation | Deterministic application logic |

§17 steps 3–4 are **deferred**: the final full evaluator run, final whole-product/live acceptance, and the evaluator baseline freeze happen at the final evaluator/product integration, after all main-product features 1–18 are complete.

### Branch state

- The routing lock (the GPT-6 Luna routes) and the evaluator work below are on the Codex evaluator branch, `codex/evaluator-live-diagnostic`. They are **not merged** into `main` or into the main-product branch `claude/gallant-pasteur-y1ou3i`.
- The main-product branch keeps the earlier accepted routing (GPT-5.6 Luna for Company Alignment and Burnout Risk) until final branch combination.

### Evaluator records on the Codex evaluator branch (October 10–15, 2026)

These records live in the Codex branches' root-level `Md and README Docs/CURRENT_PROGRESS.md`, a different path from this repository's documentation folder. They must be carried into the canonical documents at final branch combination; see `HANDOFFS.md`, October 15 annotations. Titles are as recorded there:

- Organizational Maturity mixed-state stabilization — October 10, 2026
- Resume Match evidence-partition stabilization — October 11, 2026
- Provider-prose semantic closure — October 11, 2026 (Claude)
- Structured requirement specialization and real-artifact replay — October 11, 2026 (Claude)
- JD Reconstruction specialization category binding — October 12, 2026 (Claude)
- Requirement-relative evidence relevance — October 12, 2026 (Claude, committed `f29530c`)
- Statement groups, reconciliation and requirement-relative INDUSTRY — October 13, 2026 (Claude; recorded there as uncommitted pending review)
- Milestone 4 salary-policy contract update — October 15, 2026 (Codex)

Related evaluator-branch commits:

- `ba95d76` wip: hand off current evaluator stabilization (Oct 11)
- `04611af` fix: close evaluator prose-semantic contract gaps (Oct 11)
- `1c09924` fix: finish evaluator semantic closure and artifact replay (Oct 11)
- `7149563` fix: bind JD specialization flags to experience requirements (Oct 12)
- `f29530c` fix: repair requirement-relative evidence relevance (Oct 12)
- `067c5dc` fix: reconcile JD statement groups and requirement-relative industry evidence (Oct 13)
- `267124f` fix(cs): align Milestone 4 salary policy with Task 7 (Oct 15)

### Milestone 4 salary-policy alignment (`267124f`, Codex evaluator branch)

- The Customer Success Hard Filters consume the Task 7 salary/currency/residency contract.
- U.S.-residency-required roles use a hard `$60,000 USD-equivalent` minimum.
- Non-U.S. roles use the Pass / Review / conditional Review / Fail bands.
- FX policy is versioned as `cs-salary-policy-v2-ecb-2026-10-14`.
- `salaryMin`, `salaryMax`, `currency`, `residencyRequirement` and `residencyRegions` are released to evaluator input.
- Version identifiers: `cs-evaluation-v1.2-m9`, `customer-success-v1.2`, `cs-rules-v1.2`, `cs-hard-filters-v2`.
- Focused offline verification passed. DB-backed integration, E2E and live acceptance are deferred to final integration.

### Milestone 4 compensation-basis correction (October 25, 2026, Codex; uncommitted, not merged)

Recorded from the Codex handoff of October 25, 2026. The work is on the `codex/evaluator-live-diagnostic` worktree over `267124f` and is neither committed nor merged. The `267124f` section above is preserved as written; its `cs-hard-filters-v2` and `cs-salary-policy-v2-ecb-2026-10-14` identifiers are superseded there by v3.

Core preserves OTE numeric facts. Milestone 4 treats OTE-only compensation as Unknown for confirmed base-salary eligibility.

- **Basis:** the evaluator consumes the Feature 14B `compensationBasis`, exactly `BASE` | `OTE` | `null`.
  - `BASE` and `null` (an ordinary stated range, with no need for the word "base") are evaluated normally.
  - `OTE` leaves the normalized bounds untouched, and salary eligibility is Unknown unless separate confirmed base-salary evidence exists.
  - `compensationBasis` joins the deterministic salary evidence, so an OTE Unknown points to the OTE statement.
- **Unchanged:**
  - the thresholds and bands;
  - the disclosed-minimum gate, the max-only rule and no silent annualization;
  - Unknown for missing, ambiguous, conflicting or unsupported-currency salary.
- **Currency and FX:** the evaluator reads the currency Core normalized and does not reproduce Core's bare-"$" geography rule. FX conversion stays evaluator-only, and no converted value is persisted.
- **Residency and work authorization:** residency still selects the policy branch. Work-authorization facts, sponsorship, relocation, citizenship and `UserEligibility` are never used.
- **Identifiers:** Hard Filters `cs-hard-filters-v3`; salary policy `cs-salary-policy-v3-ecb-2026-10-14`. No semantic prompt, provider model or routing change.
- **Shape:** the evaluator branch lacks the native Core field, so the basis is read through a temporary evaluator-boundary compatibility path. At integration it is replaced by the native shared-Core field, with the v3 behavior preserved and no second copy of the Core enum.
- **Verification (Codex):**
  - focused Milestone 4 tests pass;
  - changed-file ESLint, Prisma validation, workspace typecheck and `git diff --check` pass;
  - eight broader unit failures reproduce identically on untouched `267124f`, so they are pre-existing.
- **Main-product edge case, resolved October 25, 2026 (Feature 14B v5):**
  - A single range stated as OTE that also mentions "base" ("$120,000 - $150,000 OTE (base + commission)") previously normalized with a `null` basis.
  - Core now gives OTE wording precedence, and also takes `OTE` from the description's statement of the same source-stated range. That case therefore reaches the evaluator as `OTE`.
  - No evaluator change is needed (`HANDOFFS.md`).

### Lessons recorded (see Semantic Evaluation Playbook v1.2, §13)

- A newer or cheaper model is not adopted when it regresses an established classification or omits established evidence.
- Debugging and acceptance validate the whole affected contract or path, not only the latest observed symptom.
- Settled model benchmarks are not rerun without a substantive reason.

### Semantic-quality control

Evaluation `437dcca0-f299-4066-b8d3-fe949c124ce3` (§18) remains the recorded accepted semantic baseline until the final integration acceptance run establishes the post-integration baseline.

---

## 20. Status Addendum — October 16, 2026: Evaluator-Branch Semantic Contracts

This addendum records the evaluator work of October 10–13, 2026, from Git and from the evaluator branch's own `Md and README Docs/CURRENT_PROGRESS.md`. §1–19 are preserved as written. The contracts below did not exist when §1–18 were written, and §19 lists them by title only.

### Where each contract runs

| Item | Main-product branch `claude/gallant-pasteur-y1ou3i` | Evaluator branch `codex/evaluator-live-diagnostic` |
| --- | --- | --- |
| Semantic execution policy | `customer-success-semantic-policy-v3-mixed-terra-luna` | `customer-success-semantic-policy-v4-final-terra-luna-gpt6` |
| Company Alignment, Burnout Risk | GPT-5.6 Luna | GPT-6 Luna |
| JD Reconstruction prompt | `cs-jd-reconstruction-v3` | `cs-jd-reconstruction-v7` |
| Resume Match prompt | `cs-resume-match-v2` | `cs-resume-match-v4` |
| Organizational Maturity prompt | `cs-organizational-maturity-v6` | `cs-organizational-maturity-v7` |
| Task 7 salary/residency facts | all ten fields withheld from the evaluator | five released (`267124f`) |

The evaluator-branch column is the current evaluator contract. It reaches the product only at final integration. Until then, the main-product branch runs the earlier contracts.

### Contract evolution (Git)

| Date | Commit | Contract change |
| --- | --- | --- |
| Sep 26 | `266b9e7` | `cs-jd-reconstruction-v3`: compact JD Reconstruction transport. This is the JD Reconstruction Optimization #1 / State2 era (§10) and the version the main-product branch still runs |
| Oct 11 | `ba95d76` | Work-in-progress handoff: policy `…-v4-final-terra-luna-gpt6` and `cs-organizational-maturity-v7` first appear |
| Oct 11 | `04611af` | Provider prose made display-only; structured `gapEvidence` for Genuine Gap proof; static text-dependency guard test |
| Oct 11 | `1c09924` | `cs-jd-reconstruction-v4`: structured specialization fields per requirement; offline replay of preserved live artifacts |
| Oct 12 | `7149563` | `cs-jd-reconstruction-v5`: specialization fields allowed only on EXPERIENCE requirements |
| Oct 12 | `f29530c` | `cs-jd-reconstruction-v6` and `cs-resume-match-v3`: requirement-relative experience levels; structured profile limitations as the only gap proof; `RESUME_MATCH_PREREQUISITE_OUTDATED` fail-closed gate |
| Oct 13 | `067c5dc` | `cs-jd-reconstruction-v7` and `cs-resume-match-v4`: structured `requirementStatements`; deterministic reconciliation; requirement-relative INDUSTRY evidence; Unknown without portions |
| Oct 15 | `267124f` | Milestone 4 salary policy consuming the Task 7 contract (§19) |
| Oct 25 | uncommitted | Milestone 4 compensation-basis correction: `cs-hard-filters-v3`, `cs-salary-policy-v3-ecb-2026-10-14` (§19) |

### Current rules on the evaluator branch

- **Semantic closure.** No acceptance decision depends on provider-authored wording. Prose is display-only, and a static test pins every remaining text dependency.
- **Structured fields are authoritative:** requirement statements, statement strengths and experience levels, and `gapEvidence`.
- **Ambiguity is derived.** Only an AMBIGUOUS strength is ambiguous, and it may carry a display explanation.
- **Genuine Gaps** need a structured profile limitation of the requirement's category whose level covers the requirement. Without limitations, gaps are unavailable and requirements stay Unknown.
- **INDUSTRY matches** are requirement-relative. Any actual work-experience record (direct, related or transferable) can establish one. Skills, certifications, coursework, tools, self-study and readiness never can.
- **Unknown** carries no supported or unsupported portion in new outputs. Stored results are not rewritten.
- **Deterministic reconciliation.** A deterministic requirement line covered by statement quotes is represented by that statement's qualifications. Uncovered lines remain as the floor, with their deterministic strength and stated years.
- **Legacy prerequisites.** Historical JD Reconstruction maps stay readable. A new Resume Match execution on a map without statement provenance or EXPERIENCE levels fails closed with `RESUME_MATCH_PREREQUISITE_OUTDATED`, before any provider call.
- **Replay methodology.** Preserved live request/response pairs are replayed offline from outside Git (`LIVE_REPLAY_DIR`), with fidelity checks against the original request.

These rules are not yet in Semantic Evaluation Playbook v1.2. They are planned for v1.3 after Task 9.

*(Update, October 16, 2026: they are now in Semantic Evaluation Playbook v1.3 §14, created after Task 9 closed.)*

### Naming: "v6" and "v7"

Two different things share these labels:

- **§11 and §16 "v6" and "v7"** are JD Reconstruction Optimization #2 candidates, both recorded as **rejected** in §11 (October 5, 2026). Their request IDs are `req_2f47f9c72c984724bba4d10fe1e40a95` and `req_70dd545f7a0a4bdc95d1fb6070ee0b7b`.
- **`cs-jd-reconstruction-v6` and `cs-jd-reconstruction-v7`** are prompt-contract identifiers from October 12–13. `cs-jd-reconstruction-v7` is the current JD Reconstruction contract on the evaluator branch.

The two are unrelated.

### Cost

§13's `$0.2026282` projected full evaluator is the accepted cost of the JD State2 and Resume Match Optimization #2 contracts. It is preserved as a historical baseline.

The current evaluator-branch contracts (`cs-jd-reconstruction-v7`, `cs-resume-match-v4`, with GPT-6 Luna for Company Alignment and Burnout Risk) enlarge some provider schemas. One representative Resume Match schema grew from 36,985 to 38,078 bytes on October 11. Their cost is **unmeasured**, and measuring it needs an explicitly authorized paid run at final integration.

### Residual risks (accepted on the evaluator branch, October 13)

1. A provider can still under-declare a strength or qualification that it omits entirely from its structured statements. No prose parsing detects this. It must be checked during integrated live acceptance.
2. The same-category limitation uniqueness guard may conservatively return Unknown until canonical subject keys exist.
3. Unrelated existing issues remain outside the repair:
   - travel normalization ("Bi-annual" read as annual);
   - remote explicit-fact detection;
   - startup limitations;
   - provider/deterministic evidence-ID collisions.
4. Genuine Gap relevance quality must be reviewed in a live diagnostic (October 11 record).

### Outstanding verification

- One final paid acceptance rerun of the integrated evaluator. The evaluator-branch records name it as the next gate after their October 10 and 11 repairs.
- Corpus replay of the raw responses for evaluations `8c77e46f` and `cdb1dc32`. These did not reach the October 11 session.
- DB-backed integration and E2E acceptance of the Task 7 → Milestone 4 contract on the combined branches, including the October 25 compensation-basis correction read from the native Core field.
- Current-contract cost measurement.
- The evaluator baseline freeze.

All of these belong to the final evaluator/product integration, and no paid call is authorized before it. Evaluation `437dcca0-f299-4066-b8d3-fe949c124ce3` (§18) remains the recorded accepted semantic baseline until then.

### Record-keeping notes

- The evaluator branch records the October 13 work as "uncommitted pending review", but Git shows it committed as `067c5dc` on October 13. Git does not establish whether that review took place.
- `7149563` appears in the evaluator-branch records as the identifier of a live run ("Live finding (Codex, `7149563`)"). It is also the hash of the October 12 commit. The records do not say which is meant.
- The GPT-6 Luna routing code first appears in `ba95d76` (October 11). §19 records the routing-lock decision (October 15).
- The evaluator branch's own progress file still shows GPT-5.6 Luna for Company Alignment and Burnout Risk, which predates the lock. Its records are carried into the canonical documents at final integration (`HANDOFFS.md`).
