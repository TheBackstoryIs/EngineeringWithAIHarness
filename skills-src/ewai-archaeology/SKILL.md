---
name: ewai-archaeology
description: Investigate an existing or poorly documented project and reconstruct its observable behaviour, technology stack, history, domain language, user flows, requirements, decisions, constraints, patterns, risks, and unresolved questions from repository and human evidence. Use when EWAI is initialized in an existing codebase, when documentation has drifted or disappeared, when nobody knows why code is shaped a particular way, or before changing a legacy area whose intent and blast radius are unclear.
---

# EWAI Archaeology

Reconstruct understanding before proposing change. Use the free `ewai.core.archaeologist` persona to investigate and the free `ewai.core.specs-knowledge-curator` persona to route reviewed findings. When project context sources exist, read the reviewed import evidence and persona-routing record before deep repository analysis.

Resolve the workspace and SPECS root from `.ewai-pipeline/project.json`. In a multi-repository workspace, inspect every repository configured by the selected SPECS contract and write reconstruction records only into that configured SPECS root.

## Honour the non-negotiable mission

For a whole-project run, produce a **full-coverage, maximum-discoverable-detail recreation of the SPECS knowledge this project would have accumulated if EWAI had accompanied it from inception to its current state**. This is not a lightweight interpretive pass, awareness report, executive assessment, technical survey, or small set of representative drafts.

Recreate every individually discernible project record supported by repository, history, documentation, imported context, operational evidence, or human testimony, including:

- project actors and project-specific personas;
- domain language, models, boundaries, interfaces, APIs, commands, events, and integration contracts;
- project and capability intents, requirements, acceptance criteria, journeys, workflows, and exception paths;
- risks, incidents, technical debt, test-derived evidence, validation gaps, and the risk register;
- engineering, security, privacy, data, accessibility, compliance, testing, and operational constraints;
- system, component, data, integration, deployment, and runtime architecture;
- individual patterns, anti-patterns, ADRs, decisions, alternatives, trade-offs, and option records;
- SOPs, operational procedures, runbooks, observability, recovery, continuity, deployment, and maintenance knowledge;
- historical plans, prototypes, build records, validation, releases, retrospectives, and learning.

Create individual detailed records. A report, dossier, index, ledger, catalog, or composite summary may synthesize and navigate those records but never substitutes for them. Do not optimize for a tidy answer, one context window, low file count, or completing a second requested task in the same pass. Checkpoint and continue until the target inventory is exhausted.

Before reconstructing any record, read [the Archaeology contract](references/archaeology-contract.md), [the SPECS lifecycle reconstruction reference](references/lifecycle-reconstruction.md), and [the maximum-detail reconstruction contract](references/maximum-detail-reconstruction.md) completely. Before delegating the security pass, also read [the provider-specific model-routing rules](references/model-routing.md). Do not proceed from memory or substitute a shorter interpretation.

## Pass the purpose-alignment gate

Do not begin deep Archaeology until EWAI is initialized and a human project briefing records why the project exists, who it serves, the outcomes that matter, known constraints, and important non-goals. Code can show current behaviour; it cannot establish business purpose or prove that behaviour is intentional.

Start with read-only reconnaissance. Compare repository evidence with the human briefing, then present your current understanding of the project's purpose, boundaries, and primary processes. Mark every code-derived purpose claim as a hypothesis. Ask the project owner to confirm, correct, or qualify material differences before reconstructing journeys, requirements, decisions, or standards. If purpose remains unclear, keep asking one focused question at a time and do not proceed merely because the repository is large or internally consistent.

Offer `$ewai-context-import` when the user has source material that has not yet been registered. Reconcile its attributed findings with code and history; do not treat a meeting statement as more authoritative than live behaviour or treat live behaviour as proof of business intent.

## Pass the persona-value gate

After initial repository and imported-source reconnaissance, but before launching any deep analysis agents, run `ewai archaeology prepare-personas <bundle> --project <path> --json` internally. This snapshots the installed core, premium, personal, and project persona capability index into `persona-routing.yaml`; do not replace it with a memory-based list.

