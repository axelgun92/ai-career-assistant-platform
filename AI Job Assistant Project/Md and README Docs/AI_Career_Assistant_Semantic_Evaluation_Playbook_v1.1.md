# AI Career Assistant Semantic Evaluation Implementation Playbook

**Created:** August 24, 2026  
**Purpose:** Preserve the lessons, safeguards, and correct implementation order established while bringing the Customer Success production evaluation pipeline from initial live testing to a successful complete evaluation.

Use this playbook when:

- adding GPT-5.6 Luna alongside GPT-5.6 Terra;
- optimizing evaluation cost;
- adding another domain, especially the Freelance Writing MVP;
- changing a provider schema, semantic operation, prompt boundary, retry rule, model, or pricing configuration;
- diagnosing a live evaluation failure.

## 1. Verified baseline

The Customer Success evaluation pipeline completed successfully end to end on August 24, 2026:

1. Manual opportunity ingestion
2. Hard Filters and JD Reconstruction
3. Job Evaluation
4. Company Alignment
5. Organizational Maturity
6. Alex Fit
7. Burnout Risk
8. Resume Match and Effective Seniority
9. Opportunity Priority
10. Ghost Job Risk
11. Deterministic Final Recommendation
12. Persistence and results display

The successful result was **Review**, driven by unresolved country eligibility and work-arrangement information. The evaluation correctly distinguished transferable Customer Success experience from unverified literal SaaS account ownership.

The verified Git checkpoint is:

```text
a7a0a47 feat: complete Customer Success evaluation foundation
```

Do not replace this working baseline while experimenting. New model routing and domain work must remain reversible and independently testable.

### Successful production evaluation baseline

The authoritative live baseline for future model and cost comparisons is:

```text
Evaluation ID: 186aa2b2-9599-4114-a429-57821c28e5a1
Opportunity ID: f3f56612-3783-4cbd-8c6e-07e4680f2e55
Profile ID: 7fcd8324-caff-4da1-a464-699d891c4de0
Profile version: 1
Final recommendation: REVIEW
Total semantic requests: 8
Retries: 0
Total tokens: 125,670
Persisted estimated cost: $0.4528088
Pricing version: openai-gpt-5.6-terra-standard-2026-07-30
```

Stage-level production costs:

| Operation | Cost |
| --- | ---: |
| JD Reconstruction | $0.0407060 |
| Job Evaluation | $0.0175040 |
| Company Alignment | $0.0285240 |
| Organizational Maturity | $0.0346888 |
| Alex Fit | $0.0857100 |
| Burnout Risk | $0.0499460 |
| Resume Match | $0.1277440 |
| Opportunity Priority | $0.0679860 |
| Ghost Job Risk | $0.0000000 — deterministic Unknown |

The direct `REVIEW` drivers were Unknown country/employment eligibility and Unknown work arrangement. Salary and travel passed, the role was classified as Core Customer Success, no contradictions were persisted, and all 40 stage-level Unknown findings remained preserved.

The successful audit also confirmed a separate normalization/UI gap. The evaluation extracted a disclosed `$70,000–$85,000 USD` salary, but the UI displayed `Unknown` because `Opportunity.salaryText` remained null. The UI also displayed `Untitled opportunity` because the evaluation does not backfill the normalized opportunity title. This is not a semantic-evaluation failure and must be handled through normalization/presentation design rather than by changing recommendation logic.

## 2. What caused the prolonged debugging cycle

The fundamental problem was not that AI evaluation was impossible. The provider-facing schemas and application/domain rules were initially treated as though they were automatically equivalent. They were not.

OpenAI validates the JSON Schema sent with the request. The application then applies additional Zod refinements, authoritative-data rules, evidence checks, and cross-record validation. When a rule existed only in application validation, a provider response could be accepted by OpenAI and still be rejected afterward.

Several failures appeared one at a time because early pipeline failures prevented later stages from executing. Fixing an earlier boundary exposed the next untested boundary. The correct response was a complete nine-operation contract audit—not endless full-pipeline retries.

