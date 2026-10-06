# AI Job Assistant: Milestones 1–10

> Historical scope: This document consolidates the project history for Milestones 1–10 from the original milestone conversations. It preserves established facts, implementation details, test results, bugs, architecture decisions, Git checkpoints, and uncertainties. Later evaluator live-provider debugging, Terra/Luna routing, cost optimization, and post-Milestone-10 work are documented separately and are not retroactively attributed to these milestones.

## Overview

Milestones 1–10 transformed the AI Job Assistant from a repository/platform foundation into a working Customer Success manual-JD evaluation product.

Across the ten milestones, the project established:

- a permanent pnpm modular-monolith repository and shared Core Platform;
- PostgreSQL-backed opportunity, source, provenance, evaluation, evidence, recommendation, and task persistence;
- deterministic normalization with explicit Unknown/null handling;
- a reusable domain-neutral evaluation framework;
- a domain-owned Customer Success evaluator;
- one-pass JD reconstruction into Responsibility, Requirement, and Ownership Maps;
- nine ordered Customer Success evaluation stages;
- evidence-backed outputs with explicit Unknowns and contradictions;
- deterministic final `APPLY`, `REVIEW`, or `SKIP` recommendation logic;
- versioned profile and preference inputs;
- PostgreSQL-backed evaluation tasks, leasing, retries, recovery, persistence, usage recording, and restart-safe per-evaluation call budgets;
- request/status APIs;
- a Customer Success results interface with bounded polling, history, safe evidence presentation, and accessible expandable details.

By the end of Milestone 10, the project had a complete deterministic manual-JD vertical slice. Live-provider acceptance and automated job discovery remained outside the Milestone 10 scope.

---

# Milestone 1 — Repository and Platform Foundation

## Purpose

Milestone 1 was intended to establish the repository and shared platform architecture on which the AI Job Assistant would be built.

The goal was foundation rather than user-facing intelligence: create the application structure, shared boundaries, database schema foundation, development tooling, and basic web/extension boundaries without prematurely implementing Customer Success evaluation behavior.

## What Was Implemented

Milestone 1 established a **pnpm-workspace modular monolith** using:

- Next.js;
- React;
- TypeScript;
- Prisma;
- PostgreSQL-oriented persistence architecture;
- Vitest;
- Playwright;
- a Chrome-extension application boundary.

The repository structure included, as explicitly established in the conversation:

```
apps/
  web/
  extension/

packages/
  core/
  shared/
  evidence/
  evaluation/
  discovery/
  normalization/
  deduplication/

domains/
  customer-success/

database/

tests/
```

The platform also established the separation between shared Core infrastructure and domain-specific logic.

The Prisma/database foundation defined models including:

- `Opportunity`
- `SourceRecord`
- `Company`
- `FieldProvenance`
- `DuplicateReference`
- `UserProfile`
- `Evaluation`
- `StageResult`
- `EvidenceRecord`
- `Contradiction`
- `Recommendation`

These schema models represented the planned platform data model; not all of them had active application behavior in Milestone 1.

The schema supported nullable/unknown values and version-related fields. It did **not** define a universal `overallScore`.

## Important Files / Modules / Components

Exact Milestone 1 file-by-file changes were not fully preserved in the conversation.

Known structural components included:

- `apps/web`
- `apps/extension`
- Core packages under `packages/`
- `domains/customer-success`
- Prisma/database infrastructure
- repository-level test/tool configuration

**Uncertain / incomplete:** Exact filenames created or modified during Milestone 1 were not fully enumerated in the retained conversation.

## Architecture and Product Decisions

### Modular monolith

The project was intentionally established as a modular monolith rather than microservices.

The purpose was to preserve clear boundaries without creating unnecessary infrastructure complexity.

### Core versus domain separation

Shared infrastructure belonged in Core.

Customer Success-specific rules were intended to remain inside the Customer Success domain rather than being embedded into shared packages.

### Database schema ahead of behavior

The database schema established entities needed by later milestones, even though evaluation and recommendation behavior had not yet been implemented.

### No universal Overall Match score

The foundation did not establish a generic numerical Overall Match field that later domains would be forced to use.

## Testing and Verification

The Milestone 1 verification explicitly included:

- dependency installation;
- Prisma format;
- Prisma validation;
- Prisma client generation;
- TypeScript/typecheck;
- **3 unit tests**;
- lint;
- Playwright test discovery;
- production build;
- production application startup;
- health-endpoint verification;
- root HTTP `200`;
- repository/scope audits.

### Database migration status

No PostgreSQL migration was created during Milestone 1 because there was no PostgreSQL target available for safely applying one at that stage.

Prisma schema format, validation, and generation still passed.

### Playwright status

Playwright test discovery worked, but the actual browser test did not run because Chromium binaries were not installed.

This was treated as an environment/tooling gap rather than an application failure.

## Material Problems Encountered

The primary known verification limitation was the missing Chromium installation.

No architectural redesign was required because of it.

**Uncertain / incomplete:** No other Milestone 1-specific implementation bugs were explicitly preserved in the conversation.

## Final State

Milestone 1 successfully established the repository/platform foundation.

It was later committed, pushed, and tagged.

Known Git checkpoint:

```
482ecf7  Completed Milestone platform 1
```

Known tag:

```
milestone-1
```

The tag was explicitly stated to have been pushed.

The permanent repository ultimately became:

```
ai-career-assistant-platform
```

A temporary/duplicate repository used during the early work was later removed.

## Explicitly Deferred

Milestone 1 did not implement:

- real opportunity ingestion/persistence workflow;
- Customer Success evaluation;
- recommendation generation;
- live semantic/LLM evaluation;
- source discovery;
- ATS collection;
- browser-based opportunity collection behavior;
- deduplication behavior;
- analytics.

Those capabilities belonged to later milestones.

---

# Milestone 2 — Manual Opportunity Ingestion, Normalization, and PostgreSQL Persistence

## Purpose

