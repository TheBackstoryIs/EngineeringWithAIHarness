# Product Owner guide

Start with the problem you want to solve, who experiences it and what a useful result would look like. You don't need every technical answer. Bring examples, explain what mustn't change, and identify the people who can answer the questions you can't.

For a new project, ask EWAI to guide you through Discovery or open **Guided Setup** in the dashboard. For one new feature in an existing project, use [Intent Studio](guided-intent-workspace-guide.md). For example: “Our operations team spends an hour combining reports before every morning review. We want them to find delayed cases in ten minutes.” That's enough to start investigating; it isn't yet an approved implementation plan.

An Organisation Blueprint is optional. If your organisation supplies one, the sections below explain how to review it. You can use EWAI without one; applicable project standards and human approvals still apply.

## Your first Discovery review

1. Explain the problem, intended users and the result you want. If this is inherited software, choose whether to investigate it through [existing-project onboarding](existing-project-onboarding-guide.md); Archaeology is optional.
2. Work through the Discovery sections with EWAI or your facilitator. Answer what you know, supply sources where possible and name the person who can resolve each unknown.
3. Check the summaries as they're drafted. Correct changed meaning, missing users and assumptions presented as facts. EWAI's persona perspectives can help expose gaps, but they aren't substitutes for your colleagues or users.
4. If your organisation supplies a Blueprint, review its proposed standards and modules. Otherwise, continue without one; the optional Blueprint sections below aren't a prerequisite.
5. At Review, inspect the actual proposed project records, destinations, constraints, unresolved questions and approval consequences. Withhold approval if a material conflict or missing specialist decision remains.
6. If you're the authorised approver, approve the reviewed result in your own name. That makes the agreed Discovery records project knowledge; it doesn't approve implementation.

Afterward, ask EWAI to help shape a feature intent or choose existing work to continue. The [fourteen-stage delivery guide](explanation/delivery-workflow.md) explains the later planning, Build approval, testing and human acceptance decisions. You don't need to learn the internal commands to participate.

## What you own

You are accountable for:

- the problem being addressed and why it matters now;
- the primary users and other people affected;
- the outcomes that would make the work worthwhile;
- the evidence used to support those claims;
- which organisation defaults apply to this project;
- which optional modules are justified;
- which important perspectives must be heard;
- whether the Review consequences are complete and accurate;
- the named approval or the decision to withhold it;
- later changes to approved project truth.

You do not need to become the technical expert for every standard. You do need to know who owns the expertise, where the evidence came from, and what remains uncertain.

## Before starting Discovery

Bring the smallest useful evidence pack:

- a plain-language problem statement;
- intended users and affected groups;
- examples of the current journey or failure;
- desired outcomes and useful measures;
- relevant organisation policies, architecture decisions, and delivery constraints;
- known data, security, accessibility, regulatory, operational, and commercial concerns;
- existing project or product documentation;
- named stakeholders who can validate specialist claims;
- unresolved disagreements rather than a falsely tidy consensus.

If evidence is confidential or restricted, follow the project's context and cloud-processing rules. Do not paste sensitive material into Discovery merely to make the conversation easier.

## Use an evidence hierarchy

Separate the authority to decide from evidence of current behaviour:

- **Requirements and obligations:** applicable policies, contractual or legal obligations, approved constraints and mandatory standards define what the project must satisfy.
- **Intended outcomes:** authorised owner decisions, reviewed project records and real stakeholder or user evidence explain what the work is for.
- **Current behaviour:** code inspection and operational observations show what happens today; they can reveal a gap but don't waive a requirement.
- **Organisation defaults:** a reviewed Blueprint can supply applicable standards and starting points, not approval for an unrelated project or an exception to its obligations.
- **Hypotheses:** persona contributions and general model suggestions identify questions to investigate, not facts to adopt without evidence.

When these conflict, investigate and involve the person with authority for that decision. Don't let a fluent persona answer overwrite real evidence or an observed implementation override a mandatory obligation.

## Decide whether an Organisation Blueprint Pack applies