## 3. Failure history and permanent lessons

### Configuration and execution prerequisites

- The application required a real `.env` configuration, not changes to `.env.example`.
- A versioned user profile and Customer Success domain preferences had to exist before evaluation.
- Database migrations had to be applied before new persistence fields could work.
- The Windows Node.js 24 worker could not use top-level `await` with CommonJS output; worker startup was moved into `async main()`.
- A silent worker window normally means the worker is running and polling. Returning to the PowerShell prompt means it exited.

**Permanent rule:** Verify environment, database, profile, worker startup, and model access separately before testing semantic reasoning.

### Strict Structured Outputs compatibility

OpenAI strict schemas require closed object shapes and support only a subset of JSON Schema.

Observed problems included:

- dynamic record schemas using `propertyNames` and schema-valued `additionalProperties`;
- objects missing `additionalProperties: false`;
- chained Zod patterns generating unsupported `allOf`;
- coercion-based dates producing unconstrained schemas;
- runtime-only refinements not represented structurally.

Corrections included:

- fixed-entry arrays at the provider boundary, converted back to existing domain records;
- nullable ISO date-time strings at the provider boundary, converted to `Date` afterward;
- one compatible regex rather than chained patterns;
- a full generated-schema audit for all production operations.

**Permanent rule:** Audit the exact generated JSON Schema—not merely the source Zod declaration.

The audit must reject:

- root-level `anyOf`;
- `allOf`, `oneOf`, `not`, `if`, `then`, `else`, dependent schemas, or other unsupported composition;
- `propertyNames`;
- dynamic `additionalProperties`;
- objects without `additionalProperties: false`;
- objects whose properties are not all required;
- empty or unconstrained schemas;
- schemas beyond documented property, nesting, enum, or string-size limits.

### Provider transport schemas and domain schemas serve different purposes

The persisted domain result is the product contract. The provider transport is an AI communication contract. They do not need to be identical.

The safe design is:

```text
Authoritative application input
→ provider-specific strict transport input
→ provider-specific strict transport output
→ deterministic conversion and restoration
→ unchanged domain validation
→ unchanged persisted/API/UI result
```

**Permanent rule:** Fix provider incompatibilities at the transport/conversion boundary whenever possible. Do not casually change domain, persisted, API, UI, or recommendation meaning.

### Authoritative data must not be delegated to the model

Resume Match initially asked Terra to reproduce immutable Requirement Map fields. Minor wording or metadata differences then caused fidelity failures.

The correction was to let the provider return only its semantic judgment and stable requirement identity. The application restores authoritative fields deterministically.

Examples of application-owned data:

- requirement text and category;
- requirement strength;
- stated minimum and maximum years;
- ambiguity state and explanation;
- stable requirement identity and order;
- known evidence-ledger identities;
- objective posting facts.

**Permanent rule:** A model may analyze authoritative data, but it should not recreate or overwrite it.

### Predetermined results should be deterministic

Ambiguous requirements were required to remain `UNKNOWN`, yet Terra was originally asked to classify them. Terra reasonably attempted an interpretation, which the application then rejected.

The correction excluded ambiguous requirements from provider classification and restored their required `UNKNOWN` assessments deterministically.

**Permanent rule:** If product rules allow only one valid answer, code should construct that answer. Do not pay a model to guess it.

### Evidence-source requirements must be explicit

Some Resume Match outputs required both JD evidence and user-profile evidence, but the provider saw only one general evidence array. This allowed technically structured results that failed application evidence rules.

The provider transport now uses explicit JD and profile evidence arrays where both are required, then merges them into the unchanged domain result.

**Permanent rule:** If source type matters, express source type explicitly at the provider boundary. Conversion must reject unresolved, duplicated, wrong-source, unrelated, or out-of-assessment references.

### Known/Unknown relationships must be structurally aligned

Organizational Maturity permitted combinations such as `unknown: true` with a non-null conclusion at the provider boundary, while runtime validation prohibited them.

The correction used structural Known/Unknown branches across all applicable fields and all nine ownership dimensions.

