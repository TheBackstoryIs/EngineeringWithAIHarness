# EWAI Archaeology contract

Use this contract to keep reconstruction evidence-led, reviewable, and safe.

## Evidence precedence

No single source is universally authoritative. State what each source can prove:

| Source | Can support | Cannot prove alone |
|---|---|---|
| Runtime observation | Current visible behaviour | Intended behaviour or historical rationale |
| Tests | Asserted contract at a point in time | Business approval or complete coverage |
| Source and configuration | Current implementation | Original intent or continued desirability |
| Manifests and lockfiles | Declared dependencies and resolved versions | Whether a dependency is active at runtime |
| Containers, CI, and infrastructure files | Intended build or deployment mechanics | Whether every environment still follows them |
| Git history | Sequence, authorship, recorded messages | Unrecorded alternatives or full motivation |
| SPECS and ADRs | Recorded intent and accepted decisions | Current implementation conformance |
| Tickets and transcripts | Requested outcomes and discussion | Final approval unless explicitly recorded |
| Human testimony | Lived context and interpretation | Independent corroboration or universal agreement |

Prefer a primary source for the claim and an independent corroborating source. Record conflicts instead of selecting the most convenient account.

## Ledger fields

Each entry in `evidence-ledger.yaml` should contain:

```yaml
- id: ARC-001
  claim: The application isolates customer data by organisation.
  classification: inferred
  confidence: medium
  sources:
    - type: source
      location: src/example.ts:42
      supports: Queries include an organisation identifier.
  contradictions: []
  affected_surfaces: [data-access]
  validation_owner: Technical owner
  review_status: pending
  reviewed_at: null
```

Use `low`, `medium`, or `high` confidence. Classification describes evidence state; confidence describes strength within that state. An inference does not become observed merely because confidence is high.

## Canonical outputs

Create one bundle per bounded dig:

```text
SPECS/3.Evidence/archaeology/<YYYY-MM-DD>-<slug>/
├── report.md
├── evidence-ledger.yaml
├── open-questions.md
└── proposals/
```

The bundle remains the provenance record. Accepted knowledge is copied or synthesized into its canonical SPECS home with backlinks to evidence IDs; it is not removed from the bundle.

For a deep whole-project baseline, extend the bundle without overloading the master report:

```text
SPECS/3.Evidence/archaeology/<YYYY-MM-DD>-<slug>/
├── report.md
├── evidence-ledger.yaml
├── coverage-ledger.yaml
├── capability-catalog.yaml
├── specs-reconstruction-ledger.yaml
├── archaeology-artifact-manifest.yaml
├── persona-routing.yaml
├── technology-hosting-brief.json
├── technology-hosting-brief.md
├── technology-hosting-answers.template.json
├── technology-hosting-profile.json
├── technology-hosting-profile.md
├── open-questions.md
├── analysis/
│   ├── execution-and-deployment.md
│   ├── user-processes.md
│   ├── domain-and-data.md
│   ├── security-and-trust.md
│   ├── integrations.md
│   ├── security-review.md
│   ├── code-quality-review.md
│   ├── frontend-experience.md
│   ├── test-derived-requirements.md
│   ├── configuration-and-dependencies.md
│   ├── history-and-decisions.md
│   └── lifecycle-and-specs-reconstruction.md
└── proposals/
    └── SPECS/
        ├── 1.Scope/
        ├── 2.Purpose/
        ├── 3.Evidence/
        ├── 4.Constraints/
        ├── 5.Strategy/
        └── 6.Build/
```

Create every applicable detailed SPECS proposal. Analysis records are navigational synthesis and may be limited to applicable surfaces; they never replace the detailed records enumerated in the artefact manifest. The purpose is maximum discoverable detail with evidence, not a fixed quota or a small representative sample.

## Persona-routing gate