Milestone 2 was intended to prove the first real vertical data slice:

```
Manual opportunity input
→ preserve raw source
→ normalize
→ preserve provenance
→ persist in PostgreSQL
→ retrieve/display
```

The milestone was explicitly about **data ingestion and persistence**, not evaluation.

## What Was Implemented

A user could manually submit an opportunity/job description.

The system then:

1. preserved the raw source as a `SourceRecord`;
2. performed deterministic normalization;
3. created or persisted the relevant `Company` / `Opportunity`;
4. stored field-level provenance;
5. transitioned the opportunity through the allowed lifecycle;
6. retrieved the stored opportunity through the application;
7. displayed it in the web interface.

The implemented lifecycle for this milestone was:

```
DISCOVERED
→ NORMALIZED
```

Nothing became:

```
EVALUATED
RECOMMENDED
```

during Milestone 2.

## Important Files / Modules / Components

Explicitly established files included:

```
packages/core/src/manual-opportunity.ts
packages/core/src/manual-opportunity-service.ts
packages/core/src/field-provenance.ts
packages/core/src/opportunity.ts
packages/core/src/raw-opportunity.ts

packages/normalization/src/index.ts

database/src/manual-opportunity-repository.ts

database/prisma/schema.prisma
database/prisma/migrations/20260812230155_init/migration.sql
```

API routes included:

```
/api/opportunities
/api/opportunities/[id]
```

The web application also gained:

- manual opportunity form/input behavior;
- opportunity-detail retrieval/display.

## Architecture and Product Decisions

### Raw source is preserved first

The raw `SourceRecord` was persisted **before normalization**.

This meant normalization failure would not erase the original input.

The system preserved:

- the raw JD text;
- supplied raw fields;
- metadata;
- original payload/source information;
- discovery timestamps.

### Normalization was deterministic only

Milestone 2 explicitly did **not** use AI/semantic inference during normalization.

Normalization handled only facts that were actually present.

Examples of established behavior:

- structured text could be trimmed/standardized;
- dates were validated;
- compensation remained textual where appropriate;
- missing data remained `null`;
- no unstated fact was inferred.

### Provenance was first-class

Normalized fields could be traced back to their source.

Field provenance preserved information including:

- SourceRecord ID;
- Opportunity ID;
- normalized field;
- supporting source field/reference;
- source text;
- normalized value;
- mapping type such as `DIRECT` or `DETERMINISTIC`.

### Domain neutrality remained intact

No Customer Success or Freelance Writing evaluation logic was added.

Core owned:

- raw preservation;
- normalization;
- provenance;
- lifecycle handling;
- persistence;
- shared APIs.

### Guarded lifecycle transitions

The application did not silently move opportunities through arbitrary states.

The implemented flow stopped at `NORMALIZED`.

## Testing and Verification

Database verification confirmed:

- migration `20260812230155_init` was created;
- migration was applied;
- PostgreSQL connection succeeded;
- migration status reported the schema current/up to date.

Test results explicitly established:

- **7/7 unit tests passed**
- **1/1 PostgreSQL integration test passed**

Additional verification passed for:

- TypeScript/typecheck;
- ESLint;
- production build;
- production startup;
- health endpoint;
- invalid POST behavior;
- valid POST behavior;
- opportunity retrieval API;
- opportunity detail page;
- Playwright test discovery.

## Material Problems Encountered

### Integration-test timeout

A live PostgreSQL integration test exceeded Vitest's default five-second timeout by approximately **105 ms**.

The response was not to weaken all test limits. The integration-only timeout was increased to **15 seconds**.

### Missing Chromium

The initial full Playwright browser run could not launch because Chromium was not installed.

It was installed with:

```
pnpm exec playwright install chromium
```

After installation, the browser test passed when the Next.js server was started manually.

### Playwright automatic server-start failure

A second problem remained: Playwright's `webServer` startup timed out even though:

- the application could be started manually;
- the health endpoint returned HTTP `200`;
- the E2E test passed against the manually running server.

The root cause was the indirect process chain used by Playwright:

```
Playwright
→ root pnpm
→ filtered pnpm workspace
→ Next.js
```

That process chain was unreliable for Playwright's server ownership/startup detection.

Only `playwright.config.ts` was changed.

The fix made Playwright launch Next directly:

```
command:
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1

cwd:
apps/web
```

The health URL remained unchanged.

Final clean-state verification:

```
pnpm test:e2e
```

resulted in:

```
1 passed (10.2s)
```

The server started automatically, the health endpoint became available, Chromium ran the test, Playwright shut the server down correctly, and port 3000 was confirmed free afterward.

This closed the remaining Milestone 2 E2E infrastructure gap.

## Final State

Milestone 2 ended with a complete manual ingestion/persistence slice:

```
Manual input
→ raw preservation
→ deterministic normalization
→ provenance
→ PostgreSQL persistence
→ retrieval
→ detail UI
```

No evaluation intelligence had yet been added.

Known Git checkpoints:

```
4d90d1e  Completed Milestone platform 2
344fece  Fix Playwright E2E server startup
```

The final `milestone-2` tag was placed at:

```
344fece
```

and was pushed.

The permanent repository was confirmed as:

```
ai-career-assistant-platform
```

## Explicitly Deferred

The conversation explicitly deferred work including:

- company matching/deduplication behavior;
- shared Core evaluation framework;
- evidence-ledger evaluation behavior;
- Customer Success evaluator;
- Freelance Writing evaluator;
- recommendations;
- semantic/LLM evaluation;
- ATS/public-source discovery;
- browser-extension collection;
- automated company research;
- authentication;
- analytics;
- generation-related features.

The next logical milestone was the shared domain-neutral evaluation framework.

---

# Milestone 3 — Shared Core Evaluation Framework

## Purpose

Milestone 3 was intended to create the reusable **domain-neutral evaluation infrastructure** that future domain evaluators would plug into.

It deliberately stopped short of implementing Customer Success-specific intelligence.

