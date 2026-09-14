# SPECS lifecycle reconstruction

Use this reference during a deep whole-project dig to reconstruct the durable project knowledge EWAI would normally have captured while the system was conceived, designed, built, validated, operated, and improved.

## Reconstruction principle

Work capability by capability, then reconcile across the whole system. For each material capability, inspect every SPECS area and every applicable delivery stage. Do not treat an empty area as implicitly complete: record it as not applicable, blocked, or a visible knowledge gap.

Reconstruct records under the archaeology bundle first:

```text
SPECS/3.Evidence/archaeology/<date>-<slug>/
├── specs-reconstruction-ledger.yaml
├── capability-catalog.yaml
├── archaeology-artifact-manifest.yaml
└── proposals/
    └── SPECS/
        ├── 1.Scope/
        ├── 2.Purpose/
        ├── 3.Evidence/
        ├── 4.Constraints/
        ├── 5.Strategy/
        └── 6.Build/
```

The proposals tree mirrors the canonical destination. Promote reviewed records into the project SPECS without losing the archaeology provenance link.

## SPECS reconstruction matrix

### 1.Scope — what the system contains and touches

Attempt to reconstruct:

- system context, boundaries, repositories, runtime surfaces, actors, external systems, and ownership;
- domain glossary, entities, relationships, bounded contexts, lifecycle states, and invariants;
- personas grounded in actual roles or research, clearly separated from inferred actors;
- API, event, command, integration, and data-contract inventories;
- research, source material, templates, and inter-team handoffs visible in the record.

Typical evidence includes routes, schemas, models, interfaces, UI labels, integration adapters, ownership files, tickets, transcripts, and recurring terminology.

### 2.Purpose — why capabilities exist and what outcomes they serve

Attempt to reconstruct:

- project and capability intents;
- user, operator, administrator, support, and failure-recovery journeys;
- functional and non-functional requirements, including those encoded only in tests;
- acceptance criteria, success measures, non-goals, dependencies, and open decisions;
- explorations and discussions that materially changed scope or behavior.

Implementation can establish observable behavior, not business approval. Mark inferred purpose and retrospective acceptance criteria for human confirmation.

### 3.Evidence — what supports, challenges, or explains the knowledge

Attempt to reconstruct:

- evidence ledgers, test-derived behavior, validation outcomes, and gate evidence;
- a project security review and code-quality review, with material findings split into individual risks, constraints, technical-debt entries, patterns, decisions, or remediation candidates;
- incidents, regressions, postmortem signals, risks, technical debt, and unresolved contradictions;
- iteration history, delivery evidence, manual-validation evidence, and operational observations;
- retrospectives and lessons suggested by later fixes, reversals, or repeated mistakes;
- compliance-applicability candidates awaiting qualified review.

Absence of evidence is itself a recorded gap; never convert it into a passed gate.

### 4.Constraints — rules the project appears required to obey

Attempt to reconstruct:

- engineering, architecture, security, privacy, accessibility, data, testing, and operational constraints;
- organisation or tenant isolation, identifier, validation, response, audit, retention, and deployment rules;
- external obligations and compliance constraints only when supported by an authoritative source and qualified owner;
- exceptions, compensating controls, expiry or review dates, and observed violations.

A repeated implementation convention is a candidate constraint or pattern, not automatically a binding standard.

### 5.Strategy — how and why the system takes its current shape

Attempt to reconstruct:

- system context, runtime topology, component boundaries, data architecture, integration architecture, and technology stack;
- architectural and implementation patterns, anti-patterns, checklists, and reusable conventions;
- ADRs for material architectural, product, security, data, delivery, and operational decisions;
- option records showing alternatives genuinely evidenced as considered, evaluation criteria, trade-offs, and the selected outcome;
- SOPs, runbooks, recovery procedures, maintenance practices, and context capsules.

For a reconstructed ADR, separate:

1. the decision outcome observed in live code;
2. the historical context supported by evidence;
3. alternatives demonstrably considered in commits, PRs, issues, docs, or testimony;
4. plausible alternatives that still need confirmation;
5. consequences observed later;
6. current status: active, superseded, drifted, partial, or unknown.

Never say an option was considered merely because it would have been reasonable.

### 6.Build — how individual capabilities appear to have been delivered

Attempt to reconstruct, where evidence survives:

- intent trackers and phase history;
- design and prototype references;
- implementation and test plans;
- task graphs, dependencies, sequence, handoffs, approvals, and blockers;
- standards sweeps, test execution, external review, delivery, manual QA, and retrospective outcomes;
- links between commits, releases, migrations, incidents, and the capability they changed.

Mark reconstructed build records as historical. Do not create a false active run, claim a gate passed without evidence, or fabricate plans that never existed.

## Fourteen-stage lifecycle pass

For each reconstructed intent, look for evidence of the configured EWAI stages:

1. ideate;
2. intent;
3. reconcile;
4. plan;
5. pattern-validation;
6. test-plan;
7. validate-external-plan;
8. validate-external-test-plan;
9. build;
10. standards-sweep;
11. test-execute;
12. validate-external-code;
13. delivery;
14. retro.

Also inspect conditional UI design, fit-check, and manual-QA evidence. Record each stage as evidenced, partial, absent, not applicable, or unknown. Provider-gated validation is evidenced only when a real provider result survives; never infer it from code quality or a commit message.

## Reconstruction ledger

Give each candidate record an entry in `specs-reconstruction-ledger.yaml`:

```yaml
- id: REC-001
  capability: Alert escalation
  specs_area: 5.Strategy
  record_type: adr
  proposed_path: SPECS/5.Strategy/decisions/ADR-REC-alert-escalation.md
  lifecycle_stages: [reconcile, plan, build, delivery]
  reconstruction_state: proposed-observed
  temporal_window:
    first_evidence: 2024-02-10
    last_confirmed: 2025-11-03
  evidence: [ARC-021, ARC-034]
  unknowns:
    - Whether polling was formally compared with event-driven delivery.
  review_owner: Technical owner
  review_status: pending
```

Use these reconstruction states:

- `existing-aligned`: a canonical record exists and agrees with current evidence;
- `existing-drifted`: a canonical record exists but conflicts with current evidence;
- `proposed-observed`: the candidate record describes directly observable or corroborated facts;
- `proposed-inferred`: material purpose, rationale, chronology, or relationship still needs confirmation;
- `blocked`: evidence or a qualified reviewer is unavailable;
- `not-applicable`: the record type genuinely does not apply to this capability.

## Completion check

A deep whole-project reconstruction is not complete until:

- every material capability has been checked against all six SPECS areas;
- every reconstructed intent has a fourteen-stage lifecycle assessment;
- architecture, patterns, ADRs, options, workflows, requirements, constraints, evidence, delivery history, and learning are present or have an explicit gap status;
- proposed records link to evidence and retain uncertainty;
- cross-capability records have been consolidated without erasing meaningful differences;
- accountable reviewers have accepted, corrected, rejected, or explicitly deferred promotion.

After curation, keep reconstructed historical records and remediation work separate from prospective work. Always make the explicit three-route prospective offer: interview the owner, ingest a roadmap/feature list/discovery folder, or generate EWAI's evidence-based recommendations. Record the choice or explicit decline in `future-work-transition.yaml`. Existing remediation intents do not satisfy this gate. Offer to turn user-supplied upcoming features, reviewed imported discovery material, or accepted AI recommendations into lightweight feature candidates. Promote a candidate to a full intent only after it meets the intent contract and the user approves it.

Completeness means maximum-detail accounting and individual record production, not invented documentation and not an arbitrary target number of files. A small set of composite drafts is not complete accounting.
