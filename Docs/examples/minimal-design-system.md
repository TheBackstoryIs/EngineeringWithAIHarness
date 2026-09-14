# Install and select a small design-system pack

Use a disposable initialised project for this exercise. It shows the distinction between a candidate folder, an installed pack and an approved project selection. In a real project, review the guidance with its owner before selecting it.

## Create two files

Create `example-design/pack.yaml` inside the project:

<!-- example: design-manifest -->
```yaml
schema: ewai.pack/v1
id: org.example.product-design
name: Example Product Design
description: A small reviewed design example for a support tool.
version: 1.0.0
type: design-system
requires: []
design_system:
  compatibility:
    ewai: 0.x
  provenance:
    kind: owner-declared
    summary: Fictional example for learning the pack workflow.
  contributions:
    - id: recovery
      kind: principles
      title: Recover from a failed action
      source: recovery.md
      applicability: [prototype, review]
      required: true
```

Create `example-design/recovery.md`:

<!-- example: design-content -->
```markdown
# Recover from a failed action

Keep the user's entered information when an action fails. Explain what didn't complete and provide a clear retry route. Don't show a success message until the action succeeds.

Review the error and empty states as well as the successful screen.
```

## Validate, install, then resolve

```bash
ewai design-system validate ./example-design --project . --json
ewai design-system install ./example-design --scope project --expected-digest <digest-from-validation> --yes --project . --json
ewai design-system resolve org.example.product-design --project . --json
```

Copy the complete `digest` value, including `sha256:`, from validation. Installation should report `installed`. Resolve the **installed ID**, not the candidate folder.

Resolve returns an `effectiveDigest` for the resolved guidance. This can differ from the candidate's installation digest. Review the dependencies and contributions before proceeding.

## Select the resolved guidance

```bash
ewai design-system select org.example.product-design --expected-digest <effectiveDigest-from-resolve> --approved-by "Example owner" --yes --project . --json
ewai design-system status --project . --json
```

Status should now show a selected root, and `SPECS/5.Strategy/design-system.md` records the selection. This is a tutorial selection, not evidence that a real product owner approved this example.

To apply it, you need an existing UI-bearing delivery. Continue with [application and review](../design-systems/design-system-user-guide.md#apply-it-to-ui-work); installing this pack doesn't create that delivery.

An edited candidate or changed installed content needs fresh validation and review. Don't reuse an old digest, overwrite an installed version or silently substitute the bundled fallback for the intended project pack.
