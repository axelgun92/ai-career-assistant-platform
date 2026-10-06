# CLAUDE.md

Use `AGENTS.md` as the shared project operating guide.

Before substantial implementation work, also read:

- `docs/PRODUCT_STATUS.md`
- `docs/CURRENT_PROGRESS.md`
- `docs/AGENT_WORKSTREAMS.md`
- the relevant authoritative PRD/TDD
- the AI Career Assistant Semantic Evaluation Implementation Playbook when touching evaluator or semantic-execution code

## Current Claude Workstream

Claude's primary current responsibility is the remaining main-product work outside evaluator internals:

- application logic;
- UI;
- workflow completion;
- integration;
- usability work needed to reach the first stable product.

Treat the existing evaluator as a stable boundary unless a genuine integration defect requires coordinated change.

Do not redesign evaluator internals, model routing, semantic schemas, or recommendation logic as part of unrelated product work.

After meaningful completed work, update `docs/CURRENT_PROGRESS.md`. Use `docs/HANDOFFS.md` when transferring active work to another agent.
