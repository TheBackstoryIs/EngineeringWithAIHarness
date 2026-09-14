---
name: ewai-design-system-review
description: Review a prototype or implemented interface against the immutable EWAI design-system application receipt that shaped it. Use after a UI artefact exists, during UI Design iteration, before Manual QA, or when assessing whether a local deviation should remain local or be proposed for a later pack-authoring cycle.
---

# EWAI Design System Review

Produce an evidence-cited, advisory conformance review without rewriting historical evidence or granting acceptance. Read [the review contract](references/review-contract.md) completely before reviewing.

## Workflow

1. Locate the selected artefact, its `ewai.prototype-manifest/v3`, the linked immutable design-system receipt, reviewed plan, and final persona review cycle. Stop if linkage or digests do not validate. Historical v1/v2 manifests remain readable but do not satisfy a newly stamped v3 delivery.
2. Review the artefact against the contributions recorded as selected in that receipt—not against a newer pack that did not shape it.
3. Separate evidence channels: source inspection, rendered viewport, interaction, assistive-technology, user research, Manual QA, and release. Mark an unperformed channel absent; missing evidence must remain missing.
4. Swap in only relevant product, design, accessibility, content, domain, and engineering personas from the core, project-local, personal, and already installed premium catalogues. Show every active persona’s safe reference, name, tier, matched signals, and reason. The standard host-model path remains complete without premium access, and you must never expose or persist premium persona bodies.
5. Use `$ewai-prototype-iteration` to recompute the relevant rendered-design ensemble, record its findings, and assess each finding exactly once. Then classify design-system conformance as `aligned`, `approved-deviation`, or `unresolved` using the exact rules in the reference.
6. Distinguish delivery-local correction, explicitly approved local deviation, and reusable learning. Route reusable learning as a proposal for a later design-system authoring cycle.
7. Present findings, evidence limitations, active personas, and named next decisions. The review does not approve a deviation, Build, Manual QA, accessibility, publication, deployment, or release.

## Boundaries

- Never edit or replace the installed or upstream pack during review.
- Never rewrite the immutable receipt or review against unrecorded context.
- Never turn persona agreement into evidence about real users.
- Never infer rendered, responsive, keyboard, assistive-technology, user, Manual QA, or release evidence from source inspection alone.
- Never use `approved-deviation` without existing cited evidence from a named accountable owner.