Assess the likely value of available personas for purpose and actors, user processes, domain and data, architecture and integrations, security and trust, operations and assurance, and code quality. For every pass, record the recommended persona identifiers, why they fit the evidence, what they should improve, and any perspective gap. Select a small ensemble; do not load the entire library merely because it is installed.

Present the user with a concise persona analysis before proceeding. Tell them:

- how many personas and tiers were examined;
- which personas would materially improve the Archaeology and why;
- which bounded passes each persona would lead, consult on, or challenge;
- where no suitable persona exists or a project-specific actor persona may be needed;
- that installed advisory personas are reasoning lenses, not evidence about real users.

Ask whether to use the recommended ensemble. Record the user's confirmation or decline, the selected personas, accountable person, time, summary shown, assignments, and any notes in `persona-routing.yaml`. Then run:

```bash
ewai archaeology validate-personas <bundle> --project <path> --json
```

Do not launch deep analysis agents unless this validation passes. A decline is valid when it is explicit and explained; the baseline Archaeologist and SPECS Knowledge Curator still apply. If deep passes already ran because this gate was missed, disclose the process failure, complete the persona analysis, and rerun every pass whose interpretation could materially change.

Switch the selected lenses as the investigation moves between passes. Propose project personas for evidenced actors under `proposals/SPECS/1.Scope/personas/project/`; never present an installed advisory persona as research about a real user.

## Establish technology and hosting with the owner

After the persona-value gate passes and before treating execution or deployment claims as current truth, refresh the Repository Source Map and prepare the governed technology and hosting briefing:

```bash
ewai index refresh --project <path>
ewai archaeology prepare-technology-hosting <bundle> --project <path> --json
```

Use the returned `activePersonas` as the visible lenses for this conversation. The core Archaeologist and SPECS Knowledge Curator remain active; swap in the confirmed premium, personal, and project personas that materially improve architecture, platform, data, operations, release, residency, or assurance questioning. Do not download premium personas during Archaeology. Do not hide which personas are engaged or use an unapproved persona merely because it matched a repository signal.

Treat every Source Map observation as `repository-observed`, not as proof of current use. Installed technology, stack, Organisation Blueprint, and project Source Map profiles may add evidence types beyond EWAI's common filename catalogue. Preserve the profile ID and analyser provenance; do not expand them into unsupported claims. Do not execute project scripts or inspect live hosting accounts as part of this operation.

Walk the owner through the generated questions. Explicitly establish:

- actual languages, frameworks, runtimes, databases, integrations, infrastructure, and relevant versions;
- actual provider, platform or service for every environment;
- countries, regions, data centres, tenants, or physical locations;
- development, test, staging, production, recovery, and other environments;
- cloud, on-premises, SaaS, PaaS, IaaS, managed-service, hybrid, other, or unknown deployment models;
- self-managed, provider-managed, shared, third-party-managed, hybrid, or unknown operating models and accountable owners;
- data storage, processing, backup, replication, and residency;
- the real release route, approvals, automation, rollback, and operational handoff;
- inactive or historical repository signals, contradictions, unresolved questions, answer owners, and required evidence.

For Power Platform or Salesforce, ask the operator to export and extract the application configuration into a configured repository or repository subfolder, then refresh the Source Map. EWAI analyses the extracted evidence; it does not extract ZIP or `.msapp` archives and an export does not prove the live tenant, environment, location, or deployment route.

Complete `technology-hosting-answers.template.json`, marking confirmation per answer, then record it:

```bash
ewai archaeology record-technology-hosting <bundle> \
  --input <project-relative-answers.json> \
  --reviewed-by "<accountable person>" \
  --project <path> --json

ewai archaeology technology-hosting-status <bundle> --project <path> --json
```

Preserve the distinction between `repository-observed`, `owner-declared`, and `human-confirmed`. A named reviewer does not confirm all fields. Retain contradictions and unknowns. Do not copy the profile into `SPECS/5.Strategy/architecture/stack.md` until the normal Archaeology review and curation gate approves that promotion.

Always preserve this notice in the briefing and recorded profile:

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.

## Select and record reproducible depth

