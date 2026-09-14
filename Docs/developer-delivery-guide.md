# Developer delivery guide

Ask EWAI to work through an intent with you. The **ewai-deliver** skill coordinates planning, implementation and review, checks what each stage needs, and asks for your approval before Build. You can start with a draft; its outcome and acceptance criteria need to be ready before the Intent stage finishes.

Try the [first-delivery tutorial](tutorials/first-delivery.md) for a guided example. This guide provides the operational detail and commands when you need direct control.


<!-- editorial: contents -->
## On this page

- [Before delivery begins](#before-delivery-begins)
- [Start through the guarded workflow](#start-through-the-guarded-workflow)
- [Understand the fourteen stages](#understand-the-fourteen-stages)
- [Use personas to expand test coverage](#use-personas-to-expand-test-coverage)
- [Plan vertical slices](#plan-vertical-slices)
- [Preserve the Build approval boundary](#preserve-the-build-approval-boundary)
- [Build with evidence](#build-with-evidence)
- [Run standards and tests separately](#run-standards-and-tests-separately)
- [Prepare Delivery and Manual QA](#prepare-delivery-and-manual-qa)
- [Shelf and resume](#shelf-and-resume)
- [Definition of done](#definition-of-done)
- [Related guides](#related-guides)
- [Current contract sources](#current-contract-sources)

## Before delivery begins

Use these checks to establish what you know and what needs work. They aren't a requirement to arrive with a finished intent; resolve the outcome and acceptance gaps during Intent.

Confirm:

- the intent describes an outcome rather than only a requested implementation;
- acceptance criteria, constraints, dependencies, and non-goals are explicit;
- attached personas are relevant and advisory;
- repository work and unrelated local changes are understood and protected;
- the repository index is fresh enough for impact and standards claims;
- the configured validation policy is known.

Inspect or refresh repository knowledge:

```bash
ewai index freshness --project .
ewai index refresh --project .
ewai index coverage --project .
ewai index standards-coverage <intent-slug> --project .
```

Review the [Repository Source Map](repository-source-map-guide.md) when inventory-only, shallow, sensitive, oversized, or failed evidence could limit a claim. When changing existing behaviour, use [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md) to inspect the bounded dependency reach, possible consequences, active perspectives, and required human review routes. Treat partial coverage as uncertainty. Repeat the assessment if implementation crosses the assessed boundary.

## Start through the guarded workflow

Normally, ask your host to use `ewai-deliver`. For direct operation, replace `<intent-slug>` with the saved identifier, such as `support/export-filtered-tickets`:

```bash
ewai delivery begin <intent-slug> --project . --tool codex
ewai delivery continue <intent-slug> --project .
```

`begin` creates the delivery run; `continue` inspects it and reports the next permitted step. Neither command performs the whole phase. Continue the work in your AI host using that result.

Use the canonical delivery operations. Never hand-edit a phase status, completion percentage, approval, or SQLite work item to move delivery forward.

## Understand the fourteen stages

[Follow one feature through every stage](explanation/delivery-workflow.md). The table below is the operational summary.

| Stage | Engineering purpose |
| --- | --- |
| Ideate | Convert a rough idea when no sufficient intent exists. |
| Intent | Establish outcome, evidence, acceptance, constraints, and relationships. |
| Reconcile | Compare intent with inherited or existing behaviour. |
| Plan | Define vertical slices, contracts, dependencies, tests, and stop conditions. |
| Pattern Validation | Verify the plan against repository patterns and project standards. |
| Test Plan | Establish red/green/refactor and acceptance evidence before Build. |
| External Plan Validation | Obtain independent review when configured and available. |
| External Test Validation | Independently review the test design when configured. |
| Build | Implement only the explicitly approved scope. |
| Standards Sweep | Check the complete change against project standards. |
| Test Execute | Run the planned tests and retain results. |
| External Code Validation | Independently review the change when configured. |
| Delivery | Prepare the handoff, release evidence, and Manual QA walkthrough. |
| Retro | Capture learning after human acceptance. |

Conditional and provider-gated stages may be skipped or marked not supported by the contract. That is evidence, not permission to invent a review.

The workflow also includes conditional **UI Design** for interface work and **FitCheck** when resuming shelved work. Follow the phase sequence returned by EWAI rather than jumping directly from this overview to Build. After Delivery, **Manual QA** remains a separate human acceptance gate before Retro can close the work.

## Use personas to expand test coverage

During Test Plan, use [Persona-driven test scenarios](quality/persona-driven-test-scenarios.md) when role-specific lenses can materially challenge the accepted journeys, criteria, constraints, impact evidence, standards, or test obligations. Before recording a scenario, have the named reviewer agree what it should demonstrate and which requirement or other accepted evidence supports that result. That agreed expected result is the test's **oracle**.

During Build, implement accepted automated or hybrid scenario IDs only when their planned test belongs to the leased task. Write the failing test first, preserve the accepted oracle, and keep Manual QA, specialist assurance, and representative-user routes open for human evidence.

## Plan vertical slices

A good task produces a user-visible or operator-visible outcome and owns a non-overlapping write set. Record:

- claim and slice IDs;
- repository and branch;
- read and write sets;
- dependencies and execution wave;
- module or interface contract;
- first failing test or an explicit rationale;
- allowed commands;
- stop conditions;
- completion evidence;
- fresh-context review expectations.

Do not split work only by technical layer when doing so creates partially usable or untestable changes.

## Preserve the Build approval boundary

Build cannot start until pre-Build phases pass and an authorised person approves an exact scope:

```bash
ewai delivery approve-build <intent-slug> \
  --project . \
  --yes \
  --approved-by "Product Owner" \
  --scope "The files and outcomes approved for this build"
```

If a human-approved correction changes completed pre-Build gate evidence, ratify the amended ledgers before recording Build approval:

```bash
ewai delivery ratify-amendments <intent-slug> \
  --project . \
  --yes \
  --approved-by "Product Owner" \
  --scope "The corrected intent, plan, UI and test contracts"
```

For the distinction between this operation and narrow completed-evidence corrections, see [Which amendment operation?](completed-phase-evidence-amendments.md#which-amendment-operation).

Ratification revalidates every completed phase, records the old and new gate hashes, and updates the stored fingerprints atomically. It cannot start Build or substitute for the separate Build approval.

Approval is a durable record, not a conversational implication. If the implementation needs a material new outcome, return to Intent or Plan and obtain fresh approval.

## Build with evidence

For each task:

Use `$ewai-deliver` to acquire and maintain an execution lease for the task before writing code. The lease identifies its current worker; it isn't Build approval. The task graph defines the allowed files, commands and stop conditions. Release the lease only with the actual completion or handoff outcome.

1. run the recorded red check and retain the expected failure;
2. make the smallest coherent implementation;
3. run the green check;
4. refactor within the approved contract;
5. review tests before implementation details in a fresh context;
6. record changed files, commands, hashes, and completion checks;
7. stop when a declared stop condition occurs.

Protect unrelated work. Do not use destructive Git operations or automatic stashing to make the worktree look clean.

## Run standards and tests separately

A test suite demonstrates selected behaviour. A standards sweep examines whether the whole change conforms to project constraints. Both are mandatory when the project policy requires them.

External validation is also distinct. EWAI excludes the active orchestrator from the independent reviewer set and honours the configured cycle limit. If no independent provider remains, record the checkpoint as not supported; do not call self-review independent.

## Prepare Delivery and Manual QA

Delivery should include:

- implementation summary and changed files;
- exact automated checks and results;
- accepted limitations and residual risks;
- operational or migration notes;
- rollback or recovery guidance where relevant;
- a reproducible Manual QA walkthrough;
- the decision the human tester is being asked to make.

Manual QA is a separate named gate:

```bash
ewai delivery approve-manual-qa <intent-slug> \
  --project . \
  --yes \
  --approved-by "Product Owner" \
  --evidence SPECS/6.Build/<intent-slug>/qa-evidence.md
```

Only the person who performed or accepted the walkthrough should approve it.

## Shelf and resume

Shelf mode prepares validated planning evidence and stops before Build. Resume must re-enter through the guarded resume/FitCheck path:

```bash
ewai delivery begin <intent-slug> --project . --tool codex --mode shelf
ewai delivery resume <intent-slug> --project . --tool codex
```

Do not resume blocked, corrupt, or ambiguous work by editing state files.

## Definition of done

The work is not done until:

- planned tasks have complete evidence;
- mandatory standards and tests pass; any permitted exception follows its specific reviewed process, and recording a risk alone doesn't waive a required gate;
- configured independent review is complete or honestly unavailable;
- Delivery evidence and a Manual QA walkthrough exist;
- the human acceptance gate is approved;
- the retrospective records reusable learning.

## Related guides

- [Human approval and assurance](human-approval-and-assurance-guide.md)
- [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md)
- [Persona-driven test scenarios](quality/persona-driven-test-scenarios.md)
- [Manual QA and acceptance](quality/manual-qa-and-acceptance.md)
- [Dashboard and delivery state](operations/dashboard-and-delivery-state.md)
- [Project standards authoring](standards/project-standards-authoring.md)

## Current contract sources

- `src/delivery.mjs`
- `src/delivery-gates.mjs`
- `src/delivery-artifacts.mjs`
- `src/task-graph.mjs`
- `src/validation-config.mjs`
- `config/delivery-artifacts.yaml`
- `tests/delivery.test.mjs`
- `tests/task-graph.test.mjs`