**Permanent rule:** Audit every Known/Unknown pair across the entire operation, not only the field that happened to fail live.

### Input-dependent rules remain application safeguards

Some requirements cannot be expressed safely in JSON Schema because they depend on runtime collections or relationships:

- evidence ID membership;
- exact identity coverage and uniqueness;
- minimum/maximum year comparisons;
- evidence belonging to a particular requirement;
- objective fact membership;
- cross-array reference resolution.

These remain deterministic conversion or complete-stage checks.

**Permanent rule:** Input-dependent contract failures must be safe, targeted, and non-retryable. Repeating the same paid request cannot repair an authoritative-input mismatch.

### Retry multiplication must be prevented

A historical Resume Match failure produced four paid requests:

```text
2 semantic attempts × 2 stage attempts = 4 calls
```

The corrected design prevents exhausted structured-output validation from triggering an outer paid stage rerun. Authoritative, fidelity, evidence, identity, and contract mismatches are non-retryable.

**Permanent rule:** Define retry ownership once. Test the maximum paid-call count across semantic, stage, task, and worker layers.

Retry only failures that another request could plausibly fix, such as selected temporary transport or provider failures. Do not retry deterministic validation failures.

### Diagnostics must be useful and safe

Generic errors originally made distinct failures look identical. The corrected implementation records bounded diagnostics such as sanitized Zod paths/codes and sanitized provider `error.code`, `error.param`, and `error.type`.

Never retain or expose:

- raw provider output;
- provider error messages or complete bodies;
- prompts;
- profile content;
- headers or credentials;
- database URLs or SQL.

**Permanent rule:** Persist the failure layer and safe category needed to diagnose the defect without retaining sensitive payloads.

### Usage and cost must survive failures

Token and cost accounting now records, when reported:

- input tokens;
- cached-input tokens;
- reasoning tokens;
- output tokens;
- total tokens;
- provider and model;
- prompt version and operation;
- attempt number, duration, status, and request ID;
- versioned pricing configuration;
- estimated attempt cost;
- evaluation, opportunity, domain, source-record, and job-source linkage.

Unknown usage remains `null`, never silently zero. Billable retries and invalid structured outputs are counted individually and aggregated exactly once.

**Permanent rule:** Accounting is part of the execution contract, including failed-but-billable attempts.

### Persistence and time-zone behavior must be tested in the production-shaped environment

A pricing immutability guard failed because a PostgreSQL `timestamptz` value was shifted by the Windows/Chicago adapter before JavaScript comparison.

The correction moved timestamp insertion/comparison into PostgreSQL using explicit ISO `timestamptz` handling.

**Permanent rule:** Database-backed tests must reproduce the real operating system, adapter, nullable opportunity fields, relationships, and production pricing version. Pure unit tests cannot establish production persistence parity.

### Worker transactions must remain short

A Prisma `P2028` transaction-start timeout delayed a queued evaluation. Long model calls must never occur inside a database transaction or while holding a claim/lease transaction open.

**Permanent rule:** Claim work atomically, close the transaction, execute the model call outside it, and persist results in separate bounded transactions.

## 4. Correct development sequence for any new semantic operation

Follow this order. Do not begin with repeated full live evaluations.

### Phase A — Define ownership

For every output field, classify it as:

1. authoritative application data;
2. legitimate model judgment;
3. provider-schema structural constraint;
4. deterministic application validation.

Anything with only one valid product answer belongs to code, not the model.

### Phase B — Build the provider boundary

- Create an operation-specific strict transport schema.
- Generate the exact JSON Schema.
- Run the complete OpenAI compatibility audit.
- Create deterministic transport-to-domain conversion.
- Restore authoritative fields from trusted inputs.
- Preserve the existing domain and persistence shape whenever possible.

### Phase C — Add adversarial tests

Test:

- every Known/Unknown branch;
- every evidence-bearing field;
- missing, duplicate, negative, unknown, and out-of-range identities;
- wrong-source and unresolved evidence;
- incomplete authoritative coverage;
- field fidelity;
- year relationships;
- contradictions and aggregate evidence;
- retryability and maximum paid-call count;
- usage/cost persistence on success and failure.

