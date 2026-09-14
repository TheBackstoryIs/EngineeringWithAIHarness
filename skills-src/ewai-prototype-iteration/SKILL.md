---
name: ewai-prototype-iteration
description: Review an EWAI prototype plan and each produced rendered design with the most relevant available core, project, personal, and already installed premium personas; assess every finding; and govern bounded iteration before human prototype selection. Use during UI Design after a design system has been applied, when planning screens and journeys, after producing or revising a runnable prototype, or when explaining why a persona-guided design cycle should iterate or stop.
---

# EWAI Persona-Guided Prototype Iteration

Create review evidence; do not grant design acceptance. Read [the review contract](references/review-contract.md) completely before recording a plan or design review.

## Workflow

1. Confirm that UI Design is in scope, the design-system application receipt is valid, and a fresh prototype plan is available.
2. Prepare plan review with `ewai prototype-review plan-prepare DELIVERY --input FILE --project PROJECT --json` or `ewai_prototype_plan_prepare`. Use signals grounded in the intended actors, outcomes, journeys, screens, accessibility needs, domain and risk.
3. Show every actively engaged persona's safe ID, name, tier, matched signals and engagement reason. Use the returned ensemble only. Core and project personas plus standard model capabilities form a complete baseline; personal and already installed premium personas are optional enrichment. Never fetch, sync, reveal or persist persona bodies.
4. Ask each active persona to review the plan through its stated lens. Keep persona findings separate from assessment. Give each finding a stable concern code and cited plan evidence.
5. Give every finding exactly one disposition: `incorporate`, `incorporate-with-modification`, `defer`, `reject`, or `escalate`, with a substantive rationale. Record with `plan-record` or `ewai_prototype_plan_record`.
6. Apply incorporated feedback before producing the runnable prototype. If the plan changes materially, prepare it again; do not silently reuse the earlier persona ensemble.
7. Capture source and rendered-viewport evidence for the produced design. Record interaction, assistive-technology, user-research, Manual QA and release as independent channels; missing evidence remains missing.
8. Prepare a rendered-design cycle with `cycle-prepare` or `ewai_prototype_cycle_prepare`. Recompute relevant personas from the actual design and evidence. Do not inherit the plan ensemble merely because it was previously active.
9. Ask the active design-stage personas to review the rendered result, then assess and record every finding with `cycle-record` or `ewai_prototype_cycle_record`.
10. Follow the derived action: iterate, present the result for human selection, or route the unresolved decision to a named human. Default to two design cycles; configure only one to three. Never continue autonomous iteration beyond the limit.
11. Link the reviewed plan and final cycle in `ewai.prototype-manifest/v3`. Human prototype selection, Manual QA, deployment and release remain separate.

## Boundaries

- Treat persona output as a hypothesis, not user research or owner evidence.
- Never let a persona select the prototype, approve a deviation, accept Manual QA, or authorise release.
- Never collapse source, rendering, interaction, assistive-technology, user-research, Manual QA or release into one evidence claim.
- Never rewrite immutable review evidence. Prepare and record a successor linked by digest.
- Never count more findings as better review. Select relevant perspectives and cite material evidence.
