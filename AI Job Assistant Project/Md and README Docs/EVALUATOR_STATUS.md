# AI Job Assistant — Evaluator Status

**Domain:** Customer Success  
**Status:** Final optimization and verification  
**Last updated:** October 5, 2026

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