### Phase D — Complete fake-provider flow

Run the entire domain pipeline through the real production orchestration and database using a fake provider. Verify all stages, persistence, API results, final recommendation, history, Unknowns, contradictions, usage, and cost.

### Phase E — Isolated live test

For each new or materially changed operation:

- use exactly one provider request;
- set retries to zero;
- set call budget to one;
- reuse persisted prerequisites where safe;
- do not enqueue an evaluation;
- do not run preceding or later stages;
- do not modify production data;
- remove the temporary harness;
- report every validation layer, usage, cost, and safe diagnostic.

### Phase F — One final full live evaluation

Only after all changed operations pass isolated testing should one complete queued evaluation run. Confirm every stage, final recommendation, persistence, accounting, and UI retrieval.

## 5. Adding Luna safely

Do not replace Terra globally. Add versioned per-operation model routing while preserving the working all-Terra configuration as a fallback.

### Required implementation order

1. Audit the successful all-Terra evaluation and establish stage-level cost and quality baselines.
2. Add central, versioned provider/model/pricing configuration per semantic operation.
3. Keep result schemas, conversion, persistence, API, UI, and recommendation contracts unchanged.
4. Rank Luna candidates from simplest to most judgment-sensitive.
5. Run local schema, adversarial, domain, integration, and accounting tests.
6. Run one isolated Luna call for one candidate stage.
7. Compare Luna with the Terra baseline for evidence quality, Unknown handling, contradictions, material conclusions, and cost.
8. Enable Luna only for stages that meet the acceptance criteria.
9. Keep Terra for any stage where Luna produces weaker or unstable judgment.
10. Run one final mixed-model evaluation and verify the final recommendation and total cost.

### Initial candidate order

Start with simpler or more structured operations, subject to baseline evidence:

1. Job Evaluation
2. Company Alignment
3. Opportunity Priority
4. Alex Fit
5. Burnout Risk
6. Organizational Maturity
7. JD Reconstruction

Resume Match should remain on Terra initially because it is the largest and most judgment-sensitive operation. Move it only after earlier optimizations and a dedicated quality comparison.

Ghost Job Risk should remain deterministic when posting-history evidence is insufficient. Final Recommendation remains deterministic application logic.

### Cost target

The desired completed-evaluation target is **$0.10–$0.15**.

Cost reduction should combine:

- Luna for stages that retain acceptable quality;
- smaller, operation-specific trusted context;
- elimination of repeated full-profile and full-JD content;
- shorter non-duplicative structured outputs;
- stable shared prefixes that can benefit from prompt caching;
- appropriate reasoning effort per operation;
- deterministic processing for facts and predetermined outcomes;
- no retries for deterministic contract failures.

Do not treat a lower price as success if evidence quality, Unknown preservation, or recommendation reliability declines.

## 6. Building the Freelance Writing MVP

The Freelance Writing domain should reuse the Core platform and this process, not copy Customer Success conclusions.

### Before implementation

- Read the authoritative Core and Freelance Writing PRD/TDD documents.
- Inventory existing Core contracts, domain registration, queue/worker behavior, persistence, API, UI, pricing, and accounting.
- Define the complete Freelance Writing stage sequence and field ownership before writing provider schemas.
- Identify deterministic eligibility, source-quality, rate, rights, workload, client-risk, portfolio-match, and application-priority decisions.

### Provider-contract design

- Create separate provider transport and domain schemas from the beginning.
- Mark authoritative opportunity, client, rate, rights, identity, provenance, and user-profile fields as application-owned.
- Exclude predetermined Unknown or ineligible items from model judgment when the product rule permits only one result.
- Split evidence by source wherever source type changes validity.
- Encode every expressible Known/Unknown relationship structurally.
- Keep cross-record membership, provenance, and evidence resolution deterministic and non-retryable.

### Testing order

