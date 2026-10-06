# Agent Workstreams

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** October 5, 2026

## Purpose

This document defines current ownership boundaries for coding agents so parallel development does not create conflicting edits, architectural drift, or duplicated work.

It is a coordination document, not a product specification.

## Current Workstream Split

### Codex

Primary responsibility:

- finish the Customer Success evaluator;
- evaluator optimization;
- evaluator-sensitive implementation changes;
- architecture/code audits tied to evaluator correctness;
- bugs affecting semantic execution;
- isolated/live verification;
- final mixed-model integration;
- evaluator regression protection.

Codex should preserve the existing evaluator contracts and should not redesign settled architecture without a demonstrated product requirement.

### Claude / Claude Code

Primary responsibility:

- remaining main-product work outside evaluator internals;
- application logic;
- remaining UI;
- workflow completion;
- integration around the evaluator;
- product-level usability work;
- non-evaluator implementation needed to reach a stable usable product.

Claude should treat the evaluator as an existing boundary unless a genuine integration defect requires coordinated change.

## Shared Rules

Both agents must:

- read the authoritative PRDs and TDDs before changing product behavior;
- read the Semantic Evaluation Playbook before changing semantic execution;
- preserve existing product semantics unless a new authoritative requirement says otherwise;
- avoid duplicating architecture in a second subsystem;
- keep Unknowns, evidence, contradictions, and persisted recommendations intact;
- avoid silently changing recommendation behavior;
- prefer targeted fixes over unnecessary redesigns;
- update current progress after meaningful completed work.

## Files and Areas with Extra Coordination Risk

The following areas should not be edited concurrently without an explicit handoff:

- evaluator orchestration;
- semantic provider/model routing;
- Customer Success stage contracts;
- shared schemas;
- persistence contracts used by both evaluator and UI;
- queue/worker behavior;
- recommendation logic;
- ingestion/evaluator boundary.

If both agents need the same area, one agent should finish and hand off before the other begins.

## Retrieval / Scraper Phase

Retrieval begins after the evaluator and usable product are complete.

At that point, work may be split between agents.

Example split:

### Retrieval Agent

- source adapters;
- retrieval methods;
- source-specific collection;
- source fixtures;
- source failure handling.

### Integration Agent

- ingestion contract;
- normalization;
- deduplication;
- provenance;
- evaluator handoff;
- duplicate-evaluation prevention;
- integration testing;
- error handling.

The exact division can change, but both agents must use one shared ingestion contract.

## Ownership Changes

Whenever ownership changes:

1. update this file if the workstream split materially changes;
2. add a handoff entry to `docs/HANDOFFS.md` when work is actively transferred;
3. update `docs/CURRENT_PROGRESS.md` with the new current owner and next task.
