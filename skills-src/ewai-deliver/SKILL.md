---
name: ewai-deliver
description: Deliver or resume an EWAI intent through the complete fourteen-stage Engineering With AI harness. Use whenever a user chooses work, asks to continue an intent, requests planning or implementation, resumes shelf-ready work, or asks to move a feature forward. Enforces durable Markdown, JSON and SQLite state, deterministic phase gates, FitCheck, Build approval, Manual QA, and Retro.
---

# EWAI Deliver

This skill is the only supported route from an EWAI intent into planning, Build, delivery, and learning. A host AI's generic planning mode is not an EWAI Plan and cannot replace a pipeline phase.

When an owner asks for bounded delegation across an exact pool of existing intents, use `$ewai-autonomy` for the off-by-default preview, named grant, run controls and human questions. Keep `$ewai-deliver` as the phase-work route. An autonomy grant cannot replace existing human Build approval, the canonical gate ledger, standards sweep, or separate Manual QA approval.

Resolve the workspace and SPECS root from `.ewai-pipeline/project.json`; all logical `SPECS/...` paths in this contract are relative to that configured root. Never assume the workspace itself or the repository being changed owns SPECS.

## Delivery contract

Before taking delivery action, read [Phase routing](references/phase-routing.md) and [Delivery evidence contracts](references/delivery-evidence.md) completely. They define the purpose, required evidence, and exit condition of every EWAI phase. The project-local contracts returned by `ewai_delivery_required_artefacts` and `ewai_delivery_gate_template` are the executable truth for the current run.

Preserve all fourteen stages, the UI Design and FitCheck adjuncts, shelf/resume semantics, recovery, escalation, branch safety, evidence, Manual QA, and Retro. Never shorten the harness merely to finish within one agent turn. Persist the recovery point and continue in another turn when necessary.

## Start and resume

For new delivery, call `ewai_delivery_begin` (or `ewai delivery begin`) for an existing project-owned intent and identify the current host as `tool`/`--tool` (`claude`, `codex`, or `antigravity`). Antigravity is invoked through the `agy` CLI. That value defines the orchestrator exclusion boundary. For continuing work, call `ewai_delivery_continue` first. Never reconstruct the next phase from chat memory.

Before substantial repository navigation or truth claims, call `ewai_index_status`; refresh with `ewai_index_refresh` when the index is missing or stale. Use `ewai_index_search` and `ewai_index_graph` for navigation and blast-radius evidence, then verify material claims against source files.

Before phase work, require agreement among:

- intent Markdown frontmatter;
- the adjacent structured intent JSON record;
- `SPECS/6.Build/<slug>/delivery-state.json`;
- the SQLite operational projection.

If they disagree, stop and reconcile from durable evidence. Do not silently pick a winner.

Read the work item through `ewai_read_work_item` before choosing an action. Treat `item.execution.actions` as the shared decision surface used by the dashboard and MCP:

- invoke only actions whose `permitted` value is true;
- explain structured blockers when an action is false;
- never infer permission from `item.lane`, intent `status`, or a phase label alone;
- allow a draft intent to begin the harness when `beginHarness` is permitted; readiness is established inside Intent;
- honour dependencies at their recorded `required_before` and `required_state`.

At each phase entry, read its required artefacts and gate template. Produce every individual artefact at its specified project-local path. A summary document or passing-looking ledger cannot substitute for missing records.

When the project policy baseline is enabled, use `$ewai-organisation-policy` at Intent and Plan to verify current confirmed design facts, the deterministic evaluation, required named reviews or bounded exceptions, and every control trace. Treat `not-configured` as non-blocking. Policy evidence never grants Build, Manual QA, certification, deployment, release, production-enforcement, or residual-risk authority.

If Intent, Reconcile, Plan, Test Plan, or Pattern Validation exposes a consequential unresolved architecture choice, pause at that exact phase and use `$ewai-architecture` for the smallest useful boundary. Resume only after its relevant proposals are accepted and promoted, or the question is explicitly owned and deferred without violating the current gate. Do not let generic host planning invent architecture, and never postpone a material architecture decision until Build.

## Validation routing and cycles

Read the resolved `validation` snapshot in `SPECS/6.Build/<slug>/delivery-state.json`; do not infer reviewers from whichever CLIs happen to be installed.

For external Plan, Test Plan, and Code validation:

1. Use only providers listed on that phase under `validation.providers`.
2. Never use the recorded orchestrator as its own independent validator.
3. Give each validator the configured `breadth`, `depth`, and `output` boundary.
4. Run no more than `maxCycles` review-and-fix cycles per provider.
5. Save every response and resulting fix evidence under the phase directory.
6. Record each cycle through `ewai_delivery_record_validation_cycle` or `ewai delivery validation-cycle`.
7. Complete only when every selected provider's latest cycle passes. If findings remain at the cycle limit, report the block.

An external phase marked `not-supported` honestly records that no independent reviewer was selected. It never weakens Standards Sweep: use `$ewai-standards-check`, produce `standards-sweep.md`, and confirm accepted SPECS standards regardless of provider availability. Standards compliance cannot be disabled or waived.

## Phase boundaries

Use guarded operations only:

- `ewai_delivery_start_phase`
- `ewai_delivery_record_gate`
- `ewai_delivery_record_validation_cycle`
- `ewai_delivery_complete_phase`
- `ewai_delivery_approve_build`
- `ewai_delivery_approve_manual_qa`

