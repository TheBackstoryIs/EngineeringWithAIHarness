# SPECS project contract

`.ewai-pipeline/project.json` is the workspace locator. Its `specsRoot` points to the durable SPECS root, whose `pipeline.yaml` identifies repositories, enabled packs, the skill namespace, and approval requirements. The path is `SPECS` by default, but a multi-repository workspace should normally use a dedicated location such as `project-knowledge/SPECS`.

Durable outputs use these roots:

- `SPECS/1.Scope/`: project context, scope, domain language, research, and personas.
- `SPECS/2.Purpose/intents/`: project intents.
- `SPECS/3.Evidence/`: success evidence, archaeology, risks, gates, iteration logs, postmortems, and retrospectives.
- `SPECS/4.Constraints/`: binding project boundaries.
- `SPECS/5.Strategy/`: approach, stack, decisions, options, patterns, runbooks, and work capsules.
- `SPECS/6.Build/<slug>/`: delivery trackers, plans, gates, test evidence, and retrospectives.

Project-owned persona sources use `SPECS/1.Scope/personas/project/`; project-specific refinements use `SPECS/1.Scope/personas/overlays/`. Core personas come from EWAI, personal personas come from the user's `~/.ewai/personas/` library, and premium personas come from entitled packs. Personal and premium source files are not copied into project truth unless the user deliberately promotes a project-owned derivative.

Do not treat `.ewai-pipeline/` as durable evidence. It may hold databases, indexes, caches, logs, and other rebuildable operational state.