The milestone needed to prove that the platform could execute ordered evaluation stages, validate structured results, preserve evidence and uncertainty, isolate failures, and persist evaluation state without coupling Core to one career domain.

## What Was Implemented

Milestone 3 implemented the shared Core evaluation system, including:

- generic evaluator contracts;
- ordered stages;
- structured `StageResult` objects;
- shared evaluation context;
- stage-specific schema validation;
- EvidenceRecords / evidence-ledger integration;
- explicit Unknown handling;
- contradiction records;
- isolated stage failures;
- retry eligibility;
- evaluator/domain/version metadata;
- persistence for evaluations and related records;
- a neutral multi-stage fixture/evaluator used to prove the machinery.

The neutral test flow was explicitly described as:

```
stage-one
→ stage-two
→ stage-three
```

No Customer Success or Freelance Writing rules were inserted into these neutral stages.

## Important Files / Modules / Components

Explicitly named files included:

```
packages/evaluation/src/index.ts
packages/evaluation/src/contracts.ts
packages/evaluation/src/definition.ts
packages/evaluation/src/errors.ts
packages/evaluation/src/executor.ts

packages/evidence/src/evidence-record.ts
packages/evidence/src/contradiction.ts
packages/evidence/src/index.ts

database/src/index.ts
database/src/evaluation-repository.ts
database/prisma/schema.prisma
```

Database migration:

```
20260813210834_core_evaluation_foundation/migration.sql
```

Repository/tooling files changed or involved included:

```
package manifests
pnpm-lock.yaml
vitest.config.ts
vitest.integration.config.ts
```

## Architecture and Product Decisions

### Core remained domain-neutral

This was the central decision of Milestone 3.

Core knew how to:

- execute stages;
- validate results;
- retain context;
- record evidence;
- preserve Unknowns;
- preserve contradictions;
- persist/version evaluations;
- isolate failures;
- finalize a domain result.

Core did **not** know how to evaluate Customer Success.

### Domain-defined evaluator contract

The generic framework supported a domain evaluator definition later described as:

```
DomainEvaluatorDefinition<TDomainData, TResult>
```

The framework supported:

- domain identity;
- ordered stages;
- typed domain-specific context/data;
- domain-owned result schema;
- domain-owned finalization/recommendation behavior.

### Shared evaluation context

Stages could receive relevant shared information such as:

- normalized Opportunity;
- raw sources;
- provenance;
- user profile/version;
- validated earlier stage results;
- evidence;
- Unknowns;
- contradictions;
- evaluator/version metadata;
- domain-owned data.

Later stages could use previous validated results rather than re-running the same interpretation independently.

### Structured output over free-form behavior

Stage outputs were schema-validated.

Invalid structured output was rejected rather than silently persisted.

### Zod validation

Zod was used to enforce runtime stage contracts in addition to TypeScript's compile-time types.

### Explicit uncertainty

Unknowns remained explicit data rather than being converted into zero, false, failure, or negative evidence.

### Contradictions were preserved

Conflicting evidence could pass through the pipeline without Core automatically choosing which side was correct.

The domain evaluator would later decide how the contradiction mattered.

### Failure isolation and retryability

A failed stage did not automatically destroy the entire evaluation.

The framework recorded failure state and supported eligible retry behavior.

Stage execution supported continuation/stop behavior rather than treating every failure identically.

### No universal scoring architecture

Core did not force:

- weighted averages;
- universal score cutoffs;
- an Overall Match score.

Domains could use categorical results, bounded scores, risks, classifications, informational fields, or hard filters as appropriate.

### Evaluation versioning

Evaluation-related version information was persisted so future evaluations could be distinguished when:

- domain versions changed;
- rules/configuration changed;
- prompts changed;
- user profiles changed;
- stage versions changed.

## Testing and Verification

Milestone 3 added:

- **7 new unit tests**
- **2 new PostgreSQL integration tests**

Final suite totals were:

- **14 unit tests across 3 files**
- **3 integration tests across 2 files**

Final isolated results:

```
14/14 unit tests passed
3/3 integration tests passed
```

Additional checks passed:

- typecheck across **all 10 workspaces**;
- lint;
- production build;
- Prisma format;
- Prisma validate;
- Prisma migrate;
- Prisma migration status;
- Prisma generate;
- `git diff --check`;
- database cleanup audit;
- domain-scope audit;
- Overall Match/prohibited-scope audit;
- credential/secret-pattern scan.

PostgreSQL reported:

- two migrations present;
- schema up to date.

Playwright was intentionally not rerun for Milestone 3 because Milestone 3 changed no browser behavior.

No checks remained failing at the end of the milestone.

## Material Problems Encountered

Several implementation/test issues were found and corrected.

### Zod composition problem

An `.omit()` operation was attempted on a refined Zod schema.

The fix was to separate a reusable base schema from the draft/refinement layer so composition worked correctly.

### pnpm strict dependency isolation

Root tests could not resolve Zod under pnpm's strict isolation.

Zod was explicitly declared where required rather than relying on accidental transitive availability.

### Evaluator metadata contained runtime-only fields

Persisted evaluator metadata initially included data that belonged only to runtime execution.

The fix was to explicitly project only the intended metadata fields.

### Missing evaluator argument

A missing evaluator argument was discovered during final type checking and restored.

### Integration-suite timeout

During one chained verification run, an integration test exceeded **15 seconds**.

When the integration suite was rerun in isolation, all **3/3 tests passed**.

The issue was diagnosed as transient machine contention rather than a deterministic application failure.

### Verification-command mistakes

Some verification attempts initially used:

- incorrect PowerShell quoting;
- `pnpm.ps1`;
- the wrong Prisma workspace;
- Prisma commands without the required Prisma 7 configuration file.

Those verification commands were corrected and rerun successfully.

These were tooling/verification issues rather than reasons to change the Core architecture.

## Final State

Milestone 3 completed the reusable Core evaluation infrastructure.

At completion:

