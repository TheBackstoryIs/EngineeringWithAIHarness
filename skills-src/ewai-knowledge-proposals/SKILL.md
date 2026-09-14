---
name: ewai-knowledge-proposals
description: Turn promoted meeting evidence or a canonical EWAI retrospective into provenance-bound proposals for project personas, domain knowledge, journeys, requirements, feature candidates, risks, policies, constraints, standards, decisions, patterns, anti-patterns, runbooks or SOPs. Use when a user wants to extract durable learning from governed evidence, including after a meeting, retrospective, delivery or incident, without letting model output write directly into canonical SPECS.
---

# EWAI Knowledge Proposals

Turn governed evidence into reviewable project knowledge. The workflow is **sources → prepare → record → named review → separate named materialisation**. Preparation and personas are advisory; deterministic EWAI code owns validation, destinations, digests and writes.

Refined is a separate product and is out of scope. Do not add connectors, automatic downstream intents, provider-specific model clients or cross-project routing.

## Check the source boundary

Run the internal control-plane command:

```bash
ewai knowledge sources --project <path> --json
```

Use only a returned source reference. V1 accepts promoted meeting evidence and canonical retrospectives. Never substitute an arbitrary file path, private runtime record, draft meeting review or unpromoted transcript.

If no eligible source exists, explain how to promote meeting evidence or complete a retrospective. Do not copy material into the evidence area to make it eligible.

## Prepare the private host contract

```bash
ewai knowledge prepare <source-ref> --project <path> --json
```

Preparation writes nothing. It returns safe source facts, a digest, anchors, bounded `modelContext`, the strict proposal contract, authority notices and the active personas for this moment.

The standard host model with relevant project and core personas is a complete baseline. Premium and personal personas are optional enrichment only when already installed and contextually selected. Never imitate a missing premium persona, fetch managed content, or change entitlement state.

Before analysis, tell the user which active personas are engaged. Include each active persona's name, tier and engagement reason. Replace the ensemble when the source or focus changes rather than accumulating stale personas. Personas can challenge coverage and interpretation; they cannot establish truth, review their own proposals or approve materialisation.

## Draft evidence-grounded proposals

Read [the proposal contract](references/proposal-contract.md) before drafting.

Separate observation from interpretation:

- **Observation:** what the source and cited anchor support.
- **Interpretation:** why that evidence may justify a particular kind of project knowledge.
- **Proposal:** the bounded Markdown candidate, destination, rationale and uncertainty offered for human review.

Use only kinds and destination roots returned by preparation. Cite the source reference and every evidence anchor in the proposal's `## Provenance` section. Keep uncertainty visible. Do not infer stakeholder acceptance, policy authority, legal meaning, security assurance or production readiness.

Construct only `ewai.knowledge-proposal-bundle/v1`. Raw model output is never stored. Do not persist chain-of-thought, prompts, discarded drafts, source bodies or persona bodies. Submit only the final schema-valid bundle:

```bash
ewai knowledge record <source-ref> --input <project-relative-json> --project <path> --json
```

Recording writes under `SPECS/3.Evidence/knowledge-proposals/` only. It does not create canonical destination knowledge.

## Facilitate complete named review

Show each proposal with its kind, destination, evidence anchors, rationale, uncertainty and current destination state. Ask a named accountable person to choose exactly one disposition:

- `accepted`;
- `rejected`, with rationale;
- `deferred`, with rationale; or
- `amended`, with replacement title, complete replacement Markdown and rationale.

Record the complete review:

```bash
ewai knowledge review <bundle-id> --input <project-relative-json> --reviewed-by <name> --project <path> --json
```

Named review and separate named materialisation are distinct decisions. Never infer either name from a persona, meeting participant or repository author.

## Materialise only after a separate request

First show the reviewed outcomes and explain the additive-only behavior: absent destinations are added, identical destinations are reported as current, and differing destinations are preserved as conflicts. There is no overwrite, model merge or deletion.

Only after the user separately and explicitly asks to proceed, record the named approval:

```bash
ewai knowledge materialise <bundle-id> --project <path> --yes --approved-by <name> --json
```

Report added, current and conflict counts separately. A conflict remains unresolved and must not be described as successfully merged. Materialisation does not create a delivery intent, approve Build, accept risk, satisfy Manual QA or authorise release.

If status reports `recovery-required`, explain what the transaction owns and ask before running:

```bash
ewai knowledge recover <bundle-id> --project <path> --yes --json
```

Recovery may remove only incomplete transaction-owned writes. It preserves changed and unrelated files. Inspect current state with `ewai knowledge status [<bundle-id>] --project <path> --json`.

## Stop conditions

Stop and ask the user when:

- the source is not on the eligible list or its digest changed;
- an anchor does not support the proposed interpretation;
- the taxonomy or destination is uncertain;
- review is unnamed or incomplete;
- a proposal needs specialist, legal, security or stakeholder evidence not present in the source;
- materialisation has not been separately requested and named; or
- a destination is a conflict.

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.
