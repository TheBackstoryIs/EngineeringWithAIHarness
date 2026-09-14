# Persona-guided prototype review contract

## Two independent review stages

Plan review examines intended screens, journeys, outcomes, information architecture, constraints and decision ownership. Rendered-design review examines the produced prototype and the evidence actually captured for it. Persona relevance is recomputed for each stage.

Store only safe persona metadata: ID, name, tier, category, matched signals and engagement reason. The host model with installed core and project personas is complete. Personal and premium personas may enrich the review only when already installed.

## Finding and assessment separation

A finding records:

- active `personaId`;
- stable `concernCode`;
- `advisory`, `material`, or `critical` severity;
- observation and recommendation;
- bounded evidence references.

Its stable ID derives from persona, concern code and sorted evidence references, not explanatory prose.

Every finding receives exactly one assessment:

- `incorporate`: apply the recommendation;
- `incorporate-with-modification`: apply the recorded bounded modification;
- `defer`: retain it visibly for a later owned decision;
- `reject`: do not apply it, with rationale;
- `escalate`: require a named human decision.

An unassessed finding keeps the review incomplete. A material or critical deferral requires human decision. Incorporated feedback causes iteration unless the configured cycle limit has been reached, when it becomes `human-decision-required`.

## Evidence channels

Represent all channels independently:

| Channel | Required for persona design review | Authority boundary |
| --- | --- | --- |
| `source` | yes | supports source observations only |
| `rendered-viewport` | yes | supports visible rendered observations |
| `interaction` | when performed | does not imply assistive-technology evidence |
| `assistive-technology` | when performed | remains absent until actually exercised |
| `user-research` | when performed | persona simulation never substitutes for it |
| `manual-qa` | separate human gate | persona review cannot mark it available |
| `release` | separate release authority | persona review cannot mark it available |

## Immutable chain

Plan reviews and cycles are content-addressed under `SPECS/6.Build/<delivery>/ui-design-assets/prototype-iterations/`. A later design cycle names the immediately preceding cycle digest. `ewai.prototype-manifest/v3` links the reviewed plan and final cycle to the selected HTML entry point.

Historical manifest v1 and v2 records remain readable. Newly stamped v3 deliveries must not complete UI Design with only a design-system receipt and no reviewed prototype evidence.
