---
name: ewai-pipeline
description: Initialise and operate the portable Engineering With AI Pipeline in a software project. Use when Codex needs to create or inspect a project-local SPECS contract, onboard an existing codebase through Archaeology, discover EWAI technology or persona packs, attach EWAI delivery methodology to a repository, run installation diagnostics, or prepare intent-to-delivery work through EWAI skills and tooling.
---

# EWAI Pipeline

## Presentation, not a shorter workflow

Keep the complete onboarding and delivery flow. Show four routine status lines, the returned menu at a decision point, and one decision at a time. Retain warnings, blockers and unknown checks with short reasons; technical diagnostics are on request. Progress is one sentence of at most 24 words per meaningful checkpoint. Don't narrate commands, file reads, JSON parsing, policies or internal reasoning. Don't repeat the menu during a selected action. These limits never waive briefing, consent, purpose alignment, standards, Build approval or Manual QA.

Use the `ewai` CLI as the stable interface. Resolve durable knowledge from the `specsRoot` in `.ewai-pipeline/project.json`; do not assume it is `./SPECS`. Keep regenerable runtime state under the workspace's `.ewai-pipeline/`.

## Open the companion

When the first user message says EWAI launched this host, own the complete onboarding conversation. Do not ask the user to copy, paste, or run CLI commands. Licence entry uses the guarded dashboard password form by default; a hidden private terminal prompt is an alternative only when a genuine interactive terminal is available. Never collect a key in chat or shell arguments. Treat commands, JSON, and tool output as internal control-plane details and translate them into concise human language.

1. Determine whether `.ewai-pipeline/project.json` exists and whether its configured SPECS root contains `pipeline.yaml`.
2. If the project is not initialized, use the launch's project root and existing-code signal. Ask one location question: recommend `./SPECS` for one repository/monorepo or a dedicated knowledge repository for independent repositories. After agreement, run `ewai init --project <resolved-root> --specs <agreed-path> --json` promptly; add `--init-specs-repo` only when local knowledge-repository creation is approved. Do not inspect the installed EWAI source, run `ewai --version`, or perform project Archaeology before init. Version comes from check-in. An uninitialised first response is the location question, not an invented status/menu. Never create a remote repository without separate explicit approval.
3. Once initialized, run `ewai checkin --project <path> --json` and wait for the complete result.
   - Immediately after successful first initialisation, offer the returned `onboarding.personaLearning` question: **“Would you like to see how specialist personas could help us analyse this project?”** Offer it before deeper analysis or Archaeology for both new and existing code. Choosing to read opens https://www.conversationalcoding.dev/personas/; it does not buy, activate or download anything. Respect a decline and continue normal onboarding with installed personas. Preserve the human briefing and purpose alignment. Do not repeat first-run onboarding when the project was already initialised at launch.
4. Always interpret and display the EWAI version and update status, premium entitlement and installed-library status, and dashboard URL. Show `unknown` states with a short reason; never silently omit a check.
   - The harness is installed and updated only through npm. Offer only the returned npm update action. Never inspect, fetch, or pull the EWAI Git repository for installation or updating, including when working in the harness development checkout.
5. Ask before any premium install or update. Do not download merely because access exists.
6. Capture the initial human project briefing. At minimum establish purpose, primary users, desired outcomes, business context, known constraints, and what must not be inferred from current behaviour.
7. Ask whether the user has a folder of emails, meeting transcripts, documents, research, requirements, or other project material for optional `$ewai-context-import` enrichment. Ask once during onboarding; respect a decline.
8. If material is supplied, complete its consent, classification, processing-policy, reconnaissance, and persona-routing gates before using it to enrich detailed discovery or Archaeology.
9. For an existing codebase, only then offer optional Archaeology: explain that it can reconstruct missing documentation from the code, and ask whether the user wants it. Do not run it without acceptance. If declined, continue to Discovery and Doctor; it remains available later. If accepted, require its purpose-alignment and persona-value checkpoints before deep reconstruction; show which installed core, premium, personal, or project personas would improve the bounded passes and ask the user to confirm the ensemble.
10. Read recent work and render the structured `companion` opening returned by check-in. The opening format is mandatory: report status first, render its heading, and render every action in order as `[id] label`. A narrative-only opening is invalid. Do not replace or precede the menu with a free-form recommendation list. Option **[6] Continue a piece of work** must be present whenever check-in returns it. Include **[7] Read about premium personas** and **[8] Set up premium personas** only when returned: both are absent when premium access is available and the installed pack is verified. Always render **[9] Configure the dashboard**. When `companion.spotlight` is present, render it after the numbered actions as a bounded advisory spotlight: name the work, reason and accountable route, then name each `activePersonas` entry with its tier. Do not present the spotlight as a new menu action or as approval. When `companion.personaSetup` is present, ask its exact optional question after the menu: **“Do you have a premium persona licence, or shall we use the core personas?”** Only then ask the exact returned closing prompt: **“What's on your mind?”**
11. Treat Companion and persona guidance as advisory. A recommendation or persona cannot create delivery permission, user evidence, specialist assurance, accepted risk or human acceptance. Never let a Companion read trigger premium sync or download; use installed premium personas only when already present.
12. When check-in returns a pending `dashboardHandoff`, identify it immediately after the numbered menu. If its action is `review-contribution`, verify `authority: none`; when the user confirms, use `ewai_resolve_dashboard_handoff` to mark it `claimed`, invoke `$ewai-phase-evidence`, return advisory feedback, and mark it `completed` without changing delivery state. For `begin` or `continue`, confirmation claims the hand-off, invokes `$ewai-deliver`, and completes it only after the canonical begin/resume transition succeeds. A dashboard selection is never permission to skip a gate or begin writing code.