- neutral evaluations could execute through ordered stages;
- structured outputs were validated;
- evidence was traceable;
- Unknowns were preserved;
- contradictions were preserved;
- failure/retry state was supported;
- version metadata was persisted;
- no domain-specific evaluator logic existed;
- Opportunities remained `NORMALIZED` when running the neutral evaluation fixture rather than being falsely treated as domain-evaluated/recommended jobs.

The original Milestone 3 completion report explicitly stated that its changes were still **uncommitted and unpushed at that moment**.

Later in the same project history, Milestones 1–3 were explicitly confirmed as:

- complete;
- committed;
- pushed;
- tagged.

**Uncertain / incomplete:** The exact Milestone 3 commit hash, commit message, and tag name were not preserved in the available conversation record and should not be guessed.

A later pre-Milestone-4 compatibility audit concluded:

```
COMPATIBLE — Milestone 4 can begin without changes to Milestones 1–3.
```

## Explicitly Deferred

Milestone 3 deliberately deferred the actual Customer Success domain implementation, including:

- Customer Success domain configuration;
- Customer Success extraction schemas;
- JD reconstruction;
- Responsibility Map;
- Requirement Map;
- Ownership Map;
- Customer Success Hard Filters;
- Job Evaluation;
- Customer Success recommendation logic/integration.

Also deferred beyond this milestone:

- later Customer Success evaluation stages;
- real Customer Success recommendation persistence/integration;
- automated source discovery/collection;
- revised source-retrieval integrations;
- Freelance Writing implementation.

---


## Milestone 4 — Customer Success Domain Foundation and JD Reconstruction

### Purpose

Milestone 4 introduced the first domain-specific intelligence into the generic Core evaluation engine. Its purpose was to establish the Customer Success domain, reconstruct a manually supplied job description into reusable structured maps, and implement the first two Customer Success stages.

### Intended accomplishment

The broader MVP direction was:

`Manual JD → normalization → Customer Success evaluation → evidence validation → recommendation → results UI`

Milestone 4 intentionally implemented only the domain foundation, JD Reconstruction, Hard Filters, and Job Evaluation. Later Customer Success stages and the final recommendation were out of scope.

### What was implemented

- Customer Success domain registration.
- Typed, Zod-validated Customer Success preferences.
- One-pass structured JD reconstruction.
- Responsibility Map.
- Requirement Map.
- Ownership Map.
- Stage 1: Hard Filters.
- Stage 2: Job Evaluation.
- Strategic Bridge Value within Job Evaluation.
- Evidence-ledger integration and evidence-reference validation.
- Preservation of Unknowns and contradictions.
- Retryable semantic-failure handling through the existing Core runner.
- Deterministic semantic fixtures for local testing.
- PostgreSQL-backed integration coverage.

Established Hard Filter rules included:

- Role classification into `CORE_CS`, CS-adjacent, Support-heavy, Sales-heavy, Implementation-heavy, Technical-CS, or Unrelated categories.
- Salary of at least $60,000: Pass.
- Salary from $55,000 through $59,999: Review.
- Salary below $55,000: Skip when U.S. residency was required.
- Undisclosed salary or wording such as “Competitive”: Unknown.
- Location, time-zone, visa/EOR, and travel facts were preserved rather than guessed.

Job Evaluation examined the role’s primary work, lifecycle position, ownership, strategic/technical/commercial/cross-functional character, business impact, and Strategic Bridge Value.

### Important files and modules

- `domains/customer-success/package.json`
- `domains/customer-success/src/index.ts`
- `domains/customer-success/src/config/preferences.ts`
- `domains/customer-success/src/schemas/maps.ts`
- `domains/customer-success/src/schemas/results.ts`
- `domains/customer-success/src/extraction/explicit-facts.ts`
- `domains/customer-success/src/extraction/extractor.ts`
- `domains/customer-success/src/evaluation/hard-filters.ts`
- `domains/customer-success/src/evaluation/job-evaluation.ts`
- `domains/customer-success/src/evaluator.ts`
- `tests/fixtures/customer-success.ts`
- `tests/integration/customer-success-evaluation.test.ts`
- `tests/unit/customer-success.test.ts`
- `vitest.config.ts`
- `vitest.integration.config.ts`

The package manifest/lockfile and test configuration also changed as required by the implementation.

### Architecture and product decisions

- Customer Success schemas and rules remained domain-owned.
- The existing Core runner, evidence model, Unknown model, contradiction model, retry isolation, and validation boundaries were reused.
- Core was not refactored merely to accommodate the Customer Success domain.
- JD Reconstruction was designed as a single semantic reconstruction step that produced reusable maps for later stages.
- No universal or Overall Match score was introduced.

### Tests and verification

- Unit tests: 35 passed across 4 files.
- Integration tests: 4 passed across 3 files.
- Workspace typecheck passed.
- Lint passed.
- Build passed.
- `git diff --check` passed.
- Prohibited-scope checks passed.
- Credential/secret-pattern checks passed.
- PostgreSQL cleanup checks passed.

### Material problems encountered

- Initial typechecking exposed Zod default-construction and generic-refinement typing problems; these were corrected.
- An offline Playwright archive was unavailable.
- A frozen install rejected the changed manifest until the lockfile was updated.
- Direct `pnpm exec vitest` resolution failed in the environment; the repository’s official test scripts worked and were used successfully.

These were implementation/tooling problems rather than reasons to change the Core architecture.

### Final state

Milestone 4 was complete and verified. No Core changes were required. At the completion report, the Milestone 4 changes were modified or untracked and unstaged on `main`; the branch was up to date with `origin/main`, and no commit, tag, or push had been performed.

### Explicitly deferred

- Company Alignment.
- Organizational Maturity.
- Alex Fit.
- Burnout Risk.
- Resume Match and Effective Seniority.
- Opportunity Priority.
- Ghost Job Risk.
- Final Apply/Review/Skip recommendation.
- Recommendation persistence and API/UI expansion.
- Live model calls and external research.
- Automated discovery, ATS/browser collection, browser extension, and authentication.
- Freelance Writing evaluation.

