# Discovery contract

`ewai discover` requires an initialized project with `SPECS/pipeline.yaml`.

## Outputs

- `SPECS/1.Scope/context.md`
- `SPECS/1.Scope/project-scope.md`
- `SPECS/2.Purpose/intent-brief.md`
- `SPECS/2.Purpose/explorations/project-discovery.md`
- `SPECS/3.Evidence/success-criteria.md`
- `SPECS/3.Evidence/risk/compliance-applicability.md`
- `SPECS/4.Constraints/project-constraints.md`
- `SPECS/5.Strategy/approach.md`
- `SPECS/5.Strategy/architecture/stack.md`
- `SPECS/5.Strategy/options/minimum-standards.md`

The command also records resolved technology packs and discovery paths in `SPECS/pipeline.yaml`.

For a new project with no repository evidence, the answers must record either selected pack identifiers, explicit custom technology, or an open stack decision. The owner should be interviewed about product and operating constraints before technology is recommended. Accepted stack practices belong in canonical constraints, patterns, or ADRs; the generated minimum-standards file remains a proposal until reviewed.

## Automation

Pass a YAML or JSON document using schema `ewai.discovery-answers/v1` with `--answers`. Required fields are:

- `project.name`
- `project.purpose`
- `project.problem`
- one or more `project.primaryUsers`
- one or more `project.desiredOutcomes`

Use `yes`, `no`, or `unknown` for tri-state assurance answers. Use `--force` only after reviewing the existing discovery artefacts; without it, the command refuses to overwrite them.

Use `available` or `unavailable` for `validation.claude`, `validation.codex`, and `validation.antigravity`. Only explicitly available providers may satisfy external-validation stages.
