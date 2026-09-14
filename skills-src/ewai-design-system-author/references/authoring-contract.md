# Design-system authoring contract

## Candidate layout

```text
candidate/
├── pack.yaml
├── experience-promise.md
├── principles.md
└── components/
    └── buttons.md
```

Only `pack.yaml` and files explicitly referenced by its contributions are installed. Symlinks, remote URLs, traversal, missing files, oversized content, duplicate identities, and incompatible EWAI majors are rejected.

## Manifest essentials

The manifest uses `schema: ewai.pack/v1`, `type: design-system`, a globally qualified ID, semantic version, explicit dependencies, EWAI compatibility, provenance, and one or more contributions. Each contribution declares its stable ID, kind, title, relative source, applicability, whether it is mandatory, and qualified replacement targets.

## Evidence ledger

Keep these classes separate:

- `owner-declared`: an accountable owner states the intended experience or rule.
- `observed`: repository, product, research, or rendered-interface evidence supports it.
- `inferred`: a useful hypothesis that still needs confirmation.
- `conflict`: evidence or stakeholder expectations disagree; do not erase the disagreement.

## Review questions

- What experience promise should remain true across features and channels?
- Which existing components and patterns are already authoritative?
- Which rules are mandatory, and which are contextual guidance?
- Which states, responsive conditions, accessibility needs, and content behaviours are missing?
- What is prohibited because it harms trust, clarity, usability, brand, or maintainability?
- Which local or premium personas add a relevant perspective, and why are they active now?

Persona output is advice. The project owner resolves conflicts and approves the pack digest, installation scope, later selection, later application, Manual QA, and release.
