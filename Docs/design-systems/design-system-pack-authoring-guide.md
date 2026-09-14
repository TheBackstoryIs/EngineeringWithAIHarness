# Design-system pack authoring guide

Use a pack when guidance should be reused across features or projects. Keep a one-off delivery decision local; promote it only after evidence shows it is a repeatable rule.

Ask EWAI: “Help me capture our product's design guidance as a reusable pack.” The `ewai-design-system-author` skill helps you examine the evidence and draft the guidance. You review the proposed rules, their sources and the files before approving installation. The examples below show the pack format and the optional direct commands.

## Evidence-led authoring

During the authoring conversation, check that each proposed rule has one of these evidence classes:

- **owner-declared** — an accountable owner states the intended experience;
- **observed** — product, repository, research, or rendered evidence supports it;
- **inferred** — a useful hypothesis still awaiting confirmation;
- **conflict** — sources or stakeholders disagree and the disagreement needs an owner decision.

EWAI uses relevant core, project-local, personal and already installed premium personas as the subject changes. You see which perspectives are active and why; ask for a different perspective if an important concern is missing. Personas challenge evidence but don't approve guidance. Keep the resulting design rules in the pack, not the private body of a premium persona.

## Pack structure

For a complete starting point, use the [two-file design-system example](../examples/minimal-design-system.md). It includes the actual Markdown contribution as well as `pack.yaml`, then follows validation, installation and selection. The broader layout below shows where to put additional guidance as the pack grows; you don't need empty files for every possible contribution type.

```text
my-design-system/
├── pack.yaml
├── experience-promise.md
├── principles.md
└── components/
    └── buttons.md
```

The manifest is data-only:

```yaml
schema: ewai.pack/v1
id: org.example.product-design
name: Example Product Design
description: Reusable product experience guidance.
version: 1.0.0
type: design-system
requires: []
design_system:
  compatibility:
    ewai: 0.x
  provenance:
    kind: owner-declared
    summary: Approved product principles captured with the product owner.
  contributions:
    - id: experience-promise
      kind: experience
      title: Experience promise
      source: experience-promise.md
      applicability: [ui-design, prototype, review]
      required: true
      replaces: []
```

Supported contribution kinds are `experience`, `principles`, `foundations`, `tokens`, `components`, `interaction`, `content`, `states`, `responsive`, `accessibility`, `motion`, `prohibited`, and `review`.

Composition is explicit. Add dependencies under `requires`. When one contribution replaces another, identify the exact qualified target, for example:

```yaml
replaces:
  - ewai.design-system.default:product-principles
```

Do not rely on bundled, personal, or project-local filesystem precedence.

## Validate, review, then install

Validation does not modify the candidate:

```bash
ewai design-system validate ./my-design-system --project . --json
```

Review the ID, version, compatibility, contribution metadata, provenance, and digest. After explicit confirmation, install that exact digest into one scope:

```bash
ewai design-system install ./my-design-system \
  --scope project \
  --expected-digest sha256:<candidate-digest> \
  --yes \
  --project . \
  --json
```

Use `--scope personal` for a design system meant to be available across the current user’s projects. Installation stages beside the destination, revalidates the digest, atomically creates a new path, and refuses overwrite. It does not select or apply the pack.

Symlinks, remote content, traversal, missing referenced files, incompatible EWAI majors, excessive content, duplicate identities, cycles, ambiguous contributions, and stale digests fail closed.

## Version and governance

Change the version whenever governed content changes. Treat a breaking meaning or contribution identity change as a major pack decision even while EWAI is pre-1.0. Preserve the evidence behind changes and obtain a new selection approval when a project pin becomes stale.

An Organisation Blueprint can recommend the pack ID and version range for consistent setup. Keep the pack separate: Blueprint recommendations are metadata, not installation, selection, or copied design content.
