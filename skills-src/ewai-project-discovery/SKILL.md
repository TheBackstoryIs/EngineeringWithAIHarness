---
name: ewai-project-discovery
description: Interview a project owner after EWAI initialization, capture the project's purpose, users, outcomes, boundaries, technology direction, data and assurance profile, then generate the initial project-local SPECS brief, standards, compliance triage, and stack strategy. Use when starting, onboarding, re-profiling, or selecting a technology stack for an EWAI project before creating delivery intents or application code.
---

# EWAI Project Discovery

Build shared understanding before planning or implementation. Treat generated recommendations as drafts for accountable human review.

Resolve the workspace and SPECS root from `.ewai-pipeline/project.json`; all logical `SPECS/...` paths below are relative to that configured root.

## Brief an existing project before Archaeology

For an existing codebase, begin with a short conversational briefing before deep repository analysis. Ask one question at a time and establish:

- why the project exists and why it matters now;
- primary users and stakeholders;
- desired outcomes and signs of failure;
- business and operational context;
- known constraints, non-goals, and behaviour that may be accidental or obsolete.

Record the confirmed briefing at `SPECS/2.Purpose/explorations/project-brief.md`. Separate the user's account from repository-derived hypotheses. Offer `$ewai-context-import` for any folder of emails, meeting transcripts, documentation, research, requirements, or other project material. Use reviewed imported findings to make the remaining interview more specific. For an existing codebase, then hand off to `$ewai-archaeology`, which must compare its reconnaissance with the briefing and imported evidence and ask the owner to resolve material differences before deeper reconstruction.

Do not launch the terminal-based discovery questionnaire inside an AI conversation. Conduct the interview naturally, prepare a repeatable answers file under the disposable `.ewai-pipeline/runtime/` boundary, and use the non-interactive `--answers` interface when generating the full Project SPECS after reviewed Archaeology evidence is available.

## Run discovery

1. Read the configured `pipeline.yaml`, the human project briefing, reviewed Context Import and Archaeology findings when present, and repository evidence for the existing stack.
2. Run `ewai doctor --project <path>` and resolve failed project-contract checks.
3. Run `ewai discover --project <path>`.
4. Ask one interview question at a time. Prefer reviewed Context Import, Archaeology, repository, or SPECS evidence over asking the owner to rediscover a known fact.
5. Keep unknown answers explicit. Do not convert uncertainty into an assumed requirement.
6. Ask whether Claude CLI, Codex CLI, and Google Antigravity through the `agy` CLI are available for external validation; default each to unavailable unless the user explicitly confirms it. Availability does not force use: record whether each provider is enabled.
7. Confirm the review-and-fix cycle limit, breadth, analysis depth, and output size for implementation-plan, test-plan, and post-code validation. Explain the token/assurance trade-off in human terms.
8. Review the generated Project SPECS, technology stack, standards options, and compliance risk with their accountable owners.

## Optional organisation policy baseline

During Guided Setup, explain that an Organisation Policy Design Gate is optional. When the selected Organisation Blueprint contains policy contributions, show the resolved baseline, sources, rule and role counts, outcomes, pack pins, and exact effective digest. Use `$ewai-organisation-policy` to review the proposal and require a named person to approve that exact digest before materialisation. With no contribution or no approval, preserve the explicit non-blocking `not-configured` state.

Do not infer policy from generic governance documents, make premium personas mandatory, or describe the baseline as production enforcement or compliance certification.

## Select reproducible discovery depth

Use `$ewai-evidence-depth` when onboarding an existing repository, repeating Discovery across participants or model sessions, or when assurance and context cost need an explicit trade-off. Refresh the Source Map, then prepare independent architecture, data, security, product, delivery, governance, and operations recommendations from repository coverage and attributed owner evidence.

Show which core, project, personal, and optional installed premium personas are active for the current concern and why. Swap them as the concern changes. Persona advice never substitutes for the owner's account, confirms an inferred fact, or selects depth.

Require a named review across all seven dimensions and keep stable gaps separate from how they are later grouped into intents or work. If Discovery is repeated, compare stored run fingerprints before attributing differences to the model. Treat unexplained coverage or gap variance as a reproducibility failure, and restore missing evidence context before proceeding.

This is a local evidence workflow. It does not send feedback, run production code, enforce policy at runtime, install premium personas, or grant Build authority.

## Select technology for a new project

When no implementation repository exists, do not ask the user to name a framework before understanding the project. First establish the product shape, deployment environment, team capability, data sensitivity, integrations, scale, availability, accessibility, compliance, budget, and operational ownership.

Then:

1. explain the material decision criteria in plain language;
2. recommend fitting installed technology or stack packs, with trade-offs;
3. let the user select a pack, record custom technology, or explicitly remain undecided;
4. capture the decision and rationale in `SPECS/5.Strategy/architecture/stack.md`;
5. route accepted minimum practices into project constraints, patterns, and ADRs rather than leaving them only as suggestions.

If a stack choice is still uncertain and materially blocks an intent, create a bounded technical-spike intent through `$ewai-intent`. Do not select a stack merely because EWAI has a pack for it.

After purpose and the material technology direction are understood, offer `$ewai-architecture` when the solution has consequential boundaries, integrations, data ownership, security or trust decisions, operational requirements, transition concerns, or enterprise dependencies. Discovery establishes enough context to start that conversation; it does not silently invent a complete architecture. Accepted Architecture proposals then become the project standards, patterns, ADRs, risks, diagrams, and strategy that delivery must honour.

For a repeatable or non-interactive interview, copy and complete `templates/discovery-answers.yaml` from the EWAI installation, then run:

```bash
ewai discover --project <path> --answers <answers.yaml>
```

## Decision discipline

- Select installed technology or stack pack identifiers when they fit.
- Treat pack commands as a starting point, not a complete framework best-practice standard. Only claim practices that are present in the selected pack or accepted project SPECS.
- Record custom or undecided technology rather than forcing the nearest pack.
- Treat detected frameworks as evidence, not automatic approval of a stack.
- Require provenance, licence, compatibility, and support review before recommending boilerplate.
- Label compliance results as candidate reviews. Never claim legal advice, certification, or compliance from interview answers.
- Allow only providers marked both `available` and `enabled` in `SPECS/pipeline.yaml` to satisfy external-validation stages.
- Exclude the active orchestrator from independent validation. A one-system project therefore records external stages as not-supported rather than pretending self-review is independent.
- Treat external review cycles as configurable assurance. Treat standards compliance as mandatory and non-waivable.
- Keep unsupported stages visible and never mark them passed.
- Keep `SPECS/` as durable truth and `.ewai-pipeline/` as regenerable runtime state.

## Completion boundary

Discovery is complete when the project owner has a reviewable purpose and scope, the technical owner has a stack decision or explicit open decision, and assurance owners can see every triggered review and unknown.

Do not begin Build. Create or enrich the first delivery intent only after the discovery artefacts have been reviewed.

Read [discovery contract](references/discovery-contract.md) when validating outputs or automating answers.
