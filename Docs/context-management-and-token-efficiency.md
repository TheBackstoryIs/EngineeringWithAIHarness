# Context management and token efficiency

EWAI reduces repeated model input by assembling the minimum sufficient evidence for the work happening now. It does not shorten context by weakening engineering expectations. Standards, tests, security and privacy constraints, contradictions, task boundaries and human authority remain mandatory whenever the selected profile requires them.

You normally don't prepare context manually: the relevant EWAI skill does that for its task. Use this guide when you want to understand why particular evidence or personas were selected, investigate missing context, or adjust a focused preparation. For example, ask EWAI: “Show me which evidence we're using for this intent and what's been left out.”

Context preparation doesn't approve Build or Manual QA, accept risk, certify quality, deploy or release.

## Inspect the evidence sent to the model

Open **Configuration**, enable **AI context diagnostics** and save, then open that view in the sidebar. See [dashboard configuration](operations/dashboard-configuration.md) if you need help finding it.

1. Choose a profile for the operation you want to inspect; the table below explains each one.
2. Enter the intent slug.
3. Enter a task ID for `build-task` or `fresh-context-review`.
4. Add a narrow focus when it will improve relevance.
5. Keep the default budget initially, or enter a deliberate bounded value.
6. Optionally paste the exact previous digest to inspect segment and persona deltas.
7. Select **Prepare manifest**.

The view shows the context budget, which evidence was selected or left out, whether mandatory content fitted, the content digest and the active personas. It doesn't show the actual source bodies or model payload. On mandatory overflow it shows recovery choices and no downstream handoff. Preparing this manifest doesn't itself ask a model to do the work.

## The seven profiles

Budgets below are estimated input tokens, not words or a guarantee of a provider's billed usage. A token is a unit of text processed by a model; the exact token count depends on its tokenizer.

| Profile | Use it for | Default token budget | Required evidence |
| --- | --- | ---: | --- |
| `companion` | deciding what deserves attention now | 2,000 | current delivery state and human route |
| `intent` | shaping purpose and acceptance | 4,000 | canonical intent and authority boundary |
| `plan` | designing implementation | 8,000 | accepted plan, claims and test obligations |
| `build-task` | implementing one leased task | 12,000 | exact task, write set, allowed commands and stop conditions |
| `fresh-context-review` | reviewing one task independently | 12,000 | tests first, exact diff scope, standards and verdict contract |
| `phase-contribution-review` | reviewing an attributed phase thread | 6,000 | current phase state, attribution and human authority |
| `design-system-apply` | applying resolved design guidance to one UI delivery | 6,000 | required contributions and design/human authority |

The profiles are built-in policies for different operations. EWAI uses the appropriate profile in its workflow; when preparing directly, select one rather than combining several into a large generic prompt.

## What gets selected

Each candidate segment is classified as:

- **mandatory:** must fit in full and retain all required markers;
- **relevant:** included in priority order while budget remains;
- **optional:** useful background that can be deferred.

The assembler sorts deterministically, selects mandatory evidence first, and records one of `selected`, `reused`, `deferred`, or `overflow` for every segment. It hashes both content and policy, so a source or selection-policy change invalidates reuse. The fragment cache is private, project-local and disposable. Canonical SPECS and repository files remain the source of truth.

If mandatory demand exceeds the budget, the result is `non-ready` with reason `mandatory-overflow`. No model payload is produced. Narrow the focus, raise the bounded budget, or split the operation. Do not remove a standard, test, security constraint or approval boundary to make the pack fit.

## Persona swapping

Every preparation considers installed project, personal, premium and core personas. EWAI selects a small ensemble from the profile and current focus, preferring the most relevant project and installed premium lenses where available. The **AI context diagnostics** view shows each active persona's:

- name and tier;
- matched signals;
- engagement reason;
- additions, retention and removals compared with an exact predecessor.

When the work moves from product intent to implementation, performance, security or review, EWAI prepares context for that new operation. If you're using the CLI directly, prepare again with the new focus. Relevant personas replace those no longer needed. Personas remain advisory lenses, not participant evidence, specialist assurance, acceptance or approval. Missing premium content is optional enrichment; context preparation never downloads it.

## Use the CLI

Prepare context with:

```bash
ewai context prepare intent \
  --slug governed-context-assembly \
  --focus "outcomes and engineering performance" \
  --project . \
  --json
```

For a Build task:

```bash
ewai context prepare build-task \
  --slug governed-context-assembly \
  --task T-001 \
  --focus "provider usage and latency" \
  --project . \
  --json
```

Trusted CLI and MCP hosts receive the transient `modelContext` and `deltaContext` needed for their immediate operation. Browser APIs return only safe manifests. None of these interfaces accepts an alternate root or unrestricted source path from an untrusted caller.

## Understand usage numbers

EWAI labels local estimates with `utf8-bytes-div-3-v1`. These figures are deterministic comparisons, not a claim about a specific provider tokenizer. Provider-reported usage, when a provider returns strict numeric input and output counts, is recorded separately from estimated usage. Missing provider usage stays unknown; it is never replaced with an estimate presented as actual consumption.

An exact predecessor enables delta reporting and a smaller `deltaContext` for hosts that can safely reuse their immediately preceding context. The full context remains available to trusted hosts for correctness. A mismatched predecessor digest fails rather than guessing what the host remembers.

## Run the packaged comparison

If you want to inspect the bundled comparison, use:

```bash
ewai context benchmark --json
```

It uses a fixed comparison corpus, not your application's full workload. Read its per-profile results and failures; it doesn't measure provider latency, answer quality or actual account usage.

If you're changing EWAI itself, follow [maintainer context benchmarks](maintainers/context-benchmarks.md) for the source-checkout scripts, thresholds and wider regression checks. Those aren't application setup requirements.

## Recovery and privacy

- Delete the context cache if it is suspect; the next run rebuilds it from canonical sources.
- Treat `.ewai-pipeline/runtime/context-packs/` as private operational state, not durable project truth.
- Share safe manifests when diagnostics are needed, not cached fragments or transient model payloads.
- Use project-relative evidence references in manifests; absolute machine paths do not belong in safe projections.
- If a digest, source, phase or task has changed, prepare a new pack and review the delta.

Context efficiency is useful only when the resulting engineering work remains at least as reliable, testable, secure and accountable as the full-context baseline.
