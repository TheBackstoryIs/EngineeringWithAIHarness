# Context management and token efficiency

EWAI reduces repeated model input by assembling the minimum sufficient evidence for the work happening now. It does not shorten context by weakening engineering expectations. Standards, tests, security and privacy constraints, contradictions, task boundaries and human authority remain mandatory whenever the selected profile requires them.

You normally don't prepare context manually: the relevant EWAI skill does that for its task. Use this guide when you want to understand why particular evidence or personas were selected, investigate missing context, or adjust a focused preparation. For example, ask EWAI: “Show me which evidence we're using for this intent and what's been left out.”

Context preparation doesn't approve Build or Manual QA, accept risk, certify quality, deploy or release.

## Concise answers and guided decisions

**Availability:** This guidance is included from `0.3.1`. [Update EWAI](operations/installation-updating-and-entitlements.md), then initialise the project or run its normal EWAI check-in to refresh the managed instructions in `AGENTS.md` and `CLAUDE.md`. Start a fresh host conversation after the refresh. Project-authored guidance outside the managed block is preserved. Versions `0.3.0` and earlier don't include these instructions. Tool-result compaction remains planned, and no incremental token or cost saving has been measured for this update.

### Get a useful short answer

Describe the result you need, for example:

> “Give me the result and next action concisely. Keep the evidence, exact commands, important risks and anything you couldn't verify.”

The guidance prioritises correctness and usefulness, then brevity. Expect the result or recommendation first, with less repetition and routine narration. Required status, warnings and approval steps still appear. A short answer should retain prerequisites, meaningful action order, failures and uncertainty; it should not replace working instructions with shorthand.

When you need more detail, ask for it:

> “Expand the migration steps, including prerequisites, verification and recovery.”

Detailed requests still need complete answers. If a concise answer leaves you unable to act safely or understand the evidence, ask for the missing detail before acting.

### Make an informed decision

A decision request should explain the action, consequences, material options and tradeoffs, then give a recommendation with its reason. A suggested response can help you express your choice; it does not record approval on your behalf.

You can ask:

> “Explain what I need to decide, recommend an option with its reason, and suggest a reply. Include what happens next and any uncertainty.”

When the evidence cannot support a choice, expect a recommendation for the next evidence-gathering step. Build approval, Manual QA and release decisions still need their own explicit authority; see [who approves what](human-approval-and-assurance-guide.md).

### Refine an unclear request

The guidance leads with a recommended interpretation and explains assumptions that affect the outcome. It asks one focused question when missing information materially changes the scope or next action, with guidance and a recommended response.

For example, if you say “Make onboarding simpler”, an illustrative response is:

> “I recommend reviewing the existing onboarding journey first to identify where people get stuck. I'm assuming you want the journey assessed before changing the implementation. Should we start with that review? Suggested response: ‘Yes, review the journey first and recommend changes.’”

Correct the interpretation when it misses your intent. Work already authorised and independent of your answer can continue; a proposed interpretation or suggested reply does not expand that authority.

### Understand savings claims

Shorter replies aim to reduce output tokens. The context preparation described below addresses input tokens. Neither a shorter example nor the packaged context benchmark establishes whole-session cost savings. Assess equivalent work using actual provider usage where available, including retries and clarification rounds, alongside correctness and how well the answer supports your decision. Unknown usage remains unknown.

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

## Jev beta decision assistance

The local `0.3.4-beta.1` experiment adds an opt-in structured decision path before a larger model comparison. Jev can order bounded options, compare supported LLM recommendations and recommend installed personas from metadata. See [Jev setup and experiment limits](operations/jev-beta-experiment.md). It starts off and first enablement should use shadow. No incremental token or cost saving has been measured on equivalent completed coding tasks; the synthetic runner measures Jev's own usage and latency. Publication and human Manual QA remain separate.

OpenAI Decisions joins the shared bounded engine in experimental `0.3.4-beta.3`. New settings default off with Automatic provider preference; historical Jev policies retain their vendor consent. Private CLI/dashboard OpenAI key setup, independent text consent, typed conversion and provider-aware costs are described in the [OpenAI Decisions beta guide](operations/openai-decisions-beta.md). Live OpenAI access and completed-task savings remain unmeasured.

`0.3.4-beta.5` includes these integrations. Read the [release update](releases/0.3.4-beta.5.md).
