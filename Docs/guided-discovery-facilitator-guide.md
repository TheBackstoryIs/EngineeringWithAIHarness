# Guided Discovery facilitator guide

Use this guide to lead an EWAI Discovery conversation without allowing the framework—or an active persona—to become the decision-maker.

This guide is for a human facilitating a discussion with a Product Owner and other stakeholders. If you're working alone, use the [first-session tutorial](tutorials/first-session.md) instead. EWAI prepares prompts, selects relevant installed personas and drafts summaries; you make space for real participants, test the evidence and help the authorised owner review the result.

## Your outcome

At the end of Discovery, the group should be able to explain:

- why the project exists and what measurable outcome matters;
- who experiences the problem and who has decision authority;
- what is in scope, out of scope, constrained, assumed, or still unknown;
- which organisational standards and technology directions apply;
- what evidence supports each material statement;
- exactly what will become project truth if the owner approves.

The facilitator owns the quality of the conversation. The Product Owner owns the outcome and approval.

## Current behaviour and recommended practice

EWAI currently provides a guided, section-based Discovery flow, contextual persona selection, a Review stage, and named approval. The facilitation techniques in this guide are recommended practice: the CLI cannot guarantee that the right stakeholders attended or that the evidence is sufficient.

## Prepare before the session

Ask the Product Owner for:

1. a one-paragraph purpose statement;
2. the primary users and affected stakeholders;
3. desired outcomes and known measures;
4. firm boundaries and known constraints;
5. existing evidence, including decisions already made;
6. unresolved questions and disagreements;
7. any candidate Organisation Blueprint Pack;
8. the name of the person who may approve the result.

Don't infer the project's purpose from its current implementation. If inherited code is involved, first offer the owner [existing-project onboarding](existing-project-onboarding-guide.md). Archaeology is optional: if they decline, record the limits of what you've inspected and continue with the owner's Discovery answers.

## Establish the evidence hierarchy

First distinguish **what the system does** from **what it should do**. Source code and an observed run support claims about current behaviour. The accountable owner and applicable obligations determine intended rules. Neither automatically overrides the other: a working implementation can violate a requirement, and an owner's recollection can be out of date. Record the conflict, source and decision owner before resolving it.

Don't rank all sources in a single order. They answer different questions:

| Question | Sources to examine |
| --- | --- |
| What is required? | Applicable legal obligations, mandatory standards, approved constraints and requirements. An owner decision can't waive an obligation outside that person's authority. |
| What is intended? | Accountable human decisions, approved records and direct stakeholder or user evidence. |
| What happens today? | Source inspection, observed system behaviour and operational evidence. Current behaviour can expose non-compliance; it doesn't override a requirement. |
| What remains uncertain? | Inference, persona suggestions and model-generated hypotheses, clearly labelled for investigation. |

When these disagree, record the conflict and the person authorised to resolve it. Don't silently replace a requirement with observed behaviour or a plausible suggestion.

A persona can reveal that evidence is missing. It cannot fill the gap by pretending to be the user.

## Work with the active persona ensemble

EWAI selects a small contextual ensemble from the installed project, premium, personal, and core libraries. Selection is based on the current section and the answers already provided.

For every active persona, EWAI shows:

- its name;
- its source tier;
- the concerns that matched;
- why it is engaged now.

At each section transition, check the perspectives EWAI has selected with the group. Explain why their concerns matter to the discussion, and ask EWAI to reconsider the focus if an important perspective is missing. EWAI updates the selection as the subject changes; you don't need to rotate personas manually. Record any remaining gap instead of treating an imagined persona response as stakeholder testimony.

See [Persona engagement UI](personas/persona-engagement-ui.md) for the presentation contract and [Working with personas](working-with-personas.md) for source tiers.

## Facilitate one section at a time

For each topic, use the same loop:

1. **Ask:** invite the accountable person to describe the intended truth.
2. **Evidence:** ask how they know, where the source is, and how current it is.
3. **Challenge:** use relevant personas to surface omissions, risks, and alternate experiences.
4. **Classify:** mark statements as observed, proposed, agreed, decided, inferred, contradicted, or unknown.
5. **Reflect:** read back the proposed project statement in plain language.
6. **Confirm:** establish whether the section is ready for Review or needs follow-up.

Do not rush ambiguity into a clean-looking answer. “Unknown, owner and due date recorded” is safer than invented certainty.

## Resolve disagreement

When two sources conflict, record:

| Field | Question |
| --- | --- |
| Statements | What does each source actually say? |
| Authority | Who owns the decision? |
| Evidence | What direct evidence supports each position? |
| Consequence | What changes if either position is adopted? |
| Resolution | Was one accepted, were both bounded, or is the issue still open? |
| Follow-up | Who will resolve it, and by when? |

Personas may test the consequences, but a named person resolves the decision.

## Review an Organisation Blueprint

If a Blueprint is proposed, pause to review:

- publisher, identity, version, compatibility, and digest;
- required modules that cannot be deselected;
- optional modules selected for this project;
- standards and project persona templates that will be materialised;
- dependency packs and any collisions;
- reference-only boilerplate entries;
- exact destination paths and the durable project pin.

Use the [Product Owner guide](product-owner-guide.md) and [Blueprint design guide](designing-organisation-blueprint-packs.md) for the full approval contract.

## Run the final Review

The Review should show the complete proposed project truth, not a celebratory summary. Ask:

- Does this state the intended outcomes rather than merely describe a solution?
- Are users and stakeholders represented by evidence?
- Are assumptions, unknowns, and exclusions visible?
- Are standards proportionate to the risk?
- Are generated persona perspectives clearly advisory?
- Are all file consequences and Blueprint provenance visible?
- Is the named approver authorised to make this decision?

Approval is not a facilitation shortcut. If the answers are incomplete, return to the relevant section.

## Suggested session record

Capture:

- participants and decision roles;
- evidence reviewed;
- active personas by section and why they were engaged;
- decisions and their owners;
- unresolved questions, owners, and dates;
- Blueprint modules accepted or declined;
- the final Review outcome and named approval.

## Stop and escalate when

- the accountable owner is absent;
- regulated, security-sensitive, or personal data is being discussed without the right expertise;
- a persona response is being treated as user research;
- a Blueprint conflicts with project evidence;
- participants cannot distinguish a proposal from a decision;
- approval consequences cannot be shown exactly.

## Facilitator checklist

- [ ] Purpose, users, outcomes, boundaries, and evidence were supplied by people.
- [ ] Active personas and engagement reasons were visible.
- [ ] Personas were swapped as the subject changed.
- [ ] Conflicts and unknowns were retained rather than smoothed away.
- [ ] Blueprint consequences were inspected in full.
- [ ] The Review reflected the actual proposed project files.
- [ ] Approval was given by a named authorised person.

## Related guides

- [Product Owner guide](product-owner-guide.md)
- [Working with personas](working-with-personas.md)
- [Human approval and assurance](human-approval-and-assurance-guide.md)
- [Non-technical team guide](adoption/non-technical-team-guide.md)

## Current contract sources

- `src/discovery.mjs`
- `src/runtime/guided-discovery.mjs`
- `src/personas.mjs`
- `src/organisation-blueprints.mjs`
- `tests/discovery.test.mjs`
- `tests/guided-discovery.test.mjs`