## Milestone 5 — Company Alignment and Organizational Maturity

### Purpose

Milestone 5 added Stage 3, Company Alignment, and Stage 4, Organizational Maturity, extending the Customer Success evaluator beyond basic role classification into company/preference alignment and operating-environment analysis.

### Intended accomplishment

- Compare established job/company facts with configured Customer Success preferences.
- Assess how established and structured the Customer Success operating environment appeared.
- Preserve uncertainty rather than inventing company facts.
- Continue using the structured maps and validated prior results instead of rereading the raw JD.

### What was implemented

- Stage 3: Company Alignment.
- Stage 4: Organizational Maturity.
- Typed schemas and narrow semantic-operation contracts for both stages.
- Deterministic preference lookup and result validation.
- Evidence-reference validation.
- Score bounds and calibration handling for Organizational Maturity.
- Unknown and contradiction preservation.
- Retry and failure isolation through the existing runner.
- Evaluator version `cs-evaluation-v1.1-m5`.

The pipeline became:

`JD Reconstruction → Hard Filters → Job Evaluation → Company Alignment → Organizational Maturity`

Organizational Maturity used a holistic integer score from 0–100 rather than an additive weighted formula.

### Important files and modules

Known additions included:

- Customer Success evaluation module `company-alignment.ts`.
- Customer Success evaluation module `organizational-maturity.ts`.
- Corresponding Company Alignment and Organizational Maturity schemas.
- `tests/unit/customer-success-company-maturity.test.ts`.

The evaluator, extractor, preference configuration, result schemas, fixtures, unit tests, and integration tests were also updated. The exact full path list was not preserved consistently in the conversation.

### Architecture and product decisions

- Stages consumed Responsibility, Requirement, and Ownership Maps plus validated prior-stage results.
- Later stages did not independently reread and reinterpret the complete raw JD.
- Company Alignment and Organizational Maturity remained Customer Success domain concerns.
- No shared Core contract, database, API, or UI change was required.
- The maturity score was semantic and holistic, not a hidden weighted formula.

### Tests and verification

- Unit tests: 75 passed across 5 files.
- Integration tests: 4 passed across 3 files.
- Typecheck, lint, and build passed.
- Diff checks passed.
- Prohibited-scope and secret-pattern audits passed.
- PostgreSQL cleanup audit passed.

### Material problems encountered

- Initial Zod/type issues were found and corrected.
- No material Core or persistence redesign was required.

### Final state

Milestone 5 was complete and verified with the five-step reconstruction/evaluation pipeline operating through Organizational Maturity. The completion report recorded the changes as unstaged, with no commit, tag, or push.

### Explicitly deferred

- Alex Fit.
- Burnout Risk.
- Resume Match and Effective Seniority.
- Opportunity Priority.
- Ghost Job Risk.
- Final recommendation.
- Persistence/API/UI work for completed evaluations.
- Live-provider execution and automated job collection.

## Milestone 6 — Alex Fit and Burnout Risk

### Purpose

Milestone 6 personalized the evaluation by adding Stage 5, Alex Fit, and Stage 6, Burnout Risk.

### Intended accomplishment

- Compare the reconstructed opportunity with the versioned user profile and Customer Success preferences.
- Separate direct experience, related experience, and transferable experience.
- Produce a categorical personal-fit assessment rather than a misleading personal-fit percentage.
- Assess burnout risk holistically from the full set of role signals without using an additive formula.

### What was implemented

- Stage 5: Alex Fit.
- Stage 6: Burnout Risk.
- A profile adapter and typed preference inputs for the stages.
- Alex Fit classifications: `STRONG`, `GOOD`, `MIXED`, and `LOW`.
- Burnout Risk as a bounded integer from 0–100, with higher values representing greater risk.
- Burnout Risk bands: Very Low, Low, Mixed, High, and Very High.
- Strong matches, partial matches, concerns, risk contributors, positive workload indicators, evidence, and Unknowns.
- Reuse of the reconstructed maps and validated earlier-stage results.
- Evidence validation, Unknown preservation, contradiction preservation, retries, and stage-failure isolation.
- Deterministic testing without a live semantic provider.

Alex Fit was explicitly categorical rather than numerical. Burnout Risk was explicitly holistic: it considered interaction, severity, and context rather than summing fixed points.

### Important files and modules

The conversation established the Alex Fit and Burnout Risk modules, profile adapter, typed preferences, schemas, evaluator integration, fixtures, and tests as changed or added. The exact Milestone 6 file/path inventory was not preserved clearly enough to reproduce here without guessing.

### Architecture and product decisions

- Personal fit and burnout were separate concerns.
- Alex Fit compared the opportunity with the configured profile and career strategy.
- Burnout Risk measured workload and operating-risk patterns, not whether the role was otherwise attractive.
- Direct, related, and transferable experience remained distinct.
- Existing Core stage execution and validation infrastructure was sufficient; no Core change was required.
- No live provider call was required for milestone verification.

### Tests and verification

- Unit suite: 125 tests passed.
- Integration suite: 4 tests passed.
- Typecheck, lint, build, and diff checks passed.

The conversation does not preserve a reliable separate count for tests newly added specifically in Milestone 6.

### Material problems encountered

No milestone-specific implementation bug list was preserved clearly in the conversation. The completion report established that verification passed without a Core redesign.

### Final state

Milestone 6 was complete and verified with the pipeline operating through Burnout Risk. The work remained unstaged/untracked at the completion checkpoint, with no commit, tag, or push.

### Explicitly deferred

- Resume Match and Effective Seniority.
- Opportunity Priority.
- Ghost Job Risk.
- Final recommendation and persistence.
- Live-provider execution.
- Resume rewriting/tailoring.
- Results UI and external research.

## Milestone 7 — Resume Match and Effective Seniority

### Purpose

