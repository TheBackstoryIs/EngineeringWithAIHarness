# Intent contract

Intent files use `ewai.intent/v1` frontmatter and live at:

```text
SPECS/2.Purpose/intents/<domain>/<slug>.md
```

Required metadata:

- `slug`: stable lower-kebab identifier.
- `title`: human-readable outcome name.
- `status`: `draft`, `ready`, `superseded`, or `retired`.
- `intent_map`: optional approved intent-map slug.
- `personas`: zero or more `{ ref, role, depth, reason? }` attachments.
- `relationships`: zero or more `{ type, target, rationale? }` connections using an exact `<domain>/<slug>` target.
- `delivery_shape`: early preview of whether this should deliver as one intent, split before delivery, or pause for a split decision.

`delivery_shape` uses:

- `recommendation`: `single`, `split`, or `decision-required`.
- `reason`: why the current shape is or is not a manageable delivery unit.
- `suggested_children`: possible child intent slices, each with optional `domain`, `slug`, `title`, `outcome`, and `depends_on`.
- `blocking_questions`: owner questions that must be answered before a safe split or delivery.
- `reviewed_decision`: `keep-as-one`, `split`, `refine-split`, `defer`, or `null` when not yet reviewed.

Required narrative sections:

- Problem
- Desired outcome
- Users and personas
- Journeys
- Acceptance criteria
- Constraints
- Dependencies and relationships
- Delivery shape preview
- Evidence
- Open decisions

An intent should normally be split before delivery when it contains multiple independently valuable outcomes, materially different user journeys, separate actor groups, separate integrations, load-bearing security or compliance decisions, or acceptance criteria that cannot be verified cleanly in one delivery cycle.

Use `config/intent.schema.json` from the EWAI installation as the machine-readable metadata schema.
