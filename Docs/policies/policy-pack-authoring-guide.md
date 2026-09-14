# Policy Pack Authoring Guide

Use this guide to add a reusable policy contribution to an Organisation Blueprint Pack.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Start from accountable policy, not a prompt

Name the policy owner and record whether the source is owner-declared, regulatory, contractual, or adapted. List bounded source labels that an owner can recognise. If the source is ambiguous, resolve it before encoding rules.

The policy is data-only. Never add scripts, commands, prompts, templates, expressions, executables, remote references, URLs, endpoints, credentials, handlers, or hooks.

## Closed vocabulary and data-only policy content

Rules can match only these dimensions: `resource`, `operation`, `data_entity`, `data_classification`, `actor`, `environment`, `destination`, `model`, `ai_use`, and `retention`.

Use bounded lower-case identifiers for values. Outcomes are `allow`, `deny`, `review-required`, `allow-with-controls`, and `unassessed`. Choose an explicit unmatched outcome; never let “nothing matched” become a hidden allow.

## Minimal example

```yaml
schema: ewai.organisation-policy/v1
id: design-assurance
title: Design assurance
version: 1.0.0
publisher:
  id: example
  name: Example Organisation
provenance:
  kind: owner-declared
  summary: Rules approved by the Example governance group.
  sources:
    - id: ai-policy
      label: AI Policy, approved 2026-08-01
review_roles:
  - id: security-owner
    name: Security Owner
unmatched_outcome: unassessed
rules:
  - id: sensitive-external-ai
    title: Sensitive data sent to external AI
    description: A security decision is required for this design.
    when:
      data_classification: [sensitive]
      destination: [external-ai]
    outcome: review-required
    review_role: security-owner
    controls:
      - id: data-flow-review
        title: Review the data flow
        description: Record the proposed flow and specialist decision.
        evidence: [claim, specialist-review]
    exceptions:
      permitted: false
```

## Add it to a Blueprint

Save the complete policy above as `example-blueprint/policies/design-assurance.yaml`. Create `example-blueprint/pack.yaml` beside the `policies` folder:

<!-- example: policy-blueprint -->
```yaml
schema: ewai.pack/v1
id: org.example.engineering
name: Example Engineering
description: A fictional policy-only Blueprint for the authoring exercise.
version: 1.0.0
type: organisation
requires: []
blueprint:
  publisher:
    id: example
    name: Example Organisation
  compatibility:
    ewai: 0.x
  modules:
    - id: design-assurance
      name: Design assurance
      description: Review sensitive external AI data flows.
      required: true
      standards: []
      personas: []
      policies:
        - id: design-assurance
          title: Design assurance
          source: policies/design-assurance.yaml
      starter_packs: []
```

The module's policy ID matches the document's `id`; the publisher matches too. The source path is relative to `pack.yaml`, not the working directory. Follow the [Blueprint installation and discovery route](../designing-organisation-blueprint-packs.md) to make this pack available before selecting it. A required module always contributes its policy; an optional module contributes only when selected. Policy ID and publisher must agree with the module and pack metadata.

Use Guided Setup to resolve the full Blueprint. Review the policy count, rule count, outcomes, roles, contribution provenance, pack pins, and effective digest. A named approver then accepts the project-local baseline. Changing the pack later marks that baseline stale; it does not rewrite project evidence.

## Authoring review

Before publishing a pack, verify:

- every source and review role is named;
- every rule uses the closed vocabulary;
- every control names a real evidence route;
- review-required rules name a valid role;
- allow-with-controls rules define at least one control;
- permitted exceptions name a role, while prohibited exceptions do not;
- the unmatched outcome is intentionally restrictive;
- no production connector or executable instruction is present;
- example designs produce the intended precedence when several rules match.

See [Designing Organisation Blueprint Packs](../designing-organisation-blueprint-packs.md) for the wider pack structure.