Create `persona-routing.yaml` from the deterministic installed-persona index after initial reconnaissance and before deep passes. Assess persona value separately for purpose/actors, user processes, domain/data, architecture/integrations, security/trust, operations/assurance, and code quality. Record the inventory without local source paths, the evidence used to identify needed perspectives, per-pass recommendations and expected benefit, gaps, final assignments, and the user's attributed decision.

Present only the concise recommended ensemble to the user, not hundreds of index entries. Deep analysis cannot start until `ewai archaeology validate-personas` passes. If the user declines additional personas, retain the explicit decision and rationale while continuing with the baseline Archaeologist and SPECS Knowledge Curator. Installed personas remain advisory lenses; project actors require separate evidence-grounded project persona proposals.

The security review is a static, evidence-led assessment, not penetration testing or certification. Cover the project's authentication and authorization boundaries, tenant isolation where applicable, validation and output handling, secrets, data protection, cryptography, browser and session controls, integrations, abuse controls, dependencies, deployment configuration, failure behavior, and security tests. Route each material finding to its own risk, constraint, incident, decision, or remediation-candidate record.

The code-quality review covers architecture boundaries, coupling, cohesion, duplication, complexity, inactive code, error handling, transactions and concurrency, idempotency, performance, type and schema safety, testability, observability, configuration drift, and maintainability. Route material findings into their own technical-debt, risk, pattern, constraint, or decision records. Neither review may satisfy detailed manifest rows by merely listing issues in one analysis file.

Read `lifecycle-reconstruction.md` and `maximum-detail-reconstruction.md`. The coverage ledger answers whether the system was investigated deeply; the reconstruction ledger answers whether the missing project knowledge was accounted for across the lifecycle; the artefact manifest proves that the individual detailed proposals were actually produced or honestly excepted.

## Coverage ledger

Record each material surface in `coverage-ledger.yaml`:

```yaml
- id: COV-001
  surface: Alert dispatch and escalation
  category: user-process
  status: mapped
  depth: end-to-end
  repositories: [application]
  examined:
    files: 18
    symbols: 42
    tests: 11
    history_entries: 9
  exclusions: []
  blind_spots: []
  limitation: null
  rationale: null
  review_owner: Product owner
  review_status: accepted
  evidence: [ARC-021, ARC-022]
  investigation_refs: []
  next_action: null
```

During investigation a surface may be `unexamined`, but reviewable terminal values are `mapped`, `partial`, `blocked`, and `not-applicable`. Record honest counts from the investigation; never invent precision. A deep whole-project dig cannot become ready for review with an unexamined material surface. A `partial` surface requires a substantive `limitation`, `review_owner`, and `review_status: accepted`. A `blocked` surface requires a substantive `rationale`, `review_owner`, and concrete `next_action`. A `not-applicable` surface requires a substantive `rationale` and `investigation_refs` proving it was examined.

## Technology inventory

Record technology findings by repository and execution surface. Include languages, frameworks, runtimes, package managers, dependencies that define architecture, data stores, queues, search, observability, containers, infrastructure, CI, and deployment targets.

After the persona-routing gate, a deep baseline must use `ewai archaeology prepare-technology-hosting` against a fresh Repository Source Map and record an accountable response with `ewai archaeology record-technology-hosting`. The briefing must expose the active core, premium, personal, and project persona lenses selected from the approved routing decision. It must ask for the actual provider, platform or service, location or region, environments, deployment model, operating model, data-residency position, release route, inactive signals, contradictions, and unresolved questions. Support single repositories, monorepos, and configured folders containing repository subfolders without flattening repository provenance.

The technology-hosting profile uses a separate provenance vocabulary:

- `repository-observed`: an indexed filename, analyser, or installed Source Map profile matched;
- `owner-declared`: a human supplied the individual answer but did not explicitly confirm it;
- `human-confirmed`: the individual answer was explicitly confirmed with its evidence references.

Reviewer identity alone never upgrades all answers. Configuration and extracted Power Platform or Salesforce source are not proof of the live tenant, environment, region, data residency, deployment route, or runtime state. Retain explicit `active`, `inactive`, `contradicted`, or `uncertain` dispositions for repository signals. Retain unresolved questions and accountable answer owners.