After the Source Map is fresh and owner evidence is attributed, use `$ewai-evidence-depth` before deep passes. Prepare independent architecture, data, security, product, delivery, governance, and operations recommendations. Show coverage, retained failures and exclusions, stable gaps, adaptive questions, and the personas actively engaged for each concern.

Ask a named accountable person to select every dimension and explicitly group every eligible gap. Record the reviewed run before claiming an agreed Archaeology boundary. A whole-project baseline will commonly recommend deep coverage for several dimensions, but do not force all dimensions to the same level or use proposal count, ticket count, repository size, or generated prose length as a depth measure.

When repeating Archaeology, compare stored runs before explaining output changes. Explain changes in governed inputs, evidence, personas, depth, coverage, gaps, and grouping order. Do not rescan merely to compare and do not describe unexplained derived variance as reproducible.

Swap the visible persona ensemble as the dimension changes. Core and project personas provide the complete baseline; installed premium and personal personas add specialist challenge only when relevant. Never sync premium personas during this operation.

## Honour the requested depth

Treat a whole-project dig as a deep baseline by default. Reconnaissance is its first pass, not its completion boundary. A lightweight survey is allowed only when the user explicitly asks for one; label its outputs `survey`, list every deferred surface, and never describe it as completed Archaeology.

For a deep whole-project dig, live code is the primary evidence of current system behaviour. Git history and deleted documentation explain evolution and rationale; they do not substitute for tracing the application that runs today. Do not use artefact count, commit count, or a broad file inventory as evidence of depth.

Create `coverage-ledger.yaml` at the start and maintain it throughout. Record repositories, application surfaces, relevant file and symbol counts, examined sources, sampling or exclusions, depth achieved, unresolved blind spots, and the next required pass. A material surface may be `mapped`, `partial`, `blocked`, `not-applicable`, or `unexamined`. Whole-project Archaeology cannot become ready for review while a material surface remains `unexamined` or silently sampled.

Reconstruct the project as though EWAI had accompanied its lifecycle. Create `capability-catalog.yaml`, `specs-reconstruction-ledger.yaml`, and `archaeology-artifact-manifest.yaml` before producing proposals. Enumerate the full target record inventory, then iterate every material capability across all six SPECS areas, every required record family, and the applicable fourteen delivery stages. Build individual proposed records in a mirrored `proposals/SPECS/` tree. Do not invent missing history: record absent evidence and inferred rationale explicitly.

Perform these passes where applicable:

1. **Execution and deployment:** entry points, runtime topology, environments, containers, CI/CD, scheduled work, queues, workers, health checks, observability, and recovery.
2. **User and operational processes:** routes, screens, commands, APIs, controllers, services, jobs, events, notifications, state transitions, exception paths, and administrative workflows. Trace important flows end to end rather than listing files.
3. **Domain and data:** migrations, schemas, models, relationships, invariants, ownership, retention, audit history, lifecycle, and cross-boundary data movement.
4. **Security and trust review:** authentication, authorization, roles, tenancy or organisation scoping, secrets and configuration boundaries, input validation, output handling, sensitive data, cryptography, session and browser controls, dependency and supply-chain signals, external trust boundaries, abuse controls, failure modes, and security tests. Produce an individual project security-review record, route each material finding into a separate risk or constraint proposal, and make untested high-risk paths visible. This is an evidence-led static review, not penetration testing, compliance certification, or a guarantee of security. Run it as a distinct defensive, read-only pass using the provider-specific model-routing rules; in Claude Code invoke the installed `ewai-security-reviewer` subagent rather than a generic inherited-model agent.
5. **Code-quality review:** architecture boundaries, coupling, cohesion, duplication, complexity, dead or inactive code, error handling, transactions, concurrency, idempotency, performance, type and schema safety, testability, observability, configuration drift, maintainability, and recurring code conventions. Produce an individual project code-quality-review record and route material findings into separate technical-debt, pattern, constraint, risk, or decision proposals rather than leaving them in one narrative.
6. **Integrations and delivery:** providers, protocols, retries, idempotency, rate limits, failure handling, reconciliation, webhooks, and degraded-mode behaviour.
7. **Frontend and experience:** user journeys, navigation, state management, service calls, accessibility signals, error states, responsive behavior, and divergence between UI and backend contracts.
8. **Tests as requirements:** unit, feature, integration, end-to-end, security, performance, and failure-path tests. Extract asserted behaviour and identify high-risk live paths with no corresponding evidence.
9. **Configuration and dependencies:** manifests, lockfiles, framework configuration, feature flags, runtime pins, dependency purpose, inactive dependencies, and support risk.
10. **History and decisions:** trace each major live capability through relevant commits, diffs, blame, tags, PRs, issues, deleted documentation, and migrations. Use history to explain the current shape and distinguish deliberate decisions from accumulated behaviour.
11. **Lifecycle and SPECS reconstruction:** for each capability, rebuild the Scope, Purpose, Evidence, Constraints, Strategy, and Build records EWAI would normally have captured, including a fourteen-stage lifecycle assessment.
12. **Reconciliation:** compare live code, tests, history, documentation, human testimony, and reconstructed records; surface contradictions and validate them with accountable people.

