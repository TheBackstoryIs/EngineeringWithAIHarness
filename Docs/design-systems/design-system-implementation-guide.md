# Design-system implementation guide

This guide is for maintainers integrating the portable capability into EWAI projects and hosts. It adds no server backend, connector, or design-system management UI: the supported boundary is local CLI/domain functions, installed skills, project state, and delivery evidence.

## Installed assets

The npm package contains:

- `config/design-system.schema.json` and the design-system extensions to the pack, project, and Organisation Blueprint schemas;
- the bundled fallback under `packs/design-systems/default/`;
- resolver, authoring, application, receipt, and prototype-manifest validation modules under `src/`;
- `$ewai-design-system-author`, `$ewai-design-system-apply`, `$ewai-prototype-iteration`, and `$ewai-design-system-review`;
- these operating guides.

Run `ewai install --host auto` after an npm upgrade to copy the current skills to supported hosts. Project installations place Codex and Antigravity skills under `.agents/skills/`; Claude Code uses `.claude/skills/`.

## Catalogue roots and authority

EWAI discovers bundled, personal, and project-local packs. Source class is provenance, not precedence. Duplicate design-system IDs fail; dependencies and replacements are declared in the manifest. Project selection is independent and pinned in the project’s configured `SPECS/pipeline.yaml` with a matching strategy record.

The bundled fallback works without configuration but is visibly unapproved. An Organisation Blueprint can recommend design-system IDs through its `design_systems` module, but recommendation never installs, selects, or copies them.

## Application lifecycle

1. Begin an EWAI delivery with UI Design in scope.
2. Inspect the current design-system status and resolve stale pins.
3. Run `ewai design-system apply DELIVERY_SLUG --focus TEXT --project PROJECT --json`.
4. Handle `mandatory-overflow` without dropping required material.
5. Give the transient `modelContext` only to the active model call. CLI output and persisted evidence intentionally omit it.
6. Show active personas by safe reference, name, tier, matched signals, and reason. Do not persist definitions.
7. Prepare and record persona review of the prototype plan.
8. Produce the runnable prototype, capture separate evidence channels, and prepare a newly selected rendered-design persona ensemble.
9. Record assessed findings within the one-to-three-cycle bound.
10. Link the returned receipt, reviewed plan, and final cycle into the prototype manifest.
11. Validate UI Design through the normal EWAI artefact and gate operations.

The application service reuses `prepareContextPack`; do not create a second budgeting mechanism in host integrations. Non-UI context profiles receive no design-system segments.

## Prototype manifest v3

New delivery states are stamped with `artefactContracts.prototype: ewai.prototype-manifest/v3`. The manifest remains at:

```text
SPECS/6.Build/<delivery>/ui-design-assets/prototypes/manifest.json
```

Its selected HTML entry point stays inside `ui-design-assets/prototypes/`. v3 retains the v2 design-system linkage and adds:

```json
{
  "schema": "ewai.prototype-manifest/v3",
  "designSystem": {
    "receiptPath": "ui-design-assets/design-system/receipt-<digest>.json",
    "receiptDigest": "sha256:<receipt-digest>",
    "effectiveDigest": "sha256:<effective-design-system-digest>"
  },
  "reviews": {
    "plan": {
      "path": "ui-design-assets/prototype-iterations/plans/plan-<digest>.json",
      "digest": "sha256:<review-digest>"
    },
    "finalCycle": {
      "path": "ui-design-assets/prototype-iterations/cycles/cycle-2-<digest>.json",
      "digest": "sha256:<review-digest>",
      "cycleNumber": 2
    }
  }
}
```

The validator rejects missing, absolute, escaping, symbolic, invalid, altered, wrong-delivery, or digest-mismatched receipts and review records. It also requires the final cycle to reference the reviewed plan and selected HTML entry point. Historical v1 and v2 manifests without the new delivery stamp remain readable. To migrate a newly governed UI delivery, apply the active system, complete the persona-guided plan and rendered-design reviews, retain the selected prototype fields, change the schema to v3, and add all returned linkage.

## Performance and privacy

- Mandatory contributions fail non-ready when they exceed the explicit token budget.
- Content-addressed cache entries are disposable and contain private context; receipts contain only safe projections.
- Keep non-UI fixed fixtures byte-for-byte stable.
- Maintain the local preparation contract of at most 75 ms median and 32 MiB aggregate peak RSS growth on the recorded test fixture.
- Never send credentials, absolute paths, or premium persona bodies into receipts, summaries, logs, or manifests.

## Recovery and testing

Run focused tests for pack resolution, authoring, application, prototype linkage, review, installation, and packaging. Then run `npm run check`, `npm test`, and `npm pack --dry-run --json`. A dry run proves package contents only; it does not publish.

When a receipt no longer matches, leave it immutable, reapply, and update the prototype manifest to the new receipt. When a selected pack is stale, require a new named selection approval. Manual QA, accessibility assurance, publication, deployment, and release remain separate.
