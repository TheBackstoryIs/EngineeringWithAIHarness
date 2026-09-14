# Persona authoring cookbook

Use this guide to write a persona that improves questions and decisions without impersonating a stakeholder or becoming hidden policy.

Read [Working with personas](../working-with-personas.md) first for source tiers, paths, commands, premium sync, and contextual selection.

## Start with one distinct job

A useful persona examines a distinct set of problems and explains their consequences for a recognisable role or outcome.

Good missions:

- help a service operator assess observability and safe recovery;
- test a finance workflow for reconciliation and audit evidence;
- challenge an API design against the organisation's authentication and compatibility approach;
- examine a journey from an assistive-technology user's perspective, grounded in real research.

Weak missions:

- “make everything better”;
- “be an expert in all fields”;
- “approve secure code”;
- “represent all users”.

If two perspectives have different evidence, concerns, or authority boundaries, create two focused personas.

## Choose the correct scope

```bash
# Reusable lens owned by one practitioner
ewai persona create service-designer \
  --name "Service Designer" \
  --category product

# Perspective owned and versioned by one project
ewai persona create payments-operator \
  --scope project \
  --project . \
  --name "Payments Operator" \
  --category operations
```

Do not recreate managed premium content. Add a project persona only when the project has a genuine local perspective or evidence-backed refinement.

The create command produces a Markdown starting file, not a finished expert. Open the returned path and write the mission, decision methods, questions and boundaries using the structure below. Keep existing frameworks, decision trees and attribution when refining an established persona.

Then follow [Test the persona](#test-the-persona): check it appears, use it against a real but safe decision, and review whether its advice is specific and useful. Listing successfully proves discoverability, not the quality of its judgement.

## Make the persona easy to find

```markdown
---
schema: ewai.persona/v1
id: project.payments-operator
name: Payments Operator
version: 0.1.0
description: Examines payment changes for reconciliation, exception handling, observability, and recoverable operations.
category: operations
pack: ewai.personas.project
tier: project
tags:
  - payments
  - reconciliation
  - incidents
capabilities:
  - operational-readiness
  - exception-design
  - recovery-review
---
```

Metadata drives discovery and selection:

- **ID:** stable machine identity; do not encode a person's name.
- **Name:** short human label shown in the interface.
- **Version:** change deliberately when the perspective changes.
- **Description:** the decisions, outcomes, and risks this persona examines.
- **Category:** one useful domain grouping.
- **Tags:** plain-language concepts likely to match Discovery sections or answers.
- **Capabilities:** concrete review or reasoning activities.

Avoid keyword stuffing. Relevance comes before tier, and a persona that matches everything makes the ensemble less meaningful.

## Use a dependable body structure

The sections below are a starting point, not a limit. Keep any useful decision trees, named methods, worked examples, checks and response templates the role needs. Match the depth and response format to the request; don't force a full report when a short answer is enough.

### Mission

State the outcome the perspective is trying to protect. Keep it to one or two paragraphs.

### Operating stance

Explain how the persona reasons and what evidence it prefers. For example:

- trace payment totals to an accountable ledger;
- distinguish transient processing from durable settlement;
- prefer observable, repeatable recovery over manual heroics.

### Questions to keep asking

Write questions that change the quality of the work:

- How will an operator detect a partial failure?
- Can reconciliation distinguish duplicate, delayed, and missing events?
- Who may retry this action, and is it idempotent?
- What evidence proves recovery completed safely?

Avoid generic questions such as “Is this good?” or instructions to always choose one technology.

### Boundaries

Every persona should say:

- it advises rather than approves;
- real stakeholder evidence takes priority;
- assumptions and missing evidence must be explicit;
- mandatory policy remains in project standards, not persona opinion.

Add any domain-specific boundary, such as requiring a real privacy or legal reviewer for regulated interpretation.

## Ground project personas in evidence

When a project persona represents users or organisational roles, link its development to interviews, observation, approved process documentation, or accountable subject-matter review. Do not embed confidential transcripts in the persona.

Separate:

- **observed needs and constraints** supported by evidence;
- **working hypotheses** awaiting validation;
- **design prompts** used to challenge the team;
- **authority** retained by real people.

## Test the persona

1. Confirm it parses and appears:

   ```bash
   ewai persona list --project . --query payments
   ```

2. Run representative Discovery sections.
3. Confirm its name, tier, matched concerns, and engagement reason make sense.
4. Check that it is absent from unrelated sections.
5. Compare its questions with the real stakeholder's view.
6. Narrow metadata or split the persona if it dominates too many contexts.

Guided Discovery selects up to four relevant personas and deliberately tries to include a matching project and premium lens. Test the ensemble, not only the persona in isolation.

## Common authoring mistakes

| Mistake | Better approach |
| --- | --- |
| Persona contains mandatory rules | Put enforceable obligations in project standards; let the persona ask how they apply. |
| Persona pretends to be a named colleague | Describe a role or evidence-backed user group without imitating an individual. |
| Every tag is included | Use a small discriminating vocabulary. |
| Technology choice is hard-coded without context | State the organisation's decision criteria and link to the governing standard. |
| Persona gives approval | Preserve named human approval outside the persona. |
| Premium persona is copied and edited | Create a separately owned project persona and explain the local difference. |
| Persona never retires | Give it an owner, review trigger, and version history. |

## Author checklist

- [ ] One distinct outcome and perspective.
- [ ] Correct personal or project ownership.
- [ ] Stable valid metadata.
- [ ] Specific, restrained tags and capabilities.
- [ ] Evidence expectations and useful questions.
- [ ] Clear advisory and stakeholder boundaries.
- [ ] Tested in relevant and irrelevant Discovery contexts.
- [ ] Reviewed by the real role or subject-matter owner where possible.

## Related guides

- [Persona governance](persona-governance.md)
- [Organisation-specific personas](organisation-specific-personas.md)
- [Persona engagement UI](persona-engagement-ui.md)
