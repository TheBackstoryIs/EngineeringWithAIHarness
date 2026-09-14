---
name: ewai-design-system-author
description: Build or evolve a governed EWAI design-system pack from owner-declared and observable project evidence. Use when a team wants to capture reusable experience principles, foundations, tokens, components, interactions, content, states, accessibility, motion, prohibited patterns, or review rules without selecting or applying the pack.
---

# EWAI Design System Author

Build a portable, data-only design-system pack whose evidence, contributors, and installation decision remain visible to its owner. Read [the authoring contract](references/authoring-contract.md) before authoring or changing a pack.

## Workflow

1. Confirm whether the candidate is intended for the project-local or personal catalogue. Do not infer permission to install, select, apply, publish, or release it.
2. Gather owner-declared and observed evidence. Label inferred material explicitly, and preserve every conflict until the owner resolves it.
3. Engage only the personas relevant to the design question. Show each active persona's safe reference, name, tier, matched signals, and reason while it is engaged.
4. The standard path must work with core, project-local, and personal personas. Premium personas may improve the critique when entitlement and installation already exist, but you must not download them or copy premium persona bodies into the pack, receipts, logs, or output.
5. Author `pack.yaml` and its referenced Markdown contributions. Use qualified `pack-id:contribution-id` replacement targets; never rely on filesystem precedence.
6. Run `ewai design-system validate FOLDER --project PROJECT --json`. Resolve every schema, containment, compatibility, size, or digest error.
7. Present the safe validation result and proposed scope. Pause for explicit confirmation.
8. Only after confirmation, run `ewai design-system install FOLDER --scope project|personal --expected-digest DIGEST --yes --project PROJECT --json`.
9. Report that installation does not select the pack. Selection and application are separate governed decisions.

## Boundaries

- Never overwrite an installed pack or silently resolve an identity conflict.
- Never select or apply a newly installed pack.
- Never treat persona advice, a generated design system, or a successful validation as owner approval.
- Never place executable code, remote content, credentials, or premium persona bodies in the pack.
- Never claim a pack is visually accepted, accessible, production-ready, published, or released without the corresponding human evidence.
