# Screen prototype creation guide

This guide explains how EWAI turns an approved UI intent into a runnable screen prototype. It covers planning, design-system application, persona review, screen creation, rendered evidence, iteration and human acceptance.

Ask EWAI: “Help me prototype the screens for this intent so we can review the journey before implementation.” Explain the users, important actions and states you want to examine. The guided delivery uses `ewai-prototype-iteration` for the reviews; you don't have to prepare its JSON inputs yourself.

You'll review the proposed screen plan, open the runnable designs and assess the findings. The host or designer creates the screen files; EWAI prepares the context, review inputs and evidence records. You decide material trade-offs and select a prototype. The sections below explain those stages, with direct commands for engineers who want to inspect or repeat the recorded reviews.

EWAI does not replace the design model or the accountable people involved. The host model creates the screen source; EWAI supplies the governed context, evidence contracts and review gates; named people decide whether the result is suitable. There is deliberately no deterministic `ewai prototype generate` command that claims to design a screen by itself.

Prototype selection happens before implementation. Final Manual QA checks the implemented feature after Delivery; it can't be inferred from a selected HTML design. For complete plan and cycle files, see [prototype-review inputs](examples/prototype-review-inputs.md); use the manifest requirements below when linking those saved reviews.


<!-- editorial: contents -->
## On this page