For large repositories, work capability by capability and checkpoint between passes. Continue until the coverage ledger satisfies the agreed boundary; do not stop merely because one context window, agent turn, or convenient survey has ended.

## Use human progress language

Keep commands, raw search output, and evidence-ledger mechanics internal. Batch related read-only operations into bounded passes. Before each pass, explain the question in human terms; after it, report the meaningful delta with honest counts and confidence. Useful progress language includes:

- `Looking for user processes…`
- `Reviewing the database structure…`
- `Assessing security and trust boundaries…`
- `Reviewing backend configuration…`
- `Building the project language…`
- `Found 4 candidate workflows · 2 need your confirmation`
- `Found 3 recurring terms that may mean different things`
- `Capturing an observed API response convention as a proposed standard`

Do not announce routine shell commands, individual files, or every search. Do not claim a discovery merely to create progress theatre. Surface contradictions, uncertainty, sensitive findings, permission needs, and blockers immediately. Host-native tool-call chrome may remain visible, but the conversational narrative must stay focused on understanding and decisions.

## Establish the dig

1. Read `SPECS/pipeline.yaml`, the confirmed project briefing, reviewed context-import bundles, persona-routing records, and existing Project SPECS.
2. Complete the purpose-alignment gate above.
3. Confirm the investigation boundary: whole project, repository, capability, flow, decision, integration, or suspicious code area.
4. Record the question the dig must answer and the accountable people who can validate findings.
5. Check the worktree before writing evidence. Do not disturb unrelated changes.
6. Create a dated bundle at `SPECS/3.Evidence/archaeology/<YYYY-MM-DD>-<slug>/`.
7. Complete initial read-only reconnaissance, prepare the persona routing file, present the recommended ensemble, record the user's decision, and pass `ewai archaeology validate-personas`.
8. Refresh the Repository Source Map, prepare the technology and hosting briefing, interview the owner, and record the attributed profile before relying on current execution or deployment claims.
9. Use `$ewai-evidence-depth` to prepare and record the named seven-dimensional investigation boundary.
10. Create the coverage ledger from that reviewed run and retain every failed, excluded, contradictory, deferred, and unknown surface.
11. Create the capability catalog from all user, operational, administrative, integration, data, platform, and support capabilities found across live code and history.
12. Create the SPECS reconstruction ledger and seed one row for every material capability crossed with each applicable SPECS area and lifecycle stage.
13. Create the artefact manifest and seed every required capability and project record family before writing proposals. Add newly discovered records immediately; never let the manifest lag behind the investigation.

If EWAI is not initialized or the human project briefing is missing, return to the EWAI companion onboarding flow. Do not force initialization, infer the briefing from code, or overwrite an existing SPECS contract.

## Gather evidence

Inspect the most specific available sources before broad searches:

1. Existing SPECS, ADRs, requirements, runbooks, diagrams, and decision records.
2. Repository index or symbol graph when available; verify derived results against source.
3. Source code, tests, schemas, routes, configuration, interfaces, and deployment files.
4. Manifests, lockfiles, runtime pins, containers, infrastructure definitions, CI workflows, deployment descriptors, and database adapters.
5. Git history, blame, commit messages, tags, branches, and linked issue or pull-request references.
6. Supplied tickets, transcripts, incident records, research, and operational evidence.
7. Human testimony, clearly attributed and distinguished from repository observation.

Use `rg` for file and text discovery. Use targeted `git log --follow`, `git log -S`, `git show`, and `git blame` only inside the agreed dig site. Never expose secrets or copy sensitive values into archaeology artefacts.

## Maintain the evidence ledger

Write `evidence-ledger.yaml` and give every material claim one classification:

- `observed`: directly visible in an authoritative source.
- `corroborated`: supported by at least two independent sources.
- `inferred`: plausible explanation that still needs confirmation.
- `contradicted`: credible sources disagree.
- `unknown`: evidence is absent or insufficient.

Record the claim, source locations, confidence, contradictions, affected surfaces, validation owner, and review status. Code proves current implementation, not business intent. Repetition proves consistency, not necessarily an approved pattern.

The three reconstruction references named in the non-negotiable mission are mandatory inputs, not optional background reading.

## Reconstruct project knowledge

Prepare `report.md` with:

- dig scope and repository snapshot;
- technology inventory covering languages, frameworks, runtimes, package managers, data stores, infrastructure, deployment targets, and evidenced versions;
- evidence-backed timeline;
- observed behaviour and system boundaries;
- inferred domain language, personas, journeys, requirements, and intents;
- reconstructed decisions, constraints, patterns, dependencies, and consequences;
- contradictions, risks, blast-radius concerns, and stale documentation;
- open questions and proposed validation owners;
- candidate SPECS changes grouped by destination.

For a deep whole-project baseline, keep detailed analysis under `analysis/` so the master report remains navigable. Create only applicable records, but normally expect separate evidence-backed views of execution/deployment, user processes, domain/data, security/trust boundaries, integrations, frontend experience, test-derived requirements, configuration/dependencies, history/decisions, and lifecycle/SPECS reconstruction. A small master report may link to extensive analysis; a small number of links does not excuse shallow coverage.

Create separate `evidence.security-review` and `evidence.code-quality-review` project records. Link their findings to individual risks, technical-debt entries, constraints, patterns, decisions, and remediation candidates. Do not hide a list of issues inside either review instead of creating the detailed records required elsewhere in the manifest.

Keep proposed artefacts under the bundle's `proposals/SPECS/` mirror until reviewed. Produce separate files for every discernible persona, intent, workflow, journey, requirement set, risk, constraint, pattern, ADR, option, integration, architecture decision, SOP, runbook, operational procedure, incident, historical build record, and retrospective. Populate navigational indexes and registers in addition to their detailed entries. Put interview questions in `open-questions.md`; ask them one at a time and update the ledger with attributed answers.

An observed implementation may support a reconstructed decision outcome, but not an unrecorded rationale. An alternative belongs in historical options only when commits, PRs, issues, documents, or attributed testimony show it was actually considered; otherwise label it a plausible alternative requiring confirmation. Mark reconstructed `6.Build` records as historical and never turn them into an active delivery run.

Before presenting findings for review, run:

```bash
ewai archaeology validate <bundle> --project <path> --json
```

Resolve every validation error. Do not tell the user the investigation is complete, ready, full, or comprehensive when validation fails. Report the status as `Investigation in progress` while records remain, `Investigation ready for review` only after validation passes, and `Archaeology complete` only after human review and canonical curation.

Classify technology as `declared`, `observed`, `inferred`, `inactive`, or `unknown`. Compare the inventory with any existing `SPECS/5.Strategy/architecture/stack.md`, record drift, and propose matching installed technology packs. Do not run untrusted project scripts, install dependencies, select packs, or rewrite stack strategy without human approval.

## Offer a choice of review experience

After validation passes, run `ewai archaeology prepare-review <bundle> --project <path> --json` internally. Tell the user how many individual proposals are ready and offer two clear paths:

