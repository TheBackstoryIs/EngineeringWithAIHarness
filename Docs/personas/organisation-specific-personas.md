# Creating organisation-specific personas

Use this guide to encode a reusable organisational perspective without turning a persona into an unreviewed policy engine.

## Decide whether this should be a persona

Use a persona for context-sensitive judgement, questions, and trade-offs. Use a standard for a mandatory obligation.

| Need | Best home |
| --- | --- |
| “All public APIs must use the approved authentication pattern.” | Organisation or project standard |
| “Ask how this design uses our authentication, versioning, and error conventions.” | Organisation API persona |
| “This project uses a temporary exception until migration completes.” | Project constraint or decision |
| “Challenge whether the exception creates consumer or operational risk.” | Project persona |

Often the best design is a standard plus a persona that tests how the standard applies in context.

## Choose the distribution scope

- **Project persona:** use when knowledge is specific to one product, client, team, or evidence set.
- **Blueprint persona template:** use when a reviewed perspective should be proposed consistently to several projects and become project-owned after approval.
- **Personal persona:** use for an individual's reusable working lens, not organisational authority.
- **Premium persona:** use the managed entitled library; do not copy it into an organisation pack.

## Gather source material

Work with the accountable organisational experts and collect:

- approved standards and decision records;
- recurring design and review questions;
- examples of accepted and rejected approaches;
- operating constraints and failure experience;
- escalation and exception routes;
- vocabulary used across teams;
- known boundaries where another specialist must decide.

Do not encode one person's informal preference as organisation policy.

## Model the perspective

An organisation API designer, for example, might:

- protect consumer compatibility and predictable change;
- ask how authentication, error envelopes, pagination, and idempotency follow organisation standards;
- request evidence from contract tests and consumer journeys;
- identify where a deliberate exception needs governance review;
- avoid selecting technologies outside the approved decision process;
- remain advisory.

Use the [persona authoring cookbook](persona-authoring-cookbook.md) for metadata and body structure.

## Package through a Blueprint

A Blueprint persona template should use the complete project-persona Markdown shape. The Blueprint manifest references it through a bounded relative path. During Guided Setup:

1. the template is previewed with its source pack and module;
2. the Product Owner reviews its consequences;
3. named approval materialises it under the configured project-persona directory;
4. provenance records pack ID, version, digest, approver, and time;
5. the materialised persona participates with `tier: project`.

The organisation supplies a reviewed starting point. The approving project owns the resulting persona.

## Design for contextual engagement

Choose metadata that matches the decisions where the lens is useful:

- architecture personas should use architecture, integration, API, data, resilience, or security signals as appropriate;
- operational personas should use deployment, observability, incidents, support, recovery, or continuity;
- governance personas should use controls, audit, risk, compliance, privacy, or assurance;
- product personas should use outcomes, journeys, accessibility, adoption, research, or value.

Do not add all organisation vocabulary to every persona. The resolver should be able to swap specialists in and out as the subject changes.

## Review and pilot

Before publishing:

1. validate the persona Markdown and Blueprint manifest;
2. run relevant and irrelevant Discovery sections;
3. inspect name, tier, matched concerns, and engagement reason;
4. compare questions with real subject-matter experts;
5. confirm mandatory rules remain in standards;
6. pilot with more than one project;
7. remove confidential examples and project-specific facts;
8. assign maintenance and deprecation ownership.

## Example review questions

- Does this persona express one coherent organisational perspective?
- Which approved sources support it?
- Would a project know when its advice is optional or mandatory?
- Are exceptions routed to a named human process?
- Does it duplicate a core or premium persona without adding local value?
- Does it match only relevant Discovery contexts?
- Can the project safely own and improve the materialised version?

## Related guides

- [Designing Organisation Blueprint Packs](../designing-organisation-blueprint-packs.md)
- [Persona governance](persona-governance.md)
- [Internal Blueprint catalogue](../blueprints/internal-blueprint-catalogue.md)
- [Project standards authoring](../standards/project-standards-authoring.md)
