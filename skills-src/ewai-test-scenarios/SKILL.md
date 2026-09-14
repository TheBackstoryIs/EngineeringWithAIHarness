---
name: ewai-test-scenarios
description: Design source-grounded test scenarios with a dynamically selected ensemble of installed EWAI personas, record reviewed scenario evidence, and build automated tests from accepted scenario oracles. Use during EWAI Test Plan when persona perspectives can expose missing paths, or during Build when accepted automated or hybrid PTS scenarios apply to the current task.
---

# EWAI Persona-Driven Test Scenarios

Resolve the project and configured SPECS root before acting. Read [the scenario contract](references/scenario-contract.md) before preparing, recording, or implementing a pack.

Use the deterministic CLI for source truth and durable writes. Use agent judgement only to challenge coverage, propose hypotheses, reconcile scenarios, and implement tests. Never treat a persona perspective as evidence, a requirement, an approval, or a substitute for a real user or accountable specialist.

## Choose the mode

- During **Test Plan**, design and record scenarios through the preparation workflow below.
- During **Build**, implement only accepted automated or hybrid scenarios assigned to the current leased task.
- If both are needed, finish reviewed scenario design before using its oracles to build tests.

## Prepare authoritative context

Run:

```bash
ewai test-scenarios prepare <slug> --focus "<current testing concern>" --project . --json
```

Do not draft scenarios before preparation succeeds. The result owns the current source digest, bounded source references, contextual impact evidence, installed-tier availability, and active persona ensemble.

Show the active persona name, tier, matched concerns, and engagement reason before semantic challenge. Engage only the returned ensemble. When the focus changes materially, prepare again and replace the ensemble with the newly selected personas; do not accumulate stale participants.

Premium personas may participate only when reported as installed. Never sync, download, update, or expose premium persona bodies as part of this skill.

## Challenge coverage with personas

Ask each active persona to challenge one or more distinct concerns within its engagement reason. Consider happy path, alternate path, errors, permissions, accessibility, security and privacy, operations, recovery, data, misuse, adversarial behaviour, and regression only when the sources or an explicitly labelled hypothesis make them relevant.

For every proposal:

1. Cite one or more returned authoritative source IDs for the expected behaviour.
2. Record the persona ID and the concern that prompted the proposal.
3. Express preconditions, actions, and observable expected results.
4. Route proof to automated tests, Manual QA, specialist assurance, or representative-user validation.
5. Keep a proposal as an unresolved hypothesis when no authoritative source permits the oracle.

An inferred Blast Radius concern can explain why a scenario should be investigated. It cannot, by itself, authorise expected product behaviour.

When an organisation policy baseline is enabled, treat its current matched policy rule and accepted control evidence as an authoritative source for relevant test scenarios. Preserve the policy rule, control, evaluation digest, and evidence route in the scenario trace. Persona challenges may broaden misuse, privacy, security, accessibility, operational, or recovery coverage, but they cannot alter the policy oracle or satisfy a named-human or specialist-review control.

## Review and record

Before recording, have a named accountable reviewer:

- de-duplicate equivalent scenarios;
- resolve conflicting source interpretations or retain the conflict as a gap;
- reject unsupported accepted oracles;
- select the evidence route and owner;
- name the planned test file and test name for automated or hybrid scenarios;
- retain blocked, superseded, and unresolved hypotheses rather than deleting inconvenient history.

Create a project-local candidate JSON file that follows `ewai.persona-test-scenarios/v1`, then run:

```bash
ewai test-scenarios record <slug> \
  --input <project-relative-candidate.json> \
  --reviewed-by "<named reviewer>" \
  --project . \
  --json
```

Inspect durable state with:

```bash
ewai test-scenarios status <slug> --project . --json
```

If status is `stale`, prepare and review again. If it is `invalid`, preserve the evidence and investigate the reported pair or digest failure; do not repair it by editing Markdown.

## Build tests from accepted scenarios

Read the current task contract, test standards, and authoritative `test-scenarios.json`. Select only accepted scenarios whose automation is `automated` or `hybrid` and whose planned test belongs to the current task write set.

For each selected scenario ID:

1. Read the cited source and accepted observable result.
2. Write the failing test first and capture the expected RED evidence.
3. Preserve the accepted oracle; never weaken or reverse it to match current code.
4. Implement the smallest production change needed for that scenario.
5. Run the focused GREEN command and then the task's refactor checks.
6. Report the scenario ID, test file and name, command result, and remaining human evidence route.

Do not mark Manual QA, specialist assurance, or representative-user validation as passed. Those routes require named human evidence even when an automated portion also passes.

## Stop conditions

Stop and escalate when source references disagree, a requested oracle has no authoritative source, the planned test falls outside the leased task, implementation would change an approval, a persona body would need to enter a safe projection, or a human evidence route is being simulated.
