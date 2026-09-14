---
name: ewai-retro
description: Close an EWAI feature, delivery, incident, or iteration by examining the actual artefacts and feedback, facilitating a blameless retrospective, recording owned actions under SPECS/3.Evidence/retros, and refining the applicable project-local SPECS, patterns, constraints, personas, stack guidance, templates, validators, and pipeline assets. Use after manual QA and delivery, after material failure, or whenever the user asks what was learned and how the system should improve.
---

# EWAI Retrospective

Turn delivery experience into durable improvement. Every completed capability gets a Retro, even when the conclusion is that no material change is needed.

Resolve the workspace and SPECS root from `.ewai-pipeline/project.json`; all logical `SPECS/...` paths below are relative to that configured root.

## Gather evidence

1. Read the configured `pipeline.yaml`, feature intent or capsule, delivery tracker, gate records, test evidence, review findings, manual QA feedback, and relevant Git history.
2. Review the previous Retro actions and record whether they were completed, deferred, or dropped with a reason.
3. Separate observed facts from interpretation. Keep missing timing, review, or test evidence visible.

## Facilitate learning

Ask one question at a time:

1. What should continue, and why did it work?
2. What should stop, and what was the underlying cause?
3. What should start, with an owner and review point?
4. What surprised us or contradicted the SPECS?
5. Which project or EWAI asset would have prevented the problem or amplified the success?

Use a minimum viable Retro when time is constrained, but do not skip the learning and asset-routing steps.

## Route accepted learning

- Update scope, domain language, or personas under `SPECS/1.Scope/`.
- Update intents, requirements, journeys, or explorations under `SPECS/2.Purpose/`.
- Keep the Retro and its evidence under `SPECS/3.Evidence/retros/`.
- Promote verified non-negotiables into `SPECS/4.Constraints/`.
- Update architecture, stack, decisions, options, patterns, SOPs, runbooks, or capsules under `SPECS/5.Strategy/`.
- Refine project-local skills, validators, templates, personas, or technology packs only when the project owns them.
- In a customer project, record an upstream EWAI improvement proposal rather than editing a global EWAI installation.

Do not promote one-off preference into a universal rule. Record first occurrences; extract a shared pattern when evidence shows reuse, with the established three-instance rule as the default threshold unless severity justifies earlier action.

## Complete Retro

Write `SPECS/3.Evidence/retros/<date>-<slug>.md` with facts, Continue/Stop/Start insights, root causes, asset changes, owned actions, previous-action review, and follow-up date. Link every applied asset change and every deferred proposal.

Retro passes only when accepted low-risk documentation improvements are applied, larger changes have owned work items, and the delivery tracker records the Retro artefact. Do not mark a capability complete merely because the meeting ended.

Read [asset routing](references/asset-routing.md) before applying learning beyond the Retro file.
