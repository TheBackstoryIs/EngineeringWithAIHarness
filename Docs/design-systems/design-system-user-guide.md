# Design-system user guide

Use a design-system pack when new screens should follow the product's existing design decisions. The pack can describe components, layout, wording, accessibility and how empty or error states should behave. EWAI selects the relevant guidance for a delivery and records what it used, so the resulting prototype can be reviewed against it.

There are three separate steps: **install** makes a pack available, **select** records the owner's choice for the project, and **apply** prepares its guidance for one delivery. The application receipt records that guidance; it isn't an approval of the design.

Design systems sit alongside other EWAI tools, each with a different job:

- a technology or stack pack describes how software is engineered;
- an Organisation Blueprint describes organisation-owned defaults and can recommend design-system IDs;
- a design-system pack describes the experience, interaction, content, visual foundation, component, state, accessibility, motion, prohibited-pattern, and review guidance relevant to a user interface;
- personas supply temporary perspectives; they are not stored design rules or real-user evidence.

## What happens by default

Every project can resolve `ewai.design-system.default`, the bundled fallback. It gives standard LLM capabilities a useful, brand-neutral product-design baseline. You'll see it labelled **bundled fallback**: it isn't a design system approved for your project.

Premium personas are optional. You can complete this workflow with the host and included personas, alongside relevant project-local or personal guidance. Already-installed premium personas can add specialist perspectives; this workflow doesn't download them.

Ask EWAI which design system the project currently uses, or check the state directly:

```bash
ewai design-system status --project . --json
ewai design-system list --project . --json
ewai design-system inspect ewai.design-system.default --project . --json
ewai design-system resolve ewai.design-system.default --project . --json
```

Status distinguishes `fallback`, an explicitly `selected` root, and a `stale` selection whose installed content no longer matches its approved digest.

## Select a project design system

Install the approved pack to make it available. Then resolve that pack and review the result before selecting it for this project. Selecting it records the owner's choice; applying it prepares guidance for a particular delivery.

The commands below use `org.example.product-design` throughout. If it isn't installed, follow the [complete two-file example](../examples/minimal-design-system.md), or obtain the approved candidate folder from your pack owner:

```bash
ewai design-system validate ./example-design --project . --json
ewai design-system install ./example-design --scope project --expected-digest <digest-from-validation> --yes --project . --json
ewai design-system resolve org.example.product-design --project . --json
```

Use validation's `digest` for installation and resolution's `effectiveDigest` for selection. Don't interchange them. After reviewing the dependency graph and contributions, a named accountable owner can select that exact result:

```bash
ewai design-system select org.example.product-design \
  --expected-digest sha256:<effective-digest> \
  --approved-by "Named owner" \
  --yes \
  --project . \
  --json
```

The selection writes a project pin and `SPECS/5.Strategy/design-system.md`. Filesystem order never grants override authority. Dependencies are explicit, and a contribution can replace another only with a qualified `pack-id:contribution-id` target.

An Organisation Blueprint recommendation remains a recommendation. It never installs or selects the named design system, and it does not copy design content into the Blueprint.

## Apply it to UI work

Application belongs to an existing UI-bearing EWAI delivery:

```bash
ewai design-system apply customer-portal \
  --focus "account overview, empty states and recovery" \
  --project . \
  --json
```

EWAI uses the existing bounded context assembler. Required contributions are mandatory; focus-matched material is relevant; other material can be deferred. The result shows selected and deferred contributions plus the active personas, including each safe reference, tier, matched signals, and engagement reason.

If mandatory content exceeds the budget, the result is `mandatory-overflow`, no model payload or receipt is created, and the recovery is to narrow the focus, explicitly increase `--budget`, or split the operation. This protects design fidelity rather than quietly saving tokens by omitting mandatory guidance.

A successful application returns immutable receipt and summary paths under:

```text
SPECS/6.Build/<delivery>/ui-design-assets/design-system/
```

The selected prototype records those digests in `ui-design-assets/prototypes/manifest.json` using `ewai.prototype-manifest/v3`. v3 also links the immutable reviewed plan and final persona-guided rendered-design cycle. The receipt proves what shaped the artefact; the reviews preserve critique and assessment. Neither proves that the result is attractive, usable, accessible, accepted, or ready to release.

## Review and acceptance

Ask EWAI to review the prototype plan, then review the rendered design once it exists. The `ewai-prototype-iteration` skill selects relevant available personas independently for those two reviews. You assess every finding rather than treating a persona's opinion as a decision.

To check conformance, ask EWAI to compare the artefact with the design guidance recorded when it was created. The `ewai-design-system-review` skill labels each cited finding `aligned`, `approved-deviation` or `unresolved`. An approved deviation needs a separate named owner decision; neither review can create that approval.

Source inspection, rendered viewport, interaction, assistive-technology, user research, Manual QA, and release are separate evidence channels. Any channel not performed remains explicitly absent. Named humans retain approval for intentional deviations, Manual QA, publication, deployment, and release.

## Common recovery

- `fallback`: continue for early design work or ask an accountable owner to select a reviewed root.
- `stale`: re-resolve the installed packs and obtain a new named selection approval; never reuse the earlier digest.
- duplicate ID or destination: version or rename the candidate; installation will not overwrite.
- `mandatory-overflow`: narrow focus, increase the explicit budget, or split the surface.
- receipt mismatch: reapply and link the new immutable receipt; do not edit the old receipt.
- historical v1 or v2 manifest: it remains readable, but complete plan and rendered-design review linkage before finishing a newly stamped v3 UI Design phase.
