---
name: ewai-evidence-depth
description: Prepare, review, record, and compare reproducible seven-dimensional Archaeology and Discovery depth using a fresh EWAI Source Map, attributed owner evidence, stable gaps, and contextual core, project, personal, and optional installed premium personas. Use when deciding how deeply to investigate an existing project, repeating Archaeology or Discovery across people or model sessions, explaining different outputs from the same project, or verifying that context and token reductions have not reduced engineering evidence coverage.
---

# EWAI Evidence Depth

Choose investigation depth from governed evidence rather than repository size, ticket count, or model confidence. Keep observed repository facts, owner declarations, persona advice, named depth decisions, and gap grouping visibly separate.

Read [the evidence-depth contract](references/evidence-depth-contract.md) completely before creating inputs, recording a review, comparing runs, or validating another implementation.

## Prepare the run

1. Resolve the project and configured SPECS root from `.ewai-pipeline/project.json`.
2. Inspect Source Map freshness with `ewai archaeology depth-status --project <path> --json`.
3. If missing or stale, run `ewai index refresh --project <path> --json`. Do not prepare from stale repository evidence.
4. Capture owner evidence as bounded identifiers, authority, answer and reason codes, and evidence digests. Never put free-text answers, source bodies, secrets, absolute paths, or managed persona bodies in the input.
5. Run `ewai archaeology depth-prepare --project <path> --input <project-relative-input.json> --json`. Omit `--input` when no attributed owner evidence exists.
6. Present all seven recommendations, coverage, exclusions, failures, stable gaps, adaptive questions, and active personas. Do not collapse dimensions into one overall depth.

The dimensions are architecture, data, security, product, delivery, governance, and operations. A recommendation is advisory until a named person selects every dimension.

## Engage personas contextually

Use the returned active ensemble for the current dimension. Swap relevant core, project, personal, and installed premium personas in and out as the evidence concern changes.

- Show persona name, tier, engagement reason, and the concern where it is active.
- Keep the standard-model baseline complete when premium personas are absent.
- Never download or sync premium personas as part of this workflow.
- Treat personas as advisory lenses. They cannot create owner evidence, choose depth, group gaps, approve Build, accept Manual QA, or release software.

## Review and record

Ask a named accountable owner to:

1. select `bounded`, `standard`, or `deep` independently for every dimension;
2. give a substantive rationale whenever reducing the recommendation;
3. review contradictions and unresolved questions;
4. assign every stable gap to an explicit group and disposition;
5. confirm the exact preparation digest being reviewed.

Record the complete review with:

```bash
ewai archaeology depth-record --project <path> --input <project-relative-review.json> --json
```

Recording creates immutable evidence under the configured `SPECS/3.Evidence/discovery-depth/runs/` root. It is not delivery, security, Manual QA, deployment, or release approval.

## Compare repeated runs

Compare exact stored runs without rescanning the repository:

```bash
ewai archaeology depth-compare <left-run-id> <right-run-id> --project <path> --json
```

Explain change in this order: governed inputs, evidence, personas, selected depth, coverage, stable gaps, then grouping. Do not treat wording variation as material when the structured identity is unchanged. Do not call a comparison reproducible when a derived fingerprint changes without an upstream explanation.

## Preserve the performance boundary

Use the Source Map projection and bounded identifiers rather than loading repository bodies into the depth ledger. Compare stored fingerprints rather than repeating analysis. Treat exclusions, inventory-only files, sensitive files, oversized files, and analysis failures as visible coverage facts.

Token reduction is acceptable only when the same material engineering surfaces, constraints, standards, gaps, and tests remain discoverable. If coverage decreases or unexplained variance appears, restore the missing evidence context before continuing.

## Use the available surfaces

- CLI: `ewai archaeology depth-status|depth-prepare|depth-record|depth-compare`
- MCP: `ewai_evidence_depth_status|prepare|record|compare`
- Dashboard: Guided Setup → Evidence depth

Keep hosted feedback collection, production code interception, runtime policy enforcement, and automatic persona installation outside this workflow.
