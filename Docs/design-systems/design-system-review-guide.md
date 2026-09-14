# Design-system review guide

Use `$ewai-design-system-review` when a prototype or implemented surface exists. The review baseline is the immutable receipt linked by the selected artefact’s manifest, not whichever pack happens to be installed today.

Ask EWAI: “Review this interface against the design guidance used to create it.” Point to the prototype or implemented surface and its manifest. EWAI helps compare the available evidence with that recorded guidance. You review the findings and decide which need correction or a separately approved exception; the review itself doesn't approve either.

## Prepare the evidence

Collect the selected artefact, `ui-design-assets/prototypes/manifest.json`, the linked receipt, and any separate evidence from:

- source inspection;
- rendered viewport checks at meaningful widths;
- keyboard, pointer, touch, error, loading, empty, success, and recovery interaction;
- assistive-technology checks;
- representative-user research;
- named Manual QA;
- publication, deployment, or release authority.

Do not merge these channels. A source check cannot prove rendered behaviour, and a persona cannot substitute for user research. Mark missing evidence absent.

## Engage personas visibly

EWAI brings in a small group of personas relevant to the finding: product, design, accessibility, content, domain or engineering. Core, project-local and personal personas support the standard path; already installed premium personas may add depth. The review shows their names, tiers, matched concerns and reasons, not their private definitions. You can challenge the selection or ask for a missing perspective.

## Classify findings

- `aligned` — cited artefact evidence satisfies a cited receipt contribution.
- `approved-deviation` — a named accountable owner already approved this exact local difference in cited evidence.
- `unresolved` — the artefact differs, evidence conflicts, an evidence channel is missing, or no owner approval exists.

The review cannot itself make an `approved-deviation`. It should name the owner decision or correction required.

A useful report records the contribution ID and digest, artefact location, observation, evidence channel, impact, active persona references, classification, and next action.

## Example: a recovery message is missing

Suppose the applied design guidance says a failed submission must retain entered data and offer a retry. In the rendered prototype, the error state clears the form.

Record an `unresolved` finding against that contribution and the observed screen/capture. Ask the designer or engineer to preserve the input and show recovery, then inspect the revised result. A persona suggesting that correction isn't evidence the correction was made.

If a product owner intentionally chooses a different behaviour, obtain and cite their actual deviation decision. Only then can the finding be `approved-deviation`; the reviewer can't grant that status by preference.

## Route the outcome

- Fix a defect in the current delivery when the artefact fails recorded guidance.
- Retain an owner-approved deviation as delivery-local evidence.
- Propose repeatable learning to a later `$ewai-design-system-author` cycle.

Never edit an installed or upstream pack during review. Pack evolution has its own evidence, version, validation, installation, selection, and approval lifecycle.

Static conformance and tests remain advisory evidence. A named human separately decides intentional deviation, Manual QA, specialist accessibility assurance, publication, deployment, and release.