Never mutate a raw phase or status. A phase completes only with its passing EWAI gate ledger and fresh, hashed project evidence. Record meaningful progress events for the dashboard.

Plan must produce `build-plan.md`, `destination.md`, the Claim Ledger, Plan Contract, and complete `task-graph.json`. The deterministic task-graph validator checks source records, claim and slice coverage, dependencies, cycles, write-set isolation, branch uniqueness, task contracts, waves, evidence paths, and review/merge ownership. Do not author its passing output manually.

## Persona-led test scenario integration

During Test Plan, use `$ewai-test-scenarios` when personas can materially expand coverage of user journeys, permissions, accessibility, security or privacy, operations, recovery, misuse, adversarial behaviour, or other role-specific concerns. Preparation must show the active persona ensemble and keep authoritative sources, persona hypotheses, and human decisions distinct. Scenario evidence is conditional and additive: do not make `test-scenarios.json` or `test-scenarios.md` a retroactive phase requirement for historical or unrelated deliveries.

During Build, use `$ewai-test-scenarios` when an accepted automated or hybrid scenario applies to the leased task. Build the failing test first, preserve the accepted scenario oracle, and retain traceability from scenario ID to test result. Manual QA, specialist assurance, and representative-user validation remain named human evidence routes and cannot be completed through persona simulation.

For user-interface work, use `$ewai-design-system-apply` during UI Design, then `$ewai-prototype-iteration` to review the plan and produced design with independently selected relevant personas before selecting the runnable prototype. New deliveries must link the immutable application receipt, reviewed plan, and final design cycle through `ewai.prototype-manifest/v3`; historical v1/v2 manifests remain readable but cannot complete a newly stamped v3 UI Design contract. UI Design must include a selected runnable prototype and its project-local prototype manifest. Build cannot use a narrative design document, an unlinked design-system prompt, persona advice, or an unassessed persona finding as a substitute for a prototype decision.

Build approval must be an explicit human decision in the current conversation and a durable approval record. Until then, stop before branch creation or code writing. Manual QA must likewise be explicitly approved before Retro.

## Build task ownership and evidence

After Build is approved and entered, read `item.execution.tasks`. Only a task listed under `item.execution.actions.acquireTask.candidates` may start.

For every task agent:

1. Acquire `ewai_acquire_execution_lease` with the exact task ID, stable owner ID, current tool, and run ID.
2. Keep the private lease token within that worker context; never write it to SPECS, reports, chat, or source control.
3. Work only inside the declared write set and task branch/worktree. The orchestrator remains the only writer for central delivery files, gate ledgers, and merges.
4. Renew the lease at material checkpoints before expiry; do not publish empty heartbeat events.
5. Follow the task's explicit red, green, and refactor contract.
6. In interactive delivery, write both `tasks/<id>/report.md` and the task's `evidence_path` JSON. In AFK delivery, the worker changes only its repository write set and the conductor writes both records centrally from captured execution facts. The JSON must cite captured command outputs and hashes, changed files, declared and actual branch/commit, repository, review evidence, and every planned completion check.
7. Release with the truthful outcome. EWAI will not accept `completed` from narrative alone; structured evidence must validate first.

Execution leases are disposable coordination state. The task graph, report, structured evidence, delivery state, and gate evidence are the durable project record. Never use “claim” to mean task ownership; the Claim Ledger records implementation truth.

Start the intent-level active session with a stable `ownerId`. A different orchestrator cannot silently replace it; finish or explicitly hand off first.

## Unattended Build conductor

When the user explicitly asks EWAI to continue approved Build work while they are away, use the AFK conductor instead of inventing a host-specific background loop:

1. Call `ewai_afk_preflight` and explain every blocker. Never weaken the task graph to make preflight pass.
2. Confirm the user has already approved Build and understands the bounded scope, provider choice, maximum parallel tasks, and timeout.
3. Call `ewai_afk_start`. Report the durable run ID and how to pause, resume, cancel, and inspect it; do not expose lease tokens or raw prompts.
4. Use `ewai_afk_status` for updates. Translate semantic run/task states into human language rather than streaming model internals.
5. A blocked run requires attention; diagnose its preserved log/evidence before `ewai_afk_resume`. Never silently retry a stop condition, failed review, scope breach, merge conflict, or post-merge failure.

The conductor is a local Build executor, not a replacement for the fourteen-stage harness. It detects simple and multi-repository topology from the configured `pipeline.yaml`; every task's `repo` must match a configured repository, and exactly one configured repository must contain the configured SPECS root to own durable evidence. The workspace root need not be a Git repository. It creates a missing integration branch from each selected repository's clean current branch, then creates a real task branch/worktree there, leases only ready AFK tasks, limits concurrency to the validated graph, requires a fresh-context review, merges into that repository's declared parent branch in graph order, and runs post-merge checks. It blocks detached heads and refuses to silently switch when the declared integration branch already exists elsewhere. Use `task-graph.json.repository_branches` when repositories have different parent branches. Completion means all eligible Build tasks were integrated; it does not complete the Build phase, Standards Sweep, Test Execute, external validation, Delivery, Manual QA, or Retro.

## Human interaction

Translate control-plane work into warm, semantic progress such as “Validating the plan against project standards” or “Checking what changed since this work was shelved.” Do not make the user learn the command surface. Ask only decisions the evidence cannot answer.

When blocked, retain the exact phase, evidence, questions, and recovery point. When complete, Retro must capture learning and route accepted improvements into project-owned SPECS assets.
