---
name: ewai-architecture
description: Facilitate an evidence-led enterprise or solution architecture walkthrough and turn reviewed choices into project-local SPECS standards, patterns, ADRs, risks, options, diagrams, and architecture records. Use for a whole enterprise or solution, a bounded aspect, capability, or domain, one or more intents, or a cross-cutting concern such as data, integration, security, resilience, observability, identity, or deployment—especially when current state, target state, trade-offs, or technical direction need accountable human decisions before delivery.
---

# EWAI Architecture

Shape architecture as a human-owned body of project knowledge, not as a one-off AI diagram. Separate what is **observed**, what is **proposed**, and what has been explicitly **accepted**. Architecture work changes no application code and never begins Build.

Resolve the workspace and `specsRoot` from `.ewai-pipeline/project.json`. Read [the architecture contract](references/architecture-contract.md) completely before producing, reviewing, or filing records.

## Establish the boundary

Ask one question at a time. First establish:

- whether the boundary is the whole enterprise or solution, a bounded aspect, capability, or domain, one or more intents, or a cross-cutting concern;
- whether the user needs current-state understanding, a target state, a current-to-target transition, or a specific decision;
- the business outcome, decision horizon, accountable owner, material constraints, and what is deliberately out of scope.

For an existing system, read accepted SPECS, reviewed Archaeology or Context Import evidence, relevant code and tests, diagrams, configuration, runtime evidence, and Git history before asking the owner to repeat known facts. For a new system without confirmed purpose, hand off to `$ewai-project-discovery` first. A technology-stack choice is an architecture input, not a substitute for the architecture walkthrough.

## Route useful personas

Run `ewai persona index --project <path> --json` and query for enterprise and solution architecture, business capability, domain and data, integration, security, operations, resilience, and governance perspectives.

- Prefer the installed premium `enterprise-architect` persona when access and installation make it available.
- Select only the additional installed personas that materially improve the bounded review.
- Explain the proposed ensemble and perspective gaps before using it.
- Ask before synchronising or updating a premium library.
- Never recreate, paraphrase, or simulate an unlicensed premium persona.
- Treat personas as advisory lenses. Repository evidence and accountable humans outrank persona opinion.

Record the selection and rationale in `persona-routing.yaml` inside the review bundle.

## Build an evidence-led view

Create a bundle at:

```text
SPECS/3.Evidence/architecture/<YYYY-MM-DD>-<scope-slug>/
├── scope.yaml
├── evidence-ledger.yaml
├── viewpoint-matrix.yaml
├── persona-routing.yaml
├── current-state.md
├── target-state.md
├── transition-and-gaps.md
├── open-questions.md
├── review-ledger.yaml
└── proposals/SPECS/
```

Tailor the work to the boundary, but explicitly assess the applicability of every contract viewpoint: business and capability, domain and information, application and service, integration, technology and deployment, security and trust, operations and resilience, and governance and evolution.

For every material claim, record its source, classification, confidence, contradiction, and owner. Code can prove current implementation but not intended business policy. Do not describe an option as historically considered unless evidence or attributed testimony says it was.

## Develop the architecture conversationally

Explain discoveries in human language. Ask one focused question at a time, preferably one that resolves several linked records without conflating different decisions. Use the walkthrough to surface:

- capabilities, boundaries, ownership, dependencies, and quality attributes;
- domain concepts, information ownership, lifecycle, residency, and classification;
- application responsibilities, service contracts, coupling, reuse, and buy/build choices;
- integrations, protocols, trust boundaries, failure handling, and reconciliation;
- technology, environments, deployment topology, scalability, portability, and lifecycle;
- identity, authorization, privacy, threat assumptions, audit, and assurance;
- availability, recovery, observability, support, change, incident, and capacity practices;
- governance, principles, exceptions, roadmaps, deprecation, and decision review triggers.

Record alternatives and trade-offs before recommending a direction. A recommendation remains proposed until an accountable person accepts it.

## Produce individual SPECS proposals

Mirror proposed destinations under `proposals/SPECS/`. Produce one individual record for each discernible ADR, option, standard, pattern, anti-pattern, risk, integration, architecture view, transition, runbook, or governance rule. Indexes and summaries help navigation but never replace the detailed records.

Use the project’s SPECS form inside each record: Scope, Purpose, Evidence, Constraints, and Strategy. Give every diagram a text source such as Mermaid or PlantUML plus an accessible narrative; a rendered image alone is not durable architecture knowledge.

Candidate binding rules stay proposed. Only reviewed architecture constraints and standards belong under `SPECS/4.Constraints/`; accepted architectural direction, views, patterns, options, decisions, and roadmaps belong under `SPECS/5.Strategy/architecture/` or the project’s existing more-specific Strategy folders.

## Review and promote deliberately

Offer either self-review/manual filing or an AI-guided walkthrough. For the guided route, present small coherent groups and let the user accept, correct, reject, or defer each proposal. Do not infer approval from silence, agreement with a summary, or acceptance of a related record.

Before promotion:

1. validate the proposal bundle against the architecture contract;
2. show every canonical destination and conflict;
3. require explicit approval for the records being filed;
4. refuse to overwrite differing canonical knowledge without a resolved correction or supersession decision;
5. copy only accepted records out of `proposals/SPECS/`;
6. record destination, provenance, decision, owner, and timestamp in `review-ledger.yaml`;
7. update applicable standards, decision, pattern, risk, and architecture indexes.

When accepted architecture reveals delivery work, offer `$ewai-shape-intents` or `$ewai-intent`. Obtain separate approval before creating intents, and do not start their delivery automatically.

## Coordinate with the EWAI lifecycle

- **Discovery:** use this skill after purpose and material stack choices are understood, or to resolve them when they require a deeper architecture decision.
- **Archaeology:** consume reviewed reconstructed current-state evidence; use this skill for accountable target-state and transition decisions rather than relabelling inference as accepted design.
- **Delivery:** when an intent exposes an unresolved consequential architectural choice, pause the relevant Think phase, run this bounded walkthrough, file accepted records, then resume `$ewai-deliver` at the same phase.
- **Standards Check:** use `$ewai-standards-check` later to validate implementation against accepted standards, patterns, ADRs, and constraints.
- **Retro:** route accepted learning back into the architecture records and their review triggers.

## Completion boundary

The walkthrough is complete when the agreed boundary and viewpoints have evidence-backed current state, explicit target decisions or owned unknowns, individually reviewable proposals, a recorded human disposition, and a visible transition path where applicable.

Do not write implementation code, silently make an architecture decision, or mark a delivery gate passed. Never begin Build.