The generated profile remains evidence in the Archaeology bundle. It does not automatically become canonical stack strategy, select a technology pack, run a live infrastructure probe, or authorise deployment. A forced re-preparation may replace preparation artefacts but never overwrites an existing reviewed profile; a digest mismatch makes the earlier profile stale.

Always retain this notice in the briefing and profile:

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.

Use these states:

- `declared`: named in a manifest, lockfile, configuration, or existing SPECS.
- `observed`: used by source, build, test, or deployment evidence.
- `inferred`: suggested by patterns but not directly confirmed.
- `inactive`: present but apparently unused, retired, or limited to historical code.
- `unknown`: version, purpose, ownership, or runtime use cannot be established.

Capture version provenance rather than guessing from current product releases. Do not execute package installation or project-defined scripts merely to identify the stack. Put the proposed reviewed stack record in `proposals/stack.md`; after human confirmation, route it to `SPECS/5.Strategy/architecture/stack.md` and then consider matching EWAI technology packs.

## Promotion rules

| Candidate finding | Review destination |
|---|---|
| Boundary, inventory, term, API, or persona | `SPECS/1.Scope/` |
| Intent, journey, discussion, or requirement | `SPECS/2.Purpose/` |
| Observation, risk, test result, incident, or unresolved finding | `SPECS/3.Evidence/` |
| Confirmed non-negotiable rule | `SPECS/4.Constraints/` |
| Accepted decision, option, architecture, pattern, SOP, or runbook | `SPECS/5.Strategy/` |
| Implementation tracker or build output | `SPECS/6.Build/` |

Require an accountable human to approve promotion. Security, privacy, compliance, accessibility, and legal findings may require a qualified specialist rather than only the project owner.

## Review and future-work transition

After maximum-detail validation, create the review guide, decision ledger, and cross-record question plan. Offer self-review with manual filing or an AI-guided high-level walkthrough with drill-down. For guided review, synthesize shared assumptions, contradictions, and decisions into the smallest useful set of questions. Every question names its evidence, affected record IDs, expected changes, and whether it seeks clarification or approval. Apply one attributed answer across those records only when it truly governs them; split divergent groups. Automatic filing requires an explicit user request, terminal decisions for every reconstruction record, accountable reviewers, explanatory notes for corrected/rejected/deferred records, and a conflict-free preflight against canonical SPECS.

Once curated, offer a separate prospective backlog exercise. Draw possible features, enhancements, security improvements, code-quality work, and operational recommendations from accepted SPECS, imported context, review findings, risks, and gaps. Keep recommendations labelled as AI proposals under the Archaeology bundle's `recommendations/` directory until the user accepts them. Route an accepted but immature idea to `SPECS/2.Purpose/explorations/feature-candidates/`; use `$ewai-intent` only after the outcome, actors, journeys, acceptance evidence, constraints, dependencies, and open decisions are sufficiently explicit and the user approves creation.

The prospective backlog offer is mandatory even when remediation intents were already approved or created. Present three explicit routes: interview the owner about future work, ingest a roadmap/feature list/discovery folder, or produce EWAI's evidence-based recommendations across product, experience, integrations, security, operations, resilience, testing, observability, code quality, and maintainability. A generic “what next?” does not satisfy the transition. Record the offer and the user's selection or explicit decline in `future-work-transition.yaml`. Do not batch-create recommendation or remediation intents without explicit approval for the named candidates.

## Safety boundaries

- Default to read-only investigation outside the archaeology bundle.
- Do not run destructive commands, migrations, deployments, or production queries.
- Do not record secrets, credentials, personal data, or unnecessary sensitive excerpts.
- Do not infer a person's goals, needs, or characteristics from access-control code alone.
- Do not erase contradictory evidence or rewrite historical records to match the current explanation.
- Do not start remediation during the dig; capture a separate intent after review.
- Do not restore deleted files or disturb the worktree merely to inspect history; read historical content through Git object commands.
