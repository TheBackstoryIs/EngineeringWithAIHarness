# Persona-guided prototype iteration

EWAI reviews both the proposed prototype plan and the design that is actually produced. At each stage it identifies the most relevant available personas, shows why they are active, records their findings separately, and requires every finding to be assessed before the review can close.

This is design evidence, not an autonomous approval system. Personas advise. A named person selects the prototype, Manual QA remains a human gate, and deployment and release remain separate decisions.

Ask EWAI: “Review this prototype plan, then help me improve the rendered design using the relevant personas.” EWAI prepares the review inputs, shows the active perspectives and records their findings. You review the proposed responses, decide material trade-offs and select a design when it's ready. The optional CLI workflow below is for inspecting and recording the same evidence directly.

For the complete path from intent and design-system application through screen planning, runnable HTML creation, browser evidence and production handoff, see the [screen prototype creation guide](screen-prototype-creation-guide.md).

## The lifecycle

1. EWAI applies the selected design system—or the clearly labelled bundled fallback—to the UI delivery.
2. EWAI prepares a review of the prototype plan with relevant installed personas.
3. You inspect their findings and the proposed responses; material deferrals and escalations need your decision.
4. The host or designer revises the plan and creates the runnable prototype, with source and rendered evidence.
5. EWAI selects relevant personas afresh for the actual rendered design and prepares the design review.
6. You review the findings and responses. Accepted changes can lead to another recorded cycle within the configured limit.
7. When concerns are resolved—or a trade-off needs your decision—you choose whether to select the prototype, request changes or pause.
8. EWAI records the reviewed plan and final cycle links in `ewai.prototype-manifest/v3`. That evidence doesn't approve production Build or final Manual QA.

Plan and design selection are separate on purpose. A Product Owner may be highly relevant to a journey plan, while an accessibility specialist or visual designer may become more relevant once responsive rendered evidence exists.

## Actively engaged personas

EWAI searches the available catalogue across:

- core personas shipped with EWAI;
- project personas under the configured `SPECS/1.Scope/personas/project` location;
- personal personas installed for the current user;
- premium personas already installed through the configured entitlement provider.

The interface shows each active persona's safe ID, name, tier, category, matched signals and engagement reason. It also shows availability counts for every tier. Premium and personal personas add optional depth; the standard model with core and project personas remains a complete path. Prototype review never downloads or synchronises premium content.

## CLI workflow

The [complete plan and cycle inputs](examples/prototype-review-inputs.md) show all four files, the returned values to carry forward and the evidence required before design review. The host normally prepares these through `ewai-prototype-iteration`; review its findings and assessments rather than inventing hashes or persona IDs.

Prepare a plan input JSON containing the intent digest, effective design-system digest, screens, journeys and selection signals, then run:

```bash
ewai prototype-review plan-prepare customer-portal \
  --input plan-prepare.json \
  --project . \
  --json
```

Use the returned active ensemble to create evidence-cited findings. Keep each finding separate from its assessment, then record the complete result:

```bash
ewai prototype-review plan-record customer-portal \
  --input plan-review.json \
  --project . \
  --json
```

After producing the runnable prototype, provide all seven evidence-channel states and prepare design review:

```bash
ewai prototype-review cycle-prepare customer-portal \
  --input cycle-prepare.json \
  --project . \
  --json

ewai prototype-review cycle-record customer-portal \
  --input cycle-review.json \
  --project . \
  --json
```

Inspect or compare recorded evidence:

```bash
ewai prototype-review status customer-portal --project . --json
ewai prototype-review compare customer-portal sha256:<earlier> sha256:<later> --project . --json
```

Comparison explains variance in causal order: inputs, personas, findings, assessments and output.

## MCP and dashboard

Agent hosts can use:

- `ewai_prototype_review_status`;
- `ewai_prototype_plan_prepare` and `ewai_prototype_plan_record`;
- `ewai_prototype_cycle_prepare` and `ewai_prototype_cycle_record`;
- `ewai_prototype_review_compare`.

Enable **Contributions** in **Configuration** first; see [dashboard configuration](operations/dashboard-configuration.md). When the selected delivery is in UI Design, its contextual prototype review panel shows persona availability, Actively engaged personas, matched signals, engagement reasons, findings, dispositions and the derived next action. The panel accepts the same bounded JSON contracts and does not expose persona bodies or accept a project-root override.

## Findings and dispositions

Each persona finding has a stable identity based on persona, concern code and evidence references. Changing explanatory wording does not silently turn the same concern into a new issue.

Every finding receives exactly one disposition:

- `incorporate`;
- `incorporate-with-modification`;
- `defer`;
- `reject`;
- `escalate`.

Each disposition requires rationale. Modified incorporation also records the modification. Material deferral and escalation require a human decision.

## Evidence channels

Design cycles report `source`, `rendered-viewport`, `interaction`, `assistive-technology`, `user-research`, `manual-qa`, and `release` separately. Source and rendered-viewport evidence are required before persona design review. Missing channels remain explicitly missing. Persona feedback is never presented as user research, Manual QA, accessibility certification or release evidence.

## Iteration bounds and next action

The default design limit is two cycles and the supported range is one to three. EWAI derives one of:

- `iterate` when assessed feedback should be incorporated and capacity remains;
- `ready-for-human-selection` when no assessed concern requires another cycle;
- `human-decision-required` when material uncertainty is escalated, deferred, or remains at the cycle limit.

The limit prevents an unbounded model-to-model design loop. It never converts unresolved feedback into acceptance.

## Prototype manifest v3

New UI deliveries use `ewai.prototype-manifest/v3`. It retains selected-prototype and design-system receipt fields from v2 and adds digest-checked links to the immutable reviewed plan and final design cycle under:

```text
SPECS/6.Build/<delivery>/ui-design-assets/prototype-iterations/
├── plans/
└── cycles/
```

Historical v1 and v2 manifests remain readable. A v3 delivery must link review evidence that belongs to the same delivery, matches the recorded digest, ties the final cycle to the reviewed plan, and references the selected HTML entry point.