1. Generated-schema audit for every Freelance Writing semantic operation.
2. Adversarial contract tests for all refinements and evidence rules.
3. Complete fake-provider domain pipeline.
4. Database-backed production-shaped integration flow.
5. Isolated one-call live tests for each operation.
6. One complete live Freelance Writing evaluation.

Do not wait for a full live run to discover provider/application mismatches stage by stage.

### Model and cost design

Design per-operation Luna/Terra routing and pricing configuration before bulk discovery or evaluation. Use the Customer Success cost findings to avoid sending repeated user-profile, opportunity, source, and evidence content to every stage.

## 7. Diagnostic decision tree

When a live evaluation fails, first identify the layer:

1. **Configuration:** missing key, model, profile, migration, or environment value.
2. **Worker/queue:** process exit, claim/lease problem, transaction timeout, or task state.
3. **Provider request:** HTTP error, unsupported schema, model access, timeout, or rate limit.
4. **Provider transport validation:** structured response does not match the transport schema.
5. **Conversion:** authoritative identity, coverage, evidence membership, or source validation fails.
6. **Domain validation:** converted result violates the stable domain contract.
7. **Complete-stage validation:** cross-result, evidence, contradiction, fidelity, or recommendation safeguard fails.
8. **Persistence/accounting:** operation metadata, relationships, pricing, tokens, or stage result fails to persist.
9. **UI retrieval/presentation:** persisted result exists but is missing, mislabeled, duplicated, or poorly rendered.

Diagnose the newest failure using persisted records and safe logs. Do not immediately rerun. Determine whether another paid request could plausibly change the outcome before allowing a retry.

## 8. Browser-extension implementations

The browser extensions require additional collection, permission, provenance, and security work, but they must **not** implement a second evaluator or duplicate domain reasoning.

The planned extension is a TypeScript Chrome Manifest V3 application in the same monorepo (`apps/extension`). It is a source-collection client for authenticated, dynamic, or anti-scraping-protected pages such as LinkedIn, Otta/Welcome to the Jungle, and Wellfound.

The shared architecture remains:

```text
Supported browser page
→ extension capture and local structural validation
→ existing Core Platform ingestion API
→ normalization and deduplication
→ existing queued domain evaluation
→ persisted result
→ web or extension results UI
```

### What the extension owns

- Detect whether the current page is a supported listing page.
- Extract the visible job/freelance-opportunity content and available metadata.
- Preserve the page URL, source name, capture timestamp, and source-specific identifiers.
- Locally validate the capture envelope before submission.
- Send the capture to the existing Core Platform API.
- Display capture, duplicate, queued, running, completed, and failed states.
- Link to or render the persisted result without recalculating it.
- Request only the minimum browser permissions and host access necessary for supported sources.

### What the extension must not own

- API keys or provider credentials.
- Direct OpenAI/Terra/Luna calls.
- Prompt construction.
- Domain evaluation or Apply/Review/Skip recomputation.
- Independent token, cost, retry, or budget enforcement.
- A separate database or semantic result contract.

All model calls, usage accounting, pricing, retries, budget checks, persistence, and recommendation logic remain server-side.

### Extension-specific security requirements

- Treat all page text, DOM attributes, embedded JSON, and source metadata as untrusted input.
- Never interpret page content as system, domain, user-profile, or execution instructions.
- Send captured text as source data through the established untrusted-content boundary.
- Never inject captured HTML into the extension or web UI; render untrusted content as text.
- Do not read unrelated tabs, browsing history, passwords, cookies, private messages, or page content outside the explicitly supported capture flow.
- Do not place secrets in extension source, bundled JavaScript, browser storage, logs, or network requests.
- Authenticate only to the Core Platform using the approved application mechanism.
- Preserve source provenance so every evaluation claim can resolve back to a captured source record.

### Extension-specific normalization and duplicate behavior

