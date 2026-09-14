# Maximum-detail SPECS reconstruction

Read this completely before producing Archaeology proposals. Its purpose is to prevent a broad analysis from being mistaken for a recreated project knowledge base.

## Required outcome

Recreate the maximum amount of detailed SPECS knowledge reasonably discernible from the available evidence. Produce the records EWAI would have accumulated while the project was discovered, designed, built, tested, delivered, operated, corrected, and improved.

The output is not an executive summary, assessment, representative sample, awareness pack, or fixed quota. The target is every individually discernible record. More evidence should normally produce more records.

## Enumerate capabilities first

Create `capability-catalog.yaml` with schema `ewai.archaeology-capability-catalog/v1` before reconstructing records. Discover capabilities from:

- user-visible routes, screens, navigation, commands, and APIs;
- controllers, services, use cases, jobs, events, listeners, notifications, and workflows;
- models, state machines, schemas, migrations, relationships, and lifecycle transitions;
- administrative, operational, support, reporting, billing, security, and recovery functions;
- integrations, providers, webhooks, protocols, imports, exports, scheduled work, and reconciliation;
- tests, fixtures, feature flags, hidden routes, deleted documentation, branches, incidents, and historical commits.

Do not merge capabilities merely because they share a controller, screen, service, or domain. Preserve different user outcomes, workflows, rules, risks, and decision histories.

Each capability entry requires an identifier, substantive description, actors, entry points, dependencies, evidence references, first and latest observed dates where available, and current state.

## Build the target inventory

Create `archaeology-artifact-manifest.yaml` with:

```yaml
schema: ewai.archaeology-artifact-manifest/v1
depth: maximum-discoverable-detail
records:
  - id: ART-0001
    subject: alert-delivery
    family: purpose.workflows
    record_type: workflow
    title: Multi-channel alert dispatch
    status: created
    proposed_path: proposals/SPECS/2.Purpose/journeys/alert-delivery/multi-channel-dispatch.md
    evidence: [ARC-001, ARC-014]
    review_owner: Product owner
```

Use `subject: project` for cross-cutting records. Use a capability identifier for capability-local records.

The packaged `config/archaeology-record-families.yaml` and `ewai archaeology validate` command define the minimum families to account for. They are a floor, not a ceiling. Add multiple manifest rows whenever the evidence reveals multiple personas, intents, workflows, journeys, risks, requirements, constraints, patterns, ADRs, options, integrations, runbooks, incidents, or build histories in the same family.

## Preserve record granularity

Create an individual proposed file for each discernible record:

- one project persona per materially different actor perspective;
- one intent per independently valuable outcome or capability;
- one workflow or journey per distinct route through the system, including exception and recovery paths;
- one risk entry per risk with its own cause, impact, control, owner, and treatment;
- one ADR per decision with distinct context, outcome, alternatives, and consequences;
- one option record per actual decision space or trade-off;
- one pattern per reusable observed convention;
- one integration record per external system, boundary, protocol, ownership, failure, retry, reconciliation, and security contract;
- one runbook per operational procedure, failure scenario, recovery activity, or maintenance responsibility;
- one historical Build record per discernible intent or delivery episode.

Create indexes, catalogs, registers, maps, ledgers, and analysis dossiers to navigate these records. They do not replace the underlying files and do not satisfy their manifest rows.

Do not reuse one proposed path for multiple manifest rows. Do not place several unrelated ADRs, personas, workflows, risks, or runbooks into a composite draft to reduce output.

## Account for the complete SPECS surface

For every material capability, account for:

- Scope: domain language, actors/personas, boundaries, interfaces, APIs, events, commands, data, and integrations;
- Purpose: intent, workflows, journeys, functional and non-functional requirements, acceptance criteria, outcomes, and non-goals;
- Evidence: tests, risks, incidents, operational evidence, technical debt, validation, contradictions, and learning;
- Constraints: engineering, architecture, security, privacy, data, accessibility, testing, compliance, and operational rules;
- Strategy: architecture, stack, patterns, anti-patterns, ADRs, decisions, options, SOPs, runbooks, observability, recovery, and continuity;
- Build: prototypes, plans, tasks, dependencies, gates, tests, reviews, releases, deployment, manual QA, retrospectives, and iteration history.

For the project as a whole, additionally populate the domain and system context, persona library, integration catalog, API/event/command catalog, journey and requirement indexes, risk register, test coverage, security review, code-quality review, incident catalog, technical-debt catalog, standards, architecture set, pattern library, ADR index, options register, SOP and runbook indexes, observability, recovery, deployment history, and lifecycle reconstruction.

## Use exception states honestly

Allowed terminal states are:

- `created`: an individual detailed proposal exists and cites evidence;
- `not-applicable`: investigation evidence and a substantive rationale show the family genuinely does not apply;
- `blocked`: a named owner or unavailable evidence prevents reconstruction and a concrete next action is recorded.

Do not use `not-applicable` because evidence was not inspected, time is short, the output would be large, or a dossier mentions the subject. Do not use `blocked` for ordinary uncertainty that can be represented in a detailed draft.

## Validate before review

Run the maximum-detail validator after all passes. It checks the required catalogs and ledgers, every capability/family combination, project-wide families, individual proposal paths, evidence references, artefact substance, and exception-state justification.

Validation passing means `Investigation ready for review`; it does not mean Archaeology is complete. After review, promote accepted records throughout canonical SPECS, retain rejected and unresolved material with provenance, update indexes, and rerun consistency checks.

Offer self-review/manual filing or an AI-guided walkthrough. Automatic curation requires explicit consent and must never overwrite a differing canonical record. After curation, prospective recommendations and feature candidates may be created from the accepted baseline, but they remain distinct from reconstructed historical records and become intents only with user approval.