This section and the module review below are only for projects considering a Blueprint. For ordinary Discovery, continue to [Read the active persona ensemble](#read-the-active-persona-ensemble).

Read [Designing Organisation Blueprint Packs](designing-organisation-blueprint-packs.md) if you need the manifest and trust details. In Guided Setup, ask:

- Is this pack published by the organisation or practice that owns these defaults?
- Is its identity, version, compatibility, and digest clear?
- Does the project genuinely fall within its intended scope?
- Are its dependencies expected and understandable?
- Do the required modules represent unavoidable obligations for this project?
- Which root optional modules address a real need rather than merely sounding useful?
- Do the persona templates represent perspectives the project should own after approval?
- Are the boilerplate references independently reviewed, correctly licensed, and compatible?

No installed pack is self-approving. If the required baseline is wrong for this project, stop and resolve the mismatch rather than selecting it and planning to ignore parts later.

## Review required and optional modules

Required and optional are governance choices, not UI convenience:

- A **required module** applies whenever that pack is resolved. Required dependency modules also apply.
- An **optional module** on the selected root pack applies only when you select it.
- An optional module should correspond to an actual project condition, risk, or outcome.

For each module, be able to say:

- why it applies;
- which standards and personas it introduces;
- which team owns the resulting obligations;
- what evidence will show that the obligations were met;
- what would change if the module were not selected.

## Read the active persona ensemble

Read [Working with personas](working-with-personas.md) for creation and ownership details.

During each Discovery section, the interface shows the personas currently engaged. Check the visible name, tier, matched concerns, and engagement reason.

Use that information to ask:

- Which relevant specialist or user perspective is present?
- Which critical real-world perspective is missing?
- Is a project persona being used where organisation or product context matters?
- Is a premium specialist adding a genuinely distinct challenge?
- Are several personas repeating the same generic concern?
- Does the engagement reason make sense for this section and the answers so far?

The ensemble can change between sections. That is intentional: relevant premium, core, personal, and local project personas are swapped in and out as the Discovery topic changes.

If an important lens is missing, do not pretend the current set is sufficient. Pause to improve or add a project persona, or bring the real stakeholder into the session.

## Assess the impact of a proposed change

For work that changes existing behaviour, use [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md) before accepting the implementation boundary.

Review the observed repository evidence separately from inferred consequences. Confirm whether user journeys, outcomes, public interfaces, acceptance evidence, documentation, or training may change. Inspect the active persona ensemble for useful challenges, but bring representative users and accountable specialists into the routes that require human evidence.

You may override a Product Owner or user-validation recommendation when project evidence justifies it, but the recorded rationale should name the evidence and the unchanged boundary. An impact assessment informs the decision; it does not approve Build or replace later acceptance.

## Design test scenarios with personas

Use [Persona-driven test scenarios](quality/persona-driven-test-scenarios.md) during Test Plan when user, operator, maintainer, accessibility, privacy, security, recovery, or misuse perspectives could expose missing coverage.

Review the active persona names, tiers, matched concerns, and engagement reasons, but accept an expected result only when it cites authoritative project evidence. Keep unsupported proposals as blocked scenarios or hypotheses. Confirm the evidence route and owner, and preserve Manual QA, specialist assurance, and representative-user validation as named human work.

## Keep personas in their proper role

Personas are especially useful for:

- identifying likely blind spots;
- generating questions for real stakeholders;
- exploring unhappy paths and edge cases;
- translating a change into role-specific consequences;
- challenging whether evidence is strong enough;
- improving acceptance criteria and test ideas.

They must not:

- invent evidence and have it recorded as fact;
- approve a policy, risk, release, or product decision;
- impersonate a real stakeholder;
- override authorised research or project-owned truth;
- conceal disagreement behind a single synthesized answer.

In notes and decisions, label persona outputs as hypotheses until evidence or an accountable person confirms them.

## Lead the Discovery conversation

For each section:

1. **State the decision.** Make clear what the project needs to learn or decide now.
2. **Offer evidence.** Separate what is known, inferred, assumed, and disputed.
3. **Inspect active personas.** Invite the lenses that add distinct value and note important absences.
4. **Resolve language.** Use terms the team and users actually use; record contested definitions.
5. **Capture boundaries.** Say what the project will not do, which risks are accepted, and where approval from others is needed.
6. **Confirm ownership.** Name who can validate each material claim.
7. **Review the draft.** Do not wait until final approval to discover that a summary has changed the meaning.

You can delegate facilitation. You cannot delegate accountability for the final product decision without explicitly changing who the approver is.

## Review before approval

The Review step should let you inspect the complete prepared consequence, not merely a summary of answers.

### Project purpose and scope

- Is the problem specific and evidenced?
- Are primary users and affected groups explicit?
- Are desired outcomes measurable enough to guide trade-offs?
- Are exclusions, assumptions, dependencies, and unresolved questions visible?

### Technology and standards

- Are selected technology packs and minimum standards appropriate?
- If a blueprint is selected, are publisher, version, compatibility, dependency order, and digests visible?
- Are required and selected optional modules correct?
- Are the destination paths and counts of standards, personas, and boilerplate receipts plausible?
- Are existing-file conflicts resolved deliberately?

### Persona review

- Do project personas capture local product and organisation knowledge?
- Are blueprint-derived personas acceptable as durable project-owned lenses?
- Are active persona names, tiers, and reasons visible and understandable?
- Is every persona's authority boundary clear?

### Assurance

- Are data, security, privacy, accessibility, availability, authentication, multi-tenancy, payments, AI, and regulatory questions answered honestly?
- Does `unknown` remain where the evidence is genuinely unknown, with an owner to resolve it?
- Are external validation choices proportionate to the risk?

### Approval consequence

- Is the approver's name correct?
- Is the selection digest the one you reviewed?
- Do you understand which SPECS files and configuration entries will be created?
- Is rollback expected if any part of the write fails?

Withhold approval if the Review is incomplete, the installed source changed, a conflict is unresolved, or the responsible expert has not validated a material claim.

## What named approval means

Named approval is an accountable decision to make the prepared Discovery result project truth. For a selected organisation blueprint, EWAI re-resolves the installed source and blocks the transaction if the digest has changed since preview.

Without a Blueprint, approval saves the reviewed project purpose, scope, outcomes, standards, assurance and strategy records shown in Review. It doesn't invent an organisation baseline or require a Blueprint receipt.

If you're adopting a Blueprint, approval also records its project-owned material and provenance:

- project purpose, scope, outcomes, standards, assurance, and strategy artefacts;
- materialised organisation standards and project personas;
- `SPECS/5.Strategy/organisation-blueprint.md` as a human-readable receipt;
- a `blueprints.organisation` pin in the configured `pipeline.yaml`;
- root and dependency IDs, versions, content digests, applied modules, selection digest, approver, approval time, and evidence path.

Boilerplates remain references in the receipt. Approval does not authorize EWAI to fetch or run them.

## After approval

Treat the generated files as maintained product and engineering assets:

1. Commit them with the delivery that caused the decision.
2. Make the receipt easy for the team to find.
3. Assign owners for standards, personas, unknowns, and follow-up evidence.
4. Use the project personas during later intent, review, testing, and retrospective work.
5. Revisit the blueprint when project conditions or organisation policy change.
6. Preserve the historical approval record even when adopting a newer pack.

An installed pack can change independently. The approved project-owned copies and pin explain what the project accepted at that moment.

## Change an approved baseline deliberately

Use this section when changing an adopted Blueprint baseline. It isn't a requirement to install a Blueprint or administer packs for every feature.

Do not silently replace generated standards or personas because a newer pack exists.

For a proposed change:

1. identify the current pin and receipt;
2. compare publisher, versions, digests, modules, and materialised content;
3. explain the product, user, delivery, and assurance consequences;
4. involve the real owners of affected standards and personas;
5. update the project intent or decision evidence;
6. re-run preview and resolve destination conflicts deliberately;
7. obtain a new named approval;
8. retain a reviewable history of what changed and why.

For an urgent correction, record the urgency, temporary decision, owner, expiry or review date, and follow-up work. Urgency does not turn an unreviewed persona suggestion into evidence.

## Product Owner acceptance checklist

### Purpose and people

- [ ] Problem and desired outcomes are clear
- [ ] Primary users and affected groups are named
- [ ] Real evidence, assumptions, and disagreements are distinguishable
- [ ] Material claims have accountable owners

### Blueprint — only when adopting one

Skip this block when you aren't adopting a Blueprint. It isn't a setup failure to work without one.

- [ ] Publisher, ID, version, compatibility, and digest are understood
- [ ] Dependencies are expected and acyclic
- [ ] Every required module is applicable
- [ ] Every selected optional module has a concrete reason
- [ ] Standards, persona templates, and boilerplate receipts have been reviewed
- [ ] Existing destination conflicts are resolved

### Persona acceptance

- [ ] Project-specific lenses exist where needed
- [ ] Active names, tiers, matched concerns, and reasons are visible
- [ ] Important stakeholder perspectives are not missing
- [ ] Persona hypotheses are not recorded as facts or approvals

### Assurance and delivery

- [ ] Unknowns remain explicit and owned
- [ ] Validation choices match the project's risk
- [ ] Exact generated files and configuration changes are visible
- [ ] Drift blocks approval and failure rolls back the transaction

### Decision

- [ ] The named approver is accountable for this decision
- [ ] The reviewed digest is the approved digest
- [ ] The receipt and project-owned outputs will be versioned
- [ ] Later change and review ownership is clear

## A lightweight session format

This is a suggested agenda, not a runtime requirement or a promised duration. Shorten it for a small project; omit Blueprint review when no Blueprint is being adopted.

For a focused Discovery workshop:

| Time | Activity | Output |
| --- | --- | --- |
| 10 minutes | Purpose, decision, evidence, and boundaries | Shared problem frame |
| 15 minutes | Users, stakeholders, and active persona gaps | Perspective map and interview follow-ups |
| Up to 15 minutes, if applicable | Blueprint and optional-module applicability | Proposed baseline with reasons |
| 15 minutes | Assurance and failure scenarios | Owned risks and unknowns |
| 15 minutes | Review exact consequences | Corrections, conflicts, and approval readiness |
| 5 minutes | Decide: approve, revise, or pause | Named decision and next actions |

Do not force approval to fit the meeting. “Revise” and “pause for evidence” are valid outcomes.

## Related guides

- [Designing Organisation Blueprint Packs](designing-organisation-blueprint-packs.md)
- [Working with personas](working-with-personas.md)
- [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md)
- [Persona-driven test scenarios](quality/persona-driven-test-scenarios.md)
- [All EWAI guides](README.md)

## Contract sources

- `src/discovery.mjs` — questionnaire, preview, conflicts, named approval, materialisation, pinning, drift, and rollback
- `src/runtime/guided-discovery.mjs` — drafts, active personas, Review preparation, and approval service boundary
- `src/organisation-blueprints.mjs` — safe blueprint projection, compatibility, dependencies, and selection digest
- `src/personas.mjs` — project-persona ownership and advisory boundary template
- `tests/discovery.test.mjs` and `tests/guided-discovery.test.mjs` — executable Discovery and approval evidence
