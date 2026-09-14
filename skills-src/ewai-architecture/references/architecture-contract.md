# EWAI Architecture Contract

Use this contract to validate an architecture walkthrough and its SPECS proposals. It applies at enterprise, solution, capability, domain, intent, and cross-cutting-concern scope. Applicability may vary; silent omission is not allowed.

## 1. Scope record

`scope.yaml` must record:

```yaml
schema: ewai.architecture-scope/v1
id: architecture-<date>-<slug>
title: Human-readable title
scope_type: enterprise | solution | capability | domain | intent | cross-cutting
mode: current | target | current-to-target | decision
scope_refs: []
business_outcome: ""
decision_horizon: ""
accountable_owner: ""
included: []
excluded: []
constraints_known: []
status: proposed | in-review | reviewed
```

If the scope changes materially, update it and disclose which records need reassessment.

## 2. Truth classifications

Every material claim in `evidence-ledger.yaml` has an ID and exactly one classification:

- `observed`: directly supported by a cited artefact, runtime observation, or attributed testimony;
- `inferred`: the best explanation of evidence, but not confirmed intent;
- `proposed`: a future choice, recommendation, standard, pattern, or target;
- `accepted`: explicitly approved by the named accountable owner;
- `rejected`: explicitly declined;
- `superseded`: once valid but replaced by a cited later decision;
- `contradicted`: credible sources disagree;
- `unknown`: evidence is not currently sufficient.

Each claim records source locations, capture date, confidence, contradictions, affected records, and validation owner. A file path without a relevant section, symbol, commit, test, or quoted human attribution is weak evidence. Repeated code is not automatically an accepted pattern.

## 3. Architecture viewpoints

Record each viewpoint as `applicable`, `not-applicable`, `unknown`, or `deferred`, with rationale and owner in `viewpoint-matrix.yaml`.

### Business and capability

Cover outcomes, capabilities, value streams, users and stakeholders, ownership, dependencies, organisational boundaries, service levels, and business change. Candidate outputs include capability maps, context views, principles, ownership decisions, and outcome measures.

### Domain and information

Cover bounded contexts, ubiquitous language, information ownership, authoritative sources, data movement, lifecycle, quality, classification, residency, retention, deletion, lineage, reporting, and analytics. Candidate outputs include domain models, data architecture, classification standards, lifecycle rules, and ADRs.

### Application and service

Cover application responsibilities, service boundaries, interfaces, shared capabilities, coupling, cohesion, state, workflows, buy/build/reuse, versioning, and retirement. Candidate outputs include system context, container/component views, service contracts, patterns, anti-patterns, and decisions.

### Integration

Cover internal and external systems, protocols, schemas, identity propagation, trust boundaries, synchronous/asynchronous choices, ordering, idempotency, retries, timeouts, reconciliation, rate limits, ownership, observability, and failure handling. Candidate outputs include an integration catalogue, sequence/data-flow diagrams, integration standards, ADRs, and runbooks.

### Technology and deployment

Cover languages, frameworks, runtimes, platforms, data stores, environments, topology, networking, tenancy, configuration, secrets, build and release, portability, scaling, cost, support status, licensing, end-of-life, and technology lifecycle. Candidate outputs include stack strategy, deployment views, technology standards, lifecycle risks, and options.

### Security and trust

Cover identity, authentication, authorization, least privilege, tenancy, threat assumptions, attack surfaces, data protection, encryption, secrets, audit, supply chain, privacy, abuse, incident response, and assurance ownership. Candidate outputs include trust-boundary diagrams, risks, constraints, controls, security ADRs, and verification requirements. This is architecture analysis, not penetration testing, legal advice, certification, or a compliance attestation.

### Operations and resilience

Cover availability, capacity, performance, failure modes, backup, recovery objectives, disaster recovery, observability, alerting, support ownership, deployments, rollback, maintenance, incidents, continuity, and operational readiness. Candidate outputs include quality-attribute scenarios, SLO proposals, runbooks, recovery architecture, observability standards, risks, and readiness criteria.

### Governance and evolution

Cover architecture principles, decision rights, standards ownership, exceptions, fitness functions, conformance, technical debt, roadmaps, transition states, migration, deprecation, review triggers, and learning. Candidate outputs include governance records, exception processes, transition roadmaps, decision and standards indexes, and fitness functions.

## 4. Current state, target state, and transition

Current state contains only observed facts and clearly labelled inferences. Target state contains proposed or accepted decisions, never retrospective claims about existing behaviour. `transition-and-gaps.md` maps each material gap to:

- current evidence;
- desired outcome or target decision;
- affected capability and quality attribute;
- dependency and sequencing;
- risk of change and risk of no change;
- migration, coexistence, rollback, and decommissioning considerations;
- verification evidence and accountable owner;
- related intent or explicitly unplanned work.

A target-state diagram without a transition path is incomplete when a current system exists.

## 5. Evidence ledger and review ledger

The evidence ledger must make it possible to trace a proposal back to evidence and a canonical record back to its approval. `review-ledger.yaml` records, per individual proposal:

```yaml
- proposal: proposals/SPECS/5.Strategy/decisions/ADR-0001-example.md
  disposition: accepted | accepted-with-corrections | rejected | deferred
  owner: ""
  decided_at: ""
  rationale: ""
  canonical_destination: ""
  conflicts: []
  supersedes: []
```

One answer may resolve several proposals only when the skill lists them first and confirms that the same decision genuinely applies to each. Clarification is not approval.

## 6. Individual proposal contract

Create one individual record per material decision, standard, pattern, risk, integration, view, or runbook. Composite reports and indexes cannot satisfy this requirement.

Every proposal contains the SPECS headings:

- **Scope:** boundary, applicability, owners, related capabilities and records;
- **Purpose:** outcome, problem, or quality attribute served;
- **Evidence:** claims and citations, confidence, contradictions, validation approach;
- **Constraints:** binding inputs, limits, obligations, non-goals, and exceptions;
- **Strategy:** proposal, alternatives, trade-offs, consequences, transition, and review triggers.

### ADR minimums

An ADR additionally records proposed/accepted/superseded status, context, decision drivers, options actually considered, decision, positive and negative consequences, validation, and revisit triggers. Do not invent historical alternatives.

### Standard minimums

A standard additionally records normative language, applicability, rationale, examples, enforcement or fitness functions, evidence expected, exception authority, and review cadence.

### Pattern minimums

A pattern additionally records problem/context, forces, solution, consequences, implementation guidance, known uses supported by evidence, anti-patterns, tests or conformance checks, and exceptions.

### Integration minimums

An integration record additionally covers owners, systems, purpose, direction, protocol, schema/contract, identity and trust, data classification, availability, retries/timeouts/idempotency, reconciliation, rate limits, observability, failure modes, test strategy, change/versioning, and support runbook.

### Risk minimums

A risk additionally records cause, event, impact, likelihood, severity, affected assets/capabilities, current controls, proposed treatment, owner, evidence, review date, and residual risk decision.

## 7. Diagram contract

Every diagram has an editable text source, preferably Mermaid or PlantUML, stored beside or inside its record. It also has an accessible narrative explaining actors, boundaries, flows, trust transitions, and important omissions. Rendered images are derived evidence, never the sole source.

Use the smallest views that answer the decision. A single enormous system diagram is not a substitute for context, container/service, integration/data-flow, deployment, trust-boundary, and transition views when those are applicable.

## 8. SPECS routing

Use the project’s existing taxonomy when it is more specific. Otherwise route proposals as follows:

| Record | Proposed destination |
|---|---|
| Context, capabilities, actors, domain language, system boundaries | `SPECS/1.Scope/` |
| Outcomes, journeys, workflows, requirements, intent relationships | `SPECS/2.Purpose/` |
| Evidence ledger, assessments, risk, quality-attribute evidence | `SPECS/3.Evidence/` |
| Binding architecture, security, data, integration, operational, or engineering standards | `SPECS/4.Constraints/` |
| Architecture views, stack, patterns, options, roadmaps, ADRs, governance, runbooks | `SPECS/5.Strategy/architecture/` or the established Strategy subfolder |

Update relevant standards, ADR, pattern, integration, risk, and architecture indexes when promoting accepted records. Never overwrite a differing canonical record without explicit correction or supersession.

## 9. Completion checks

Before review, confirm:

- scope, mode, owner, and exclusions are explicit;
- every viewpoint has a status and rationale;
- current state and target state are not conflated;
- material claims have evidence classifications and owners;
- each material proposal has its own record;
- options and trade-offs precede recommendations;
- every diagram has text source and narrative;
- open questions and contradictions remain visible;
- risks, operations, security, integration, governance, and transition have not been silently skipped.

Before promotion, confirm explicit record-level decisions, canonical destination preflight, conflict handling, provenance, and index updates. Promotion does not approve an intent, pass a delivery phase, or authorize Build.
