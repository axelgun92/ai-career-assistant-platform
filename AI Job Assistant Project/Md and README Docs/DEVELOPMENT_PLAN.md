# Development Plan

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** October 5, 2026

## Goal

Reach a stable, usable AI Job Assistant as quickly as possible without allowing the later retrieval/scraper work to block the first functioning product.

## Development Order

The accepted development sequence is:

```text
1. Finish Evaluator
        +
2. Finish Remaining Main Product
        ↓
3. Integrate into Stable Usable Product
        ↓
4. Build Retrieval / Scraper
        ↓
5. Expand Discovery, Analytics, and Domains
```

The evaluator and the remaining main product can progress in parallel as long as their boundaries remain clear.

## Phase 1 — Finish the Evaluator

The evaluator is close to complete.

Current remaining evaluator sequence:

```text
JD Reconstruction optimization #2
→ Resume Match optimization #2
→ combined-path integration
→ final mixed-model evaluation
```

### Evaluator Rules

- Preserve the existing architecture, schemas, evidence behavior, and recommendation semantics.
- Optimize for the quality/cost sweet spot offline before spending on live verification.
- Never reduce required semantic quality merely to lower cost.
- Compare every candidate against the last known-good implementation as **BETTER / SAME / WORSE** on required quality and structural cost.
- Accept a candidate when it provides the same or better required quality at the same or lower total cost.
- Do not accept higher cost unless the additional quality is genuinely required.
- Keep every paid provider action explicitly authorized.
- Keep isolated verification single-stage, zero-retry, no-fallback, and free from unrelated semantic calls.

## Phase 2 — Finish the Remaining Main Product

While evaluator internals are being finalized, complete the rest of the product outside evaluator internals.

This includes:

- application logic;
- remaining UI;
- workflow completion;
- integration;
- any required product-level persistence/API work;
- usability work needed for the first functioning product.

This work should consume the evaluator as an existing product boundary rather than redesign it.

## Phase 3 — Produce a Stable Usable Product

Once the evaluator and remaining application work are complete, combine them into a coherent first usable product.

The first usable product does not depend on automated retrieval.

A user should be able to enter an opportunity manually, evaluate it, review the persisted recommendation and evidence, and use the product meaningfully.

## Phase 4 — Build Retrieval / Scraping

Only after the evaluator and main product are complete should automated job retrieval become the primary focus.

Target architecture:

```text
Job Sources
→ Retrieval / Scraping
→ Normalization
→ Deduplication
→ Existing Evaluator
→ Apply / Review / Skip
```

### Retrieval Principles

- Do not create a second evaluator.
- Preserve one clear ingestion contract between retrieval and the existing Core Platform.
- Keep source retrieval separate from normalization and evaluation logic.
- Preserve source provenance.
- Avoid duplicate paid evaluations.
- Verify retrieval methods by evidence, not assumptions.
- Once a source is sufficiently classified under the established source/retrieval categories, stop unnecessary reverse-engineering unless additional detail is actually required.

## Phase 5 — Expand the Platform

After the core product and retrieval system are stable:

- expand source coverage;
- improve posting-history support;
- build source analytics;
- add company watchlists;
- add additional domain assistants;
- revisit deferred product features as justified.

## Parallel Agent Strategy

Codex and Claude may work in parallel when ownership is clean.

Current intended split:

- **Codex:** evaluator completion, evaluator-sensitive implementation, deep code audits, bugs, verification.
- **Claude:** remaining main-product work outside evaluator internals.

After both are complete, either or both may work on retrieval, but they should not edit the same files at the same time.

A later retrieval split may use:

- one agent for source retrieval/adapters;
- one agent for normalization, ingestion, deduplication, evaluator handoff, testing, and error handling.

The exact split may change, but ownership must remain explicit.

## Completion Principle

Do not let retrieval work delay Version 1.

The priority is:

**Evaluator → Remaining Product → Usable Product → Retrieval**