- A capture creates or updates a `SourceRecord`; it does not bypass normalization.
- The Core Platform remains authoritative for canonical opportunity identity and deduplication.
- Repeated capture of the same listing must not create duplicate opportunities or duplicate paid evaluations.
- Source-specific metadata that is absent remains explicitly Unknown; the extension must not infer missing salary, location, work arrangement, date, company, or eligibility.
- Capture selectors and source adapters may vary by website, but they must produce the same domain-neutral ingestion envelope.

### Extension-specific test sequence

Before using a real source account or running a paid evaluation:

1. Test URL and page-type detection with saved fixtures.
2. Test each source adapter against representative DOM/embedded-data fixtures.
3. Test missing fields, changed selectors, lazy loading, partial pages, and unsupported pages.
4. Test hostile page text and prompt-injection content as inert source data.
5. Test permissions and confirm the extension cannot access unrelated sites or secrets.
6. Test capture-envelope validation and API authentication.
7. Test normalization, provenance, canonical URLs, and duplicate capture behavior against the local API/database.
8. Test that capture alone does not call a model or create a charge.
9. Test queue submission separately using the existing fake provider.
10. Run one end-to-end extension capture through the already-verified evaluation pipeline.

### Domain reuse

Customer Success and Freelance Writing extensions share the same extension shell, capture envelope, Core APIs, normalization, deduplication, queue, accounting, and status behavior. They differ only where the actual source adapters, opportunity fields, and domain evaluation criteria differ.

The Freelance Writing browser-extension MVP must therefore reuse the completed Core extension infrastructure. It must not copy Customer Success semantic conclusions into shared extension code.

### Effect of adding Luna

The extension should not know whether a semantic operation uses Terra, Luna, or deterministic code. Model routing remains a versioned server-side concern. A later model change must not require republishing the extension unless the ingestion or public API contract itself changes.

**Permanent rule:** Browser extensions add a source-collection boundary, not a second AI pipeline.

## 9. Definition of done

A new model route or domain semantic pipeline is not complete until:

- every generated provider schema passes the full compatibility audit;
- all provider and domain refinements have an explicit enforcement owner;
- deterministic authoritative restoration is tested;
- all evidence sources and references are validated;
- retry multiplication is impossible;
- fake-provider full-pipeline tests pass;
- database-backed production-shaped tests pass;
- isolated live tests pass with one request each;
- one complete live evaluation succeeds;
- token and cost fields persist correctly;
- the final recommendation is evidence-based and preserves Unknowns;
- the UI can retrieve the saved result after restart;
- the verified work is committed and pushed as a Git checkpoint.

## 10. What not to repeat

- Do not assume `z.toJSONSchema()` captures every Zod refinement.
- Do not ask the model to reproduce immutable application data.
- Do not ask the model to decide predetermined outcomes.
- Do not use a general evidence array when source type matters.
- Do not fix only the first field that failed; audit the complete operation and then all operations.
- Do not run the full paid pipeline after every change.
- Do not allow semantic retries and stage retries to multiply the same failure.
- Do not treat missing token or cost data as zero.
- Do not expose raw provider or profile content for diagnostics.
- Do not change domain or persisted contracts merely to accommodate a provider schema when conversion can preserve them.
- Do not activate automated discovery before model routing, budget controls, and cost targets are established.

This playbook should be updated after the successful-evaluation audit, the Luna optimization milestone, and the first complete Freelance Writing live evaluation.

## 11. Accepted mixed-model routing and optimization status — October 2026

The Customer Success evaluator has progressed beyond the initial Luna-candidate phase described earlier in this playbook. The current accepted routing is:

| Operation | Accepted execution |
| --- | --- |
| JD Reconstruction | GPT-5.6 Terra |
| Job Evaluation | GPT-5.6 Luna |
| Company Alignment | GPT-5.6 Luna |
| Organizational Maturity | GPT-5.6 Luna |
| Alex Fit | GPT-5.6 Luna |
| Burnout Risk | GPT-5.6 Luna |
| Resume Match | GPT-5.6 Terra |
| Opportunity Priority | GPT-5.6 Luna |
| Ghost Job Risk | Deterministic Unknown when posting-history evidence is insufficient |
| Final Recommendation | Deterministic application logic |