When the user chooses **[6] Continue a piece of work**:

1. Use `$ewai-deliver`; do not enter the host AI's generic plan mode.
2. List resumable intent delivery states from EWAI rather than memory.
3. Let the user choose when more than one work item is plausible.
4. Invoke the guarded EWAI delivery continue operation for the selected slug.
5. Reconcile Markdown, structured intent JSON, durable delivery JSON, and SQLite before proceeding.
6. Resume the exact next canonical phase. Never infer or skip a phase, and never write Build code without the recorded human Build approval.

When the user chooses **[7] Read about premium personas**, offer the fixed public learning page https://www.conversationalcoding.dev/personas/ and open it only when chosen. The visitor can read about perspectives and find purchase choices there. Return to the conversation without acquiring content or changing the project.

Render **[8] Set up premium personas** only when returned. When it or private setup is chosen, use `$ewai-persona-entitlement` with the dashboard's guarded password form by default; hidden terminal configure is an alternative only when a genuine private interactive terminal is available. Explain that submitting the key verifies and installs immediately; do not ask a second download question for that action. Never ask them to paste a key here. Confirm the safe installed/version result and refresh `ewai persona index --project <path> --json` before using the new lenses. Resolve chosen setup before any accepted Archaeology; after failure offer retry or explicit core-only continuation. Retain briefing and purpose alignment. Reading or declining continues core work without acquiring anything. The automatic missing-key question applies only to `companion.personaSetup`, not expired, invalid or unavailable configured licences. Licence management remains available in dashboard Configuration even when [8] is absent. Do not repeat the missing-key question within a conversation after a decline.

When the user chooses **[9] Configure the dashboard**, use `$ewai-dashboard-configuration`. Explain only the views relevant to their needs and save their explicit choices through the shared preferences command. Optional views are off by default; hiding them never disables required checks, hooks, policies, standards or approvals.

Companion menu identifiers (render only the actions actually returned):

1. Capture something new
2. Pick up a ready intent
3. Explore an idea and shape connected intents
4. Explore the Mind Palace, risks, or standards
5. See recommendations and possible next work
6. Continue a piece of work
7. Read about premium personas
8. Set up premium personas
9. Configure the dashboard

Without existing work, omit [6]. With available premium access and a verified installed pack, omit [7] and [8]. Keep [9] and never renumber the remaining identifiers.

Keep progress warm and semantic: say what EWAI is trying to understand and what changed in its understanding. Do not narrate shell commands, filenames being opened, JSON parsing, or routine check execution unless the user asks for technical detail or an operation fails.

## Start every project conversation with check-in

When `.ewai-pipeline/project.json` points to a valid SPECS contract, run `ewai checkin --project <path> --json` once before substantive project work. Briefly tell the user:

- the project pipeline-dashboard URL and whether it was started or reused;
- whether premium persona access is available;
- whether the premium library is installed and current;
- whether an EWAI Pipeline update is available.
- whether the project Mind Palace is tidy or would benefit from housekeeping.

Check-in may start the project-local loopback dashboard and refresh its disposable SQLite projection. It checks licence access and available versions without downloading updates, but it isn't unconditionally read-only: confirmed expiry of the matching team subscription blocks that managed pack and removes it only when the unchanged files can be safely verified. Edited or unsafe files are preserved for investigation but excluded from premium selection. Individual expiry keeps installed personas and stops updates. A failed or unverified provider response isn't proof of expiry; an already confirmed team expiry remains in effect during a later outage. Personal and project personas are never part of that cleanup. When check-in returns `offer-install` or `offer-update`, ask whether the user wants the download. Do not sync merely because access or an update exists. Only after explicit approval run `ewai persona premium sync --project <path> --yes`.

Every new session follows the returned actions, including [9] for Configuration. A missing-key result must also become the actual `companion.personaSetup` question in the conversation, not just a status summary. Keep credentials private and core use optional as described above.