- [What the process produces](#what-the-process-produces)
- [Responsibility model](#responsibility-model)
- [The creation lifecycle](#the-creation-lifecycle)
- [1. Establish the inputs](#1-establish-the-inputs)
- [2. Apply the design system](#2-apply-the-design-system)
- [3. Create the screen plan](#3-create-the-screen-plan)
- [4. Review the plan with relevant personas](#4-review-the-plan-with-relevant-personas)
- [5. Create runnable screen prototypes](#5-create-runnable-screen-prototypes)
- [6. Render and inspect the result](#6-render-and-inspect-the-result)
- [7. Review the produced design with a new ensemble](#7-review-the-produced-design-with-a-new-ensemble)
- [8. Iterate within a bounded cycle](#8-iterate-within-a-bounded-cycle)
- [9. Select and register the prototype](#9-select-and-register-the-prototype)
- [Working in Contributions](#working-in-contributions)
- [Handoff to production Build](#handoff-to-production-build)
- [Common recovery cases](#common-recovery-cases)
- [Related guides](#related-guides)

## What the process produces

A completed prototype cycle can produce:

- a design-system application receipt;
- a reviewed screen and journey plan;
- one or more runnable HTML prototype variants;
- captured evidence for the source, rendered viewports, interactions and other review channels;
- persona findings with an explicit human or host assessment for every finding;
- a final cycle record and a human-selected entry point;
- an `ewai.prototype-manifest/v3` manifest linking the evidence together.

The selected prototype is still design evidence. It is not production code, Manual QA, security acceptance, accessibility certification or release approval.

## Responsibility model

| Participant | Responsibility |
| --- | --- |
| Product or business owner | Defines the outcome, users, journeys, business rules and acceptable trade-offs. |
| Designer or host model | Creates the plan and runnable screen source using the supplied design context. |
| EWAI runtime | Resolves bounded context, validates artefact shapes, selects relevant available personas, preserves findings and links immutable evidence. |
| Engaged personas | Supply advisory perspectives relevant to the plan or rendered result. They do not approve it. |
| Named human reviewer | Selects the preferred prototype and decides material trade-offs. Final Manual QA is a later check of the implemented feature. |

## The creation lifecycle

```text
Intent and project evidence
        ↓
EWAI applies the selected design system
        ↓
Host or designer creates the screen and journey plan
        ↓
EWAI prepares persona review; you review the findings
        ↓
Findings are assessed; host or designer revises the plan
        ↓
Host or designer creates runnable HTML prototype variants
        ↓
Host or designer renders and exercises the screens
        ↓
EWAI selects personas for the actual rendered design
        ↓
You review findings and trade-offs; bounded iteration follows
        ↓
You select the prototype or request further work
```

Plan review and rendered-design review are independent stages. A persona relevant to the intended journey is not automatically the most relevant persona for visual, responsive, interaction or accessibility evidence.

After prototype selection, the delivery still passes through planning and explicit Build approval before implementation. Final Manual QA checks that implemented result after Delivery, not the prototype alone.

## 1. Establish the inputs

Before creating screens, EWAI prepares relevant context from:

- the active intent, outcomes, constraints and acceptance criteria;
- the Repository Source Map and Archaeology evidence for an existing product;
- the effective design system and its resolved dependencies;
- relevant project standards and Organisation Blueprint guidance;
- known user journeys, actors, permissions and data classifications;
- available core, project, personal and already-installed premium personas.

You can complete prototype work with the standard model plus core and project personas. Already installed premium personas can add specialist perspectives; this workflow doesn't download them automatically.

For an existing product, review the reusable components and current screen behaviour identified by EWAI or your designer before agreeing new patterns. A design-system pack describes intended constraints; the repository remains evidence of what is implemented today.

## 2. Apply the design system

During UI Design, EWAI uses `ewai-design-system-apply` to resolve the selected design system, prepare relevant guidance and record an immutable receipt under:

```text
SPECS/6.Build/<intent-slug>/ui-design-assets/design-system/
├── receipt-<digest>.json
└── summary-<digest>.md
```

The receipt identifies the exact design-system revision used to create the prototype. If the selected pack or one of its dependencies changes, create a new receipt rather than altering the old evidence.

The bundled fallback is a valid, clearly labelled baseline. An organisation-specific design system can add stronger product vocabulary, components and constraints, while relevant installed premium personas can add review depth.

## 3. Create the screen plan

The host or designer turns the intent and applied design context into a screen plan. When reviewing it, check that every screen or material state identifies:

- a stable screen ID, title and purpose;
- the actors and goals served;
- its position in the user journey;
- entry conditions and expected exits;
- information hierarchy and primary action;
- content, data, permissions and policy constraints;
- design-system components and patterns to reuse;
- loading, empty, error, permission and recovery states;
- responsive and keyboard behaviour;
- accessibility considerations;
- meaningful interactions and transitions;
- decisions or assumptions still requiring human input.

A list of page names isn't enough. The plan lets you check whether the proposed experience covers the intended journey before time is spent producing screens.

## 4. Review the plan with relevant personas

EWAI prepares the plan review during the guided workflow. To prepare it directly with the plan content and selection signals:

```bash
ewai prototype-review plan-prepare customer-portal \
  --input plan-prepare.json \
  --project . \
  --json
```

EWAI chooses from the personas that are actually available: core, project-local, personal and already-installed premium personas. The UI and command result show the actively engaged personas, their tier, matched signals and why each one was selected.

The host then reasons through the plan using those perspectives and cites the plan or project evidence for each finding. Review each finding separately from the proposed response. The direct recording command is:

```bash
ewai prototype-review plan-record customer-portal \
  --input plan-review.json \
  --project . \
  --json
```

Every finding needs one decision: `incorporate`, `incorporate-with-modification`, `defer`, `reject` or `escalate`. Record the reason; modified incorporation also needs the proposed modification. Material deferral or escalation needs a human decision. `accept-risk` isn't a prototype-review disposition: use the relevant risk or security workflow if formal risk acceptance is needed. A persona recommendation doesn't change approved project decisions.

The host or designer revises the plan where the agreed responses require changes. Check that the runnable prototype follows the reviewed plan rather than the unreviewed first draft.

## 5. Create runnable screen prototypes

Using the reviewed plan and design-system receipt, the host model creates ordinary HTML, CSS and JavaScript that can be opened and exercised locally. The canonical location is:

```text
SPECS/6.Build/<intent-slug>/ui-design-assets/prototypes/
├── manifest.json
├── selected.html
└── variants/
    ├── journey-a/index.html
    └── journey-b/index.html
```

The selected entry point must be a real `.html` or `.htm` file inside `ui-design-assets/prototypes/`. It cannot be a symlink or resolve outside that folder. This keeps the preview bounded, portable and packageable.

### What a useful prototype should contain

A useful screen prototype should:

- cover the important happy path and the material alternative states from the plan;
- reuse the resolved tokens, components and interaction conventions;
- contain enough representative content to judge information hierarchy;
- make primary and secondary actions behave meaningfully;
- demonstrate responsive behaviour where viewport changes matter;
- expose focus, keyboard and error behaviour that can reasonably be prototyped;
- avoid implying that mocked integrations or placeholder data are live services.

Use fictional or safely anonymised representative data. Never copy secrets, live credentials, personal data or confidential client material into a prototype merely to make it look realistic.

Variants are valuable when a real design choice remains. They should represent a named decision, not cosmetic churn. Once a person selects a direction, preserve the rejected alternatives only where they remain useful evidence.

## 6. Render and inspect the result

Opening the source file isn't enough to establish what a user experiences. The host or designer renders the prototype in a real browser using Playwright or equivalent tooling and records the relevant viewport and interaction evidence. Open the preview yourself to judge the proposed journey; request missing states or checks rather than inferring them from the source.

EWAI keeps seven evidence channels distinct:

1. **Source evidence** — the prototype files and linked design-system receipt.
2. **Rendered viewport evidence** — what was visibly rendered at named viewport sizes.
3. **Interaction evidence** — the journeys, controls and state transitions exercised.
4. **Assistive-technology evidence** — keyboard, semantic and other accessibility observations actually checked.
5. **User-research evidence** — feedback from real or appropriately represented users, when available.
6. **Manual QA evidence** — the named human acceptance result.
7. **Release evidence** — the separate production release decision and result.

Absence in one channel cannot be disguised by evidence in another. A screenshot is not interaction proof; an automated accessibility check is not assistive-technology acceptance; persona feedback is not user research; a browser automation pass is not Manual QA.

## 7. Review the produced design with a new ensemble

Once rendered evidence exists, prepare a design cycle:

```bash
ewai prototype-review cycle-prepare customer-portal \
  --input cycle-prepare.json \
  --project . \
  --json
```

EWAI recomputes the relevant available personas rather than carrying the plan ensemble forward by assumption. This is the important design-review distinction: the actual screens may expose accessibility, content, visual, operational or role-specific concerns that were not prominent in the abstract plan.

The host reviews the rendered evidence through the selected perspectives, records evidence-cited findings, and assesses every finding:

```bash
ewai prototype-review cycle-record customer-portal \
  --input cycle-review.json \
  --project . \
  --json
```

The dashboard’s Contributions shows persona availability, actively engaged personas, findings, dispositions and the derived next action without exposing persona bodies.

## 8. Iterate within a bounded cycle

Use one to three design cycles unless the project’s governed configuration sets a narrower bound. Each cycle should have a reason:

- resolve accepted persona findings;
- test a material variant;
- correct a design-system departure;
- address a rendered, responsive or interaction defect;
- incorporate named human feedback.

The review doesn't keep iterating simply because a model can suggest more changes. At the cycle limit, you review unresolved findings and trade-offs and decide whether to accept the direction, request separately scoped work or pause.

Use comparison when reviewers need to understand why outcomes changed:

```bash
ewai prototype-review compare customer-portal \
  sha256:<earlier-cycle> \
  sha256:<later-cycle> \
  --project . \
  --json
```

The comparison reports variance in causal order: inputs, personas, findings, dispositions and output.

## 9. Select and register the prototype

If you're the named reviewer, select the prototype entry point and record why it meets the intended journey, including any outstanding limitations. Otherwise, obtain that reviewer's decision. EWAI records the selection using `ewai.prototype-manifest/v3`, which links:

- the selected real HTML entry point;
- the immutable design-system application receipt;
- the reviewed prototype plan;
- the final recorded design-review cycle;
- the known state of the separate evidence channels.

The manifest makes the evidence traceable; it does not make the prototype approved. Manual QA, security validation, accepted risk, Build authority, deployment and release retain their existing gates and owners.

## Working in Contributions

Enable **Contributions** in **Configuration** and save before opening it; see [dashboard configuration](operations/dashboard-configuration.md). For UI Design work, it exposes the same review process in a business-facing interface:

1. contribute or review the shared UI Design evidence;
2. inspect the selected design system and application receipt;
3. prepare the plan review and see which personas become active;
4. record findings and dispositions;
5. open the sandboxed prototype preview or its full-size link;
6. prepare the rendered-design cycle and inspect the newly selected ensemble;
7. record the cycle outcome and derived next action;
8. review the result with the named prototype reviewer and record their selection; final Manual QA remains a later gate after implementation and Delivery.

Technical users can perform the same operations through the CLI or MCP tools. The interfaces share the same evidence contracts and do not create a separate approval path.

## Handoff to production Build

When a prototype is selected, carry forward:

- the reviewed journey and screen plan;
- the applicable design-system receipt and exact component decisions;
- accepted and unresolved persona findings;
- responsive, interaction, accessibility and policy constraints;
- Manual QA conditions and named owners;
- explicit notes about simulated behaviour or prototype-only shortcuts.

Production implementation must still satisfy the delivery plan, standards sweep, tests, security evidence and human acceptance gates. Prototype HTML may inform the implementation, but it should not be assumed to have production architecture, data handling, performance or security qualities.

## Common recovery cases

### No personas are shown as active

Check that the plan or cycle was actually prepared. Availability counts describe the catalogue; personas become active only after deterministic selection for the current evidence.

### The design system changed after planning

Reapply it, create a new immutable receipt, and prepare a new review. Do not relabel evidence produced from an earlier digest.

### The browser view differs from the source expectation

Treat the rendered result as new evidence. Correct the prototype, capture the affected viewport and interaction evidence again, then prepare or record the next cycle as appropriate.

### The iteration limit is reached with unresolved concerns

Automated iteration stops. Review the outstanding findings, proposed responses and evidence gaps with the accountable owner before choosing the next step.

### The prototype looks complete but final Manual QA is absent

That is expected before implementation: a selected prototype doesn't complete final Manual QA. After implementation and Delivery, the Manual QA gate remains pending until a named human checks the real feature and approves it. Persona review and automated browser evidence aren't substitutes for that acceptance.

## Related guides

- [Design-system user guide](design-systems/design-system-user-guide.md)
- [Design-system implementation guide](design-systems/design-system-implementation-guide.md)
- [Design-system review guide](design-systems/design-system-review-guide.md)
- [Persona-guided prototype iteration](persona-guided-prototype-iteration.md)
- [Working with personas](working-with-personas.md)
- [Manual QA and acceptance](quality/manual-qa-and-acceptance.md)