This routing was accepted because the Luna stages retained the required semantic quality while reducing cost. Terra remains on JD Reconstruction and Resume Match because those operations currently carry the highest structural and judgment sensitivity.

**Permanent rule:** Model routing is an execution detail. A model change must not redefine the domain schema, stage meaning, evidence contract, Unknown behavior, contradiction behavior, or recommendation semantics.

### Optimization acceptance rule

Every cost-optimization candidate must be compared with the last known-good implementation on both required quality and structural cost.

Classify each candidate as:

- **BETTER**
- **SAME**
- **WORSE**

A candidate may be accepted when it provides the same or better required quality at the same or lower total cost. Do not require lower cost when quality is genuinely better at unchanged cost. Do not accept higher cost unless the additional quality is actually required by the product.

Before any paid verification, search for the quality/cost sweet spot offline using schema inspection, fixtures, adversarial tests, deterministic comparisons, and production-shaped fake-provider runs.

**Permanent rule:** Never sacrifice required semantic quality merely to reduce token or dollar cost.

### Resume Match optimization #1 — accepted

The first accepted Resume Match optimization compacted the provider DTO while preserving the stable domain result and validation behavior.

The initial baseline was approximately:

```text
Input tokens: 29,087
Reasoning tokens: 415
Output tokens: 6,588
Total tokens: 35,675
Cost: $0.13723
```

During optimization, two regressions were discovered and corrected:

- a startup safeguard regression;
- loss of required narrative citation behavior.

The accepted isolated verification produced approximately:

```text
Input-token reduction: 35.12%
Total-token reduction: 30.92%
Cost reduction: $0.0342
```

The optimization was kept because the required semantic behavior remained intact after the regressions were corrected.

### JD Reconstruction optimization #1 — accepted

The first accepted JD Reconstruction optimization used a compact provider-facing delta plus deterministic metadata restoration.

Observed structural reductions were approximately:

```text
Provider schema: 11,395 → 6,361  (-44.2%)
Production payload: 6,015 → 2,949 (-51.0%)
```

The isolated Terra verification cost approximately:

```text
$0.04798
```

The optimization retained downstream Resume Match compatibility and the existing reconstruction safeguards.

**Permanent rule:** Compact transport data only when authoritative application data can be restored deterministically and the downstream domain contract remains unchanged.

### Current remaining evaluator optimization sequence

The accepted remaining sequence is:

```text
JD Reconstruction optimization #2
→ Resume Match optimization #2
→ combined-path integration
→ final mixed-model evaluation
```

Each step must preserve the last known-good implementation as a rollback point.

### Live-verification safeguards

For optimization verification, use the same isolated-call discipline established earlier in this playbook:

- explicit authorization is required before any paid provider call;
- start from a fresh known-good checkpoint;
- run one stage only;
- retries must be zero;
- fallback must be disabled;
- do not write to the production database unless the test explicitly requires persistence;
- do not allow unrelated semantic stages to execute.

If the full schema, provider input content, instructions content, model, fixture, and production code match an approved candidate, do not spend additional time reverse-engineering a historical derived-helper fingerprint solely to reproduce an old combined hash. Treat a derived-helper hash mismatch as a tooling difference unless it identifies a real production-request difference.

## 12. Current product boundary and next implementation phase

The evaluator is now close to completion. The remaining product work should preserve the existing evaluator as a stable boundary.

The product can operate with manual opportunity ingestion while the remaining application workflow is completed. Future automated retrieval is an upstream source layer and should feed the existing architecture:

```text
Job source(s)
→ retrieval / scraping
→ normalization
→ deduplication
→ existing evaluator
→ Apply / Review / Skip
```

The retrieval layer must not become a second evaluator and must not change Customer Success evaluation semantics.

When retrieval work begins, define a single stable ingestion contract and keep retrieval, normalization, deduplication, and evaluator handoff independently testable.

**Permanent rule:** Finish and verify the evaluator and the usable product workflow before allowing retrieval work to change the evaluator boundary.