## Keep live work observable

When an intent is actively being delivered, use the EWAI MCP active-work tools so the user can follow material progress in the dashboard:

- start a session when substantive delivery work begins;
- record handoffs, external reviews, decisions, responses, blockers, human questions, and completed artefacts;
- resolve a human question when its answer has been applied;
- finish the session with its real outcome.

Do not publish heartbeat events such as “still working.” Live activity is a decision and evidence stream, not a token-by-token transcript.

## Start or inspect a project

1. Resolve the workspace root from `.ewai-pipeline/project.json`, a default `SPECS/pipeline.yaml`, or `.git`; then use the locator's configured SPECS root.
2. Initialise a single repository or monorepo with `ewai init --project <path>`. For a workspace of independent repositories, recommend a dedicated knowledge repository and use `ewai init --project <workspace> --specs <knowledge-repository>/SPECS --init-specs-repo` after permission to initialise the local Git repository.
   - After successful first init, offer `onboarding.personaLearning` before deeper analysis or Archaeology, for new or existing code. Learning is optional and requires no purchase or install; retain the briefing and respect a decline.
3. Capture a human project briefing, then offer `$ewai-context-import` for any supplied emails, transcripts, documents, or research.
4. Let Context Import inspect the available persona index, explain which personas improve the analysis, and propose evidence-grounded project actors without confusing advisory personas with real user research.
5. For existing code, always offer optional Archaeology and wait for acceptance. If declined, continue to Discovery without reconstruction and leave it available later. If accepted, compare repository and imported evidence with the briefing and ask the owner to resolve material discrepancies before deeper reconstruction.
6. Review and curate Context Import and Archaeology findings; offer self-review/manual filing or an AI-guided walkthrough, and do not promote inferred intent, constraints, personas, or technology choices automatically.
7. After Archaeology curation, offer to interview the user about upcoming features, interpret an imported roadmap or feature list, or suggest evidence-based product, security, operational, and code-quality recommendations. Keep immature accepted ideas as feature candidates and create full intents only with user approval.
8. Complete `ewai discover --project <path>` to confirm scope, stack, minimum standards, and compliance triage using the reviewed findings.
9. Verify it with `ewai doctor --project <path> --json`.
10. Read `pipeline.yaml` from the configured SPECS root before selecting repositories, packs, or delivery behaviour.

Do not relocate or overwrite an existing SPECS contract through init. Relocation requires an explicit migration that updates the workspace locator and project contract together.

## Discover capabilities

- Run `ewai pack list` to inspect installed core, technology, persona, and organisation packs.
- Run `ewai persona list --project <path>` to inspect core, personal, and project personas available to a project.
- Run `ewai persona index --project <path> --json` when a skill needs descriptions, tags, capabilities, tiers, and local paths for persona routing.
- Use `ewai persona create <slug>` for a reusable personal persona, or add `--scope project --project <path>` for a persona owned by the project.
- Use `ewai persona path` to locate the personal library. Premium personas are supplied by entitled packs and must not be assumed available.
- Use `$ewai-shape-intents` when a broad idea, workflow, roadmap item, or capability may need several connected intents. It must present and gain approval for the map before creating any draft.
- Use `$ewai-intent` to refine one coherent intent, including any approved map membership and relationships.
- Use `$ewai-architecture` to walk through current or target enterprise/solution architecture for a whole system, bounded capability or domain, intent set, or cross-cutting concern, and prepare reviewable standards, patterns, ADRs, risks, diagrams, and transition records before delivery relies on them.
- Use `$ewai-standards-check` to verify supplied code, files, change sets, or a whole repository against accepted project-local SPECS standards and create durable review evidence.
- Use `$ewai-palace-housekeeping` when the user selects the Mind Palace option or check-in reports that project knowledge would benefit from housekeeping.

## Operating boundaries

- Treat the configured SPECS root as versionable project truth. In a multi-repository workspace, prefer a dedicated knowledge-and-delivery repository.
- Treat `.ewai-pipeline/` as disposable runtime state.
- Treat Markdown under the configured SPECS root as authoritative over its SQLite projection.
- Let the configured agent host start the stdio MCP server; do not run a second persistent MCP process.
- Require human approval before Build when `approvals.build` is `required`.
- Read the full `validation` contract before scheduling review. Do not infer availability from global machine state, and do not use the active Claude, Codex, or Antigravity orchestrator as its own independent validator.
- Honour each checkpoint's selected providers, maximum cycles, breadth, depth, and output limit. Standards compliance remains mandatory even when no independent external validator is configured.
- Never write project outputs into the global EWAI installation.
- Never carry repository paths or project state from one project into another.

Read [CLI reference](references/cli.md) for command details and [SPECS contract](references/specs-contract.md) when creating or validating project artefacts.
