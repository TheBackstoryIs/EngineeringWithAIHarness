# Governance team guide

Use this guide to govern EWAI-enabled work through explicit policy, evidence, exceptions, and human accountability without becoming the delivery bottleneck for every project.

## Govern decisions, not AI activity volume

Focus on:

- what outcomes and risks the organisation is accepting;
- which data and systems AI may access;
- how reusable standards and personas are owned;
- which delivery evidence is mandatory at each risk level;
- who can approve Build, exceptions, Manual QA, and production release;
- how incidents, changes, and learning alter the baseline.

Token counts, prompt counts, or the number of generated artefacts are weak governance measures on their own.

## Define a minimum control model

At minimum, specify:

| Control | Governance question |
| --- | --- |
| Purpose and ownership | Is a named person accountable for the outcome? |
| Data boundary | Which classifications and sources may each AI host process? |
| Project truth | Are approved decisions and evidence retained under canonical SPECS? |
| Reusable content | Who owns Blueprints, standards, and organisation personas? |
| Validation | Which deterministic, independent, and human checks apply? |
| Exceptions | Who may approve, what controls compensate, and when does it expire? |
| Acceptance | Who performs Manual QA and what evidence is required? |
| Operations | How are changes observed, recovered, and supported? |
| Learning | How do incidents and retrospectives update the control model? |

## Use risk tiers proportionately

Recommended practice is to scale evidence according to data sensitivity, external exposure, decision impact, reversibility, operational criticality, novelty, and regulatory context.

For each tier, define:

- mandatory standards and Blueprint modules;
- required human roles;
- independent-review expectations;
- security, privacy, accessibility, and resilience evidence;
- Manual QA depth;
- release and rollback authority;
- retention and audit periods.

Avoid treating one heavy process as appropriate for both a small reversible internal tool and a sensitive public service.

## Review the evidence chain

For a delivery, trace:

```text
human purpose and evidence
→ approved intent and constraints
→ implementation and test plan
→ explicit Build approval
→ task evidence and standards sweep
→ configured independent review
→ Delivery and Manual QA evidence
→ acceptance, operation, and learning
```

Every arrow should have a durable record or an explicit not-applicable/not-supported reason.

## Distinguish validation types

- **Deterministic checks:** schemas, tests, static analysis, hashes, and gate contracts.
- **Independent review:** a configured provider or reviewer other than the producing orchestrator.
- **Human judgement:** applicability, trade-offs, exceptions, user acceptance, and production readiness.

One cannot silently substitute for another. In particular, unavailable independent validation is not a pass, and a persona is not an approver.

## Govern Blueprints and personas

For shared Blueprints, require publisher ownership, versioning, compatibility, immutable releases, provenance, release notes, and deprecation. Projects must review before adoption; upstream changes must not overwrite local truth automatically.

For personas, require ownership, evidence grounding, visible provenance, advisory boundaries, review triggers, and safe retirement. Managed premium definitions remain within their entitled library and must not be copied into public governance packs.

## Review exceptions

An exception record should identify:

- rule and exact scope;
- reason and alternatives considered;
- risk and affected people;
- compensating controls;
- approver and owner;
- start, expiry, and review dates;
- closure evidence.

Look for recurring exceptions. They may indicate an unrealistic standard, missing platform capability, inadequate training, or a genuine risk concentration.

## Audit without relying on the dashboard alone

The dashboard is a rebuildable projection. Audit durable records:

- intent Markdown and adjacent structured state;
- delivery-state and hashed gate ledgers;
- approvals and evidence paths;
- task reports and command evidence;
- standards and external validation reports;
- Blueprint receipts and pins;
- Manual QA evidence;
- retrospectives, risks, incidents, and exceptions.

Use the operational projection to navigate, then verify the canonical files.

## Useful governance measures

- material decisions with identified evidence and owner;
- unresolved high-risk questions at Build approval;
- exception volume, age, and recurrence;
- validation unavailability by risk tier;
- failures found in automated review, Manual QA, and production;
- time to detect and recover from incidents;
- Blueprint and persona review currency;
- learning adopted into standards or operating practice.

## Governance review checklist

- [ ] Outcome, users, and accountable owner are clear.
- [ ] Data and AI-processing boundaries are explicit.
- [ ] Applicable standards and risk tier are recorded.
- [ ] Personas are visible, attributable, and advisory.
- [ ] Build scope has named approval.
- [ ] Tests, standards, independent review, and human QA are distinct.
- [ ] Exceptions and unavailable checks are visible.
- [ ] Operational ownership and recovery are adequate.
- [ ] Durable evidence supports the dashboard view.
- [ ] Learning has an owner and destination.

## Related guides

- [Human approval and assurance](../human-approval-and-assurance-guide.md)
- [Organisation rollout](../organisation-rollout-guide.md)
- [Project standards authoring](../standards/project-standards-authoring.md)
- [Persona governance](../personas/persona-governance.md)
