# CLAUDE.md

Use `AGENTS.md` as the shared project operating guide. Its **Documentation Locations** table lists the path of every project document; there is no `docs/` folder.

Before substantial implementation work, also read:

- `AI Job Assistant Project/Md and README Docs/PRODUCT_STATUS.md`
- `AI Job Assistant Project/Md and README Docs/CURRENT_PROGRESS.md`
- `AI Job Assistant Project/Md and README Docs/AGENT_WORKSTREAMS.md`
- the relevant authoritative PRD/TDD:
  - `AI Job Assistant Project/Product Recommendation Documents/Core AI Framework PRD v1.3.docx`
  - `AI Job Assistant Project/Product Recommendation Documents/Customer Success AI Assistant PRD v1.2.docx`
  - `AI Job Assistant Project/Technical Design Documents/Core Platform TDD v1.4.docx`
  - `AI Job Assistant Project/Technical Design Documents/Customer Success Assistant TDD v1.2.docx`
- the AI Career Assistant Semantic Evaluation Implementation Playbook (`AI Job Assistant Project/Md and README Docs/AI_Career_Assistant_Semantic_Evaluation_Playbook_v1.1.md`) when touching evaluator or semantic-execution code

## Current Claude Workstream

Claude's primary current responsibility is the remaining main-product work outside evaluator internals:

- application logic;
- UI;
- workflow completion;
- integration;
- usability work needed to reach the first stable product.

Treat the existing evaluator as a stable boundary unless a genuine integration defect requires coordinated change.

Do not redesign evaluator internals, model routing, semantic schemas, or recommendation logic as part of unrelated product work.

After meaningful completed work, update `AI Job Assistant Project/Md and README Docs/CURRENT_PROGRESS.md`. Use `HANDOFFS.md` (repository root) when transferring active work to another agent.