1. **Self-review and manual filing:** show the review guide, proposals tree, evidence links, and proposed canonical destinations. Let the user edit, refile, merge, or leave records in the bundle. Do not imply that manual filing is second-class and do not copy anything automatically.
2. **AI-guided walkthrough:** present a high-level map first, then walk through small related groups covering purpose and actors, capabilities and journeys, architecture and integrations, security, code quality, operations, risks, and history. Before asking questions, synthesize the evidence, contradictions, open questions, and repeated assumptions into the smallest useful set of cross-record review questions and record them in `review-question-plan.yaml`. Ask one focused question at a time. Let the user drill into any individual record and record `accepted`, `accepted-with-corrections`, `rejected`, or `deferred` for every proposal in `review-decisions.yaml`.

Prefer questions whose answer resolves a genuine shared decision across multiple record types—for example, a single policy answer may clarify an actor's authority, three workflow branches, an ADR, two constraints, and related risks. Each question must state:

- the plain-language decision or confirmation sought;
- why it matters and the strongest supporting or conflicting evidence;
- the suggested answer or concise options when that helps;
- every record ID it may update and how each would change;
- whether the answer only clarifies content or also asks for approval.

Apply an attributed answer once across the named records, then show the resulting changes and offer a batch decision only when the same acceptance judgment genuinely applies to every listed record. Never use a broad answer to approve unrelated details, hide dissenting evidence, or infer approval from clarification. If records diverge, split the question or decision group.

A group decision may update several clearly named records, but never conceal which records it affects. Record an accountable reviewer for every decision and explanatory notes for corrections, rejection, or deferral. For `accepted-with-corrections`, apply the agreed change to the proposal and set `corrections_applied: true` in the decision ledger before curation. High-level summaries and cross-record questions reduce human effort; they do not replace accountable decisions over the detailed inventory.

## Curate only with consent

When review decisions are complete, ask whether the user wants EWAI to file the accepted records into the live SPECS tree. If they agree, correct `accepted-with-corrections` proposals first and run `ewai archaeology curate <bundle> --project <path> --approved-by <name> --yes --json` internally.

Automatic curation preflights all accepted records and must refuse to overwrite a differing canonical record. Reconcile each conflict with the user rather than selecting a winner. Preserve rejected and deferred material in the Archaeology bundle. Verify the resulting canonical paths and curation ledger before describing Archaeology as complete.

Use the SPECS Knowledge Curator persona to:

- route accepted knowledge to the canonical SPECS location;
- promote the reviewed technology inventory to `SPECS/5.Strategy/architecture/stack.md` and record approved pack choices in project configuration;
- link it back to the archaeology report and evidence identifiers;
- keep rejected or unresolved proposals in the archaeology bundle;
- avoid replacing an existing authoritative record without explicit reconciliation;
- update relevant indexes, links, and lifecycle status.

Never promote inferred compliance, security, legal, or regulatory obligations without a qualified owner. Never represent an inferred persona as direct user research.

When the user wants to move from the reviewed reconstructed current state to target-state design, architecture trade-offs, or a transition roadmap, hand the accepted evidence to `$ewai-architecture`. Do not redesign the system inside Archaeology or relabel an inferred implementation choice as accepted future architecture.

## Pass the prospective-work transition gate

After accepted Archaeology knowledge has been curated, make a distinct, explicit future-work offer. This is a required closeout gate, not an optional conversational flourish. Explain that reconstructed historical intents describe how the project reached its current state; new work needs a separate prospective record.

Do not treat remediation items, risks, technical-debt records, or intents created from Archaeology findings as satisfying this gate. Those address what the investigation found wrong or incomplete. The prospective transition separately asks what the project should become next.

Offer the user these natural-language routes:

1. be interviewed about upcoming features, problems, or desired outcomes;
2. provide a roadmap, backlog, feature list, or folder of discovery material for `$ewai-context-import`;
3. ask EWAI for evidence-based ideas for future features, experience enhancements, operational improvements, integrations, security improvements, resilience work, code-quality improvements, testing, observability, or maintainability.

Use a direct closeout such as:

