---
name: ewai-context
description: Prepare minimum-sufficient, fidelity-checked context for EWAI companion, intent, plan, build-task, fresh-context-review, phase-contribution-review, and design-system application work; inspect active persona lenses and exact deltas; and run the committed engineering-performance benchmark. Use when a host needs bounded project evidence without weakening standards, tests, security, privacy, or human authority.
---

# EWAI Governed Context

Use the project-local context assembler. Do not improvise a smaller prompt by dropping evidence manually.

## Choose one governed profile

Use exactly one of the seven governed profiles for the current moment:

- `companion` for current state, route and recovery;
- `intent` for outcomes, users, constraints and acceptance;
- `plan` for architecture, standards, repository truth and tests;
- `build-task` for one exact leased task and its permitted write set;
- `fresh-context-review` for tests-first independent review of one task diff;
- `phase-contribution-review` for attributed evidence and disagreement in one phase thread.
- `design-system-apply` for resolved, scope-relevant UI Design and Prototype guidance.

Run:

```bash
ewai context prepare <profile> --slug <intent-slug> --focus "<current concern>" --project . --json
```

For `build-task` and `fresh-context-review`, also pass `--task <task-id>`. Design-system application is prepared through `ewai design-system apply <delivery-slug>` and `$ewai-design-system-apply`, which supply validated pack candidates to the same assembler. Use `--previous <digest>` only when it is the exact predecessor manifest.

## Preserve fidelity before reducing demand

Require `status: ready`, `fidelity.status: pass`, and 100% mandatory recall before giving a context payload to a model. Mandatory evidence includes the applicable task boundary, standards, tests, security and privacy constraints, contradictions, and human authority relevant to that profile.

If the result is `non-ready` with `mandatory-overflow`, stop. Do not truncate, summarise away, or bypass mandatory evidence. Narrow the focus, increase the bounded budget, or split the operation, then prepare again.

Treat the cache as disposable acceleration. Project truth remains in canonical SPECS and repository files. Use exact content and policy digests for reuse; never infer freshness from a familiar filename or a partial digest.

## Engage and show the current persona ensemble

Before semantic work, show every active persona's name, tier, matched signals, and engagement reason. The standard host model plus installed core and project personas form the baseline. Personal and installed premium personas may replace or enrich a lens when they are relevant. When the profile or focus changes, prepare again and swap the ensemble; do not accumulate stale personas.

Use premium personas only when they are already installed and reported by the project. Do not fetch, imitate, or expose missing or raw persona definitions during context preparation.

Personas are advisory lenses. They are not user evidence, specialist validation, acceptance, risk ownership, or approval.

## Keep host boundaries intact

- Trusted CLI and MCP hosts may receive transient `modelContext` and `deltaContext` for the immediate operation.
- The loopback dashboard receives only a body-free safe manifest.
- Never accept a browser-supplied project root, file path, provider command, executable, or credential.
- Keep estimated input usage clearly separate from optional provider-reported usage.
- Context preparation cannot approve Build or Manual QA, certify quality, accept security risk, deploy, or release.

## Verify engineering performance

Run the committed equal-input benchmark after changing selection, rendering, persona routing, provider adapters, cache behaviour, or profiles:

```bash
ewai context benchmark --json
```

The result must cover all seven profiles, retain 100% mandatory recall for each, achieve at least 40% median estimated input-demand reduction, prepare within 75 ms median local time, and add no more than 32 MiB peak RSS on the committed fixture corpus. A failed benchmark blocks the change; never relax a fidelity threshold to recover a performance number.

Run the focused context tests and the full repository suite as well. A local benchmark is regression evidence for the measured environment, not proof of provider quality or universal latency.

## Stop conditions

Stop and escalate when mandatory evidence cannot fit, the predecessor digest is unavailable or mismatched, a source is outside the configured project, a task is outside its write set, a safe projection would expose source bodies, persona content is unavailable, the benchmark fails, or anyone asks context preparation to grant delivery authority.