Milestone 7 added Stage 7, Resume Match, with Effective Seniority nested within the Resume Match result.

### Intended accomplishment

- Compare every relevant JD requirement with versioned profile evidence.
- Distinguish direct matches, transferable matches, partial matches, genuine gaps, and Unknowns.
- Determine whether the role was at the user’s target level, a stretch, or above level.
- Preserve contradictions and evidence provenance rather than resolving ambiguity through unsupported assumptions.

### What was implemented

- Stage 7: Resume Match.
- Effective Seniority nested within Resume Match rather than implemented as a separate numbered stage.
- Requirement-level classifications:
  - `STRONG_MATCH`
  - `TRANSFERABLE_MATCH`
  - `PARTIAL_MATCH`
  - `GENUINE_GAP`
  - `UNKNOWN`
- A bounded, evidence-backed semantic score from 0–100 with deterministic band mapping.
- Effective-level classifications:
  - `TARGET_LEVEL`
  - `STRETCH`
  - `ABOVE_LEVEL`
- Separate validation of JD evidence and profile evidence.
- Preservation of Requirement Map metadata and evidence relationships.
- Cross-field validation and invariants.
- Explicit unresolved contradictions.

The pipeline became:

`JD Reconstruction → Hard Filters → Job Evaluation → Company Alignment → Organizational Maturity → Alex Fit → Burnout Risk → Resume Match`

### Important files and modules

- `domains/customer-success/src/evaluation/resume-match.ts`
- `domains/customer-success/src/schemas/resume-match.ts`
- `tests/unit/customer-success-resume-match.test.ts`

The evaluator, semantic-operation contract, result/profile adapters, Requirement Map/extraction code, fixtures, integration tests, and stage-order tests were also updated.

### Architecture and product decisions

- Resume Match was a two-source comparison: JD Requirement Map evidence versus versioned profile evidence.
- Effective Seniority was nested within Resume Match, not promoted to a separate pipeline stage.
- Transferable experience could be recognized without being overstated as direct experience.
- Contradictions remained explicit.
- No Core, database, API, UI, dependency, lockfile, or environment changes were required.

### Tests and verification

- 53 Resume Match tests were added.
- Focused tests: 164 passed.
- Integration tests: 4 passed.
- Full suite: 178 passed.
- Typecheck, lint, build, and `git diff --check` passed.

### Material problems encountered

No separate material bug was preserved in the completion report. Cross-field validation and evidence invariants were central to preventing invalid combinations.

### Final state

Milestone 7 was complete and fully verified. The completion report recorded 12 modified files and 3 untracked files; no commit, tag, or push was performed.

### Explicitly deferred

- Opportunity Priority.
- Ghost Job Risk.
- Final recommendation and recommendation persistence.
- Live model integration.
- Resume rewriting/tailoring.
- Results UI.
- External research and later milestones.

## Milestone 8 — Opportunity Priority, Ghost Job Risk, and Final Recommendation

### Purpose

Milestone 8 completed the Customer Success MVP’s evaluation logic by adding Stage 8, Opportunity Priority; Stage 9, Ghost Job Risk; and deterministic final recommendation synthesis.

### Intended accomplishment

- Synthesize the validated evaluation into an opportunity-priority result.
- Assess ghost-job risk only from preserved posting-history facts.
- Produce final `APPLY`, `REVIEW`, or `SKIP` through the existing `finalize()` boundary.
- Complete the semantic evaluation pipeline without creating a universal Overall Match score.

### What was implemented

- Stage 8: Opportunity Priority.
- Stage 9: Ghost Job Risk.
- Deterministic final `APPLY`, `REVIEW`, or `SKIP` recommendation.
- Deterministic precedence and guard clauses for final recommendation.
- Objective posting-history facts separated from semantic interpretation.
- A deterministic Unknown outcome for Ghost Job Risk when posting-history evidence was unavailable.
- Final-result, evaluator, export, interface, fixture, lifecycle-test, and PostgreSQL integration updates.

Final Recommendation was explicitly not a tenth numbered stage. It was produced by `finalize()` after the nine validated stage results.

### Important files and modules

- Customer Success evaluation module `opportunity-priority.ts`.
- Customer Success evaluation module `ghost-job-risk.ts`.
- Customer Success recommendation module `recommendation.ts`.
- Corresponding schemas for Opportunity Priority, Ghost Job Risk, and Recommendation.
- `tests/unit/customer-success-priority-recommendation.test.ts`.

The evaluator, exports/interfaces, final-result definitions, fixtures, PostgreSQL integration tests, and lifecycle tests were also updated. Exact paths for every changed file were not preserved in the conversation.

### Architecture and product decisions

- The pipeline contained nine stages, followed by deterministic finalization.
- Stages consumed validated earlier results rather than rereading the JD.
- Opportunity Priority did not depend on Final Recommendation, avoiding a circular dependency.
- Final Recommendation used deterministic precedence and guard clauses.
- There was no `overallScore`, match percentage, hidden universal score, or “Overall Match” stage.
- Ghost Job Risk could not infer risk from absence of external history; without preserved history, it remained `UNKNOWN`.

### Tests and verification

- Focused Milestone 8 tests: 71 passed.
- Full unit suite: 249 passed.
- Integration tests: 4 passed.
- Typecheck, lint, and build passed.
- E2E passed.
- Prisma format/validation/generation passed.
- Diff checks passed.

### Material problems encountered

No material design-breaking bug was recorded. The principal design constraint was preventing circular logic and unsupported ghost-job conclusions.

### Final state

Milestone 8 completed the Customer Success evaluation and recommendation logic. No Core changes were required. At the completion checkpoint, no commit, tag, or push had been performed.

### Explicitly deferred

- Recommendation persistence and API/UI presentation.
- Live semantic-provider execution.
- Automated job collection.
- External posting-history research.
- Authentication and browser/ATS collection.
- Ghost Job Risk generally remained Unknown until historical posting facts existed.

## Milestone 9 — Production Evaluation Workflow