> We have reconstructed and reviewed where the project is today. Would you like me to (1) interview you about what it should do next, (2) work from a roadmap, feature list, or discovery folder, or (3) give you EWAI's own evidence-based recommendations—including product, experience, security, operations, resilience, testing, and code quality?

Do not replace this offer with “What would you like to tackle next?”, “What's on your mind?”, or another generic question. Do not end the Archaeology conversation until the offer has been made and the user has selected a route or explicitly declined it.

Record the transition in `<bundle>/future-work-transition.yaml` with the offer shown, time, accountable user when known, the selected route or explicit decline, supplied source references, recommendation-set paths, accepted candidate IDs, and separately approved intent IDs. This is transition evidence, not permission to create work.

Use this schema:

```yaml
schema: ewai.archaeology-future-work-transition/v1
offered_to_user: true
offer_summary: <the three-route offer shown>
routes_offered: [interview, import, recommendations]
offered_at: <ISO-8601 timestamp>
decision: interview | import | recommendations | declined
decided_by: <accountable user>
decided_at: <ISO-8601 timestamp>
source_references: []
recommendation_sets: []
accepted_candidate_ids: []
approved_intent_ids: []
```

When the user asks for EWAI's ideas, create a clearly labelled recommendation set from the curated project knowledge, security review, code-quality review, risks, gaps, imported context, and unresolved questions. Keep unaccepted suggestions under the Archaeology provenance bundle at `recommendations/<slug>.md` and maintain `recommendations/index.md`; do not place them directly in canonical Purpose or Constraints. For every recommendation record:

- the problem or opportunity and evidence that prompted it;
- affected capabilities, project actors, and personas;
- expected outcome and likely value;
- security, privacy, operational, and delivery implications;
- dependencies, trade-offs, uncertainty, and confidence;
- whether it is `suggested`, `accepted`, `rejected`, or `deferred`.

AI recommendations are proposals, not proof of user demand or permission to change the system. Present them in small themed groups and ask the user which, if any, deserve further work. Include security recommendations, but distinguish observed vulnerabilities, defence-in-depth improvements, missing assurance, and speculative threats. Urgent credible security findings should be surfaced immediately and handled according to the project's disclosure and incident rules. Never create recommendation-derived or remediation intents in parallel merely to make the closeout feel complete; obtain an explicit user decision for the named candidates first.

For an accepted idea that still lacks a testable outcome, create a lightweight discovery request at `SPECS/2.Purpose/explorations/feature-candidates/<slug>.md`. Cite its Archaeology, context-import, or human sources and capture the question to explore, affected actors, expected value, constraints, evidence, and open decisions. Do not pretend it is ready to build.

For an accepted idea that has explicit desired outcomes, personas, journeys or workflows, acceptance evidence, constraints, dependencies, and open decisions, offer `$ewai-intent` and obtain approval before creating or enriching `SPECS/2.Purpose/intents/<domain>/<slug>.md`. End by showing the user the resulting candidate and intent backlog and asking, **“What should this system do next?”** Stop before planning or implementation.

## Completion boundary

Archaeology is complete only when the persona-value gate and maximum-detail validator have passed, every manifest row is accounted for, the coverage ledger shows every material in-scope surface as mapped, partial with an accepted limitation, blocked with an owner, or not applicable, the SPECS reconstruction ledger accounts for all six areas and the applicable fourteen lifecycle stages for every material capability, the security and code-quality reviews are present, material claims are traceable, contradictions and unknowns remain visible, accountable reviewers have recorded decisions, and accepted knowledge has been promoted into canonical SPECS. The Archaeology closeout is not finished until the distinct prospective-work offer is recorded in `future-work-transition.yaml` and the user has chosen a route or explicitly declined. A reconnaissance map, analysis dossier set, representative sample, summary, proposals-only bundle, or remediation-intent list never satisfies this completion gate.

Before saying “Archaeology complete”, run `ewai archaeology validate-completion <bundle> --project <path> --json`. If it fails, describe the work as awaiting curation or awaiting the prospective-work decision and resolve the named errors. Never claim completion from conversation state alone.

Stop before implementation. Create a new intent for any remediation or feature work discovered by the dig.
