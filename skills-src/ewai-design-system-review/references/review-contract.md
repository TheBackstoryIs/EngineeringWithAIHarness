# Design-system conformance review contract

## Inputs

- The selected prototype or implemented surface.
- Its validated `ewai.prototype-manifest/v3`, including the linked reviewed plan and final persona review cycle. Historical v1/v2 evidence can be inspected but does not satisfy a newly stamped v3 contract.
- The linked immutable `ewai.design-system-receipt/v1`.
- Any separately captured rendered, interaction, assistive-technology, research, owner-decision, Manual QA, or release evidence.

Current pack content may inform a separately labelled change proposal, but it cannot silently replace the receipt as the historical baseline.

## Finding classifications

- `aligned`: cited artefact evidence satisfies a cited contribution recorded in the receipt.
- `approved-deviation`: the artefact differs, and a named accountable owner has already approved that exact delivery-local deviation in cited evidence. The review cannot create this approval.
- `unresolved`: the artefact differs, evidence is missing or contradictory, or no accountable deviation approval exists.

Each finding records its classification, receipt contribution ID and digest, artefact location, evidence channel, observation, user or engineering impact, active persona references, and required owner action.

## Evidence matrix

Report each channel independently:

| Channel | What it can support | What absence means |
|---|---|---|
| Source inspection | structure, declared semantics, implementation patterns | rendered behaviour is unknown |
| Rendered viewport | visible hierarchy, layout, responsive appearance | visual conformance is unknown |
| Interaction | focus, state transitions, error and recovery behaviour | interaction conformance is unknown |
| Assistive-technology | practical screen-reader or equivalent behaviour | accessibility is not assured |
| User research | observed representative-user needs and outcomes | persona simulation is not user evidence |
| Manual QA | named human acceptance within its recorded scope | the feature remains unaccepted |
| Release | authorised publication, deployment, or production decision | the result is not release-approved |

Automated tests and static inspection can identify valuable findings. They do not certify accessibility or quality.

## Persona and learning boundary

Personas are advisory lenses. Record safe active references and reasons, never definitions or managed bodies. Project-local and personal personas may add context; installed premium personas may deepen critique but are optional.

The review must not change an installed or upstream pack. A pattern likely to benefit other deliveries becomes a cited proposal for a later authoring cycle, where its evidence, conflicts, versioning, installation, selection, and owner approval can be governed separately.