### Purpose

Milestone 9 connected the domain evaluator to a durable production workflow:

`Opportunity → API request → PostgreSQL task → worker → semantic operations → validated stages → deterministic recommendation → persisted result`

### Intended accomplishment

- Accept an evaluation request through the web API.
- Queue work durably in PostgreSQL.
- Run semantic operations in a background worker.
- Persist stages, evidence, failures, recommendation, and model usage.
- Survive process restarts and prevent unbounded calls or retries.
- Keep tests deterministic and network-free.

### What was implemented

- OpenAI Responses semantic adapter using structured output.
- Validated, versioned Customer Success preferences.
- PostgreSQL evaluation jobs with leasing, retry, and recovery behavior.
- Evaluation request and status APIs.
- Durable evaluation, stage, evidence, contradiction, recommendation, and model-usage persistence.
- Restart-safe failure handling.
- Resume-from-persisted-stages behavior.
- Restart-safe per-evaluation semantic-call budgets.
- Deterministic test providers for network-free verification.
- Worker commands:
  - `pnpm worker:evaluations`
  - `pnpm worker:evaluations:once`

The configured live model at this milestone was `gpt-5.6-terra`.

### Important files, modules, and components

- `semantic-executor.ts`.
- Customer Success `semantic-operations.ts`.
- `POST /api/opportunities/[id]/evaluate`.
- `GET /api/opportunities/[id]/evaluation`.
- Database-backed evaluation worker.
- PostgreSQL claim/lease logic using `FOR UPDATE SKIP LOCKED`.
- Persistence models and services for evaluations, stage outputs, evidence, recommendations, and usage metadata.

The exact complete file list was not preserved in the conversation.

### Architecture and product decisions

- The web request queued work rather than performing the full evaluation synchronously.
- PostgreSQL was both the durable task source and evaluation state store.
- Workers claimed tasks with leases, bounded retries, and recovery semantics.
- Completed stages could be reused after restart rather than recomputed blindly.
- Only JD Reconstruction received the raw JD; later stages received structured maps and validated earlier results.
- Final Recommendation remained deterministic rather than becoming another model call.
- Per-evaluation call budgets were durable and restart-safe.
- Persistent monthly/cross-evaluation budget reservation and reconciliation were not added.

### Tests and verification

- Unit tests: 271 passed.
- Integration tests: 13 passed.
- Typecheck, lint, and build passed.
- Prisma format, validate, generate, migration deploy, and migration-status checks passed.
- Diff checks passed.
- Provider-facing tests remained deterministic and network-free; no live provider call was made.

### Material problems encountered

- Windows Playwright cleanup could hang after the application assertion. The assertion itself completed, but process cleanup was unreliable in that environment.
- Live-provider behavior was intentionally not accepted as proven by the deterministic test suite.

### Final state

Milestone 9 completed the production evaluation backend and durable execution path. The completion report recorded a large uncommitted working tree on `main...origin/main`; no commit, tag, or push was performed.

### Explicitly deferred

- Results UI expansion.
- Authentication.
- Automated discovery and browser extension ingestion.
- Freelance Writing evaluation.
- An external queue service.
- Live-provider smoke/acceptance call.
- Overall Match scoring.
- Persistent monthly/cross-evaluation budget ledger, reservation, reconciliation, and AI-budget-deferred queue behavior.

## Milestone 10 — Customer Success Results Interface and Manual-JD Vertical Slice

### Purpose

Milestone 10 completed the Customer Success results experience and demonstrated the deterministic manual-JD MVP as an end-to-end vertical slice.

### Intended accomplishment

- Let a user request an evaluation from the opportunity interface.
- Show queued and running status while background processing occurred.
- Poll safely until completion or failure.
- Display the persisted recommendation and supporting evidence without recalculating business logic in the browser.
- Preserve and expose evaluation history and reevaluation behavior.

### What was implemented

- Manual opportunity evaluation request flow.
- Queued/running/completed/failed presentation states.
- Background worker status integration.
- Bounded client polling every 1.5 seconds, up to 80 polls.
- Polling cleanup when the page was left or the component was unmounted.
- HTTP `202 Accepted` handling for queued evaluation requests.
- Prevention of duplicate active evaluation submissions.
- Display of persisted `APPLY`, `REVIEW`, or `SKIP` recommendations.
- Recommendation explanation, strengths, concerns, Unknowns, review conditions, and expandable stage details.
- Clear distinction between JD evidence and profile evidence.
- Explicit Unknown and contradiction presentation.
- Safe text rendering for untrusted JD content.
- Evaluation history and prior-result preservation.
- Reevaluation behavior that preserved the previous completed result when the newest evaluation failed.
- Accessible headings, buttons, status messages, and expandable controls.
- Responsive results presentation.
- Deterministic E2E coverage for the manual-JD flow.

Results were ordered to prioritize job facts, persisted recommendation, explanation, strengths, concerns, Unknowns, and review conditions before expandable details.

### Important files and components

- `customer-success-results.tsx`
- `evaluation-experience.tsx`
- `poller.ts`
- `shared-results.tsx`
- Evaluation UI/types modules.
- Unit and E2E fixtures/tests.

The opportunity page, evaluation API/service, history query, styling, configuration, dependencies, and lockfile were also updated. The exact complete path list was not preserved in the conversation.

### Architecture and product decisions

- The browser displayed persisted results and never recalculated `APPLY`, `REVIEW`, or `SKIP`.
- Polling was bounded and cancellable rather than indefinite.
- Previous evaluations were retained rather than overwritten.
- A failed reevaluation did not erase the latest successful result.
- Untrusted JD content was rendered as text.
- Evidence provenance remained visible.
- The UI did not introduce `Overall Match` or `overallScore`.
- The web app and evaluation worker were separate runtime processes.

### Tests and verification

The completion report established that deterministic unit, integration, and E2E verification passed, along with the repository’s typecheck/lint/build and related validation checks. The exact Milestone 10 test totals were not preserved clearly enough in the retrieved conversation to state without guessing.

### Material problems encountered

- The implementation was verified deterministically, but real-job/live-provider acceptance remained outstanding.
- The previously observed Windows Playwright cleanup behavior remained an environment concern; it did not invalidate the completed application assertion.

### Final state

Milestone 10 completed the manual-JD Customer Success MVP implementation:

`Manual opportunity → Request evaluation → Queued/running status → Background processing → Persisted recommendation → Customer Success results page → Evidence display → Evaluation history`

At the milestone completion checkpoint, no commit, tag, or push had been performed. The project was ready for a repository checkpoint, but operational acceptance still required local environment configuration and one real evaluation.

### Explicitly deferred

- Real-job/live-provider acceptance.
- Automated discovery and ATS/browser collection.
- Browser extension ingestion.
- Authentication.
- Resume tailoring/rewriting.
- Cover-letter generation.
- Freelance Writing domain implementation.
- Deployment and broader production hardening beyond the completed deterministic slice.



## Final End-to-End Workflow After Milestone 10

The implemented workflow after Milestone 10 was:

1. A user manually created an opportunity containing preserved JD source content.
2. The user requested an evaluation from the opportunity interface.
3. The API accepted the request and created a durable PostgreSQL evaluation task.
4. The UI received an accepted/queued response and began bounded polling.
5. A separate evaluation worker claimed the task using database-backed leasing.
6. JD Reconstruction read the raw JD once and produced the Responsibility, Requirement, and Ownership Maps plus explicit facts and evidence.
7. The worker ran the ordered Customer Success stages:
   1. Hard Filters
   2. Job Evaluation
   3. Company Alignment
   4. Organizational Maturity
   5. Alex Fit
   6. Burnout Risk
   7. Resume Match, including Effective Seniority
   8. Opportunity Priority
   9. Ghost Job Risk
8. Each stage consumed validated structured inputs and prior results, produced evidence-backed output, and preserved Unknowns and contradictions.
9. `finalize()` applied deterministic precedence and guard clauses to produce `APPLY`, `REVIEW`, or `SKIP`.
10. The evaluation, stage results, evidence, contradictions, usage metadata, and recommendation were persisted.
11. The UI stopped polling on completion or failure.
12. The results page displayed the persisted recommendation and traceable supporting details without recalculating the decision.
13. Evaluation history remained available, and reevaluation created a new historical result instead of overwriting prior evaluations.

## Architecture Established Across Milestones 1–10

The historical system evolved into:

```text
Repository / platform foundation
        ↓
Manual opportunity input
        ↓
Raw SourceRecord preservation
        ↓
Deterministic normalization
        ↓
Field provenance
        ↓
PostgreSQL persistence
        ↓
Normalized Opportunity
        ↓
Generic Core domain evaluator contract
        ↓
Customer Success domain registration
        ↓
JD Reconstruction
        ↓
Responsibility / Requirement / Ownership Maps
        ↓
Nine ordered Customer Success stages
        ↓
Evidence / Unknowns / Contradictions
        ↓
Deterministic Final Recommendation
        ↓
Persisted evaluation history
        ↓
Results UI
```

The most important architectural boundary remained:

> **Core supplies infrastructure and execution behavior; domains supply career-specific intelligence.**

## Important Clarifications from the Original Plan

The milestone history established several implementation clarifications:

- Effective Seniority was nested inside Resume Match rather than implemented as a separate numbered stage.
- Final Recommendation was implemented through `finalize()` rather than as a tenth stage.
- The completed Customer Success evaluator therefore had nine numbered stages, not ten.
- No Overall Match score, match percentage, or hidden universal score was added.
- Ghost Job Risk remained `UNKNOWN` when posting-history evidence was absent.
- Later semantic stages consumed structured maps and prior validated results rather than independently rereading the raw JD.
- PostgreSQL-backed queue/worker behavior was used instead of a separate external queue service.
- Restart-safe per-evaluation call budgets and usage recording were implemented, while persistent monthly/cross-evaluation budget controls were deferred.
- Milestone 10 proved the deterministic end-to-end vertical slice, but not live-provider behavior with a real job and profile.
- Automated discovery, browser-extension ingestion, authentication, resume tailoring, cover letters, and deployment remained later work.

## Known Git Checkpoints

Only checkpoints explicitly established in the milestone conversations are included.

| Milestone | Commit | Message | Tag / status |
| --- | --- | --- | --- |
| Milestone 1 | `482ecf7` | `Completed Milestone platform 1` | `milestone-1`, pushed |
| Milestone 2 | `4d90d1e` | `Completed Milestone platform 2` | Intermediate Milestone 2 commit |
| Milestone 2 stabilization | `344fece` | `Fix Playwright E2E server startup` | Final `milestone-2` tag points here; pushed |
| Milestone 3 | **Unknown** | **Unknown** | Later confirmed committed, pushed, and tagged; exact hash/message/tag not established |
| Milestones 4–10 | **Not established individually** | — | Completion reports stated no commit/tag/push at each milestone checkpoint |

The permanent repository was established as:

```text
ai-career-assistant-platform
```

## Known Historical Uncertainties

The following remain unresolved unless recovered from Git history or another original source:

- exact Milestone 1 file-by-file diff;
- exact Milestone 1 test filenames;
- exact Milestone 3 commit hash;
- exact Milestone 3 commit message;
- exact Milestone 3 tag name;
- exact Milestone 6 file/path inventory;
- exact number of tests newly added specifically for Milestone 6;
- exact Milestone 10 test totals;
- any per-milestone commit hashes/tags for Milestones 4–10 not explicitly established in the source conversation.

Do not reconstruct or guess these values from later project history.

## Scope Boundary

This document stops at Milestone 10 completion.

Later work—including live-provider debugging, provider/application schema hardening, successful all-Terra production evaluation, Terra/Luna routing, cost optimization, and final evaluator completion work—belongs in the separate evaluator-status/history documentation.
